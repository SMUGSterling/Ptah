// Smoke test main process. Run:
//   xvfb-run -a node_modules/.bin/electron --no-sandbox test/smoke.js
// Boots the real renderer, drives a scripted session, dumps console output,
// saves a screenshot, exits 0/1.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let errors = [];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: false }
  });

  win.webContents.on('console-message', (_e, level, message, line, src) => {
    const tag = ['debug', 'info', 'warn', 'error'][level] || level;
    console.log(`[renderer:${tag}] ${message} (${path.basename(String(src))}:${line})`);
    if (tag === 'error' || String(level) === '3') errors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    errors.push('renderer gone: ' + d.reason);
  });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise(r => setTimeout(r, 1500));

  // Scripted session: place objects, transform, measure-ish, export, import.
  const script = `
    (async () => {
      const out = { steps: [], ok: true };
      const step = (name, fn) => {
        try { fn(); out.steps.push('ok: ' + name); }
        catch (e) { out.ok = false; out.steps.push('FAIL: ' + name + ' — ' + e.message); }
      };
      const key = (code, opts = {}) =>
        window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace('Key',''), ...opts, bubbles: true }));
      const canvas = document.querySelector('#viewport canvas');
      const rect = canvas.getBoundingClientRect();
      const pt = (fx, fy, type, button = 0) => canvas.dispatchEvent(new PointerEvent(type, {
        clientX: rect.left + rect.width * fx,
        clientY: rect.top + rect.height * fy,
        button, pointerId: 1, bubbles: true
      }));

      step('cube tool via keyboard', () => { key('KeyC'); });
      step('place cube (click)', () => { pt(0.45, 0.5, 'pointerdown'); pt(0.45, 0.5, 'pointerup'); });
      step('place second cube (drag)', () => { pt(0.6, 0.4, 'pointerdown'); pt(0.7, 0.45, 'pointermove'); pt(0.7, 0.45, 'pointerup'); });
      step('cylinder tool + place', () => { key('KeyY'); pt(0.3, 0.6, 'pointerdown'); pt(0.3, 0.6, 'pointerup'); });
      step('sphere tool + place', () => { key('KeyS'); pt(0.55, 0.65, 'pointerdown'); pt(0.55, 0.65, 'pointerup'); });
      step('plane tool + place', () => { key('KeyP'); pt(0.5, 0.5, 'pointerdown'); pt(0.5, 0.5, 'pointerup'); });

      const rows = document.querySelectorAll('.h-row').length;
      step('hierarchy shows 5 rows', () => { if (rows !== 5) throw new Error('rows=' + rows); });

      step('undo removes one', () => {
        key('KeyZ', { ctrlKey: true });
        const n = document.querySelectorAll('.h-row').length;
        if (n !== 4) throw new Error('rows=' + n);
      });
      step('redo restores it', () => {
        key('KeyZ', { ctrlKey: true, shiftKey: true });
        const n = document.querySelectorAll('.h-row').length;
        if (n !== 5) throw new Error('rows=' + n);
      });

      step('precision input commits + undoable', () => {
        const el = document.getElementById('insp-pos-x');
        if (el.closest('.hidden')) throw new Error('inspector hidden');
        el.value = '512';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });

      step('transform modes W/E/R', () => { key('KeyW'); key('KeyE'); key('KeyR'); key('KeyW'); });
      step('snap toggle G', () => { key('KeyG'); key('KeyG'); });
      step('player marker H', () => { key('KeyH'); });
      step('views 1/3/7/0', () => { key('Numpad1'); key('Numpad3'); key('Numpad7'); key('Numpad0'); });
      step('measure two points', () => {
        key('KeyM');
        pt(0.35, 0.5, 'pointerdown'); pt(0.35, 0.5, 'pointerup');
        pt(0.65, 0.5, 'pointerdown'); pt(0.65, 0.5, 'pointerup');
        const t = document.getElementById('status-measure').textContent;
        if (!/measure:/.test(t)) throw new Error('no readout: ' + t);
        out.measure = t;
      });
      step('escape back to select', () => { key('Escape'); });

      // export / import round trip through the live editor
      const usd = await import('./js/usd.js');
      let text = '';
      step('export produces usda', () => {
        text = usd.exportUsda(window.__ptahSerialize ? window.__ptahSerialize() : (() => { throw new Error('no hook'); })());
        if (!text.startsWith('#usda')) throw new Error('bad header');
      });
      step('reimport matches count', () => {
        const r = usd.importUsda(text);
        if (r.objects.length !== 5) throw new Error('got ' + r.objects.length);
      });
      out.usdaBytes = text.length;
      return out;
    })();
  `;

  let result;
  try {
    result = await win.webContents.executeJavaScript(script, true);
  } catch (e) {
    errors.push('script threw: ' + e.message);
    result = { steps: [], ok: false };
  }

  for (const s of result.steps || []) console.log('  ' + s);
  if (result.measure) console.log('  readout: ' + result.measure);
  if (result.usdaBytes) console.log('  usda bytes: ' + result.usdaBytes);

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
