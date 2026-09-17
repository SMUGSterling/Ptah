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
import { exportUsda, importUsda, PRIMITIVE_GEOMETRY, STAIRS_DEFAULT_STEPS } from './usd.js';
import { platform } from './platform.js';
import { createWalkMode } from './walk.js';
import { createReference } from './reference.js';

// ============================================================================
// 1. Constants & state
// ============================================================================

const APP_VERSION = '0.2.0';
const GRID_EXTENT = 2048;            // half-width of the grid in units
const ROTATION_SNAP_DEG = 15;
const MIN_SIZE = 1;                  // smallest dimension the gizmo may snap to

const PALETTE = [
  { name: 'Slate', hex: 0x8d93a1 },
  { name: 'Clay', hex: 0xc48a5a },
  { name: 'Sage', hex: 0x7ba37e },
  { name: 'Lapis', hex: 0x5b7fe8 },
  { name: 'Gold', hex: 0xd9a441 },
  { name: 'Plum', hex: 0x9a6fb0 }
];

// Default dimensions (units) and colors per type. Wedge and stairs default to
// a walkable size for a 180u player: 16u risers, 32u treads.
const DEFAULTS = {
  cube:     { color: 0x8d93a1, scale: [64, 64, 64] },
  cylinder: { color: 0xc48a5a, scale: [64, 64, 64] },
  sphere:   { color: 0x7ba37e, scale: [64, 64, 64] },
  plane:    { color: 0x565e6c, scale: [256, 1, 256] },
  wedge:    { color: 0x8d93a1, scale: [128, 64, 256] },
  stairs:   { color: 0x8d93a1, scale: [128, 128, 256] },
  mesh:     { color: 0x8d93a1, scale: [1, 1, 1] },
  group:    { color: null,     scale: [1, 1, 1] },
  note:     { color: 0xd9a441, scale: [1, 1, 1] }
};
const GEOMETRY_TYPES = new Set(['cube', 'cylinder', 'sphere', 'plane', 'wedge', 'stairs', 'mesh']);
const TYPE_ICON = { cube: '▧', cylinder: '◍', sphere: '●', plane: '▭', wedge: '◢', stairs: '▙', mesh: '△', group: '▾', note: '⚑' };

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
  gridSize: 64,
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

// All user objects live under `world`; its direct object children are roots.
const world = new THREE.Group();
world.name = 'World';
scene.add(world);

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

const compound = (label, cmds) => ({
  label,
  undo: () => { for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo(); },
  redo: () => { for (const c of cmds) c.redo(); }
});

// ============================================================================
// 4. Object lifecycle
// ============================================================================

function nextName(type) {
  state.counter[type] = (state.counter[type] || 0) + 1;
  const n = String(state.counter[type]).padStart(2, '0');
  return type.charAt(0).toUpperCase() + type.slice(1) + '_' + n;
}

let idCounter = 0;
const newId = () => 'obj_' + (++idCounter);

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

// Visual for empty Xforms: a small three-axis cross. Not pickable, not saved.
function makeGroupMarker() {
  const s = 12;
  const m = makeLines([-s, 0, 0, s, 0, 0, 0, -s, 0, 0, s, 0, 0, 0, -s, 0, 0, s], GOLD_DIM);
  m.material.opacity = 0.7;
  m.userData.helper = true;
  return m;
}

const NOTE_PIN_H = 40, NOTE_PIN_R = 7;
function buildNoteVisual(rec) {
  const node = rec.node;
  for (const c of [...node.children]) if (c.userData.helper) node.remove(c);
  const col = rec.color ?? DEFAULTS.note.color;
  const mat = new THREE.MeshBasicMaterial({ color: col });
  const pin = new THREE.Mesh(new THREE.SphereGeometry(NOTE_PIN_R, 14, 10), mat);
  pin.position.y = NOTE_PIN_H;
  pin.userData.helper = true;
  pin.userData.pick = true;                 // clicking the pin selects the note
  const stem = makeLines([0, 0, 0, 0, NOTE_PIN_H - NOTE_PIN_R, 0], col);
  stem.userData.helper = true;
  const css = '#' + col.toString(16).padStart(6, '0');
  const label = makeTextSprite(rec.name, css, 22, { background: 'rgba(20,22,27,0.82)' });
  label.position.y = NOTE_PIN_H + NOTE_PIN_R + 16;
  label.center.set(0.5, 0);
  label.material.depthTest = false;
  label.renderOrder = 9;
  label.userData.helper = true;
  label.userData.pick = true;
  node.add(pin, stem, label);
  rec.mesh = null;                          // notes have no geometry mesh
  rec.pin = pin;
}

/**
 * Create an object. spec: { type, name, position, rotation (deg), scale,
 * color (hex), visible, meshData, params, text }.
 * opts: { parent: rec|null, index, select, record }
 * Returns the record; when record is true the add is pushed to history.
 */
function createObject(spec, { parent = null, index, select = true, record = true } = {}) {
  const { type } = spec;
  const id = newId();
  const def = DEFAULTS[type] || DEFAULTS.mesh;
  const colorHex = spec.color != null ? spec.color : def.color;

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
  node.rotation.set(
    THREE.MathUtils.degToRad(spec.rotation?.x ?? 0),
    THREE.MathUtils.degToRad(spec.rotation?.y ?? 0),
    THREE.MathUtils.degToRad(spec.rotation?.z ?? 0)
  );
  const s = spec.scale ? [spec.scale.x, spec.scale.y, spec.scale.z] : def.scale;
  node.scale.set(s[0], s[1], s[2]);
  node.visible = spec.visible !== false;
  node.userData.id = id;

  const rec = {
    id, type, node, mesh,
    name: spec.name || nextName(type),
    color: colorHex,
    visible: spec.visible !== false,
    meshData: spec.meshData || null,
    params: spec.params ? { ...spec.params } : (type === 'stairs' ? { steps: STAIRS_DEFAULT_STEPS } : null),
    text: type === 'note' ? (spec.text || '') : undefined,
    collapsed: false
  };
  node.userData.rec = rec;                 // lets a detached subtree be re-registered on undo
  if (type === 'note') buildNoteVisual(rec);

  state.objects.set(id, rec);
  const container = containerOf(parent);
  container.add(node);
  if (index != null) moveToIndex(container, node, index);
  node.updateMatrixWorld(true);

  if (record) history.push(addCommand(rec));
  markDirty();
  refreshHierarchy();
  if (select) setSelection([id]);
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
  const cmds = tops.map(removeCommand);
  for (const c of cmds) c.redo();
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
    text: rec.text
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
  const movable = recs.filter(r => r !== beforeRec && !(parent && (r === parent || isAncestor(r, parent))));
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
  const tops = topLevelSelection();
  if (!tops.length) return;
  const parents = tops.map(parentRec);
  const common = parents.every(p => p === parents[0]) ? parents[0] : null;
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

function setColor(id, hex) {
  const rec = state.objects.get(id);
  if (!rec) return;
  rec.color = hex;
  if (rec.type === 'note') buildNoteVisual(rec);
  else if (rec.mesh) rec.mesh.material.color.setHex(hex);
  markDirty();
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

function snapVal(v) {
  return state.snap ? Math.round(v / state.gridSize) * state.gridSize : v;
}

/** Visible pickable meshes/sprites (owned by records). */
function collectPickables() {
  const out = [];
  const walk = (container) => {
    for (const c of container.children) {
      if (!c.visible || !isNode(c)) continue;
      if (c.isMesh) out.push(c);
      for (const h of c.children) if (h.userData.helper && h.userData.pick && h.visible) out.push(h);
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
    if (rec) return { rec, point: h.point.clone() };
  }
  return null;
}

function setTool(tool) {
  if (walk.active) walk.exit();
  state.tool = tool;
  clearMeasureIfLeaving(tool);
  document.querySelectorAll('[data-tool]').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === tool));
  const label = tool === 'select' ? 'Select'
    : tool === 'measure' ? 'Measure: click two points'
    : tool === 'place-note' ? 'Note: click a surface or the grid to pin a note'
    : 'Place ' + tool.replace('place-', '') + ': click or drag in the viewport';
  document.getElementById('status-tool').textContent = label;
  renderer.domElement.style.cursor = tool === 'select' ? 'default' : 'crosshair';
}

const marqueeEl = document.getElementById('marquee');

renderer.domElement.addEventListener('pointerdown', (evt) => {
  if (evt.button !== 0 || walk.active) return;
  if (transformCtl.dragging) return;

  if (state.tool.startsWith('place-')) {
    const type = state.tool.slice(6);
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

  // select tool: not when the pointer is over the transform gizmo
  if (transformCtl.axis) return;
  const additive = evt.shiftKey || evt.ctrlKey || evt.metaKey;
  const hit = pick(evt);
  if (hit) {
    if (additive) toggleSelect(hit.rec.id);
    else if (!(state.selection.length === 1 && state.selection[0] === hit.rec.id)) setSelection([hit.rec.id]);
    return;
  }
  // empty space: start a marquee; a plain click (no drag) clears on pointerup
  state.marquee = { x0: evt.clientX, y0: evt.clientY, x1: evt.clientX, y1: evt.clientY, additive, active: false };
  renderer.domElement.setPointerCapture(evt.pointerId);
});

renderer.domElement.addEventListener('pointermove', (evt) => {
  if (state.placing) {
    const p = groundPoint(evt);
    if (p) {
      state.placing.node.position.x = snapVal(p.x);
      state.placing.node.position.z = snapVal(p.z);
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
    p ? `x ${fmt(snapVal(p.x))}  z ${fmt(snapVal(p.z))}` : '';
});

renderer.domElement.addEventListener('pointerup', () => {
  if (state.placing) {
    const rec = state.placing;
    state.placing = null;
    history.push(addCommand(rec));
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
      if (rec.type === 'group' || rec.type === 'note') rec.node.getWorldPosition(v);
      else new THREE.Box3().setFromObject(rec.node).getCenter(v);
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
  if (rec.pin) rec.pin.material.color.setHex(on ? 0xffffff : (rec.color ?? DEFAULTS.note.color));
}

function attachGizmo() {
  transformCtl.detach();
  if (walk.active) return;
  const tops = topLevelSelection();
  if (tops.length === 0) return;
  if (tops.length === 1) {
    transformCtl.attach(tops[0].node);
  } else {
    const c = new THREE.Vector3();
    for (const t of tops) c.add(t.node.getWorldPosition(new THREE.Vector3()));
    c.multiplyScalar(1 / tops.length);
    if (state.snap) { c.x = snapVal(c.x); c.y = snapVal(c.y); c.z = snapVal(c.z); }
    pivot.position.copy(c);
    pivot.rotation.set(0, 0, 0);
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrixWorld(true);
    transformCtl.attach(pivot);
  }
  transformCtl.setMode(state.transformMode);
  applySnapSettings();
}

function refreshSelectionVisuals() {
  const want = new Set(state.selection);
  for (const [id, h] of selectionHelpers) {
    if (!want.has(id) || !state.objects.has(id)) { scene.remove(h); selectionHelpers.delete(id); }
  }
  const active = sel();
  for (const rec of selectedRecs()) {
    let h = selectionHelpers.get(rec.id);
    if (!h) {
      h = new THREE.BoxHelper(rec.node, GOLD);
      h.material.depthTest = false;
      h.material.transparent = true;
      h.raycast = () => {};
      scene.add(h);
      selectionHelpers.set(rec.id, h);
    }
    h.material.color.setHex(rec === active ? GOLD : GOLD_DIM);
    h.visible = worldVisible(rec) && rec.type !== 'note';
    if (h.visible) h.update();
  }
}

transformCtl.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  const tops = topLevelSelection();
  if (!tops.length) return;
  if (e.value) {
    world.updateMatrixWorld(true);
    pivot.updateMatrixWorld(true);
    dragStart = {
      pivotWorld: pivot.matrixWorld.clone(),
      targets: tops.map(rec => ({ rec, trs: captureTRS(rec.node), world: rec.node.matrixWorld.clone() }))
    };
  } else if (dragStart) {
    const cmds = [];
    for (const t of dragStart.targets) {
      if (!state.objects.has(t.rec.id)) continue;
      const after = captureTRS(t.rec.node);
      if (!sameTRS(t.trs, after)) cmds.push(transformCommand(t.rec.id, t.trs, after));
    }
    dragStart = null;
    if (cmds.length) { history.push(compound('Transform', cmds)); markDirty(); }
    if (tops.length > 1) attachGizmo();   // re-center the pivot
  }
});

transformCtl.addEventListener('objectChange', () => {
  if (transformCtl.object === pivot && dragStart) {
    // apply the pivot's delta to every top-level selected node
    pivot.updateMatrixWorld(true);
    const delta = pivot.matrixWorld.clone().multiply(dragStart.pivotWorld.clone().invert());
    for (const t of dragStart.targets) {
      if (!state.objects.has(t.rec.id)) continue;
      setWorldMatrix(t.rec.node, delta.clone().multiply(t.world));
    }
  } else if (transformCtl.object) {
    const n = transformCtl.object;
    if (state.snap) {       // scale snap may round a thin dimension to zero
      n.scale.x = Math.max(MIN_SIZE, n.scale.x);
      n.scale.y = Math.max(MIN_SIZE, n.scale.y);
      n.scale.z = Math.max(MIN_SIZE, n.scale.z);
    }
    n.updateMatrixWorld(true);
  }
  refreshSelectionVisuals();
  syncInspector();
});

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

function setTransformMode(mode) {
  state.transformMode = mode;
  transformCtl.setMode(mode);
  document.querySelectorAll('[data-mode]').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
}

function applySnapSettings() {
  const on = state.snap;
  transformCtl.setTranslationSnap(on ? state.gridSize : null);
  transformCtl.setRotationSnap(on ? THREE.MathUtils.degToRad(ROTATION_SNAP_DEG) : null);
  // Dimensions live in scale, so snapping scale to the grid snaps sizes to
  // whole cells. The pivot (multi-select) must never scale-snap: its scale is
  // a factor, not a size.
  const single = transformCtl.object && transformCtl.object !== pivot && GEOMETRY_TYPES.has(recOf(transformCtl.object)?.type);
  transformCtl.setScaleSnap(on && single ? state.gridSize : null);
  const el = document.getElementById('snap-toggle');
  el.classList.toggle('on', on);
  el.setAttribute('aria-pressed', String(on));
  document.getElementById('status-snap').textContent =
    on ? `snap ${state.gridSize}u / ${ROTATION_SNAP_DEG}°` : 'snap off';
}

// ============================================================================
// 7. Measurement & player marker
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
// 8. Hierarchy panel: tree with drag/drop
// ============================================================================

const hierarchyEl = document.getElementById('hierarchy-list');
let dragIds = null;                  // ids being dragged from the hierarchy

function refreshHierarchy() {
  hierarchyEl.innerHTML = '';
  const selected = new Set(state.selection);
  const active = state.selection[state.selection.length - 1];
  let total = 0;

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

      const caret = document.createElement('button');
      caret.className = 'h-caret' + (kids.length ? '' : ' empty');
      caret.textContent = kids.length ? (rec.collapsed ? '▸' : '▾') : '';
      caret.title = rec.collapsed ? 'Expand' : 'Collapse';
      caret.addEventListener('click', (e) => { e.stopPropagation(); rec.collapsed = !rec.collapsed; refreshHierarchy(); });

      const eye = document.createElement('button');
      eye.className = 'h-eye';
      eye.title = rec.visible ? 'Hide' : 'Show';
      eye.textContent = rec.visible ? '◉' : '○';
      eye.addEventListener('click', (e) => { e.stopPropagation(); setVisibility(rec.id, !rec.visible); });

      const icon = document.createElement('span');
      icon.className = 'h-icon';
      icon.textContent = TYPE_ICON[rec.type] || '△';

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
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const cmd = removeCommand(rec); cmd.redo(); history.push(cmd);
      });

      row.append(caret, eye, icon, name, count, del);
      row.addEventListener('click', (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelect(rec.id);
        else setSelection([rec.id]);
      });
      row.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(row, rec); });
      wireDragRow(row, rec);
      hierarchyEl.appendChild(row);
      if (kids.length && !rec.collapsed) addRows(kids, depth + 1);
    }
  };
  addRows(rootRecs(), 0);

  document.getElementById('hierarchy-count').textContent =
    total ? `${total} object${total === 1 ? '' : 's'}` : 'empty: press C to add a cube';
  document.getElementById('btn-group').disabled = state.selection.length === 0;
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
  insp.grid.classList.toggle('hidden', multi);
  insp.ungroup.classList.toggle('hidden', !recs.some(r => r.type === 'group'));

  if (multi) {
    const tops = topLevelSelection();
    insp.multi.textContent = `${recs.length} objects selected` + (tops.length !== recs.length ? ` (${tops.length} top-level)` : '');
    insp.rowSteps.classList.add('hidden');
    insp.rowText.classList.add('hidden');
    insp.rowBounds.classList.remove('hidden');
    const box = new THREE.Box3();
    for (const r of tops) box.expandByObject(r.node);
    const size = box.getSize(new THREE.Vector3());
    insp.bbox.textContent = `${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)} u`;
    insp.rowColor.classList.toggle('hidden', !recs.some(r => r.type !== 'group'));
    status.textContent = `${recs.length} selected`;
    syncing = false;
    return;
  }

  insp.name.value = rec.name;
  insp.type.textContent = rec.type;
  const n = rec.node;
  const isGeom = GEOMETRY_TYPES.has(rec.type);
  insp.sizeLabel.textContent = isGeom ? 'Size u' : 'Scale';
  const vals = {
    pos: [n.position.x, n.position.y, n.position.z],
    rot: [n.rotation.x, n.rotation.y, n.rotation.z].map(THREE.MathUtils.radToDeg),
    size: [n.scale.x, n.scale.y, n.scale.z]
  };
  for (const group of Object.keys(vals)) {
    ['x', 'y', 'z'].forEach((axis, i) => {
      const el = insp.fields[group + axis];
      if (document.activeElement !== el) el.value = fmt(vals[group][i]);
      el.disabled = rec.type === 'note' && group !== 'pos';
    });
  }
  insp.rowSteps.classList.toggle('hidden', rec.type !== 'stairs');
  if (rec.type === 'stairs' && document.activeElement !== insp.steps) insp.steps.value = rec.params.steps;
  insp.rowText.classList.toggle('hidden', rec.type !== 'note');
  if (rec.type === 'note' && document.activeElement !== insp.text) insp.text.value = rec.text || '';
  insp.rowColor.classList.toggle('hidden', rec.type === 'group');

  if (rec.type === 'note') {
    insp.rowBounds.classList.add('hidden');
    status.textContent = `${rec.name} (note)`;
  } else {
    insp.rowBounds.classList.remove('hidden');
    const box = new THREE.Box3().setFromObject(n);
    const size = box.getSize(new THREE.Vector3());
    const kids = childRecs(rec).length;
    insp.bbox.textContent = `${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)} u` + (kids ? `  ·  ${kids} child${kids === 1 ? '' : 'ren'}` : '');
    status.textContent = `${rec.name}: ${fmt(size.x)}×${fmt(size.y)}×${fmt(size.z)}u`;
  }
  syncing = false;
}

function commitInspectorField(group, axis) {
  if (syncing) return;
  const rec = sel();
  if (!rec || state.selection.length !== 1) return;
  const el = insp.fields[group + axis];
  const v = parseFloat(el.value);
  if (isNaN(v)) { syncInspector(); return; }
  const before = captureTRS(rec.node);
  if (group === 'pos') rec.node.position[axis] = v;
  if (group === 'rot') rec.node.rotation[axis] = THREE.MathUtils.degToRad(v);
  if (group === 'size') rec.node.scale[axis] = Math.max(0.01, v);
  rec.node.updateMatrixWorld(true);
  const after = captureTRS(rec.node);
  if (!sameTRS(before, after)) {
    history.push(transformCommand(rec.id, before, after));
    markDirty();
  }
  refreshSelectionVisuals();
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

// color swatches apply to every selected object that has a color
for (const c of PALETTE) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.title = c.name;
  b.style.background = '#' + c.hex.toString(16).padStart(6, '0');
  b.addEventListener('click', () => {
    const targets = selectedRecs().filter(r => r.type !== 'group');
    if (!targets.length) return;
    const prev = targets.map(r => [r.id, r.color]);
    for (const r of targets) setColor(r.id, c.hex);
    history.push({
      label: 'Color',
      undo: () => { for (const [id, hex] of prev) setColor(id, hex); },
      redo: () => { for (const [id] of prev) setColor(id, c.hex); }
    });
  });
  insp.swatches.appendChild(b);
}

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
  return out;
}

function serializeObjects() {
  return rootRecs().map(serializeRec);
}

function exportText() {
  return exportUsda(serializeObjects(), { appVersion: APP_VERSION, reference: reference.serialize() });
}

async function saveFile(saveAs = false) {
  const content = exportText();
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
  let count = 0;
  const build = (objs, parent) => {
    for (const o of objs) {
      const colorHex = o.color ? new THREE.Color(o.color[0], o.color[1], o.color[2]).getHex() : null;
      const rec = createObject({ ...o, color: colorHex }, { parent, select: false, record: false });
      count++;
      build(o.children || [], rec);
    }
  };
  build(parsed.objects, null);
  reference.load(parsed.reference);
  state.filePath = filePath || null;
  history.clear();
  markDirty(false);
  setSelection([]);
  if (parsed.warnings.length) toast(parsed.warnings[0], true);
  else toast(`Opened: ${count} object${count === 1 ? '' : 's'}`);
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
}

function clearScene() {
  setSelection([]);
  for (const n of childNodes(world)) world.remove(n);
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
  if (tops.length) { for (const r of tops) box.expandByObject(r.node); }
  else if (rootRecs().length) { for (const r of rootRecs()) box.expandByObject(r.node); }
  else return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() || 200;
  orbit.target.copy(center);
  const dir = camera.position.clone().sub(center).normalize();
  camera.position.copy(center).addScaledVector(dir, Math.max(size * 1.6, 150));
}

// ---- walk mode & reference underlay (separate modules) ----
const walk = createWalkMode({
  camera, orbit, viewportEl, canvas: renderer.domElement, player,
  collidables: () => collectPickables().filter(o => o.isMesh && !o.userData.helper),
  onChange: (active) => {
    const el = document.getElementById('walk-toggle');
    el.classList.toggle('on', active);
    el.setAttribute('aria-pressed', String(active));
    document.getElementById('walk-hud').classList.toggle('hidden', !active);
    transformCtl.enabled = !active;
    transformCtl.visible = !active;
    if (!active) attachGizmo();
    else transformCtl.detach();
  }
});

const reference = createReference({
  scene, history, markDirty, toast
});

// ---- keyboard ----
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (walk.active) {
    if (e.code === 'Escape' || e.code === 'Tab') { e.preventDefault(); walk.exit(); }
    return;                         // walk mode owns WASD etc.
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
    case 'KeyQ': case 'Escape':
      if (state.tool === 'measure') clearMeasure();
      if (e.code === 'Escape' && state.tool === 'select') setSelection([]);
      setTool('select'); break;
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
    case 'KeyG': state.snap = !state.snap; applySnapSettings(); break;
    case 'KeyH': togglePlayer(); break;
    case 'KeyF': frameSelection(); break;
    case 'Tab': e.preventDefault(); walk.enter(); break;
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

document.getElementById('walk-toggle').addEventListener('click', () => walk.toggle());

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

let lastT = performance.now();
function tick(now = performance.now()) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (walk.active) walk.update(dt);
  else orbit.update();
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
  walk, reference,
  camera: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
  gizmo: () => ({ dragging: transformCtl.dragging, axis: transformCtl.axis, attached: !!transformCtl.object, focus: document.activeElement?.tagName })
};
