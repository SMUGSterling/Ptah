// app.js — Ptah editor. One module, sectioned:
//   1. Constants & state          5. Selection & transforms
//   2. Scene & grid               6. Measurement & player marker
//   3. Object lifecycle           7. Hierarchy & inspector
//   4. Placement tools            8. Files, shortcuts, boot

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { History } from './history.js';
import { exportUsda, importUsda, PRIMITIVE_GEOMETRY } from './usd.js';
import { platform } from './platform.js';

// ============================================================================
// 1. Constants & state
// ============================================================================

const APP_VERSION = '0.1.0';
const GRID_EXTENT = 2048;            // half-width of the grid in units
const ROTATION_SNAP_DEG = 15;

const PALETTE = [
  { name: 'Slate', hex: 0x8d93a1 },
  { name: 'Clay', hex: 0xc48a5a },
  { name: 'Sage', hex: 0x7ba37e },
  { name: 'Lapis', hex: 0x5b7fe8 },
  { name: 'Gold', hex: 0xd9a441 },
  { name: 'Plum', hex: 0x9a6fb0 }
];

const DEFAULTS = {
  cube:     { color: 0x8d93a1, scale: [64, 64, 64] },
  cylinder: { color: 0xc48a5a, scale: [64, 64, 64] },
  sphere:   { color: 0x7ba37e, scale: [64, 64, 64] },
  plane:    { color: 0x565e6c, scale: [256, 1, 256] },
  mesh:     { color: 0x8d93a1, scale: [1, 1, 1] }
};

const SELECT_EMISSIVE = 0x3d2f10;    // warm lift on the selected mesh
const GOLD = 0xd9a441;
const LAPIS = 0x6f8ff0;

const state = {
  objects: new Map(),                // id -> record
  order: [],                         // ids in hierarchy order
  selectedId: null,
  tool: 'select',                    // select | place-<type> | measure
  transformMode: 'translate',
  snap: true,
  gridSize: 64,
  counter: {},                       // per-type name counters
  filePath: null,
  dirty: false,
  placing: null,                     // record being drag-placed
  measure: { a: null, b: null, group: null }
};

const history = new History(200);

// ============================================================================
// 2. Scene, camera, grid
// ============================================================================

const viewportEl = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewportEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d23);
scene.fog = new THREE.Fog(0x1a1d23, GRID_EXTENT * 2.2, GRID_EXTENT * 4.5);

const camera = new THREE.PerspectiveCamera(50, 1, 1, 40000);
const HOME_DIR = new THREE.Vector3(1, 0.85, 1).normalize();
camera.position.copy(HOME_DIR).multiplyScalar(1400);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.12;
orbit.maxDistance = 20000;
orbit.mouseButtons = {
  LEFT: null,                        // left is for tools; orbit with MMB/RMB
  MIDDLE: THREE.MOUSE.ROTATE,
  RIGHT: THREE.MOUSE.PAN
};

scene.add(new THREE.HemisphereLight(0xcdd3e0, 0x2a2620, 1.0));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
sun.position.set(900, 1600, 600);
scene.add(sun);

// ---- grid ----
const gridGroup = new THREE.Group();
scene.add(gridGroup);

function rebuildGrid() {
  gridGroup.clear();
  const g = state.gridSize;
  const cells = Math.max(1, Math.round(GRID_EXTENT / g));
  const ext = cells * g;

  const minor = [], major = [];
  for (let i = -cells; i <= cells; i++) {
    const v = i * g;
    const bucket = (i % 4 === 0) ? major : minor;
    bucket.push(-ext, 0, v, ext, 0, v);   // line along X
    bucket.push(v, 0, -ext, v, 0, ext);   // line along Z
  }
  gridGroup.add(makeLines(minor, 0x272b34));
  gridGroup.add(makeLines(major, 0x353b48));

  // axis hints through origin
  gridGroup.add(makeLines([-ext, 0.5, 0, ext, 0.5, 0], 0x5a4436)); // X, warm
  gridGroup.add(makeLines([0, 0.5, -ext, 0, 0.5, ext], 0x36445e)); // Z, cool

  // distance labels every 4th line along +X and +Z, plus origin
  const step = g * 4;
  for (let v = step; v <= ext; v += step) {
    gridGroup.add(makeGridLabel(String(v), v, -g * 0.6));
    gridGroup.add(makeGridLabel(String(v), -g * 0.6, v));
    gridGroup.add(makeGridLabel('-' + v, -v, -g * 0.6));
    gridGroup.add(makeGridLabel('-' + v, -g * 0.6, -v));
  }
  gridGroup.add(makeGridLabel('0', -g * 0.6, -g * 0.6));
  document.getElementById('grid-legend').textContent =
    `grid ${g}u · major ${g * 4}u`;
}

function makeLines(positions, color) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
}

function makeTextSprite(text, colorCss, worldHeight) {
  const pad = 8, fontPx = 44;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `600 ${fontPx}px ui-monospace, monospace`;
  canvas.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  canvas.height = fontPx + pad * 2;
  const c2 = canvas.getContext('2d');
  c2.font = `600 ${fontPx}px ui-monospace, monospace`;
  c2.textBaseline = 'middle';
  c2.fillStyle = colorCss;
  c2.fillText(text, pad, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const h = worldHeight;
  sprite.scale.set(h * canvas.width / canvas.height, h, 1);
  return sprite;
}

function makeGridLabel(text, x, z) {
  const s = makeTextSprite(text, 'rgba(150,156,170,0.75)', state.gridSize * 0.42);
  s.position.set(x, 1, z);
  return s;
}

// invisible ground for raycasting
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// ============================================================================
// 3. Object lifecycle
// ============================================================================

function nextName(type) {
  state.counter[type] = (state.counter[type] || 0) + 1;
  const n = String(state.counter[type]).padStart(2, '0');
  return type.charAt(0).toUpperCase() + type.slice(1) + '_' + n;
}

let idCounter = 0;
const newId = () => 'obj_' + (++idCounter);

function buildGeometry(type, meshData) {
  if (type === 'mesh' && meshData) return bufferFromMeshData(meshData);
  const src = PRIMITIVE_GEOMETRY[type]();
  return bufferFromMeshData(src);
}

function bufferFromMeshData(md) {
  // triangulate polygon faces (fan) into a flat, flat-shaded BufferGeometry
  const pos = [];
  let cursor = 0;
  for (const count of md.faceVertexCounts) {
    const idx = md.faceVertexIndices.slice(cursor, cursor + count);
    // fan-triangulate, preserving winding (USD and three.js are both CCW-front)
    for (let i = 1; i < count - 1; i++) {
      for (const k of [idx[0], idx[i], idx[i + 1]]) {
        pos.push(...md.points[k]);
      }
    }
    cursor += count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function createObject({ type, name, position, rotation, scale, color, visible = true, meshData = null }, { select = true, record = true } = {}) {
  const id = newId();
  const def = DEFAULTS[type] || DEFAULTS.mesh;
  const colorHex = color != null ? color : def.color;

  const mat = new THREE.MeshLambertMaterial({
    color: colorHex,
    emissive: 0x000000,
    side: type === 'plane' ? THREE.DoubleSide : THREE.FrontSide
  });
  const mesh = new THREE.Mesh(buildGeometry(type, meshData), mat);
  mesh.position.set(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0);
  mesh.rotation.set(
    THREE.MathUtils.degToRad(rotation?.x ?? 0),
    THREE.MathUtils.degToRad(rotation?.y ?? 0),
    THREE.MathUtils.degToRad(rotation?.z ?? 0)
  );
  const s = scale ? [scale.x, scale.y, scale.z] : def.scale;
  mesh.scale.set(s[0], s[1], s[2]);
  mesh.visible = visible;
  mesh.userData.id = id;
  scene.add(mesh);

  const rec = { id, name: name || nextName(type), type, mesh, color: colorHex, visible, meshData };
  state.objects.set(id, rec);
  state.order.push(id);

  if (record) {
    history.push({
      label: 'Add ' + rec.name,
      undo: () => removeObject(id, { record: false }),
      redo: () => restoreObject(rec)
    });
  }
  markDirty();
  refreshHierarchy();
  if (select) setSelection(id);
  return rec;
}

function restoreObject(rec) {
  scene.add(rec.mesh);
  state.objects.set(rec.id, rec);
  state.order.push(rec.id);
  markDirty();
  refreshHierarchy();
  setSelection(rec.id);
}

function removeObject(id, { record = true } = {}) {
  const rec = state.objects.get(id);
  if (!rec) return;
  if (state.selectedId === id) setSelection(null);
  scene.remove(rec.mesh);
  state.objects.delete(id);
  state.order = state.order.filter(o => o !== id);
  if (record) {
    history.push({
      label: 'Delete ' + rec.name,
      undo: () => restoreObject(rec),
      redo: () => removeObject(id, { record: false })
    });
  }
  markDirty();
  refreshHierarchy();
}

function duplicateSelected() {
  const rec = sel();
  if (!rec) return;
  const p = rec.mesh.position, r = rec.mesh.rotation, s = rec.mesh.scale;
  createObject({
    type: rec.type,
    name: rec.name.replace(/(_copy)*$/, '') + '_copy',
    position: { x: p.x + state.gridSize, y: p.y, z: p.z + state.gridSize },
    rotation: { x: THREE.MathUtils.radToDeg(r.x), y: THREE.MathUtils.radToDeg(r.y), z: THREE.MathUtils.radToDeg(r.z) },
    scale: { x: s.x, y: s.y, z: s.z },
    color: rec.color,
    meshData: rec.meshData
  });
}

const sel = () => state.objects.get(state.selectedId) || null;

// ============================================================================
// 4. Tools & placement
// ============================================================================

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function pointerToRay(evt) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((evt.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((evt.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function groundPoint(evt) {
  pointerToRay(evt);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
}

function snapVal(v) {
  return state.snap ? Math.round(v / state.gridSize) * state.gridSize : v;
}

function setTool(tool) {
  state.tool = tool;
  clearMeasureIfLeaving(tool);
  document.querySelectorAll('[data-tool]').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === tool));
  const label = tool === 'select' ? 'Select'
    : tool === 'measure' ? 'Measure — click two points'
    : 'Place ' + tool.replace('place-', '') + ' — click or drag in the viewport';
  document.getElementById('status-tool').textContent = label;
  renderer.domElement.style.cursor =
    tool === 'select' ? 'default' : 'crosshair';
}

renderer.domElement.addEventListener('pointerdown', (evt) => {
  if (evt.button !== 0) return;
  if (transformCtl.dragging) return;

  if (state.tool.startsWith('place-')) {
    const type = state.tool.slice(6);
    const p = groundPoint(evt);
    if (!p) return;
    const x = snapVal(p.x), z = snapVal(p.z);
    const def = DEFAULTS[type];
    const y = type === 'plane' ? 0 : def.scale[1] / 2; // rest on the ground
    state.placing = createObject(
      { type, position: { x, y, z } },
      { select: true, record: false }          // recorded on pointerup
    );
    renderer.domElement.setPointerCapture(evt.pointerId);
    return;
  }

  if (state.tool === 'measure') {
    handleMeasureClick(evt);
    return;
  }

  // select — but not when the pointer is over the transform gizmo
  if (transformCtl.axis) return;
  pointerToRay(evt);
  const meshes = [...state.objects.values()].filter(r => r.visible).map(r => r.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  setSelection(hits.length ? hits[0].object.userData.id : null);
});

renderer.domElement.addEventListener('pointermove', (evt) => {
  if (state.placing) {
    const p = groundPoint(evt);
    if (p) {
      state.placing.mesh.position.x = snapVal(p.x);
      state.placing.mesh.position.z = snapVal(p.z);
      syncInspector();
    }
    return;
  }
  // live cursor coordinates in the status bar
  const p = groundPoint(evt);
  document.getElementById('status-coords').textContent =
    p ? `x ${fmt(snapVal(p.x))}  z ${fmt(snapVal(p.z))}` : '';
});

renderer.domElement.addEventListener('pointerup', (evt) => {
  if (!state.placing) return;
  const rec = state.placing;
  state.placing = null;
  history.push({
    label: 'Add ' + rec.name,
    undo: () => removeObject(rec.id, { record: false }),
    redo: () => restoreObject(rec)
  });
  // stay in the placement tool so students can stamp several in a row
});

// ============================================================================
// 5. Selection & transform controls
// ============================================================================

const transformCtl = new TransformControls(camera, renderer.domElement);
transformCtl.setRotationSnap(THREE.MathUtils.degToRad(ROTATION_SNAP_DEG));
scene.add(transformCtl);

let selectionHelper = null;
let dragStart = null;

transformCtl.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  const rec = sel();
  if (!rec) return;
  if (e.value) {
    dragStart = captureTRS(rec.mesh);
  } else if (dragStart) {
    const before = dragStart, after = captureTRS(rec.mesh);
    dragStart = null;
    if (!sameTRS(before, after)) {
      pushTransformCommand(rec.id, before, after);
      markDirty();
    }
  }
});

transformCtl.addEventListener('objectChange', () => {
  if (selectionHelper) selectionHelper.update();
  syncInspector();
});

function captureTRS(mesh) {
  return {
    p: mesh.position.clone(),
    r: mesh.rotation.clone(),
    s: mesh.scale.clone()
  };
}
const sameTRS = (a, b) =>
  a.p.equals(b.p) && a.s.equals(b.s) &&
  a.r.x === b.r.x && a.r.y === b.r.y && a.r.z === b.r.z;

function applyTRS(mesh, trs) {
  mesh.position.copy(trs.p);
  mesh.rotation.copy(trs.r);
  mesh.scale.copy(trs.s);
}

function pushTransformCommand(id, before, after) {
  history.push({
    label: 'Transform',
    undo: () => { const r = state.objects.get(id); if (r) { applyTRS(r.mesh, before); afterTransformExternal(r); } },
    redo: () => { const r = state.objects.get(id); if (r) { applyTRS(r.mesh, after); afterTransformExternal(r); } }
  });
}

function afterTransformExternal(rec) {
  if (state.selectedId !== rec.id) setSelection(rec.id);
  if (selectionHelper) selectionHelper.update();
  syncInspector();
  markDirty();
}

function setSelection(id) {
  if (selectionHelper) { scene.remove(selectionHelper); selectionHelper = null; }
  const prev = sel();
  if (prev) prev.mesh.material.emissive.setHex(0x000000);
  transformCtl.detach();

  state.selectedId = id;
  const rec = sel();
  if (rec) {
    rec.mesh.material.emissive.setHex(SELECT_EMISSIVE);
    selectionHelper = new THREE.BoxHelper(rec.mesh, GOLD);
    selectionHelper.material.depthTest = false;
    scene.add(selectionHelper);
    transformCtl.attach(rec.mesh);
    transformCtl.setMode(state.transformMode);
  }
  refreshHierarchy();
  syncInspector();
}

function setTransformMode(mode) {
  state.transformMode = mode;
  transformCtl.setMode(mode);
  document.querySelectorAll('[data-mode]').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
}

function applySnapSettings() {
  transformCtl.setTranslationSnap(state.snap ? state.gridSize : null);
  transformCtl.setRotationSnap(state.snap ? THREE.MathUtils.degToRad(ROTATION_SNAP_DEG) : null);
  transformCtl.setScaleSnap(null); // scale snapping in units is handled via inspector rounding
  const el = document.getElementById('snap-toggle');
  el.classList.toggle('on', state.snap);
  el.setAttribute('aria-pressed', String(state.snap));
  document.getElementById('status-snap').textContent =
    state.snap ? `snap ${state.gridSize}u / ${ROTATION_SNAP_DEG}°` : 'snap off';
}

// ============================================================================
// 6. Measurement & player marker
// ============================================================================

function scenePoint(evt) {
  // prefer object surfaces, fall back to the ground plane
  pointerToRay(evt);
  const meshes = [...state.objects.values()].filter(r => r.visible).map(r => r.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length) return hits[0].point.clone();
  return groundPoint(evt);
}

function handleMeasureClick(evt) {
  const p = scenePoint(evt);
  if (!p) return;
  const m = state.measure;
  if (!m.a || (m.a && m.b)) {         // start a new measurement
    clearMeasure();
    m.a = p;
    m.group = new THREE.Group();
    m.group.add(measureDot(p));
    scene.add(m.group);
    document.getElementById('status-measure').textContent = 'measure: pick second point';
  } else {
    m.b = p;
    m.group.add(measureDot(p));
    const geo = new THREE.BufferGeometry().setFromPoints([m.a, m.b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: LAPIS, depthTest: false, transparent: true }));
    line.renderOrder = 10;
    m.group.add(line);
    const d = m.a.distanceTo(m.b);
    const mid = m.a.clone().add(m.b).multiplyScalar(0.5);
    const label = makeTextSprite(fmt(d) + ' u', '#8fa8f5', Math.max(state.gridSize * 0.5, d * 0.045));
    label.position.copy(mid).add(new THREE.Vector3(0, state.gridSize * 0.4, 0));
    label.material.depthTest = false;
    m.group.add(label);
    document.getElementById('status-measure').textContent =
      `measure: ${fmt(d)} u   (Δx ${fmt(Math.abs(m.b.x - m.a.x))}  Δy ${fmt(Math.abs(m.b.y - m.a.y))}  Δz ${fmt(Math.abs(m.b.z - m.a.z))})`;
  }
}

function measureDot(p) {
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(3, state.gridSize * 0.08), 12, 8),
    new THREE.MeshBasicMaterial({ color: LAPIS, depthTest: false, transparent: true })
  );
  dot.renderOrder = 10;
  dot.position.copy(p);
  return dot;
}

function clearMeasure() {
  const m = state.measure;
  if (m.group) scene.remove(m.group);
  m.a = m.b = m.group = null;
  document.getElementById('status-measure').textContent = '';
}

function clearMeasureIfLeaving(tool) {
  if (tool !== 'measure') clearMeasure();
}

// ---- player height reference ----
const player = { group: null, height: 180, visible: false };

function buildPlayerMarker() {
  if (player.group) scene.remove(player.group);
  const g = new THREE.Group();
  const h = player.height;
  const bodyH = h * 0.72, headR = h * 0.11, w = h * 0.24;
  const mat = new THREE.MeshLambertMaterial({ color: GOLD, transparent: true, opacity: 0.85 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, bodyH, 16), mat);
  body.position.y = bodyH / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 16, 12), mat);
  head.position.y = bodyH + headR * 1.15;
  const line = makeLines([0, 0, 0, 0, h, 0], GOLD);
  const tick = makeTextSprite(`${fmt(h)} u`, '#e2b45a', h * 0.14);
  tick.position.set(w, h + h * 0.08, 0);
  g.add(body, head, line, tick);
  g.position.set(0, 0, 0);
  g.visible = player.visible;
  player.group = g;
  scene.add(g);
}

function togglePlayer(force) {
  player.visible = force != null ? force : !player.visible;
  if (!player.group) buildPlayerMarker();
  player.group.visible = player.visible;
  const el = document.getElementById('player-toggle');
  el.classList.toggle('on', player.visible);
  el.setAttribute('aria-pressed', String(player.visible));
}

// ============================================================================
// 7. Hierarchy & inspector
// ============================================================================

const hierarchyEl = document.getElementById('hierarchy-list');

function refreshHierarchy() {
  hierarchyEl.innerHTML = '';
  for (const id of state.order) {
    const rec = state.objects.get(id);
    const row = document.createElement('div');
    row.className = 'h-row' + (id === state.selectedId ? ' selected' : '') + (rec.visible ? '' : ' hidden-obj');
    row.dataset.id = id;

    const eye = document.createElement('button');
    eye.className = 'h-eye';
    eye.title = rec.visible ? 'Hide' : 'Show';
    eye.textContent = rec.visible ? '◉' : '○';
    eye.addEventListener('click', (e) => { e.stopPropagation(); setVisibility(id, !rec.visible); });

    const icon = document.createElement('span');
    icon.className = 'h-icon';
    icon.textContent = { cube: '▧', cylinder: '◍', sphere: '●', plane: '▭', mesh: '△' }[rec.type] || '△';

    const name = document.createElement('span');
    name.className = 'h-name';
    name.textContent = rec.name;
    name.title = 'Double-click to rename';

    const del = document.createElement('button');
    del.className = 'h-del';
    del.title = 'Delete';
    del.textContent = '✕';
    del.addEventListener('click', (e) => { e.stopPropagation(); removeObject(id); });

    row.append(eye, icon, name, del);
    row.addEventListener('click', () => setSelection(id));
    row.addEventListener('dblclick', () => startRename(row, rec));
    hierarchyEl.appendChild(row);
  }
  document.getElementById('hierarchy-count').textContent =
    state.order.length ? `${state.order.length} object${state.order.length === 1 ? '' : 's'}` : 'empty — press C to add a cube';
}

function startRename(row, rec) {
  const nameEl = row.querySelector('.h-name');
  const input = document.createElement('input');
  input.className = 'h-rename';
  input.value = rec.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    const next = input.value.trim();
    if (next && next !== rec.name) renameObject(rec.id, next);
    refreshHierarchy();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = rec.name; input.blur(); }
    e.stopPropagation();
  });
}

function renameObject(id, next, { record = true } = {}) {
  const rec = state.objects.get(id);
  if (!rec) return;
  const prev = rec.name;
  rec.name = next;
  if (record) {
    history.push({
      label: 'Rename',
      undo: () => renameObject(id, prev, { record: false }),
      redo: () => renameObject(id, next, { record: false })
    });
  }
  markDirty();
  refreshHierarchy();
  syncInspector();
}

function setVisibility(id, visible, { record = true } = {}) {
  const rec = state.objects.get(id);
  if (!rec) return;
  rec.visible = visible;
  rec.mesh.visible = visible;
  if (record) {
    history.push({
      label: visible ? 'Show' : 'Hide',
      undo: () => setVisibility(id, !visible, { record: false }),
      redo: () => setVisibility(id, visible, { record: false })
    });
  }
  markDirty();
  refreshHierarchy();
}

// ---- inspector ----

const insp = {
  panel: document.getElementById('inspector'),
  empty: document.getElementById('inspector-empty'),
  name: document.getElementById('insp-name'),
  type: document.getElementById('insp-type'),
  bbox: document.getElementById('insp-bbox'),
  swatches: document.getElementById('insp-swatches'),
  fields: {}
};
for (const group of ['pos', 'rot', 'size']) {
  for (const axis of ['x', 'y', 'z']) {
    insp.fields[group + axis] = document.getElementById(`insp-${group}-${axis}`);
  }
}

let syncing = false;

function syncInspector() {
  const rec = sel();
  insp.panel.classList.toggle('hidden', !rec);
  insp.empty.classList.toggle('hidden', !!rec);
  if (!rec) return;
  syncing = true;
  insp.name.value = rec.name;
  insp.type.textContent = rec.type;
  const m = rec.mesh;
  const vals = {
    pos: [m.position.x, m.position.y, m.position.z],
    rot: [m.rotation.x, m.rotation.y, m.rotation.z].map(THREE.MathUtils.radToDeg),
    size: [m.scale.x, m.scale.y, m.scale.z]
  };
  for (const group of Object.keys(vals)) {
    ['x', 'y', 'z'].forEach((axis, i) => {
      const el = insp.fields[group + axis];
      if (document.activeElement !== el) el.value = fmt(vals[group][i]);
    });
  }
  const box = new THREE.Box3().setFromObject(m);
  const size = box.getSize(new THREE.Vector3());
  insp.bbox.textContent = `${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)} u`;
  document.getElementById('status-sel').textContent =
    `${rec.name} — ${fmt(size.x)}×${fmt(size.y)}×${fmt(size.z)}u`;
  syncing = false;
}

function commitInspectorField(group, axis) {
  if (syncing) return;
  const rec = sel();
  if (!rec) return;
  const el = insp.fields[group + axis];
  const v = parseFloat(el.value);
  if (isNaN(v)) { syncInspector(); return; }
  const before = captureTRS(rec.mesh);
  if (group === 'pos') rec.mesh.position[axis] = v;
  if (group === 'rot') rec.mesh.rotation[axis] = THREE.MathUtils.degToRad(v);
  if (group === 'size') rec.mesh.scale[axis] = Math.max(0.01, v);
  const after = captureTRS(rec.mesh);
  if (!sameTRS(before, after)) {
    pushTransformCommand(rec.id, before, after);
    markDirty();
  }
  if (selectionHelper) selectionHelper.update();
  syncInspector();
}

for (const group of ['pos', 'rot', 'size']) {
  for (const axis of ['x', 'y', 'z']) {
    const el = insp.fields[group + axis];
    el.addEventListener('change', () => commitInspectorField(group, axis));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.blur();
      e.stopPropagation();
    });
  }
}

insp.name.addEventListener('change', () => {
  const rec = sel();
  if (rec && insp.name.value.trim()) renameObject(rec.id, insp.name.value.trim());
});
insp.name.addEventListener('keydown', (e) => e.stopPropagation());

// color swatches
for (const c of PALETTE) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.title = c.name;
  b.style.background = '#' + c.hex.toString(16).padStart(6, '0');
  b.addEventListener('click', () => {
    const rec = sel();
    if (!rec) return;
    const prev = rec.color;
    setColor(rec.id, c.hex, { record: false });
    history.push({
      label: 'Color',
      undo: () => setColor(rec.id, prev, { record: false }),
      redo: () => setColor(rec.id, c.hex, { record: false })
    });
  });
  insp.swatches.appendChild(b);
}

function setColor(id, hex) {
  const rec = state.objects.get(id);
  if (!rec) return;
  rec.color = hex;
  rec.mesh.material.color.setHex(hex);
  markDirty();
}

document.getElementById('insp-duplicate').addEventListener('click', duplicateSelected);
document.getElementById('insp-delete').addEventListener('click', () => {
  if (state.selectedId) removeObject(state.selectedId);
});

// ============================================================================
// 8. Files, shortcuts, boot
// ============================================================================

const fmt = (v) => {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
};

function markDirty(dirty = true) {
  state.dirty = dirty;
  platform.setDirty(dirty);
  updateTitle();
}

function updateTitle() {
  const file = state.filePath ? state.filePath.split(/[\\/]/).pop() : 'untitled';
  const title = `${state.dirty ? '● ' : ''}${file} — Ptah`;
  document.getElementById('file-label').textContent = file + (state.dirty ? ' •' : '');
  platform.setTitle(title);
}

function serializeObjects() {
  return state.order.map(id => {
    const r = state.objects.get(id);
    const m = r.mesh;
    const col = new THREE.Color(r.color);
    return {
      name: r.name,
      type: r.type,
      position: { x: m.position.x, y: m.position.y, z: m.position.z },
      rotation: {
        x: THREE.MathUtils.radToDeg(m.rotation.x),
        y: THREE.MathUtils.radToDeg(m.rotation.y),
        z: THREE.MathUtils.radToDeg(m.rotation.z)
      },
      scale: { x: m.scale.x, y: m.scale.y, z: m.scale.z },
      color: [col.r, col.g, col.b],
      visible: r.visible,
      meshData: r.meshData
    };
  });
}

async function saveFile(saveAs = false) {
  const content = exportUsda(serializeObjects(), { appVersion: APP_VERSION });
  const res = await platform.saveUsd({
    content,
    filePath: saveAs ? null : state.filePath,
    suggestedName: state.filePath ? undefined : 'blockout.usda'
  });
  if (res.canceled) return;
  state.filePath = res.filePath;
  markDirty(false);
  toast('Saved');
}

async function openFile() {
  if (state.dirty) {
    const ok = await platform.confirmDiscard('Open another file? Unsaved changes will be lost.');
    if (!ok) return;
  }
  const res = await platform.openUsd();
  if (res.canceled) return;
  loadUsdaText(res.content, res.filePath);
}

function loadUsdaText(text, filePath) {
  let parsed;
  try {
    parsed = importUsda(text);
  } catch (err) {
    toast('Could not read file: ' + err.message, true);
    return;
  }
  clearScene();
  for (const o of parsed.objects) {
    const colorHex = o.color
      ? new THREE.Color(o.color[0], o.color[1], o.color[2]).getHex()
      : null;
    createObject({ ...o, color: colorHex }, { select: false, record: false });
  }
  state.filePath = filePath || null;
  history.clear();
  markDirty(false);
  setSelection(null);
  if (parsed.warnings.length) toast(parsed.warnings[0], true);
  else toast(`Opened — ${parsed.objects.length} objects`);
}

async function newScene() {
  if (state.dirty) {
    const ok = await platform.confirmDiscard('Start a new blockout? Unsaved changes will be lost.');
    if (!ok) return;
  }
  clearScene();
  state.filePath = null;
  if (platform._resetHandle) platform._resetHandle();
  history.clear();
  markDirty(false);
}

function clearScene() {
  setSelection(null);
  for (const rec of state.objects.values()) scene.remove(rec.mesh);
  state.objects.clear();
  state.order = [];
  state.counter = {};
  clearMeasure();
  refreshHierarchy();
}

// ---- toast ----
let toastTimer = null;
function toast(msg, warn = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('warn', warn);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), warn ? 5000 : 2200);
}

// ---- camera views ----
function setView(which) {
  const target = orbit.target.clone();
  const d = camera.position.distanceTo(target);
  const dirs = {
    front: new THREE.Vector3(0, 0.0001, 1),
    right: new THREE.Vector3(1, 0.0001, 0),
    top: new THREE.Vector3(0.0001, 1, 0),
    home: HOME_DIR
  };
  camera.position.copy(target).addScaledVector(dirs[which].clone().normalize(), d);
  camera.lookAt(target);
}

function frameSelection() {
  const rec = sel();
  const box = new THREE.Box3();
  if (rec) box.setFromObject(rec.mesh);
  else if (state.order.length) {
    for (const id of state.order) box.expandByObject(state.objects.get(id).mesh);
  } else return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() || 200;
  orbit.target.copy(center);
  const dir = camera.position.clone().sub(center).normalize();
  camera.position.copy(center).addScaledVector(dir, Math.max(size * 1.6, 150));
}

// ---- keyboard ----
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { history.undo(); e.preventDefault(); }
    else if (k === 'z' || k === 'y') { history.redo(); e.preventDefault(); }
    else if (k === 's') { saveFile(e.shiftKey); e.preventDefault(); }
    else if (k === 'o') { openFile(); e.preventDefault(); }
    else if (k === 'n') { newScene(); e.preventDefault(); }
    else if (k === 'd') { duplicateSelected(); e.preventDefault(); }
    return;
  }

  switch (e.code) {
    case 'KeyQ': case 'Escape':
      if (state.tool === 'measure') clearMeasure();
      if (e.code === 'Escape' && state.tool === 'select') setSelection(null);
      setTool('select'); break;
    case 'KeyC': setTool('place-cube'); break;
    case 'KeyY': setTool('place-cylinder'); break;
    case 'KeyS': setTool('place-sphere'); break;
    case 'KeyP': setTool('place-plane'); break;
    case 'KeyM': setTool('measure'); break;
    case 'KeyW': setTransformMode('translate'); break;
    case 'KeyE': setTransformMode('rotate'); break;
    case 'KeyR': setTransformMode('scale'); break;
    case 'KeyG': state.snap = !state.snap; applySnapSettings(); break;
    case 'KeyH': togglePlayer(); break;
    case 'KeyF': frameSelection(); break;
    case 'F2': {
      const row = hierarchyEl.querySelector('.h-row.selected');
      const rec = sel();
      if (row && rec) startRename(row, rec);
      break;
    }
    case 'Delete': case 'Backspace':
      if (state.selectedId) removeObject(state.selectedId);
      break;
    case 'Numpad1': case 'Digit1': setView('front'); break;
    case 'Numpad3': case 'Digit3': setView('right'); break;
    case 'Numpad7': case 'Digit7': setView('top'); break;
    case 'Numpad0': case 'Digit0': setView('home'); break;
  }
});

// ---- topbar & toolbar wiring ----
document.getElementById('btn-new').addEventListener('click', newScene);
document.getElementById('btn-open').addEventListener('click', openFile);
document.getElementById('btn-save').addEventListener('click', () => saveFile(false));
document.getElementById('btn-saveas').addEventListener('click', () => saveFile(true));
document.getElementById('btn-undo').addEventListener('click', () => history.undo());
document.getElementById('btn-redo').addEventListener('click', () => history.redo());

document.querySelectorAll('[data-tool]').forEach(b =>
  b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('[data-mode]').forEach(b =>
  b.addEventListener('click', () => setTransformMode(b.dataset.mode)));

document.getElementById('snap-toggle').addEventListener('click', () => {
  state.snap = !state.snap;
  applySnapSettings();
});

const gridInput = document.getElementById('grid-size');
gridInput.addEventListener('change', () => {
  const v = parseFloat(gridInput.value);
  if (!isNaN(v) && v >= 1 && v <= 1024) {
    state.gridSize = v;
    rebuildGrid();
    applySnapSettings();
  } else {
    gridInput.value = state.gridSize;
  }
});

document.getElementById('player-toggle').addEventListener('click', () => togglePlayer());
const playerHeightInput = document.getElementById('player-height');
playerHeightInput.addEventListener('change', () => {
  const v = parseFloat(playerHeightInput.value);
  if (!isNaN(v) && v > 0) {
    player.height = v;
    buildPlayerMarker();
    if (!player.visible) togglePlayer(true);
  } else {
    playerHeightInput.value = player.height;
  }
});

history.onChange = (h) => {
  document.getElementById('btn-undo').disabled = !h.canUndo;
  document.getElementById('btn-redo').disabled = !h.canRedo;
};

// ---- resize & render loop ----
function resize() {
  const w = viewportEl.clientWidth, h = viewportEl.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function tick() {
  requestAnimationFrame(tick);
  orbit.update();
  renderer.render(scene, camera);
}

// ---- boot ----
rebuildGrid();
applySnapSettings();
buildPlayerMarker();
setTool('select');
setTransformMode('translate');
refreshHierarchy();
syncInspector();
updateTitle();
history.onChange(history);
resize();
tick();

// test hook (harmless in production; used by test/smoke.js)
window.__ptahSerialize = serializeObjects;
