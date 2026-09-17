// Ptah — Electron main process.
// Owns the window and native file dialogs. All scene logic lives in the renderer.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs/promises');
const path = require('path');

let win = null;
let dirty = false;          // mirrored from the renderer; guards window close

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#14161b',
    title: 'Ptah',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.removeMenu(); // shortcuts live in the app itself
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // The renderer is a single page: never navigate (a dropped file would
  // otherwise replace the editor) and never open windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Unsaved-changes guard. The renderer keeps us informed via ptah:set-dirty.
  win.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Discard changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
      detail: 'Closing now will discard your unsaved work.'
    });
    if (choice !== 0) e.preventDefault();
  });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: file dialogs ------------------------------------------------------

const USD_FILTERS = [
  { name: 'USD (text)', extensions: ['usda'] },
  { name: 'All files', extensions: ['*'] }
];

// Paths the user picked in a dialog this session. The renderer may only write
// back to one of these without a new dialog; anything else gets a Save As.
const knownPaths = new Set();

// Save .usda. If filePath is provided (Save vs Save As), skip the dialog.
ipcMain.handle('ptah:save-usd', async (_evt, { content, filePath, suggestedName }) => {
  if (typeof content !== 'string') throw new Error('save-usd: content must be a string');
  let target = knownPaths.has(filePath) ? filePath : null;
  if (!target) {
    const res = await dialog.showSaveDialog(win, {
      title: 'Save blockout',
      defaultPath: suggestedName || 'blockout.usda',
      filters: USD_FILTERS
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    target = res.filePath;
    if (!path.extname(target)) target += '.usda';
  }
  await fs.writeFile(target, content, 'utf8');
  knownPaths.add(target);
  return { canceled: false, filePath: target };
});

ipcMain.handle('ptah:open-usd', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open blockout',
    properties: ['openFile'],
    filters: USD_FILTERS
  });
  if (res.canceled || res.filePaths.length === 0) return { canceled: true };
  const filePath = res.filePaths[0];
  const content = await fs.readFile(filePath, 'utf8');
  knownPaths.add(filePath);
  return { canceled: false, filePath, content };
});

ipcMain.handle('ptah:confirm-discard', async (_evt, message) => {
  const res = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Discard changes', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: message || 'You have unsaved changes.',
    detail: 'This will discard your unsaved work.'
  });
  return res.response === 0;
});

ipcMain.on('ptah:set-title', (_evt, title) => {
  if (win) win.setTitle(String(title).slice(0, 200));
});

ipcMain.on('ptah:set-dirty', (_evt, value) => {
  dirty = !!value;
});
