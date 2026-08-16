const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  init: () => ipcRenderer.invoke('launcher:init'),
  play: (opts) => ipcRenderer.invoke('launcher:play', opts),
  openExternal: (url) => ipcRenderer.invoke('launcher:openExternal', url),
  onStatus: (cb) => ipcRenderer.on('launcher:status', (_e, data) => cb(data)),
});
