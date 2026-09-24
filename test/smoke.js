// Electron smoke test. Run:
//   xvfb-run -a node_modules/.bin/electron --no-sandbox test/smoke.js
//
// Boots the REAL main process (main.js: sandboxed window, preload, IPC
// handlers, knownPaths, close guard, menu, permission handler) with the
// native dialogs stubbed, drives the shared scripted session
// (test/scenario.mjs, also used by the browser runner), then exercises the
// desktop-only paths: Save As and Save through IPC, the atomic write and its
// .bak, a renderer-supplied path that was never picked, the unsaved-changes
// close guard, menu forwarding and Open. Dumps console output, saves a
// screenshot, exits 0/1.

const electron = require('electron');
const { app, BrowserWindow, dialog } = electron;
const path = require('path');
const fs = require('fs');
const os = require('os');

app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const errors = [];
const steps = [];
const check = (cond, msg) => { steps.push((cond ? 'ok: ' : 'FAIL: ') + msg); if (!cond) errors.push('check failed: ' + msg); };

// ---- dialog stubs (main.js calls these through the same `dialog` object) ----
const calls = { save: 0, open: 0, box: 0, boxSync: 0 };
const next = { save: null, open: null, box: 0, boxSync: 1 };
dialog.showSaveDialog = async () => { calls.save++; return next.save ? { canceled: false, filePath: next.save } : { canceled: true }; };
dialog.showOpenDialog = async () => { calls.open++; return next.open ? { canceled: false, filePaths: [next.open] } : { canceled: true, filePaths: [] }; };
dialog.showMessageBox = async () => { calls.box++; return { response: next.box }; };
dialog.showMessageBoxSync = () => { calls.boxSync++; return next.boxSync; };

app.on('browser-window-created', (_e, win) => {
  // Electron >= 36 puts the details on the event object; older versions pass
  // (event, level, message, line, sourceId). Support both.
  win.webContents.on('console-message', (e, level, message, line, src) => {
    const msg = e && e.message != null ? e.message : message;
    const lvl = e && e.level != null ? e.level : level;
    const ln = e && e.lineNumber != null ? e.lineNumber : line;
    const source = e && e.sourceId != null ? e.sourceId : src;
    const tag = typeof lvl === 'number' ? (['debug', 'info', 'warning', 'error'][lvl] || String(lvl)) : String(lvl);
    console.log(`[renderer:${tag}] ${msg} (${path.basename(String(source))}:${ln})`);
    if (tag === 'error') errors.push(msg);
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
    const placeCube = () => js(`(() => {
      const c = document.querySelector('#viewport canvas'), r = c.getBoundingClientRect();
      const o = { clientX: r.left + r.width * 0.62, clientY: r.top + r.height * 0.3, button: 0, pointerId: 1, bubbles: true };
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true }));
      c.dispatchEvent(new PointerEvent('pointerdown', o)); c.dispatchEvent(new PointerEvent('pointerup', o));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
      return window.__ptah.ids().length;
    })()`);

    next.save = level;
    await key('KeyS', { ctrlKey: true, shiftKey: true });
    await until(() => fs.readFileSync(level, 'utf8').startsWith('#usda'), 5000, 'Save As to write the file');
    check(calls.save === 1, 'Save As showed one dialog');
    check(fs.existsSync(level + '.bak') && fs.readFileSync(level + '.bak', 'utf8') === 'OLD CONTENT', 'previous file kept as .bak');
    check(!fs.readdirSync(tmp).some(f => f.endsWith('.tmp')), 'no temp file left behind by the atomic write');
    await until(() => !/•/.test(win.getTitle()) && /level\.usda/.test(win.getTitle()), 3000, 'title after save').catch(() => {});
    check(/level\.usda/.test(win.getTitle()), 'window title names the file: ' + win.getTitle());
    check(!(await js('window.__ptah.state.dirty')), 'clean after save');

    const n0 = await placeCube();
    await key('KeyS', { ctrlKey: true });
    await until(async () => !(await js('window.__ptah.state.dirty')), 5000, 'Save to finish');
    check(calls.save === 1, 'Save to a picked path writes without a dialog');
    check(fs.readFileSync(level, 'utf8') === await js('window.__ptah.exportText()'), 'saved file matches the export');

    // saves to one file are queued: a held Ctrl+S (key repeat) must not race itself
    const race = await js(`Promise.all([1, 2, 3].map(() => window.ptah.saveUsd({ content: window.__ptah.exportText(), filePath: ${JSON.stringify(level)} })))
      .then(r => 'ok ' + r.length, e => 'error: ' + e.message)`);
    check(race === 'ok 3' && !fs.readdirSync(tmp).some(f => f.endsWith('.tmp')), 'three concurrent saves to one file all succeed (' + race + ')');

    // a path the user never picked must go through a dialog
    const forged = path.join(tmp, 'forged.usda');
    next.save = path.join(tmp, 'picked.usda');
    await js(`window.ptah.saveUsd({ content: '#usda 1.0\\n', filePath: ${JSON.stringify(forged)} })`);
    check(calls.save === 2 && !fs.existsSync(forged) && fs.existsSync(next.save), 'renderer-supplied unknown path is not written; a dialog is shown instead');

    // ---- menu forwarding (macOS menu clicks arrive as ptah:menu) ----
    win.webContents.send('ptah:menu', 'undo');
    await until(async () => (await js('window.__ptah.ids().length')) === n0 - 1, 3000, 'menu undo');
    check(true, 'menu "undo" reaches the editor history');
    win.webContents.send('ptah:menu', 'redo');
    await until(async () => (await js('window.__ptah.ids().length')) === n0, 3000, 'menu redo');
    check(true, 'menu "redo" reaches the editor history');

    // ---- close guard: dirty + Cancel keeps the window ----
    await placeCube();
    await sleep(100);
    next.boxSync = 1;                                   // Cancel
    win.close();
    await sleep(400);
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

    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (e) {
    errors.push('smoke threw: ' + e.message);
  }

  for (const s of result.steps || []) console.log('  ' + s);
  for (const k of Object.keys(result)) {
    if (k !== 'steps' && k !== 'ok') console.log(`  ${k}: ${result[k]}`);
  }
  for (const s of steps) console.log('  ' + s);

  await sleep(400);
  try {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'smoke.png'), img.toPNG());
    console.log('screenshot: test/smoke.png');
  } catch (e) { console.log('screenshot failed: ' + e.message); }

  const failed = errors.length > 0 || !result.ok;
  console.log(failed ? 'SMOKE FAIL' : 'SMOKE PASS');
  if (errors.length) console.log('errors:\n' + errors.join('\n'));
  app.exit(failed ? 1 : 0);                             // exit() skips the close guard
});
