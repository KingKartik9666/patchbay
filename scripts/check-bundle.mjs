import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { basename, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..'),
  dist = join(root, 'dist');
async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error('Unexpected non-file in renderer: ' + path);
  }
  return files.sort();
}
const files = await filesIn(dist);
const contents = new Map(
  await Promise.all(files.map(async (path) => [path, await readFile(path)])),
);
let js = 0,
  css = 0,
  fonts = 0,
  total = 0,
  other = 0;
for (const [path, data] of contents) {
  total += data.length;
  if (path.endsWith('.js')) js += gzipSync(data).length;
  else if (path.endsWith('.css')) css += gzipSync(data).length;
  else if (path.endsWith('.woff2')) fonts += data.length;
  else other += data.length;
}

// Follow built stylesheet order. Audited tokens are opaque; translucent tokens
// are composited over their audited backdrops before their text is measured.
const html = contents.get(join(dist, 'index.html'))?.toString();
assert.ok(html, 'Build the renderer before checking its bundle.');
const stylePaths = [...html.matchAll(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi)].map(
  (match) => {
    assert.ok(!/^(?:https?:)?\/\//i.test(match[1]), 'Renderer styles must be local.');
    return resolve(dist, match[1].replace(/^\//, ''));
  },
);
assert.ok(stylePaths.length, 'No built renderer stylesheet found.');
const builtCss = stylePaths
  .map((path) => {
    assert.ok(contents.has(path), 'Missing renderer stylesheet: ' + path);
    return contents.get(path).toString();
  })
  .join('\n');
assert.ok(
  !/url\(\s*["']?(?:https?:)?\/\//i.test(builtCss),
  'Renderer styles must not reference network URLs; fonts and images stay local.',
);
// Theme tokens live in top-level rules on the root element. `:root` and `html`
// are the shared base; `[data-theme=light|dark]` on either overrides it for
// that theme, and wins by specificity wherever it appears in the file.
function rootDeclarations(styles) {
  const declarations = { base: {}, light: {}, dark: {} };
  const clean = styles.replace(/\/\*[\s\S]*?\*\//g, '');
  // Only top-level roots are defaults. A nested prefers-contrast rule must not
  // silently replace normal text colors during the contrast audit.
  let offset = 0;
  while (offset < clean.length) {
    const opening = clean.indexOf('{', offset);
    if (opening === -1) break;
    let closing = opening + 1,
      depth = 1;
    for (; closing < clean.length && depth; closing++) {
      if (clean[closing] === '{') depth++;
      else if (clean[closing] === '}') depth--;
    }
    assert.equal(depth, 0, 'Unbalanced renderer stylesheet.');
    const selectors = clean
      .slice(offset, opening)
      .split(',')
      .map((selector) => selector.trim().replace(/["']/g, ''));
    const palettes = new Set();
    for (const selector of selectors) {
      const match = selector.match(/^(?::root|html)(?:\[data-theme=(light|dark)\])?$/);
      if (match) palettes.add(match[1] ?? 'base');
    }
    for (const palette of palettes) {
      for (const declaration of clean
        .slice(opening + 1, closing - 1)
        .matchAll(/([\w-]+)\s*:\s*([^;{}]+)(?:;|$)/g)) {
        declarations[palette][declaration[1]] = declaration[2].trim();
      }
    }
    offset = closing;
  }
  return {
    light: { ...declarations.base, ...declarations.light },
    dark: { ...declarations.base, ...declarations.dark },
  };
}
// Splits on a separator outside parentheses and quotes, so data URIs, :is()
// lists and rgba() arguments stay whole.
function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0,
    quote = '',
    start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '(' || character === '[') depth++;
    else if (character === ')' || character === ']') depth--;
    else if (character === separator && !depth) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}
const normalizeSelector = (selector) =>
  selector
    .replace(/["']/g, '')
    .replace(/::(before|after)/g, ':$1')
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
// Expands every :is()/:where() list into plain alternatives, so a reset
// written as `.high-contrast :is(.titlebar,#rail)` is read as two selectors.
function expandSelector(selector) {
  const match = selector.match(/:(?:is|where)\(/);
  if (!match) return [selector];
  const start = match.index,
    open = start + match[0].length;
  let depth = 1,
    index = open;
  for (; index < selector.length && depth; index++) {
    if (selector[index] === '(') depth++;
    else if (selector[index] === ')') depth--;
  }
  const inner = selector.slice(open, index - 1),
    before = selector.slice(0, start),
    after = selector.slice(index);
  return splitTopLevel(inner, ',').flatMap((option) =>
    expandSelector(normalizeSelector(before + option + after)),
  );
}
const normalizeCondition = (prelude) => prelude.toLowerCase().replace(/\s+/g, '');
// Every style rule with its selectors, declarations and enclosing @media or
// @supports conditions. Font faces, keyframes and properties are not styles.
function styleRules(styles) {
  const clean = styles.replace(/\/\*[\s\S]*?\*\//g, ''),
    rules = [];
  const walk = (start, end, conditions) => {
    let offset = start;
    while (offset < end) {
      const opening = clean.indexOf('{', offset);
      if (opening === -1 || opening >= end) break;
      let closing = opening + 1,
        depth = 1;
      for (; closing < end && depth; closing++) {
        if (clean[closing] === '{') depth++;
        else if (clean[closing] === '}') depth--;
      }
      assert.equal(depth, 0, 'Unbalanced renderer stylesheet.');
      const prelude = clean.slice(offset, opening);
      const head = prelude.slice(prelude.lastIndexOf(';') + 1).trim(),
        body = clean.slice(opening + 1, closing - 1);
      if (/^@(media|supports|layer|container)\b/i.test(head))
        walk(opening + 1, closing - 1, [...conditions, normalizeCondition(head)]);
      else if (!head.startsWith('@')) {
        assert.ok(!body.includes('{'), 'Built renderer CSS must not contain nested rules: ' + head);
        const selectors = splitTopLevel(head, ',').map(normalizeSelector);
        rules.push({
          selectors,
          expanded: selectors.flatMap(expandSelector),
          conditions,
          declarations: splitTopLevel(body, ';').flatMap((declaration) => {
            const colon = declaration.indexOf(':');
            if (colon < 1) return [];
            const value = declaration.slice(colon + 1).trim();
            return [
              {
                property: declaration.slice(0, colon).trim().toLowerCase(),
                value: value.replace(/\s*!important$/i, '').trim(),
                important: /!important$/i.test(value),
              },
            ];
          }),
        });
      }
      offset = closing;
    }
  };
  walk(0, clean.length, []);
  return rules;
}
const palettes = rootDeclarations(builtCss);
const sourcePalettes = rootDeclarations(await readFile(join(root, 'src/reference.css'), 'utf8'));
// Opaque tokens: surfaces, text, actions and status. Each is audited directly.
const tokenNames = [
  'mask',
  'deep',
  'solid',
  'hover',
  'selected',
  'active',
  'silk',
  'muted',
  'faint',
  'line',
  'strong-line',
  'brand',
  'brand-hover',
  'brand-pressed',
  'on-brand',
  'accent',
  'accent-soft',
  'accent-line',
  'on-accent',
  'select',
  'on-select',
  'selection',
  'on-selection',
  'circle-ink',
  'title-quiet',
  'fault',
  'fault-soft',
  'fault-line',
  'win-close',
  'on-win-close',
  'tooltip',
  'on-tooltip',
  'focus',
  'focus-halo',
];
// The instrument plate: opaque and themed (Night: recessed charcoal with a
// pistachio signal; Pearl: recessed pearl, black ink, PlayStation blue signal).
// The diagram and editor canvases read it and redraw on every theme change.
const plateTokens = [
  'panel',
  'panel-raised',
  'panel-line',
  'panel-ink',
  'panel-ring',
  'panel-text',
  'panel-muted',
  'panel-signal',
  'panel-signal-soft',
  'panel-on-signal',
  'panel-fault',
];
// Translucent tokens may carry alpha; text drawn on them is composited below.
const glassTokens = [
  'frame-tint',
  'frame-hover',
  'frame-selected',
  'frame-pressed',
  'frame-indicator',
  'glass-bar',
  'glass-sidebar',
  'glass-sheet',
  'toast-glass',
  'scroll-glass',
  'frost',
];
// Opaque stand-ins for glass (reduced transparency, low quality, capture) and
// the static field the WebGL scene falls back to.
const solidGlassTokens = [
  'glass-solid-bar',
  'glass-solid-panel',
  'glass-solid-sheet',
  'toast-text',
  'toast-fallback',
  'field-0',
  'field-1',
];
// tests/native-appearance.mjs parses these as plain #rgb/#rrggbb; its
// scrollbar check slices --strong-line and --mask as six-digit hex.
const nativeHexTokens = ['deep', 'silk', 'muted', 'brand', 'accent', 'on-brand', 'mask'];
const nativeSixDigitTokens = ['mask', 'strong-line'];
const rgb = (hex) =>
  hex
    .slice(1)
    .match(/../g)
    .map((value) => parseInt(value, 16) / 255);
const hex = (channels) =>
  '#' +
  channels
    .map((value) =>
      Math.round(value * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
// Colors are { rgb: [r, g, b] in 0..1, alpha in 0..1 } with straight alpha.
function parseColor(value) {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  const short = text.match(/^#([\da-f]{3,4})$/);
  const long = short
    ? '#' + [...short[1]].map((character) => character.repeat(2)).join('')
    : /^#(?:[\da-f]{6}|[\da-f]{8})$/.test(text)
      ? text
      : null;
  if (long) {
    const channels = rgb(long);
    return { rgb: channels.slice(0, 3), alpha: channels[3] ?? 1 };
  }
  const functional = text.match(/^rgba?\(([^()]*)\)$/);
  if (!functional) return null;
  const parts = functional[1]
    .replace('/', ' / ')
    .split(/[\s,]+/)
    .filter((part) => part && part !== '/');
  if (parts.length !== 3 && parts.length !== 4) return null;
  const number = (part, scale) =>
    part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part) / scale;
  const channels = parts.slice(0, 3).map((part) => number(part, 255)),
    alpha = parts[3] === undefined ? 1 : number(parts[3], 1);
  if (![...channels, alpha].every((channel) => channel >= 0 && channel <= 1)) return null;
  return { rgb: channels, alpha };
}
// Source-over compositing of straight-alpha colors.
function over(top, bottom) {
  const alpha = top.alpha + bottom.alpha * (1 - top.alpha);
  if (!alpha) return { rgb: [0, 0, 0], alpha: 0 };
  return {
    rgb: top.rgb.map(
      (channel, index) =>
        (channel * top.alpha + bottom.rgb[index] * bottom.alpha * (1 - top.alpha)) / alpha,
    ),
    alpha,
  };
}
// CSS color-mix in sRGB interpolates premultiplied channels.
function mix(first, second, firstShare) {
  const secondShare = 1 - firstShare,
    alpha = first.alpha * firstShare + second.alpha * secondShare;
  if (!alpha) return { rgb: [0, 0, 0], alpha: 0 };
  return {
    rgb: first.rgb.map(
      (channel, index) =>
        (channel * first.alpha * firstShare + second.rgb[index] * second.alpha * secondShare) /
        alpha,
    ),
    alpha,
  };
}
function paint(palette, name, seen = new Set()) {
  assert.ok(!seen.has(name), 'Circular theme token: ' + name);
  const value = palette['--' + name];
  assert.ok(value, 'Missing theme token: ' + name);
  const next = new Set([...seen, name]);
  const operand = (text) => {
    const variable = text.match(/^var\(--([\w-]+)\)$/);
    return variable ? paint(palette, variable[1], next) : parseColor(text);
  };
  const variable = value.match(/^var\(--([\w-]+)\)$/);
  if (variable) return paint(palette, variable[1], next);
  const blend = value.match(/^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+?)\)$/);
  if (blend) {
    const first = operand(blend[1]),
      second = operand(blend[3]);
    assert.ok(first && second, 'Unsupported audited theme color: ' + name + '=' + value);
    return mix(first, second, Number(blend[2]) / 100);
  }
  const parsed = parseColor(value);
  assert.ok(parsed, 'Unsupported audited theme color: ' + name + '=' + value);
  return parsed;
}
// Audited tokens are settled, opaque colors; they are also the fallback case.
function color(palette, name) {
  const value = paint(palette, name);
  assert.equal(value.alpha, 1, 'Audited theme token must stay opaque: ' + name);
  return hex(value.rgb);
}
const linear = (channel) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const luminance = (value) =>
  rgb(value)
    .map(linear)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (front, back) => {
  const values = [luminance(front), luminance(back)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
};
// The grey whose relative luminance is `target`, rounded toward the worse
// case: brighter behind light (dark-theme) text, darker behind dark text.
function greyAt(target, roundUp) {
  const encoded = target <= 0.0031308 ? target * 12.92 : 1.055 * target ** (1 / 2.4) - 0.055;
  const level = (roundUp ? Math.ceil : Math.floor)(encoded * 255);
  return '#' + level.toString(16).padStart(2, '0').repeat(3);
}
// Text on glass: the glass layers (listed bottom to top) are flattened over an
// opaque backdrop, then the opaque foreground is measured against the result.
function composite(foreground, glass, backdrop) {
  const surface = hex(glass.reduce((below, layer) => over(layer, below), parseColor(backdrop)).rgb);
  return { surface, ratio: contrast(foreground, surface) };
}
const rounded = (value) => Number(value.toFixed(2));
const sameColor = (a, b) =>
  [...a.rgb, a.alpha].every(
    (channel, index) => Math.abs(channel - [...b.rgb, b.alpha][index]) <= 1 / 255,
  );
// The WebGL field clamps its own luminance under the bar, sidebar and docked
// sheet (src/rendering/field shaders): at most 0.06 in dark, at least 0.55 in
// light. Those clamps are the worst field pixel any over-field glass can show.
const fieldClamp = { dark: { max: 0.06 }, light: { min: 0.55 } };
const clampBackdrop = {
  dark: greyAt(fieldClamp.dark.max, true),
  light: greyAt(fieldClamp.light.min, false),
};
// Without the field (it never draws while data-bg=off, but glass is solid then)
// the over-field glass would sit on the frame tint over Mica: the worst
// wallpaper is white behind dark-theme glass and black behind light glass.
const extremes = { black: '#000000', white: '#ffffff' };
const worstWallpaper = { dark: extremes.white, light: extremes.black };
// Glass over the field: bar and sidebar (and the docked sheet, which is
// audited against both extremes below). Labels use ink, ink2 and ink3.
const fieldGlassPairs = [
  ['silk on bar', 'silk', ['glass-bar']],
  ['muted on bar', 'muted', ['glass-bar']],
  ['faint on bar', 'faint', ['glass-bar']],
  ['silk on sidebar', 'silk', ['glass-sidebar']],
  ['muted on sidebar', 'muted', ['glass-sidebar']],
  ['faint on sidebar', 'faint', ['glass-sidebar']],
  ['silk on sidebar indicator', 'silk', ['glass-sidebar', 'frame-indicator']],
  ['silk on sidebar hover', 'silk', ['glass-sidebar', 'frame-hover']],
  ['muted on sidebar hover', 'muted', ['glass-sidebar', 'frame-hover']],
  ['silk on sidebar pressed', 'silk', ['glass-sidebar', 'frame-pressed']],
  ['silk on bar capsule hover', 'silk', ['glass-bar', 'frame-hover']],
];
// Floating glass may land over anything: page content, the field or Mica.
const floatingGlassPairs = [
  ['silk on docked sheet', 'silk', ['glass-sheet']],
  ['muted on docked sheet', 'muted', ['glass-sheet']],
  ['faint on docked sheet', 'faint', ['glass-sheet']],
  ['toast text on toast glass', 'toast-text', ['toast-glass']],
  ['muted on toast glass', 'muted', ['toast-glass']],
  ['silk on scroll glass', 'silk', ['scroll-glass']],
  ['muted on scroll glass', 'muted', ['scroll-glass']],
  ['silk on frame tint', 'silk', ['frame-tint']],
  ['silk on frame hover', 'silk', ['frame-tint', 'frame-hover']],
  ['silk on frame selected', 'silk', ['frame-tint', 'frame-selected']],
];
const opaquePairs = [
  ['fault on deep', 'fault', 'deep'],
  ['fault on solid', 'fault', 'solid'],
  ['fault on fault soft', 'fault', 'fault-soft'],
  ['on-brand on brand', 'on-brand', 'brand'],
  ['on-brand on brand hover', 'on-brand', 'brand-hover'],
  ['on-brand on brand pressed', 'on-brand', 'brand-pressed'],
  ['on-accent on accent', 'on-accent', 'accent'],
  ['accent on accent soft', 'accent', 'accent-soft'],
  // Segmented thumbs and switch tracks: neutral selection, never the accent.
  ['on-select on select', 'on-select', 'select'],
  ['on-selection on selection', 'on-selection', 'selection'],
  ['silk on selection', 'silk', 'selection'],
  ['quiet title on deep', 'title-quiet', 'deep'],
  ['quiet title on mask', 'title-quiet', 'mask'],
  ['on-win-close on win-close', 'on-win-close', 'win-close'],
  ['on-tooltip on tooltip', 'on-tooltip', 'tooltip'],
  ['toast text on solid toast', 'toast-text', 'toast-fallback'],
  ['panel text on panel', 'panel-text', 'panel'],
  ['panel text on raised panel', 'panel-text', 'panel-raised'],
  ['panel muted on panel', 'panel-muted', 'panel'],
  ['panel muted on raised panel', 'panel-muted', 'panel-raised'],
  ['panel ink on panel', 'panel-ink', 'panel'],
  ['panel ink on raised panel', 'panel-ink', 'panel-raised'],
  ['signal on panel', 'panel-signal', 'panel'],
  ['signal on raised panel', 'panel-signal', 'panel-raised'],
  ['on-signal on signal', 'panel-on-signal', 'panel-signal'],
  ['panel text on signal soft', 'panel-text', 'panel-signal-soft'],
  ['panel fault on panel', 'panel-fault', 'panel'],
  ['panel fault on raised panel', 'panel-fault', 'panel-raised'],
  ...['silk', 'muted', 'faint'].flatMap((text) =>
    ['glass-solid-bar', 'glass-solid-panel', 'glass-solid-sheet'].map((surface) => [
      `${text} on ${surface}`,
      text,
      surface,
    ]),
  ),
];
// Non-text contrast (WCAG 1.4.11): control borders, idle diagram strokes, the
// focus ring and the live signal against idle edges. The signal step is also
// carried by stroke width, glow and an inverted node fill.
const nonTextPairs = [
  ['strong line on deep', 'strong-line', 'deep'],
  ['strong line on solid', 'strong-line', 'solid'],
  ['focus on deep', 'focus', 'deep'],
  ['focus on mask', 'focus', 'mask'],
  ['panel ring on panel', 'panel-ring', 'panel'],
  ['panel ink on panel', 'panel-ink', 'panel'],
  ['signal against idle edge', 'panel-signal', 'panel-ink'],
];
// The Space chip on Play is painted with `color-mix(currentColor N%, transparent)`
// over the brand capsule; read N from the built rule so the audit follows it.
const playChipShare = (() => {
  for (const rule of styleRules(builtCss)) {
    if (rule.conditions.length || !rule.expanded.includes('.play-button kbd')) continue;
    for (const declaration of rule.declarations) {
      if (!/^background(?:-color)?$/.test(declaration.property)) continue;
      const share = declaration.value.match(
        /^color-mix\(in srgb,\s*currentcolor\s+([\d.]+)%,\s*(?:transparent|#0000|#00000000)\)$/i,
      );
      assert.ok(
        share,
        'The Play kbd chip must stay a currentColor wash the audit can read: ' + declaration.value,
      );
      return Number(share[1]) / 100;
    }
  }
  assert.fail('No top-level .play-button kbd background found in the built CSS.');
})();
const contrasts = {};
let contrastPassed = true;
const failures = [];
const audit = (label, ratio, minimum) => {
  if (ratio < minimum) {
    contrastPassed = false;
    failures.push(`${label}: ${rounded(ratio)} < ${minimum}`);
  }
};
for (const [name, palette] of Object.entries(palettes)) {
  for (const token of [...tokenNames, ...plateTokens, ...solidGlassTokens]) {
    assert.equal(
      color(palette, token),
      color(sourcePalettes[name], token),
      'Stale built ' + name + ' theme token: ' + token,
    );
  }
  for (const token of glassTokens) {
    assert.ok(
      sameColor(paint(palette, token), paint(sourcePalettes[name], token)),
      'Stale built ' + name + ' theme token: ' + token,
    );
  }
  for (const token of nativeHexTokens) {
    assert.match(
      sourcePalettes[name]['--' + token],
      /^#[\da-f]{6}$/i,
      'Native appearance tests read --' + token + ' as plain six-digit hex in src/reference.css.',
    );
    assert.match(
      palette['--' + token],
      /^#(?:[\da-f]{3}|[\da-f]{6})$/i,
      'Built --' + token + ' must stay plain hex for the native appearance tests.',
    );
  }
  for (const token of nativeSixDigitTokens) {
    assert.match(
      palette['--' + token],
      /^#[\da-f]{6}$/i,
      'Built --' + token + ' must stay six-digit hex for the native scrollbar check.',
    );
  }
  assert.ok(
    paint(palette, 'frame-tint').alpha >= 0.6,
    'The ' + name + ' frame tint must keep at least 60% opacity over Mica.',
  );
  assert.ok(
    palette['--display']?.includes('Inter Variable'),
    'Inter Variable must lead the built ' + name + ' --display stack.',
  );
  assert.ok(
    palette['--mono']?.includes('IBM Plex Mono'),
    'IBM Plex Mono is missing from the built ' + name + ' --mono stack.',
  );
  assert.ok(
    !palette['--display'].includes('IBM Plex Sans'),
    'IBM Plex Sans was replaced by Inter Variable; remove it from --display.',
  );
  // The static field paints inside the band the shader clamp guarantees, so
  // the clamp backdrop below is the worst case for both field modes.
  for (const token of ['field-0', 'field-1']) {
    const level = luminance(color(palette, token));
    if (name === 'dark')
      assert.ok(level <= fieldClamp.dark.max, `Dark --${token} is brighter than the field clamp.`);
    else
      assert.ok(level >= fieldClamp.light.min, `Light --${token} is darker than the field clamp.`);
  }
  const surfaces = Object.fromEntries(
    ['mask', 'deep', 'solid', 'hover', 'selected', 'active'].map((token) => [
      token,
      color(palette, token),
    ]),
  );
  const text = {};
  for (const foreground of ['silk', 'muted', 'faint', 'brand', 'accent']) {
    text[foreground] = Object.fromEntries(
      Object.entries(surfaces).flatMap(([surface, background]) => {
        // Night --faint is 4.61 on --active: faint text never sits on the
        // pressed surface (DESIGN.md), so that one pair is not a text pair.
        if (foreground === 'faint' && surface === 'active') return [];
        const ratio = contrast(color(palette, foreground), background);
        audit(`${name} ${foreground} on ${surface}`, ratio, 4.5);
        return [[surface, rounded(ratio)]];
      }),
    );
  }
  // Pearl's PlayStation blue #0070D1 is the plate signal and glow only: as text
  // it reaches only 4.27 on --mask. Text and the primary capsule use #0062BB.
  for (const foreground of [
    'silk',
    'muted',
    'faint',
    'brand',
    'accent',
    'toast-text',
    'title-quiet',
    'on-select',
    'on-selection',
  ])
    assert.notEqual(
      color(palette, foreground),
      '#0070d1',
      `--${foreground} must not be #0070D1: that blue is not a text colour on ${name} surfaces.`,
    );
  // The round transport and icon keys: --circle-ink on both gradient stops.
  const circle = {};
  const stops = [
    ...(palette['--circle-fill'] ?? '').matchAll(/#(?:[\da-f]{6}|[\da-f]{3})\b/gi),
  ].map((match) => hex(parseColor(match[0]).rgb));
  assert.ok(stops.length >= 2, `--circle-fill must be a gradient between hex stops in ${name}.`);
  for (const stop of stops) {
    const ratio = contrast(color(palette, 'circle-ink'), stop);
    audit(`${name} circle ink on ${stop}`, ratio, 4.5);
    circle[stop] = rounded(ratio);
  }
  // The Space chip on Play: a currentColor (on-brand) wash over the capsule,
  // at rest and on hover.
  const chip = {};
  for (const background of ['brand', 'brand-hover']) {
    const wash = { rgb: parseColor(color(palette, 'on-brand')).rgb, alpha: playChipShare };
    const surface = hex(over(wash, parseColor(color(palette, background))).rgb);
    const ratio = contrast(color(palette, 'on-brand'), surface);
    audit(`${name} Play kbd chip on ${background}`, ratio, 4.5);
    chip[background] = { surface, ratio: rounded(ratio) };
  }
  const measureGlass = (pairs, backdrops) =>
    Object.fromEntries(
      pairs.map(([label, foreground, layers]) => {
        const front = color(palette, foreground),
          glassLayers = layers.map((layer) => paint(palette, layer));
        const results = Object.fromEntries(
          Object.entries(backdrops).map(([backdrop, layers]) => {
            const [base, ...under] = layers;
            const result = composite(front, [...under, ...glassLayers], base);
            return [backdrop, { surface: result.surface, ratio: rounded(result.ratio) }];
          }),
        );
        const worst = Math.min(...Object.values(results).map((result) => result.ratio));
        audit(`${name} ${label}`, worst, 4.5);
        return [label, { foreground: front, over: results, worst }];
      }),
    );
  // Backdrops are [opaque base, ...translucent layers above it].
  const overField = measureGlass(fieldGlassPairs, {
    clampedField: [clampBackdrop[name]],
    staticField: [color(palette, name === 'dark' ? 'field-1' : 'field-0')],
    micaFallback: [worstWallpaper[name], paint(palette, 'frame-tint')],
  });
  const floating = measureGlass(floatingGlassPairs, {
    black: [extremes.black],
    white: [extremes.white],
  });
  const opaque = Object.fromEntries(
    opaquePairs.map(([label, foreground, background]) => {
      const ratio = contrast(color(palette, foreground), color(palette, background));
      audit(`${name} ${label}`, ratio, 4.5);
      return [label, rounded(ratio)];
    }),
  );
  const nonText = Object.fromEntries(
    nonTextPairs.map(([label, foreground, background]) => {
      const ratio = contrast(color(palette, foreground), color(palette, background));
      audit(`${name} ${label} (non-text)`, ratio, 3);
      return [label, rounded(ratio)];
    }),
  );
  contrasts[name] = {
    surfaces,
    text,
    primaryButton: {
      text: color(palette, 'on-brand'),
      background: color(palette, 'brand'),
      ratio: opaque['on-brand on brand'],
      hoverRatio: opaque['on-brand on brand hover'],
      pressedRatio: opaque['on-brand on brand pressed'],
      kbdChip: chip,
    },
    circleKeys: { ink: color(palette, 'circle-ink'), stops: circle },
    overField: { backdrops: { clampedField: clampBackdrop[name] }, pairs: overField },
    floating,
    opaque,
    nonText,
  };
}
// The plate is themed: every plate token is defined (and opaque, via color())
// in both themes, and differs between them, so no Lumen leftover survives in
// one theme. Both plates pass the plate pairs audited above.
for (const token of plateTokens)
  assert.notEqual(
    color(palettes.light, token),
    color(palettes.dark, token),
    `The instrument plate is themed: --${token} must differ between Night and Pearl.`,
  );
// Pearl's plate is tight: #0070D1 is 4.58 on #F5F6F9 and 3.22 against the idle
// ink. A lighter idle ink or a darker plate would break those pairs.
assert.ok(
  luminance(color(palettes.light, 'panel-ink')) <= 0.0207,
  'Pearl --panel-ink must keep relative luminance at or below 0.0207.',
);
assert.ok(
  luminance(color(palettes.light, 'panel')) >= luminance('#f5f6f9'),
  'The Pearl plate must be no darker than #F5F6F9.',
);

// Backdrop filters: an exact allow-list. The bar, sidebar and docked sheet sit
// over the field only; the toast, scrolled Machines heading and tape frost
// float over content. Each uses a --*-filter token, is painted with an audited
// glass token and turns off in every opaque mode. Every built stylesheet is
// scanned, including chunks Vite links at runtime (the theme wave's CSS), and
// the inline launch CSS may not blur at all.
const cssPaths = [...contents.keys()].filter((path) => path.endsWith('.css'));
for (const path of cssPaths)
  assert.ok(
    stylePaths.includes(path) || !rootDeclarations(contents.get(path).toString()).dark['--mask'],
    'Theme tokens must live in the linked stylesheet, not a lazy chunk: ' + relative(dist, path),
  );
const allCss = [
  builtCss,
  ...cssPaths
    .filter((path) => !stylePaths.includes(path))
    .map((path) => contents.get(path).toString()),
].join('\n');
const rules = styleRules(allCss);
const compound = (selector) => {
  let depth = 0;
  for (let index = selector.length - 1; index >= 0; index--) {
    const character = selector[index];
    if (character === ')' || character === ']') depth++;
    else if (character === '(' || character === '[') depth--;
    else if (!depth && /[ >+~]/.test(character)) return selector.slice(index + 1);
  }
  return selector;
};
const parts = (selector) =>
  compound(selector).match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?|^[a-z]+|\*/g) ?? [];
const glassSurfaces = [
  {
    name: 'title bar',
    kind: 'bar',
    element: ['.titlebar'],
    background: 'glass-bar',
    overField: true,
  },
  {
    name: 'sidebar',
    kind: 'sidebar',
    element: ['#rail', '.rail'],
    background: 'glass-sidebar',
    overField: true,
  },
  {
    name: 'docked sheet',
    kind: 'sheet',
    element: ['#drawer', '.drawer'],
    state: ['[data-mode=docked]'],
    background: 'glass-sheet',
    overField: true,
  },
  { name: 'toast', kind: 'float', element: ['#toast'], background: 'toast-glass' },
  {
    name: 'scrolled Machines heading',
    element: ['.view-heading'],
    state: ['[data-scrolled]'],
    ancestor: '.library',
    background: 'scroll-glass',
  },
  {
    name: 'tape overflow',
    element: ['.tape-overflow'],
    pseudo: ':after',
    background: 'frost',
  },
];
// Does `selector` style this surface? `strict` also requires the surface's
// state (docked, scrolled), so an overlay drawer can never be allow-listed.
function reaches(selector, surface, strict) {
  const own = parts(selector);
  const pseudo = own.find((part) => part.startsWith(':') && /^::?(before|after)$/.test(part));
  if ((pseudo ?? null) !== (surface.pseudo ?? null)) return false;
  const rest = own.filter((part) => part !== pseudo);
  if (!strict && rest.length === 1 && rest[0] === '*') return true;
  if (
    !strict &&
    surface.kind &&
    rest.some((part) => part === '[data-glass]' || part === `[data-glass=${surface.kind}]`)
  )
    return true;
  if (!own.some((part) => surface.element.includes(part))) return false;
  if (strict && surface.state && !surface.state.every((part) => own.includes(part))) return false;
  if (strict && surface.ancestor && !selector.includes(surface.ancestor + ' ')) return false;
  return true;
}
const resetModes = [
  ['reduced transparency', (selector) => selector.includes('.reduced-transparency')],
  ['low quality', (selector) => selector.includes('[data-quality=low]')],
  ['high contrast', (selector) => selector.includes('.high-contrast')],
  ['screenshot capture', (selector) => selector.includes('[data-capture]')],
  [
    'prefers-reduced-transparency',
    (_, conditions) =>
      conditions.some((condition) => condition.includes('prefers-reduced-transparency:reduce')),
  ],
  [
    'forced colors',
    (_, conditions) => conditions.some((condition) => condition.includes('forced-colors:active')),
  ],
];
const isFilter = (property) =>
  property === 'backdrop-filter' || property === '-webkit-backdrop-filter';
const blurs = [];
for (const rule of rules) {
  for (const declaration of rule.declarations) {
    if (!isFilter(declaration.property) || declaration.value === 'none') continue;
    for (const selector of rule.expanded) {
      const surface = glassSurfaces.find((candidate) => reaches(selector, candidate, true));
      assert.ok(
        surface,
        'Backdrop filters are limited to the title bar, sidebar, docked sheet, toast, scrolled Machines heading and tape overflow: ' +
          selector,
      );
      const token = declaration.value.match(/^var\(--([\w-]*filter[\w-]*)\)$/);
      assert.ok(
        token,
        `The ${surface.name} backdrop filter must use a var(--*filter*) token: ${declaration.value}`,
      );
      for (const [theme, palette] of Object.entries(palettes)) {
        const value = palette['--' + token[1]];
        assert.ok(value, `Missing ${theme} backdrop filter token: --${token[1]}`);
        assert.ok(!/url\(/i.test(value), `--${token[1]} must not reference an SVG filter.`);
        const radii = [...value.matchAll(/blur\(\s*([\d.]+)px\s*\)/g)].map((match) =>
          Number(match[1]),
        );
        assert.equal(radii.length, 1, `--${token[1]} must contain exactly one px blur().`);
        assert.ok(radii[0] > 0 && radii[0] <= 20, `--${token[1]} blur must be 20px or less.`);
        if (declaration.property === 'backdrop-filter')
          blurs.push({
            theme,
            surface: surface.name,
            selector,
            token: '--' + token[1],
            value,
            blurPx: radii[0],
          });
      }
    }
  }
}
assert.deepEqual(
  [...new Set(blurs.map((blur) => blur.surface))].sort(),
  glassSurfaces.map((surface) => surface.name).sort(),
  'Exactly the six allow-listed surfaces blur their backdrop.',
);
// The launch stage is inline in index.html: no blur, hidden in screenshots and
// under forced colours, and painted on the theme mask so frame 0 cannot flash.
const launchCss = html.match(
  /<style\b[^>]*\bid=["']?launch-css["']?[^>]*>([\s\S]*?)<\/style>/i,
)?.[1];
assert.ok(launchCss, 'index.html must inline the launch CSS as <style id="launch-css">.');
assert.ok(
  !/backdrop-filter\s*:\s*(?!none\b)/i.test(launchCss),
  'The launch stage must not use backdrop-filter.',
);
assert.match(
  launchCss,
  /html\[data-capture\]\s*\.launch[^{]*{[^}]*display\s*:\s*none/i,
  'html[data-capture] must hide the launch stage.',
);
assert.match(
  launchCss,
  /@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*{[^{}]*\.launch[^{}]*{[^}]*display\s*:\s*none/i,
  'Forced colours must hide the launch stage.',
);
const body = html.slice(html.search(/<body\b/i));
assert.ok(
  /<body\b[^>]*>\s*<div\b[^>]*\bclass=["']?launch\b/i.test(body) &&
    body.search(/\bclass=["']?launch\b/) < body.search(/\bid=["']?app\b/),
  'The launch stage must be the first body child, before #app.',
);
assert.match(
  html,
  /<meta\b[^>]*name=["']?theme-color["']?[^>]*content=["']?#0c0d0d/i,
  'index.html must declare the Night mask (#0C0D0D) as its theme-color.',
);
const resets = (surface, matches) =>
  rules.some(
    (rule) =>
      rule.declarations.some(
        (declaration) => declaration.property === 'backdrop-filter' && declaration.value === 'none',
      ) &&
      rule.expanded.some(
        (selector) => reaches(selector, surface, false) && matches(selector, rule.conditions),
      ),
  );
const paints = (rule, surface) =>
  rule.declarations.some(
    (declaration) =>
      (/^background(?:-color)?$/.test(declaration.property) ||
        declaration.property === '--g-fill') &&
      declaration.value.includes(`var(--${surface.background})`),
  );
for (const surface of glassSurfaces) {
  assert.ok(
    blurs.some((blur) => blur.surface === surface.name),
    `The ${surface.name} needs an unprefixed backdrop-filter; write only the unprefixed property and let Lightning CSS add the -webkit- copy.`,
  );
  assert.ok(
    rules.some(
      (rule) =>
        rule.expanded.some((selector) => reaches(selector, surface, false)) &&
        paints(rule, surface),
    ),
    `The ${surface.name} glass must be painted with the audited --${surface.background} token.`,
  );
  for (const [mode, matches] of resetModes)
    assert.ok(
      resets(surface, matches),
      `The ${surface.name} backdrop filter has no ${mode} reset to none.`,
    );
  // The shader draws frost, lens and luminance clamp under the over-field
  // glass while html[data-bg=webgl]; a CSS blur on top would double it.
  if (surface.overField)
    assert.ok(
      resets(surface, (selector) => selector.includes('[data-bg=webgl]')),
      `The ${surface.name} must drop its CSS backdrop filter while the WebGL field draws its frost.`,
    );
}
// Content never sits on glass: the Bench sheet and dock stay opaque.
for (const content of ['#sheet', '#dock'])
  for (const rule of rules)
    for (const selector of rule.expanded)
      if (parts(selector).includes(content) && !parts(selector).some((part) => /^:/.test(part)))
        for (const declaration of rule.declarations)
          assert.ok(
            !(isFilter(declaration.property) && declaration.value !== 'none'),
            `${content} is a content plate and must not blur its backdrop.`,
          );
// The window frame: Mica shows only through the body tint, and a screenshot
// always captures the opaque page color instead.
const declares = (selector, property, value) =>
  rules.some(
    (rule) =>
      !rule.conditions.length &&
      rule.expanded.includes(selector) &&
      rule.declarations.some(
        (declaration) =>
          property.test(declaration.property) &&
          (value instanceof RegExp ? value.test(declaration.value) : declaration.value === value),
      ),
  );
assert.ok(
  declares('html[data-backdrop=mica] body', /^background(?:-color)?$/, 'var(--frame-tint)'),
  'Under Mica, body must be painted with the audited --frame-tint.',
);
assert.ok(
  declares('html[data-backdrop=mica][data-capture] body', /^background(?:-color)?$/, 'var(--mask)'),
  'Screenshots must paint body with the opaque --mask while data-capture is set.',
);
// The field canvas: off paints nothing, static paints the CSS field, and a
// screenshot hides it so captures stay deterministic.
assert.ok(
  declares('html[data-bg=off] #field', /^display$/, 'none'),
  'html[data-bg=off] must hide the #field canvas.',
);
assert.ok(
  declares('html[data-bg=static] #field', /^background(?:-image)?$/, /var\(--field-static\)/),
  'html[data-bg=static] must paint #field with --field-static.',
);
assert.ok(
  declares('html[data-capture] #field', /^(?:visibility|display)$/, /^(?:hidden|none)$/),
  'html[data-capture] must hide the #field canvas.',
);
assert.ok(
  rules.some(
    (rule) =>
      rule.expanded.some((selector) => parts(selector).includes('#field')) &&
      rule.declarations.some(
        (declaration) => declaration.property === 'pointer-events' && declaration.value === 'none',
      ),
  ),
  'The #field canvas must never take pointer input.',
);
// Font faces, families and licences: Inter Variable for text, IBM Plex Mono
// for tape symbols and code, Newsreader 400 for large titles only. All three
// are local OFL fonts.
const faces = [...builtCss.matchAll(/@font-face\s*{([^}]*)}/g)].map((match) => match[1]);
for (const family of ['Inter Variable', 'IBM Plex Mono', 'Newsreader'])
  assert.ok(
    faces.some((face) => face.includes(family) && /url\(/.test(face)),
    `Missing local @font-face for ${family}.`,
  );
assert.ok(
  faces.some(
    (face) =>
      face.includes('Newsreader') &&
      /font-weight\s*:\s*400\b/.test(face) &&
      /font-display\s*:\s*block\b/.test(face),
  ),
  'Newsreader is a single 400 face with font-display: block, so titles never swap faces.',
);
for (const [name, palette] of Object.entries(palettes))
  assert.match(
    palette['--serif'] ?? '',
    /^["']?Newsreader["']?\s*,/,
    `Newsreader must lead the built ${name} --serif stack.`,
  );
assert.ok(!builtCss.includes('IBM Plex Sans'), 'IBM Plex Sans must not remain in the renderer.');
assert.ok(
  rules.some(
    (rule) =>
      !rule.conditions.length &&
      rule.expanded.some((selector) => ['body', 'html', ':root'].includes(selector)) &&
      rule.declarations.some(
        (declaration) =>
          /^font(?:-family)?$/.test(declaration.property) &&
          /var\(--display\)|Inter Variable/.test(declaration.value),
      ),
  ),
  'The document must set its font-family from var(--display).',
);
const licenses = {};
for (const name of ['Inter-OFL.txt', 'IBM-Plex-OFL.txt', 'Newsreader-OFL.txt']) {
  const path = join(dist, 'licenses', name),
    license = contents.get(path);
  assert.ok(license, `${name} is missing from dist/licenses.`);
  assert.ok(
    license.equals(await readFile(join(root, 'public/licenses', name))),
    `Built ${name} differs from its public source.`,
  );
  licenses[relative(dist, path).replaceAll('\\', '/')] = license.length;
}
const fontFiles = {};
for (const [file, family] of [
  ['inter-latin-wght-normal.woff2', 'Inter Variable'],
  ['ibm-plex-mono-latin-500.woff2', 'IBM Plex Mono'],
  ['newsreader-latin-400-normal.woff2', 'Newsreader'],
]) {
  const font = await readFile(join(root, 'src/fonts', file));
  assert.ok(
    [...contents].some(([path, data]) => path.endsWith('.woff2') && data.equals(font)),
    `The current local ${family} font is missing from the renderer.`,
  );
  fontFiles[family] = font.length;
}
for (const path of contents.keys())
  assert.ok(
    !/plex-sans/i.test(basename(path)),
    'The retired IBM Plex Sans font is still in the renderer: ' + path,
  );
// Colour lives in tokens: no rgb()/rgba()/hsl() literal outside src/reference.css,
// so both themes are complete and nothing keeps a Lumen value in one of them.
// The launch's vivid fields are literal by design and live in index.html.
const sourceCss = (await filesIn(join(root, 'src'))).filter(
  (path) => path.endsWith('.css') && basename(path) !== 'reference.css',
);
for (const path of sourceCss) {
  const source = (await readFile(path, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  const literal = source.match(/\b(?:rgba?|hsla?)\(\s*[\d.]/i);
  assert.ok(
    !literal,
    `Route colour through a reference.css token: ${relative(root, path).replaceAll('\\', '/')} has ${literal?.[0]}…`,
  );
}
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
// The React renderer measured 428 KB after migration and 478 KB with IBM Plex.
// The 150 KB compressed-JavaScript limit is unchanged. The total was 512 KB;
// it is raised once, to 544 KB, for the Lumen redesign: WebGL2 field renderer
// and Inter Variable replace Plex Sans; no 3D library (three measured ~1 MB);
// measured sizes in artifacts/bundle-report.json.
// Raised 2026-10-30 for the Night & Pearl themes: Newsreader 400 latin
// (22,480 B woff2 + 4,520 B OFL) for the user-pinned serif display type; the
// theme wave (View Transition + compositor clip, ~8.4 KB) and the launch (inline
// CSS, no extra script) requested by the user; native-refresh pacing. No
// library added; JS gzip budget unchanged. The new total is the measured build
// plus 6 KB, rounded up to the next 1,000 bytes and capped at 600,000: the build
// measured 599,628 bytes (132,658 gzip JS), so the cap applies and leaves less
// than the intended 6 KB of headroom until bytes are cut. Do not
// raise it further without a new written justification here and in
// docs/verification.md.
const budgets = { javascriptGzip: 150000, totalUncompressed: 600000 };
const report = {
  version: manifest.version,
  javascriptGzip: js,
  cssGzip: css,
  fontsBytes: fonts,
  totalUncompressed: total,
  transferEstimate: js + css + fonts + other,
  budgets,
  headroom: {
    javascriptGzip: budgets.javascriptGzip - js,
    totalUncompressed: budgets.totalUncompressed - total,
  },
  font: {
    family: 'Inter Variable',
    mono: 'IBM Plex Mono 500',
    serif: 'Newsreader 400 (large titles only)',
    local: true,
    files: fontFiles,
    licenses,
  },
  appearance:
    'Night & Pearl: one workbench in two complete themes. Night (default) is near-black with sage charcoal cards and a pistachio live signal; Pearl is a luminous off-white with PlayStation blue and black ink. A hand-written WebGL2 field (html[data-bg=webgl]) or its static CSS gradient (data-bg=static) sits behind Liquid Glass-inspired chrome: the title bar, sidebar and docked sheet, whose frost, lens and luminance clamp the shader draws. Content plates (sheet, dock, editor, cards) and the themed instrument plate stay opaque. Reduced transparency, high contrast, low quality and screenshots make every glass surface solid; data-bg=off removes the field. The launch stage is inline in index.html and hidden in screenshots.',
  launchInlineCssBytes: Buffer.byteLength(launchCss),
  backdropFilters: blurs,
  contrastAudit: {
    method:
      'WCAG relative luminance on settled built CSS tokens, in both themes. Opaque surfaces, the themed instrument plate, actions, neutral selection, the round keys (ink on both gradient stops), the Play kbd chip at rest and on hover, and status colors are measured directly; Pearl #0070D1 is never a text token; non-text strokes need 3:1. Glass over the field (title bar, sidebar) is alpha-composited over the shader luminance clamp, the static field and the frame tint over the worst wallpaper; floating glass (docked sheet, toast, scrolled heading, frame) over pure black and pure white. The worse ratio is reported. Text colors are opaque. tests/native-appearance.mjs also measures the rendered pixels behind title bar and sidebar labels. Excludes disabled controls, transient animation and the aria-hidden tape overflow cells under frost.',
    minimumTextRatio: 4.5,
    minimumNonTextRatio: 3,
    failures,
    ...contrasts,
  },
  passed: js <= budgets.javascriptGzip && total <= budgets.totalUncompressed && contrastPassed,
};
await mkdir(join(root, 'artifacts'), { recursive: true });
await writeFile(join(root, 'artifacts/bundle-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
