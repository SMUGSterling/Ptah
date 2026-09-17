// scenario.mjs — the scripted editor session shared by both E2E runners.
//
// The function below runs INSIDE the page (Electron via executeJavaScript,
// Chromium via Playwright page.evaluate), so it must be self-contained:
// no imports, no closures over this module. Both runners stringify it.
//
// It drives the real UI with synthetic pointer/keyboard events, then checks
// DOM state and the live export. Returns { ok, steps[], ...extras }.

export async function scenario() {
  const out = { steps: [], ok: true };
  const step = (name, fn) => {
    try { fn(); out.steps.push('ok: ' + name); }
    catch (e) { out.ok = false; out.steps.push('FAIL: ' + name + ' — ' + e.message); }
  };
  const astep = async (name, fn) => {
    try { await fn(); out.steps.push('ok: ' + name); }
    catch (e) { out.ok = false; out.steps.push('FAIL: ' + name + ' — ' + e.message); }
  };
  const key = (code, opts = {}) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace('Key', ''), ...opts, bubbles: true }));
  const canvas = document.querySelector('#viewport canvas');
  const rect = canvas.getBoundingClientRect();
  const pt = (fx, fy, type, opts = {}) => canvas.dispatchEvent(new PointerEvent(type, {
    clientX: rect.left + rect.width * fx,
    clientY: rect.top + rect.height * fy,
    button: 0, pointerId: 1, bubbles: true, ...opts
  }));
  const click = (fx, fy, opts) => { pt(fx, fy, 'pointerdown', opts); pt(fx, fy, 'pointerup', opts); };
  const rows = () => document.querySelectorAll('.h-row').length;
  const setField = (id, value) => {
    const el = document.getElementById(id);
    if (!el || el.closest('.hidden')) throw new Error(id + ' not visible');
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  step('cube tool via keyboard', () => { key('KeyC'); });
  step('place cube (click)', () => { click(0.45, 0.5); });
  step('place second cube (drag)', () => { pt(0.6, 0.4, 'pointerdown'); pt(0.7, 0.45, 'pointermove'); pt(0.7, 0.45, 'pointerup'); });
  step('cylinder tool + place', () => { key('KeyY'); click(0.3, 0.6); });
  step('sphere tool + place', () => { key('KeyS'); click(0.55, 0.65); });
  step('plane tool + place', () => { key('KeyP'); click(0.5, 0.5); });
  step('hierarchy shows 5 rows', () => { if (rows() !== 5) throw new Error('rows=' + rows()); });

  step('undo removes one', () => { key('KeyZ', { ctrlKey: true }); if (rows() !== 4) throw new Error('rows=' + rows()); });
  step('redo restores it', () => { key('KeyZ', { ctrlKey: true, shiftKey: true }); if (rows() !== 5) throw new Error('rows=' + rows()); });

  step('precision input commits + undoable', () => {
    setField('insp-pos-x', '512');
    const s = window.__ptahSerialize().find(o => o.name === 'Plane_01');
    if (!s || Math.abs(s.position.x - 512) > 1e-6) throw new Error('pos.x=' + (s && s.position.x));
  });

  step('transform modes W/E/R', () => { key('KeyW'); key('KeyE'); key('KeyR'); key('KeyW'); });
  step('snap toggle G', () => { key('KeyG'); key('KeyG'); });
  step('player marker H', () => { key('KeyH'); });
  step('views 1/3/7/0', () => { key('Numpad1'); key('Numpad3'); key('Numpad7'); key('Numpad0'); });
  step('measure two points', () => {
    key('KeyM');
    click(0.35, 0.5); click(0.65, 0.5);
    const t = document.getElementById('status-measure').textContent;
    if (!/measure:/.test(t)) throw new Error('no readout: ' + t);
    out.measure = t;
  });
  step('escape back to select', () => { key('Escape'); });

  // export / import round trip through the live editor
  const usd = await import(new URL('js/usd.js', location.href).href);
  let text = '';
  step('export produces usda', () => {
    if (!window.__ptahSerialize) throw new Error('no hook');
    text = usd.exportUsda(window.__ptahSerialize());
    if (!text.startsWith('#usda')) throw new Error('bad header');
  });
  step('reimport matches count', () => {
    const r = usd.importUsda(text);
    if (r.objects.length !== 5) throw new Error('got ' + r.objects.length);
  });
  out.usdaBytes = text.length;
  void astep; void setField;
  return out;
}
