// usd.js — .usda text export/import for Ptah.
// Pure functions, no DOM or Three.js dependency, so it runs under Node for tests.
//
// Conventions:
//   * 1 scene unit = 1 cm (metersPerUnit 0.01), Y up. Unreal and Unity both
//     convert on import.
//   * Every object is an Xform carrying translate / rotateXYZ / scale, with a
//     child Mesh holding baked unit-size primitive geometry. Object dimensions
//     live entirely in the scale op, so bounding box == scale for primitives.
//   * customData "ptah:type" tags the primitive so re-import is lossless.
//     Files without the tag still import: gprims (Cube/Sphere/Cylinder) map to
//     primitives, unknown Meshes import as generic meshes.

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

function facesToMesh(points, faces) {
  const faceVertexCounts = faces.map(f => f.length);
  const faceVertexIndices = faces.flat();
  return { points, faceVertexCounts, faceVertexIndices, doubleSided: false };
}

export const PRIMITIVE_GEOMETRY = {
  cube: cubeGeometry,
  cylinder: cylinderGeometry,
  sphere: sphereGeometry,
  plane: planeGeometry
};

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

/**
 * objects: [{ name, type, position:{x,y,z}, rotation:{x,y,z} (deg),
 *             scale:{x,y,z}, color:[r,g,b] 0..1, visible, meshData? }]
 * meshData (generic imports): { points, faceVertexCounts, faceVertexIndices }
 */
export function exportUsda(objects, opts = {}) {
  const lines = [];
  lines.push('#usda 1.0');
  lines.push('(');
  lines.push('    defaultPrim = "Root"');
  lines.push('    metersPerUnit = 0.01');
  lines.push('    upAxis = "Y"');
  lines.push(`    doc = "Generated by Ptah blockout editor${opts.appVersion ? ' v' + opts.appVersion : ''}"`);
  lines.push(')');
  lines.push('');
  lines.push('def Xform "Root"');
  lines.push('{');

  const taken = new Set();
  for (const obj of objects) {
    const id = sanitizeIdentifier(obj.name, taken);
    const geo = obj.meshData || (PRIMITIVE_GEOMETRY[obj.type] ? PRIMITIVE_GEOMETRY[obj.type]() : null);
    if (!geo) continue;

    const meta = [`string "ptah:type" = "${obj.meshData ? 'mesh' : obj.type}"`];
    if (obj.name !== id) meta.push(`string "ptah:name" = "${String(obj.name).replace(/"/g, "'")}"`);

    lines.push(`    def Xform "${id}" (`);
    lines.push('        customData = {');
    for (const m of meta) lines.push(`            ${m}`);
    lines.push('        }');
    lines.push('    )');
    lines.push('    {');
    if (obj.visible === false) lines.push('        token visibility = "invisible"');
    lines.push(`        double3 xformOp:translate = ${vec3([obj.position.x, obj.position.y, obj.position.z])}`);
    lines.push(`        float3 xformOp:rotateXYZ = ${vec3([obj.rotation.x, obj.rotation.y, obj.rotation.z])}`);
    lines.push(`        float3 xformOp:scale = ${vec3([obj.scale.x, obj.scale.y, obj.scale.z])}`);
    lines.push('        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ", "xformOp:scale"]');
    lines.push('');
    lines.push('        def Mesh "Geom"');
    lines.push('        {');
    lines.push(`            point3f[] points = [${geo.points.map(vec3).join(', ')}]`);
    lines.push(`            int[] faceVertexCounts = [${geo.faceVertexCounts.join(', ')}]`);
    lines.push(`            int[] faceVertexIndices = [${geo.faceVertexIndices.join(', ')}]`);
    if (geo.doubleSided) lines.push('            uniform bool doubleSided = 1');
    lines.push('            uniform token subdivisionScheme = "none"');
    if (obj.color) {
      lines.push(`            color3f[] primvars:displayColor = [${vec3(obj.color)}]`);
    }
    lines.push('        }');
    lines.push('    }');
    lines.push('');
  }

  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Import — a tolerant reader for the .usda subset Ptah writes, plus basic
// gprims (Cube / Sphere / Cylinder) and plain Meshes from other tools.
// Limitation (documented): nested Xform hierarchies are flattened using
// translation only when parents carry rotation/scale we can't safely compose.
// ---------------------------------------------------------------------------

export function importUsda(text) {
  const warnings = [];
  if (!/^#usda/.test(text.trim())) {
    warnings.push('File does not start with "#usda" — attempting to parse anyway.');
  }
  const src = stripComments(text);
  const blocks = parseBlocks(src, warnings);
  const objects = [];
  for (const b of blocks) collectObjects(b, objects, warnings, { x: 0, y: 0, z: 0 }, false);
  if (objects.length === 0) warnings.push('No importable geometry found in file.');
  return { objects, warnings };
}

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/^#(?!usda)[^\n]*$/gm, '');
}

// Parse `def Type "Name" (meta) { body }` blocks recursively.
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
  return topLevelOnly(blocks, src);
}

// parseBlocks as written finds all defs including nested (regex scans whole
// string) — keep only blocks not contained in another matched block.
function topLevelOnly(blocks) {
  return blocks; // parseBlocks recursion already re-scans only the body slice;
                 // outer scan skips past each matched block via lastIndex.
}

function skipWs(s, i) { while (i < s.length && /\s/.test(s[i])) i++; return i; }

function matchBracket(s, start, open, close) {
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '"' && s[i - 1] !== '\\') inStr = false; continue; }
    if (c === '"') inStr = true;
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

function readVec3(attrs, name) {
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + String.raw`\s*=\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)`);
  const m = attrs.match(re);
  return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null;
}

function readNumber(attrs, name) {
  const re = new RegExp(String.raw`\b` + name + String.raw`\s*=\s*([-\d.eE+]+)`);
  const m = attrs.match(re);
  return m ? parseFloat(m[1]) : null;
}

function readString(text, name) {
  const re = new RegExp('"?' + name.replace(':', '\\:') + String.raw`"?\s*=\s*"((?:[^"\\]|\\.)*)"`);
  const m = text.match(re);
  return m ? m[1] : null;
}

function readTupleArray(attrs, name) {
  const re = new RegExp(name + String.raw`\s*=\s*\[([\s\S]*?)\]`);
  const m = attrs.match(re);
  if (!m) return null;
  const out = [];
  const tupRe = /\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)/g;
  let t;
  while ((t = tupRe.exec(m[1])) !== null) out.push([parseFloat(t[1]), parseFloat(t[2]), parseFloat(t[3])]);
  return out;
}

function readIntArray(attrs, name) {
  const re = new RegExp(String.raw`\b` + name + String.raw`\s*=\s*\[([\s\S]*?)\]`);
  const m = attrs.match(re);
  if (!m) return null;
  return m[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
}

function readTRS(attrs) {
  const t = readVec3(attrs, 'xformOp:translate') || [0, 0, 0];
  const r = readVec3(attrs, 'xformOp:rotateXYZ') || [0, 0, 0];
  const s = readVec3(attrs, 'xformOp:scale') || [1, 1, 1];
  return { t, r, s };
}

// ---- interpretation ----

function collectObjects(block, out, warnings, parentOffset, parentInvisible) {
  const { type, name, meta, attrsText, children } = block;
  const trs = readTRS(attrsText);
  const invisible = parentInvisible || /visibility\s*=\s*"invisible"/.test(attrsText);
  const ptahType = readString(meta, 'ptah:type');
  const displayName = readString(meta, 'ptah:name') || name;

  const pos = {
    x: trs.t[0] + parentOffset.x,
    y: trs.t[1] + parentOffset.y,
    z: trs.t[2] + parentOffset.z
  };
  const rot = { x: trs.r[0], y: trs.r[1], z: trs.r[2] };
  const scl = { x: trs.s[0], y: trs.s[1], z: trs.s[2] };

  const meshChild = children.find(c => c.type === 'Mesh');

  if (type === 'Xform' && ptahType && ptahType !== 'mesh' && PRIMITIVE_GEOMETRY[ptahType]) {
    out.push(makeObject(displayName, ptahType, pos, rot, scl, colorFrom(meshChild), !invisible, null));
    return;
  }

  if (type === 'Cube' || type === 'Sphere' || type === 'Cylinder') {
    const o = gprimToObject(block, pos, rot, scl, invisible);
    if (o) out.push(o);
    return;
  }

  if (type === 'Mesh') {
    const o = meshToObject(block, displayName, pos, rot, scl, invisible, warnings);
    if (o) out.push(o);
    return;
  }

  if (type === 'Xform' && meshChild) {
    const o = meshToObject(meshChild, displayName, pos, rot, scl, invisible, warnings);
    if (o) out.push(o);
    // fall through: also recurse into any other Xform children
  }

  // Recurse. Only translation composes safely without full matrix math.
  const hasRotOrScale = rot.x || rot.y || rot.z || scl.x !== 1 || scl.y !== 1 || scl.z !== 1;
  if (children.some(c => c.type === 'Xform' || c.type === 'Cube' || c.type === 'Sphere' || c.type === 'Cylinder')) {
    if (hasRotOrScale && type !== 'Prim') {
      warnings.push(`Group "${name}" has rotation/scale — children imported with translation only.`);
    }
    for (const c of children) {
      if (c === meshChild) continue;
      collectObjects(c, out, warnings, pos, invisible);
    }
  }
}

function colorFrom(meshBlock) {
  if (!meshBlock) return null;
  const c = readTupleArray(meshBlock.attrsText, 'primvars:displayColor');
  return c && c.length ? c[0] : null;
}

function makeObject(name, type, position, rotation, scale, color, visible, meshData) {
  return { name, type, position, rotation, scale, color: color || null, visible, meshData };
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
    return makeObject(block.name, 'cylinder', pos, rot,
      { x: scl.x * r * 2, y: scl.y * h, z: scl.z * r * 2 }, color, !invisible, null);
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
