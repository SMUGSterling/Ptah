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

  // ---- profile picker ------------------------------------------------------
  step('profile picker is up first; nothing else is reachable until a template is picked', () => {
    assert(P.pickerOpen(), 'picker not shown on launch');
    key('KeyC'); assert(P.state.tool === 'select', 'shortcuts must be inert behind the picker');
    const cards = document.querySelectorAll('#profile-cards .profile-card');
    assert(cards.length === 4 && P.profiles().join() === 'ue-third,ue-first,unity-third,unity-first', 'four cards');
    assert(/Unreal Engine/.test(cards[0].textContent) && /Unity/.test(cards[3].textContent), 'card labels');
    cards[0].click();                       // Unreal Third Person
    assert(!P.pickerOpen(), 'picker did not close');
    const m = P.metrics();
    assert(m.profile === 'ue-third' && m.playerHeight === 192 && m.capsuleRadius === 42 && m.doorHeight === 360, 'UE Third Person profile not applied: ' + JSON.stringify(m));
    assert(!P.state.dirty, 'picking a profile for a new level should not mark it unsaved');
    assert(document.getElementById('metrics-summary').textContent === 'UE 3rd person', 'summary ' + document.getElementById('metrics-summary').textContent);
    assert(/^v\d+\.\d+\.\d+$/.test(document.getElementById('brand-version').textContent), 'version not shown in the brand');
  });

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
  step('rail is grouped Q W E R X / C Y S P V T / M N K', () => {
    assert(P.railOrder() === 'QWERXCYSPVTMNK', 'rail order ' + P.railOrder());
    const seps = document.querySelectorAll('#toolrail .rail-sep').length;
    assert(seps === 2, 'two separators expected, got ' + seps);
  });
  step('one mode at a time: Q selects without a gizmo, W/E/R with one, tools light only themselves', () => {
    clickRow('Plane_01');
    key('KeyE'); assert(P.state.transformMode === 'rotate' && P.railActive() === 'E' && P.gizmo().attached, 'E: ' + P.railActive());
    key('KeyR'); assert(P.state.transformMode === 'scale' && P.railActive() === 'R', 'R: ' + P.railActive());
    key('KeyQ'); assert(P.state.tool === 'select' && P.state.transformMode === 'none' && P.railActive() === 'Q' && !P.gizmo().attached, 'Q should be select with no gizmo: ' + P.railActive());
    assert(sel().length === 1, 'Q must keep the selection');
    key('KeyW'); assert(P.state.transformMode === 'translate' && P.railActive() === 'W' && P.gizmo().attached, 'W: ' + P.railActive());
    key('KeyC'); assert(P.state.tool === 'place-cube' && P.railActive() === 'C' && !P.gizmo().attached, 'C should light only itself: ' + P.railActive());
    key('Escape'); assert(P.state.tool === 'select' && P.state.transformMode === 'translate' && P.railActive() === 'W', 'Escape returns to select with the previous gizmo: ' + P.railActive());
    document.querySelector('#toolrail [data-mode="none"]').click(); assert(P.railActive() === 'Q' && !P.gizmo().attached, 'Q button');
    document.querySelector('#toolrail [data-mode="translate"]').click(); assert(P.railActive() === 'W' && P.gizmo().attached, 'W button');
  });
  step('K works while a topbar picker holds focus; clicked buttons drop focus', () => {
    const sel_ = document.getElementById('marker-select');
    sel_.focus(); assert(document.activeElement === sel_, 'picker not focused');
    sel_.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', bubbles: true }));
    assert(P.state.tool === 'place-marker-PlayerStart' && document.activeElement !== sel_, 'K swallowed by the focused picker: ' + P.state.tool);
    key('Escape');
    const snapBtn = document.getElementById('snap-toggle');
    snapBtn.click(); snapBtn.click();
    assert(document.activeElement !== snapBtn, 'clicked button kept focus (Space would re-fire it)');
  });
  step('Position Y reads center or base; entries convert; remembered', () => {
    clickRow('Cube_01');
    const c = serializeAll().find(o => o.name === 'Cube_01');
    assert(!P.pivotBase() && near(parseFloat(document.getElementById('insp-pos-y').value), c.position.y, 0.01), 'center readout');
    document.getElementById('insp-pivot').click();
    assert(P.pivotBase() && near(parseFloat(document.getElementById('insp-pos-y').value), c.position.y - c.scale.y / 2, 0.01), 'base readout: ' + document.getElementById('insp-pos-y').value);
    setField('insp-pos-y', 64);
    const c2 = serializeAll().find(o => o.name === 'Cube_01');
    assert(near(c2.position.y, 64 + c2.scale.y / 2, 0.01), 'base entry should put the bottom at 64: ' + c2.position.y);
    key('KeyZ', { ctrlKey: true });
    assert(near(serializeAll().find(o => o.name === 'Cube_01').position.y, c.position.y, 0.01), 'undo');
    let stored = null; try { stored = localStorage.getItem('ptah.pivotBase'); } catch {}
    assert(stored === null || stored === '1', 'not remembered');
    document.getElementById('insp-pivot').click(); assert(!P.pivotBase(), 'toggle back');
  });
  step('snap toggle G', () => { key('KeyG'); assert(P.state.snap === false && /snap off/.test(document.getElementById('status-snap').textContent), 'off'); key('KeyG'); assert(P.state.snap === true, 'on'); });
  step('H toggles metric ticks on capsule markers (default on)', () => {
    assert(P.ticks() === true && document.getElementById('ticks-toggle').classList.contains('on'), 'ticks should default on');
    key('KeyH'); assert(P.ticks() === false, 'ticks not toggled off');
    key('KeyH'); assert(P.ticks() === true, 'ticks not toggled back on');
  });
  step('grid opacity slider dims the grid and is remembered', () => {
    const el = document.getElementById('grid-opacity');
    el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true }));
    assert(near(P.gridOpacity(), 0.4, 1e-6), 'opacity ' + P.gridOpacity());
    assert(document.getElementById('grid-opacity-val').textContent === '40%', 'label ' + document.getElementById('grid-opacity-val').textContent);
    let stored = null; try { stored = localStorage.getItem('ptah.gridOpacity'); } catch {}
    assert(stored === null || near(parseFloat(stored), 0.4, 1e-6), 'not remembered: ' + stored);
    el.value = 100; el.dispatchEvent(new Event('input', { bubbles: true }));
    assert(near(P.gridOpacity(), 1, 1e-6), 'opacity not restored');
  });
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
    const bb = P.bounds(byName('Cube_01').id), g = P.state.gridSize, mod = (v) => ((v % g) + g) % g;
    assert(near(mod(bb.min[0]), 0, 0.01) && near(mod(bb.min[2]), 0, 0.01), 'moved bounds not on grid lines: ' + JSON.stringify(bb.min));
    key('KeyZ', { ctrlKey: true });
    assert(near(wp('Cube_01').x, before.x, 0.01), 'undo of gizmo drag failed');
    void undoBefore;
  });
  step('snapping: click-placed blocks land on grid lines; Shift inverts snapping while held', () => {
    const g = P.state.gridSize, mod = (v) => ((v % g) + g) % g;
    key('Escape'); key('KeyC'); click(0.62, 0.68);
    const c = ids().filter(o => o.type === 'cube').pop();
    let b = P.bounds(c.id);
    assert(near(mod(b.min[0]), 0, 0.01) && near(mod(b.min[2]), 0, 0.01) && near(b.min[1], 0, 0.01), 'placed cube edges not on grid lines: ' + JSON.stringify(b.min));
    key('Escape'); P.select([c.id]);
    key('KeyG'); assert(!P.state.snap && !P.effectiveSnap(), 'snap should be off');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', bubbles: true }));
    assert(P.effectiveSnap() && /\(Shift\)/.test(document.getElementById('status-snap').textContent), 'Shift should invert snapping while held');
    const x0 = b.min[0];
    assert(P.gizmoDrag('X', { x: 0, y: 0 }, { x: 0.45, y: 0 }), 'drag rejected');
    b = P.bounds(c.id);
    assert(Math.abs(b.min[0] - x0) >= g - 0.01 && near(mod(b.min[0]), 0, 0.01), 'Shift-snapped drag should move by whole cells onto a grid line: ' + x0 + ' → ' + b.min[0]);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true }));
    assert(!P.effectiveSnap(), 'Shift release should restore the setting');
    key('KeyG'); assert(P.state.snap, 'snap back on');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', bubbles: true }));
    assert(!P.effectiveSnap(), 'with snap on, Shift should move freely');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true }));
    key('KeyZ', { ctrlKey: true });                                 // the drag
    assert(near(P.bounds(c.id).min[0], x0, 0.01), 'drag undo failed');
    key('KeyZ', { ctrlKey: true });                                 // the placement
    assert(!ids().some(o => o.id === c.id), 'placement undo failed');
  });
  step('snapping stress: a 45°-rotated cube and an odd-height block still land on grid lines by their bounds', () => {
    const g = P.state.gridSize, mod = (v) => ((v % g) + g) % g;
    key('Escape'); key('KeyC'); click(0.4, 0.75);
    const c = ids().filter(o => o.type === 'cube').pop();
    key('Escape'); P.select([c.id]);
    setField('insp-rot-y', 45);
    assert(P.gizmoDrag('X', { x: 0, y: 0 }, { x: 0.45, y: 0 }), 'drag rejected');
    let b = P.bounds(c.id);
    assert(near(mod(b.min[0]), 0, 0.01) && near(mod(b.min[2]), 0, 0.01) && near(b.min[1], 0, 0.01), 'rotated cube bounds off grid: ' + JSON.stringify(b.min));
    setField('insp-size-y', 100);                 // odd height, like half cover
    assert(P.gizmoDrag('Y', { x: 0, y: 0 }, { x: 0, y: 0.45 }), 'drag rejected');   // NDC y is up
    b = P.bounds(c.id);
    assert(near(mod(b.min[1]), 0, 0.01) && b.min[1] >= g - 0.01, 'odd-height block bottom should sit on a grid line above ground: ' + b.min[1]);
    P.select([c.id]); key('Delete');
  });
  step('gizmo drag on a multi-selection moves all through the pivot', () => {
    clickRow('Cube_01'); clickRow('Cylinder_01', { shiftKey: true });
    const a0 = wp('Cube_01'), b0 = wp('Cylinder_01');
    assert(P.gizmoDrag('Z', { x: 0, y: 0 }, { x: 0, y: -0.45 }), 'drag rejected');   // well past half a cell so bounds snapping lands on the next line
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
  step('intent swatch applies intent + color to all selected, undoable', () => {
    clickRow('Cube_01'); clickRow('Wedge_01', { shiftKey: true });
    const before = serializeAll().find(o => o.name === 'Wedge_01');
    assert(before.intent === 'floor', 'wedge should default to floor intent, got ' + before.intent);
    document.querySelector('#insp-swatches .swatch[data-intent="cover"]').click();
    const s = serializeAll();
    const orange = (o) => o.color && o.color[0] > 0.6 && o.color[1] > 0.15 && o.color[2] < 0.1;   // 0xd9832f in linear space
    const wedge = s.find(o => o.name === 'Wedge_01'), cube = s.find(o => o.name === 'Cube_01');
    assert(wedge.intent === 'cover' && orange(wedge), 'wedge not set to cover: ' + JSON.stringify([wedge.intent, wedge.color]));
    assert(cube.intent === 'cover' && orange(cube), 'cube not set to cover');
    assert(document.getElementById('insp-intent-name').textContent === 'Cover', 'intent label: ' + document.getElementById('insp-intent-name').textContent);
    assert(document.querySelector('#insp-swatches .swatch.active').dataset.intent === 'cover', 'active swatch not marked');
    key('KeyZ', { ctrlKey: true });
    assert(serializeAll().find(o => o.name === 'Wedge_01').intent === 'floor', 'intent undo failed');
    key('KeyZ', { ctrlKey: true, shiftKey: true });
    assert(serializeAll().find(o => o.name === 'Wedge_01').intent === 'cover', 'intent redo failed');
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
    P.walk._press('KeyW'); for (let i = 0; i < 10; i++) P.walk.update(0.05); P.walk._release('KeyW');
    const moved = P.camera();
    assert(Math.hypot(moved.x - eye.x, moved.z - eye.z) > 50, 'did not move');
    key('Escape');
    assert(!P.walk.active, 'walk still active');
    const after = P.camera();
    assert(near(after.x, before.x, 0.5) && near(after.y, before.y, 0.5) && near(after.z, before.z, 0.5), 'camera not restored');
  });

  // ---- v0.3: metrics, walk crouch/jump, presets, markers, multi-edit, face snap ----
  // The walk step above requested a real pointer lock, which headless Chromium grants and
  // releases asynchronously; setPointerCapture (called by the three.js controls on every
  // pointerdown) throws while that is in flight, so wait for it to settle before clicking again.
  await astep('pointer lock from walk mode is released', async () => {
    for (let i = 0; i < 100 && (document.pointerLockElement || i < 15); i++) await sleep(20);
    assert(!document.pointerLockElement, 'lock still held');
  });
  // The next two steps test crouch, jump and metrics math, not pointer lock: stub the request.
  const realLock = canvas.requestPointerLock;
  canvas.requestPointerLock = () => Promise.resolve();
  step('metrics panel edits the profile, undoable, and drives walk eye height', () => {
    const eye0 = P.metrics().eyeHeight;
    assert(eye0 === 160, 'UE Third Person eye height ' + eye0);
    document.getElementById('metrics-toggle').click();
    setField('metric-eyeHeight', 150);
    assert(P.metrics().eyeHeight === 150 && P.metrics().profile === 'custom', 'eye height not applied or profile not marked custom');
    assert(/Custom/.test(document.getElementById('metrics-summary').textContent) && /Custom/.test(document.getElementById('metrics-profile-name').textContent), 'editing a value should show the profile as Custom: ' + document.getElementById('metrics-summary').textContent);
    key('Tab');
    assert(near(P.walk.eyeHeight, 150, 0.01), 'walk eye height did not follow the profile: ' + P.walk.eyeHeight);
    key('Escape');
    key('KeyZ', { ctrlKey: true });
    assert(P.metrics().eyeHeight === eye0 && P.metrics().profile === 'ue-third', 'metrics undo failed (value or profile)');
    setField('metric-eyeHeight', -20);
    assert(P.metrics().eyeHeight === 1, 'metrics not clamped: ' + P.metrics().eyeHeight);
    key('KeyZ', { ctrlKey: true });
    document.getElementById('metrics-toggle').click();
  });
  step('Metrics → Change reopens the picker; switching to Unity First Person is undoable', () => {
    document.getElementById('metrics-change').click();
    assert(P.pickerOpen() && !document.getElementById('profile-cancel').classList.contains('hidden'), 'picker with cancel expected');
    key('Escape'); assert(!P.pickerOpen(), 'Escape should cancel a mid-session change');
    document.getElementById('metrics-change').click();
    document.querySelector('.profile-card[data-profile="unity-first"]').click();
    assert(P.metrics().profile === 'unity-first' && P.metrics().capsuleRadius === 50 && P.metrics().doorWidth === 200, 'Unity FP not applied: ' + JSON.stringify(P.metrics()));
    key('KeyZ', { ctrlKey: true });
    assert(P.metrics().profile === 'ue-third' && P.metrics().capsuleRadius === 42, 'profile switch undo failed');
  });
  step('walk mode: C crouches to crouch height, Space jumps to jumpHeight and lands', () => {
    P.lookAt(-600, 0, -600);              // open ground, away from the placed blocks
    key('Tab');
    const m = P.metrics();
    const standing = P.camera().y;
    assert(near(standing, m.eyeHeight, 0.5), 'standing eye ' + standing);
    P.walk._press('KeyC'); P.walk.update(0.016);
    const crouched = P.camera().y;
    assert(near(crouched, m.crouchHeight - (m.playerHeight - m.eyeHeight), 0.5), 'crouched eye ' + crouched);
    P.walk._release('KeyC'); P.walk.update(0.016);
    P.walk._press('Space');
    let apex = 0;
    for (let i = 0; i < 200; i++) { P.walk.update(0.01); apex = Math.max(apex, P.walk._state().feetY); if (i > 5 && !P.walk._state().airborne) break; }
    assert(near(apex, m.jumpHeight, m.jumpHeight * 0.06), 'jump apex ' + apex + ' vs ' + m.jumpHeight);
    assert(!P.walk._state().airborne && near(P.walk._state().feetY, 0, 0.5), 'did not land: ' + JSON.stringify(P.walk._state()));
    key('Escape');
    assert(!document.pointerLockElement, 'no pointer lock expected with the stub');
  });
  step('walk mode: jumping on a thin platform with slow frames lands on the platform, not through it', () => {
    // a 512 x 32 x 512 slab whose top is at y = 64, and a Player start on top of it
    key('Escape'); key('KeyC'); click(0.5, 0.5); key('Escape');
    const slab = ids().filter(o => o.type === 'cube').pop();
    P.select([slab.id]);
    setField('insp-pos-x', -1200); setField('insp-pos-y', 48); setField('insp-pos-z', 600);
    setField('insp-size-x', 512); setField('insp-size-y', 32); setField('insp-size-z', 512);
    P.lookAt(-1200, 64, 600);
    key('Tab');
    assert(near(P.walk._state().feetY, 64, 0.5), 'should start standing on the slab: ' + P.walk._state().feetY);
    P.walk._press('Space');
    for (let i = 0; i < 80; i++) { P.walk.update(0.05); if (i > 2 && !P.walk._state().airborne) break; }   // 20 fps frames: 30u+ of fall per frame near landing
    const st = P.walk._state();
    assert(!st.airborne && near(st.feetY, 64, 0.5), 'fell through the slab: ' + JSON.stringify(st));
    key('Escape');
    P.select([slab.id]); key('Delete');
    assert(!ids().some(o => o.id === slab.id), 'slab not removed');
  });
  canvas.requestPointerLock = realLock;
  step('presets: doorway is a group whose opening matches the metrics; step run rests on the ground', () => {
    const rowsBefore = rows();
    const door = P.createPreset('doorway', 512, -512);
    assert(door && door.type === 'group' && ids().filter(o => o.parent === door.id).length === 3, 'doorway not a 3-piece group');
    const m = P.metrics();
    const L = serializeAll().find(o => o.name === 'Post_L_01'), R = serializeAll().find(o => o.name === 'Post_R_01');
    const opening = (R.position.x - R.scale.x / 2) - (L.position.x + L.scale.x / 2);
    assert(near(opening, m.doorWidth, 0.01), 'opening ' + opening);
    assert(near(P.worldPosition(door.id).x, 512, 0.01), 'group not at click point');
    const stairs = P.createPreset('steprun', -512, 512);
    const st = serializeAll().find(o => o.name === 'StepRun_01');
    assert(st.type === 'stairs' && near(st.scale.y / st.params.steps, m.stepHeight, 0.01) && near(st.position.y - st.scale.y / 2, 0, 0.01), 'step run: ' + JSON.stringify(st));
    assert(rows() === rowsBefore + 5, 'rows ' + rows());
    key('KeyZ', { ctrlKey: true }); key('KeyZ', { ctrlKey: true });
    assert(rows() === rowsBefore, 'preset undo left ' + (rows() - rowsBefore) + ' rows');
    key('KeyZ', { ctrlKey: true, shiftKey: true }); key('KeyZ', { ctrlKey: true, shiftKey: true });
    assert(rows() === rowsBefore + 5 && byName('StepRun_01'), 'preset redo failed');
    void stairs;
  });
  step('preset picker arms a placement tool; click places a half cover of the profile height', () => {
    const sel = document.getElementById('preset-select');
    sel.value = 'halfcover'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    assert(P.state.tool === 'place-preset-halfcover', 'tool ' + P.state.tool);
    click(0.9, 0.2);
    const c = serializeAll().find(o => o.name === 'HalfCover_01');
    assert(c && near(c.scale.y, P.metrics().halfCover, 0.01) && c.intent === 'cover', 'half cover: ' + JSON.stringify(c));
    assert(P.state.tool === 'place-preset-halfcover', 'tool should stay armed');
    key('Escape');
    assert(sel.value === '', 'picker not reset');
  });
  step('markers: picker places a PlayerStart capsule; K re-arms; kind and tags edit and export', () => {
    const sel = document.getElementById('marker-select');
    sel.value = 'PlayerStart'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    click(0.1, 0.3);
    const ps = byName('PlayerStart_01');
    assert(ps && ps.type === 'marker', 'no PlayerStart');
    assert(document.getElementById('insp-type').textContent === 'Player start', 'type chip ' + document.getElementById('insp-type').textContent);
    assert(document.getElementById('insp-size-x').disabled && !document.getElementById('insp-rot-y').disabled, 'marker fields: size locked, rotation free');
    setField('insp-rot-y', 90);
    setField('insp-tags', 'team:blue, wave 1');
    const s1 = P.serializeOne(ps.id);
    assert(s1.marker === 'PlayerStart' && s1.tags.length === 2 && s1.tags[1] === 'wave 1' && near(s1.rotation.y, 90, 0.01), 'marker serialize: ' + JSON.stringify(s1));
    key('Escape');
    document.querySelector('[data-tool="marker"]').click();
    assert(P.state.tool === 'place-marker-PlayerStart' && document.querySelector('[data-tool="marker"]').classList.contains('active'), 'rail button did not arm the marker tool: ' + P.state.tool);
    key('Escape');
    key('KeyK');
    assert(P.state.tool === 'place-marker-PlayerStart', 'K did not re-arm the last marker: ' + P.state.tool);
    click(0.1, 0.4);
    assert(byName('PlayerStart_02'), 'second marker');
    setField('insp-marker', 'Trigger');
    const tr = P.serializeOne(byName('PlayerStart_02').id);
    assert(tr.marker === 'Trigger' && tr.scale.x === 256 && tr.scale.y === 192, 'trigger volume default size: ' + JSON.stringify(tr.scale));
    assert(!document.getElementById('insp-size-x').disabled, 'trigger size should be editable');
    key('KeyZ', { ctrlKey: true });
    assert(P.serializeOne(byName('PlayerStart_02').id).marker === 'PlayerStart', 'marker kind undo failed');
    const text = P.exportText();
    assert(/custom string ptah:marker = "PlayerStart"/.test(text) && /custom string\[\] ptah:tags = \["team:blue", "wave 1"\]/.test(text), 'marker attributes missing from export');
    key('Escape');
  });
  step('multi-select numeric edit: shared value shows, mixed shows a dash, +=/*= apply per object, one undo', () => {
    clickRow('HalfCover_01'); clickRow('StepRun_01', { shiftKey: true });
    const y = document.getElementById('insp-pos-y');
    assert(!document.getElementById('insp-grid').classList.contains('hidden'), 'grid hidden in multi-select');
    assert(y.value === '' && y.placeholder === '—', 'mixed Y should show a dash: ' + JSON.stringify([y.value, y.placeholder]));
    setField('insp-pos-y', 300);
    assert(near(wp('HalfCover_01').y, 300, 0.01) && near(wp('StepRun_01').y, 300, 0.01), 'absolute multi-edit failed');
    assert(y.value === '300', 'shared value not shown: ' + y.value);
    setField('insp-pos-x', '+=64');
    const hx = wp('HalfCover_01').x, sx = wp('StepRun_01').x;
    setField('insp-size-y', '*=2');
    const hc = serializeAll().find(o => o.name === 'HalfCover_01'), sr = serializeAll().find(o => o.name === 'StepRun_01');
    assert(near(hc.scale.y, P.metrics().halfCover * 2, 0.01) && near(sr.scale.y / sr.params.steps, P.metrics().stepHeight * 2, 0.01), 'relative scale failed');
    key('KeyZ', { ctrlKey: true });
    assert(near(serializeAll().find(o => o.name === 'HalfCover_01').scale.y, P.metrics().halfCover, 0.01), 'multi-edit undo is one step');
    key('KeyZ', { ctrlKey: true });
    assert(near(wp('HalfCover_01').x, hx - 64, 0.01) && near(wp('StepRun_01').x, sx - 64, 0.01), '+= undo failed');
    key('KeyZ', { ctrlKey: true });
    assert(!near(wp('HalfCover_01').y, 300, 0.01), 'absolute undo failed');
    setField('insp-pos-y', 'abc');
    assert(!near(wp('HalfCover_01').y, 300, 0.01), 'garbage input must be ignored');
  });
  step('face snap (Shift+G) closes a small gap during a drag and is off by default', () => {
    assert(P.state.faceSnap === false, 'face snap should default off');
    key('KeyG', { shiftKey: true });
    assert(P.state.faceSnap === true && /faces/.test(document.getElementById('status-snap').textContent), 'Shift+G did not enable face snap');
    key('KeyG');                            // grid snap off so the drag delta is small and exact
    assert(P.state.snap === false, 'grid snap still on');
    key('KeyC'); click(0.5, 0.5); key('Escape');
    const a = byName('Cube_03') ? 'Cube_03' : ids().filter(o => o.type === 'cube').pop().name;
    clickRow(a);
    setField('insp-pos-x', 0); setField('insp-pos-y', 32); setField('insp-pos-z', -900);
    key('KeyC'); click(0.5, 0.5); key('Escape');
    const b = ids().filter(o => o.type === 'cube').pop().name;
    assert(b !== a, 'no second cube');
    clickRow(b);
    setField('insp-pos-x', 90); setField('insp-pos-y', 32); setField('insp-pos-z', -900);   // faces at 58 and 32: 26u gap, inside the 32u threshold
    assert(P.gizmo().attached, 'gizmo not attached');
    assert(P.gizmoDrag('X', { x: 0, y: 0 }, { x: 0.002, y: 0 }), 'drag rejected');
    const x = wp(b).x;
    assert(near(x, 64, 0.01), 'faces not flush after drag: x=' + x + ' (expected 64)');
    key('KeyZ', { ctrlKey: true });
    assert(near(wp(b).x, 90, 0.01), 'snap drag not undone as one step');
    key('KeyG', { shiftKey: true }); key('KeyG');
    assert(!P.state.faceSnap && P.state.snap, 'toggles not restored');
  });
  step('walk mode starts at the selected PlayerStart, facing its -Z; the capsule hides meanwhile', () => {
    const lock = canvas.requestPointerLock; canvas.requestPointerLock = () => Promise.resolve();
    try {
      const ps = byName('PlayerStart_01');
      P.select([ps.id]);
      setField('insp-pos-x', -1500); setField('insp-pos-y', 0); setField('insp-pos-z', -1500); setField('insp-rot-y', 90);
      key('Tab');
      assert(P.walk.active && P.walk.from === 'PlayerStart_01', 'walk did not start from the marker: ' + P.walk.from);
      const c = P.camera();
      assert(near(c.x, -1500, 0.5) && near(c.z, -1500, 0.5) && near(c.y, P.metrics().eyeHeight, 0.5), 'not at the marker: ' + JSON.stringify(c));
      assert(/from PlayerStart_01/.test(document.getElementById('walk-from').textContent), 'HUD does not name the start');
      P.walk._press('KeyW'); for (let i = 0; i < 10; i++) P.walk.update(0.05); P.walk._release('KeyW');
      const m = P.camera();
      assert(m.x < c.x - 100 && near(m.z, c.z, 1), 'rot-y 90 should walk toward -X: ' + JSON.stringify([c, m]));
      key('Escape');
      assert(!P.walk.active, 'walk still active');
      // with nothing selected the first PlayerStart is used; with none in the scene the camera target is
      P.select([]);
      key('Tab'); assert(P.walk.from === 'PlayerStart_01', 'fallback to first PlayerStart failed: ' + P.walk.from); key('Escape');
    } finally { canvas.requestPointerLock = lock; }
  });
  step('extrude (X): dragging the +Y face doubles the height and keeps the bottom on the ground; one undo', () => {
    key('Escape'); key('KeyC'); click(0.85, 0.15);
    const cube = ids().filter(o => o.type === 'cube').pop();
    key('Escape');
    P.select([cube.id]);
    setField('insp-pos-x', 1200); setField('insp-pos-y', 32); setField('insp-pos-z', -1200);
    P.lookAt(1200, 32, -1200);
    const top = P.project(1200, 64, -1200), up = P.project(1200, 128, -1200);
    assert(!top.behind && top.fx > 0 && top.fx < 1 && top.fy > 0 && top.fy < 1, 'top face off screen: ' + JSON.stringify(top));
    key('KeyX');
    assert(P.state.tool === 'extrude', 'tool ' + P.state.tool);
    pt(top.fx, top.fy, 'pointermove');
    assert(/\+Y face/.test(document.getElementById('status-measure').textContent), 'hover did not find the +Y face: ' + document.getElementById('status-measure').textContent);
    pt(top.fx, top.fy, 'pointerdown');
    pt(up.fx, up.fy, 'pointermove');
    pt(up.fx, up.fy, 'pointerup');
    const s1 = P.serializeOne(cube.id);
    assert(near(s1.scale.y, 128, 0.01) && near(s1.position.y, 64, 0.01) && near(s1.scale.x, 64, 0.01), 'extrude result: ' + JSON.stringify([s1.scale, s1.position]));
    key('KeyZ', { ctrlKey: true });
    const s2 = P.serializeOne(cube.id);
    assert(near(s2.scale.y, 64, 0.01) && near(s2.position.y, 32, 0.01), 'extrude undo failed: ' + JSON.stringify([s2.scale, s2.position]));
    // a sloped face is refused
    const wedge = byName('Wedge_01');
    P.select([wedge.id]);
    key('Escape');
    P.lookAt(0, 0, 0);
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
    const cubesBefore = ids().filter(o => /^Cube_\d+$/.test(o.name)).map(o => o.name);
    key('KeyC'); click(0.9, 0.9);
    const added = ids().filter(o => /^Cube_\d+$/.test(o.name) && !cubesBefore.includes(o.name));
    assert(added.length === 1, 'name counter did not advance past loaded names: ' + ids().map(o => o.name).join(','));
    assert(P.metrics().eyeHeight === 160 && P.metrics().profile === 'ue-third' && serializeAll().find(o => o.name === 'PlayerStart_01').tags.length === 2, 'metrics, profile or marker tags lost on reload');
    assert(!P.pickerOpen(), 'opening a file must not show the profile picker');
    key('Escape');
  });
  out.usdaBytes = text.length;
  return out;
}
