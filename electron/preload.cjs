'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose individual capabilities; never expose raw IPC or arbitrary filesystem paths.
contextBridge.exposeInMainWorld('patchbay', Object.freeze({
  openMachine: () => ipcRenderer.invoke('patchbay:open-machine'),
  saveMachine: (source, format = 'text') => ipcRenderer.invoke('patchbay:save-machine', source, format),
  saveScreenshot: () => ipcRenderer.invoke('patchbay:save-screenshot'),
  minimize: () => ipcRenderer.invoke('patchbay:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('patchbay:toggle-maximize'),
  close: () => ipcRenderer.invoke('patchbay:close'),
  isMaximized: () => ipcRenderer.invoke('patchbay:is-maximized'),
  onMaximized: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('onMaximized requires a callback.');
    const listener = (_event, maximized) => {
      if (typeof maximized === 'boolean') callback(maximized);
    };
    ipcRenderer.on('patchbay:maximized', listener);
    return () => ipcRenderer.removeListener('patchbay:maximized', listener);
  },
  platform: process.platform,
}));
