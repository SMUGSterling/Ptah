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

// ---------------------------------------------------------------------------
// Unit-size primitive geometry (shared with the viewport builders)
// ---------------------------------------------------------------------------

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

const METRIC_KEYS = ['playerHeight', 'eyeHeight', 'crouchHeight', 'stepHeight', 'walkSpeed', 'runSpeed',
  'jumpHeight', 'jumpDistance', 'halfCover', 'fullCover', 'doorHeight', 'doorWidth', 'corridorWidth'];

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
  if (hasRef || hasMetrics) lines.push('    customLayerData = {');
  if (hasMetrics) {
    lines.push('        dictionary "ptah:metrics" = {');
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
  if (hasRef || hasMetrics) lines.push('    }');
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
  if (!/^#usda/.test(text.trim())) {
    warnings.push('File does not start with "#usda" — attempting to parse anyway.');
  }
  const src = stripComments(text);
  const reference = readReference(src);
  const metrics = readMetrics(src);
  const blocks = parseBlocks(src, warnings);
  let objects = [];
  for (const b of blocks) {
    const o = toObject(b, warnings);
    if (o) objects.push(o);
    else if (b.children.length) objects.push(...childObjects(b, warnings));
  }
  // Our own files wrap everything in an untyped root Xform "Root"; unwrap it.
  if (objects.length === 1 && objects[0].type === 'group' && objects[0].name === 'Root'
      && isIdentity(objects[0])) {
    objects = objects[0].children;
  }
  if (objects.length === 0) warnings.push('No importable geometry found in file.');
  return { objects, warnings, reference, metrics };
}

function isIdentity(o) {
  const p = o.position, r = o.rotation, s = o.scale;
  return !p.x && !p.y && !p.z && !r.x && !r.y && !r.z && s.x === 1 && s.y === 1 && s.z === 1;
}

// Stage-level customLayerData dictionaries: { dictionary "ptah:xxx" = { ... } }
function readLayerDict(src, key) {
  const head = src.match(/^#usda[^\n]*\n\s*\(([\s\S]*?)\n\)/);
  if (!head) return null;
  const m = head[1].match(new RegExp('"' + escRe(key) + String.raw`"\s*=\s*\{([\s\S]*?)\n\s*\}`));
  return m ? m[1] : null;
}

/** { playerHeight, eyeHeight, ... } or null when the file has no profile (v0.1/v0.2 files). */
function readMetrics(src) {
  const body = readLayerDict(src, 'ptah:metrics');
  if (body == null) return null;
  const out = {};
  for (const k of METRIC_KEYS) {
    const v = readNumber(body, k);
    if (v != null) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
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

// Remove /* */ and // comments and non-#usda # lines, but never touch the
// inside of a string literal (data URLs in customLayerData contain "//").
function stripComments(s) {
  let out = '', i = 0, lineStart = true;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '"') {                          // copy string literal verbatim
      let j = i + 1;
      while (j < n && s[j] !== '"') { if (s[j] === '\\') j++; j++; }
      out += s.slice(i, j + 1); i = j + 1; lineStart = false; continue;
    }
    if (c === '@') {                          // asset path: @...@ may contain //
      const j = s.indexOf('@', i + 1);
      const end = j < 0 ? n : j + 1;
      out += s.slice(i, end); i = end; lineStart = false; continue;
    }
    if (c === '/' && s[i + 1] === '*') {      // block comment
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2; continue;
    }
    if (c === '/' && s[i + 1] === '/') {      // line comment
      const end = s.indexOf('\n', i);
      i = end < 0 ? n : end; continue;
    }
    if (c === '#' && lineStart && s.slice(i, i + 5) !== '#usda') {
      const end = s.indexOf('\n', i);
      i = end < 0 ? n : end; continue;
    }
    out += c;
    if (c === '\n') lineStart = true;
    else if (!/\s/.test(c)) lineStart = false;
    i++;
  }
  return out;
}

// Parse `def Type "Name" (meta) { body }` blocks. The outer scan skips past
// each matched block via lastIndex, so only siblings are collected at each
// level; children come from recursing into the body slice.
function parseBlocks(src, warnings) {
  const blocks = [];
  const re = /def\s+(?:([A-Za-z_][A-Za-z0-9_]*)\s+)?"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const type = m[1] || 'Prim';
    const name = m[2];
    let i = re.lastIndex;
    // optional (metadata)
    let meta = '';
    i = skipWs(src, i);
    if (src[i] === '(') {
      const end = matchBracket(src, i, '(', ')');
      if (end < 0) { warnings.push(`Unbalanced metadata in "${name}".`); break; }
      meta = src.slice(i + 1, end);
      i = skipWs(src, end + 1);
    }
    if (src[i] !== '{') { continue; }
    const end = matchBracket(src, i, '{', '}');
    if (end < 0) { warnings.push(`Unbalanced body in "${name}".`); break; }
    const body = src.slice(i + 1, end);
    const children = parseBlocks(body, warnings);
    blocks.push({ type, name, meta, body, attrsText: removeChildBlocks(body), children });
    re.lastIndex = end + 1;
  }
  return blocks;
}

function skipWs(s, i) { while (i < s.length && /\s/.test(s[i])) i++; return i; }

function matchBracket(s, start, open, close) {
  let depth = 0, inStr = false, esc = false, inAsset = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (inAsset) { if (c === '@') inAsset = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '@') inAsset = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function removeChildBlocks(body) {
  let out = '', i = 0;
  const headRe = /def\s+(?:[A-Za-z_][A-Za-z0-9_]*\s+)?"(?:[^"\\]|\\.)*"/g;
  while (i < body.length) {
    headRe.lastIndex = i;
    const m = headRe.exec(body);
    if (!m) { out += body.slice(i); break; }
    out += body.slice(i, m.index);
    let j = skipWs(body, headRe.lastIndex);
    if (body[j] === '(') {                       // metadata block — may contain braces
      const pe = matchBracket(body, j, '(', ')');
      if (pe < 0) break;
      j = skipWs(body, pe + 1);
    }
    if (body[j] !== '{') { i = headRe.lastIndex; continue; }
    const end = matchBracket(body, j, '{', '}');
    if (end < 0) break;
    i = end + 1;
  }
  return out;
}

// ---- attribute readers ----

const escRe = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readVec3(attrs, name) {
  const re = new RegExp(escRe(name) + String.raw`"?\s*=\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)`);
  const m = attrs.match(re);
  return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null;
}

function readNumber(attrs, name) {
  const re = new RegExp(String.raw`(?:^|[\s"])` + escRe(name) + String.raw`"?\s*=\s*([-\d.eE+]+)`, 'm');
  const m = attrs.match(re);
  return m ? parseFloat(m[1]) : null;
}

function readString(text, name) {
  const re = new RegExp('"?' + escRe(name) + String.raw`"?\s*=\s*"((?:[^"\\]|\\.)*)"`);
  const m = text.match(re);
  return m ? m[1] : null;
}

function readTupleArray(attrs, name) {
  const re = new RegExp(escRe(name) + String.raw`\s*=\s*\[([\s\S]*?)\]`);
  const m = attrs.match(re);
  if (!m) return null;
  const out = [];
  const tupRe = /\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)/g;
  let t;
  while ((t = tupRe.exec(m[1])) !== null) out.push([parseFloat(t[1]), parseFloat(t[2]), parseFloat(t[3])]);
  return out;
}

function readStringArray(attrs, name) {
  const re = new RegExp(String.raw`\b` + escRe(name) + String.raw`\s*=\s*\[([\s\S]*?)\]`);
  const m = attrs.match(re);
  if (!m) return null;
  const out = [];
  const strRe = /"((?:[^"\\]|\\.)*)"/g;
  let t;
  while ((t = strRe.exec(m[1])) !== null) out.push(unescapeUsdString(t[1]));
  return out;
}

function readIntArray(attrs, name) {
  const re = new RegExp(String.raw`\b` + escRe(name) + String.raw`\s*=\s*\[([\s\S]*?)\]`);
  const m = attrs.match(re);
  if (!m) return null;
  return m[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
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

function readTRS(attrs, warnings, name) {
  const order = (attrs.match(/xformOpOrder\s*=\s*\[([^\]]*)\]/) || [, ''])[1]
    .split(',').map(t => t.trim().replace(/^"|"$/g, '')).filter(Boolean);
  let t = readVec3(attrs, 'xformOp:translate') || [0, 0, 0];
  let s = readVec3(attrs, 'xformOp:scale') || [1, 1, 1];
  let r = [0, 0, 0];
  let approx = false;

  const rotOp = order.find(o => /^xformOp:rotate[XYZ]{3}$/.test(o)) || (readVec3(attrs, 'xformOp:rotateXYZ') ? 'xformOp:rotateXYZ' : null);
  if (rotOp) {
    const ro = rotOp.slice('xformOp:rotate'.length);
    const v = readVec3(attrs, rotOp);
    if (v) r = ro === 'XYZ' ? v : rotateXYZFromMatrix(matrixFromRotateOp(ro, v));
  } else if (order.includes('xformOp:orient') || /xformOp:orient/.test(attrs)) {
    const q = readQuat(attrs, 'xformOp:orient');
    if (q) r = rotateXYZFromMatrix(matrixFromQuat(q[0], q[1], q[2], q[3]));
  } else if (order.includes('xformOp:transform') || /xformOp:transform/.test(attrs)) {
    const m = readMatrix4(attrs, 'xformOp:transform');
    if (m) {
      // USD matrices are row-major with row vectors: rows 0..2 are the basis
      // axes (scaled), row 3 the translation. Column-convention R = basis^T.
      t = [m[3][0], m[3][1], m[3][2]];
      s = [Math.hypot(...m[0].slice(0, 3)), Math.hypot(...m[1].slice(0, 3)), Math.hypot(...m[2].slice(0, 3))];
      const R = [0, 1, 2].map(i => [0, 1, 2].map(j => m[j][i] / (s[j] || 1)));
      r = rotateXYZFromMatrix(R);
    }
  }
  // Single-axis ops (rotateX/Y/Z) are cheap to honor.
  for (const axis of ['X', 'Y', 'Z']) {
    if (rotOp || !order.includes('xformOp:rotate' + axis)) continue;
    const v = readNumber(attrs, 'xformOp:rotate' + axis);
    if (v != null) r['XYZ'.indexOf(axis)] = v;
  }
  const known = /^(!invert!)?xformOp:(translate|scale|rotate[XYZ]{1,3}|orient|transform)$/;
  if (order.some(o => !known.test(o) || o.startsWith('!invert!') || /:pivot$/.test(o))) approx = true;
  if (approx && warnings) warnings.push(`"${name}" uses xform ops Ptah cannot fully reproduce (pivots or inverted ops); transform is approximate.`);
  return { t, r, s };
}

function readQuat(attrs, name) {
  const re = new RegExp(escRe(name) + String.raw`\s*=\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)`);
  const m = attrs.match(re);
  return m ? [1, 2, 3, 4].map(i => parseFloat(m[i])) : null;   // (w, x, y, z) as USD writes it
}

function readMatrix4(attrs, name) {
  const re = new RegExp(escRe(name) + String.raw`\s*=\s*\(\s*((?:\([^)]*\)\s*,?\s*){4})\)`);
  const m = attrs.match(re);
  if (!m) return null;
  const rows = [...m[1].matchAll(/\(([^)]*)\)/g)].map(r => r[1].split(',').map(v => parseFloat(v.trim())));
  return rows.length === 4 && rows.every(r => r.length === 4 && r.every(isFinite)) ? rows : null;
}

// ---- interpretation ----

const isXformChild = (c) => ['Xform', 'Cube', 'Sphere', 'Cylinder', 'Mesh', 'Prim', 'Scope'].includes(c.type);

function childObjects(block, warnings, skip = null) {
  const out = [];
  for (const c of block.children) {
    if (c === skip) continue;
    const o = toObject(c, warnings);
    if (o) out.push(o);
    else if (c.children.length) out.push(...childObjects(c, warnings)); // Scope etc: hoist
  }
  return out;
}

/** Turn a parsed prim block into a Ptah object (with children), or null. */
function toObject(block, warnings) {
  const { type, name, meta, attrsText, children } = block;
  const trs = readTRS(attrsText, warnings, name);
  const invisible = /visibility\s*=\s*"invisible"/.test(attrsText);
  const ptahType = readString(meta, 'ptah:type');
  const rawName = readString(meta, 'ptah:name');
  const displayName = rawName != null ? unescapeUsdString(rawName) : name;
  const uid = readString(meta, 'ptah:id');
  const withMeta = (o) => {
    if (!o) return o;
    if (uid) o.uid = unescapeUsdString(uid);
    const intent = readString(attrsText, 'ptah:intent');
    if (intent && o.type !== 'group' && o.type !== 'note' && o.type !== 'marker') o.intent = unescapeUsdString(intent);
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
      if (ptahType === 'marker') o.marker = unescapeUsdString(readString(attrsText, 'ptah:marker') || 'Spawn');
      o.children = childObjects(block, warnings);
      return withMeta(o);
    }
    if (ptahType !== 'mesh' && PRIMITIVE_GEOMETRY[ptahType]) {
      const o = makeObject(displayName, ptahType, pos, rot, scl, colorFrom(meshChild), !invisible, null);
      if (ptahType === 'stairs') {
        const steps = readNumber(meta, 'ptah:steps');
        if (steps) o.params = { steps: Math.max(1, Math.round(steps)) };
      }
      o.children = childObjects(block, warnings, meshChild);
      return withMeta(o);
    }
    // ptah:type = "mesh" falls through to the generic Xform+Mesh path.
  }

  if (type === 'Cube' || type === 'Sphere' || type === 'Cylinder') {
    const o = gprimToObject(block, pos, rot, scl, invisible);
    if (o) o.children = childObjects(block, warnings);
    return o;
  }

  if (type === 'Mesh') {
    const o = meshToObject(block, displayName, pos, rot, scl, invisible, warnings);
    if (o) o.children = childObjects(block, warnings);
    return o;
  }

  if (type === 'Xform') {
    if (meshChild) {
      // Foreign Xform carrying a mesh: the mesh's own transform is folded away
      // only when it is identity (the common case). Otherwise it becomes a child.
      const mt = readTRS(meshChild.attrsText, null, meshChild.name);
      const meshIsIdentity = !mt.t.some(Boolean) && !mt.r.some(Boolean) && mt.s.every(v => v === 1);
      if (meshIsIdentity) {
        const o = meshToObject(meshChild, displayName, pos, rot, scl, invisible, warnings);
        if (o) o.children = childObjects(block, warnings, meshChild);
        return o ? withMeta(o) : groupFrom(block, displayName, pos, rot, scl, invisible, warnings);
      }
    }
    if (children.some(isXformChild)) {
      return groupFrom(block, displayName, pos, rot, scl, invisible, warnings);
    }
    // Empty Xform from another tool: import as an empty group so the position
    // survives (e.g. spawn points authored as empties).
    return makeGroup(displayName, pos, rot, scl, !invisible, []);
  }

  return null; // Scope, Material, etc: caller hoists their children
}

function groupFrom(block, displayName, pos, rot, scl, invisible, warnings) {
  return makeGroup(displayName, pos, rot, scl, !invisible, childObjects(block, warnings));
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
      scale = axis === 'Z' ? { x: scl.x * r * 2, y: scl.z * h, z: scl.y * r * 2 } : { x: scl.y * h, y: scl.x * r * 2, z: scl.z * r * 2 };
    }
    return makeObject(block.name, 'cylinder', pos, rotation, scale, color, !invisible, null);
  }
  return null;
}

function meshToObject(block, displayName, pos, rot, scl, invisible, warnings) {
  const a = block.attrsText;
  const points = readTupleArray(a, 'points');
  const counts = readIntArray(a, 'faceVertexCounts');
  const indices = readIntArray(a, 'faceVertexIndices');
  const color = (readTupleArray(a, 'primvars:displayColor') || [])[0] || null;
  if (!points || !counts || !indices) {
    warnings.push(`Mesh "${block.name}" is missing points or topology — skipped.`);
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
