// scenario.mjs — the scripted editor session shared by both E2E runners.
//
// The function below runs INSIDE the page (Electron via executeJavaScript,
// Chromium via Playwright page.evaluate), so it must be self-contained:
// no imports, no closures over this module. Both runners stringify it.
//
// It drives the real UI with synthetic pointer/keyboard/drag events, then
// checks DOM state, the scene graph (via window.__ptah) and the live export.
// Returns { ok, steps[], ...extras }.

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
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
  const rowOf = (name) => [...document.querySelectorAll('.h-row')].find(r => r.querySelector('.h-name')?.textContent === name);
  const clickRow = (name, opts = {}) => {
    const r = rowOf(name); assert(r, 'no row ' + name);
    r.dispatchEvent(new MouseEvent('click', { bubbles: true, ...opts }));
  };
  const setField = (id, value) => {
    const el = document.getElementById(id);
    assert(el && !el.closest('.hidden') && !el.classList.contains('hidden'), id + ' not visible');
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const P = window.__ptah;
  const ids = () => P.ids();
  const byName = (name) => ids().find(o => o.name === name);
  const wp = (name) => P.worldPosition(byName(name).id);
  const sel = () => P.state.selection;
  const serializeAll = () => {
    const flat = [];
    const walk = (list) => { for (const o of list) { flat.push(o); walk(o.children || []); } };
    walk(window.__ptahSerialize());
    return flat;
  };

  // ---- primitives ---------------------------------------------------------
  step('cube tool via keyboard', () => { key('KeyC'); });
  step('place cube (click)', () => { click(0.45, 0.5); });
  step('place second cube (drag)', () => { pt(0.6, 0.4, 'pointerdown'); pt(0.7, 0.45, 'pointermove'); pt(0.7, 0.45, 'pointerup'); });
  step('cylinder tool + place', () => { key('KeyY'); click(0.3, 0.6); });
  step('sphere tool + place', () => { key('KeyS'); click(0.55, 0.65); });
  step('plane tool + place', () => { key('KeyP'); click(0.5, 0.5); });
  step('hierarchy shows 5 rows', () => { assert(rows() === 5, 'rows=' + rows()); });
  step('wedge tool + place (V)', () => { key('KeyV'); click(0.2, 0.45); assert(byName('Wedge_01'), 'no wedge'); });
  step('stairs tool + place (T)', () => { key('KeyT'); click(0.8, 0.6); assert(byName('Stairs_01'), 'no stairs'); });
  step('stairs step count edits, regenerates and undoes', () => {
    setField('insp-steps', '4');
    let s = serializeAll().find(o => o.name === 'Stairs_01');
    assert(s.params && s.params.steps === 4, 'steps=' + JSON.stringify(s.params));
    key('KeyZ', { ctrlKey: true });
    s = serializeAll().find(o => o.name === 'Stairs_01');
    assert(s.params.steps === 8, 'undo steps=' + s.params.steps);
  });

  // ---- undo / redo / inspector ---------------------------------------------
  step('undo removes one', () => { key('KeyZ', { ctrlKey: true }); assert(rows() === 6, 'rows=' + rows()); });
  step('redo restores it', () => { key('KeyZ', { ctrlKey: true, shiftKey: true }); assert(rows() === 7, 'rows=' + rows()); });
  step('precision input commits', () => {
    clickRow('Plane_01');
    setField('insp-pos-x', '512');
    const s = serializeAll().find(o => o.name === 'Plane_01');
    assert(near(s.position.x, 512), 'pos.x=' + s.position.x);
  });
  step('transform modes W/E/R', () => { key('KeyW'); key('KeyE'); key('KeyR'); key('KeyW'); });
  step('snap toggle G', () => { key('KeyG'); key('KeyG'); });
  step('player marker H', () => { key('KeyH'); });
  step('views 1/3/7/0', () => { key('Numpad1'); key('Numpad3'); key('Numpad7'); key('Numpad0'); });

  // ---- multi-select & grouping -------------------------------------------------
  let c1, c2;
  step('shift-click rows builds a multi-selection', () => {
    clickRow('Cube_01');
    clickRow('Cube_02', { shiftKey: true });
    assert(sel().length === 2, 'selection=' + sel().length);
    assert(!document.getElementById('insp-multi').classList.contains('hidden'), 'multi label hidden');
    c1 = wp('Cube_01'); c2 = wp('Cube_02');
  });
  step('Ctrl+G groups; children keep world position', () => {
    key('KeyG', { ctrlKey: true });
    const g = byName('Group_01');
    assert(g && g.type === 'group', 'no group');
    assert(byName('Cube_01').parent === g.id && byName('Cube_02').parent === g.id, 'children not under group');
    const a = wp('Cube_01'), b = wp('Cube_02');
    assert(near(a.x, c1.x) && near(a.z, c1.z) && near(b.x, c2.x) && near(b.z, c2.z), 'world pos changed');
    assert(sel().length === 1 && sel()[0] === g.id, 'group not selected');
    assert(rows() === 8, 'rows=' + rows());
  });
  step('moving the group moves its children', () => {
    setField('insp-pos-x', String(Math.round(Number(document.getElementById('insp-pos-x').value)) + 128));
    const a = wp('Cube_01');
    assert(near(a.x, c1.x + 128), 'child x=' + a.x + ' expected ' + (c1.x + 128));
  });
  step('undo x2 removes group and restores positions; redo x2 brings it back', () => {
    key('KeyZ', { ctrlKey: true }); key('KeyZ', { ctrlKey: true });
    assert(!byName('Group_01'), 'group still there');
    assert(near(wp('Cube_01').x, c1.x) && byName('Cube_01').parent === null, 'cube not restored');
    key('KeyZ', { ctrlKey: true, shiftKey: true }); key('KeyZ', { ctrlKey: true, shiftKey: true });
    assert(byName('Group_01') && near(wp('Cube_01').x, c1.x + 128), 'redo failed');
  });
  step('collapse caret hides children rows', () => {
    const r = rowOf('Group_01');
    r.querySelector('.h-caret').click();
    assert(rows() === 6, 'rows after collapse=' + rows());
    rowOf('Group_01').querySelector('.h-caret').click();
    assert(rows() === 8, 'rows after expand=' + rows());
  });
  step('rotated parent: child world transform follows, local stays', () => {
    clickRow('Group_01');
    setField('insp-rot-y', '90');
    const s = serializeAll().find(o => o.name === 'Group_01');
    assert(near(s.rotation.y, 90), 'group rot=' + s.rotation.y);
    const child = s.children.find(o => o.name === 'Cube_01');
    assert(child && near(child.rotation.y, 0), 'child local rotation should stay 0, got ' + child.rotation.y);
    key('KeyZ', { ctrlKey: true });
  });
  step('duplicate a group deep-copies the subtree', () => {
    clickRow('Group_01');
    key('KeyD', { ctrlKey: true });
    const g2 = byName('Group_01_copy');
    assert(g2, 'no copy');
    assert(byName('Cube_01_copy') && byName('Cube_01_copy').parent === g2.id, 'children not copied');
    assert(rows() === 11, 'rows=' + rows());
    key('KeyZ', { ctrlKey: true });
    assert(!byName('Group_01_copy') && rows() === 8, 'undo duplicate failed');
  });
  step('drag & drop reparents in the hierarchy', () => {
    const src = rowOf('Sphere_01'), dst = rowOf('Group_01');
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = dst.getBoundingClientRect();
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: r.top + r.height / 2 }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientY: r.top + r.height / 2 }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    assert(byName('Sphere_01').parent === byName('Group_01').id, 'sphere not reparented: ' + byName('Sphere_01').parent);
    key('KeyZ', { ctrlKey: true });
    assert(byName('Sphere_01').parent === null, 'undo reparent failed');
  });
  step('drop before a row reorders siblings', () => {
    const src = rowOf('Stairs_01'), dst = rowOf('Cylinder_01');
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = dst.getBoundingClientRect();
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: r.top + 2 }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientY: r.top + 2 }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    const names = [...document.querySelectorAll('.h-row .h-name')].map(n => n.textContent);
    assert(names.indexOf('Stairs_01') === names.indexOf('Cylinder_01') - 1, 'order: ' + names.join(','));
    assert(byName('Stairs_01').parent === null, 'stairs should stay at root');
  });
  step('multi-drag keeps order and lands before the target', () => {
    // root order right now: Group_01, Stairs_01, Cylinder_01, Sphere_01, Plane_01, Wedge_01 (roughly)
    clickRow('Cylinder_01'); clickRow('Wedge_01', { shiftKey: true });
    const src = rowOf('Cylinder_01'), dst = rowOf('Group_01');
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = dst.getBoundingClientRect();
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: r.top + 1 }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientY: r.top + 1 }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    const roots = ids().filter(o => o.parent === null).map(o => o.name);
    assert(roots[0] === 'Cylinder_01' && roots[1] === 'Wedge_01' && roots[2] === 'Group_01', 'root order: ' + roots.join(','));
    key('KeyZ', { ctrlKey: true });
    const after = ids().filter(o => o.parent === null).map(o => o.name);
    assert(after[0] === 'Group_01', 'undo multi-move failed: ' + after.join(','));
  });
  step('Ctrl+Shift+G ungroups keeping world positions', () => {
    clickRow('Group_01');
    key('KeyG', { ctrlKey: true, shiftKey: true });
    assert(!byName('Group_01'), 'group remains');
    assert(byName('Cube_01').parent === null && near(wp('Cube_01').x, c1.x + 128), 'ungroup moved things');
    assert(sel().length === 2, 'freed children should be selected');
    key('KeyZ', { ctrlKey: true });
    assert(byName('Group_01') && byName('Cube_01').parent === byName('Group_01').id, 'undo ungroup failed');
  });
  step('marquee box-select picks several objects', () => {
    key('Escape');
    pt(0.1, 0.2, 'pointerdown'); pt(0.5, 0.5, 'pointermove'); pt(0.95, 0.95, 'pointermove'); pt(0.95, 0.95, 'pointerup');
    assert(sel().length >= 3, 'marquee selected ' + sel().length);
  });
  step('eye toggle hides the node and its subtree, undoable', () => {
    const row = rowOf('Group_01');
    row.querySelector('.h-eye').click();
    const g = P.state.objects.get(byName('Group_01').id);
    assert(g.visible === false && g.node.visible === false, 'group still visible');
    assert(rowOf('Cube_01').classList.contains('hidden-obj'), 'child row not dimmed');
    key('KeyZ', { ctrlKey: true });
    assert(g.node.visible === true, 'undo show failed');
  });
  step('click on empty space clears selection', () => { click(0.02, 0.02); assert(sel().length === 0, 'sel=' + sel().length); });
  step('Ctrl+A selects everything; Delete removes; undo restores', () => {
    const before = rows();
    key('KeyA', { ctrlKey: true });
    assert(sel().length === before, 'select all=' + sel().length);
    key('Delete');
    assert(rows() === 0, 'rows after delete=' + rows());
    key('KeyZ', { ctrlKey: true });
    assert(rows() === before, 'rows after undo=' + rows());
  });
  step('multi-color applies to all selected', () => {
    clickRow('Cube_01'); clickRow('Wedge_01', { shiftKey: true });
    document.querySelectorAll('#insp-swatches .swatch')[3].click();
    const s = serializeAll();
    const lapis = (o) => o.color && o.color[2] > 0.8;
    assert(lapis(s.find(o => o.name === 'Wedge_01')), 'wedge not recolored');
    const cube = (function find(list) { for (const o of list) { if (o.name === 'Cube_01') return o; const f = find(o.children || []); if (f) return f; } })(window.__ptahSerialize());
    assert(lapis(cube), 'cube not recolored');
  });

  // ---- notes ----------------------------------------------------------------
  step('note tool pins a note and edits its text', () => {
    key('KeyN');
    click(0.15, 0.85);
    const n = byName('Note_01');
    assert(n && n.type === 'note', 'no note');
    assert(document.activeElement && document.activeElement.id === 'insp-text', 'note text should take focus for typing');
    setField('insp-text', 'Player spawns here.\nFirst sightline to the tower.');
    setField('insp-name', 'Spawn');
    document.activeElement.blur();          // a real click on the viewport does this
    const s = serializeAll().find(o => o.type === 'note');
    assert(s.name === 'Spawn' && s.text.includes('\n'), 'note text: ' + JSON.stringify(s));
    assert(P.state.tool === 'select', 'should return to select tool');
  });

  // ---- measure ----------------------------------------------------------------
  step('measure two points', () => {
    key('KeyM');
    click(0.35, 0.5); click(0.65, 0.5);
    const t = document.getElementById('status-measure').textContent;
    assert(/measure:/.test(t), 'no readout: ' + t);
    out.measure = t;
  });
  step('escape back to select', () => { key('Escape'); });

  // ---- walk mode ------------------------------------------------------------------
  step('Tab enters walk mode at eye height; WASD moves; Esc restores camera', () => {
    const before = P.camera();
    key('Tab');
    assert(P.walk.active, 'walk not active');
    const eye = P.camera();
    assert(eye.y > 140 && eye.y < 200, 'eye height ' + eye.y);
    assert(!document.getElementById('walk-hud').classList.contains('hidden'), 'HUD hidden');
    P.walk._press('KeyW'); P.walk.update(0.5); P.walk._release('KeyW');
    const moved = P.camera();
    assert(Math.hypot(moved.x - eye.x, moved.z - eye.z) > 50, 'did not move');
    key('Escape');
    assert(!P.walk.active, 'walk still active');
    const after = P.camera();
    assert(near(after.x, before.x, 0.5) && near(after.y, before.y, 0.5) && near(after.z, before.z, 0.5), 'camera not restored');
  });

  // ---- reference image ------------------------------------------------------------
  await astep('reference image loads, embeds, exports and undoes', async () => {
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 160;
    const g = cv.getContext('2d');
    g.fillStyle = '#446'; g.fillRect(0, 0, 320, 160);
    g.fillStyle = '#fc6'; g.fillRect(40, 40, 120, 80);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const file = new File([blob], 'floorplan.png', { type: 'image/png' });
    await P.reference.loadFile(file);
    await sleep(150);
    const st = P.reference.state;
    assert(st.image && st.image.startsWith('data:image/'), 'no embedded image');
    assert(!document.getElementById('reference-body').classList.contains('hidden'), 'reference panel not shown');
    setField('ref-width', '1024');
    assert(P.reference.state.width === 1024, 'width=' + P.reference.state.width);
    const text = P.exportText();
    assert(text.includes('"ptah:reference"') && text.includes('double width = 1024'), 'reference missing from export');
    key('KeyZ', { ctrlKey: true });
    assert(P.reference.state.width !== 1024, 'undo width failed');
    key('KeyZ', { ctrlKey: true });
    assert(!P.reference.state.image, 'undo image failed');
    key('KeyZ', { ctrlKey: true, shiftKey: true });
    assert(P.reference.state.image, 'redo image failed');
  });

  // ---- export / import round trip through the live editor ---------------------------
  const usd = await import(new URL('js/usd.js', location.href).href);
  let text = '';
  step('export produces usda', () => {
    text = P.exportText();
    assert(text.startsWith('#usda'), 'bad header');
  });
  step('reimport matches object count and hierarchy', () => {
    const r = usd.importUsda(text);
    const total = usd.countObjects(r.objects);
    assert(total === rows(), 'got ' + total + ' expected ' + rows());
    const grp = r.objects.find(o => o.name === 'Group_01');
    assert(grp && grp.children.length === 2, 'group children lost');
    assert(r.objects.some(o => o.type === 'note' && o.name === 'Spawn'), 'note lost');
    assert(r.reference && r.reference.image, 'reference lost');
  });
  step('loading the export back rebuilds the same scene', () => {
    const before = rows();
    P.loadUsdaText(text, 'roundtrip.usda');
    assert(rows() === before, 'rows after load=' + rows() + ' expected ' + before);
    assert(byName('Cube_01').parent === byName('Group_01').id, 'hierarchy not rebuilt');
    assert(P.reference.state.image, 'reference not restored');
    assert(document.getElementById('file-label').textContent.startsWith('roundtrip.usda'), 'title not updated');
  });
  out.usdaBytes = text.length;
  return out;
}
