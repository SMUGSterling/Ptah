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
  const rnd = (v) => ({ x: Math.round(v.x * 1000) / 1000, y: Math.round(v.y * 1000) / 1000, z: Math.round(v.z * 1000) / 1000 });

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
  step('cube tool via keyboard', () => { key('KeyC'); assert(P.state.tool === 'place-cube', 'tool=' + P.state.tool); });
  step('place cube (click)', () => { click(0.45, 0.5); assert(byName('Cube_01'), 'no cube'); assert(sel().length === 1, 'placed object selected'); assert(!P.gizmo().attached, 'no gizmo while placing'); });
  step('place second cube (drag) follows the pointer', () => {
    pt(0.6, 0.4, 'pointerdown'); const a = wp('Cube_02'); pt(0.7, 0.45, 'pointermove'); const b = wp('Cube_02'); pt(0.7, 0.45, 'pointerup');
    assert(Math.hypot(a.x - b.x, a.z - b.z) > 1, 'drag did not move the new cube');
  });
  step('cylinder tool + place', () => { key('KeyY'); click(0.3, 0.6); assert(byName('Cylinder_01'), 'no cylinder'); });
  step('sphere tool + place', () => { key('KeyS'); click(0.55, 0.65); assert(byName('Sphere_01'), 'no sphere'); });
  step('plane tool + place rests on the ground', () => { key('KeyP'); click(0.5, 0.5); assert(byName('Plane_01') && near(wp('Plane_01').y, 0), 'plane y'); assert(near(wp('Cube_01').y, 32), 'cube rests on ground (y=32)'); });
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
  step('transform modes W/E/R', () => {
    key('KeyE'); assert(P.state.transformMode === 'rotate', 'E'); key('KeyR'); assert(P.state.transformMode === 'scale', 'R'); key('KeyW'); assert(P.state.transformMode === 'translate', 'W');
    assert(document.querySelector('[data-mode="translate"]').classList.contains('active'), 'rail button not active');
  });
  step('snap toggle G', () => { key('KeyG'); assert(P.state.snap === false && /snap off/.test(document.getElementById('status-snap').textContent), 'off'); key('KeyG'); assert(P.state.snap === true, 'on'); });
  step('player marker H', () => { key('KeyH'); assert(document.getElementById('player-toggle').classList.contains('on'), 'marker not on'); });
  step('views 1/3/7/0 move the camera', () => {
    const c0 = P.camera(); key('Numpad1'); const c1 = P.camera(); key('Numpad3'); const c3 = P.camera(); key('Numpad7'); const c7 = P.camera(); key('Numpad0');
    assert(Math.abs(c1.x) < 1 && c1.z > 0, 'front view: ' + JSON.stringify(c1));
    assert(c3.x > 0 && Math.abs(c3.z) < 1, 'right view: ' + JSON.stringify(c3));
    assert(c7.y > Math.abs(c7.x) * 100 && c7.y > Math.abs(c7.z) * 100, 'top view: ' + JSON.stringify(c7));
    void c0;
  });
  step('gizmo drag moves one object and is a single undo step', () => {
    key('Escape');                              // back to the select tool: no gizmo during placement
    clickRow('Cube_01');
    assert(P.gizmo().attached, 'gizmo not attached in select tool');
    const before = wp('Cube_01');
    const undoBefore = document.getElementById('btn-undo').disabled;
    assert(P.gizmoDrag('X', { x: 0, y: 0 }, { x: 0.15, y: 0 }), 'drag rejected');
    const after = wp('Cube_01');
    assert(Math.abs(after.x - before.x) > 1 && near(after.z, before.z, 0.01) && near(after.y, before.y, 0.01), 'did not move along X: ' + JSON.stringify([before, after]));
    assert(near(after.x % P.state.gridSize, 0, 0.01), 'moved position not on grid: ' + after.x);
    key('KeyZ', { ctrlKey: true });
    assert(near(wp('Cube_01').x, before.x, 0.01), 'undo of gizmo drag failed');
    void undoBefore;
  });
  step('gizmo drag on a multi-selection moves all through the pivot', () => {
    clickRow('Cube_01'); clickRow('Cylinder_01', { shiftKey: true });
    const a0 = wp('Cube_01'), b0 = wp('Cylinder_01');
    assert(P.gizmoDrag('Z', { x: 0, y: 0 }, { x: 0, y: -0.15 }), 'drag rejected');
    const a1 = wp('Cube_01'), b1 = wp('Cylinder_01');
    const da = a1.z - a0.z, db = b1.z - b0.z;
    assert(Math.abs(da) > 1 && near(da, db, 0.01), 'objects did not move together: ' + da + ' vs ' + db);
    key('KeyZ', { ctrlKey: true });
    assert(near(wp('Cube_01').z, a0.z, 0.01) && near(wp('Cylinder_01').z, b0.z, 0.01), 'compound undo failed');
    assert(sel().length === 2, 'selection lost after undo');
  });
  step('rotation fields use USD rotateXYZ semantics (three.js order ZYX)', () => {
    clickRow('Cube_01');
    setField('insp-rot-x', '10'); setField('insp-rot-y', '20'); setField('insp-rot-z', '30');
    const rec = P.state.objects.get(byName('Cube_01').id);
    assert(rec.node.rotation.order === 'ZYX', 'order=' + rec.node.rotation.order);
    const s = serializeAll().find(o => o.name === 'Cube_01');
    assert(near(s.rotation.x, 10) && near(s.rotation.y, 20) && near(s.rotation.z, 30), 'export angles ' + JSON.stringify(s.rotation));
    // world matrix must equal Rz*Ry*Rx (X applied first): check the image of +Z
    const v = { x: 0, y: 0, z: 1 };
    const e = rec.node.matrixWorld.elements;
    const img = { x: e[8], y: e[9], z: e[10] };   // third column = R * (0,0,1) (unit scale not assumed: normalize)
    const len = Math.hypot(img.x, img.y, img.z);
    // Rz(30)Ry(20)Rx(10) * (0,0,1) = (cos10 sin20 cos30 + sin10 sin30, cos10 sin20 sin30 - sin10 cos30, cos10 cos20)
    const d = Math.PI / 180, c10 = Math.cos(10 * d), s10 = Math.sin(10 * d), s20 = Math.sin(20 * d), c20 = Math.cos(20 * d), c30 = Math.cos(30 * d), s30 = Math.sin(30 * d);
    const exp = { x: c10 * s20 * c30 + s10 * s30, y: c10 * s20 * s30 - s10 * c30, z: c10 * c20 };
    assert(near(img.x / len, exp.x, 1e-6) && near(img.y / len, exp.y, 1e-6) && near(img.z / len, exp.z, 1e-6), 'matrix does not match Rz*Ry*Rx: ' + JSON.stringify([img, exp]));
    key('KeyZ', { ctrlKey: true }); key('KeyZ', { ctrlKey: true }); key('KeyZ', { ctrlKey: true });
    void v;
  });
  step('inspector field is committed (blurred) before a viewport click changes the selection', () => {
    // Synthetic value changes cannot dirty an input, so 'change' will not fire
    // on blur here; verify the ordering guarantee instead: at blur time the
    // selection must still be the object the field belonged to.
    clickRow('Cube_01');
    const el = document.getElementById('insp-pos-y');
    el.focus();
    let selAtBlur = null;
    el.addEventListener('blur', () => { selAtBlur = sel().slice(); }, { once: true });
    clickRow('Cylinder_01');
    assert(document.activeElement !== el, 'field still focused after selection change');
    assert(selAtBlur && selAtBlur.length === 1 && selAtBlur[0] === byName('Cube_01').id, 'blur happened after the selection moved: ' + JSON.stringify(selAtBlur));
    assert(sel()[0] === byName('Cylinder_01').id, 'cylinder not selected');
  });

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
  step('Ctrl+A selects everything; Delete removes; undo restores the exact order', () => {
    const before = ids().map(o => o.name + '<' + (o.parent ? ids().find(p => p.id === o.parent).name : '') ).join('|');
    const n = rows();
    key('KeyA', { ctrlKey: true });
    assert(sel().length === n, 'select all=' + sel().length);
    key('Delete');
    assert(rows() === 0, 'rows after delete=' + rows());
    key('KeyZ', { ctrlKey: true });
    const after = ids().map(o => o.name + '<' + (o.parent ? ids().find(p => p.id === o.parent).name : '') ).join('|');
    assert(after === before, 'order after undo differs:\n' + before + '\n' + after);
    key('KeyZ', { ctrlKey: true, shiftKey: true }); assert(rows() === 0, 'redo delete'); key('KeyZ', { ctrlKey: true });
    assert(ids().map(o => o.name).join('|') === before.replace(/<[^|]*/g, ''), 'second undo order differs');
  });
  step('deleting the parent of a selected child clears it from the selection', () => {
    clickRow('Cube_01');
    const g = rowOf('Group_01');
    g.querySelector('.h-del').click();
    assert(!byName('Group_01') && !byName('Cube_01') && sel().length === 0, 'stale selection: ' + sel().length);
    key('KeyZ', { ctrlKey: true });
    assert(byName('Cube_01') && byName('Cube_01').parent === byName('Group_01').id, 'undo delete of parent');
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
    assert(/measure: [\d.]+ u/.test(t), 'no distance readout: ' + t);
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
  step('loading the export back rebuilds the same scene, field for field', () => {
    const before = rows();
    const snap = JSON.stringify(serializeAll().map(o => ({ ...o, position: rnd(o.position), rotation: rnd(o.rotation), scale: rnd(o.scale), color: o.color && o.color.map(c => Math.round(c * 1e4) / 1e4), meshData: undefined, children: undefined })));
    const refBefore = { ...P.reference.state };
    P.loadUsdaText(text, 'roundtrip.usda');
    assert(rows() === before, 'rows after load=' + rows() + ' expected ' + before);
    const after = JSON.stringify(serializeAll().map(o => ({ ...o, position: rnd(o.position), rotation: rnd(o.rotation), scale: rnd(o.scale), color: o.color && o.color.map(c => Math.round(c * 1e4) / 1e4), meshData: undefined, children: undefined })));
    assert(after === snap, 'scene differs after reload:\n' + snap + '\n' + after);
    assert(byName('Cube_01').parent === byName('Group_01').id, 'hierarchy not rebuilt');
    const r = P.reference.state;
    assert(r.image === refBefore.image && r.width === refBefore.width && near(r.opacity, refBefore.opacity), 'reference not restored exactly');
    assert(document.getElementById('file-label').textContent.startsWith('roundtrip.usda'), 'title not updated');
    key('KeyC'); click(0.9, 0.9);
    assert(byName('Cube_03') || ids().filter(o => o.type === 'cube').length === 4, 'name counter did not advance past loaded names: ' + ids().map(o => o.name).join(','));
    key('Escape');
  });
  out.usdaBytes = text.length;
  return out;
}
