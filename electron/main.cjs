'use strict';

const { app, BrowserWindow, dialog, ipcMain, nativeTheme, session } = require('electron');
const { mkdirSync } = require('node:fs');
const { open, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MAX_MACHINE_BYTES = 1024 * 1024;
const documentURL = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
let window;
let dialogBusy = false;

// Hidden source and packaged smoke tests use their own profile, keeping the
// normal user's saved bench intact. Normal launches do not use this override.
if (process.env.PATCHBAY_HEADLESS === '1' && process.env.PATCHBAY_TEST_USER_DATA) {
  const testProfile = process.env.PATCHBAY_TEST_USER_DATA;
  if (!path.isAbsolute(testProfile)) throw new Error('PATCHBAY_TEST_USER_DATA must be an absolute path.');
  mkdirSync(testProfile, { recursive: true });
  app.setPath('userData', testProfile);
}

// A packaged app always uses its bundled renderer. Development is loopback-only.
function developmentURL() {
  if (app.isPackaged || !process.env.PATCHBAY_DEV_URL) return null;
  const url = new URL(process.env.PATCHBAY_DEV_URL);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.port !== '5173' || url.username || url.password || url.pathname !== '/') {
    throw new Error('PATCHBAY_DEV_URL must be http://localhost:5173/ or http://127.0.0.1:5173/.');
  }
  return url;
}

const devURL = developmentURL();

function trustedDocument(candidate) {
  try {
    const url = new URL(candidate);
    url.hash = '';
    if (devURL) return url.origin === devURL.origin && ['/', '/index.html'].includes(url.pathname);
    return url.href === documentURL;
  } catch {
    return false;
  }
}

function validateSender(event) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents
    || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame
    || !trustedDocument(event.senderFrame.url)) {
    throw new Error('This request did not come from the Patchbay window.');
  }
}

async function withDialog(event, cancelledValue, callback) {
  validateSender(event);
  if (dialogBusy) return cancelledValue;
  dialogBusy = true;
  try {
    return await callback();
  } finally {
    dialogBusy = false;
  }
}

function validateSource(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_MACHINE_BYTES
    || source.includes('\0')) {
    throw new Error('Choose a UTF-8 machine file no larger than 1 MiB.');
  }
}

function installFileHandlers() {
  ipcMain.handle('patchbay:open-machine', (event) => withDialog(event, null, async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Open a machine',
      buttonLabel: 'Open machine',
      properties: ['openFile'],
      filters: [{ name: 'Machine text', extensions: ['txt', 'machine', 'patchbay'] }],
    });
    if (result.canceled || result.filePaths.length !== 1) return null;

    // Bounded reads also protect against a file growing after its size check.
    const file = await open(result.filePaths[0], 'r');
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_MACHINE_BYTES) {
        throw new Error('Choose a machine file no larger than 1 MiB.');
      }
      const buffer = Buffer.alloc(MAX_MACHINE_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > MAX_MACHINE_BYTES) throw new Error('This machine file is larger than 1 MiB.');
      let source;
      try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
      } catch {
        throw new Error('This file is not valid UTF-8 text. Save it as UTF-8 and try again.');
      }
      validateSource(source);
      return { name: path.basename(result.filePaths[0]), source };
    } finally {
      await file.close();
    }
  }));

  ipcMain.handle('patchbay:save-machine', (event, source, format = 'text') => {
    validateSender(event);
    validateSource(source);
    if (!['text', 'graph'].includes(format)) throw new Error('Choose a machine text or graph file.');
    return withDialog(event, false, async () => {
      const result = await dialog.showSaveDialog(window, {
        title: 'Save machine',
        defaultPath: format === 'graph' ? 'patchbay-graph.patchbay' : 'patchbay-machine.txt',
        buttonLabel: 'Save machine',
        filters: [{ name: format === 'graph' ? 'Graph drawing' : 'Machine text', extensions: format === 'graph' ? ['patchbay'] : ['txt'] }],
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, source, 'utf8');
      return true;
    });
  });

  ipcMain.handle('patchbay:save-screenshot', (event) => withDialog(event, false, async () => {
    const result = await dialog.showSaveDialog(window, {
      title: 'Save a snapshot',
      defaultPath: 'patchbay-snapshot.png',
      buttonLabel: 'Save PNG',
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return false;
    const picture = await window.webContents.capturePage(undefined, { stayHidden: true });
    await writeFile(result.filePath, picture.toPNG());
    return true;
  }));
}

function installWindowHandlers() {
  ipcMain.handle('patchbay:minimize', (event) => {
    validateSender(event);
    window.minimize();
  });
  ipcMain.handle('patchbay:toggle-maximize', (event) => {
    validateSender(event);
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle('patchbay:is-maximized', (event) => {
    validateSender(event);
    return window.isMaximized();
  });
  ipcMain.handle('patchbay:close', (event) => {
    validateSender(event);
    const requestedWindow = window;
    // Resolve the invoke before closing its renderer to avoid a rejected UI promise.
    setImmediate(() => {
      if (!requestedWindow.isDestroyed()) requestedWindow.close();
    });
  });
}

function secureSession() {
  const appSession = session.defaultSession;
  appSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents === window?.webContents && trustedDocument(contents.getURL())
      && permission === 'clipboard-sanitized-write');
  });
  appSession.setPermissionCheckHandler((contents, permission) => (
    contents === window?.webContents && trustedDocument(contents.getURL())
      && permission === 'clipboard-sanitized-write'
  ));
  appSession.on('will-download', (event) => event.preventDefault());
  // All fonts, scripts and other production assets are local. HMR is the only network use.
  appSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    const target = new URL(details.url);
    const allowed = devURL && target.host === devURL.host && ['http:', 'ws:'].includes(target.protocol);
    callback({ cancel: !allowed });
  });
}

async function createWindow() {
  window = new BrowserWindow({
    title: 'Patchbay — Mealy & Moore machines',
    width: 1440,
    height: 1000,
    minWidth: 1000,
    minHeight: 740,
    backgroundColor: '#f4f4f4',
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  const contents = window.webContents;
  const notifyMaximized = () => {
    if (!contents.isDestroyed()) contents.send('patchbay:maximized', window.isMaximized());
  };
  window.on('maximize', notifyMaximized);
  window.on('unmaximize', notifyMaximized);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, target) => {
    if (!trustedDocument(target)) event.preventDefault();
  });
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !trustedDocument(event.url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, target) => {
    if (!trustedDocument(target)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => {
    if (process.env.PATCHBAY_HEADLESS !== '1') window.show();
  });
  window.on('closed', () => { window = undefined; });

  if (devURL) await window.loadURL(devURL.href);
  else await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.setName('Patchbay');
nativeTheme.themeSource = 'dark';
app.whenReady().then(async () => {
  secureSession();
  installFileHandlers();
  installWindowHandlers();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error) => {
  console.error('Patchbay could not start:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
