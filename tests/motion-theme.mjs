import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

// Set PATCHBAY_TEST_URL to exercise Vite source. Without it, the same checks
// serve the built dist output, including its local bundled font and JS.
const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const artifacts = resolve(process.env.PATCHBAY_TEST_ARTIFACT_DIR || resolve(root, 'artifacts'));
let server;
let base = process.env.PATCHBAY_TEST_URL?.replace(/\/$/, '');
if (!base) {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream'));
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
}
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], external = [], checks = [], images = [];

async function newPage(width) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  await context.addInitScript(() => {
    localStorage.clear();
    window.__motionCalls = [];
    window.__ambientDrawCalls = 0;
    window.__freezeRaf = false;
    window.__queuedRaf = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      window.__motionCalls.push({ id: this.id, className: String(this.className), frames, options });
      return animate.call(this, frames, options);
    };
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => requestFrame(time => {
      if (window.__freezeRaf) window.__queuedRaf.push(callback);
      else callback(time);
    });
    window.__resumeRaf = () => {
      window.__freezeRaf = false;
      for (const callback of window.__queuedRaf.splice(0)) requestFrame(callback);
    };
    for (const name of ['clearRect', 'fillRect', 'drawImage', 'stroke', 'fill']) {
      const method = CanvasRenderingContext2D.prototype[name];
      CanvasRenderingContext2D.prototype[name] = function (...args) {
        if (this.canvas.id === 'board' || this.canvas.id === 'frost') window.__ambientDrawCalls++;
        return method.apply(this, args);
      };
    }
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) external.push(request.url()); });
  await page.goto(base + '/');
  await page.locator('#app[data-ready="true"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  await page.locator('#diagram[data-building="false"]').waitFor();
  return { page, context };
}

async function settle(page) {
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' && animation.playState !== 'pending'));
  await page.waitForFunction(() => document.body.dataset.themeTransition !== 'running');
}

async function closeDrawer(page) {
  if (await page.locator('#drawer').evaluate(drawer => drawer.open)) {
    await page.locator('#close-drawer').click();
    await page.waitForFunction(() => !document.querySelector('#drawer').open);
    await settle(page);
  }
}

async function screenshot(page, name) {
  const file = resolve(artifacts, name);
  const png = await page.screenshot({ path: file, animations: 'allow' });
  images.push(file);
  return decodePng(png);
}

// Decode actual screenshot pixels with Node's built-in zlib, avoiding another
// image dependency. Chromium screenshots use 8-bit RGB/RGBA PNG scanlines.
function decodePng(png) {
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  let width, height, channels;
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8, '8-bit screenshot PNG');
      assert.ok(data[9] === 2 || data[9] === 6, 'RGB or RGBA screenshot PNG');
      channels = data[9] === 6 ? 4 : 3;
      assert.equal(data[12], 0, 'Non-interlaced screenshot PNG');
    }
    if (type === 'IDAT') chunks.push(data);
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
  let source = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[source++];
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= channels ? pixels[index - channels] : 0;
      const up = y ? pixels[index - stride] : 0;
      const diagonal = y && x >= channels ? pixels[index - stride - channels] : 0;
      const prediction = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, diagonal)][filter];
      assert.notEqual(prediction, undefined, 'Supported PNG scanline filter');
      pixels[index] = (raw[source++] + prediction) & 255;
    }
  }
  return { width, height, pixel: (x, y) => Array.from(pixels.subarray((Math.floor(y) * width + Math.floor(x)) * channels, (Math.floor(y) * width + Math.floor(x)) * channels + 3)) };
}

function pointsInText(image, rect) {
  const points = [];
  for (let y = Math.max(0, Math.ceil(rect.y)); y < Math.min(image.height, Math.floor(rect.y + rect.height)); y++) {
    for (let x = Math.max(0, Math.ceil(rect.x)); x < Math.min(image.width, Math.floor(rect.x + rect.width)); x++) {
      // Thin rounded body letters are antialiased. Keep ink distinguishable
      // from the 244/255 surface without requiring a fully covered glyph.
      if (Math.max(...image.pixel(x, y)) < 180) points.push({ x, y });
    }
  }
  return points;
}

function equalPixel(actual, expected, tolerance = 3) { return actual.every((value, channel) => Math.abs(value - expected[channel]) <= tolerance); }

async function entryEvidence(page, target, direction) {
  await page.waitForFunction(id => window.__motionCalls.some(call => call.id === id && Array.isArray(call.frames) && call.frames[0]?.opacity === 0 && call.frames[0]?.transform), target);
  const evidence = await page.evaluate(id => {
    const call = window.__motionCalls.find(call => call.id === id && Array.isArray(call.frames) && call.frames[0]?.opacity === 0 && call.frames[0]?.transform);
    const matrix = new DOMMatrix(call.frames[0].transform);
    return { x: matrix.m41, y: matrix.m42, startFilter: call.frames[0].filter || 'none', endFilter: call.frames.at(-1).filter || 'none', duration: call.options.duration };
  }, target);
  if (direction === 'left') { assert.ok(evidence.x < -10, `${target} enters from left`); assert.equal(evidence.y, 0); }
  else { assert.ok(evidence.y > 10, `${target} enters from bottom`); assert.equal(evidence.x, 0); }
  assert.match(evidence.startFilter, /blur\([1-9][\d.]*px\)/, 'Entry has transient blur');
  assert.equal(evidence.endFilter, 'none', 'Entry ends clear');
  return evidence;
}

async function clearFinalStyle(page, selector) {
  await settle(page);
  const style = await page.locator(selector).evaluate(element => ({ filter: getComputedStyle(element).filter, willChange: element.style.willChange, opacity: getComputedStyle(element).opacity }));
  assert.equal(style.filter, 'none', `${selector} has no persistent blur`);
  assert.equal(style.willChange, '', `${selector} releases compositor hint`);
  assert.equal(style.opacity, '1', `${selector} returns to readable opacity`);
}

async function committedControls(page) {
  const state = await page.evaluate(() => {
    const root = document.documentElement, palette = getComputedStyle(root);
    const rgb = name => {
      const token = palette.getPropertyValue(name).trim().slice(1);
      // The built CSS minifier shortens #000000/#ffffff to three digits.
      const hex = token.length === 3 ? [...token].map(channel => channel + channel).join('') : token;
      return `rgb(${[0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
    };
    const play = getComputedStyle(document.querySelector('#play'));
    return {
      theme: root.dataset.theme,
      playBackground: play.backgroundColor, expectedBackground: rgb('--brand'),
      playText: play.color, expectedText: rgb('--deep'),
      settingText: getComputedStyle(document.querySelector('#theme-setting')).color, expectedSettingText: rgb('--silk'),
      label: document.querySelector('#theme-label').textContent,
      pressed: document.querySelector('#theme-toggle').getAttribute('aria-pressed'),
      commitClass: root.classList.contains('theme-committing'),
    };
  });
  assert.equal(state.playBackground, state.expectedBackground, 'Filled button background commits immediately with the palette');
  assert.equal(state.playText, state.expectedText, 'Filled button text commits immediately with the palette');
  assert.equal(state.settingText, state.expectedSettingText, 'Settings button text commits immediately with the palette');
  assert.equal(state.label, state.theme === 'dark' ? 'Light theme' : 'Dark theme', 'Theme label describes the next action');
  assert.equal(state.pressed, String(state.theme === 'dark'), 'Header toggle reflects the committed theme');
  assert.equal(state.commitClass, false, 'Temporary commit class is removed');
  return state;
}

async function assertIdle(page) {
  await settle(page);
  const before = await page.evaluate(() => window.__ambientDrawCalls);
  await page.waitForTimeout(250);
  const idle = await page.evaluate(() => ({
    ambientDraws: window.__ambientDrawCalls,
    visibleAmbient: [...document.querySelectorAll('#board,#frost')].filter(canvas => getComputedStyle(canvas).display !== 'none').length,
    masks: document.querySelectorAll('[data-theme-wave-layer]').length,
    uiAnimations: document.getAnimations().filter(animation => {
      const target = animation.effect?.target;
      return target instanceof Element && !target.matches('.diagram-node,.diagram-edge-label,.graph-node,.graph-edge-label') && animation.playState === 'running';
    }).length,
  }));
  assert.equal(idle.ambientDraws, before, 'Idle does not draw ambient canvases');
  assert.equal(idle.ambientDraws, 0, 'Ambient board/frost runtime is absent');
  assert.equal(idle.visibleAmbient, 0, 'No visible ambient canvases');
  assert.equal(idle.masks, 0, 'Temporary wave masks are released');
  assert.equal(idle.uiAnimations, 0, 'UI motion ends at idle');
  return idle;
}

try {
  for (const [width, direction] of [[1440, 'left'], [360, 'bottom']]) {
    const { page, context } = await newPage(width);
    await page.evaluate(() => { window.__motionCalls.length = 0; });
    await page.locator('[data-route="machines"]').click();
    const pageEntry = await entryEvidence(page, 'view-machines', direction);
    await page.waitForTimeout(160);
    await screenshot(page, `motion-${width}-page-enter.png`);
    await clearFinalStyle(page, '#view-machines');
    await page.evaluate(() => { window.__motionCalls.length = 0; });
    await page.locator('[data-route="settings"]').click();
    const drawerEntry = await entryEvidence(page, 'drawer', direction);
    await clearFinalStyle(page, '#drawer');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px has no horizontal overflow`);
    await closeDrawer(page);
    checks.push({ width, direction, pageEntry, drawerEntry, idle: await assertIdle(page) });
    await context.close();
  }

  const { page, context } = await newPage(1440);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'Default light theme');
  assert.equal(await page.evaluate(() => document.fonts.check('800 14px "Nunito Variable"')), true, 'Bundled rounded font is loaded');
  const regions = await page.evaluate(() => Object.fromEntries(['near', 'far'].map((name, index) => {
    const range = document.createRange();range.selectNodeContents(document.querySelector(index ? '.wordmark' : '.local-chip'));
    const rect = range.getBoundingClientRect();
    return [name, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
  })));
  const initial = await screenshot(page, 'motion-theme-light.png');
  const nearText = pointsInText(initial, regions.near), farText = pointsInText(initial, regions.far);
  assert.ok(nearText.length >= 50 && farText.length >= 200, 'Screenshot contains measurable near and far letter pixels');
  await page.locator('#theme-toggle').click();
  await page.waitForFunction(regions => {
    const canvas = document.querySelector('#theme-wave');
    if (!canvas || document.body.dataset.themeTransition !== 'running') return false;
    const context = canvas.getContext('2d'), ratio = canvas.width / innerWidth;
    const alpha = rect => context.getImageData(Math.floor((rect.x + rect.width / 2) * ratio), Math.floor((rect.y + rect.height / 2) * ratio), 1, 1).data[3];
    return alpha(regions.near) > 250 && alpha(regions.far) === 0;
  }, regions);
  await page.evaluate(() => { window.__freezeRaf = true; });
  await page.waitForTimeout(40);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'Palette is not committed while a spatial mask is running');
  const samples = await page.evaluate(({ nearText, farText }) => {
    const canvas = document.querySelector('#theme-wave'), context = canvas.getContext('2d');
    const ratio = canvas.width / innerWidth, pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const alpha = point => pixels[(Math.floor(point.y * ratio) * canvas.width + Math.floor(point.x * ratio)) * 4 + 3];
    const edge = [];
    for (let y = 45; y < innerHeight - 20; y += 3) for (let x = 10; x < innerWidth - 10; x += 3) {
      const a = alpha({ x, y });
      if (a >= 32 && a <= 224) edge.push({ x, y, alpha: a });
    }
    return { near: nearText.map(point => ({ ...point, alpha: alpha(point) })), far: farText.map(point => ({ ...point, alpha: alpha(point) })), edge };
  }, { nearText, farText });
  const intermediate = await screenshot(page, 'motion-theme-intermediate.png');
  const near = samples.near.filter(point => point.alpha >= 250), far = samples.far.filter(point => point.alpha === 0);
  const inverted = near.filter(point => equalPixel(intermediate.pixel(point.x, point.y), initial.pixel(point.x, point.y).map(value => 255 - value))).length;
  const preserved = far.filter(point => equalPixel(intermediate.pixel(point.x, point.y), initial.pixel(point.x, point.y))).length;
  assert.ok(near.length >= 50 && inverted / near.length > .95, 'Covered letter pixels become their inverse');
  assert.ok(far.length >= 200 && preserved / far.length > .95, `Distant letter pixels retain their original color (${preserved}/${far.length})`);
  const edge = samples.edge.filter(point => { const pixel = initial.pixel(point.x, point.y); return Math.max(...pixel) - Math.min(...pixel) <= 1 && Math.min(...pixel) >= 239; });
  const graded = edge.filter(point => {
    const alpha = point.alpha / 255, expected = initial.pixel(point.x, point.y).map(value => value + alpha * (255 - 2 * value));
    return equalPixel(intermediate.pixel(point.x, point.y), expected, 4);
  }).length;
  assert.ok(edge.length >= 30 && graded / edge.length > .9, 'The moving edge passes through measured gray pixels');
  await page.evaluate(() => window.__resumeRaf());
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.body.dataset.themeTransition === 'idle');
  const darkControls = await committedControls(page);
  await screenshot(page, 'motion-theme-dark.png');
  assert.equal(await page.locator('[data-theme-wave-layer]').count(), 0, 'Wave backing stores are released after commit');
  checks.push({ spatialTheme: { coveredLetterPixels: near.length, inverseMatches: inverted, untouchedLetterPixels: far.length, unchangedMatches: preserved, grayEdgePixels: edge.length, grayMatches: graded }, darkControls });

  // A second toggle while a wave is active represents a newer user intent.
  await page.locator('#theme-toggle').click();
  await page.waitForFunction(() => document.body.dataset.themeTransition === 'running');
  await page.locator('#theme-toggle').evaluate(button => button.click());
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.body.dataset.themeTransition === 'idle');
  checks.push({ rapidTheme: 'Latest intent returns to dark; no stale commit' });

  await page.locator('[data-route="settings"]').click();
  await settle(page);
  const themeControl = page.locator('#theme-setting');
  const controlKind = await themeControl.evaluate(element => element.tagName);
  if (controlKind === 'SELECT') await themeControl.selectOption('light');
  else await themeControl.click();
  await page.waitForFunction(() => document.body.dataset.themeTransition === 'running' && document.querySelector('#drawer [data-theme-wave-layer="dialog"]'));
  await page.locator('#drawer').evaluate(drawer => { drawer.scrollTop = 120; });
  await page.waitForTimeout(40);
  const modal = await page.evaluate(() => {
    const drawer = document.querySelector('#drawer'), mask = drawer.querySelector('[data-theme-wave-layer="dialog"]');
    const rect = drawer.getBoundingClientRect(), layer = mask.getBoundingClientRect();
    return { scrollTop: drawer.scrollTop, scrollHeight: drawer.scrollHeight, clientHeight: drawer.clientHeight, x: layer.x, y: layer.y, width: layer.width, height: layer.height, expectedX: rect.x + drawer.clientLeft, expectedY: rect.y + drawer.clientTop, clientWidth: drawer.clientWidth };
  });
  assert.ok(Math.abs(modal.x - modal.expectedX) < 1 && Math.abs(modal.y - modal.expectedY) < 1, 'Modal mask stays aligned while the drawer scrolls');
  assert.equal(modal.width, modal.clientWidth, 'Modal mask covers visible client width');
  assert.equal(modal.height, modal.clientHeight, 'Modal mask covers visible client height');
  await screenshot(page, 'motion-theme-dialog-intermediate.png');
  const outsidePoints = [];
  for (let y = 50; y <= 300; y += 25) for (let x = 600; x <= 900; x += 25) outsidePoints.push({ x, y });
  await page.waitForFunction(points => {
    const canvas = document.querySelector('#theme-wave');
    if (!canvas || document.body.dataset.themeTransition !== 'running') return false;
    const context = canvas.getContext('2d'), ratio = canvas.width / innerWidth;
    return points.every(point => context.getImageData(Math.floor(point.x * ratio), Math.floor(point.y * ratio), 1, 1).data[3] === 255);
  }, outsidePoints);
  await page.evaluate(() => { window.__freezeRaf = true; });
  await page.waitForTimeout(40);
  const coveredDialog = await screenshot(page, 'motion-theme-dialog-covered.png');
  const coveredScene = await page.locator('#depth-canvas').evaluate(canvas => ({draws:canvas.dataset.draws,motion:canvas.dataset.motion}));
  await page.evaluate(() => window.__resumeRaf());
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light' && document.body.dataset.themeTransition === 'idle');
  const lightControls = await committedControls(page);
  assert.equal(await themeControl.evaluate(element => element instanceof HTMLSelectElement ? element.value : element instanceof HTMLInputElement ? element.checked : element.getAttribute('aria-pressed')), controlKind === 'SELECT' ? 'light' : controlKind === 'INPUT' ? false : 'false', 'Settings control reflects committed light theme');
  const committedDialog = await screenshot(page, 'motion-theme-dialog-light.png');
  const continuousBackdrop = outsidePoints.filter(point => equalPixel(coveredDialog.pixel(point.x, point.y), committedDialog.pixel(point.x, point.y))).length;
  await writeFile(resolve(artifacts,'modal-scene-diagnostic.json'),JSON.stringify({continuousBackdrop,total:outsidePoints.length,coveredScene,committedScene:await page.locator('#depth-canvas').evaluate(canvas=>({draws:canvas.dataset.draws,motion:canvas.dataset.motion})),differences:outsidePoints.filter(point=>!equalPixel(coveredDialog.pixel(point.x,point.y),committedDialog.pixel(point.x,point.y))).slice(0,12).map(point=>({...point,before:coveredDialog.pixel(point.x,point.y),after:committedDialog.pixel(point.x,point.y)}))},null,2));
  assert.ok(continuousBackdrop / outsidePoints.length > .95, `Covered backdrop pixels remain continuous when the theme commits (${continuousBackdrop}/${outsidePoints.length})`);
  checks.push({ modalTheme: { ...modal, backdropPixels: outsidePoints.length, continuousBackdrop }, lightControls });
  await page.locator('#motion-blur').uncheck();
  await closeDrawer(page);
  await page.evaluate(() => { window.__motionCalls.length = 0; });
  await page.locator('[data-route="machines"]').click();
  await page.waitForFunction(() => window.__motionCalls.some(call => call.id === 'view-machines' && call.frames?.[0]?.transform));
  const blurDisabled = await page.evaluate(() => ({
    frames: window.__motionCalls.find(call => call.id === 'view-machines' && call.frames?.[0]?.opacity === 0).frames.map(frame => frame.filter || 'none'),
    actual: getComputedStyle(document.querySelector('#view-machines')).filter,
  }));
  assert.ok(blurDisabled.frames.every(filter => filter === 'none'), 'Optional blur can be disabled');
  assert.equal(blurDisabled.actual, 'none', 'Blur-disabled entry remains clear while moving');
  await clearFinalStyle(page, '#view-machines');
  checks.push({ blurDisabled });

  await page.evaluate(async () => {
    for (const route of ['machines', 'editor', 'bench', 'learn']) {
      document.querySelector(`[data-route="${route}"]`).click();
      await new Promise(done => setTimeout(done, 25));
    }
  });
  await page.locator('#view-learn').waitFor({ state: 'visible' });
  await clearFinalStyle(page, '#view-learn');
  assert.deepEqual(await page.locator('.view').evaluateAll(views => views.filter(view => !view.hidden).map(view => view.id)), ['view-learn'], 'Rapid navigation leaves only the latest view visible');
  checks.push({ rapidNavigation: 'Learn is the final readable view' });

  // Turning the OS preference on must cancel current UI motion and avoid the
  // theme mask, including when an entrance was already in progress.
  await page.locator('[data-route="machines"]').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settle(page);
  await page.evaluate(() => { window.__motionCalls.length = 0; });
  await page.locator('[data-route="bench"]').click();
  await page.locator('#view-bench').waitFor({ state: 'visible' });
  const reducedEntries = await page.evaluate(() => window.__motionCalls.filter(call => call.id.startsWith('view-') && call.frames?.[0]?.transform));
  assert.equal(reducedEntries.length, 0, 'Reduced motion skips page transforms');
  await clearFinalStyle(page, '#view-bench');
  const previousTheme = await page.locator('html').getAttribute('data-theme');
  await page.locator('#theme-toggle').click();
  assert.notEqual(await page.locator('html').getAttribute('data-theme'), previousTheme, 'Reduced motion commits theme immediately');
  assert.equal(await page.locator('[data-theme-wave-layer]').count(), 0, 'Reduced motion creates no wave layers');
  checks.push({ reducedMotion: 'Immediate theme and clear static page', idle: await assertIdle(page) });
  assert.deepEqual(errors, [], 'No browser runtime errors');
  assert.deepEqual(external, [], 'All runtime requests are local');
  await context.close();
  const report = { base, checks, images, errors, external };
  await writeFile(resolve(artifacts, 'motion-theme-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  if (server) await new Promise(done => server.close(done));
}
