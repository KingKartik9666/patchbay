import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const packagedExecutable = process.argv[2] ? resolve(root, process.argv[2]) : null;
const temporary = await mkdtemp(join(tmpdir(), 'patchbay-smoke-'));
const environment = { ...process.env, PATCHBAY_HEADLESS: '1', PATCHBAY_TEST_USER_DATA: join(temporary, 'profile') };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.PATCHBAY_DEV_URL;
let app;

try {
  app = await _electron.launch({ ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
    args: packagedExecutable ? [] : [root], env: environment, cwd: process.env.PATCHBAY_SMOKE_CWD || root, timeout: 30_000 });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#app[data-ready="true"]');

  const settings = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const { sandbox, contextIsolation, nodeIntegration } = window.webContents.getLastWebPreferences();
    return { sandbox, contextIsolation, nodeIntegration, visible: window.isVisible() };
  });
  assert.deepEqual(settings, { sandbox: true, contextIsolation: true, nodeIntegration: false, visible: false });
  assert.deepEqual(await page.evaluate(() => Object.keys(window.patchbay).sort()),
    ['close', 'isMaximized', 'minimize', 'onMaximized', 'openMachine', 'platform', 'saveMachine', 'saveScreenshot', 'toggleMaximize']);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');

  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), environment.PATCHBAY_TEST_USER_DATA);
  assert.equal(await page.evaluate(() => window.patchbay.isMaximized()), false);
  // Native maximize() shows even a hidden window. Stub only the OS calls, keeping
  // the real preload bridge, main IPC guards, native events and renderer listeners.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    let maximized = false;
    window.isMaximized = () => maximized;
    window.maximize = () => { maximized = true; window.emit('maximize'); };
    window.unmaximize = () => { maximized = false; window.emit('unmaximize'); };
    window.minimize = () => { window.emit('minimize'); };
    window.__minimizeCalls = 0;
    window.on('minimize', () => { window.__minimizeCalls += 1; });
  });
  await page.evaluate(() => {
    window.__maximizeEvents = [];
    window.__unsubscribeMaximized = window.patchbay.onMaximized((state) => window.__maximizeEvents.push(state));
  });
  assert.equal(await page.evaluate(() => window.patchbay.toggleMaximize()), true);
  await page.waitForFunction(() => window.__maximizeEvents.length === 1);
  assert.equal(await page.evaluate(() => window.patchbay.isMaximized()), true);
  assert.equal(await page.evaluate(() => window.patchbay.toggleMaximize()), false);
  await page.waitForFunction(() => window.__maximizeEvents.length === 2);
  assert.deepEqual(await page.evaluate(() => window.__maximizeEvents), [true, false]);
  await page.evaluate(() => window.__unsubscribeMaximized());
  await page.evaluate(() => window.patchbay.toggleMaximize());
  await page.evaluate(() => window.patchbay.toggleMaximize());
  assert.deepEqual(await page.evaluate(() => window.__maximizeEvents), [true, false]);
  await page.evaluate(() => window.patchbay.minimize());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].__minimizeCalls), 1);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.__closeCalls = 0;
    window.__nativeClose = window.close;
    window.close = () => { window.__closeCalls += 1; };
  });
  await page.evaluate(() => window.patchbay.close());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].__closeCalls), 1);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.close = window.__nativeClose;
    delete window.__nativeClose;
  });

  const source = '# Native round trip\ntype mealy\nstart A\nA 0 A 0\nA 1 A 1\n';
  const machinePath = join(temporary, 'round-trip.txt');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, machinePath);
  assert.equal(await page.evaluate((value) => window.patchbay.saveMachine(value), source), true);
  assert.equal(await readFile(machinePath, 'utf8'), source);
  assert.deepEqual(await page.evaluate(() => window.patchbay.openMachine()), { name: 'round-trip.txt', source });
  await assert.rejects(page.evaluate(() => window.patchbay.saveMachine('text', 'unsupported')), /text or graph/);
  await assert.rejects(page.evaluate(() => window.patchbay.saveMachine({ source: 'wrong type' })), /UTF-8/);
  await assert.rejects(page.evaluate(() => window.patchbay.saveMachine('x'.repeat(1024 * 1024 + 1))), /1 MiB/);
  await writeFile(machinePath, Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(page.evaluate(() => window.patchbay.openMachine()), /1 MiB/);
  await writeFile(machinePath, Buffer.from([0xff, 0xfe, 0x00]));
  await assert.rejects(page.evaluate(() => window.patchbay.openMachine()), /UTF-8/);

  // Exercise drawing save/open through the visible controls and real IPC, while
  // stubbing only native dialogs to keep the test unattended and hidden.
  const drawingPath = join(temporary, 'drawing.patchbay');
  await app.evaluate(({ dialog, BrowserWindow }, filePath) => {
    const window = BrowserWindow.getAllWindows()[0];
    dialog.showSaveDialog = async (_window, options) => { window.__saveOptions = options; return { canceled: false, filePath }; };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, drawingPath);
  await page.locator('[data-route="editor"]').click();
  await page.locator('#graph-new').click();
  await page.locator('#graph-add-state').click();
  await page.locator('#graph-alphabet').fill('a λ 🟢');
  await page.locator('#graph-apply-alphabet').click();
  await page.locator('#graph-fill-output').fill('🟢');
  await page.locator('#graph-fill-missing').click();
  const drawing = await page.evaluate(() => localStorage.getItem('patchbay:graph:v1'));
  await page.locator('#graph-save').click();
  await page.waitForFunction(() => /saved/i.test(document.querySelector('#graph-status').textContent));
  assert.equal(await readFile(drawingPath, 'utf8'), drawing);
  const saveOptions = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].__saveOptions);
  assert.equal(saveOptions.defaultPath, 'patchbay-graph.patchbay');
  assert.deepEqual(saveOptions.filters[0].extensions, ['patchbay']);
  const paddedDrawing=drawing+' '.repeat(1_020_000-Buffer.byteLength(drawing,'utf8'));
  assert.equal(await page.evaluate(value=>window.patchbay.saveMachine(value,'graph'),paddedDrawing),true);
  assert.equal((await readFile(drawingPath)).byteLength,1_020_000,'Native graph between one million bytes and 1 MiB saves successfully');
  await page.locator('#graph-new').click();
  assert.equal(await page.locator('.graph-node').count(), 0);
  await page.locator('#graph-open').click();
  await page.waitForFunction(() => document.querySelectorAll('.graph-node').length === 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('patchbay:graph:v1')), drawing,'Native boundary file reopens to the same positioned draft');
  await page.locator('#graph-run').click();
  await page.locator('#input').fill('aλ🟢');
  await page.locator('.load-button').click();
  await page.locator('#progress').evaluate(element => { element.value=element.max; element.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.locator('[data-route="trace"]').click();
  assert.equal(await page.locator('#summary-output').textContent(), '🟢🟢🟢');
  await page.locator('#close-drawer').click();

  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  assert.equal(await page.evaluate(() => window.patchbay.saveMachine('type mealy')), false);
  assert.equal(await page.evaluate(() => window.patchbay.openMachine()), null);
  assert.equal(await page.evaluate(() => window.patchbay.saveScreenshot()), false);

  const artifactPath = join(root, 'artifacts', 'electron-smoke.png');
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, artifactPath);
  assert.equal(await page.evaluate(() => window.patchbay.saveScreenshot()), true);
  const png = await readFile(artifactPath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 1000, 'Screenshot must contain rendered page pixels.');

  const initialURL = page.url();
  await page.evaluate(() => { window.open('https://example.com'); });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await page.evaluate(() => { window.location.href = 'https://example.com'; });
  await page.waitForTimeout(250);
  assert.equal(page.url(), initialURL, 'External navigation must be prevented.');
  console.log('Electron smoke passed: hidden launch, isolated renderer/profile, titlebar IPC/events, native UTF-8 and positioned graph round trips, Unicode simulation, input limits, cancellation, PNG export, navigation guards.');
  console.log(`Screenshot: ${artifactPath}`);
} finally {
  if (app) await app.close();
  const temporaryRoot = resolve(tmpdir()) + sep;
  const absoluteTemporary = resolve(temporary);
  if (absoluteTemporary.startsWith(temporaryRoot) && absoluteTemporary.slice(temporaryRoot.length).startsWith('patchbay-smoke-')) {
    await rm(absoluteTemporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
