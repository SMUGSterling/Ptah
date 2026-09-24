// app.js — Ptah editor. One module, sectioned:
//   1. Constants & state           6. Selection & transform gizmo
//   2. Scene, camera, grid         7. Measurement & player marker
//   3. Scene graph helpers         8. Hierarchy panel (tree + drag/drop)
//   4. Object lifecycle            9. Inspector
//   5. Tools & placement          10. Files, views, shortcuts, boot
//
// Scene graph model: every object is a record { id, name, type, node, ... }.
// `node` is the Three.js Object3D that IS the USD Xform: a Mesh for geometry
// types, a Group for groups and notes. Parenting is the Three.js parent/child
// relationship itself (nodes with userData.id), which keeps the editor, the
// export and the engines composing transforms identically.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { History } from './history.js';
import { exportUsda, importUsda, MAX_IMPORT_BYTES, MAX_NESTING, PRIMITIVE_GEOMETRY, STAIRS_DEFAULT_STEPS } from './usd.js';
import { METRICS_DEFAULTS, METRICS_FIELDS, METRIC_NUMBER_KEYS, normalizeMetrics, sameMetrics, presetSpecs, PRESET_KEYS,
  PROFILES, PROFILE_BY_KEY, profileMetrics, INTENTS, INTENT_BY_KEY, MARKERS, MARKER_BY_KEY, MARKER_DEFAULT_SIZE } from './metrics.js';
import { faceSnapDelta } from './snap.js';
import { createAutosave } from './autosave.js';
import { platform } from './platform.js';
import { createWalkMode } from './walk.js';
import { loadMannequin } from './character.js';
import { createReference } from './reference.js';

// ============================================================================
// 1. Constants & state
// ============================================================================

const APP_VERSION = '0.7.3';
const GRID_EXTENT = 2048;            // half-width of the grid in units
const ROTATION_SNAP_DEG = 15;
const MIN_SIZE = 1;                  // smallest dimension the gizmo may snap to
const ROTATION_ORDER = 'ZYX';        // three.js order equal to USD/Maya rotateXYZ (X applied first)
const IMPORT_TOO_LARGE = 'File is too large to import (limit 50 MB).';
const lookup = (obj) => Object.freeze(Object.assign(Object.create(null), obj));

// Default dimensions (units), color and intent per type. Colors are the intent
// palette's (metrics.js): a cube is a wall until the student says otherwise, a
// plane, wedge or stairs is floor, a sphere is a placeholder prop. Wedge and
// stairs default to a walkable size for a 180u player: 16u risers, 32u treads.
const DEFAULTS = lookup({
  cube:     { color: INTENT_BY_KEY.wall.hex,        scale: [64, 64, 64],   intent: 'wall' },
  cylinder: { color: INTENT_BY_KEY.wall.hex,        scale: [64, 64, 64],   intent: 'wall' },
  sphere:   { color: INTENT_BY_KEY.placeholder.hex, scale: [64, 64, 64],   intent: 'placeholder' },
  plane:    { color: INTENT_BY_KEY.floor.hex,       scale: [256, 1, 256],  intent: 'floor' },
  wedge:    { color: INTENT_BY_KEY.floor.hex,       scale: [128, 64, 256], intent: 'floor' },
  stairs:   { color: INTENT_BY_KEY.floor.hex,       scale: [128, 128, 256], intent: 'floor' },
  mesh:     { color: INTENT_BY_KEY.wall.hex,        scale: [1, 1, 1],      intent: null },
  group:    { color: null,                          scale: [1, 1, 1],      intent: null },
  note:     { color: 0xd9a441,                      scale: [1, 1, 1],      intent: null },
  marker:   { color: 0x4cae5a,                      scale: [1, 1, 1],      intent: null }
});
const GEOMETRY_TYPES = new Set(['cube', 'cylinder', 'sphere', 'plane', 'wedge', 'stairs', 'mesh']);
const TYPE_ICON = lookup({ cube: '▧', cylinder: '◍', sphere: '●', plane: '▭', wedge: '◢', stairs: '▙', mesh: '△', group: '▾', note: '⚑', marker: '◎' });
const FACE_SNAP_THRESHOLD = () => Math.max(8, state.gridSize * 0.5);   // world units

const SELECT_EMISSIVE = 0x3d2f10;    // warm lift on selected meshes
const GOLD = 0xd9a441;
const GOLD_DIM = 0x8a6a2e;
const LAPIS = 0x6f8ff0;

const state = {
  objects: new Map(),                // id -> record
  selection: [],                     // ids; last entry is the active object
  tool: 'select',                    // select | place-<type> | measure
  transformMode: 'translate',
  snap: true,
  shiftHeld: false,                  // Shift inverts snapping while held (off → on, on → off)
  faceSnap: false,                   // face-to-face snapping while dragging (Shift+G)
  gridSize: 64,
  gridOpacity: 1,                    // 0.1..1, multiplies the grid's base line/label alpha (view setting, remembered)
  showTicks: true,                   // metric height ticks on capsule markers (H)
  extrude: null,                     // face-extrude drag in progress
  pivotBase: false,                  // inspector Position Y reads the object's base instead of its center (view setting)
  walkView: null,                    // 'first' | 'third' once the user chose with V; null = follow the profile
  metrics: { ...METRICS_DEFAULTS },  // the level's design metrics profile (saved in the file)
  markerKind: 'PlayerStart',         // last marker kind placed (K re-arms it)
  counter: {},                       // per-type name counters
  filePath: null,
  dirty: false,
  placing: null,                     // record being drag-placed
  marquee: null,                     // box-select in progress
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
const fill = new THREE.DirectionalLight(0xbfd0ff, 0.55);   // opposite side, so risers and back faces read
fill.position.set(-700, 900, -1000);
scene.add(fill);

// All user objects live under `world`; its direct object children are roots.
const world = new THREE.Group();
world.name = 'World';
scene.add(world);

// ---- grid ----
const gridGroup = new THREE.Group();
scene.add(gridGroup);

function rebuildGrid() {
  for (const c of gridGroup.children) disposeSubtree(c);
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

  // distance labels every 4th line along +X and +Z, plus origin. Each label is
  // its own sprite + texture, so cap the count for tiny grid sizes.
  let step = g * 4;
  while (ext / step > 16) step *= 2;
  for (let v = step; v <= ext; v += step) {
    gridGroup.add(makeGridLabel(String(v), v, -g * 0.6));
    gridGroup.add(makeGridLabel(String(v), -g * 0.6, v));
    gridGroup.add(makeGridLabel('-' + v, -v, -g * 0.6));
    gridGroup.add(makeGridLabel('-' + v, -g * 0.6, -v));
  }
  gridGroup.add(makeGridLabel('0', -g * 0.6, -g * 0.6));
  gridGroup.traverse(o => { if (o.material) o.userData.baseOpacity = o.material.opacity; });
  applyGridOpacity();
  document.getElementById('grid-legend').textContent =
    `grid ${g}u · major ${g * 4}u`;
}

// The grid competes with a reference underlay for the same pixels; students
// dim one to trace the other. A view setting, not level data, so it is
// remembered per browser rather than written to the file.
function applyGridOpacity() {
  const f = state.gridOpacity;
  gridGroup.traverse(o => { if (o.material && o.userData.baseOpacity != null) o.material.opacity = o.userData.baseOpacity * f; });
  gridGroup.visible = f > 0.01;
  const el = document.getElementById('grid-opacity');
  if (el && document.activeElement !== el) el.value = Math.round(f * 100);
  document.getElementById('grid-opacity-val').textContent = Math.round(f * 100) + '%';
}
function setGridOpacity(f, { remember = true } = {}) {
  state.gridOpacity = Math.min(1, Math.max(0, f));
  applyGridOpacity();
  if (remember) { try { localStorage.setItem('ptah.gridOpacity', String(state.gridOpacity)); } catch { /* storage unavailable */ } }
}

function makeLines(positions, color) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  lines.raycast = () => {};          // never pickable
  return lines;
}

function makeTextSprite(text, colorCss, worldHeight, opts = {}) {
  const pad = 10, fontPx = 44;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `600 ${fontPx}px ui-monospace, monospace`;
  canvas.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  canvas.height = fontPx + pad * 2;
  const c2 = canvas.getContext('2d');
  if (opts.background) {
    c2.fillStyle = opts.background;
    roundRect(c2, 0, 0, canvas.width, canvas.height, 12);
    c2.fill();
  }
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeGridLabel(text, x, z) {
  const s = makeTextSprite(text, 'rgba(150,156,170,0.75)', state.gridSize * 0.42);
  s.position.set(x, 1, z);
  s.raycast = () => {};
  return s;
}

// invisible ground for raycasting
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// ============================================================================
// 3. Scene graph helpers
// ============================================================================

const isNode = (o) => !!(o && o.userData && o.userData.id);
const recOf = (o) => (isNode(o) ? state.objects.get(o.userData.id) || null : null);
const childNodes = (container) => container.children.filter(isNode);
const childRecs = (rec) => childNodes(rec.node).map(recOf).filter(Boolean);
const rootRecs = () => childNodes(world).map(recOf).filter(Boolean);
const parentRec = (rec) => recOf(rec.node.parent);
const containerOf = (pRec) => (pRec ? pRec.node : world);
const indexOf = (rec) => childNodes(rec.node.parent).indexOf(rec.node);

function allRecs() {
  const out = [];
  const walk = (recs) => { for (const r of recs) { out.push(r); walk(childRecs(r)); } };
  walk(rootRecs());
  return out;
}

function isAncestor(a, b) {          // is rec a an ancestor of rec b
  for (let p = b.node.parent; p; p = p.parent) if (p === a.node) return true;
  return false;
}

// Nesting limit: the saved file must reopen (see MAX_NESTING in usd.js).
function depthOf(rec) { let d = 0; for (let r = rec; r; r = parentRec(r)) d++; return d; }
function heightOf(rec) { let h = 0; for (const c of childRecs(rec)) h = Math.max(h, heightOf(c)); return h + 1; }
const NESTING_TOO_DEEP = `Groups can nest at most ${MAX_NESTING} levels deep (deeper levels would not reopen).`;

function worldVisible(rec) {
  for (let n = rec.node; n && n !== world; n = n.parent) if (!n.visible) return false;
  return true;
}

/** Place `node` at object-index `index` among its container's object children. */
function moveToIndex(container, node, index) {
  const arr = container.children;
  const raw = arr.indexOf(node);
  if (raw >= 0) arr.splice(raw, 1);
  const siblings = arr.filter(isNode);
  const clamped = Math.max(0, Math.min(index ?? Infinity, siblings.length));
  const before = siblings[clamped];             // insert before this object node
  const rawIdx = before ? arr.indexOf(before) : arr.length;
  arr.splice(rawIdx, 0, node);
}

function captureTRS(node) {
  return { p: node.position.clone(), r: node.rotation.clone(), s: node.scale.clone() };
}
const sameTRS = (a, b) =>
  a.p.equals(b.p) && a.s.equals(b.s) &&
  a.r.x === b.r.x && a.r.y === b.r.y && a.r.z === b.r.z;
function applyTRS(node, trs) {
  node.position.copy(trs.p);
  node.rotation.copy(trs.r);
  node.scale.copy(trs.s);
  node.updateMatrixWorld(true);
}

/** Set a node's world matrix, decomposing into its local TRS. */
function setWorldMatrix(node, m) {
  const parentInv = new THREE.Matrix4();
  if (node.parent) { node.parent.updateWorldMatrix(true, false); parentInv.copy(node.parent.matrixWorld).invert(); }
  const local = parentInv.multiply(m);
  const q = new THREE.Quaternion();
  local.decompose(node.position, q, node.scale);
  node.rotation.setFromQuaternion(q);
  node.updateMatrixWorld(true);
}

/** World AABB of a node's real geometry (helpers excluded). Empty for a bare group/note. */
const _bb = new THREE.Box3();
function boundsOf(node, target = new THREE.Box3()) {
  target.makeEmpty();
  node.updateWorldMatrix(true, false);
  const walk = (o) => {
    if ((o.userData.helper && !o.userData.bounds) || !o.visible) return;
    if (o.isMesh && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      target.union(_bb);
    }
    for (const c of o.children) walk(c);
  };
  walk(node);
  if (target.isEmpty()) target.expandByPoint(node.getWorldPosition(new THREE.Vector3()));
  return target;
}

const compound = (label, cmds) => ({
  label,
  undo: () => { for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo(); },
  redo: () => { for (const c of cmds) c.redo(); }
});

// ============================================================================
// 4. Object lifecycle
// ============================================================================

/** "Cube_01", "PlayerStart_03", "HalfCover_02": key is a type or a preset/marker name. */
function nextName(key) {
  state.counter[key] = (state.counter[key] || 0) + 1;
  const n = String(state.counter[key]).padStart(2, '0');
  return key.charAt(0).toUpperCase() + key.slice(1) + '_' + n;
}

let idCounter = 0;
const newId = () => 'obj_' + (++idCounter);
/** Persistent per-object id, written to the file as ptah:id so identity survives round trips. */
const newUid = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('');
let loading = false;                 // suppresses per-object UI refresh while a file builds
let failImportedObjectName = null;   // test hook for atomic-load recovery

/** Advance the name counters past names like "Cube_07" or "Spawn_03" already in use. */
function syncNameCounters() {
  for (const rec of allRecs()) {
    const m = /^([A-Z][A-Za-z]*)_(\d+)$/.exec(rec.name);
    if (!m) continue;
    const lower = m[1].toLowerCase();
    const key = lower in DEFAULTS ? lower : m[1];
    state.counter[key] = Math.max(state.counter[key] || 0, parseInt(m[2], 10));
  }
}

function buildGeometry(type, meshData, params) {
  if (type === 'mesh' && meshData) return bufferFromMeshData(meshData);
  return bufferFromMeshData(PRIMITIVE_GEOMETRY[type](params));
}

function bufferFromMeshData(md) {
  // triangulate polygon faces (fan) into a flat, flat-shaded BufferGeometry
  const pos = [];
  let cursor = 0;
  for (const count of md.faceVertexCounts) {
    const idx = md.faceVertexIndices.slice(cursor, cursor + count);
    // fan-triangulate, preserving winding (USD and three.js are both CCW-front)
    for (let i = 1; i < count - 1; i++) {
      const tri = [md.points[idx[0]], md.points[idx[i]], md.points[idx[i + 1]]];
      if (tri.some(p => !p)) continue;
      for (const p of tri) pos.push(...p);
    }
    cursor += count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Free GPU resources of an object and everything under it. */
function disposeSubtree(root) {
  root.traverse((o) => {
    if (o.geometry && !o.isSprite) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}

// Visual for empty Xforms: a small three-axis cross. Not pickable, not saved.
function makeGroupMarker() {
  const s = 12;
  const m = makeLines([-s, 0, 0, s, 0, 0, 0, -s, 0, 0, s, 0, 0, 0, -s, 0, 0, s], GOLD_DIM);
  m.material.opacity = 0.7;
  markHelper(m, new THREE.Vector3(0, 0, 0));
  return m;
}

// Helper visuals (pins, labels, markers) live under their node so picking and
// visibility follow it, but they must not inherit the node's rotation or
// scale: a note under a 128u-wide cube would otherwise get a 128x pin. Each
// frame updateHelperMatrices() gives them an exact world-aligned matrix:
// node world position + a world-space offset, unit (or sprite) scale.
// `helper` marks a visual that is not the object's geometry (excluded from
// bounds, walk collision and picking unless flagged); `pinned` marks the ones
// whose matrix is managed here. `rotate` keeps the node's world rotation
// (marker facing arrows) while still dropping its scale.
function markHelper(obj, offset, worldScale = null, { rotate = false } = {}) {
  obj.userData.helper = true;
  obj.userData.pinned = true;
  obj.userData.offset = offset;
  obj.userData.worldScale = worldScale;   // null = unit scale (sprites carry their own)
  obj.userData.rotate = rotate;
  obj.matrixAutoUpdate = false;
  return obj;
}

const _hm = new THREE.Matrix4(), _hp = new THREE.Vector3(), _hq = new THREE.Quaternion(), _hs = new THREE.Vector3();
function updateHelperMatrices() {
  for (const rec of state.objects.values()) {
    if (rec.type !== 'note' && rec.type !== 'group' && rec.type !== 'marker') continue;
    const node = rec.node;
    if (!node.parent) continue;
    _hp.setFromMatrixPosition(node.matrixWorld);
    _hm.copy(node.matrixWorld).invert();
    for (const h of node.children) {
      if (!h.userData.pinned) continue;
      const sc = h.isSprite ? h.scale : (h.userData.worldScale || _hs.set(1, 1, 1));
      if (h.userData.rotate) node.getWorldQuaternion(_hq); else _hq.identity();
      h.matrix.compose(_hp.clone().add(h.userData.offset), _hq, sc);
      h.matrix.premultiply(_hm);
      h.matrixWorldNeedsUpdate = true;
    }
  }
}

const NOTE_PIN_H = 40, NOTE_PIN_R = 7;
function buildNoteVisual(rec) {
  const node = rec.node;
  for (const c of [...node.children]) if (c.userData.helper) { node.remove(c); disposeSubtree(c); }
  const col = rec.color ?? DEFAULTS.note.color;
  const mat = new THREE.MeshBasicMaterial({ color: col });
  const pin = new THREE.Mesh(new THREE.SphereGeometry(NOTE_PIN_R, 14, 10), mat);
  markHelper(pin, new THREE.Vector3(0, NOTE_PIN_H, 0));
  pin.userData.pick = true;                 // clicking the pin selects the note
  const stem = makeLines([0, 0, 0, 0, NOTE_PIN_H - NOTE_PIN_R, 0], col);
  markHelper(stem, new THREE.Vector3(0, 0, 0));
  const css = '#' + col.toString(16).padStart(6, '0');
  const label = makeTextSprite(rec.name, css, 22, { background: 'rgba(20,22,27,0.82)' });
  label.center.set(0.5, 0);
  label.material.depthTest = false;
  label.renderOrder = 9;
  markHelper(label, new THREE.Vector3(0, NOTE_PIN_H + NOTE_PIN_R + 16, 0));
  label.userData.pick = true;
  node.add(pin, stem, label);
  updateHelperMatrices();
  rec.mesh = null;                          // notes have no geometry mesh
  rec.pin = pin;
}

// Gameplay markers. Capsules are drawn at the metrics profile's player height
// (so a spawn is always a player-sized reminder of scale) and follow the
// node's rotation but not its scale. Trigger volumes are the exception: the
// node scale is the box size, so their visual is an ordinary scaled child.
// Facing is the node's local -Z, the direction the walk camera looks at
// rotation 0.
const MARKER_LABEL_H = 22;
function buildMarkerVisual(rec) {
  const node = rec.node;
  for (const c of [...node.children]) if (c.userData.helper) { node.remove(c); disposeSubtree(c); }
  const kind = MARKER_BY_KEY[rec.marker] || MARKER_BY_KEY.Spawn;
  const col = rec.color ?? kind.hex;
  const css = '#' + col.toString(16).padStart(6, '0');
  const m = state.metrics;
  const solid = new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.6 });
  const wireMat = new THREE.LineBasicMaterial({ color: col });
  let pin, labelY;

  if (kind.shape === 'volume') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
    box.userData.helper = true; box.userData.pick = true; box.userData.bounds = true;
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), wireMat);
    wire.userData.helper = true;
    node.add(box, wire);
    pin = wire;
    labelY = null;                          // label sits above the (scaled) box: handled per frame below
    const label = makeTextSprite(rec.name, css, MARKER_LABEL_H, { background: 'rgba(20,22,27,0.82)' });
    label.center.set(0.5, 0);
    label.material.depthTest = false;
    label.renderOrder = 9;
    label.userData.helper = true; label.userData.pick = true;
    label.position.set(0, 0.5, 0);          // top face center in unit-box space; scale is undone per frame
    label.userData.volumeLabel = true;
    label.userData.baseScale = label.scale.clone();
    node.add(label);
  } else {
    // a world-aligned rig that keeps the node's facing
    const rig = new THREE.Group();
    markHelper(rig, new THREE.Vector3(0, 0, 0), null, { rotate: true });
    const arrowLen = 60;
    const arrow = makeLines([0, 3, 0, 0, 3, -arrowLen], col);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(8, 22, 10), new THREE.MeshBasicMaterial({ color: col }));
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 3, -arrowLen - 9);
    tip.userData.pick = true;
    rig.add(arrow, tip);
    if (kind.shape === 'capsule') {
      const h = m.playerHeight, r = m.capsuleRadius;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(1, h - 2 * r), 6, 14), solid);
      body.position.y = h / 2;
      body.userData.pick = true;
      const eye = makeLines([-r, m.eyeHeight, 0, r, m.eyeHeight, 0], col);
      rig.add(body, eye);
      if (state.showTicks) {
        // the movable scale reference: drop a capsule beside any block and read the heights
        const ticks = [[h, 'height'], [m.eyeHeight, 'eye'], [m.crouchHeight, 'crouch'], [m.fullCover, 'full cover'], [m.halfCover, 'half cover'], [m.stepHeight, 'step']];
        for (const [y, name] of ticks) {
          const tl = makeLines([r * 1.2, y, 0, r * 2.2, y, 0], GOLD_DIM);
          const lab = makeTextSprite(`${name} ${fmt(y)}`, '#b08a45', 11);
          lab.center.set(0, 0.5);
          lab.position.set(r * 2.4, y, 0);
          lab.material.depthTest = false;
          rig.add(tl, lab);
        }
      }
      pin = body; labelY = h + 18;
    } else if (kind.shape === 'cover') {
      const h = m.halfCover, w = 64, d = 12;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), solid);
      body.position.set(0, h / 2, -d / 2);
      body.userData.pick = true;
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), wireMat);
      wire.position.copy(body.position);
      rig.add(body, wire);
      pin = body; labelY = h + 18;
    } else {                                // gem: objective / pickup
      const body = new THREE.Mesh(new THREE.OctahedronGeometry(18), solid);
      body.position.y = 46;
      body.userData.pick = true;
      const stem = makeLines([0, 0, 0, 0, 28, 0], col);
      rig.add(body, stem);
      pin = body; labelY = 82;
    }
    node.add(rig);
    const label = makeTextSprite(rec.name, css, MARKER_LABEL_H, { background: 'rgba(20,22,27,0.82)' });
    label.center.set(0.5, 0);
    label.material.depthTest = false;
    label.renderOrder = 9;
    markHelper(label, new THREE.Vector3(0, labelY, 0));
    label.userData.pick = true;
    node.add(label);
  }
  updateHelperMatrices();
  rec.mesh = null;
  rec.pin = pin;
}

/** Volume labels sit on top of the scaled box with constant screen size: undo the node scale each frame. */
function updateVolumeLabels() {
  for (const rec of state.objects.values()) {
    if (rec.type !== 'marker') continue;
    for (const h of rec.node.children) {
      if (!h.userData.volumeLabel) continue;
      const s = rec.node.getWorldScale(_hs);
      h.scale.set(h.userData.baseScale.x / (s.x || 1), h.userData.baseScale.y / (s.y || 1), 1);
      h.position.set(0, 0.5 + 6 / (s.y || 1), 0);
    }
  }
}

/** Metrics changed: every visual that encodes a metric is rebuilt. */
function refreshMetricVisuals() {
  for (const rec of state.objects.values()) if (rec.type === 'marker') buildMarkerVisual(rec);
  refreshSelectionVisuals();
}

/**
 * Create an object. spec: { type, name, position, rotation (deg), scale,
 * color (hex), visible, meshData, params, text, intent, marker, tags, uid }.
 * opts: { parent: rec|null, index, select, record }
 * Returns the record; when record is true the add is pushed to history.
 */
function createObject(spec, { parent = null, index, select = true, record = true } = {}) {
  const { type } = spec;
  const id = newId();
  const def = DEFAULTS[type] || DEFAULTS.mesh;
  const markerKind = type === 'marker' ? (MARKER_BY_KEY[spec.marker] ? spec.marker : 'Spawn') : undefined;
  const colorHex = spec.color != null ? spec.color : (markerKind ? MARKER_BY_KEY[markerKind].hex : def.color);

  let node, mesh = null;
  if (GEOMETRY_TYPES.has(type)) {
    const mat = new THREE.MeshLambertMaterial({
      color: colorHex,
      emissive: 0x000000,
      side: type === 'plane' ? THREE.DoubleSide : THREE.FrontSide
    });
    mesh = new THREE.Mesh(buildGeometry(type, spec.meshData, spec.params), mat);
    node = mesh;
  } else {
    node = new THREE.Group();
    if (type === 'group') node.add(makeGroupMarker());
  }
  node.position.set(spec.position?.x ?? 0, spec.position?.y ?? 0, spec.position?.z ?? 0);
  // USD rotateXYZ applies X first, then Y, then Z: three.js Euler order 'ZYX'.
  // Setting it per node keeps inspector, file and engines in agreement.
  node.rotation.set(
    THREE.MathUtils.degToRad(spec.rotation?.x ?? 0),
    THREE.MathUtils.degToRad(spec.rotation?.y ?? 0),
    THREE.MathUtils.degToRad(spec.rotation?.z ?? 0),
    ROTATION_ORDER
  );
  const s = spec.scale ? [spec.scale.x, spec.scale.y, spec.scale.z] : def.scale;
  node.scale.set(s[0], s[1], s[2]);
  node.visible = spec.visible !== false;
  node.userData.id = id;

  const rec = {
    id, type, node, mesh,
    uid: spec.uid || newUid(),
    name: spec.name || nextName(markerKind || type),
    color: colorHex,
    intent: GEOMETRY_TYPES.has(type) ? (spec.intent !== undefined ? spec.intent : def.intent) : null,
    marker: markerKind,
    tags: Array.isArray(spec.tags) ? spec.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : [],
    visible: spec.visible !== false,
    meshData: spec.meshData || null,
    params: spec.params ? { ...spec.params } : (type === 'stairs' ? { steps: STAIRS_DEFAULT_STEPS } : null),
    text: type === 'note' ? (spec.text || '') : undefined,
    collapsed: false
  };
  if (loading && failImportedObjectName && rec.name === failImportedObjectName) {
    failImportedObjectName = null;
    throw new Error(`Test import failure for ${rec.name}`);
  }
  node.userData.rec = rec;                 // lets a detached subtree be re-registered on undo
  if (type === 'note') buildNoteVisual(rec);
  if (type === 'marker') buildMarkerVisual(rec);

  state.objects.set(id, rec);
  const container = containerOf(parent);
  container.add(node);
  if (index != null) moveToIndex(container, node, index);
  node.updateMatrixWorld(true);

  if (record) history.push(addCommand(rec));
  if (!loading) {
    markDirty();
    refreshHierarchy();
    if (select) setSelection([id]);
  }
  return rec;
}

function addCommand(rec) {
  const parent = parentRec(rec), index = indexOf(rec);
  return {
    label: 'Add ' + rec.name,
    undo: () => detachSubtree(rec),
    redo: () => restoreSubtree(rec, parent, index)
  };
}

function descendants(rec) {
  const out = [];
  const walk = (node) => {
    for (const c of childNodes(node)) {
      const r = state.objects.get(c.userData.id);
      if (r) out.push(r);
      walk(c);
    }
  };
  walk(rec.node);
  return out;
}

/** Remove a record and its whole subtree from the scene (nodes kept intact for undo). */
function detachSubtree(rec) {
  const subtree = [rec, ...descendants(rec)];
  const ids = new Set(subtree.map(r => r.id));
  if (state.selection.some(id => ids.has(id))) setSelection(state.selection.filter(id => !ids.has(id)));
  rec.node.parent?.remove(rec.node);
  for (const r of subtree) state.objects.delete(r.id);
  markDirty();
  refreshHierarchy();
}

function restoreSubtree(rec, parent, index) {
  const container = (parent && state.objects.has(parent.id)) ? parent.node : world;
  container.add(rec.node);
  moveToIndex(container, rec.node, index);
  rec.node.updateMatrixWorld(true);
  // re-register the whole subtree (records were kept alive by the closures)
  const walk = (node, r) => {
    state.objects.set(r.id, r);
    for (const c of childNodes(node)) if (c.userData.rec) walk(c, c.userData.rec);
  };
  walk(rec.node, rec);
  markDirty();
  refreshHierarchy();
  setSelection([rec.id]);
}

function removeCommand(rec) {
  const parent = parentRec(rec), index = indexOf(rec);
  return {
    label: 'Delete ' + rec.name,
    undo: () => restoreSubtree(rec, parent, index),
    redo: () => detachSubtree(rec)
  };
}

function deleteSelection() {
  const tops = topLevelSelection();
  if (!tops.length) return;
  if (gestureActive()) return;               // never delete mid-placement or mid-drag
  // Create and execute one at a time so each command records the index that
  // is valid at its own moment; undo replays them in reverse.
  const cmds = [];
  for (const t of tops) { const c = removeCommand(t); c.redo(); cmds.push(c); }
  history.push(compound(tops.length === 1 ? 'Delete ' + tops[0].name : `Delete ${tops.length} objects`, cmds));
}

/** Deep-copy a record (and children) under `parent`. Returns the new record. */
function cloneRec(rec, parent, index) {
  const n = rec.node;
  const copy = createObject({
    type: rec.type,
    name: rec.name.replace(/(_copy)*$/, '') + '_copy',
    position: { x: n.position.x, y: n.position.y, z: n.position.z },
    rotation: { x: THREE.MathUtils.radToDeg(n.rotation.x), y: THREE.MathUtils.radToDeg(n.rotation.y), z: THREE.MathUtils.radToDeg(n.rotation.z) },
    scale: { x: n.scale.x, y: n.scale.y, z: n.scale.z },
    color: rec.color,
    visible: rec.visible,
    meshData: rec.meshData,
    params: rec.params,
    text: rec.text,
    intent: rec.intent,
    marker: rec.marker,
    tags: [...rec.tags]
  }, { parent, index, select: false, record: false });
  for (const c of childRecs(rec)) cloneRec(c, copy);
  return copy;
}

function duplicateSelection() {
  const tops = topLevelSelection();
  if (!tops.length) return;
  const copies = tops.map(t => cloneRec(t, parentRec(t), indexOf(t) + 1));
  // nudge copies by one grid cell in world XZ so they don't sit inside the originals
  const off = new THREE.Vector3(state.gridSize, 0, state.gridSize);
  for (const c of copies) {
    c.node.updateWorldMatrix(true, false);
    const m = c.node.matrixWorld.clone();
    m.setPosition(new THREE.Vector3().setFromMatrixPosition(m).add(off));
    setWorldMatrix(c.node, m);
  }
  history.push(compound('Duplicate', copies.map(addCommand)));
  setSelection(copies.map(c => c.id));
}

/** Reparent preserving world transform. Returns a command (already applied). */
function reparent(rec, newParent, index) {
  const oldParent = parentRec(rec), oldIndex = indexOf(rec), before = captureTRS(rec.node);
  const container = containerOf(newParent);
  world.updateMatrixWorld(true);
  container.attach(rec.node);
  moveToIndex(container, rec.node, index);
  rec.node.updateMatrixWorld(true);
  const after = captureTRS(rec.node);
  const place = (p, i, trs) => {
    if (!state.objects.has(rec.id)) return;   // removed since (e.g. an unrecorded placement undone): never resurrect a ghost
    const c = (p && state.objects.has(p.id)) ? p.node : world;
    c.add(rec.node);
    moveToIndex(c, rec.node, i);
    applyTRS(rec.node, trs);
    afterStructureChange();
  };
  return {
    label: 'Reparent',
    undo: () => place(oldParent, oldIndex, before),
    redo: () => place(newParent, index, after)
  };
}

function afterStructureChange() {
  markDirty();
  refreshHierarchy();
  attachGizmo();
  refreshSelectionVisuals();
  syncInspector();
}

/**
 * Move records under `parent`, each inserted before `beforeRec` (or appended
 * when null). Working with a reference node instead of an index keeps the
 * result correct when some of the moved items sit before the drop point.
 */
function moveRecs(recs, parent, beforeRec = null) {
  if (gestureActive()) return;               // a placement's Add is not recorded yet
  const base = parent ? depthOf(parent) : 0;
  const candidates = recs.filter(r => r !== beforeRec && !(parent && (r === parent || isAncestor(r, parent))));
  const movable = candidates.filter(r => base + heightOf(r) <= MAX_NESTING);
  if (movable.length < candidates.length) toast(NESTING_TOO_DEEP, true);
  if (!movable.length) return;
  const cmds = [];
  const container = containerOf(parent);
  for (const r of movable) {
    let index;
    if (beforeRec && state.objects.has(beforeRec.id)) {
      const siblings = childNodes(container).filter(n => n !== r.node);
      const i = siblings.indexOf(beforeRec.node);
      index = i >= 0 ? i : undefined;
    }
    cmds.push(reparent(r, parent, index));
  }
  history.push(compound(movable.length === 1 ? 'Move ' + movable[0].name : `Move ${movable.length} objects`, cmds));
  afterStructureChange();
}

function groupSelection() {
  if (gestureActive()) return;               // a placement's Add is not recorded yet
  const tops = topLevelSelection();
  if (!tops.length) return;
  const parents = tops.map(parentRec);
  const common = parents.every(p => p === parents[0]) ? parents[0] : null;
  const groupDepth = (common ? depthOf(common) : 0) + 1;
  if (tops.some(t => groupDepth + heightOf(t) > MAX_NESTING)) { toast(NESTING_TOO_DEEP, true); return; }
  const centroid = new THREE.Vector3();
  for (const t of tops) centroid.add(t.node.getWorldPosition(new THREE.Vector3()));
  centroid.multiplyScalar(1 / tops.length);
  if (state.snap) { centroid.x = snapVal(centroid.x); centroid.y = snapVal(centroid.y); centroid.z = snapVal(centroid.z); }
  const local = common ? common.node.worldToLocal(centroid.clone()) : centroid;
  const sameParentIdx = tops.filter(t => parentRec(t) === common).map(indexOf);
  const minIndex = sameParentIdx.length ? Math.min(...sameParentIdx) : undefined;
  const g = createObject({ type: 'group', position: { x: local.x, y: local.y, z: local.z } },
    { parent: common, index: minIndex, select: false, record: false });
  const cmds = [addCommand(g), ...tops.map(t => reparent(t, g))];
  history.push(compound('Group', cmds));
  afterStructureChange();
  setSelection([g.id]);
}

function ungroupSelection() {
  const groups = topLevelSelection().filter(r => r.type === 'group');
  if (!groups.length) return;
  const cmds = [], freed = [];
  for (const g of groups) {
    const parent = parentRec(g);
    let idx = indexOf(g);
    for (const c of childRecs(g)) { cmds.push(reparent(c, parent, idx++)); freed.push(c.id); }
    const rm = removeCommand(g); rm.redo(); cmds.push(rm);
  }
  history.push(compound('Ungroup', cmds));
  afterStructureChange();
  setSelection(freed);
}

function renameObject(id, next, { record = true } = {}) {
  const rec = state.objects.get(id);
  if (!rec) return;
  const prev = rec.name;
  rec.name = next;
  if (rec.type === 'note') buildNoteVisual(rec);
  else if (rec.type === 'marker') buildMarkerVisual(rec);   // the floating label bakes the name
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
  rec.node.visible = visible;
  if (record) {
    history.push({
      label: visible ? 'Show' : 'Hide',
      undo: () => setVisibility(id, !visible, { record: false }),
      redo: () => setVisibility(id, visible, { record: false })
    });
  }
  markDirty();
  refreshHierarchy();
  refreshSelectionVisuals();
}

function setColor(id, hex, intent) {
  const rec = state.objects.get(id);
  if (!rec) return;
  rec.color = hex;
  if (intent !== undefined && GEOMETRY_TYPES.has(rec.type)) rec.intent = intent;
  if (rec.type === 'note') buildNoteVisual(rec);
  else if (rec.type === 'marker') buildMarkerVisual(rec);
  else if (rec.mesh) rec.mesh.material.color.setHex(hex);
  if (state.selection.includes(id)) tintSelected(rec, true);
  markDirty();
}

/** Apply an intent (and its color) to every selected object that can carry one; notes and markers just take the color. */
function applyIntent(key) {
  const intent = INTENT_BY_KEY[key];
  if (!intent) return;
  const targets = selectedRecs().filter(r => r.type !== 'group');
  if (!targets.length) return;
  const prev = targets.map(r => [r.id, r.color, r.intent]);
  for (const r of targets) setColor(r.id, intent.hex, GEOMETRY_TYPES.has(r.type) ? key : undefined);
  history.push({
    label: 'Intent ' + intent.label,
    undo: () => { for (const [id, hex, it] of prev) setColor(id, hex, it); syncInspector(); },
    redo: () => { for (const [id] of prev) { const r = state.objects.get(id); if (r) setColor(id, intent.hex, GEOMETRY_TYPES.has(r.type) ? key : undefined); } syncInspector(); }
  });
  syncInspector();
}

function setMarkerKind(id, kind, { record = true } = {}) {
  const rec = state.objects.get(id);
  if (!rec || rec.type !== 'marker' || !MARKER_BY_KEY[kind] || rec.marker === kind) return;
  const prev = rec.marker, prevColor = rec.color, prevScale = rec.node.scale.clone();
  const fromVolume = MARKER_BY_KEY[prev].shape === 'volume', toVolume = MARKER_BY_KEY[kind].shape === 'volume';
  rec.marker = kind;
  rec.color = MARKER_BY_KEY[kind].hex;
  if (toVolume && !fromVolume) { const d = MARKER_DEFAULT_SIZE.Trigger; rec.node.scale.set(d[0], d[1], d[2]); }
  if (fromVolume && !toVolume) rec.node.scale.set(1, 1, 1);
  rec.node.updateMatrixWorld(true);
  buildMarkerVisual(rec);
  if (record) {
    history.push({
      label: 'Marker kind',
      undo: () => { const r = state.objects.get(id); if (!r) return; r.marker = prev; r.color = prevColor; r.node.scale.copy(prevScale); r.node.updateMatrixWorld(true); buildMarkerVisual(r); refreshSelectionVisuals(); syncInspector(); },
      redo: () => setMarkerKind(id, kind, { record: false })
    });
  }
  markDirty();
  refreshSelectionVisuals();
  syncInspector();
}

function setTags(id, tags, { record = true } = {}) {
  const rec = state.objects.get(id);
  if (!rec) return;
  const next = tags.map(t => t.trim()).filter(Boolean);
  const prev = rec.tags;
  if (JSON.stringify(prev) === JSON.stringify(next)) { syncInspector(); return; }
  rec.tags = next;
  if (record) {
    history.push({
      label: 'Tags',
      undo: () => setTags(id, prev, { record: false }),
      redo: () => setTags(id, next, { record: false })
    });
  }
  markDirty();
  syncInspector();
}

/** Replace the metrics profile. Undoable; rebuilds every metric-driven visual. */
function setMetrics(next, { record = true } = {}) {
  const norm = normalizeMetrics(next);
  const prev = state.metrics;
  if (sameMetrics(prev, norm)) { syncMetricsPanel(); return; }
  state.metrics = norm;
  refreshMetricVisuals();
  syncMetricsPanel();
  if (record) {
    history.push({
      label: 'Metrics',
      undo: () => setMetrics(prev, { record: false }),
      redo: () => setMetrics(norm, { record: false })
    });
    markDirty();
  }
}

/** Place a preset from the metrics profile at ground point (x, z). Grouped when it has several pieces. */
function createPreset(key, x, z) {
  const spec = presetSpecs(state.metrics)[key];
  if (!spec) return null;
  const make = (o, parent, dx, dz) => createObject({
    type: o.type, name: nextName(o.name), intent: o.intent, params: o.params,
    position: { x: o.position.x + dx, y: o.position.y, z: o.position.z + dz },
    scale: o.scale
  }, { parent, select: false, record: false });
  let top;
  if (spec.group) {
    top = createObject({ type: 'group', name: nextName(spec.group), position: { x, y: 0, z } }, { select: false, record: false });
    for (const o of spec.objects) make(o, top, 0, 0);
  } else {
    top = make(spec.objects[0], null, x, z);
  }
  history.push(addCommand(top));
  setSelection([top.id]);
  return top;
}

function setNoteText(id, text, { record = true } = {}) {
  const rec = state.objects.get(id);
  if (!rec || rec.type !== 'note') return;
  const prev = rec.text;
  rec.text = text;
  if (record && prev !== text) {
    history.push({
      label: 'Edit note',
      undo: () => setNoteText(id, prev, { record: false }),
      redo: () => setNoteText(id, text, { record: false })
    });
  }
  markDirty();
  syncInspector();
}

function setStairsSteps(id, steps, { record = true } = {}) {
  const rec = state.objects.get(id);
  if (!rec || rec.type !== 'stairs') return;
  const prev = rec.params.steps;
  const next = Math.max(1, Math.min(64, Math.round(steps)));
  if (!isFinite(next) || prev === next) { syncInspector(); return; }
  rec.params = { steps: next };
  rec.mesh.geometry.dispose();
  rec.mesh.geometry = buildGeometry('stairs', null, rec.params);
  if (record) {
    history.push({
      label: 'Steps',
      undo: () => setStairsSteps(id, prev, { record: false }),
      redo: () => setStairsSteps(id, next, { record: false })
    });
  }
  markDirty();
  syncInspector();
}

// ============================================================================
// 5. Tools & placement
// ============================================================================

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function pointerToRay(evt) {
  camera.updateMatrixWorld();        // events may arrive before the next frame renders
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

// Snapping methodology: edges, not centers. A 64u cube whose CENTER sits on a
// grid intersection straddles the lines; blocks tile only when their bounding
// box lands on them. So placement and gizmo translation snap the selection's
// world AABB min corner (and its bottom) to grid multiples, like a brush editor,
// and the center follows. Rotation snaps in 15° steps, size in whole cells.
// Holding Shift inverts the Snap setting for as long as it is held.
const effectiveSnap = () => state.snap !== state.shiftHeld;
function snapVal(v) {
  return effectiveSnap() ? Math.round(v / state.gridSize) * state.gridSize : v;
}
/** Center coordinate such that an object of size `size` has its min edge on the grid. */
function snapEdge(center, size) {
  return effectiveSnap() ? snapVal(center - size / 2) + size / 2 : center;
}

/** Visible pickable meshes/sprites (owned by records). */
function collectPickables() {
  const out = [];
  const walk = (container) => {
    for (const c of container.children) {
      if (!c.visible || !isNode(c)) continue;
      if (c.isMesh) out.push(c);
      for (const h of c.children) {
        if (!h.userData.helper || !h.visible) continue;
        h.traverse(o => { if (o.userData.pick && o.visible) out.push(o); });
      }
      walk(c);
    }
  };
  walk(world);
  return out;
}

function ownerOf(obj) {
  for (let o = obj; o; o = o.parent) if (isNode(o)) return recOf(o);
  return null;
}

function pick(evt) {
  pointerToRay(evt);
  const hits = raycaster.intersectObjects(collectPickables(), false);
  for (const h of hits) {
    const rec = ownerOf(h.object);
    if (rec) return { rec, point: h.point.clone(), object: h.object, face: h.face || null };
  }
  return null;
}

function setTool(tool) {
  if (walk.active) walk.exit();
  state.tool = tool;
  clearMeasureIfLeaving(tool);
  if (tool === 'select') attachGizmo(); else transformCtl.detach();   // no gizmo under placement clicks
  syncRail();
  const presetKey = tool.startsWith('place-preset-') ? tool.slice(13) : '';
  const markerKey = tool.startsWith('place-marker-') ? tool.slice(13) : '';
  if (tool !== 'extrude') showExtrudeFace(null);
  const label = tool === 'select' ? 'Select'
    : tool === 'measure' ? 'Measure: click two points'
    : tool === 'extrude' ? 'Extrude: drag an axis-aligned face along its normal (the opposite face stays put)'
    : tool === 'place-note' ? 'Note: click a surface or the grid to pin a note'
    : presetKey ? `Preset ${presetSpecs(state.metrics)[presetKey]?.label || presetKey}: click the grid to place (${presetSpecs(state.metrics)[presetKey]?.hint || ''})`
    : markerKey ? `Marker ${MARKER_BY_KEY[markerKey]?.label || markerKey}: click a surface or the grid`
    : 'Place ' + tool.replace('place-', '') + ': click or drag in the viewport';
  document.getElementById('status-tool').textContent = label;
  presetSelect.value = presetKey;
  markerSelect.value = markerKey;
  renderer.domElement.style.cursor = tool === 'select' ? 'default' : 'crosshair';
}

const presetSelect = document.getElementById('preset-select');
const markerSelect = document.getElementById('marker-select');

const marqueeEl = document.getElementById('marquee');

// Capture is a convenience (drags keep tracking outside the canvas), never a
// requirement: it throws while a pointer lock is releasing or for a pointer the
// browser does not consider active.
function capturePointer(evt) {
  try { renderer.domElement.setPointerCapture(evt.pointerId); } catch { /* keep going without capture */ }
}

renderer.domElement.addEventListener('pointerdown', (evt) => {
  if (evt.button !== 0 || walk.active) return;
  // The gizmo's hover axis is refreshed only on pointermove; if the gizmo
  // appeared under a still cursor (W/E/R, undo) it would be stale here and a
  // marquee would start alongside the gizmo drag.
  if (transformCtl.object && transformCtl.enabled && !transformCtl.dragging) transformCtl.pointerHover(transformCtl._getPointer(evt));
  if (transformCtl.dragging || transformCtl.axis) return;   // the gizmo owns this click

  if (state.tool.startsWith('place-')) {
    const type = state.tool.slice(6);
    if (type.startsWith('marker-')) {
      const kind = type.slice(7);
      const hit = pick(evt);
      const p = hit ? hit.point : groundPoint(evt);
      if (!p) return;
      if (!hit) { p.x = snapVal(p.x); p.z = snapVal(p.z); }
      const size = MARKER_DEFAULT_SIZE[kind];
      const spec = { type: 'marker', marker: kind, position: { x: p.x, y: p.y + (size ? size[1] / 2 : 0), z: p.z } };
      if (size) spec.scale = { x: size[0], y: size[1], z: size[2] };
      createObject(spec, { select: true });
      state.markerKind = kind;
      return;                                // stay in the tool: spawns come in batches
    }
    if (type.startsWith('preset-')) {
      const p = groundPoint(evt);
      if (!p) return;
      createPreset(type.slice(7), snapVal(p.x), snapVal(p.z));
      return;
    }
    if (type === 'note') {
      const hit = pick(evt);
      const p = hit ? hit.point : groundPoint(evt);
      if (!p) return;
      if (!hit) { p.x = snapVal(p.x); p.z = snapVal(p.z); }
      createObject({ type: 'note', position: { x: p.x, y: p.y, z: p.z } }, { select: true });
      setTool('select');
      insp.text.focus();
      return;
    }
    const p = groundPoint(evt);
    if (!p) return;
    const def = DEFAULTS[type];
    const x = snapEdge(p.x, def.scale[0]), z = snapEdge(p.z, def.scale[2]);
    const y = type === 'plane' ? 0 : def.scale[1] / 2; // rest on the ground
    state.placing = createObject(
      { type, position: { x, y, z } },
      { select: true, record: false }          // recorded on pointerup
    );
    capturePointer(evt);
    return;
  }

  if (state.tool === 'measure') {
    handleMeasureClick(evt);
    return;
  }

  if (state.tool === 'extrude') {
    beginExtrude(evt);
    return;
  }

  // select tool
  const additive = evt.shiftKey || evt.ctrlKey || evt.metaKey;
  const hit = pick(evt);
  if (hit) {
    if (additive) toggleSelect(hit.rec.id);
    else if (!(state.selection.length === 1 && state.selection[0] === hit.rec.id)) setSelection([hit.rec.id]);
    return;
  }
  // empty space: start a marquee; a plain click (no drag) clears on pointerup
  state.marquee = { x0: evt.clientX, y0: evt.clientY, x1: evt.clientX, y1: evt.clientY, additive, active: false };
  capturePointer(evt);
});

renderer.domElement.addEventListener('pointermove', (evt) => {
  if (state.extrude) { updateExtrude(evt); return; }
  if (state.tool === 'extrude') { showExtrudeFace(faceUnderPointer(evt)); }
  if (state.placing) {
    const p = groundPoint(evt);
    if (p) {
      state.placing.node.position.x = snapEdge(p.x, state.placing.node.scale.x);
      state.placing.node.position.z = snapEdge(p.z, state.placing.node.scale.z);
      state.placing.node.updateMatrixWorld(true);
      refreshSelectionVisuals();
      syncInspector();
    }
    return;
  }
  if (state.marquee) {
    const m = state.marquee;
    m.x1 = evt.clientX; m.y1 = evt.clientY;
    if (!m.active && Math.hypot(m.x1 - m.x0, m.y1 - m.y0) > 4) m.active = true;
    if (m.active) {
      const r = viewportEl.getBoundingClientRect();
      marqueeEl.style.left = (Math.min(m.x0, m.x1) - r.left) + 'px';
      marqueeEl.style.top = (Math.min(m.y0, m.y1) - r.top) + 'px';
      marqueeEl.style.width = Math.abs(m.x1 - m.x0) + 'px';
      marqueeEl.style.height = Math.abs(m.y1 - m.y0) + 'px';
      marqueeEl.classList.remove('hidden');
    }
    return;
  }
  // live cursor coordinates in the status bar
  const p = groundPoint(evt);
  document.getElementById('status-coords').textContent =
    p ? `x ${fmt(snapVal(p.x))}  z ${fmt(snapVal(p.z))}${effectiveSnap() ? '' : ' (free)'}` : '';
});

// A gesture whose pointerup never reaches the canvas (touch cancel, capture
// lost to a dialog or a pointer lock) must still end, or state.placing /
// state.extrude stay set and block Delete and the orbit controls.
function endStrayGesture() {
  if (state.extrude) endExtrude();
  if (state.placing) {
    const rec = state.placing;
    state.placing = null;
    if (state.objects.has(rec.id) && rec.node.parent) history.push(addCommand(rec));
  }
  if (state.marquee) { state.marquee = null; marqueeEl.classList.add('hidden'); }
}
renderer.domElement.addEventListener('pointercancel', endStrayGesture);
renderer.domElement.addEventListener('lostpointercapture', endStrayGesture);

renderer.domElement.addEventListener('pointerup', () => {
  if (state.extrude) { endExtrude(); return; }
  if (state.placing) {
    const rec = state.placing;
    state.placing = null;
    if (state.objects.has(rec.id) && rec.node.parent) history.push(addCommand(rec));
    // stay in the placement tool so students can stamp several in a row
    return;
  }
  if (state.marquee) {
    const m = state.marquee;
    state.marquee = null;
    marqueeEl.classList.add('hidden');
    if (!m.active) { if (!m.additive) setSelection([]); return; }
    const r = renderer.domElement.getBoundingClientRect();
    const xa = Math.min(m.x0, m.x1), xb = Math.max(m.x0, m.x1);
    const ya = Math.min(m.y0, m.y1), yb = Math.max(m.y0, m.y1);
    const inside = [];
    const v = new THREE.Vector3();
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    for (const rec of allRecs()) {
      if (!worldVisible(rec)) continue;
      if (rec.type === 'group' || rec.type === 'note' || rec.type === 'marker') rec.node.getWorldPosition(v);
      else boundsOf(rec.node).getCenter(v);
      v.project(camera);
      if (v.z > 1) continue;
      const sx = r.left + (v.x + 1) / 2 * r.width, sy = r.top + (1 - v.y) / 2 * r.height;
      if (sx >= xa && sx <= xb && sy >= ya && sy <= yb) inside.push(rec.id);
    }
    setSelection(m.additive ? [...new Set([...state.selection, ...inside])] : inside);
  }
});

// ============================================================================
// 6. Selection & transform gizmo
// ============================================================================

const transformCtl = new TransformControls(camera, renderer.domElement);
transformCtl.setRotationSnap(THREE.MathUtils.degToRad(ROTATION_SNAP_DEG));
scene.add(transformCtl);

// Multi-selection is transformed through this pivot at the selection centroid.
const pivot = new THREE.Object3D();
pivot.name = 'Pivot';
scene.add(pivot);

const selectionHelpers = new Map();  // id -> BoxHelper
let dragStart = null;                // { targets: [{rec, trs, world}], pivotWorld }

const sel = () => state.objects.get(state.selection[state.selection.length - 1]) || null;
const selectedRecs = () => state.selection.map(id => state.objects.get(id)).filter(Boolean);

function topLevelSelection() {
  const recs = selectedRecs();
  return recs.filter(r => !recs.some(o => o !== r && isAncestor(o, r)));
}

function setSelection(ids) {
  // A value typed into an inspector field must land on the object it was typed
  // for: commit it (blur fires 'change' synchronously) before the selection moves.
  const active = document.activeElement;
  if (
    active &&
    active !== document.body &&
    active !== document.documentElement &&
    active.closest?.('#inspector')
  ) {
    active.blur();
  }
  const next = [...new Set(ids.filter(id => state.objects.has(id)))];
  for (const rec of selectedRecs()) tintSelected(rec, false);
  state.selection = next;
  for (const rec of selectedRecs()) tintSelected(rec, true);
  attachGizmo();
  refreshSelectionVisuals();
  refreshHierarchy();
  syncInspector();
}

function toggleSelect(id) {
  if (state.selection.includes(id)) setSelection(state.selection.filter(x => x !== id));
  else setSelection([...state.selection, id]);
}

function selectAll() { setSelection(allRecs().map(r => r.id)); }

function tintSelected(rec, on) {
  if (rec.mesh && rec.mesh.material.emissive) rec.mesh.material.emissive.setHex(on ? SELECT_EMISSIVE : 0x000000);
  if (rec.pin && rec.pin.material) rec.pin.material.color.setHex(on ? 0xffffff : (rec.color ?? DEFAULTS[rec.type].color));
}

function attachGizmo() {
  transformCtl.detach();
  if (walk.active || state.tool !== 'select' || state.transformMode === 'none') return;   // Q: selection without a gizmo
  const tops = topLevelSelection();
  if (tops.length === 0) return;
  if (tops.length === 1) {
    transformCtl.attach(tops[0].node);
  } else {
    const c = new THREE.Vector3();
    for (const t of tops) c.add(t.node.getWorldPosition(new THREE.Vector3()));
    c.multiplyScalar(1 / tops.length);
    pivot.position.copy(c);
    pivot.rotation.set(0, 0, 0);
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrixWorld(true);
    transformCtl.attach(pivot);
  }
  if (state.transformMode !== 'none') transformCtl.setMode(state.transformMode);
  applySnapSettings();
}

function refreshSelectionVisuals() {
  const want = new Set(state.selection);
  for (const [id, h] of selectionHelpers) {
    if (!want.has(id) || !state.objects.has(id)) { scene.remove(h); disposeSubtree(h); selectionHelpers.delete(id); }
  }
  const active = sel();
  for (const rec of selectedRecs()) {
    let h = selectionHelpers.get(rec.id);
    if (!h) {
      h = new THREE.Box3Helper(new THREE.Box3(), GOLD);
      h.material.depthTest = false;
      h.material.transparent = true;
      h.raycast = () => {};
      scene.add(h);
      selectionHelpers.set(rec.id, h);
    }
    h.material.color.setHex(rec === active ? GOLD : GOLD_DIM);
    boundsOf(rec.node, h.box);
    h.visible = worldVisible(rec) && !h.box.isEmpty() && h.box.getSize(_hs).lengthSq() > 0;
  }
}

transformCtl.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  if (e.value) {
    const tops = topLevelSelection();
    if (!tops.length) return;
    world.updateMatrixWorld(true);
    pivot.updateMatrixWorld(true);
    dragStart = {
      pivotWorld: pivot.matrixWorld.clone(),
      targets: tops.map(rec => ({ rec, trs: captureTRS(rec.node), world: rec.node.matrixWorld.clone() })),
      others: state.faceSnap && state.transformMode === 'translate' ? snapTargets(tops) : null
    };
  } else if (dragStart) {
    showSnapPlanes([]);
    const cmds = [];
    for (const t of dragStart.targets) {
      if (!state.objects.has(t.rec.id)) continue;
      const after = captureTRS(t.rec.node);
      if (!sameTRS(t.trs, after)) cmds.push(transformCommand(t.rec.id, t.trs, after));
    }
    dragStart = null;
    if (cmds.length) { history.push(compound('Transform', cmds)); markDirty(); }
    if (topLevelSelection().length > 1) attachGizmo();   // re-center the pivot
  }
});

/** A pointer gesture whose undo command is recorded only when it ends. */
function gestureActive() {
  return !!(state.placing || state.extrude || (dragStart && transformCtl.dragging));
}

/** Esc during a gesture: put everything back and record nothing. */
function cancelGesture() {
  if (dragStart && transformCtl.dragging) {
    for (const t of dragStart.targets) if (state.objects.has(t.rec.id)) applyTRS(t.rec.node, t.trs);
    dragStart = null;
    showSnapPlanes([]);
    transformCtl.pointerUp(null);            // ends the controls' drag; dragging-changed sees no dragStart
    attachGizmo();
  } else if (state.extrude) {
    const ex = state.extrude;
    state.extrude = null;
    orbit.enabled = true;
    applyTRS(ex.face.rec.node, ex.before);
    showExtrudeFace(null);
  } else if (state.placing) {
    const rec = state.placing;
    state.placing = null;
    if (state.objects.has(rec.id)) removeCommand(rec).redo();   // never recorded, so nothing to undo
    setSelection([]);
  }
  refreshSelectionVisuals();
  syncInspector();
}

transformCtl.addEventListener('objectChange', () => {
  if (transformCtl.object === pivot && dragStart) {
    // apply the pivot's delta to every top-level selected node
    pivot.updateMatrixWorld(true);
    const delta = pivot.matrixWorld.clone().multiply(dragStart.pivotWorld.clone().invert());
    for (const t of dragStart.targets) {
      if (!state.objects.has(t.rec.id)) continue;
      setWorldMatrix(t.rec.node, delta.clone().multiply(t.world));
      clampScale(t.rec.node);
    }
  } else if (transformCtl.object) {
    const n = transformCtl.object;
    clampScale(n);          // snapping can round a thin dimension to zero; dragging can cross it
    n.updateMatrixWorld(true);
  }
  if (dragStart && state.transformMode === 'translate' && effectiveSnap()) applyGridSnap();
  if (dragStart && dragStart.others) applyFaceSnap();
  refreshSelectionVisuals();
  syncInspector();
});

/** Snap the dragged selection so its world bounds' min corner (and bottom) lie on grid multiples. */
function applyGridSnap() {
  const live = dragStart.targets.filter(t => state.objects.has(t.rec.id));
  if (!live.length) return;
  const g = state.gridSize;
  const box = new THREE.Box3();
  for (const t of live) box.union(boundsOf(t.rec.node));
  const anchor = box.isEmpty() ? live[0].rec.node.getWorldPosition(new THREE.Vector3()) : box.min;   // notes and markers: snap the point itself
  const d = new THREE.Vector3(
    Math.round(anchor.x / g) * g - anchor.x,
    Math.round(anchor.y / g) * g - anchor.y,
    Math.round(anchor.z / g) * g - anchor.z);
  if (d.lengthSq() < 1e-12) return;
  for (const t of live) {
    const m = t.rec.node.matrixWorld.clone();
    m.setPosition(new THREE.Vector3().setFromMatrixPosition(m).add(d));
    setWorldMatrix(t.rec.node, m);
  }
  if (transformCtl.object === pivot) { pivot.position.add(d); pivot.updateMatrixWorld(true); }
}

// ---- face-to-face snapping (Shift+G) ----
// World AABBs of everything that is not part of the dragged selection: real
// geometry plus trigger volumes. Cached at drag start.
const _sb = new THREE.Box3();
function ownBounds(rec) {
  if (rec.mesh && rec.mesh.geometry) {
    if (!rec.mesh.geometry.boundingBox) rec.mesh.geometry.computeBoundingBox();
    return _sb.copy(rec.mesh.geometry.boundingBox).applyMatrix4(rec.mesh.matrixWorld).clone();
  }
  if (rec.type === 'marker' && MARKER_BY_KEY[rec.marker]?.shape === 'volume') return boundsOf(rec.node).clone();
  return null;
}
function snapTargets(tops) {
  world.updateMatrixWorld(true);
  const out = [];
  for (const rec of allRecs()) {
    if (!worldVisible(rec) || tops.some(t => t === rec || isAncestor(t, rec))) continue;
    const b = ownBounds(rec);
    if (b && !b.isEmpty()) out.push({ min: b.min.toArray(), max: b.max.toArray() });
  }
  return out;
}
function applyFaceSnap() {
  const live = dragStart.targets.filter(t => state.objects.has(t.rec.id));
  if (!live.length) return;
  const box = new THREE.Box3();
  for (const t of live) box.union(boundsOf(t.rec.node));
  if (box.isEmpty()) return;
  const { delta, planes } = faceSnapDelta({ min: box.min.toArray(), max: box.max.toArray() }, dragStart.others, FACE_SNAP_THRESHOLD());
  if (delta.some(Boolean)) {
    const d = new THREE.Vector3(...delta);
    for (const t of live) {
      const m = t.rec.node.matrixWorld.clone();
      m.setPosition(new THREE.Vector3().setFromMatrixPosition(m).add(d));
      setWorldMatrix(t.rec.node, m);
    }
    if (transformCtl.object === pivot) { pivot.position.add(d); pivot.updateMatrixWorld(true); }
  }
  showSnapPlanes(planes);
}
const snapPlanePool = [];
function showSnapPlanes(planes) {
  while (snapPlanePool.length < planes.length) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: LAPIS, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthTest: false }));
    mesh.renderOrder = 8;
    mesh.raycast = () => {};
    scene.add(mesh);
    snapPlanePool.push(mesh);
  }
  snapPlanePool.forEach((mesh, i) => {
    const pl = planes[i];
    mesh.visible = !!pl;
    if (!pl) return;
    const size = [pl.max[0] - pl.min[0], pl.max[1] - pl.min[1], pl.max[2] - pl.min[2]];
    mesh.position.set((pl.min[0] + pl.max[0]) / 2, (pl.min[1] + pl.max[1]) / 2, (pl.min[2] + pl.max[2]) / 2);
    mesh.rotation.set(0, 0, 0);
    if (pl.axis === 0) { mesh.rotation.y = Math.PI / 2; mesh.scale.set(Math.max(1, size[2]), Math.max(1, size[1]), 1); }
    else if (pl.axis === 1) { mesh.rotation.x = -Math.PI / 2; mesh.scale.set(Math.max(1, size[0]), Math.max(1, size[2]), 1); }
    else mesh.scale.set(Math.max(1, size[0]), Math.max(1, size[1]), 1);
  });
}
function setFaceSnap(on) {
  state.faceSnap = !!on;
  const el = document.getElementById('face-toggle');
  el.classList.toggle('on', state.faceSnap);
  el.setAttribute('aria-pressed', String(state.faceSnap));
  applySnapSettings();
}

function clampScale(n) {
  n.scale.x = Math.max(MIN_SIZE, Math.abs(n.scale.x));
  n.scale.y = Math.max(MIN_SIZE, Math.abs(n.scale.y));
  n.scale.z = Math.max(MIN_SIZE, Math.abs(n.scale.z));
}

function transformCommand(id, before, after) {
  const apply = (trs) => {
    const r = state.objects.get(id);
    if (!r) return;
    applyTRS(r.node, trs);
    if (!state.selection.includes(id)) setSelection([id]);
    else attachGizmo();
    refreshSelectionVisuals();
    syncInspector();
    markDirty();
  };
  return { label: 'Transform', undo: () => apply(before), redo: () => apply(after) };
}

// Q, W, E and R are one radio group: Q is select with no gizmo, W/E/R are
// select with that gizmo. Placement, measure and extrude tools light their own
// button and none of these. The rail therefore always shows exactly one mode.
function setTransformMode(mode) {
  state.transformMode = mode;
  if (mode !== 'none') transformCtl.setMode(mode);
  if (state.tool !== 'select') setTool('select'); else attachGizmo();
  syncRail();
}
function syncRail() {
  document.querySelectorAll('#toolrail [data-mode]').forEach(b =>
    b.classList.toggle('active', state.tool === 'select' && b.dataset.mode === state.transformMode));
  document.querySelectorAll('#toolrail [data-tool]').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === state.tool || (b.dataset.tool === 'marker' && state.tool.startsWith('place-marker-'))));
}

function applySnapSettings() {
  const on = effectiveSnap();
  transformCtl.setTranslationSnap(null);       // translation snaps by bounds in applyGridSnap(), not by center
  transformCtl.setRotationSnap(on ? THREE.MathUtils.degToRad(ROTATION_SNAP_DEG) : null);
  // Dimensions live in scale, so snapping scale to the grid snaps sizes to
  // whole cells. The pivot (multi-select) must never scale-snap: its scale is
  // a factor, not a size.
  const single = transformCtl.object && transformCtl.object !== pivot && GEOMETRY_TYPES.has(recOf(transformCtl.object)?.type);
  transformCtl.setScaleSnap(on && single ? state.gridSize : null);
  const el = document.getElementById('snap-toggle');
  el.classList.toggle('on', state.snap);
  el.setAttribute('aria-pressed', String(state.snap));
  document.getElementById('status-snap').textContent =
    (on ? `snap ${state.gridSize}u / ${ROTATION_SNAP_DEG}°` : 'snap off')
    + (state.shiftHeld ? ' (Shift)' : state.snap ? ' · hold Shift to move freely' : ' · hold Shift to snap')
    + (state.faceSnap ? ' · faces' : '');
}

// ============================================================================
// 6b. Face extrude (X)
// ============================================================================
// A primitive's dimensions are its scale, so pulling one axis-aligned face is a
// size change with the opposite face pinned: the object grows from that face,
// stays a watertight unit mesh, and exports exactly as before. That is what a
// level designer means by "extrude" during blockout (a wall longer, a floor
// wider, a platform taller). Polygonal extrusion that adds faces to a mesh is a
// different feature and would break the primitive model; see README.

const AXIS_VEC = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const AXIS_NAME = ['X', 'Y', 'Z'];

/** The axis-aligned face under the pointer on a geometry object, or null (with a reason for the status bar). */
function faceUnderPointer(evt) {
  const hit = pick(evt);
  if (!hit || !hit.face || !hit.rec.mesh || hit.object !== hit.rec.mesh) return null;
  const n = hit.face.normal;                     // local space
  const a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
  const axis = a.indexOf(Math.max(...a));
  if (a[axis] < 0.98) return { rec: hit.rec, axis: -1 };   // slope or curve: not extrudable this way
  const sign = n.getComponent(axis) >= 0 ? 1 : -1;
  return describeFace(hit.rec, axis, sign);
}

function describeFace(rec, axis, sign) {
  const node = rec.node;
  node.updateWorldMatrix(true, false);
  const center = AXIS_VEC[axis].clone().multiplyScalar(sign * 0.5).applyMatrix4(node.matrixWorld);
  const normal = AXIS_VEC[axis].clone().multiplyScalar(sign).transformDirection(node.matrixWorld);
  return { rec, axis, sign, center, normal };
}

const extrudeQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: LAPIS, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthTest: false }));
extrudeQuad.renderOrder = 8;
extrudeQuad.raycast = () => {};
extrudeQuad.matrixAutoUpdate = false;
extrudeQuad.visible = false;
scene.add(extrudeQuad);
let extrudeLabel = null;

/** Highlight a face: the unit plane placed in the object's local frame, so it inherits the object's size and rotation. */
function showExtrudeFace(face, deltaText = null) {
  if (!face || face.axis < 0) {
    extrudeQuad.visible = false;
    if (extrudeLabel) { scene.remove(extrudeLabel); disposeSubtree(extrudeLabel); extrudeLabel = null; }
    if (state.tool === 'extrude') {
      document.getElementById('status-measure').textContent = face ? `${face.rec.name}: not an axis-aligned face` : '';
    }
    return;
  }
  const { rec, axis, sign } = face;
  const local = new THREE.Matrix4().makeTranslation(AXIS_VEC[axis].x * sign * 0.5, AXIS_VEC[axis].y * sign * 0.5, AXIS_VEC[axis].z * sign * 0.5);
  const rot = new THREE.Matrix4();
  if (axis === 0) rot.makeRotationY(sign * Math.PI / 2);
  else if (axis === 1) rot.makeRotationX(-sign * Math.PI / 2);
  else if (sign < 0) rot.makeRotationY(Math.PI);
  extrudeQuad.matrix.copy(rec.node.matrixWorld).multiply(local).multiply(rot);
  extrudeQuad.matrixWorldNeedsUpdate = true;
  extrudeQuad.visible = true;
  if (extrudeLabel) { scene.remove(extrudeLabel); disposeSubtree(extrudeLabel); extrudeLabel = null; }
  if (deltaText != null) {
    extrudeLabel = makeTextSprite(deltaText, '#8fa8f5', Math.max(state.gridSize * 0.4, 12), { background: 'rgba(20,22,27,0.82)' });
    extrudeLabel.material.depthTest = false;
    extrudeLabel.renderOrder = 10;
    extrudeLabel.position.copy(face.center).addScaledVector(face.normal, state.gridSize * 0.3);
    scene.add(extrudeLabel);
  }
  const size = rec.node.getWorldScale(new THREE.Vector3()).getComponent(axis);
  document.getElementById('status-measure').textContent =
    `${rec.name} ${sign > 0 ? '+' : '−'}${AXIS_NAME[axis]} face` + (deltaText != null ? `  ${deltaText}` : `  ·  ${fmt(size)} u along ${AXIS_NAME[axis]}`);
}

function beginExtrude(evt) {
  const face = faceUnderPointer(evt);
  if (!face || face.axis < 0) { showExtrudeFace(face); return; }
  const node = face.rec.node;
  const pos0 = new THREE.Vector3(), quat0 = new THREE.Quaternion(), scl0 = new THREE.Vector3();
  node.matrixWorld.decompose(pos0, quat0, scl0);
  // screen direction of the face normal, and how many pixels one unit along it moves
  const r = renderer.domElement.getBoundingClientRect();
  const toPx = (v) => { const p = v.clone().project(camera); return new THREE.Vector2((p.x + 1) / 2 * r.width, (1 - p.y) / 2 * r.height); };
  const p0 = toPx(face.center), p1 = toPx(face.center.clone().add(face.normal));
  const dirPx = p1.clone().sub(p0);
  const pxPerUnit = dirPx.length();
  if (pxPerUnit < 1e-6) return;                   // looking straight along the normal: no way to drag it
  state.extrude = {
    face, pos0, quat0, scl0,
    before: captureTRS(node),
    mouse0: new THREE.Vector2(evt.clientX - r.left, evt.clientY - r.top),
    dirPx: dirPx.normalize(), pxPerUnit,
    faceCoord0: face.center.dot(face.normal),     // world coordinate of the face along its normal
    d: 0
  };
  orbit.enabled = false;
  capturePointer(evt);
  showExtrudeFace(face, '+0 u');
}

function updateExtrude(evt) {
  const ex = state.extrude;
  const r = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(evt.clientX - r.left, evt.clientY - r.top);
  let d = mouse.sub(ex.mouse0).dot(ex.dirPx) / ex.pxPerUnit;
  if (effectiveSnap()) {
    const g = state.gridSize;
    const n = ex.face.normal;
    const worldAligned = Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)) > 0.999;
    // an axis-aligned face snaps to grid planes in world space; a rotated one snaps its travel to whole cells
    d = worldAligned ? Math.round((ex.faceCoord0 + d) / g) * g - ex.faceCoord0 : Math.round(d / g) * g;
  }
  const { axis, sign } = ex.face;
  const size0 = ex.scl0.getComponent(axis);
  d = Math.max(MIN_SIZE - size0, d);              // never through the opposite face
  ex.d = d;
  const scl = ex.scl0.clone().setComponent(axis, size0 + d);
  const pos = ex.pos0.clone().addScaledVector(ex.face.normal, d / 2);   // opposite face pinned
  const m = new THREE.Matrix4().compose(pos, ex.quat0, scl);
  setWorldMatrix(ex.face.rec.node, m);
  const live = describeFace(ex.face.rec, axis, sign);
  showExtrudeFace(live, `${d >= 0 ? '+' : ''}${fmt(d)} u  →  ${fmt(size0 + d)} u`);
  refreshSelectionVisuals();
  if (state.selection.includes(ex.face.rec.id)) syncInspector();
}

function endExtrude() {
  const ex = state.extrude;
  state.extrude = null;
  orbit.enabled = true;
  const after = captureTRS(ex.face.rec.node);
  if (!sameTRS(ex.before, after)) {
    history.push(transformCommand(ex.face.rec.id, ex.before, after));
    markDirty();
  }
  showExtrudeFace(describeFace(ex.face.rec, ex.face.axis, ex.face.sign));
  refreshSelectionVisuals();
}

// ============================================================================
// 7. Measurement
// ============================================================================

function scenePoint(evt) {
  // prefer object surfaces, fall back to the ground plane
  const hit = pick(evt);
  return hit ? hit.point : groundPoint(evt);
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
    const label = makeTextSprite(`${fmt(d)} u · ${(d / 100).toFixed(2)} m`, '#8fa8f5', Math.max(state.gridSize * 0.5, d * 0.045));
    label.position.copy(mid).add(new THREE.Vector3(0, state.gridSize * 0.4, 0));
    label.material.depthTest = false;
    m.group.add(label);
    document.getElementById('status-measure').textContent =
      `measure: ${fmt(d)} u = ${(d / 100).toFixed(2)} m   (Δx ${fmt(Math.abs(m.b.x - m.a.x))}  Δy ${fmt(Math.abs(m.b.y - m.a.y))}  Δz ${fmt(Math.abs(m.b.z - m.a.z))})`;
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
  if (m.group) { scene.remove(m.group); disposeSubtree(m.group); }
  m.a = m.b = m.group = null;
  document.getElementById('status-measure').textContent = '';
}

function clearMeasureIfLeaving(tool) {
  if (tool !== 'measure') clearMeasure();
}

// ---- metric ticks on capsule markers (H) ----
// v0.2/v0.3 drew a fixed player figure at the origin. It could not be moved and
// had nothing to do with where walk mode started, so it is gone: the PlayerStart
// marker is the player (walk begins there), and the height ticks that made the
// figure useful as a ruler now live on every capsule marker, toggled with H.
function setTicks(on, { quiet = false } = {}) {
  state.showTicks = !!on;
  const el = document.getElementById('ticks-toggle');
  el.classList.toggle('on', state.showTicks);
  el.setAttribute('aria-pressed', String(state.showTicks));
  let capsules = 0;
  for (const rec of state.objects.values()) if (rec.type === 'marker') { buildMarkerVisual(rec); if (MARKER_BY_KEY[rec.marker]?.shape === 'capsule') capsules++; }
  if (state.showTicks && !capsules && !quiet) toast('Ticks show on Player start and Spawn markers. Place one with K or the ◎ button.');
}

// ============================================================================
// 8. Hierarchy panel: tree with drag/drop
// ============================================================================

const hierarchyEl = document.getElementById('hierarchy-list');
let dragIds = null;                  // ids being dragged from the hierarchy

// Keyboard focus in the tree survives the rebuild below (every selection
// change rebuilds the rows). hierFocusId is the row that owns tabindex=0.
let hierFocusId = null, hierRefocus = false;

function refreshHierarchy() {
  const hadFocus = hierRefocus || hierarchyEl.contains(document.activeElement);
  hierRefocus = false;
  hierarchyEl.innerHTML = '';
  const selected = new Set(state.selection);
  const active = state.selection[state.selection.length - 1];
  if (active && !hadFocus) hierFocusId = active;
  if (hierFocusId && !state.objects.has(hierFocusId)) hierFocusId = active || null;
  let total = 0, focusRow = null, firstRow = null;

  const addRows = (recs, depth) => {
    for (const rec of recs) {
      total++;
      const kids = childRecs(rec);
      const row = document.createElement('div');
      row.className = 'h-row'
        + (selected.has(rec.id) ? ' selected' : '')
        + (rec.id === active ? ' active' : '')
        + (worldVisible(rec) ? '' : ' hidden-obj')
        + (rec.type === 'group' ? ' is-group' : '');
      row.dataset.id = rec.id;
      row.style.paddingLeft = (6 + depth * 14) + 'px';
      row.draggable = true;
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(depth + 1));
      row.setAttribute('aria-selected', selected.has(rec.id) ? 'true' : 'false');
      if (kids.length) row.setAttribute('aria-expanded', rec.collapsed ? 'false' : 'true');
      row.setAttribute('aria-label', `${rec.name}, ${rec.type}${worldVisible(rec) ? '' : ', hidden'}`);
      row.tabIndex = -1;
      if (!firstRow) firstRow = row;
      if (rec.id === hierFocusId) focusRow = row;

      const caret = document.createElement('button');
      caret.className = 'h-caret' + (kids.length ? '' : ' empty');
      caret.textContent = kids.length ? (rec.collapsed ? '▸' : '▾') : '';
      caret.title = rec.collapsed ? 'Expand' : 'Collapse';
      caret.tabIndex = -1;                     // the tree's arrow keys do this
      caret.setAttribute('aria-hidden', 'true');
      caret.addEventListener('click', (e) => { e.stopPropagation(); rec.collapsed = !rec.collapsed; refreshHierarchy(); });

      const eye = document.createElement('button');
      eye.className = 'h-eye';
      eye.title = rec.visible ? 'Hide' : 'Show';
      eye.textContent = rec.visible ? '◉' : '○';
      eye.tabIndex = -1;                       // Shift+H on a focused row does this
      eye.setAttribute('aria-hidden', 'true');
      eye.addEventListener('click', (e) => { e.stopPropagation(); setVisibility(rec.id, !rec.visible); });

      const icon = document.createElement('span');
      icon.className = 'h-icon';
      icon.textContent = TYPE_ICON[rec.type] || '△';
      icon.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.className = 'h-name';
      name.textContent = rec.name;
      name.title = 'Double-click to rename';

      const count = document.createElement('span');
      count.className = 'h-count';
      count.textContent = kids.length ? String(kids.length) : '';

      const del = document.createElement('button');
      del.className = 'h-del';
      del.title = 'Delete';
      del.textContent = '✕';
      del.tabIndex = -1;                       // Delete on a focused row does this
      del.setAttribute('aria-hidden', 'true');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const cmd = removeCommand(rec); cmd.redo(); history.push(cmd);
      });

      row.append(caret, eye, icon, name, count, del);
      row.addEventListener('click', (e) => {
        hierFocusId = rec.id;
        if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelect(rec.id);
        else setSelection([rec.id]);
      });
      row.addEventListener('keydown', (e) => hierarchyKey(e, rec, row));
      row.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(row, rec); });
      wireDragRow(row, rec);
      hierarchyEl.appendChild(row);
      if (kids.length && !rec.collapsed) addRows(kids, depth + 1);
    }
  };
  addRows(rootRecs(), 0);
  const tabRow = focusRow || firstRow;
  if (tabRow) {
    tabRow.tabIndex = 0;
    hierFocusId = tabRow.dataset.id;
    if (hadFocus) tabRow.focus();
  }

  document.getElementById('hierarchy-count').textContent =
    total ? `${total} object${total === 1 ? '' : 's'}` : 'empty: press C to add a cube';
  document.getElementById('btn-group').disabled = state.selection.length === 0;
}

// ---- keyboard: WAI-ARIA tree pattern plus Alt+arrows to reorder/reparent ----
// Up/Down move and select (Shift extends), Left/Right collapse/expand or go
// to parent/first child, Home/End, Space toggles membership, Enter/F2
// renames, Shift+H toggles visibility. Alt+Up/Down reorder among siblings,
// Alt+Left moves out of the parent, Alt+Right moves into the group above.
// Everything else (Delete, Ctrl+G, Ctrl+D, W/E/R...) falls through to the
// global shortcuts, which act on the selection.
function hierarchyKey(e, rec, row) {
  const visibleRows = [...hierarchyEl.querySelectorAll('.h-row')];
  const i = visibleRows.indexOf(row);
  const go = (r, { extend = false } = {}) => {
    if (!r) return;
    const id = r.dataset.id;
    hierFocusId = id;
    if (!extend) setSelection([id]);
    else if (!state.selection.includes(id)) setSelection([...state.selection, id]);
    else refreshHierarchy();
  };
  const parent = parentRec(rec);
  const siblings = childRecs(parent || { node: world });
  const si = siblings.indexOf(rec);
  const kids = childRecs(rec);
  let handled = true;
  if (e.altKey) {
    if (gestureActive()) return;
    hierFocusId = rec.id;
    if (e.key === 'ArrowUp' && si > 0) moveRecs([rec], parent, siblings[si - 1]);
    else if (e.key === 'ArrowDown' && si < siblings.length - 1) moveRecs([rec], parent, siblings[si + 2] || null);
    else if (e.key === 'ArrowLeft' && parent) {
      const gp = parentRec(parent);
      const pSibs = childRecs(gp || { node: world });
      moveRecs([rec], gp, pSibs[pSibs.indexOf(parent) + 1] || null);
    } else if (e.key === 'ArrowRight' && si > 0 && siblings[si - 1].type === 'group') {
      siblings[si - 1].collapsed = false;
      moveRecs([rec], siblings[si - 1], null);
    } else handled = e.key.startsWith('Arrow');
  } else switch (e.key) {
    case 'ArrowDown': go(visibleRows[i + 1], { extend: e.shiftKey }); break;
    case 'ArrowUp': go(visibleRows[i - 1], { extend: e.shiftKey }); break;
    case 'Home': go(visibleRows[0]); break;
    case 'End': go(visibleRows[visibleRows.length - 1]); break;
    case 'ArrowRight':
      if (kids.length && rec.collapsed) { rec.collapsed = false; hierFocusId = rec.id; refreshHierarchy(); }
      else if (kids.length) go(visibleRows[i + 1]);
      break;
    case 'ArrowLeft':
      if (kids.length && !rec.collapsed) { rec.collapsed = true; hierFocusId = rec.id; refreshHierarchy(); }
      else if (parent) go(visibleRows.find(r => r.dataset.id === parent.id));
      break;
    case ' ': hierFocusId = rec.id; toggleSelect(rec.id); break;
    case 'Enter': case 'F2': hierRefocus = true; hierFocusId = rec.id; startRename(row, rec); break;
    case 'H': if (e.shiftKey) { hierFocusId = rec.id; setVisibility(rec.id, !rec.visible); } else handled = false; break;
    default: handled = false;
  }
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}

// ---- drag & drop reparenting ----
function wireDragRow(row, rec) {
  row.addEventListener('dragstart', (e) => {
    const inSel = state.selection.includes(rec.id);
    dragIds = inSel ? topLevelSelection().map(r => r.id) : [rec.id];
    e.dataTransfer.setData('text/plain', dragIds.join(','));
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => { dragIds = null; clearDropMarks(); });
  row.addEventListener('dragover', (e) => {
    if (!dragIds) return;
    const dragged = dragIds.map(id => state.objects.get(id)).filter(Boolean);
    if (dragged.some(d => d === rec || isAncestor(d, rec))) return;   // can't drop into yourself
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarks();
    row.classList.add(dropZone(e, row));
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after', 'drop-into'));
  row.addEventListener('drop', (e) => {
    if (!dragIds) return;
    e.preventDefault();
    e.stopPropagation();
    const zone = dropZone(e, row);
    const dragged = dragIds.map(id => state.objects.get(id)).filter(Boolean);
    clearDropMarks();
    dragIds = null;
    if (dragged.some(d => d === rec || isAncestor(d, rec))) return;
    if (zone === 'drop-into') { rec.collapsed = false; moveRecs(dragged, rec, null); return; }
    const parent = parentRec(rec);
    if (zone === 'drop-before') { moveRecs(dragged, parent, rec); return; }
    // after: insert before the next sibling that is not itself being dragged
    const siblings = childRecs(parent || { node: world }).filter(r => !dragged.includes(r));
    const next = siblings[siblings.indexOf(rec) + 1] || null;
    moveRecs(dragged, parent, next);
  });
}

function dropZone(e, row) {
  const r = row.getBoundingClientRect();
  const f = (e.clientY - r.top) / r.height;
  return f < 0.25 ? 'drop-before' : f > 0.75 ? 'drop-after' : 'drop-into';
}

function clearDropMarks() {
  hierarchyEl.classList.remove('drop-root');
  hierarchyEl.querySelectorAll('.drop-before, .drop-after, .drop-into, .dragging')
    .forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-into', 'dragging'));
}

// dropping on the empty area below the rows moves to the root level (end)
hierarchyEl.addEventListener('dragover', (e) => {
  if (!dragIds || e.target !== hierarchyEl) return;
  e.preventDefault();
  hierarchyEl.classList.add('drop-root');
});
hierarchyEl.addEventListener('dragleave', (e) => { if (e.target === hierarchyEl) hierarchyEl.classList.remove('drop-root'); });
hierarchyEl.addEventListener('drop', (e) => {
  hierarchyEl.classList.remove('drop-root');
  if (!dragIds || e.target !== hierarchyEl) return;
  e.preventDefault();
  const dragged = dragIds.map(id => state.objects.get(id)).filter(Boolean);
  dragIds = null;
  moveRecs(dragged, null, null);
});

function startRename(row, rec) {
  const nameEl = row.querySelector('.h-name');
  const input = document.createElement('input');
  input.className = 'h-rename';
  input.value = rec.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    if (next && next !== rec.name) renameObject(rec.id, next);
    else refreshHierarchy();
    hierRefocus = false;
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = rec.name; input.blur(); }
    e.stopPropagation();
  });
}

// ============================================================================
// 9. Inspector
// ============================================================================

const insp = {
  panel: document.getElementById('inspector'),
  empty: document.getElementById('inspector-empty'),
  multi: document.getElementById('insp-multi'),
  single: document.getElementById('insp-single'),
  name: document.getElementById('insp-name'),
  type: document.getElementById('insp-type'),
  grid: document.getElementById('insp-grid'),
  sizeLabel: document.getElementById('insp-size-label'),
  rowSteps: document.getElementById('insp-row-steps'),
  steps: document.getElementById('insp-steps'),
  rowText: document.getElementById('insp-row-text'),
  text: document.getElementById('insp-text'),
  rowBounds: document.getElementById('insp-row-bounds'),
  bbox: document.getElementById('insp-bbox'),
  rowColor: document.getElementById('insp-row-color'),
  swatches: document.getElementById('insp-swatches'),
  intentName: document.getElementById('insp-intent-name'),
  rowMarker: document.getElementById('insp-row-marker'),
  marker: document.getElementById('insp-marker'),
  rowTags: document.getElementById('insp-row-tags'),
  tags: document.getElementById('insp-tags'),
  group: document.getElementById('insp-group'),
  ungroup: document.getElementById('insp-ungroup'),
  fields: {}
};
for (const group of ['pos', 'rot', 'size']) {
  for (const axis of ['x', 'y', 'z']) {
    insp.fields[group + axis] = document.getElementById(`insp-${group}-${axis}`);
  }
}

let syncing = false;

function syncInspector() {
  const recs = selectedRecs();
  const rec = sel();
  insp.panel.classList.toggle('hidden', !rec);
  insp.empty.classList.toggle('hidden', !!rec);
  const status = document.getElementById('status-sel');
  if (!rec) { status.textContent = ''; return; }
  syncing = true;

  const multi = recs.length > 1;
  insp.multi.classList.toggle('hidden', !multi);
  insp.single.classList.toggle('hidden', multi);
  insp.ungroup.classList.toggle('hidden', !recs.some(r => r.type === 'group'));
  insp.group.classList.toggle('hidden', recs.length < 2);          // Ctrl+G still groups a single object

  if (multi) {
    const tops = topLevelSelection();
    insp.multi.textContent = `${recs.length} objects selected` + (tops.length !== recs.length ? ` (${tops.length} top-level)` : '')
      + ' · fields edit every top-level object; type +=, -= or *= for relative changes';
    insp.rowSteps.classList.add('hidden');
    insp.rowText.classList.add('hidden');
    insp.rowMarker.classList.add('hidden');
    insp.rowTags.classList.add('hidden');
    insp.rowBounds.classList.remove('hidden');
    // Shared value when every top-level object agrees, an em-dash when they differ.
    insp.sizeLabel.textContent = tops.some(r => GEOMETRY_TYPES.has(r.type)) ? 'Size u' : 'Scale';
    for (const group of ['pos', 'rot', 'size']) {
      ['x', 'y', 'z'].forEach((axis) => {
        const el = insp.fields[group + axis];
        const vals = tops.map(r => fieldValue(r, group, axis));
        const same = vals.every(v => fmt(v) === fmt(vals[0]));
        if (document.activeElement !== el) { el.value = same ? fmt(vals[0]) : ''; el.placeholder = same ? '' : '—'; }
        el.disabled = tops.every(r => fieldLocked(r, group));
      });
    }
    const box = new THREE.Box3();
    for (const r of tops) box.union(boundsOf(r.node));
    const size = box.getSize(new THREE.Vector3());
    insp.bbox.textContent = `${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)} u`;
    insp.rowColor.classList.toggle('hidden', !recs.some(r => r.type !== 'group'));
    syncIntentSwatches(recs);
    status.textContent = `${recs.length} selected`;
    syncing = false;
    return;
  }

  insp.name.value = rec.name;
  insp.type.textContent = rec.type === 'marker' ? (MARKER_BY_KEY[rec.marker]?.label || 'marker') : rec.type;
  const n = rec.node;
  const isGeom = GEOMETRY_TYPES.has(rec.type);
  insp.sizeLabel.textContent = isGeom || isVolume(rec) ? 'Size u' : 'Scale';
  for (const group of ['pos', 'rot', 'size']) {
    ['x', 'y', 'z'].forEach((axis) => {
      const el = insp.fields[group + axis];
      if (document.activeElement !== el) { el.value = fmt(fieldValue(rec, group, axis)); el.placeholder = ''; }
      el.disabled = fieldLocked(rec, group);
    });
  }
  insp.rowSteps.classList.toggle('hidden', rec.type !== 'stairs');
  if (rec.type === 'stairs' && document.activeElement !== insp.steps) insp.steps.value = rec.params.steps;
  insp.rowText.classList.toggle('hidden', rec.type !== 'note');
  if (rec.type === 'note' && document.activeElement !== insp.text) insp.text.value = rec.text || '';
  insp.rowMarker.classList.toggle('hidden', rec.type !== 'marker');
  if (rec.type === 'marker') insp.marker.value = rec.marker;
  insp.rowTags.classList.toggle('hidden', rec.type === 'group' || rec.type === 'note');
  if (document.activeElement !== insp.tags) insp.tags.value = (rec.tags || []).join(', ');
  insp.rowColor.classList.toggle('hidden', rec.type === 'group');
  syncIntentSwatches([rec]);

  if (rec.type === 'note') {
    insp.rowBounds.classList.add('hidden');
    status.textContent = `${rec.name} (note)`;
  } else if (rec.type === 'marker' && !isVolume(rec)) {
    insp.rowBounds.classList.add('hidden');
    status.textContent = `${rec.name} (${MARKER_BY_KEY[rec.marker]?.label || 'marker'})`;
  } else {
    insp.rowBounds.classList.remove('hidden');
    const box = boundsOf(n);
    const size = box.getSize(new THREE.Vector3());
    const kids = childRecs(rec).length;
    insp.bbox.textContent = `${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)} u` + (kids ? `  ·  ${kids} child${kids === 1 ? '' : 'ren'}` : '');
    status.textContent = `${rec.name}: ${fmt(size.x)}×${fmt(size.y)}×${fmt(size.z)}u`;
  }
  syncing = false;
}

const isVolume = (rec) => rec.type === 'marker' && MARKER_BY_KEY[rec.marker]?.shape === 'volume';
/** Notes only move; markers move and turn (only trigger volumes have a size). */
function fieldLocked(rec, group) {
  if (rec.type === 'note') return group !== 'pos';
  if (rec.type === 'marker') return group === 'size' && !isVolume(rec);
  return false;
}
// Position Y can read as the object's center (the transform, what the file
// stores) or its base (bottom of its own geometry): a 64 cube on the ground is
// 32 or 0. Base is the local geometry's min y scaled, so a rotated object
// reports the bottom of its own frame, not its world bounds.
function baseOffset(rec) {
  if (!state.pivotBase) return 0;
  if (rec.mesh && rec.mesh.geometry) {
    if (!rec.mesh.geometry.boundingBox) rec.mesh.geometry.computeBoundingBox();
    return -rec.mesh.geometry.boundingBox.min.y * rec.node.scale.y;
  }
  if (isVolume(rec)) return 0.5 * rec.node.scale.y;
  return 0;
}
function fieldValue(rec, group, axis) {
  const node = rec.node;
  if (group === 'pos') return node.position[axis] - (axis === 'y' ? baseOffset(rec) : 0);
  if (group === 'rot') return THREE.MathUtils.radToDeg(node.rotation[axis]);
  return node.scale[axis];
}
function setFieldValue(rec, group, axis, v) {
  const node = rec.node;
  if (group === 'pos') node.position[axis] = v + (axis === 'y' ? baseOffset(rec) : 0);
  if (group === 'rot') node.rotation[axis] = THREE.MathUtils.degToRad(v);
  if (group === 'size') node.scale[axis] = Math.max(0.01, v);
}
function setPivotBase(on, { remember = true } = {}) {
  state.pivotBase = !!on;
  const b = document.getElementById('insp-pivot');
  b.textContent = state.pivotBase ? 'base' : 'center';
  b.classList.toggle('on', state.pivotBase);
  insp.fields.posy.title = state.pivotBase ? 'Bottom of the object' : 'Center of the object';
  if (remember) { try { localStorage.setItem('ptah.pivotBase', state.pivotBase ? '1' : '0'); } catch { /* storage unavailable */ } }
  syncInspector();
}
document.getElementById('insp-pivot').addEventListener('click', () => setPivotBase(!state.pivotBase));

/** "12", "+=64", "-=8", "*=2", "/=2" → function of the current value, or null. */
function parseFieldExpr(text) {
  const m = /^\s*(?:([+\-*/])=)?\s*(-?\d*\.?\d+(?:e-?\d+)?)\s*$/i.exec(text);
  if (!m) return null;
  const v = parseFloat(m[2]);
  if (!isFinite(v)) return null;
  switch (m[1]) {
    case '+': return (cur) => cur + v;
    case '-': return (cur) => cur - v;
    case '*': return (cur) => cur * v;
    case '/': return v === 0 ? null : (cur) => cur / v;
    default: return () => v;
  }
}

/** One field, every top-level selected object. Relative expressions apply per object. */
function commitInspectorField(group, axis) {
  if (syncing) return;
  const el = insp.fields[group + axis];
  const tops = topLevelSelection().filter(r => !fieldLocked(r, group));
  if (!tops.length) { syncInspector(); return; }
  const f = parseFieldExpr(el.value);
  if (!f) { syncInspector(); return; }
  const cmds = [];
  for (const rec of tops) {
    const before = captureTRS(rec.node);
    setFieldValue(rec, group, axis, f(fieldValue(rec, group, axis)));
    rec.node.updateMatrixWorld(true);
    const after = captureTRS(rec.node);
    if (!sameTRS(before, after)) cmds.push(transformCommand(rec.id, before, after));
  }
  if (cmds.length) {
    history.push(cmds.length === 1 ? cmds[0] : compound('Edit ' + tops.length + ' objects', cmds));
    markDirty();
  }
  if (tops.length > 1) attachGizmo();        // re-center the pivot
  refreshSelectionVisuals();
  syncInspector();
}

// The transform fields are text inputs so relative expressions ("+=64", "*=2")
// survive; a number input would sanitize them to nothing. Arrow keys nudge by
// the field's step (Shift x10), which is what the number type used to give.
for (const group of ['pos', 'rot', 'size']) {
  for (const axis of ['x', 'y', 'z']) {
    const el = insp.fields[group + axis];
    el.addEventListener('change', () => commitInspectorField(group, axis));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.blur();
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const cur = parseFloat(el.value);
        if (!isNaN(cur)) {
          const step = (parseFloat(el.dataset.step) || 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
          el.value = fmt(cur + step);
          commitInspectorField(group, axis);
        }
        e.preventDefault();
      }
      e.stopPropagation();
    });
  }
}

insp.name.addEventListener('change', () => {
  const rec = sel();
  if (rec && insp.name.value.trim()) renameObject(rec.id, insp.name.value.trim());
});
insp.name.addEventListener('keydown', (e) => e.stopPropagation());

insp.steps.addEventListener('change', () => {
  const rec = sel();
  if (rec) setStairsSteps(rec.id, parseFloat(insp.steps.value));
});
insp.steps.addEventListener('keydown', (e) => { if (e.key === 'Enter') insp.steps.blur(); e.stopPropagation(); });

insp.text.addEventListener('change', () => {
  const rec = sel();
  if (rec) setNoteText(rec.id, insp.text.value);
});
insp.text.addEventListener('keydown', (e) => e.stopPropagation());

// Intent swatches: the only colors. Clicking one sets intent + color on every
// selected object that has geometry; notes and markers just take the color.
const swatchButtons = new Map();
for (const it of INTENTS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.dataset.intent = it.key;
  b.title = `${it.label}: ${it.hint}`;
  b.style.background = '#' + it.hex.toString(16).padStart(6, '0');
  b.addEventListener('click', () => applyIntent(it.key));
  insp.swatches.appendChild(b);
  swatchButtons.set(it.key, b);
}
function syncIntentSwatches(recs) {
  const geoms = recs.filter(r => GEOMETRY_TYPES.has(r.type));
  const keys = new Set(geoms.map(r => r.intent || ''));
  const one = keys.size === 1 ? [...keys][0] : null;
  for (const [key, b] of swatchButtons) b.classList.toggle('active', one === key);
  insp.intentName.textContent = geoms.length === 0 ? 'color'
    : keys.size > 1 ? 'mixed'
    : one ? (INTENT_BY_KEY[one]?.label || one) : 'none';
}

for (const k of MARKERS) {
  const o = document.createElement('option');
  o.value = k.key; o.textContent = k.label; o.title = k.hint;
  insp.marker.appendChild(o);
}
insp.marker.addEventListener('change', () => {
  const rec = sel();
  if (rec && rec.type === 'marker') setMarkerKind(rec.id, insp.marker.value);
});
insp.tags.addEventListener('change', () => {
  const rec = sel();
  if (rec) setTags(rec.id, insp.tags.value.split(','));
});
insp.tags.addEventListener('keydown', (e) => { if (e.key === 'Enter') insp.tags.blur(); e.stopPropagation(); });

document.getElementById('insp-duplicate').addEventListener('click', duplicateSelection);
document.getElementById('insp-delete').addEventListener('click', deleteSelection);
insp.group.addEventListener('click', groupSelection);
insp.ungroup.addEventListener('click', ungroupSelection);
document.getElementById('btn-group').addEventListener('click', groupSelection);

// ============================================================================
// 10. Files, views, shortcuts, boot
// ============================================================================

const fmt = (v) => {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
};

function markDirty(dirty = true) {
  state.dirty = dirty;
  platform.setDirty(dirty);
  updateTitle();
  if (dirty && !loading) autosave.schedule();
}

function updateTitle() {
  const file = state.filePath ? state.filePath.split(/[\\/]/).pop() : 'untitled';
  const title = `${state.dirty ? '● ' : ''}${file} — Ptah`;
  document.getElementById('file-label').textContent = file + (state.dirty ? ' •' : '');
  platform.setTitle(title);
}

function serializeRec(r) {
  const n = r.node;
  const col = r.color != null ? new THREE.Color(r.color) : null;
  const out = {
    name: r.name,
    type: r.type,
    position: { x: n.position.x, y: n.position.y, z: n.position.z },
    rotation: {
      x: THREE.MathUtils.radToDeg(n.rotation.x),
      y: THREE.MathUtils.radToDeg(n.rotation.y),
      z: THREE.MathUtils.radToDeg(n.rotation.z)
    },
    scale: { x: n.scale.x, y: n.scale.y, z: n.scale.z },
    color: col && r.type !== 'group' ? [col.r, col.g, col.b] : null,
    visible: r.visible,
    meshData: r.meshData,
    children: childRecs(r).map(serializeRec)
  };
  if (r.params) out.params = { ...r.params };
  if (r.type === 'note') out.text = r.text || '';
  if (r.uid) out.uid = r.uid;
  if (r.intent && GEOMETRY_TYPES.has(r.type)) out.intent = r.intent;
  if (r.type === 'marker') out.marker = r.marker;
  if (r.tags && r.tags.length) out.tags = [...r.tags];
  return out;
}

function serializeObjects() {
  return rootRecs().map(serializeRec);
}

function exportText() {
  return exportUsda(serializeObjects(), { appVersion: APP_VERSION, reference: reference.serialize(), metrics: state.metrics });
}

function unregisterSubtree(rec) {
  const walk = (node) => {
    const r = node.userData.rec;
    if (r) state.objects.delete(r.id);
    for (const c of childNodes(node)) walk(c);
  };
  walk(rec.node);
}

function registerSubtree(rec) {
  const walk = (node) => {
    const r = node.userData.rec;
    if (r) state.objects.set(r.id, r);
    for (const c of childNodes(node)) if (c.userData.rec) walk(c);
  };
  walk(rec.node);
}

function detachCurrentScene() {
  const parked = {
    roots: rootRecs().map((rec, index) => ({ rec, index })),
    selection: [...state.selection],
    counter: { ...state.counter },
    reference: reference.state,
    metrics: state.metrics,
    filePath: state.filePath,
    dirty: state.dirty
  };
  setSelection([]);
  for (const { rec } of parked.roots) {
    rec.node.parent?.remove(rec.node);
    unregisterSubtree(rec);
  }
  state.counter = {};
  clearMeasure();
  refreshHierarchy();
  return parked;
}

function restoreDetachedScene(parked) {
  for (const { rec, index } of parked.roots) {
    world.add(rec.node);
    moveToIndex(world, rec.node, index);
    rec.node.updateMatrixWorld(true);
    registerSubtree(rec);
  }
  state.counter = { ...parked.counter };
  reference.load(parked.reference);
  state.metrics = parked.metrics;
  refreshMetricVisuals();
  syncMetricsPanel();
  refreshHierarchy();
  state.filePath = parked.filePath;
  markDirty(parked.dirty);
  setSelection(parked.selection);
}

function buildImportedObjects(objects, parent = null) {
  let count = 0;
  const build = (list, container) => {
    for (const o of list) {
      const colorHex = o.color ? new THREE.Color(o.color[0], o.color[1], o.color[2]).getHex() : null;
      const rec = createObject({ ...o, color: colorHex }, { parent: container, select: false, record: false });
      count++;
      build(o.children || [], rec);
    }
  };
  build(objects, parent);
  return count;
}

function finalizeImportedScene(parsed) {
  const count = buildImportedObjects(parsed.objects, null);
  syncNameCounters();
  refreshHierarchy();
  reference.load(parsed.reference);
  hideProfilePicker();
  setMetrics(parsed.metrics || METRICS_DEFAULTS, { record: false });   // v0.1/v0.2 files: default profile
  setSelection([]);
  frameSelection();                      // nothing selected: frame the whole level
  return count;
}

let saving = false;                  // a held Ctrl+S repeats; one save at a time
async function saveFile(saveAs = false) {
  if (saving) return;
  saving = true;
  try { await saveFileNow(saveAs); } finally { saving = false; }
}
async function saveFileNow(saveAs) {
  const content = exportText();
  const current = state.filePath ? state.filePath.split(/[\\/]/).pop() : null;
  let res;
  try {
    res = await platform.saveUsd({
      content,
      filePath: saveAs ? null : state.filePath,
      suggestedName: current || 'blockout.usda'
    });
  } catch (err) {
    toast('Save failed: ' + (err && err.message ? err.message : err), true);
    return;
  }
  if (res.canceled) return;
  state.filePath = res.filePath;
  markDirty(false);
  autosave.clear();
  toast('Saved');
}

async function openFile() {
  if (state.dirty) {
    const ok = await platform.confirmDiscard('Open another file? Unsaved changes will be lost.');
    if (!ok) return;
  }
  let res;
  try {
    res = await platform.openUsd();
  } catch (err) {
    toast('Open failed: ' + (err && err.message ? err.message : err), true);
    return;
  }
  if (res.canceled) return;
  if (res.error) { toast(res.error, true); return; }
  // The snapshot belonged to the scene just discarded; left in place it would
  // be offered as "unsaved work" on the next launch.
  if (loadUsdaText(res.content, res.filePath)) autosave.clear();
}

/** Replace the scene with a .usda text. Returns true when the scene was replaced. */
function loadUsdaText(text, filePath) {
  if (text.length > MAX_IMPORT_BYTES) {
    toast(IMPORT_TOO_LARGE, true);
    return false;
  }
  let parsed;
  try {
    parsed = importUsda(text);
  } catch (err) {
    toast('Could not read file: ' + err.message, true);
    return false;
  }
  const parked = detachCurrentScene();
  let count = 0;
  loading = true;
  try {
    count = finalizeImportedScene(parsed);
    state.filePath = filePath || null;
    history.clear();
    markDirty(false);
    for (const { rec } of parked.roots) disposeSubtree(rec.node);
  } catch (err) {
    try {
      clearScene();
      restoreDetachedScene(parked);
    } catch (restoreErr) {
      clearScene();
      toast(`Could not import file: ${err.message} (restore failed: ${restoreErr.message})`, true);
      return false;
    }
    toast('Could not import file: ' + err.message, true);
    return false;
  } finally {
    loading = false;
  }
  if (parsed.warnings.length) toast(parsed.warnings[0], true);
  else toast(`Opened: ${count} object${count === 1 ? '' : 's'}`);
  return true;
}

async function newScene() {
  if (state.dirty) {
    const ok = await platform.confirmDiscard('Start a new blockout? Unsaved changes will be lost.');
    if (!ok) return;
  }
  clearScene();
  reference.clear({ record: false });
  state.filePath = null;
  if (platform._resetHandle) platform._resetHandle();
  history.clear();
  markDirty(false);
  autosave.clear();
  showProfilePicker();
}

function clearScene() {
  setSelection([]);
  for (const n of childNodes(world)) { world.remove(n); disposeSubtree(n); }
  state.objects.clear();
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
  if (walk.active) walk.exit();
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
  if (walk.active) walk.exit();
  const tops = topLevelSelection();
  const box = new THREE.Box3();
  if (tops.length) { for (const r of tops) box.union(boundsOf(r.node)); }
  else if (rootRecs().length) { for (const r of rootRecs()) box.union(boundsOf(r.node)); }
  else return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() || 200;
  orbit.target.copy(center);
  const dir = camera.position.clone().sub(center).normalize();
  camera.position.copy(center).addScaledVector(dir, Math.max(size * 1.6, 150));
}

// ---- walk mode & reference underlay (separate modules) ----
// The mannequin (a Mixamo character embedded as a module) loads in the
// background at boot; third-person walk waits for it only if you get there first.
let mannequin = null;
const mannequinReady = loadMannequin()
  .then((mq) => { mannequin = mq; scene.add(mq.root); return mq; })
  .catch((err) => { console.warn('Mannequin failed to load; third-person view unavailable.', err); return null; });
let walkOrigin = null;               // the PlayerStart marker the walk started from (its rig is hidden meanwhile)
const walk = createWalkMode({
  camera, orbit, viewportEl, canvas: renderer.domElement, metrics: () => state.metrics,
  mannequin: () => mannequin,
  collidables: () => collectPickables().filter(o => o.isMesh && !o.userData.helper),
  onView: (view) => {
    state.walkView = view;           // an explicit choice sticks for the session
    document.getElementById('walk-view').textContent = view === 'third' ? '3rd person' : '1st person';
    document.getElementById('walk-view-key').textContent = view === 'third' ? 'V 1st person' : (mannequin ? 'V 3rd person' : '');
  },
  onChange: (active) => {
    const el = document.getElementById('walk-toggle');
    el.classList.toggle('on', active);
    el.setAttribute('aria-pressed', String(active));
    document.getElementById('walk-hud').classList.toggle('hidden', !active);
    document.getElementById('walk-from').textContent = active
      ? (walk.from ? `from ${walk.from}` : 'from the camera target (place a Player start with K to walk from it)')
      : '';
    transformCtl.enabled = !active;
    transformCtl.visible = !active;
    if (!active) {
      if (walkOrigin) { for (const h of walkOrigin.node.children) if (h.userData.helper) h.visible = true; walkOrigin = null; }
      attachGizmo();
    } else transformCtl.detach();
  }
});

/** The selected PlayerStart, else the first one in the scene, else null. */
function walkStartMarker() {
  const isStart = (r) => r.type === 'marker' && r.marker === 'PlayerStart' && worldVisible(r);
  return selectedRecs().find(isStart) || allRecs().find(isStart) || null;
}
/** Third person for the third-person profiles, first person otherwise, unless V chose. */
function walkViewFor() {
  if (state.walkView) return state.walkView;
  return /third/.test(state.metrics.profile || '') ? 'third' : 'first';
}
function startWalk() {
  if (walk.active) return;
  const view = walkViewFor();
  if (view === 'third' && !mannequin) {          // still loading: wait, then start (rare: it loads at boot)
    toast('Loading the mannequin…');
    mannequinReady.then(() => { if (!walk.active) startWalk(); });
    return;
  }
  const rec = walkStartMarker();
  let start = null;
  if (rec) {
    const p = rec.node.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(rec.node.getWorldQuaternion(new THREE.Quaternion()));
    start = { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(-dir.x, -dir.z), from: rec.name };
    walkOrigin = rec;
    for (const h of rec.node.children) if (h.userData.helper) h.visible = false;   // do not stand inside your own capsule
  }
  walk.enter(start, view);
}
function toggleWalk() { walk.active ? walk.exit() : startWalk(); }

const reference = createReference({
  scene, history, markDirty, toast
});

// ---- autosave & recovery ----
// The current level is snapshotted to IndexedDB a few seconds after every edit
// (and at least once a minute while dirty). On launch, an unsaved snapshot is
// offered back in a bar over the viewport; Save and New discard it.
const autosave = createAutosave({
  getSnapshot: () => ({ text: exportText(), filePath: state.filePath }),
  isDirty: () => state.dirty
});
const recoverBar = document.getElementById('recover-bar');
async function offerRecovery() {
  let snap = null;
  try { snap = await autosave.peek(); } catch { /* storage unavailable */ }
  if (!snap || !snap.text || state.dirty || rootRecs().length) { showProfilePicker(); return; }
  const when = new Date(snap.savedAt);
  document.getElementById('recover-text').textContent =
    `Unsaved work from ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${snap.filePath ? ' (' + snap.filePath.split(/[\\/]/).pop() + ')' : ''} was found.`;
  recoverBar.classList.remove('hidden');
  document.getElementById('recover-restore').onclick = async () => {
    recoverBar.classList.add('hidden');
    // On failure loadUsdaText has already said why. Keep the snapshot: marking
    // the empty scene dirty would overwrite the only copy three seconds later.
    if (!loadUsdaText(snap.text, snap.filePath)) { showProfilePicker(); return; }
    markDirty(true);                        // it is still unsaved work
    await autosave.flush();                 // under this tab's key first, so no moment without a copy
    await autosave.adopt(snap.key);         // then drop the orphan it came from
    toast('Recovered unsaved work');
  };
  document.getElementById('recover-dismiss').onclick = () => { recoverBar.classList.add('hidden'); autosave.discard(snap.key); showProfilePicker(); };
}

// ---- metrics panel ----
const metricsUI = {
  body: document.getElementById('metrics-body'),
  summary: document.getElementById('metrics-summary'),
  toggle: document.getElementById('metrics-toggle'),
  grid: document.getElementById('metrics-grid'),
  fields: {}
};
for (const [key, label, hint] of METRICS_FIELDS) {
  const lab = document.createElement('label');
  lab.className = 'metric';
  lab.title = hint;
  const span = document.createElement('span');
  span.className = 'insp-label';
  span.textContent = label;
  const input = document.createElement('input');
  input.className = 'num';
  input.type = 'number';
  input.min = '1';
  input.step = key.endsWith('Speed') ? '50' : key === 'fov' ? '1' : '5';
  input.id = 'metric-' + key;
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (isNaN(v)) { syncMetricsPanel(); return; }
    setMetrics({ ...state.metrics, [key]: v, profile: 'custom' });
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); });
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = key.endsWith('Speed') ? 'u/s' : key === 'fov' ? '°' : 'u';
  lab.append(span, input, unit);
  metricsUI.grid.appendChild(lab);
  metricsUI.fields[key] = input;
}
function syncMetricsPanel() {
  const m = state.metrics;
  for (const [key, input] of Object.entries(metricsUI.fields)) if (document.activeElement !== input) input.value = fmt(m[key]);
  const p = PROFILE_BY_KEY[m.profile];
  metricsUI.summary.textContent = p ? p.short : 'Custom';
  metricsUI.summary.title = `Player ${fmt(m.playerHeight)} × ${fmt(m.capsuleRadius)}, eye ${fmt(m.eyeHeight)}, step ${fmt(m.stepHeight)}, half/full cover ${fmt(m.halfCover)}/${fmt(m.fullCover)}, door ${fmt(m.doorHeight)}×${fmt(m.doorWidth)}, corridor ${fmt(m.corridorWidth)}`;
  document.getElementById('metrics-profile-name').textContent = p ? `${p.engine} ${p.label}` : 'Custom (edited)';
}
metricsUI.toggle.addEventListener('click', () => {
  const open = metricsUI.body.classList.toggle('hidden');
  metricsUI.toggle.textContent = open ? 'Edit' : 'Done';
});
document.getElementById('metrics-reset').addEventListener('click', () => {
  const p = PROFILE_BY_KEY[state.metrics.profile];
  setMetrics(profileMetrics(p ? p.key : 'ue-third'));
});
document.getElementById('metrics-change').addEventListener('click', () => showProfilePicker({ record: true }));

// ---- profile picker ----
// A level is built to an engine template's numbers; the choice is made before
// the first block is placed, like picking a template when creating a project.
// Shown on launch (unless unsaved work is being offered back), on New, and from
// the Metrics panel. Files carry their profile, so Open never asks.
const profileModal = document.getElementById('profile-modal');
let pickerRecord = false;
for (const p of PROFILES) {
  const m = profileMetrics(p.key);
  const b = document.createElement('button');
  b.className = 'profile-card';
  b.dataset.profile = p.key;
  const addLine = (className, text) => {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    b.appendChild(span);
  };
  addLine('engine', p.engine);
  addLine('tpl', p.label);
  addLine('nums', `capsule ${fmt(m.playerHeight)} × ${fmt(m.capsuleRadius)} · character ${fmt(m.characterHeight)} · eye ${fmt(m.eyeHeight)}`);
  addLine('nums', `walk ${fmt(m.walkSpeed)} · jump ${fmt(m.jumpHeight)} · fov ${fmt(m.fov)}°`);
  addLine('nums dim', `door ${fmt(m.doorHeight)} × ${fmt(m.doorWidth)} · cover ${fmt(m.halfCover)} / ${fmt(m.fullCover)}`);
  b.title = p.hint;
  b.addEventListener('click', () => pickProfile(p.key));
  document.getElementById('profile-cards').appendChild(b);
}
document.getElementById('profile-open').addEventListener('click', () => { hideProfilePicker(); openFile(); });
document.getElementById('profile-version').textContent = 'Ptah v' + APP_VERSION;
function showProfilePicker({ record = false } = {}) {
  pickerRecord = record;
  document.getElementById('profile-cancel').classList.toggle('hidden', !record);   // cancel only when changing mid-session
  for (const b of profileModal.querySelectorAll('.profile-card')) b.classList.toggle('current', b.dataset.profile === state.metrics.profile);
  profileModal.classList.remove('hidden');
  const first = profileModal.querySelector('.profile-card.current') || profileModal.querySelector('.profile-card');
  if (first) first.focus();
}
function hideProfilePicker() {
  // Focus must not stay on a card that is about to be hidden: Tab would then
  // navigate from an invisible control instead of reaching walk mode.
  if (profileModal.contains(document.activeElement)) document.activeElement.blur();
  profileModal.classList.add('hidden');
}
function pickProfile(key) {
  hideProfilePicker();
  setMetrics(profileMetrics(key), { record: pickerRecord });
  if (!pickerRecord) markDirty(false);       // a fresh level with a chosen profile is not "unsaved work" yet
  toast(`${PROFILE_BY_KEY[key].engine} ${PROFILE_BY_KEY[key].label}: player ${fmt(state.metrics.playerHeight)} × ${fmt(state.metrics.capsuleRadius)}`);
}
document.getElementById('profile-cancel').addEventListener('click', hideProfilePicker);
const pickerOpen = () => !profileModal.classList.contains('hidden');

// A dropped file must never navigate the page away from the editor. Panels
// that accept drops (the reference panel) handle their own events first.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  if (/\.usda?$/i.test(f.name)) {
    // dropping a level on the viewport opens it
    (async () => {
      if (f.size > MAX_IMPORT_BYTES) { toast(IMPORT_TOO_LARGE, true); return; }
      if (state.dirty && !(await platform.confirmDiscard('Open the dropped file? Unsaved changes will be lost.'))) return;
      if (loadUsdaText(await f.text(), f.name)) autosave.clear();
    })();
  } else if (f.type.startsWith('image/')) {
    reference.loadFile(f);
  }
});

// ---- keyboard ----
// Shift inverts snapping while held. Tracked on its own so it works mid-drag
// and regardless of which control has focus; released on blur so a Shift+Tab
// away from the window can't leave it stuck.
function setShiftHeld(on) {
  if (state.shiftHeld === on) return;
  state.shiftHeld = on;
  applySnapSettings();
}
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') setShiftHeld(true); }, true);
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') setShiftHeld(false); }, true);
window.addEventListener('blur', () => setShiftHeld(false));

window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const ctrlKey = e.ctrlKey || e.metaKey;
  if (pickerOpen()) {
    if (ctrlKey && e.key.toLowerCase() === 'o') { hideProfilePicker(); openFile(); e.preventDefault(); }
    else if (e.code === 'Escape' && pickerRecord) hideProfilePicker();
    return;
  }
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    // file shortcuts still work while typing (the browser would otherwise show its own Save dialog)
    const k = e.key.toLowerCase();
    if (ctrlKey && k === 's') { document.activeElement.blur(); saveFile(e.shiftKey); e.preventDefault(); }
    else if (ctrlKey && k === 'o') { document.activeElement.blur(); openFile(); e.preventDefault(); }
    else if (MAC_ELECTRON && e.metaKey && (k === 'z' || k === 'a')) {
      // The macOS menu's Undo and Select All are display-only (see main.js), so
      // text fields lose the native Cmd+Z / Cmd+A that the default roles gave.
      e.preventDefault();
      if (k === 'a') document.activeElement.select();
      else document.execCommand(e.shiftKey ? 'redo' : 'undo');
    }
    return;
  }
  if (walk.active) {
    if (e.code === 'Escape' || e.code === 'Tab') { e.preventDefault(); walk.exit(); }
    return;                         // walk mode owns WASD etc.
  }

  if (gestureActive()) {
    // Undo, Delete, Group and friends would interleave with a command that is
    // only recorded on pointerup. Esc cancels; everything else waits.
    if (e.code === 'Escape') cancelGesture();
    if (e.code === 'Escape' || e.code === 'Tab' || e.ctrlKey || e.metaKey) e.preventDefault();
    return;
  }

  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { history.undo(); e.preventDefault(); }
    else if (k === 'z' || k === 'y') { history.redo(); e.preventDefault(); }
    else if (k === 's') { saveFile(e.shiftKey); e.preventDefault(); }
    else if (k === 'o') { openFile(); e.preventDefault(); }
    else if (k === 'n') { newScene(); e.preventDefault(); }
    else if (k === 'd') { duplicateSelection(); e.preventDefault(); }
    else if (k === 'g' && e.shiftKey) { ungroupSelection(); e.preventDefault(); }
    else if (k === 'g') { groupSelection(); e.preventDefault(); }
    else if (k === 'a') { selectAll(); e.preventDefault(); }
    return;
  }

  switch (e.code) {
    case 'KeyQ':
      if (state.tool === 'measure') clearMeasure();
      setTransformMode('none'); break;                 // select, no gizmo
    case 'Escape':
      if (state.tool === 'measure') clearMeasure();
      if (state.tool === 'select') setSelection([]);
      setTool('select'); break;                        // back to select, keeping the current gizmo mode
    case 'KeyC': setTool('place-cube'); break;
    case 'KeyY': setTool('place-cylinder'); break;
    case 'KeyS': setTool('place-sphere'); break;
    case 'KeyP': setTool('place-plane'); break;
    case 'KeyV': setTool('place-wedge'); break;
    case 'KeyT': setTool('place-stairs'); break;
    case 'KeyN': setTool('place-note'); break;
    case 'KeyM': setTool('measure'); break;
    case 'KeyW': setTransformMode('translate'); break;
    case 'KeyE': setTransformMode('rotate'); break;
    case 'KeyR': setTransformMode('scale'); break;
    case 'KeyG': if (e.shiftKey) setFaceSnap(!state.faceSnap); else { state.snap = !state.snap; applySnapSettings(); } break;
    case 'KeyH': setTicks(!state.showTicks); break;
    case 'KeyK': setTool('place-marker-' + state.markerKind); break;
    case 'KeyF': frameSelection(); break;
    case 'Tab':
      // Tab is focus navigation. Claim it for walk mode only when nothing is
      // focused (after a viewport click); a keyboard user tabbing through the
      // toolbar or the hierarchy keeps moving focus. The Walk button is the
      // keyboard path into walk mode.
      if (document.activeElement && document.activeElement !== document.body && document.activeElement !== renderer.domElement) break;
      e.preventDefault(); startWalk(); break;
    case 'KeyX': setTool('extrude'); break;
    case 'F2': {
      const row = hierarchyEl.querySelector('.h-row.active');
      const rec = sel();
      if (row && rec) startRename(row, rec);
      break;
    }
    case 'Delete': case 'Backspace':
      deleteSelection();
      break;
    case 'Numpad1': case 'Digit1': setView('front'); break;
    case 'Numpad3': case 'Digit3': setView('right'); break;
    case 'Numpad7': case 'Digit7': setView('top'); break;
    case 'Numpad0': case 'Digit0': setView('home'); break;
  }
});

// ---- native menu (Electron on macOS) ----
const MAC_ELECTRON = platform.name === 'electron' && /Mac/.test(navigator.platform || navigator.userAgent);
// Menu accelerators are display-only, so the keydown handler above stays the
// single keyboard path; these run only when a menu item is clicked.
platform.onMenu((cmd) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA';
  if (pickerOpen() && cmd !== 'open') return;
  if (gestureActive()) return;
  switch (cmd) {
    case 'new': newScene(); break;
    case 'open': if (pickerOpen()) hideProfilePicker(); openFile(); break;
    case 'save': saveFile(false); break;
    case 'save-as': saveFile(true); break;
    case 'undo': if (typing) document.execCommand('undo'); else history.undo(); break;
    case 'redo': if (typing) document.execCommand('redo'); else history.redo(); break;
    case 'select-all': if (typing) document.activeElement.select(); else selectAll(); break;
  }
});

// ---- topbar & toolbar wiring ----
document.getElementById('btn-new').addEventListener('click', newScene);
document.getElementById('btn-open').addEventListener('click', openFile);
document.getElementById('btn-save').addEventListener('click', () => saveFile(false));
document.getElementById('btn-saveas').addEventListener('click', () => saveFile(true));
document.getElementById('btn-undo').addEventListener('click', () => { if (!gestureActive()) history.undo(); });
document.getElementById('btn-redo').addEventListener('click', () => { if (!gestureActive()) history.redo(); });

// Rail buttons are glyph + key: give them real accessible names and announce the shortcut.
document.querySelectorAll('#toolrail .rail-btn').forEach(b => {
  const key = b.querySelector('.key')?.textContent;
  b.setAttribute('aria-label', (b.title || '').split(/[.:]/)[0].replace(/\s*\([^)]*\)\s*$/, '').trim() || key);
  if (key) b.setAttribute('aria-keyshortcuts', key);
  b.querySelectorAll('.glyph, .key').forEach(el => el.setAttribute('aria-hidden', 'true'));
});
document.getElementById('walk-toggle').setAttribute('aria-keyshortcuts', 'Tab');
hierarchyEl.setAttribute('role', 'tree');
hierarchyEl.setAttribute('aria-label', 'Hierarchy');
hierarchyEl.setAttribute('aria-multiselectable', 'true');

document.querySelectorAll('#toolrail [data-tool]').forEach(b =>
  b.addEventListener('click', () => setTool(b.dataset.tool === 'marker' ? 'place-marker-' + state.markerKind : b.dataset.tool)));
document.querySelectorAll('#toolrail [data-mode]').forEach(b =>
  b.addEventListener('click', () => setTransformMode(b.dataset.mode)));

// Buttons keep keyboard focus after a click, so Space or Enter would re-fire
// them (click Walk, press Space to jump, leave walk mode). Blur every button
// outside the picker once it has been clicked; the viewport keeps the keys.
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && !b.closest('.modal') && !b.closest('#hierarchy-list')) b.blur();
});

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

document.getElementById('ticks-toggle').addEventListener('click', () => setTicks(!state.showTicks));
const gridOpacityInput = document.getElementById('grid-opacity');
gridOpacityInput.addEventListener('input', () => setGridOpacity(parseFloat(gridOpacityInput.value) / 100));
gridOpacityInput.addEventListener('keydown', (e) => e.stopPropagation());
document.getElementById('face-toggle').addEventListener('click', () => setFaceSnap(!state.faceSnap));

// Preset and marker pickers arm a placement tool; the tool stays armed so
// several can be stamped in a row, and Q / Esc returns to Select.
for (const key of PRESET_KEYS) {
  const o = document.createElement('option');
  o.value = key;
  o.textContent = presetSpecs(METRICS_DEFAULTS)[key].label;
  presetSelect.appendChild(o);
}
presetSelect.addEventListener('change', () => { if (presetSelect.value) setTool('place-preset-' + presetSelect.value); presetSelect.blur(); });
for (const k of MARKERS) {
  const o = document.createElement('option');
  o.value = k.key; o.textContent = k.label; o.title = k.hint;
  markerSelect.appendChild(o);
}
markerSelect.addEventListener('change', () => { if (markerSelect.value) setTool('place-marker-' + markerSelect.value); markerSelect.blur(); });
// The pickers keep focus when closed without a change (Escape, click away),
// which used to swallow every letter shortcut until something else was clicked.
// Only the keys a <select> actually uses stay with it; letters fall through to
// the shortcuts after the picker gives up focus.
const SELECT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space', 'Home', 'End', 'PageUp', 'PageDown']);
for (const el of [presetSelect, markerSelect, insp.marker]) {
  el.addEventListener('keydown', (e) => {
    if (SELECT_KEYS.has(e.code)) { e.stopPropagation(); return; }
    if (e.code === 'Escape') { el.blur(); e.stopPropagation(); return; }
    el.blur();                                          // a letter: hand the key to the editor
  });
}

document.getElementById('walk-toggle').addEventListener('click', (e) => { e.currentTarget.blur(); toggleWalk(); });

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
  if (walk.active) walk._applyFov();      // horizontal FOV is fixed by the profile; vertical follows the aspect
}
window.addEventListener('resize', resize);

let lastT = performance.now();
function tick(now = performance.now()) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (walk.active) walk.update(dt);
  else orbit.update();
  world.updateMatrixWorld(true);
  updateHelperMatrices();
  updateVolumeLabels();
  renderer.render(scene, camera);
}

// ---- boot ----
try { const v = parseFloat(localStorage.getItem('ptah.gridOpacity')); if (isFinite(v)) state.gridOpacity = Math.min(1, Math.max(0, v)); } catch { /* storage unavailable */ }
rebuildGrid();
setFaceSnap(false);
setTicks(true, { quiet: true });
try { setPivotBase(localStorage.getItem('ptah.pivotBase') === '1', { remember: false }); } catch { setPivotBase(false, { remember: false }); }
document.getElementById('brand-version').textContent = 'v' + APP_VERSION;
document.getElementById('status-version').textContent = 'v' + APP_VERSION;
syncMetricsPanel();
setTool('select');
setTransformMode('translate');
refreshHierarchy();
syncInspector();
updateTitle();
history.onChange(history);
resize();
tick();
offerRecovery();

// Test hooks (harmless in production; used by test/scenario.mjs).
window.__ptahSerialize = serializeObjects;
window.__ptah = {
  version: APP_VERSION,
  state,
  exportText,
  loadUsdaText,
  select: (ids) => setSelection(ids),
  ids: () => allRecs().map(r => ({ id: r.id, name: r.name, type: r.type, parent: parentRec(r)?.id || null })),
  group: groupSelection,
  ungroup: ungroupSelection,
  move: (ids, parentId, beforeId) => moveRecs(ids.map(id => state.objects.get(id)).filter(Boolean), parentId ? state.objects.get(parentId) : null, beforeId ? state.objects.get(beforeId) : null),
  worldPosition: (id) => { const v = state.objects.get(id).node.getWorldPosition(new THREE.Vector3()); return { x: v.x, y: v.y, z: v.z }; },
  walk, reference, autosave,
  metrics: () => ({ ...state.metrics }),
  setMetrics: (m) => setMetrics(m),
  faceSnap: (on) => setFaceSnap(on),
  createPreset,
  serializeOne: (id) => serializeRec(state.objects.get(id)),
  // canvas-fraction coordinates of a world point, for tests that must click a specific face
  project: (x, y, z) => { camera.updateMatrixWorld(); const p = new THREE.Vector3(x, y, z).project(camera); return { fx: (p.x + 1) / 2, fy: (1 - p.y) / 2, behind: p.z > 1 }; },
  gridOpacity: () => state.gridOpacity,
  effectiveSnap,
  pivotBase: (on) => { if (on !== undefined) setPivotBase(on); return state.pivotBase; },
  mannequin: () => mannequin ? { loaded: true, sourceHeight: mannequin.sourceHeight, visible: mannequin.root.visible, scale: mannequin.root.children[0].scale.x, clips: mannequin.clips.map(c => c.name), position: mannequin.root.position.toArray(), yaw: mannequin.root.rotation.y } : null,
  mannequinReady: () => mannequinReady,
  walkViewFor,
  walkView: (v) => { state.walkView = v; },
  railOrder: () => [...document.querySelectorAll('#toolrail .rail-btn .key')].map(k => k.textContent).join(''),
  railActive: () => [...document.querySelectorAll('#toolrail .rail-btn.active .key')].map(k => k.textContent).join(''),
  bounds: (id) => { const r = state.objects.get(id); if (!r) return null; const b = boundsOf(r.node); return { min: b.min.toArray(), max: b.max.toArray() }; },
  ticks: () => state.showTicks,
  pickerOpen,
  pickProfile: (key) => pickProfile(key),
  failImportedObjectName: (name) => { failImportedObjectName = name || null; },
  profiles: () => PROFILES.map(p => p.key),
  camera: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
  // Drive TransformControls through its public pointer API (normalized device
  // coords) so the drag/undo path is testable without pixel-hunting handles.
  // `during` runs between the move and the release (keys pressed mid-drag).
  gizmoDrag: (axis, from, to, during = null) => {
    if (!transformCtl.object) return false;
    camera.updateMatrixWorld();
    transformCtl.updateMatrixWorld(true);       // refresh gizmo + drag plane (normally done by the render loop)
    transformCtl.axis = axis;
    transformCtl.pointerDown({ x: from.x, y: from.y, button: 0 });
    transformCtl.pointerMove({ x: to.x, y: to.y, button: -1 });   // TransformControls expects button -1 on move
    if (during) during();
    transformCtl.pointerUp({ x: to.x, y: to.y, button: 0 });
    return true;
  },
  lookAt: (x, y, z) => { const d = camera.position.clone().sub(orbit.target); orbit.target.set(x, y, z); camera.position.copy(orbit.target).add(d); camera.lookAt(orbit.target); },
  undoDepth: () => history.undoStack.length,
  // scene nodes that carry a record, registered or not: a mismatch with ids() is a ghost
  nodeCount: () => { let c = 0; world.traverse(o => { if (o.userData.rec) c++; }); return c; },
  helperUuids: (id) => state.objects.get(id).node.children.filter(c => c.userData.helper).map(c => c.uuid).join(),
  gizmo: () => ({ dragging: transformCtl.dragging, axis: transformCtl.axis, attached: !!transformCtl.object, focus: document.activeElement?.tagName })
};
