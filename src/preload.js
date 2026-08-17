const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  init: () => ipcRenderer.invoke('launcher:init'),
  login: () => ipcRenderer.invoke('launcher:login'),
  logout: () => ipcRenderer.invoke('launcher:logout'),
  play: (opts) => ipcRenderer.invoke('launcher:play', opts),
  openExternal: (url) => ipcRenderer.invoke('launcher:openExternal', url),
  onStatus: (cb) => ipcRenderer.on('launcher:status', (_e, data) => cb(data)),
});
