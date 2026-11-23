// Native frame rate (DESIGN.md › Frame rate) on the real debug app at default
// quality, in both window modes (run again with PATCHBAY_OPAQUE=1). Rust's
// detected refresh rate is compared with Windows' own report; the field, the
// shared clock and the theme wave must run within 5% of it while the window is
// visible, a fixed 60 fps choice must hold 60, and an idle field draws nothing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchNative, artifacts, runSuffix, instantTheme } from './helpers/native.mjs';

const tolerance = 0.05;
const run = await launchNative(),
  { page } = run,
  checks = [],
  errors = [],
  readings = {};
page.on('pageerror', (error) => errors.push(error.message));
const cdp = await page.context().newCDPSession(page);
const within = (value, target) => Math.abs(value - target) / target <= tolerance;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : NaN;
};
const attributes = () =>
  page.evaluate(() => {
    const root = document.documentElement.dataset;
    return {
      mode: root.bg,
      fieldFps: Number(root.bgFps),
      clockFps: Number(root.fps),
      displayHz: Number(root.displayHz),
      scale: Number(root.bgScale),
      reason: root.bgReason ?? null,
    };
  });
// Sweeps the pointer (the field's key light) over the window through CDP
// Input.dispatchMouseEvent and reads the once-a-second fps attributes. The
// first `warmup` ms are discarded while the field subscribes and settles.
async function sweep(ms, warmup = 1500) {
  const samples = [],
    start = Date.now();
  let next = start + warmup,
    step = 0;
  while (Date.now() - start < ms) {
    step++;
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(360 + 300 * Math.sin(step / 9)),
      y: Math.round(360 + 180 * Math.cos(step / 7)),
    });
    await new Promise((done) => setTimeout(done, 4));
    if (Date.now() >= next) {
      samples.push(await attributes());
      next += 1000;
    }
  }
  return samples;
}
const closeDrawer = async () => {
  await page.locator('#close-drawer').click();
  await page.locator('#drawer').waitFor({ state: 'hidden' });
};
try {
  // 1. Detection: Rust's Win32 reading against Windows' video controllers.
  const startup = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('startup'));
  const hz = startup.display?.refreshHz;
  assert.ok(Number.isInteger(hz) && hz > 1, 'Startup reports the display refresh rate: ' + hz);
  assert.equal(startup.display.source, 'win32', 'The refresh rate comes from Win32');
  const query = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentRefreshRate -gt 1 }).CurrentRefreshRate -join ","',
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 },
  );
  const windows = query.stdout.trim().split(',').filter(Boolean).map(Number);
  assert.ok(windows.length, 'Windows reports an active video controller refresh rate');
  assert.ok(
    windows.includes(hz),
    `Rust detected ${hz} Hz; Win32_VideoController reports ${windows.join(', ')} Hz`,
  );
  const quality = await page.evaluate(() => document.documentElement.dataset.quality);
  assert.equal(quality, 'medium', 'The suite measures the default quality');
  checks.push(
    `Detected ${hz} Hz on ${startup.display.device ?? 'the current monitor'} (Win32_VideoController: ${windows.join(', ')} Hz); default quality ${quality}`,
  );
  // 2. The field and the clock run at the display rate while the pointer moves.
  await page.locator('[data-route=bench]').click();
  await page.locator('#view-bench').waitFor();
  const moving = await sweep(5500);
  readings.match = moving;
  const field = median(moving.map((sample) => sample.fieldFps)),
    clock = median(moving.map((sample) => sample.clockFps));
  assert.equal(moving.at(-1).mode, 'webgl', 'The WebGL field draws at default quality');
  assert.equal(moving.at(-1).displayHz, hz, 'html[data-display-hz] carries the detected rate');
  assert.ok(
    within(field, hz),
    `The field draws ${field} fps at ${hz} Hz (readings ${moving.map((sample) => sample.fieldFps)})`,
  );
  assert.ok(
    within(clock, hz),
    `The frame clock dispatches ${clock} fps at ${hz} Hz (readings ${moving.map((sample) => sample.clockFps)})`,
  );
  checks.push(
    `Pointer moving at default quality: field ${field} fps, clock ${clock} fps, render scale ${moving.at(-1).scale}× at ${hz} Hz`,
  );
  // 3. An idle field draws nothing: 0 fps within 3s of the last motion, and
  // it stays there.
  await page.waitForFunction(() => document.documentElement.dataset.bgFps === '0', undefined, {
    timeout: 4500,
  });
  await page.waitForTimeout(1500);
  assert.equal((await attributes()).fieldFps, 0, 'The idle field stays at 0 fps');
  checks.push('Idle: the field unsubscribes and reports 0 fps');
  // 4. The theme wave (compositor clip + foam on the clock) at the display rate.
  await instantTheme(page, false);
  await page.evaluate(() => {
    window.__settled = 0;
    addEventListener('patchbay:theme-settled', () => window.__settled++);
  });
  const waves = [];
  for (const [index, theme] of ['light', 'dark'].entries()) {
    await page.locator('#theme-toggle').click();
    await page.waitForFunction((count) => window.__settled >= count, index + 1, {
      timeout: 6000,
    });
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    waves.push(Number(await page.locator('html').getAttribute('data-wave-fps')));
  }
  await instantTheme(page);
  readings.waves = waves;
  for (const fps of waves)
    assert.ok(within(fps, hz), `The wave ran at ${fps} fps at ${hz} Hz (waves ${waves})`);
  checks.push(`Theme wave: ${waves.join(' and ')} fps at ${hz} Hz`);
  // 5. Settings: "Match display · N Hz" is the default; diagnostics show the
  // detected and measured rates.
  await page.locator('[data-route=settings]').click();
  await page.locator('#panel-settings').waitFor();
  const settings = await page.evaluate(() => {
    const select = document.getElementById('frame-rate');
    return {
      value: select?.value,
      options: select ? [...select.options].map((option) => [option.value, option.text]) : [],
      hz: document.getElementById('metric-hz')?.textContent.trim(),
      fps: document.getElementById('metric-fps')?.textContent.trim(),
    };
  });
  assert.equal(settings.value, 'match', 'Frame rate defaults to Match display');
  assert.deepEqual(settings.options[0], ['match', `Match display · ${hz} Hz`]);
  assert.deepEqual(
    settings.options.map(([value]) => value),
    ['match', '60', '30'],
    'Frame rate offers Match display and two power savers',
  );
  assert.equal(settings.hz, `${hz} Hz`, '#metric-hz shows the detected rate');
  assert.match(settings.fps ?? '', /^\d+/, '#metric-fps shows the measured rate');
  checks.push(
    `Settings › Frame rate reads "${settings.options[0][1]}"; diagnostics ${settings.hz}, ${settings.fps}`,
  );
  // 6. A fixed 60 fps choice paces the clock-driven renderers at 60.
  await page.locator('#frame-rate').selectOption('60');
  await closeDrawer();
  const sixty = await sweep(5000);
  readings.sixty = sixty;
  const fieldSixty = median(sixty.map((sample) => sample.fieldFps));
  assert.ok(
    within(fieldSixty, 60),
    `At "60 fps · power saver" the field draws ${fieldSixty} fps (readings ${sixty.map((sample) => sample.fieldFps)})`,
  );
  checks.push(`Frame rate 60: the field draws ${fieldSixty} fps on the ${hz} Hz display`);
  await page.locator('[data-route=settings]').click();
  await page.locator('#panel-settings').waitFor();
  await page.locator('#frame-rate').selectOption('match');
  await closeDrawer();
  assert.deepEqual(errors, []);
  const report = { hz, windows, checks, readings, errors };
  await writeFile(
    resolve(artifacts, `refresh-report${runSuffix}.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page
    .screenshot({ path: resolve(artifacts, `refresh-failure${runSuffix}.png`) })
    .catch(() => {});
  throw error;
} finally {
  await run.close();
}
