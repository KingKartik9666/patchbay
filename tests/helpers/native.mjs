import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
export const root = resolve(import.meta.dirname, '../..');
export const artifacts = resolve(root, 'artifacts/migration');
export async function launchNative({
  dataDirectory = resolve(root, `.cache/native-test-${Date.now()}`),
  executable = resolve(root, 'target/debug/Patchbay.exe'),
  legacy = false,
} = {}) {
  await mkdir(artifacts, { recursive: true });
  const listener = createServer();
  await new Promise((done) => listener.listen(0, '127.0.0.1', done));
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  const app = spawn(executable, [], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
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
    await page.bringToFront();
    await page.locator('#app[data-ready=true]').waitFor({ timeout: 15000 });
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
export async function domain(page, request) {
  return page.evaluate(
    (request) => window.__TAURI_INTERNALS__.invoke('domain', { request }),
    request,
  );
}
