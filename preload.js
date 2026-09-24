const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ptah', {
  saveUsd: (opts) => ipcRenderer.invoke('ptah:save-usd', opts),
  openUsd: () => ipcRenderer.invoke('ptah:open-usd'),
  confirmDiscard: (message) => ipcRenderer.invoke('ptah:confirm-discard', message),
  setTitle: (title) => ipcRenderer.send('ptah:set-title', title),
  setDirty: (dirty) => ipcRenderer.send('ptah:set-dirty', !!dirty),
  // macOS application menu clicks (main.js appMenu); one listener, commands only
  onMenu: (fn) => { ipcRenderer.removeAllListeners('ptah:menu'); ipcRenderer.on('ptah:menu', (_evt, cmd) => fn(String(cmd))); }
});
