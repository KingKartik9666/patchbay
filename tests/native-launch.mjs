// The launch (DESIGN.md › The launch) on the real debug app, in both window
// modes (run again with PATCHBAY_OPAQUE=1). Timings are read in the page from a
// probe added with Page.addScriptToEvaluateOnNewDocument and a reload, because
// the first document has started before CDP can attach; the reload runs the
// same Rust initialization script, so the launch mode is unchanged.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  launchNative,
  artifacts,
  root,
  runSuffix,
  instantTheme,
  screencast,
} from './helpers/native.mjs';
import { decodePng } from './helpers/png.mjs';

const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const dataDirectory = resolve(root, `.cache/native-launch-${Date.now()}`);
const checks = [],
  timings = {},
  errors = [];
const channel = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const relative = ([r, g, b]) =>
  channel(r / 255) * 0.2126 + channel(g / 255) * 0.7152 + channel(b / 255) * 0.0722;
const masks = { dark: [0x0c, 0x0d, 0x0d], light: [0xec, 0xee, 0xf2] };
// Records data-launch changes, the properties the stage animates on its first
// frame, the first rAF after each key, the launch events and when the app
// became ready. Works before <html> exists.
const probe = `(() => {
  const log = (window.__launchProbe = {
    changes: [], keys: [], ready: null, done: null, handoff: null, animated: null,
  });
  const now = () => performance.now();
  const sample = () => {
    const stage = document.querySelector('.launch');
    if (!stage || log.animated) return;
    log.animated = [];
    requestAnimationFrame(() => {
      const skip = ['offset', 'computedOffset', 'easing', 'composite'];
      for (const animation of stage.getAnimations({ subtree: true }))
        for (const frame of animation.effect.getKeyframes())
          for (const key of Object.keys(frame))
            if (!skip.includes(key) && !log.animated.includes(key)) log.animated.push(key);
    });
  };
  const watch = (root) => {
    const record = () => log.changes.push({ t: now(), value: root.getAttribute('data-launch') });
    record();
    new MutationObserver(record).observe(root, { attributes: true, attributeFilter: ['data-launch'] });
    new MutationObserver(() => {
      if (log.ready === null && document.querySelector('#app[data-ready=true]')) log.ready = now();
    }).observe(root, { attributes: true, subtree: true, attributeFilter: ['data-ready'] });
    new MutationObserver(sample).observe(root, { childList: true, subtree: true });
    sample();
  };
  if (document.documentElement) watch(document.documentElement);
  else
    new MutationObserver((records, observer) => {
      if (!document.documentElement) return;
      observer.disconnect();
      watch(document.documentElement);
    }).observe(document, { childList: true });
  addEventListener(
    'keydown',
    () =>
      requestAnimationFrame(() => {
        const stage = document.querySelector('.launch');
        log.keys.push({
          t: now(),
          launch: document.documentElement.getAttribute('data-launch'),
          shown: !!stage && getComputedStyle(stage).display !== 'none',
        });
      }),
    true,
  );
  addEventListener('patchbay:launch', (event) => (log.done = { t: now(), ...event.detail }));
  addEventListener('patchbay:launch-handoff', () => (log.handoff = now()));
})();`;
async function open(launch, { film = false } = {}) {
  let cast = null;
  const run = await launchNative({
    dataDirectory,
    launch,
    early: film ? async (page) => (cast = await screencast(page, { maxWidth: 480 })) : undefined,
  });
  run.page.on('pageerror', (error) => errors.push(error.message));
  const cdp = await run.page.context().newCDPSession(run.page);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: probe });
  return { run, page: run.page, cast, boot: await run.page.evaluate(() => window.__patchbayBoot) };
}
// A fresh document with the probe installed; resolves once the app is ready.
async function reload(page, { film = false } = {}) {
  const cast = film ? await screencast(page, { maxWidth: 480 }) : null;
  await page.reload();
  await page.locator('#app[data-ready=true]').waitFor({ timeout: 15000 });
  return cast;
}
const paintTime = (page) =>
  page.evaluate(() => {
    const paint =
      performance.getEntriesByName('first-paint')[0] ??
      performance.getEntriesByName('first-contentful-paint')[0];
    return { origin: performance.timeOrigin, paint: paint?.startTime ?? null };
  });
const probeLog = (page) => page.evaluate(() => window.__launchProbe);
const waitForPageTime = async (page, at) => {
  const now = await page.evaluate(() => performance.now());
  if (now < at) await page.waitForTimeout(at - now);
};
// Every pixel of every frame in the first 100ms after first paint stays within
// 0.35 relative luminance of the theme mask: no white, black or unthemed flash.
async function firstFrames(page, cast, theme, label, { strict = true } = {}) {
  const frames = await cast.stop(),
    { origin, paint } = await paintTime(page);
  assert.ok(paint !== null, `${label}: the page reports its first paint`);
  const start = origin + paint;
  const opening = frames.filter((frame) => frame.time >= start - 2 && frame.time <= start + 100);
  // On a cold start CDP attaches while the app boots and can miss the first
  // 100ms; the reloads below are always filmed from before their first paint.
  if (!opening.length && !strict) return { frames: 0, worst: null, observed: false };
  assert.ok(opening.length, `${label}: a frame was captured in the first 100ms`);
  const mask = relative(masks[theme]);
  let worst = 0;
  for (const frame of opening) {
    const shot = decodePng(frame.png);
    for (let y = 0; y < shot.height; y += 2)
      for (let x = 0; x < shot.width; x += 2)
        worst = Math.max(worst, Math.abs(relative(shot.pixel(x, y)) - mask));
  }
  assert.ok(
    worst <= 0.35,
    `${label}: a pixel in the first 100ms is ${worst.toFixed(3)} from the ${theme} mask`,
  );
  return { frames: opening.length, worst: Number(worst.toFixed(3)), observed: true };
}
const saved = async () =>
  JSON.parse(await readFile(resolve(dataDirectory, 'session.json'), 'utf8')).session;
async function savedWhere(predicate, label) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const session = await saved();
      if (predicate(session)) return session;
    } catch {
      /* Not written yet. */
    }
    if (Date.now() > deadline) throw new Error('Session never saved ' + label);
    await new Promise((done) => setTimeout(done, 100));
  }
}
async function settings(page, change) {
  await page.locator('[data-route=settings]').click();
  await page.locator('#panel-settings').waitFor();
  await change();
  await page.locator('#close-drawer').click();
  await page.locator('#drawer').waitFor({ state: 'hidden' });
}
let current;
// Closes the current app (its session is flushed on close) and starts the next.
async function reopen(launch, options) {
  const previous = current;
  current = null;
  await previous.run.close();
  current = await open(launch, options);
  return current.page;
}
try {
  // 1. First start of this version: full, on the Night mask from frame 0.
  current = await open('auto', { film: true });
  let { page } = current;
  assert.deepEqual(
    { theme: current.boot?.theme, launch: current.boot?.launch, version: current.boot?.version },
    { theme: 'dark', launch: 'full', version },
    'A fresh session starts the full launch in Night',
  );
  timings.coldStart = await firstFrames(page, current.cast, 'dark', 'Cold start', {
    strict: false,
  });
  checks.push(
    timings.coldStart.observed
      ? `Cold start: boot {theme: dark, launch: full}; ${timings.coldStart.frames} frame(s) in the first 100ms stay on the Night mask (worst ΔL ${timings.coldStart.worst})`
      : 'Cold start: boot {theme: dark, launch: full}; CDP attached after the first 100ms (the reload below films them)',
  );
  // 2. Uninterrupted: hand-off, done, stage removed, launchSeen recorded.
  let cast = await reload(page, { film: true });
  timings.reload = await firstFrames(page, cast, 'dark', 'Full launch');
  await page.waitForFunction(() => window.__launchProbe?.done, undefined, { timeout: 6000 });
  let log = await probeLog(page),
    { paint } = await paintTime(page);
  assert.equal(
    log.changes.find((change) => change.value)?.value,
    'full',
    'The reload replays the full launch',
  );
  assert.deepEqual(
    { mode: log.done.mode, skipped: log.done.skipped },
    { mode: 'full', skipped: false },
  );
  timings.full = {
    handoff: Math.round(log.handoff - paint),
    done: Math.round(log.done.t - paint),
    ready: log.ready === null ? null : Math.round(log.ready - paint),
  };
  assert.ok(
    timings.full.handoff >= 1400 && timings.full.handoff <= 2000,
    `Hand-off at ${timings.full.handoff}ms`,
  );
  assert.ok(
    timings.full.done >= 2000 && timings.full.done <= 3100,
    `Full launch done at ${timings.full.done}ms`,
  );
  assert.equal(await page.locator('html').getAttribute('data-launch'), 'done');
  assert.equal(await page.locator('.launch').count(), 0, 'The stage is removed when done');
  assert.equal(
    (await savedWhere((session) => session.launchSeen === version, 'launchSeen')).launchSeen,
    version,
  );
  checks.push(
    `Full launch: hand-off at ${timings.full.handoff}ms, done at ${timings.full.done}ms, stage removed, launchSeen ${version}; app ready ${timings.full.ready}ms after first paint`,
  );
  // 3. Space at 400ms: the stage is gone on the next frame and Space plays.
  await reload(page);
  ({ paint } = await paintTime(page));
  await waitForPageTime(page, paint + 400);
  const spaceAt = await page.evaluate(() => performance.now());
  await page.keyboard.press('Space');
  await page.locator('#play[data-playing]').waitFor({ timeout: 1000 });
  await page.waitForFunction(() => window.__launchProbe.keys.length, undefined, { timeout: 1000 });
  log = await probeLog(page);
  assert.ok(
    log.changes.some((change) => change.value === 'full' && change.t <= spaceAt),
    'Space arrived while the full launch was showing',
  );
  assert.equal(log.keys[0].shown, false, 'The stage is hidden on the frame after the key');
  assert.match(log.keys[0].launch ?? '', /^(?:skip|done)$/);
  timings.space = { pressedAt: Math.round(spaceAt - paint) };
  if (await page.locator('#play[data-playing]').count()) await page.locator('#play').click();
  await page.locator('#play:not([data-playing])').waitFor();
  checks.push(
    `Space ${timings.space.pressedAt}ms after first paint skips the launch within one frame and still plays`,
  );
  // 4. A click passes through the stage to the control under it.
  await reload(page);
  ({ paint } = await paintTime(page));
  await waitForPageTime(page, paint + 400);
  const before = Number(await page.locator('#progress').inputValue());
  assert.ok(await page.locator('#step').isEnabled(), 'Step is available after the reload');
  const step = await page.locator('#step').boundingBox();
  assert.equal(await page.locator('html').getAttribute('data-launch'), 'full');
  await page.mouse.click(step.x + step.width / 2, step.y + step.height / 2);
  await page.waitForFunction(
    (before) => Number(document.getElementById('progress').value) === before + 1,
    before,
    { timeout: 3000 },
  );
  assert.match((await page.locator('html').getAttribute('data-launch')) ?? '', /^(?:skip|done)$/);
  checks.push('A click during the launch skips it and reaches the Step button under it');
  // 5. Screenshots never contain the launch.
  await reload(page);
  await page.locator('html[data-launch=full]').waitFor({ timeout: 1000 });
  const captured = await page.evaluate(() => {
    const stage = document.querySelector('.launch'),
      shown = () => !!stage && getComputedStyle(stage).display !== 'none';
    const during = shown();
    document.documentElement.dataset.capture = '';
    const hidden = !shown();
    delete document.documentElement.dataset.capture;
    return { during, hidden };
  });
  assert.deepEqual(captured, { during: true, hidden: true }, 'html[data-capture] hides the stage');
  checks.push('html[data-capture] hides the launch stage');
  // 6. A later start of the same version is short (≤ 1s).
  page = await reopen('auto');
  assert.equal(current.boot?.launch, 'short', 'The second start of a version is short');
  await reload(page);
  await page.waitForFunction(() => window.__launchProbe?.done, undefined, { timeout: 4000 });
  log = await probeLog(page);
  ({ paint } = await paintTime(page));
  timings.short = Math.round(log.done.t - paint);
  assert.equal(log.done.mode, 'short');
  assert.ok(timings.short <= 1300, `Short launch done at ${timings.short}ms`);
  checks.push(`Second start: short launch, done ${timings.short}ms after first paint`);
  // 7. Launch animation off: no data-launch at all.
  await settings(page, () => page.locator('#launch-animation').uncheck());
  await savedWhere((session) => session.launchAnimation === false, 'launchAnimation: false');
  page = await reopen('auto');
  assert.equal(current.boot?.launch, 'off');
  assert.equal(await page.locator('html').getAttribute('data-launch'), null);
  checks.push('Settings › Launch animation off: no launch on the next start');
  // 8. Reduced motion: the still frame, ≤ 480ms, opacity only.
  await settings(page, async () => {
    await page.locator('#launch-animation').check();
    await page.locator('#reduced-motion').check();
  });
  await savedWhere(
    (session) => session.launchAnimation === true && session.reducedMotion === true,
    'launchAnimation and reducedMotion',
  );
  page = await reopen('auto');
  assert.equal(current.boot?.launch, 'still', 'Reduced motion selects the still launch');
  await reload(page);
  await page.waitForFunction(() => window.__launchProbe?.done, undefined, { timeout: 3000 });
  log = await probeLog(page);
  ({ paint } = await paintTime(page));
  timings.still = Math.round(log.done.t - paint);
  assert.ok(log.animated, 'The probe sampled the still stage on its first frame');
  assert.deepEqual(
    // The watchdog keyframes visibility; nothing may move.
    log.animated.filter((property) => !['opacity', 'visibility'].includes(property)),
    [],
    'The still launch has no travel: ' + log.animated.join(', '),
  );
  assert.ok(timings.still <= 500, `The still launch ends ${timings.still}ms after first paint`);
  checks.push(`Reduced motion: still launch, opacity only, done at ${timings.still}ms`);
  // 9. A Pearl session opens on the Pearl mask.
  await settings(page, () => page.locator('#reduced-motion').uncheck());
  await instantTheme(page);
  await page.locator('#theme-toggle').click();
  await page.locator('html[data-theme=light]').waitFor();
  await savedWhere(
    (session) => session.theme === 'light' && session.reducedMotion === false,
    'theme: light',
  );
  page = await reopen('full', { film: true });
  assert.equal(current.boot?.theme, 'light');
  assert.equal(current.boot?.launch, 'full');
  timings.pearl = await firstFrames(page, current.cast, 'light', 'Pearl cold start', {
    strict: false,
  });
  cast = await reload(page, { film: true });
  timings.pearlReload = await firstFrames(page, cast, 'light', 'Pearl launch');
  const pearl = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    mask: getComputedStyle(document.documentElement).getPropertyValue('--mask').trim(),
  }));
  assert.equal(pearl.theme, 'light');
  assert.match(pearl.mask, /^#eceef2$/i, 'The Pearl mask is #ECEEF2');
  checks.push(
    `Pearl session: boot theme light; the first 100ms stay on the Pearl mask (worst ΔL ${timings.pearlReload.worst})`,
  );
  assert.deepEqual(errors, []);
  const report = { checks, timings, errors, dataDirectory };
  await writeFile(
    resolve(artifacts, `launch-report${runSuffix}.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (current)
    await current.page
      .screenshot({ path: resolve(artifacts, `launch-failure${runSuffix}.png`) })
      .catch(() => {});
  throw error;
} finally {
  if (current) await current.run.close();
}
