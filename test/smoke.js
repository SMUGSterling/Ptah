// Electron smoke test. Run:
//   xvfb-run -a node_modules/.bin/electron --no-sandbox test/smoke.js
//
// Boots the REAL main process (main.js: sandboxed window, preload, IPC
// handlers, knownPaths, close guard, menu, permission handler) with the
// native dialogs stubbed, drives the shared scripted session
// (test/scenario.mjs, also used by the browser runner), then exercises the
// desktop-only paths: Save As and Save through IPC, the atomic write and its
// .bak, a renderer-supplied path that was never picked, the unsaved-changes
// close guard, menu forwarding, Open, the single-instance lock, and Discard
// on close clearing the recovery snapshot. Dumps console output, saves a
// screenshot, exits 0/1.

const electron = require('electron');
const { app, BrowserWindow, dialog } = electron;
const path = require('path');
const fs = require('fs');
const os = require('os');

// A throwaway profile: an autosave snapshot left by an earlier (failed) run
// would otherwise put the recovery bar up instead of the profile picker.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-smoke-profile-')));
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const errors = [];
const steps = [];
const check = (cond, msg) => { steps.push((cond ? 'ok: ' : 'FAIL: ') + msg); if (!cond) errors.push('check failed: ' + msg); };

// ---- dialog stubs (main.js calls these through the same `dialog` object) ----
const calls = { save: 0, open: 0, box: 0, boxSync: 0 };
const next = { save: null, open: null, box: 0, boxSync: 1, hold: null };
dialog.showSaveDialog = async () => { calls.save++; if (next.hold) await next.hold; return next.save ? { canceled: false, filePath: next.save } : { canceled: true }; };
dialog.showOpenDialog = async () => { calls.open++; return next.open ? { canceled: false, filePaths: [next.open] } : { canceled: true, filePaths: [] }; };
dialog.showMessageBox = async () => { calls.box++; return { response: next.box }; };
dialog.showMessageBoxSync = () => { calls.boxSync++; return next.boxSync; };

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (e) => {
    const tag = String(e.level);            // 'debug' | 'info' | 'warning' | 'error'
    console.log(`[renderer:${tag}] ${e.message} (${path.basename(String(e.sourceId))}:${e.lineNumber})`);
    if (tag === 'error' || (tag === 'warning' && /WebGL/.test(e.message))) errors.push(e.message);
  });
  win.webContents.on('render-process-gone', (_ev, d) => errors.push('renderer gone: ' + d.reason));
});

require('../main.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what);
    await sleep(50);
  }
}

async function screenshot(w) {
  try {
    const img = await w.webContents.capturePage();
    fs.mkdirSync(path.join(__dirname, '.out'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '.out', 'smoke.png'), img.toPNG());
    console.log('screenshot: test/.out/smoke.png');
  } catch (e) { console.log('screenshot failed: ' + e.message); }
}

app.whenReady().then(async () => {
  let result = { steps: [], ok: false };
  let win;
  try {
    win = await until(() => BrowserWindow.getAllWindows()[0], 10000, 'the main window');
    if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
    win.show(); win.focus(); win.webContents.focus();
    await sleep(1500);
    const js = (code) => win.webContents.executeJavaScript(code, true);

    // ---- host: the real preload and a sandboxed renderer ----
    const host = await js(`({ bridge: typeof window.ptah, keys: window.ptah ? Object.keys(window.ptah).sort().join() : '', require: typeof require, process: typeof process })`);
    check(host.bridge === 'object' && /saveUsd/.test(host.keys) && /onMenu/.test(host.keys), 'preload bridge present: ' + host.keys);
    check(host.require === 'undefined' && host.process === 'undefined', 'renderer is sandboxed (no require/process)');

    // ---- the shared scripted session, now in Electron platform mode ----
    const { scenario } = await import('./scenario.mjs');
    result = await js('(' + scenario.toString() + ')()');

    // ---- desktop file paths ----
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-smoke-'));
    const level = path.join(tmp, 'level.usda');
    fs.writeFileSync(level, 'OLD CONTENT');
    const key = (code, opts) => js(`window.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, key: ${JSON.stringify(code.replace('Key', '').toLowerCase())}, bubbles: true, ...${JSON.stringify(opts || {})} }))`);
    const { placeCubes } = await import('./page-helpers.mjs');
    const placeCube = () => js(`(${placeCubes})([[0.62, 0.3]])`);

    next.save = level;
    await key('KeyS', { ctrlKey: true, shiftKey: true });
    await until(() => fs.readFileSync(level, 'utf8').startsWith('#usda'), 5000, 'Save As to write the file');
    check(calls.save === 1, 'Save As showed one dialog');
    check(fs.existsSync(level + '.bak') && fs.readFileSync(level + '.bak', 'utf8') === 'OLD CONTENT', 'previous file kept as .bak');
    check(!fs.readdirSync(tmp).some(f => f.endsWith('.tmp')), 'no temp file left behind by the atomic write');
    await until(() => !/•/.test(win.getTitle()) && /level\.usda/.test(win.getTitle()), 3000, 'title after save').catch(() => {});
    check(/level\.usda/.test(win.getTitle()), 'window title names the file: ' + win.getTitle());
    check(!(await js('window.__ptah.state.dirty')), 'clean after save');

    // an edit made while a save is in flight stays unsaved: hold the Save As dialog open, edit, then let the save finish
    let release;
    next.hold = new Promise(r => { release = r; });
    const heldSaves = calls.save, ino = fs.statSync(level).ino;
    await key('KeyS', { ctrlKey: true, shiftKey: true });
    await until(() => calls.save === heldSaves + 1, 3000, 'the held Save As dialog');
    await placeCube();
    next.hold = null;
    release();
    await until(() => fs.statSync(level).ino !== ino, 5000, 'the held save to write');
    check(await js('window.__ptah.state.dirty'), 'an edit made during a save keeps the level marked unsaved');
    await key('KeyS', { ctrlKey: true });
    await until(async () => !(await js('window.__ptah.state.dirty')), 5000, 'follow-up save');

    const n0 = await placeCube();
    await key('KeyS', { ctrlKey: true });
    await until(async () => !(await js('window.__ptah.state.dirty')), 5000, 'Save to finish');
    check(calls.save === 2, 'Save to a picked path writes without a dialog');
    check(fs.readFileSync(level, 'utf8') === await js('window.__ptah.exportText()'), 'saved file matches the export');

    // saves to one file are queued: a held Ctrl+S (key repeat) must not race itself
    const race = await js(`Promise.all([1, 2, 3].map(() => window.ptah.saveUsd({ content: window.__ptah.exportText(), filePath: ${JSON.stringify(level)} })))
      .then(r => 'ok ' + r.length, e => 'error: ' + e.message)`);
    check(race === 'ok 3' && !fs.readdirSync(tmp).some(f => f.endsWith('.tmp')), 'three concurrent saves to one file all succeed (' + race + ')');

    // a path the user never picked must go through a dialog
    const forged = path.join(tmp, 'forged.usda');
    next.save = path.join(tmp, 'picked.usda');
    await js(`window.ptah.saveUsd({ content: '#usda 1.0\\n', filePath: ${JSON.stringify(forged)} })`);
    check(calls.save === 3 && !fs.existsSync(forged) && fs.existsSync(next.save), 'renderer-supplied unknown path is not written; a dialog is shown instead');

    // ---- menu forwarding (macOS menu clicks arrive as ptah:menu) ----
    win.webContents.send('ptah:menu', 'undo');
    const undone = await until(async () => (await js('window.__ptah.ids().length')) === n0 - 1, 3000, 'menu undo').then(() => true, () => false);
    check(undone, 'menu "undo" reaches the editor history');
    win.webContents.send('ptah:menu', 'redo');
    const redone = await until(async () => (await js('window.__ptah.ids().length')) === n0, 3000, 'menu redo').then(() => true, () => false);
    check(redone, 'menu "redo" reaches the editor history');

    // ---- close guard: dirty + Cancel keeps the window ----
    await placeCube();
    await until(() => /•/.test(win.getTitle()), 3000, 'the dirty state to reach the main process').catch(() => {});
    next.boxSync = 1;                                   // Cancel
    const boxesBefore = calls.boxSync;
    win.close();
    await until(() => calls.boxSync > boxesBefore, 3000, 'the close prompt').catch(() => {});
    check(!win.isDestroyed() && calls.boxSync === 1, 'closing with unsaved changes asks, and Cancel keeps the window');

    // ---- Open through the menu: confirm discard, load, title ----
    next.open = path.join(__dirname, 'sample.usda');
    next.box = 0;                                       // Discard changes
    const boxes = calls.box;
    win.webContents.send('ptah:menu', 'open');
    await until(async () => (await js('window.__ptah.ids().length')) === 12, 5000, 'sample to open');
    check(calls.open === 1 && calls.box === boxes + 1, 'menu Open asks to discard, then shows one Open dialog');
    check(/sample\.usda/.test(win.getTitle()), 'title names the opened file: ' + win.getTitle());

    // ---- permissions: only pointer lock is granted ----
    const perm = await js(`navigator.permissions.query({ name: 'notifications' }).then(r => r.state, e => 'error: ' + e.message)`);
    check(perm === 'denied', 'permission requests other than pointer lock are denied (notifications: ' + perm + ')');

    // ---- a second launch on the same profile hands over to this window and quits ----
    const handedOver = new Promise(r => app.once('second-instance', () => r(true)));
    const second = require('child_process').spawn(process.execPath, ['--no-sandbox', path.join(__dirname, 'fixtures', 'second-instance.js'), app.getPath('userData')], { stdio: 'ignore' });
    const exitCode = await Promise.race([new Promise(r => second.on('exit', r)), sleep(15000).then(() => { second.kill(); return 'still running'; })]);
    check(exitCode === 0 && await Promise.race([handedOver, sleep(1000).then(() => false)]), 'a second launch quits and hands over to the open window (exit ' + exitCode + ')');

    // ---- Discard changes on close deletes the recovery snapshot ----
    // Last, because it closes the window: a fresh window on the same profile
    // must start clean instead of offering the discarded work back.
    await placeCube();
    await until(() => /•/.test(win.getTitle()), 3000, 'the dirty state to reach the main process').catch(() => {});
    check(await js('window.__ptah.autosave.flush()'), 'a recovery snapshot is written before closing');
    await screenshot(win);
    app.on('before-quit', (e) => e.preventDefault());   // keep the app up for the fresh window; app.exit() below still ends it
    next.boxSync = 0;                                   // Discard changes
    win.close();
    await until(() => win.isDestroyed(), 4000, 'the window to close after Discard').catch(() => {});
    check(win.isDestroyed(), 'Discard changes closes the window');
    const fresh = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await fresh.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    const freshJs = (code) => fresh.webContents.executeJavaScript(code, true);
    await until(() => freshJs(`!!(window.__ptah && (window.__ptah.pickerOpen() || !document.getElementById('recover-bar').classList.contains('hidden')))`), 8000, 'the fresh window to boot');
    const offered = await freshJs(`!document.getElementById('recover-bar').classList.contains('hidden')`);
    check(!offered, 'after Discard changes, the next launch does not offer the discarded work back');
    fresh.destroy();

    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (e) {
    errors.push('smoke threw: ' + e.message);
  }

  for (const s of result.steps || []) console.log('  ' + s);
  for (const k of Object.keys(result)) {
    if (k !== 'steps' && k !== 'ok') console.log(`  ${k}: ${result[k]}`);
  }
  for (const s of steps) console.log('  ' + s);

  if (win && !win.isDestroyed()) { await sleep(400); await screenshot(win); }   // on an early failure; otherwise taken before the final close

  const failed = errors.length > 0 || !result.ok;
  console.log(failed ? 'SMOKE FAIL' : 'SMOKE PASS');
  if (errors.length) console.log('errors:\n' + errors.join('\n'));
  app.exit(failed ? 1 : 0);                             // exit() skips the close guard
});
