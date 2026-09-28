const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ptah', {
  saveUsd: (opts) => ipcRenderer.invoke('ptah:save-usd', opts),
  openUsd: () => ipcRenderer.invoke('ptah:open-usd'),
  confirmDiscard: (message) => ipcRenderer.invoke('ptah:confirm-discard', message),
  setTitle: (title) => ipcRenderer.send('ptah:set-title', title),
  setDirty: (dirty) => ipcRenderer.send('ptah:set-dirty', !!dirty),
  forgetPaths: () => ipcRenderer.send('ptah:forget-paths'),
  // "Discard changes" on close: fn deletes the recovery snapshot; main.js closes the window once it replies (or after 1 s)
  onDiscardRequest: (fn) => {
    ipcRenderer.removeAllListeners('ptah:discard-snapshot');
    ipcRenderer.on('ptah:discard-snapshot', async (_evt, id) => {
      try { await fn(); } catch { /* close anyway */ }
      ipcRenderer.send('ptah:snapshot-discarded', id);
    });
  },
  // macOS application menu clicks (main.js appMenu); one listener, commands only
  onMenu: (fn) => { ipcRenderer.removeAllListeners('ptah:menu'); ipcRenderer.on('ptah:menu', (_evt, cmd) => fn(String(cmd))); }
});
