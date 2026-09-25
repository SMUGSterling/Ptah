// Ptah — Electron main process.
// Owns the window and native file dialogs. All scene logic lives in the renderer.

const { app, BrowserWindow, ipcMain, dialog, Menu, session } = require('electron');
const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');

let win = null;
let dirty = false;          // mirrored from the renderer; guards window close

function createWindow() {
  dirty = false;            // a new window starts clean (macOS: reopened from the Dock after Discard)
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

  win.removeMenu(); // Windows/Linux: shortcuts live in the app itself (macOS: see appMenu below)
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // The renderer is a single page: never navigate (a dropped file would
  // otherwise replace the editor) and never open windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Unsaved-changes guard. The renderer keeps us informed via ptah:set-dirty.
  win.on('close', (e) => {
    // A save still being written finishes first: quitting mid-write would
    // leave the new file missing and a .tmp beside it.
    if (saveQueues.size) {
      e.preventDefault();
      Promise.allSettled([...saveQueues.values()]).then(() => { if (win) win.close(); });
      return;
    }
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

// macOS always shows an application menu; without one Electron installs its
// default (Edit > Undo calling webContents.undo, View > Reload, DevTools).
// This one forwards to the renderer. Accelerators are displayed but not
// registered (registerAccelerator: false), so Cmd+Z/Cmd+S keep reaching the
// page's own keydown handler exactly once; the items only act on a click.
const MENU_COMMANDS = new Set(['new', 'open', 'save', 'save-as', 'undo', 'redo', 'select-all']);
function appMenu() {
  const send = (cmd) => () => { if (win && MENU_COMMANDS.has(cmd)) win.webContents.send('ptah:menu', cmd); };
  const item = (label, accelerator, cmd) => ({ label, accelerator, registerAccelerator: false, click: send(cmd) });
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [
      item('New', 'CmdOrCtrl+N', 'new'),
      item('Open…', 'CmdOrCtrl+O', 'open'),
      { type: 'separator' },
      item('Save', 'CmdOrCtrl+S', 'save'),
      item('Save As…', 'Shift+CmdOrCtrl+S', 'save-as'),
      { type: 'separator' },
      { role: 'close' }
    ] },
    { label: 'Edit', submenu: [
      item('Undo', 'CmdOrCtrl+Z', 'undo'),
      item('Redo', 'Shift+CmdOrCtrl+Z', 'redo'),
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },   // text fields
      item('Select All', 'CmdOrCtrl+A', 'select-all')
    ] },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }] },   // no Walk item: pointer lock needs a real user gesture in the page
    { role: 'windowMenu' }
  ]);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(process.platform === 'darwin' ? appMenu() : null);
  // Ptah needs pointer lock (walk mode) and nothing else: deny camera,
  // microphone, notifications, geolocation and the rest instead of
  // Electron's default of granting every request.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'pointerLock'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'pointerLock');
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
// Keep both in sync with MAX_IMPORT_BYTES and IMPORT_TOO_LARGE in renderer/js/usd.js (a unit test checks).
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const IMPORT_TOO_LARGE = 'File is too large to import (limit 50 MB).';

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
    if (!path.extname(target)) {
      // The dialog's overwrite warning checked the name without the extension.
      target += '.usda';
      const exists = await fs.stat(target).then(() => true, () => false);
      if (exists) {
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning', buttons: ['Replace', 'Cancel'], defaultId: 1, cancelId: 1,
          message: `${path.basename(target)} already exists.`, detail: 'Do you want to replace it?'
        });
        if (response !== 0) return { canceled: true };
      }
    }
  }
  await writeAtomic(target, content);
  knownPaths.add(target);
  return { canceled: false, filePath: target };
});

// Write next to the target, then rename over it: a crash, full disk or power
// loss mid-write leaves the student's previous file intact instead of a
// truncated one. The previous version is kept as <name>.bak when possible.
// Saves to one file are queued, so a held Ctrl+S cannot race itself.
const saveQueues = new Map();
function writeAtomic(target, content) {
  const prev = saveQueues.get(target) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => writeAtomicNow(target, content));
  saveQueues.set(target, run);
  run.finally(() => { if (saveQueues.get(target) === run) saveQueues.delete(target); }).catch(() => {});
  return run;
}

async function writeAtomicNow(target, content) {
  const real = await fs.realpath(target).catch(() => target);   // a symlinked file stays a symlink
  const mode = await fs.stat(real).then(st => st.mode & 0o777, () => null);
  const tmp = `${real}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const fh = await fs.open(tmp, 'w', mode ?? 0o666);
    try { await fh.writeFile(content, 'utf8'); await fh.sync(); } finally { await fh.close(); }
    // A locked or read-only .bak must not cost the student the save itself.
    await fs.copyFile(real, real + '.bak').catch(() => {});
    // Windows: antivirus, sync clients or an open engine can hold the target
    // briefly; rename then fails with EPERM/EBUSY/EACCES. Retry for ~1 s.
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(tmp, real); break; } catch (err) {
        if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        await new Promise(r => setTimeout(r, 25 * 2 ** Math.min(attempt, 5)));
      }
    }
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

ipcMain.handle('ptah:open-usd', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open blockout',
    properties: ['openFile'],
    filters: USD_FILTERS
  });
  if (res.canceled || res.filePaths.length === 0) return { canceled: true };
  const filePath = res.filePaths[0];
  const { size } = await fs.stat(filePath);
  if (size > MAX_IMPORT_BYTES) return { canceled: false, error: IMPORT_TOO_LARGE };
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
