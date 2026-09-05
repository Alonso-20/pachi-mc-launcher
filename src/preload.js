const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  init: () => ipcRenderer.invoke('launcher:init'),
  login: () => ipcRenderer.invoke('launcher:login'),
  logout: () => ipcRenderer.invoke('launcher:logout'),
  play: (opts) => ipcRenderer.invoke('launcher:play', opts),
  installUpdate: () => ipcRenderer.invoke('launcher:installUpdate'),
  onStatus: (cb) => ipcRenderer.on('launcher:status', (_e, data) => cb(data)),
  onUpdate: (cb) => ipcRenderer.on('launcher:update', (_e, data) => cb(data)),
});
