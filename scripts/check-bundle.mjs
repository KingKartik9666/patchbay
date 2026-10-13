import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..'), dist = join(root, 'dist');
async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error('Unexpected non-file in renderer: ' + path);
  }
  return files.sort();
}
const files = await filesIn(dist);
const contents = new Map(await Promise.all(files.map(async path => [path, await readFile(path)])));
let js = 0, css = 0, fonts = 0, total = 0, other = 0;
for (const [path, data] of contents) {
  total += data.length;
  if (path.endsWith('.js')) js += gzipSync(data).length;
  else if (path.endsWith('.css')) css += gzipSync(data).length;
  else if (path.endsWith('.woff2')) fonts += data.length;
  else other += data.length;
}

// Follow built stylesheet order instead of assuming the former glass colors
// or selecting only the first :root rule in the concatenated renderer CSS.
const html = contents.get(join(dist, 'index.html'))?.toString();
assert.ok(html, 'Build the renderer before checking its bundle.');
const stylePaths = [...html.matchAll(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi)].map(match => {
  assert.ok(!/^(?:https?:)?\/\//i.test(match[1]), 'Renderer styles must be local.');
  return resolve(dist, match[1].replace(/^\//, ''));
});
assert.ok(stylePaths.length, 'No built renderer stylesheet found.');
const builtCss = stylePaths.map(path => {
  assert.ok(contents.has(path), 'Missing renderer stylesheet: ' + path);
  return contents.get(path).toString();
}).join('\n');
function rootDeclarations(styles) {
  const declarations = { light: {}, dark: {} };
  const clean = styles.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1].split(',').map(selector => selector.trim().replace(/["']/g, ''));
    const palette = selectors.includes(':root') ? declarations.light
      : selectors.includes(':root[data-theme=dark]') ? declarations.dark : null;
    if (!palette) continue;
    for (const declaration of rule[2].matchAll(/([\w-]+)\s*:\s*([^;{}]+)(?:;|$)/g)) {
      palette[declaration[1]] = declaration[2].trim();
    }
  }
  return { light: declarations.light, dark: { ...declarations.light, ...declarations.dark } };
}
const palettes = rootDeclarations(builtCss);
const sourcePalettes = rootDeclarations(await readFile(join(root, 'src/reference.css'), 'utf8'));
const tokenNames = ['mask', 'deep', 'solid', 'silk', 'muted', 'line', 'mint', 'copper', 'brand', 'fault'];
const rgb = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
const hex = channels => '#' + channels.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
const mix = (back, front, alpha) => hex(rgb(back).map((value, index) => value * (1 - alpha) + rgb(front)[index] * alpha));
function color(palette, name, seen = new Set()) {
  assert.ok(!seen.has(name), 'Circular theme token: ' + name);
  const value = palette['--' + name];
  assert.ok(value, 'Missing theme token: ' + name);
  if (/^#[a-f\d]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[a-f\d]{3}$/i.test(value)) return '#' + [...value.slice(1)].map(character => character.repeat(2)).join('').toLowerCase();
  const next = new Set([...seen, name]);
  const variable = value.match(/^var\(--([\w-]+)\)$/);
  if (variable) return color(palette, variable[1], next);
  const blend = value.match(/^color-mix\(in srgb,\s*var\(--([\w-]+)\)\s*([\d.]+)%,\s*var\(--([\w-]+)\)\)$/);
  assert.ok(blend, 'Unsupported audited theme color: ' + name + '=' + value);
  return mix(color(palette, blend[3], next), color(palette, blend[1], next), Number(blend[2]) / 100);
}
const luminance = value => rgb(value).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
const contrast = (front, back) => {
  const values = [luminance(front), luminance(back)].sort((a, b) => a - b);
  return (values[1] + .05) / (values[0] + .05);
};
const rounded = value => Number(value.toFixed(2));
const contrasts = {};
let contrastPassed = true;
for (const [name, palette] of Object.entries(palettes)) {
  for (const token of tokenNames) {
    assert.equal(color(palette, token), color(sourcePalettes[name], token), 'Stale built ' + name + ' theme token: ' + token);
  }
  assert.ok(palette['font-family']?.includes('Nunito'), 'Nunito is missing from the built ' + name + ' theme.');
  const surfaces = Object.fromEntries(['mask', 'deep', 'solid', 'hover', 'selected'].map(token => [token, color(palette, token)]));
  // A glass surface transmits up to 20% of the scene. Audit the highest
  // contrast opposing background as well as its opaque token surfaces.
  surfaces.glassWorstCase = hex(rgb(surfaces.deep).map(channel => channel*.8+(1-channel)*.2));
  const text = {};
  for (const foreground of ['silk', 'muted', 'mint', 'copper']) {
    text[foreground] = Object.fromEntries(Object.entries(surfaces).map(([surface, background]) => {
      const ratio = contrast(color(palette, foreground), background);
      contrastPassed &&= ratio >= 4.5;
      return [surface, rounded(ratio)];
    }));
  }
  const faultOnDeep = contrast(color(palette, 'fault'), surfaces.deep);
  const faultOnSolid = contrast(color(palette, 'fault'), surfaces.solid);
  // Primary/play button text is --deep in both themes, including hover.
  const primary = contrast(surfaces.deep, color(palette, 'brand'));
  const primaryHover = contrast(surfaces.deep, color(palette, 'silk'));
  contrastPassed &&= [faultOnDeep, faultOnSolid, primary, primaryHover].every(ratio => ratio >= 4.5);
  contrasts[name] = {
    surfaces, text, faultOnDeep: rounded(faultOnDeep), faultOnSolid: rounded(faultOnSolid),
    primaryButton: { text: surfaces.deep, background: color(palette, 'brand'), ratio: rounded(primary), hoverRatio: rounded(primaryHover) },
  };
}
for (const name of tokenNames) {
  assert.equal(color(palettes.dark, name), hex(rgb(color(palettes.light, name)).map(channel => 1 - channel)),
    'Theme wave requires exact inverse RGB token: ' + name);
}
const licensePath = join(dist, 'licenses/Nunito-OFL.txt'), license = contents.get(licensePath);
assert.ok(license, 'Nunito OFL license is missing from dist/licenses.');
assert.ok(license.equals(await readFile(join(root, 'public/licenses/Nunito-OFL.txt'))), 'Built Nunito license differs from its public source.');
const font = await readFile(join(root, 'src/fonts/nunito-latin-variable.woff2'));
assert.ok([...contents].some(([path, data]) => path.endsWith('.woff2') && data.equals(font)), 'The current local Nunito font is missing from the renderer.');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const report = {
  version: manifest.version,
  javascriptGzip: js, cssGzip: css, fontsBytes: fonts, totalUncompressed: total,
  transferEstimate: js + css + fonts + other,
  budgets: { javascriptGzip: 150000, totalUncompressed: 400000 },
  font: { family: 'Nunito Variable', local: true, license: relative(dist, licensePath).replaceAll('\\', '/'), licenseBytes: license.length },
  exactInversePalettes: true,
  contrastAudit: { method: 'WCAG relative luminance on settled built CSS surfaces, including an 80% glass tint over its worst opposing scene; excludes transient animation and decorative borders.', minimumTextRatio: 4.5, ...contrasts },
  passed: js <= 150000 && total <= 400000 && contrastPassed,
};
await mkdir(join(root, 'artifacts'), { recursive: true });
await writeFile(join(root, 'artifacts/bundle-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
