// Smoke test main process. Run:
//   xvfb-run -a node_modules/.bin/electron --no-sandbox test/smoke.js
// Boots the real renderer under Electron, drives the shared scripted session
// (test/scenario.mjs, also used by the browser runner), dumps console output,
// saves a screenshot, exits 0/1.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let errors = [];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: false }
  });

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
  win.webContents.on('render-process-gone', (_e, d) => {
    errors.push('renderer gone: ' + d.reason);
  });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.show();
  win.focus();
  win.webContents.focus();
  await new Promise(r => setTimeout(r, 1500));

  // Scripted session shared with the browser runner (test/scenario.mjs).
  const { scenario } = await import('./scenario.mjs');
  const script = '(' + scenario.toString() + ')()';

  let result;
  try {
    result = await win.webContents.executeJavaScript(script, true);
  } catch (e) {
    errors.push('script threw: ' + e.message);
    result = { steps: [], ok: false };
  }

  for (const s of result.steps || []) console.log('  ' + s);
  for (const k of Object.keys(result)) {
    if (k !== 'steps' && k !== 'ok') console.log(`  ${k}: ${result[k]}`);
  }

  await new Promise(r => setTimeout(r, 400));
  try {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'smoke.png'), img.toPNG());
    console.log('screenshot: test/smoke.png');
  } catch (e) { console.log('screenshot failed: ' + e.message); }

  const failed = errors.length > 0 || !result.ok;
  console.log(failed ? 'SMOKE FAIL' : 'SMOKE PASS');
  if (errors.length) console.log('errors:\n' + errors.join('\n'));
  app.exit(failed ? 1 : 0);
});
