// usd.js — .usda text export/import for Ptah.
// Pure functions, no DOM or Three.js dependency, so it runs under Node for tests.
//
// Conventions:
//   * 1 scene unit = 1 cm (metersPerUnit 0.01), Y up. Unreal and Unity both
//     convert on import.
//   * Every object is an Xform carrying translate / rotateXYZ / scale, with a
//     child Mesh "Geom" holding baked unit-size primitive geometry. Rotation
//     angles follow USD/Maya rotateXYZ semantics: X applied first, then Y,
//     then Z, about the parent's axes (matrix Rz*Ry*Rx on column vectors).
//     In three.js terms that is Euler order 'ZYX'; app.js sets every node's
//     rotation.order accordingly so the inspector, the file and the engines
//     all agree. Object
//     dimensions live entirely in the scale op, so bounding box == scale for
//     primitives. Child objects are nested Xforms inside their parent's Xform,
//     so hierarchy round-trips and engines compose transforms exactly as we do.
//   * Groups are empty Xforms (ptah:type = "group"); notes are empty Xforms
//     carrying ptah:text. Both import into Unreal/Unity as named empties.
//   * Gameplay markers (ptah:type = "marker") are empty Xforms with a
//     `custom string ptah:marker` attribute (PlayerStart, Spawn, Cover,
//     Objective, Trigger) and optional `custom string[] ptah:tags`. Trigger
//     volumes carry their box size in the scale op. tools/ has engine scripts
//     that replace them with real actors.
//   * Intent (floor / wall / cover / ...) is a `custom string ptah:intent`
//     attribute on the object's Xform; the same color goes out as displayColor.
//     Attributes (not customData) are used for marker/intent/tags because they
//     are gameplay data for engines to read; customData stays Ptah-internal.
//   * customData "ptah:type" tags the primitive so re-import is lossless.
//     "ptah:id" is a persistent per-object id so identity survives round trips.
//   * The stage's customLayerData carries "ptah:metrics" (the design metrics
//     profile the level was built to) and "ptah:reference" (embedded underlay).
//     Files without the tag still import: gprims (Cube/Sphere/Cylinder) map to
//     primitives, unknown Meshes import as generic meshes, plain Xforms with
//     children import as groups.

import { INTENT_BY_KEY, MARKER_BY_KEY } from './metrics.js';

// ---------------------------------------------------------------------------
// Unit-size primitive geometry (shared with the viewport builders)
// ---------------------------------------------------------------------------

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const IMPORT_TOO_LARGE = `File is too large to import (limit ${MAX_IMPORT_BYTES / 1024 / 1024} MB).`;
export const MAX_DEPTH = 64;
// Deepest editor hierarchy that still reopens: the export adds the Root Xform
// above and a Geom Mesh below every object.
export const MAX_NESTING = MAX_DEPTH - 2;
export const MAX_PRIMS = 20000;
export const MAX_POINTS = 2000000;
export const MAX_INDICES = 6000000;

export function cubeGeometry() {
  const h = 0.5;
  const points = [
    [-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h],
    [-h, h, -h], [h, h, -h], [h, h, h], [-h, h, h]
  ];
  const faces = [
    [0, 1, 2, 3],      // bottom (facing -Y)
    [7, 6, 5, 4],      // top
    [4, 5, 1, 0],      // -Z
    [6, 7, 3, 2],      // +Z
    [5, 6, 2, 1],      // +X
    [7, 4, 0, 3]       // -X
  ];
  return facesToMesh(points, faces);
}

export function cylinderGeometry(segments = 24) {
  const r = 0.5, h = 0.5;
  const points = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push([Math.cos(a) * r, -h, Math.sin(a) * r]);
  }
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push([Math.cos(a) * r, h, Math.sin(a) * r]);
  }
  const faces = [];
  // sides — wound so normals face outward given CCW = front
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    faces.push([i, i + segments, j + segments, j]);
  }
  // caps
  faces.push([...Array(segments).keys()]);                       // bottom, CW from below = CCW
  faces.push([...Array(segments).keys()].map(i => 2 * segments - 1 - i)); // top
  return facesToMesh(points, faces);
}

export function sphereGeometry(widthSegments = 20, heightSegments = 14) {
  const r = 0.5;
  const points = [];
  const rows = [];
  points.push([0, -r, 0]);           // south pole (index 0)
  for (let y = 1; y < heightSegments; y++) {
    const phi = -Math.PI / 2 + (y / heightSegments) * Math.PI;
    const row = [];
    for (let x = 0; x < widthSegments; x++) {
      const theta = (x / widthSegments) * Math.PI * 2;
      row.push(points.length);
      points.push([
        Math.cos(phi) * Math.cos(theta) * r,
        Math.sin(phi) * r,
        Math.cos(phi) * Math.sin(theta) * r
      ]);
    }
    rows.push(row);
  }
  points.push([0, r, 0]);            // north pole
  const north = points.length - 1;
  const faces = [];
  const first = rows[0];
  for (let x = 0; x < widthSegments; x++) {
    const x2 = (x + 1) % widthSegments;
    faces.push([0, first[x], first[x2]]);
  }
  for (let y = 0; y < rows.length - 1; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const x2 = (x + 1) % widthSegments;
      faces.push([rows[y][x], rows[y + 1][x], rows[y + 1][x2], rows[y][x2]]);
    }
  }
  const last = rows[rows.length - 1];
  for (let x = 0; x < widthSegments; x++) {
    const x2 = (x + 1) % widthSegments;
    faces.push([last[x], north, last[x2]]);
  }
  return facesToMesh(points, faces);
}

export function planeGeometry() {
  const h = 0.5;
  const points = [[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]];
  const faces = [[0, 2, 1], [0, 3, 2]]; // up-facing
  return { ...facesToMesh(points, faces), doubleSided: true };
}

// Ramp: unit footprint, low edge at the front (+Z), rising to full height at
// the back (-Z). Rotate about Y to point it where you need it.
export function wedgeGeometry() {
  const h = 0.5;
  const points = [
    [-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h],   // bottom 0..3
    [-h, h, -h], [h, h, -h]                              // top back edge 4, 5
  ];
  const faces = [
    [0, 1, 2, 3],   // bottom (-Y)
    [4, 5, 1, 0],   // back (-Z)
    [3, 2, 5, 4],   // slope (+Y +Z)
    [1, 5, 2],      // +X side
    [0, 3, 4]       // -X side
  ];
  return facesToMesh(points, faces);
}

// Stairs: unit footprint like the wedge (rising toward -Z), `steps` equal
// steps. Built as a watertight mesh with no T-junctions: side walls are a
// grid of cells, bottom and back are split to match, so every edge is shared
// by exactly two faces. Engines generating collision from this stay happy.
export const STAIRS_DEFAULT_STEPS = 8;
export function stairsGeometry(params) {
  const n = Math.max(1, Math.min(64, Math.round((params && params.steps) || STAIRS_DEFAULT_STEPS)));
  const d = 1 / n, hh = 1 / n;
  const y = (j) => -0.5 + j * hh;          // level j = 0..n
  const z = (k) => 0.5 - k * d;            // station k = 0..n (front to back)
  const points = [];
  const index = new Map();
  const P = (x, yy, zz) => {
    const key = `${x}|${yy}|${zz}`;
    let i = index.get(key);
    if (i == null) { i = points.length; points.push([x, yy, zz]); index.set(key, i); }
    return i;
  };
  const faces = [];
  for (let k = 0; k < n; k++) {
    // side cells for this step column, one per level up to the step's height
    for (let j = 0; j <= k; j++) {
      const A = [0.5, y(j), z(k)], B = [0.5, y(j), z(k + 1)], C = [0.5, y(j + 1), z(k + 1)], D = [0.5, y(j + 1), z(k)];
      faces.push([P(...A), P(...B), P(...C), P(...D)]);                           // +X
      const a = [-0.5, y(j), z(k)], b = [-0.5, y(j), z(k + 1)], c = [-0.5, y(j + 1), z(k + 1)], dd = [-0.5, y(j + 1), z(k)];
      faces.push([P(...dd), P(...c), P(...b), P(...a)]);                          // -X
    }
    // tread (top of step k)
    faces.push([P(-0.5, y(k + 1), z(k)), P(0.5, y(k + 1), z(k)), P(0.5, y(k + 1), z(k + 1)), P(-0.5, y(k + 1), z(k + 1))]);
    // riser (front of step k)
    faces.push([P(-0.5, y(k), z(k)), P(0.5, y(k), z(k)), P(0.5, y(k + 1), z(k)), P(-0.5, y(k + 1), z(k))]);
    // bottom slab under step k (-Y)
    faces.push([P(-0.5, y(0), z(k + 1)), P(0.5, y(0), z(k + 1)), P(0.5, y(0), z(k)), P(-0.5, y(0), z(k))]);
    // back wall slice at level k (-Z)
    faces.push([P(-0.5, y(k + 1), z(n)), P(0.5, y(k + 1), z(n)), P(0.5, y(k), z(n)), P(-0.5, y(k), z(n))]);
  }
  return facesToMesh(points, faces);
}

function facesToMesh(points, faces) {
  const faceVertexCounts = faces.map(f => f.length);
  const faceVertexIndices = faces.flat();
  return { points, faceVertexCounts, faceVertexIndices, doubleSided: false };
}

// Generators take optional per-object params (only stairs uses them).
export const PRIMITIVE_GEOMETRY = {
  cube: cubeGeometry,
  cylinder: cylinderGeometry,
  sphere: sphereGeometry,
  plane: planeGeometry,
  wedge: wedgeGeometry,
  stairs: stairsGeometry
};

/** Analytic volume of each unit primitive, for the geometry tests. */
export function primitiveVolume(type, params) {
  switch (type) {
    case 'cube': return 1;
    case 'wedge': return 0.5;
    case 'stairs': {
      const n = Math.max(1, Math.round((params && params.steps) || STAIRS_DEFAULT_STEPS));
      return (n + 1) / (2 * n);
    }
    case 'cylinder': { const n = 24; return (n / 2) * Math.sin(2 * Math.PI / n) * 0.25; }
    case 'sphere': return null;   // faceted approximation; tested by bounds
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const num = (v) => {
  if (!isFinite(v)) return '0';
  const r = Math.round(v * 1e5) / 1e5;
  if (!isFinite(r)) return String(v);          // |v| near Number.MAX_VALUE: scaling overflows
  return Object.is(r, -0) ? '0' : String(r);
};
const vec3 = (v) => `(${num(v[0])}, ${num(v[1])}, ${num(v[2])})`;

export function sanitizeIdentifier(name, taken) {
  let id = String(name || 'Object').replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(id)) id = '_' + id;
  let unique = id, n = 1;
  while (taken.has(unique)) unique = `${id}_${++n}`;
  taken.add(unique);
  return unique;
}

/** Escape a JS string as a USD double-quoted string literal body. */
export function usdString(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

/** Inverse of usdString for the subset of escapes we and usdview emit. */
export function unescapeUsdString(str) {
  return String(str ?? '').replace(/\\(n|t|"|\\)/g, (_, c) =>
    c === 'n' ? '\n' : c === 't' ? '\t' : c);
}

const usdStringArray = (arr) => '[' + arr.map(t => `"${usdString(t)}"`).join(', ') + ']';

const METRIC_KEYS = ['playerHeight', 'capsuleRadius', 'characterHeight', 'eyeHeight', 'crouchHeight', 'stepHeight', 'walkSpeed', 'runSpeed',
  'jumpHeight', 'jumpDistance', 'fov', 'halfCover', 'fullCover', 'doorHeight', 'doorWidth', 'corridorWidth'];

/**
 * objects: tree of
 *   { name, type, position:{x,y,z}, rotation:{x,y,z} (deg), scale:{x,y,z},
 *     color:[r,g,b] 0..1 | null, visible, meshData?, params?, text?, children?,
 *     intent?, marker?, tags?, uid? }
 * type: cube | cylinder | sphere | plane | wedge | stairs | mesh | group | note | marker
 * meshData (generic imports): { points, faceVertexCounts, faceVertexIndices }
 * params: per-primitive settings (stairs: { steps })
 * intent: floor | wall | cover | blocker | water | hazard | interactive | placeholder | null
 * marker (type "marker"): PlayerStart | Spawn | Cover | Objective | Trigger; tags: string[]
 * uid: persistent object id (written as customData ptah:id)
 * opts.reference: optional { image, width, x, z, rotation, opacity } stage-level
 *   underlay, stored in customLayerData so it reopens anywhere.
 * opts.metrics: optional design metrics profile, stored in customLayerData.
 * opts.ground: optional minimum ground (grid) width in units, stored in
 *   customLayerData as ptah:ground; omit it for the default.
 */
export function exportUsda(objects, opts = {}) {
  const lines = [];
  lines.push('#usda 1.0');
  lines.push('(');
  lines.push('    defaultPrim = "Root"');
  lines.push('    metersPerUnit = 0.01');
  lines.push('    upAxis = "Y"');
  lines.push(`    doc = "Generated by Ptah blockout editor${opts.appVersion ? ' v' + opts.appVersion : ''}"`);
  const hasRef = !!(opts.reference && opts.reference.image);
  const hasMetrics = !!opts.metrics;
  const hasGround = typeof opts.ground === 'number' && isFinite(opts.ground) && opts.ground > 0;
  if (hasRef || hasMetrics || hasGround) lines.push('    customLayerData = {');
  if (hasGround) {
    lines.push('        dictionary "ptah:ground" = {');
    lines.push(`            double size = ${num(opts.ground)}`);
    lines.push('        }');
  }
  if (hasMetrics) {
    lines.push('        dictionary "ptah:metrics" = {');
    if (typeof opts.metrics.profile === 'string') lines.push(`            string profile = "${usdString(opts.metrics.profile)}"`);
    for (const k of METRIC_KEYS) {
      if (typeof opts.metrics[k] === 'number') lines.push(`            double ${k} = ${num(opts.metrics[k])}`);
    }
    lines.push('        }');
  }
  if (hasRef) {
    const r = opts.reference;
    lines.push('        dictionary "ptah:reference" = {');
    lines.push(`            string image = "${usdString(r.image)}"`);
    lines.push(`            double width = ${num(r.width)}`);
    lines.push(`            double x = ${num(r.x || 0)}`);
    lines.push(`            double z = ${num(r.z || 0)}`);
    lines.push(`            double rotation = ${num(r.rotation || 0)}`);
    lines.push(`            double opacity = ${num(r.opacity ?? 0.5)}`);
    lines.push('        }');
  }
  if (hasRef || hasMetrics || hasGround) lines.push('    }');
  lines.push(')');
  lines.push('');
  lines.push('def Xform "Root"');
  lines.push('{');
  const taken = new Set();
  for (const obj of objects) writePrim(lines, obj, 1, taken);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function writePrim(lines, obj, depth, taken) {
  const pad = '    '.repeat(depth);
  const id = sanitizeIdentifier(obj.name, taken);
  const isGeom = obj.type !== 'group' && obj.type !== 'note' && obj.type !== 'marker';
  const geo = isGeom
    ? (obj.meshData || (PRIMITIVE_GEOMETRY[obj.type] ? PRIMITIVE_GEOMETRY[obj.type](obj.params) : null))
    : null;
  if (isGeom && !geo) return;

  const meta = [`string "ptah:type" = "${obj.meshData ? 'mesh' : obj.type}"`];
  if (obj.uid) meta.push(`string "ptah:id" = "${usdString(obj.uid)}"`);
  if (obj.name !== id) meta.push(`string "ptah:name" = "${usdString(obj.name)}"`);
  if (obj.type === 'note') meta.push(`string "ptah:text" = "${usdString(obj.text || '')}"`);
  if (obj.type === 'stairs' && obj.params && obj.params.steps) {
    meta.push(`int "ptah:steps" = ${Math.round(obj.params.steps)}`);
  }
  if (obj.color && !geo) meta.push(`color3f "ptah:color" = ${vec3(obj.color)}`);

  lines.push(`${pad}def Xform "${id}" (`);
  lines.push(`${pad}    customData = {`);
  for (const m of meta) lines.push(`${pad}        ${m}`);
  lines.push(`${pad}    }`);
  lines.push(`${pad})`);
  lines.push(`${pad}{`);
  if (obj.visible === false) lines.push(`${pad}    token visibility = "invisible"`);
  const p = obj.position || { x: 0, y: 0, z: 0 };
  const r = obj.rotation || { x: 0, y: 0, z: 0 };
  const sc = obj.scale || { x: 1, y: 1, z: 1 };
  lines.push(`${pad}    double3 xformOp:translate = ${vec3([p.x, p.y, p.z])}`);
  lines.push(`${pad}    float3 xformOp:rotateXYZ = ${vec3([r.x, r.y, r.z])}`);
  lines.push(`${pad}    float3 xformOp:scale = ${vec3([sc.x, sc.y, sc.z])}`);
  lines.push(`${pad}    uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ", "xformOp:scale"]`);
  if (obj.type === 'marker') lines.push(`${pad}    custom string ptah:marker = "${usdString(obj.marker || 'Spawn')}"`);
  if (obj.intent && geo) lines.push(`${pad}    custom string ptah:intent = "${usdString(obj.intent)}"`);
  if (obj.tags && obj.tags.length) lines.push(`${pad}    custom string[] ptah:tags = ${usdStringArray(obj.tags)}`);

  if (geo) {
    lines.push('');
    lines.push(`${pad}    def Mesh "Geom"`);
    lines.push(`${pad}    {`);
    lines.push(`${pad}        point3f[] points = [${geo.points.map(vec3).join(', ')}]`);
    lines.push(`${pad}        int[] faceVertexCounts = [${geo.faceVertexCounts.join(', ')}]`);
    lines.push(`${pad}        int[] faceVertexIndices = [${geo.faceVertexIndices.join(', ')}]`);
    if (geo.doubleSided) lines.push(`${pad}        uniform bool doubleSided = 1`);
    lines.push(`${pad}        uniform token subdivisionScheme = "none"`);
    if (obj.color) lines.push(`${pad}        color3f[] primvars:displayColor = [${vec3(obj.color)}]`);
    lines.push(`${pad}    }`);
  }

  const kids = obj.children || [];
  if (kids.length) {
    const childTaken = new Set(geo ? ['Geom'] : []);
    for (const child of kids) {
      lines.push('');
      writePrim(lines, child, depth + 1, childTaken);
    }
  }
  lines.push(`${pad}}`);
}

// ---------------------------------------------------------------------------
// Import — a tolerant reader for the .usda subset Ptah writes, plus basic
// gprims (Cube / Sphere / Cylinder) and plain Meshes from other tools.
// Hierarchy is preserved: each returned object carries `children`.
// ---------------------------------------------------------------------------

export function importUsda(text) {
  const warnings = [];
  text = String(text).replace(/^\uFEFF/, '');   // Notepad and friends prepend a UTF-8 BOM
  if (!/^#usda/.test(text.trim())) {
    warnings.push('File does not start with "#usda" — attempting to parse anyway.');
  }
  const src = stripComments(text);
  const reference = readReference(src);
  const metrics = readMetrics(src);
  const ground = readGround(src);
  const blocks = parseBlocks(src, warnings);
  const budgets = { points: 0, indices: 0, animated: 0 };
  let objects = [];
  for (const b of blocks) {
    const o = toObject(b, warnings, budgets);
    if (o) objects.push(o);
    else if (b.children.length) objects.push(...childObjects(b, warnings, null, budgets));
  }
  // Our own files wrap everything in an untyped root Xform "Root"; unwrap it.
  if (objects.length === 1 && objects[0].type === 'group' && objects[0].name === 'Root'
      && isIdentity(objects[0])) {
    objects = objects[0].children;
  }
  if (budgets.animated) warnings.push(`${budgets.animated} prim${budgets.animated === 1 ? ' has' : 's have'} animated (timeSamples) values; Ptah imports the static default values only.`);
  // Stage units and up axis. Ptah is Y-up centimetres (USD's defaults). A
  // Z-up or metre-based file (Blender, Houdini, Unreal exports) is wrapped in
  // one group that converts it, so nothing lands on its side or 100x small;
  // ungrouping (Ctrl+Shift+G) bakes the conversion into the children.
  const up = readStageToken(src, 'upAxis');
  const mpu = readStageNumber(src, 'metersPerUnit');
  const k = mpu && mpu > 0 ? mpu / 0.01 : 1;
  if (objects.length && (up === 'Z' || Math.abs(k - 1) > 1e-9)) {
    const label = `${up === 'Z' ? 'Z-up' : 'Y-up'}, ${mpu && mpu > 0 ? fmtUnits(mpu) : 'cm'}`;
    const name = `Imported (${label})`;
    objects = [makeGroup(name, { x: 0, y: 0, z: 0 }, { x: up === 'Z' ? -90 : 0, y: 0, z: 0 }, { x: k, y: k, z: k }, true, objects)];
    warnings.push(`File is ${label}; its contents are in the group "${name}", which converts them to Ptah's Y-up centimetres. Ungroup it (Ctrl+Shift+G) to bake the conversion in.`);
  }
  // The editor caps nesting so every saved level reopens (the export adds Root
  // above and a Geom Mesh below each object). Refuse deeper scenes here
  // rather than let them be edited and saved into a file that will not load.
  let deepest = 0;
  walkObjects(objects, (_o, _p, d) => { if (d + 1 > deepest) deepest = d + 1; });
  if (deepest > MAX_NESTING) throw new Error(`File nests objects ${deepest} levels deep; Ptah's limit is ${MAX_NESTING} so that saved levels reopen`);
  if (objects.length === 0) warnings.push('No importable geometry found in file.');
  return { objects, warnings, reference, metrics, ground };
}

function stageHead(src) {
  const head = src.match(/^#usda[^\n]*\n\s*\(([\s\S]*?)\n\)/);
  return head ? head[1] : '';
}
function readStageToken(src, key) {
  const m = stageHead(src).match(new RegExp(String.raw`(?:^|\n)\s*` + key + String.raw`\s*=\s*"([^"]*)"`));
  return m ? m[1] : null;
}
function readStageNumber(src, key) {
  const m = stageHead(src).match(new RegExp(String.raw`(?:^|\n)\s*` + key + String.raw`\s*=\s*([-\d.eE+]+)`));
  return m ? parseFloat(m[1]) : null;
}
function fmtUnits(mpu) {
  const named = { 1: 'metres', 0.01: 'cm', 0.001: 'mm', 0.0254: 'inches', 0.3048: 'feet' };
  for (const [v, n] of Object.entries(named)) if (Math.abs(mpu - Number(v)) < 1e-9) return n;
  return `${mpu} m per unit`;
}

function isIdentity(o) {
  const p = o.position, r = o.rotation, s = o.scale;
  return !p.x && !p.y && !p.z && !r.x && !r.y && !r.z && s.x === 1 && s.y === 1 && s.z === 1;
}

// Stage-level customLayerData dictionaries: { dictionary "ptah:xxx" = { ... } }
function readLayerDict(src, key) {
  const m = stageHead(src).match(new RegExp('"' + escRe(key) + String.raw`"\s*=\s*\{([\s\S]*?)\n\s*\}`));
  return m ? m[1] : null;
}

/** { playerHeight, eyeHeight, ... } or null when the file has no profile (v0.1/v0.2 files). */
function readMetrics(src) {
  const body = readLayerDict(src, 'ptah:metrics');
  if (body == null) return null;
  const out = {};
  const profile = readString(body, 'profile');
  if (profile) out.profile = unescapeUsdString(profile);
  for (const k of METRIC_KEYS) {
    const v = readNumber(body, k);
    if (v != null) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Minimum ground (grid) width in units as written (the editor clamps and warns), or null when the file does not set one. */
function readGround(src) {
  const body = readLayerDict(src, 'ptah:ground');
  if (body == null) return null;
  const size = readNumber(body, 'size');
  return size != null && isFinite(size) ? size : null;
}

function readReference(src) {
  const body = readLayerDict(src, 'ptah:reference');
  if (body == null) return null;
  const image = readString(body, 'image');
  if (!image) return null;
  return {
    image: unescapeUsdString(image),
    width: readNumber(body, 'width') ?? 512,
    x: readNumber(body, 'x') ?? 0,
    z: readNumber(body, 'z') ?? 0,
    rotation: readNumber(body, 'rotation') ?? 0,
    opacity: readNumber(body, 'opacity') ?? 0.5
  };
}

// ---- lexical helpers ----
// USDA strings: "..." and '...' (single line, backslash escapes) and
// """...""" / '''...''' (may span lines). Asset paths: @...@ and @@@...@@@.
// Each returns the index just past the literal starting at s[i].
function skipString(s, i) {
  const q = s[i], n = s.length;
  if (s[i + 1] === q && s[i + 2] === q) {
    let j = i + 3;
    while (j < n && !(s[j] === q && s[j + 1] === q && s[j + 2] === q)) j += s[j] === '\\' ? 2 : 1;
    return Math.min(n, j + 3);
  }
  let j = i + 1;
  while (j < n && s[j] !== q) j += s[j] === '\\' ? 2 : 1;
  return Math.min(n, j + 1);
}
function skipAsset(s, i) {
  if (s.startsWith('@@@', i)) { const e = s.indexOf('@@@', i + 3); return e < 0 ? s.length : e + 3; }
  const e = s.indexOf('@', i + 1);
  return e < 0 ? s.length : e + 1;
}

// Remove `#` comments (anywhere outside a string, not just at line start),
// plus /* */ and // for tolerance, never touching string or asset contents
// (data URLs in customLayerData contain "//" and "#"). The `#usda` header
// line is kept. One linear pass that copies slices, not characters.
function stripComments(s) {
  const parts = [];
  const n = s.length;
  let i = s.startsWith('#usda') ? s.indexOf('\n') : 0, last = 0;
  if (i < 0) return s;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 34 || c === 39) { i = skipString(s, i); continue; }          // " '
    if (c === 64) { i = skipAsset(s, i); continue; }                        // @
    let end = -1;
    if (c === 35) end = s.indexOf('\n', i);                                 // #
    else if (c === 47 && s.charCodeAt(i + 1) === 47) end = s.indexOf('\n', i);   // //
    else if (c === 47 && s.charCodeAt(i + 1) === 42) {                      // /* */
      const e = s.indexOf('*/', i + 2);
      end = e < 0 ? n : e + 2;
      parts.push(s.slice(last, i), ' ');
      i = last = end;
      continue;
    } else { i++; continue; }
    if (end < 0) end = n;
    parts.push(s.slice(last, i));
    i = last = end;
  }
  parts.push(s.slice(last));
  return parts.join('');
}

function skipWs(s, i) {
  for (;;) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) i++; else return i;
  }
}

/** Index of the bracket closing the one at s[start], string- and asset-aware; -1 if unbalanced. */
function matchBracket(s, start, open, close) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { i = skipString(s, i) - 1; continue; }
    if (c === '@') { i = skipAsset(s, i) - 1; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function selectedVariant(meta, setName) {
  const v = meta.match(/\bvariants\s*=\s*\{([^}]*)\}/);
  if (!v) return null;
  const m = v[1].match(new RegExp(String.raw`(?:^|\s)string\s+"?` + escRe(setName) + String.raw`"?\s*=\s*"((?:[^"\\]|\\.)*)"`));
  return m ? m[1] : null;
}

// One linear pass over the (comment-stripped) layer that yields the prim
// tree. A frame stack tracks every bracket, so a prim head is recognized only
// at a statement boundary directly inside the root, a prim body or a
// variant (never inside a string, a dictionary, metadata or an array), and
// each character is visited once however deep the nesting.
//
//   def      imported
//   over     skipped with its subtree: an override of a prim defined in a
//            layer Ptah does not compose (references, sublayers)
//   class    skipped with its subtree: a prototype, not scene geometry
//   variantSet: only the variant selected in the owning prim's `variants`
//            metadata contributes: its prims become the owner's children
//            and its attributes are appended after the owner's own (local
//            opinions are stronger, and the readers take the first match).
//            Variant sets nest. A set with no selection contributes nothing,
//            as in USD, and is reported.
//
// A block is { type, name, meta, attrsText, children }, where attrsText is the
// body with child prims and variant sets cut out (plus selected variants'
// attributes).
const HEAD_RE = /(def|over|class)\s+(?:([A-Za-z_][A-Za-z0-9_]*)\s+)?"((?:[^"\\]|\\.)*)"/y;
const VSET_RE = /variantSet\s+"((?:[^"\\]|\\.)*)"\s*=\s*\{/y;
const VARIANT_RE = /"((?:[^"\\]|\\.)*)"/y;

function parseBlocks(src, warnings, stats = { prims: 0, skipped: 0, unselected: 0 }) {
  const root = { kind: 'root', children: [], skip: false };
  const stack = [root];
  const n = src.length;
  let i = 0, stmt = true, primDepth = 0;
  const bodyFrame = () => { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].kind === 'prim' || stack[k].kind === 'root') return stack[k]; return root; };
  const assemble = (from, to, holes) => {
    const parts = [];
    for (const [a, b] of holes) { parts.push(src.slice(from, a)); from = b; }
    parts.push(src.slice(from, to));
    return parts.join('');
  };

  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 32 || c === 9 || c === 13) { i++; continue; }
    if (c === 10) { stmt = true; i++; continue; }
    const top = stack[stack.length - 1];

    if (stmt && (top.kind === 'prim' || top.kind === 'root' || top.kind === 'variant') && (c === 100 || c === 111 || c === 99)) {   // d o c
      HEAD_RE.lastIndex = i;
      const m = HEAD_RE.exec(src);
      if (m) {
        let j = skipWs(src, HEAD_RE.lastIndex), meta = '';
        if (src[j] === '(') {
          const e = matchBracket(src, j, '(', ')');
          if (e < 0) { warnings.push(`Unbalanced metadata in "${m[3]}".`); break; }
          meta = src.slice(j + 1, e);
          j = skipWs(src, e + 1);
        }
        if (src[j] === '{') {
          if (++stats.prims > MAX_PRIMS) throw new Error(`File has more than ${MAX_PRIMS} prims`);
          if (++primDepth > MAX_DEPTH) throw new Error(`File nests prims more than ${MAX_DEPTH} levels deep`);
          const skip = top.skip || m[1] !== 'def';
          if (skip && !top.skip && top.kind !== 'variant') stats.skipped++;
          stack.push({ kind: 'prim', type: m[2] || 'Prim', name: m[3], meta, start: i, bodyStart: j + 1, holes: [], extra: [], children: [], skip });
          i = j + 1; stmt = true;
          continue;
        }
        i = j; stmt = false;                  // a head without a body: nothing to import
        continue;
      }
    }
    if (stmt && (top.kind === 'prim' || top.kind === 'variant') && c === 118) {   // v
      VSET_RE.lastIndex = i;
      const m = VSET_RE.exec(src);
      if (m) {
        const owner = top.kind === 'prim' ? top : top.owner;
        const name = unescapeUsdString(m[1]);
        const selection = selectedVariant(owner.meta, name);
        if (selection == null && !top.skip) stats.unselected++;
        stack.push({ kind: 'variantSet', name, selection, start: i, owner, parent: top, skip: top.skip });
        i = VSET_RE.lastIndex; stmt = true;
        continue;
      }
    }
    if (stmt && top.kind === 'variantSet' && c === 34) {
      VARIANT_RE.lastIndex = i;
      const m = VARIANT_RE.exec(src);
      if (m) {
        let j = skipWs(src, VARIANT_RE.lastIndex);
        if (src[j] === '(') { const e = matchBracket(src, j, '(', ')'); if (e < 0) break; j = skipWs(src, e + 1); }
        if (src[j] === '{') {
          stack.push({ kind: 'variant', owner: top.owner, bodyStart: j + 1, holes: [], skip: top.skip || top.selection !== unescapeUsdString(m[1]) });
          i = j + 1; stmt = true;
          continue;
        }
      }
    }

    if (c === 34 || c === 39) { i = skipString(src, i); stmt = false; continue; }
    if (c === 64) { i = skipAsset(src, i); stmt = false; continue; }
    if (c === 123) { stack.push({ kind: 'brace' }); i++; stmt = true; continue; }   // {
    if (c === 40) { stack.push({ kind: 'paren' }); i++; stmt = false; continue; }   // (
    if (c === 91) { stack.push({ kind: 'bracket' }); i++; stmt = false; continue; } // [
    if (c === 41 || c === 93) {                                                      // ) ]
      if (top.kind === (c === 41 ? 'paren' : 'bracket')) stack.pop();
      i++; stmt = false;
      continue;
    }
    if (c === 125) {                                                                 // }
      if (stack.length > 1 && top.kind !== 'paren' && top.kind !== 'bracket') {
        stack.pop();
        if (top.kind === 'prim') {
          primDepth--;
          const attrsText = [assemble(top.bodyStart, i, top.holes), ...top.extra].join('\n');
          const block = { type: top.type, name: top.name, meta: top.meta, attrsText, children: top.children };
          const enclosing = stack[stack.length - 1];
          if (enclosing.kind === 'prim' || enclosing.kind === 'variant') enclosing.holes.push([top.start, i + 1]);
          if (!top.skip) bodyFrame().children.push(block);
        } else if (top.kind === 'variantSet') {
          top.parent.holes.push([top.start, i + 1]);
        } else if (top.kind === 'variant' && !top.skip) {
          top.owner.extra.push(assemble(top.bodyStart, i, top.holes));
        }
      }
      i++; stmt = true;
      continue;
    }
    stmt = c === 59;                                                                  // ;
    i++;
  }
  for (let k = stack.length - 1; k > 0; k--) {
    if (stack[k].kind === 'prim') { warnings.push(`Unbalanced body in "${stack[k].name}".`); break; }
  }
  if (stats.unselected) warnings.push(`${stats.unselected} variant set${stats.unselected === 1 ? ' has' : 's have'} no selection; ${stats.unselected === 1 ? 'its variants were' : 'their variants were'} skipped, as USD does.`);
  if (stats.skipped) warnings.push(`Skipped ${stats.skipped} class/over prim${stats.skipped === 1 ? '' : 's'}: Ptah imports defined prims only (it does not compose references or classes).`);
  return root.children;
}

// ---- attribute readers ----

const escRe = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// An attribute name must not be the tail of a longer name: `points` must not
// match `primvars:points`, `size` must not match `fontsize`.
const NAME_START = String.raw`(?<![\w:.])`;

// Body of `name = [ ... ]`, found with the string-aware bracket matcher so a
// `]` inside a string element (a tag like "[wip]") does not end the array.
function readArrayBody(attrs, name) {
  const re = new RegExp(NAME_START + escRe(name) + String.raw`\s*=\s*\[`);
  const m = re.exec(attrs);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const end = matchBracket(attrs, open, '[', ']');
  return end < 0 ? null : attrs.slice(open + 1, end);
}

function readVec3(attrs, name) {
  const re = new RegExp(NAME_START + escRe(name) + String.raw`"?\s*=\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)`);
  const m = attrs.match(re);
  return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null;
}

function readNumber(attrs, name) {
  const re = new RegExp(String.raw`(?:^|[\s"])` + escRe(name) + String.raw`"?\s*=\s*([-\d.eE+]+)`, 'm');
  const m = attrs.match(re);
  return m ? parseFloat(m[1]) : null;
}

function readString(text, name) {
  const re = new RegExp(NAME_START + '"?' + escRe(name) + String.raw`"?\s*=\s*"((?:[^"\\]|\\.)*)"`);
  const m = text.match(re);
  return m ? m[1] : null;
}

function readTupleArray(attrs, name) {
  const body = readArrayBody(attrs, name);
  return body == null ? null : parseTuples(body);
}
function parseTuples(body) {
  const out = [];
  const tupRe = /\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)/g;
  let t;
  while ((t = tupRe.exec(body)) !== null) out.push([parseFloat(t[1]), parseFloat(t[2]), parseFloat(t[3])]);
  return out;
}

function readStringArray(attrs, name) {
  const body = readArrayBody(attrs, name);
  if (body == null) return null;
  const out = [];
  const strRe = /"((?:[^"\\]|\\.)*)"/g;
  let t;
  while ((t = strRe.exec(body)) !== null) out.push(unescapeUsdString(t[1]));
  return out;
}

function parseInts(body) {
  return body.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
}

// ---- rotation helpers (pure JS; three.js is not available in Node tests) ----
// Angles are degrees in USD rotateXYZ semantics: R = Rz * Ry * Rx (X applied
// first). All conversions go through a column-vector rotation matrix.

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
const mul3 = (A, B) => A.map((row, i) => [0, 1, 2].map(j => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const AXIS_ROT = { X: rotX, Y: rotY, Z: rotZ };

/** Rotation matrix for a USD rotate<ABC> op: A applied first. */
export function matrixFromRotateOp(order, degrees) {
  let m = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  // R = R_C * R_B * R_A  (A first); order string lists A, B, C
  for (let i = 0; i < 3; i++) {
    const axis = order[i];
    const idx = 'XYZ'.indexOf(axis);
    m = mul3(AXIS_ROT[axis](degrees[idx] * D2R), m);
  }
  return m;
}

/** Column-vector rotation matrix from a unit quaternion (w, x, y, z). */
export function matrixFromQuat(w, x, y, z) {
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n; x /= n; y /= n; z /= n;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
  ];
}

/** Decompose R = Rz*Ry*Rx into rotateXYZ degrees. */
export function rotateXYZFromMatrix(m) {
  const sy = -m[2][0];
  const y = Math.asin(Math.max(-1, Math.min(1, sy)));
  let x, z;
  if (Math.abs(Math.cos(y)) > 1e-6) {
    x = Math.atan2(m[2][1], m[2][2]);
    z = Math.atan2(m[1][0], m[0][0]);
  } else {                                   // gimbal lock: fold z into x
    x = Math.atan2(-m[1][2], m[1][1]);
    z = 0;
  }
  return [x * R2D, y * R2D, z * R2D].map(v => Math.abs(v) < 1e-9 ? 0 : v);
}

// ---- 4x4 helpers for composing xform ops (column vectors, row-major arrays) ----
const I4 = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const mul4 = (A, B) => A.map(row => [0, 1, 2, 3].map(j => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j] + row[3] * B[3][j]));
const from3 = (R) => [[...R[0], 0], [...R[1], 0], [...R[2], 0], [0, 0, 0, 1]];
const translate4 = (t) => [[1, 0, 0, t[0]], [0, 1, 0, t[1]], [0, 0, 1, t[2]], [0, 0, 0, 1]];
const scale4 = (s) => [[s[0], 0, 0, 0], [0, s[1], 0, 0], [0, 0, s[2], 0], [0, 0, 0, 1]];
function invert4(M) {
  const a = M.map((row, i) => [...row, ...I4()[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++) if (r !== c) { const f = a[r][c]; for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k]; }
  }
  return a.map(row => row.slice(4));
}

const OP_RE = /^(!invert!)?xformOp:(translate|scale|rotateX|rotateY|rotateZ|rotate[XYZ]{3}|orient|transform)(:[A-Za-z0-9_:]+)?$/;

/** Column-vector matrix of one authored op, or null when its value is missing. */
function opMatrix(attrs, type, attrName) {
  switch (type) {
    case 'translate': { const v = readVec3(attrs, attrName); return v && translate4(v); }
    case 'scale': { const v = readVec3(attrs, attrName); return v && scale4(v); }
    case 'rotateX': case 'rotateY': case 'rotateZ': {
      const v = readNumber(attrs, attrName);
      return v == null ? null : from3(AXIS_ROT[type[6]](v * D2R));
    }
    case 'orient': { const q = readQuat(attrs, attrName); return q && from3(matrixFromQuat(q[0], q[1], q[2], q[3])); }
    case 'transform': {
      const m = readMatrix4(attrs, attrName);         // USD: row vectors, translation in row 3
      return m && [0, 1, 2, 3].map(i => [0, 1, 2, 3].map(j => m[j][i]));
    }
    default: {                                         // rotateABC
      const v = readVec3(attrs, attrName);
      return v && from3(matrixFromRotateOp(type.slice(6), v));
    }
  }
}

// Transform of a prim from its xform ops. USD composes the ops listed in
// xformOpOrder, in that order (the first listed is outermost: M = op0 * op1
// * ...), ignores authored ops that are not listed, and applies `!invert!`
// ops inverted, which is how Maya pivots are written. The common
// [translate, rotate, scale] stack is read directly (exact, and what Ptah
// writes); anything else is composed as a matrix and decomposed into Ptah's
// translate / rotateXYZ / scale, which is exact unless the result has shear.
function readTRS(attrs, warnings, name) {
  const orderMatch = attrs.match(/(?<![\w:.])xformOpOrder\s*=\s*\[([^\]]*)\]/);
  let order;
  if (orderMatch) {
    order = orderMatch[1].split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  } else {
    // No order authored (older or hand-written files): fall back to the
    // conventional stack of whatever standard ops are present.
    const has = (op) => new RegExp(NAME_START + escRe(op) + String.raw`"?\s*=`).test(attrs);
    const rot = ['xformOp:rotateXYZ', 'xformOp:rotateXZY', 'xformOp:rotateYXZ', 'xformOp:rotateYZX', 'xformOp:rotateZXY', 'xformOp:rotateZYX', 'xformOp:orient']
      .find(has);
    order = has('xformOp:transform') && !rot
      ? ['xformOp:transform']
      : ['xformOp:translate', rot, 'xformOp:scale'].filter(op => op && has(op));
  }
  const parsed = order.map(op => ({ op, m: op.match(OP_RE) }));
  const unknown = parsed.filter(p => !p.m).map(p => p.op);

  const ident = { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
  const ops = parsed.filter(p => p.m).map(({ op, m }) => ({ op, invert: !!m[1], type: m[2], suffix: m[3] || '', attr: op.replace(/^!invert!/, '') }));

  // Fast path: plain [translate?] [one rotate or orient?] [scale?], no suffixes or inversions.
  const plain = ops.every(o => !o.invert && !o.suffix);
  const rank = (o) => o.type === 'translate' ? 0 : o.type === 'scale' ? 2 : o.type === 'transform' ? -1 : 1;
  const ranks = ops.map(rank);
  if (plain && !ranks.includes(-1) && ranks.every((r, k) => k === 0 || r > ranks[k - 1])) {
    const out = { t: [...ident.t], r: [...ident.r], s: [...ident.s] };
    for (const o of ops) {
      if (o.type === 'translate') out.t = readVec3(attrs, o.attr) || out.t;
      else if (o.type === 'scale') out.s = readVec3(attrs, o.attr) || out.s;
      else if (o.type === 'rotateXYZ') out.r = readVec3(attrs, o.attr) || out.r;
      else if (/^rotate[XYZ]$/.test(o.type)) { const v = readNumber(attrs, o.attr); if (v != null) out.r['XYZ'.indexOf(o.type[6])] = v; }
      else { const M = opMatrix(attrs, o.type, o.attr); if (M) out.r = rotateXYZFromMatrix(M.slice(0, 3).map(row => row.slice(0, 3))); }
    }
    if (unknown.length && warnings) warnings.push(`"${name}" lists xform ops Ptah does not know (${unknown.join(', ')}); they are ignored.`);
    return out;
  }

  let M = I4();
  for (const o of ops) {
    let m = opMatrix(attrs, o.type, o.attr);
    if (!m) continue;                                  // listed but not authored: identity, as in USD
    if (o.invert) m = invert4(m) || I4();
    M = mul4(M, m);
  }
  const t = [M[0][3], M[1][3], M[2][3]];
  const cols = [0, 1, 2].map(j => [M[0][j], M[1][j], M[2][j]]);
  const s = cols.map(c => Math.hypot(...c));
  const R = [0, 1, 2].map(i => [0, 1, 2].map(j => M[i][j] / (s[j] || 1)));
  // A zero scale axis zeroes its basis column; rebuild it from the other two
  // so the rotation survives (a flattened rotated object keeps its angle).
  const zero = [0, 1, 2].filter(j => s[j] < 1e-12);
  if (zero.length === 1) {
    const j = zero[0], a = (j + 1) % 3, b = (j + 2) % 3;
    const ca = [R[0][a], R[1][a], R[2][a]], cb = [R[0][b], R[1][b], R[2][b]];
    const x = [ca[1] * cb[2] - ca[2] * cb[1], ca[2] * cb[0] - ca[0] * cb[2], ca[0] * cb[1] - ca[1] * cb[0]];
    for (let i = 0; i < 3; i++) R[i][j] = x[i];
  }
  const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  if (det < 0) { s[0] = -s[0]; for (let i = 0; i < 3; i++) R[i][0] = -R[i][0]; }   // mirrored: keep it in the scale, not a folded rotation
  const dot = (a, b) => (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1);
  const shear = Math.abs(dot(cols[0], cols[1])) > 1e-6 || Math.abs(dot(cols[0], cols[2])) > 1e-6 || Math.abs(dot(cols[1], cols[2])) > 1e-6;
  if (warnings && (shear || unknown.length)) {
    warnings.push(shear
      ? `"${name}" has a sheared transform, which Ptah's translate / rotate / scale cannot hold; transform is approximate.`
      : `"${name}" lists xform ops Ptah does not know (${unknown.join(', ')}); they are ignored.`);
  }
  const r = rotateXYZFromMatrix(R);
  return { t: t.map(v => Math.abs(v) < 1e-9 ? 0 : v), r, s: s.map(v => Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : v) };
}

function readQuat(attrs, name) {
  const re = new RegExp(NAME_START + escRe(name) + String.raw`\s*=\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)`);
  const m = attrs.match(re);
  return m ? [1, 2, 3, 4].map(i => parseFloat(m[i])) : null;   // (w, x, y, z) as USD writes it
}

function readMatrix4(attrs, name) {
  const re = new RegExp(NAME_START + escRe(name) + String.raw`\s*=\s*\(\s*((?:\([^)]*\)\s*,?\s*){4})\)`);
  const m = attrs.match(re);
  if (!m) return null;
  const rows = [...m[1].matchAll(/\(([^)]*)\)/g)].map(r => r[1].split(',').map(v => parseFloat(v.trim())));
  return rows.length === 4 && rows.every(r => r.length === 4 && r.every(isFinite)) ? rows : null;
}

// ---- interpretation ----

const isXformChild = (c) => ['Xform', 'Cube', 'Sphere', 'Cylinder', 'Mesh', 'Prim', 'Scope'].includes(c.type);

function childObjects(block, warnings, skip = null, budgets = null) {
  const out = [];
  for (const c of block.children) {
    if (c === skip) continue;
    const o = toObject(c, warnings, budgets);
    if (o) out.push(o);
    else if (c.children.length) out.push(...childObjects(c, warnings, null, budgets)); // Scope etc: hoist
  }
  return out;
}

/** Turn a parsed prim block into a Ptah object (with children), or null. */
function toObject(block, warnings, budgets = null) {
  const { type, name, meta, attrsText, children } = block;
  const trs = readTRS(attrsText, warnings, name);
  if (budgets && /\.timeSamples\s*=/.test(attrsText)) budgets.animated++;
  const invisible = /visibility\s*=\s*"invisible"/.test(attrsText);
  const ptahType = readString(meta, 'ptah:type');
  const rawName = readString(meta, 'ptah:name');
  const displayName = rawName != null ? unescapeUsdString(rawName) : name;
  const uid = readString(meta, 'ptah:id');
  const withMeta = (o) => {
    if (!o) return o;
    if (uid) o.uid = unescapeUsdString(uid);
    const intent = readString(attrsText, 'ptah:intent');
    const intentKey = intent ? unescapeUsdString(intent) : null;
    if (intentKey && o.type !== 'group' && o.type !== 'note' && o.type !== 'marker' && INTENT_BY_KEY[intentKey]) o.intent = intentKey;
    const tags = readStringArray(attrsText, 'ptah:tags');
    if (tags && tags.length) o.tags = tags;
    return o;
  };

  const pos = { x: trs.t[0], y: trs.t[1], z: trs.t[2] };
  const rot = { x: trs.r[0], y: trs.r[1], z: trs.r[2] };
  const scl = { x: trs.s[0], y: trs.s[1], z: trs.s[2] };
  const meshChild = children.find(c => c.type === 'Mesh');

  // Ptah's own prims: authoritative type tag.
  if (type === 'Xform' && ptahType) {
    if (ptahType === 'group' || ptahType === 'note' || ptahType === 'marker') {
      const o = makeObject(displayName, ptahType, pos, rot, scl, colorFromMeta(meta), !invisible, null);
      if (ptahType === 'note') o.text = unescapeUsdString(readString(meta, 'ptah:text') || '');
      if (ptahType === 'marker') {
        const marker = unescapeUsdString(readString(attrsText, 'ptah:marker') || 'Spawn');
        o.marker = MARKER_BY_KEY[marker] ? marker : 'Spawn';
      }
      o.children = childObjects(block, warnings, null, budgets);
      return withMeta(o);
    }
    if (ptahType !== 'mesh' && PRIMITIVE_GEOMETRY[ptahType]) {
      const o = makeObject(displayName, ptahType, pos, rot, scl, colorFrom(meshChild), !invisible, null);
      if (ptahType === 'stairs') {
        const steps = readNumber(meta, 'ptah:steps');
        if (steps) o.params = { steps: Math.max(1, Math.round(steps)) };
      }
      o.children = childObjects(block, warnings, meshChild, budgets);
      return withMeta(o);
    }
    // ptah:type = "mesh" falls through to the generic Xform+Mesh path.
  }

  if (type === 'Cube' || type === 'Sphere' || type === 'Cylinder') {
    const o = gprimToObject(block, pos, rot, scl, invisible);
    if (o) o.children = childObjects(block, warnings, null, budgets);
    return o;
  }

  if (type === 'Mesh') {
    const o = meshToObject(block, displayName, pos, rot, scl, invisible, warnings, budgets);
    if (o) o.children = childObjects(block, warnings, null, budgets);
    return o;
  }

  if (type === 'Xform') {
    if (meshChild) {
      // Foreign Xform carrying a mesh: the mesh's own transform is folded away
      // only when it is identity (the common case). Otherwise it becomes a child.
      const mt = readTRS(meshChild.attrsText, null, meshChild.name);
      const meshIsIdentity = !mt.t.some(Boolean) && !mt.r.some(Boolean) && mt.s.every(v => v === 1);
      if (meshIsIdentity) {
        const o = meshToObject(meshChild, displayName, pos, rot, scl, invisible, warnings, budgets);
        if (o) o.children = childObjects(block, warnings, meshChild, budgets);
        // A skipped mesh has already warned; do not visit it a second time as a child.
        return o ? withMeta(o) : makeGroup(displayName, pos, rot, scl, !invisible, childObjects(block, warnings, meshChild, budgets));
      }
    }
    if (children.some(isXformChild)) {
      return groupFrom(block, displayName, pos, rot, scl, invisible, warnings, budgets);
    }
    // Empty Xform from another tool: import as an empty group so the position
    // survives (e.g. spawn points authored as empties).
    return makeGroup(displayName, pos, rot, scl, !invisible, []);
  }

  return null; // Scope, Material, etc: caller hoists their children
}

function groupFrom(block, displayName, pos, rot, scl, invisible, warnings, budgets = null) {
  return makeGroup(displayName, pos, rot, scl, !invisible, childObjects(block, warnings, null, budgets));
}

function makeGroup(name, position, rotation, scale, visible, children) {
  const o = makeObject(name, 'group', position, rotation, scale, null, visible, null);
  o.children = children;
  return o;
}

function colorFrom(meshBlock) {
  if (!meshBlock) return null;
  const c = readTupleArray(meshBlock.attrsText, 'primvars:displayColor');
  return c && c.length ? c[0] : null;
}

function colorFromMeta(meta) {
  return readVec3(meta, 'ptah:color');
}

function makeObject(name, type, position, rotation, scale, color, visible, meshData) {
  return { name, type, position, rotation, scale, color: color || null, visible, meshData, children: [] };
}

function gprimToObject(block, pos, rot, scl, invisible) {
  const a = block.attrsText;
  const color = (readTupleArray(a, 'primvars:displayColor') || [])[0] || null;
  if (block.type === 'Cube') {
    const size = readNumber(a, 'size') ?? 2;                 // USD Cube default extent is 2
    return makeObject(block.name, 'cube', pos, rot,
      { x: scl.x * size, y: scl.y * size, z: scl.z * size }, color, !invisible, null);
  }
  if (block.type === 'Sphere') {
    const r = readNumber(a, 'radius') ?? 1;
    return makeObject(block.name, 'sphere', pos, rot,
      { x: scl.x * r * 2, y: scl.y * r * 2, z: scl.z * r * 2 }, color, !invisible, null);
  }
  if (block.type === 'Cylinder') {
    const r = readNumber(a, 'radius') ?? 1;
    const h = readNumber(a, 'height') ?? 2;
    // USD cylinders default to the Z axis; Ptah's are Y-up. Fold the axis into the rotation.
    const axis = (a.match(/\baxis\s*=\s*"([XYZ])"/) || [, 'Z'])[1];
    let rotation = rot, scale = { x: scl.x * r * 2, y: scl.y * h, z: scl.z * r * 2 };
    if (axis !== 'Y') {
      const R = mul3(matrixFromRotateOp('XYZ', [rot.x, rot.y, rot.z]), axis === 'Z' ? rotX(90 * D2R) : rotZ(-90 * D2R));
      const e = rotateXYZFromMatrix(R);
      rotation = { x: e[0], y: e[1], z: e[2] };
      scale = axis === 'Z' ? { x: scl.x * r * 2, y: scl.z * h, z: scl.y * r * 2 } : { x: scl.y * r * 2, y: scl.x * h, z: scl.z * r * 2 };
    }
    return makeObject(block.name, 'cylinder', pos, rotation, scale, color, !invisible, null);
  }
  return null;
}

function countChar(s, ch) {
  let n = 0;
  for (let i = s.indexOf(ch); i >= 0; i = s.indexOf(ch, i + 1)) n++;
  return n;
}

function meshToObject(block, displayName, pos, rot, scl, invisible, warnings, budgets = null) {
  const a = block.attrsText;
  const pointsBody = readArrayBody(a, 'points');
  const countsBody = readArrayBody(a, 'faceVertexCounts');
  const indicesBody = readArrayBody(a, 'faceVertexIndices');
  const color = (readTupleArray(a, 'primvars:displayColor') || [])[0] || null;
  if (pointsBody == null || countsBody == null || indicesBody == null) {
    warnings.push(`Mesh "${block.name}" is missing points or topology — skipped.`);
    return null;
  }
  if (budgets) {
    // Count before parsing: a huge mesh is refused in milliseconds instead of
    // after seconds of parsing and a gigabyte of arrays.
    budgets.points += countChar(pointsBody, '(');
    if (budgets.points > MAX_POINTS) throw new Error(`File has more than ${MAX_POINTS} points`);
    budgets.indices += countChar(indicesBody, ',') + 1;
    if (budgets.indices > MAX_INDICES) throw new Error(`File has more than ${MAX_INDICES} face vertex indices`);
  }
  const points = parseTuples(pointsBody), counts = parseInts(countsBody), indices = parseInts(indicesBody);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const validPoints = points.every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite));
  const validCounts = counts.every(count => Number.isInteger(count) && count >= 3);
  const validIndices = indices.every(index => Number.isInteger(index) && index >= 0 && index < points.length);
  if (!validPoints || !validCounts || total !== indices.length || !validIndices) {
    warnings.push(`Mesh "${displayName}" has invalid topology, skipped.`);
    return null;
  }
  return makeObject(displayName, 'mesh', pos, rot, scl, color, !invisible,
    { points, faceVertexCounts: counts, faceVertexIndices: indices });
}

/** Depth-first walk over an object tree. fn(obj, parent, depth). */
export function walkObjects(objects, fn, parent = null, depth = 0) {
  for (const o of objects) {
    fn(o, parent, depth);
    if (o.children && o.children.length) walkObjects(o.children, fn, o, depth + 1);
  }
}

/** Count every object in a tree. */
export function countObjects(objects) {
  let n = 0;
  walkObjects(objects, () => n++);
  return n;
}
