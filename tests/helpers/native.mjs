import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
export const root = resolve(import.meta.dirname, '../..');
export const artifacts = resolve(root, 'artifacts/migration');
// The native suites run once on the Windows 11 Mica path and once with
// PATCHBAY_OPAQUE=1, which makes Rust create the ordinary opaque window.
export const opaqueRun = process.env.PATCHBAY_OPAQUE === '1';
// Keeps the two runs' reports and screenshots side by side.
export const runSuffix = opaqueRun ? '-opaque' : '';
// A Patchbay.exe left running from this checkout's target folder (a crashed
// suite, a manual debug run) holds the session and the debug port; stop it
// once per process before the first launch. Installed copies are untouched.
let strayStopped = false;
function stopStrayInstances() {
  if (strayStopped || process.platform !== 'win32') return;
  strayStopped = true;
  const target = resolve(root, 'target').replaceAll("'", "''");
  spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-Process -Name Patchbay -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith('${target}\\', [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue`,
    ],
    { windowsHide: true, stdio: 'ignore', timeout: 20000 },
  );
}
/**
 * Starts target/debug/Patchbay.exe with an isolated session and a local CDP port.
 * - `launch`: PATCHBAY_LAUNCH for the debug build (`off|full|short|still`, or
 *   `auto` for the normal rules). Unset means off, because the test data
 *   directory turns the launch off.
 * - `wave`: keep the theme wave. By default html[data-theme-instant] is set
 *   after load, so #theme-toggle switches synchronously and screenshots never
 *   wait for a transition.
 * - `early(page)`: runs as soon as the page exists, before the app is ready
 *   (the launch suite starts its frame capture there).
 */
export async function launchNative({
  dataDirectory = resolve(root, `.cache/native-test-${Date.now()}`),
  executable = resolve(root, 'target/debug/Patchbay.exe'),
  legacy = false,
  opaque = opaqueRun,
  launch,
  wave = false,
  early,
} = {}) {
  stopStrayInstances();
  await mkdir(artifacts, { recursive: true });
  const listener = createServer();
  await new Promise((done) => listener.listen(0, '127.0.0.1', done));
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  const environment = { ...process.env };
  delete environment.PATCHBAY_OPAQUE;
  delete environment.PATCHBAY_LAUNCH;
  if (opaque) environment.PATCHBAY_OPAQUE = '1';
  if (launch) environment.PATCHBAY_LAUNCH = launch;
  const app = spawn(executable, [], {
    cwd: root,
    windowsHide: true,
    env: {
      ...environment,
      PATCHBAY_TEST_DATA_DIR: dataDirectory,
      WEBVIEW2_USER_DATA_FOLDER: resolve(dataDirectory, `webview-${Date.now()}`),
      ...(!legacy ? { PATCHBAY_TEST_NO_LEGACY: '1' } : {}),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  });
  let appError;
  app.on('error', (error) => (appError = error));
  let browser;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (appError) throw appError;
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 200));
    }
  }
  if (!browser) {
    app.kill();
    throw new Error('Native WebView2 debugging endpoint did not start.');
  }
  const deadlinePage = Date.now() + 10000;
  let page;
  while (Date.now() < deadlinePage) {
    page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => /tauri.localhost|tauri:\/\/localhost/.test(page.url()));
    if (page) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!page) {
    const urls = browser
      .contexts()
      .flatMap((context) => context.pages())
      .map((page) => page.url());
    await browser.close();
    app.kill();
    throw new Error('Patchbay WebView2 page not found: ' + JSON.stringify(urls));
  }
  try {
    if (early) await early(page);
    await page.bringToFront();
    await page.locator('#app[data-ready=true]').waitFor({ timeout: 15000 });
    if (!wave) await instantTheme(page);
  } catch (error) {
    await browser.close();
    app.kill();
    throw error;
  }
  return {
    app,
    browser,
    page,
    dataDirectory,
    opaque,
    async close() {
      if (app.exitCode !== null) {
        await browser.close();
        return;
      }
      const exited = new Promise((done) => app.once('exit', done));
      try {
        await page.evaluate(() =>
          window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }),
        );
      } catch {
        /* The renderer can close before replying. */
      }
      await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))]);
      await browser.close();
      if (app.exitCode === null) {
        app.kill();
        throw new Error('Patchbay did not close gracefully.');
      }
    },
  };
}
// Records composited frames (including view-transition snapshots) through CDP.
// Each frame carries its swap time in epoch milliseconds, comparable with
// `performance.timeOrigin + performance.now()` in the page.
export async function screencast(page, { maxWidth = 960 } = {}) {
  const session = await page.context().newCDPSession(page);
  const frames = [];
  session.on('Page.screencastFrame', (event) => {
    frames.push({
      time: (event.metadata.timestamp ?? Date.now() / 1000) * 1000,
      png: Buffer.from(event.data, 'base64'),
    });
    session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  await session.send('Page.startScreencast', { format: 'png', maxWidth, everyNthFrame: 1 });
  return {
    frames,
    async stop() {
      await session.send('Page.stopScreencast').catch(() => {});
      await session.detach().catch(() => {});
      return frames;
    },
  };
}
// Theme switches apply synchronously, with no wave or cross-fade. A reload
// starts a new document, so call this again after page.reload().
export async function instantTheme(page, on = true) {
  await page.evaluate((on) => {
    if (on) document.documentElement.dataset.themeInstant = '';
    else delete document.documentElement.dataset.themeInstant;
  }, on);
}
export async function domain(page, request) {
  return page.evaluate(
    (request) => window.__TAURI_INTERNALS__.invoke('domain', { request }),
    request,
  );
}
