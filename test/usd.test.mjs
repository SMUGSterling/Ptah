// Headless checks for renderer/js/usd.js. Run: node test/usd.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  exportUsda, importUsda, IMPORT_TOO_LARGE, MAX_IMPORT_BYTES, MAX_PRIMS, MAX_INDICES, MAX_NESTING, PRIMITIVE_GEOMETRY, primitiveVolume,
  usdString, unescapeUsdString, walkObjects, countObjects,
  matrixFromRotateOp, matrixFromQuat, rotateXYZFromMatrix
} from '../renderer/js/usd.js';
import * as THREE from '../renderer/vendor/three.module.js';
import { METRICS_DEFAULTS, normalizeMetrics, presetSpecs, PRESET_KEYS, INTENTS, MARKERS, PROFILES, profileMetrics, deriveMetrics } from '../renderer/js/metrics.js';
import { faceSnapDelta } from '../renderer/js/snap.js';
import { History } from '../renderer/js/history.js';
import { parseGlb, base64ToArrayBuffer } from '../renderer/js/gltf.js';
import { glbBase64, clips as mannequinClips, height as mannequinHeight } from '../renderer/assets/mannequin.glb.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  pass  ' + msg);
  else { failures++; console.log('  FAIL  ' + msg); }
};
const close = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

// ---------------------------------------------------------------------------
// 1. Geometry: every closed primitive must be a watertight, consistently
//    oriented manifold (each directed edge paired with its reverse exactly
//    once) with positive signed volume matching the analytic value. This is
//    stricter than a centroid check and, unlike one, valid for concave shapes
//    such as stairs. The plane is open: it must face +Y.
// ---------------------------------------------------------------------------
console.log('\n[geometry]');

function analyze(g) {
  const edges = new Map();
  let volume = 0, cursor = 0, badFan = 0;
  for (const count of g.faceVertexCounts) {
    const idx = g.faceVertexIndices.slice(cursor, cursor + count);
    cursor += count;
    for (let i = 0; i < count; i++) {
      const a = idx[i], b = idx[(i + 1) % count];
      edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) || 0) + 1);
    }
    // signed volume via fan triangulation (also what the viewport does)
    const p0 = g.points[idx[0]];
    for (let i = 1; i < count - 1; i++) {
      const p1 = g.points[idx[i]], p2 = g.points[idx[i + 1]];
      volume += (p0[0] * (p1[1] * p2[2] - p1[2] * p2[1])
               - p0[1] * (p1[0] * p2[2] - p1[2] * p2[0])
               + p0[2] * (p1[0] * p2[1] - p1[1] * p2[0])) / 6;
    }
    // convexity of each polygon face (fan triangulation must be valid)
    if (count > 3) {
      const n = newell(idx.map(i => g.points[i]));
      for (let i = 0; i < count; i++) {
        const a = g.points[idx[i]], b = g.points[idx[(i + 1) % count]], c = g.points[idx[(i + 2) % count]];
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], bc = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
        const cr = [ab[1] * bc[2] - ab[2] * bc[1], ab[2] * bc[0] - ab[0] * bc[2], ab[0] * bc[1] - ab[1] * bc[0]];
        if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < -1e-9) badFan++;
      }
    }
  }
  let unpaired = 0, doubled = 0;
  for (const [k, c] of edges) {
    if (c !== 1) doubled++;
    const [a, b] = k.split('>');
    if (edges.get(`${b}>${a}`) !== 1) unpaired++;
  }
  return { volume, unpaired, doubled, badFan, faces: g.faceVertexCounts.length };
}
function newell(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1, z1] = pts[i], [x2, y2, z2] = pts[(i + 1) % pts.length];
    nx += (y1 - y2) * (z1 + z2); ny += (z1 - z2) * (x1 + x2); nz += (x1 - x2) * (y1 + y2);
  }
  return [nx, ny, nz];
}

for (const [name, gen] of Object.entries(PRIMITIVE_GEOMETRY)) {
  const g = gen();
  const r = analyze(g);
  if (name === 'plane') {
    const n = newell(g.faceVertexIndices.slice(0, 3).map(i => g.points[i]));
    ok(n[1] > 0 && g.doubleSided, 'plane: faces +Y and is double-sided');
    continue;
  }
  ok(r.unpaired === 0 && r.doubled === 0, `${name}: watertight, consistently oriented (${r.faces} faces)`);
  ok(r.badFan === 0, `${name}: all polygon faces convex (fan-triangulable)`);
  const expected = primitiveVolume(name);
  if (expected != null) ok(close(r.volume, expected, 1e-6), `${name}: signed volume ${r.volume.toFixed(4)} matches analytic ${expected.toFixed(4)}`);
  else ok(r.volume > 0.4 && r.volume < 4 / 3 * Math.PI * 0.125, `${name}: signed volume ${r.volume.toFixed(4)} positive and below the true sphere`);
}
for (const steps of [1, 3, 12]) {
  const r = analyze(PRIMITIVE_GEOMETRY.stairs({ steps }));
  ok(r.unpaired === 0 && close(r.volume, primitiveVolume('stairs', { steps }), 1e-6),
    `stairs(${steps}): watertight, volume ${r.volume.toFixed(4)}`);
}
{
  const g = PRIMITIVE_GEOMETRY.stairs({ steps: 4 });
  const ys = g.points.map(p => p[1]), zs = g.points.map(p => p[2]);
  ok(close(Math.min(...ys), -0.5) && close(Math.max(...ys), 0.5) && close(Math.min(...zs), -0.5) && close(Math.max(...zs), 0.5),
    'stairs fill the unit box (bounds == scale)');
  const w = PRIMITIVE_GEOMETRY.wedge();
  const highBack = w.points.filter(p => p[1] > 0).every(p => p[2] < 0);
  ok(highBack, 'wedge rises toward -Z (high edge at the back)');
}

// ---------------------------------------------------------------------------
// 2. String escaping
// ---------------------------------------------------------------------------
console.log('\n[strings]');
const nasty = 'Spawn "A"\nsecond line\\path\ttab';
ok(!usdString(nasty).includes('\n') && !/[^\\]"/.test(usdString(nasty)), 'usdString escapes quotes, newlines, backslashes');
ok(unescapeUsdString(usdString(nasty)) === nasty, 'unescape(escape(x)) === x');

{
  // trailing backslash in a string used to break bracket matching for the rest of the file
  const objs = [
    { name: 'A', type: 'note', text: 'Assets live in D:\\Blockouts\\', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: null, visible: true, children: [] },
    { name: 'B\\', type: 'cube', position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: null, visible: true, children: [] },
    { name: 'C', type: 'cube', position: { x: 4, y: 5, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: null, visible: true, children: [] }
  ];
  const r = importUsda(exportUsda(objs));
  ok(r.objects.length === 3 && r.warnings.length === 0, 'strings ending in a backslash do not derail parsing');
  ok(r.objects[0].text === 'Assets live in D:\\Blockouts\\' && r.objects[1].name === 'B\\', 'trailing backslashes round-trip');
}

// ---------------------------------------------------------------------------
// 2b. Rotation convention. USD rotateXYZ applies X first, then Y, then Z
//     (R = Rz*Ry*Rx). three.js expresses that as Euler order 'ZYX', which is
//     what app.js sets on every node. Verify against the vendored three.js.
// ---------------------------------------------------------------------------
console.log('\n[rotation]');
{
  const deg = [10, 20, 30];
  const usd = matrixFromRotateOp('XYZ', deg);
  const three = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(deg[0] * Math.PI / 180, deg[1] * Math.PI / 180, deg[2] * Math.PI / 180, 'ZYX'));
  const t = three.elements; // column-major
  let maxDiff = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) maxDiff = Math.max(maxDiff, Math.abs(usd[r][c] - t[c * 4 + r]));
  ok(maxDiff < 1e-12, `USD rotateXYZ == three.js Euler 'ZYX' (max diff ${maxDiff.toExponential(1)})`);
  const wrong = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(deg[0] * Math.PI / 180, deg[1] * Math.PI / 180, deg[2] * Math.PI / 180, 'XYZ'));
  let diffXYZ = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) diffXYZ = Math.max(diffXYZ, Math.abs(usd[r][c] - wrong.elements[c * 4 + r]));
  ok(diffXYZ > 0.1, `three.js Euler 'XYZ' would be a different rotation (diff ${diffXYZ.toFixed(3)}), so the order matters`);

  const back = rotateXYZFromMatrix(usd);
  ok(back.every((v, i) => close(v, deg[i], 1e-9)), `rotateXYZFromMatrix inverts matrixFromRotateOp (${back.map(v => v.toFixed(6)).join(', ')})`);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg[0] * Math.PI / 180, deg[1] * Math.PI / 180, deg[2] * Math.PI / 180, 'ZYX'));
  const fromQ = rotateXYZFromMatrix(matrixFromQuat(q.w, q.x, q.y, q.z));
  ok(fromQ.every((v, i) => close(v, deg[i], 1e-9)), 'quaternion path agrees');
  const zyx = rotateXYZFromMatrix(matrixFromRotateOp('ZYX', deg));
  const zyxThree = new THREE.Euler(deg[0] * Math.PI / 180, deg[1] * Math.PI / 180, deg[2] * Math.PI / 180, 'XYZ');
  const zyxConv = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromEuler(zyxThree), 'ZYX');
  ok(close(zyx[0], zyxConv.x * 180 / Math.PI, 1e-9) && close(zyx[2], zyxConv.z * 180 / Math.PI, 1e-9), 'foreign rotateZYX converts to our angles exactly as three.js would');

  // import paths: rotateZYX, orient, transform all land on the same angles
  const mk = (body) => `#usda 1.0\ndef Xform "R"\n{\n${body}\n}\n`;
  const a = importUsda(mk(`    float3 xformOp:rotateZYX = (${deg.join(', ')})\n    uniform token[] xformOpOrder = ["xformOp:rotateZYX"]`)).objects[0].rotation;
  const b = importUsda(mk(`    quatf xformOp:orient = (${q.w}, ${q.x}, ${q.y}, ${q.z})\n    uniform token[] xformOpOrder = ["xformOp:orient"]`)).objects[0].rotation;
  const M = new THREE.Matrix4().compose(new THREE.Vector3(5, 6, 7), q, new THREE.Vector3(2, 3, 4));
  const e = M.elements; // column-major; USD wants row-major rows = transposed
  const rows = [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => e[r * 4 + c]));  // element[r*4+c] = column r, row c → USD row r
  const c = importUsda(mk(`    matrix4d xformOp:transform = ( ${rows.map(r => '(' + r.join(', ') + ')').join(', ')} )\n    uniform token[] xformOpOrder = ["xformOp:transform"]`)).objects[0];
  ok(close(a.x, zyxConv.x * 180 / Math.PI, 1e-6) && close(a.y, zyxConv.y * 180 / Math.PI, 1e-6), 'rotateZYX op imports (converted)');
  ok(close(b.x, 10, 1e-6) && close(b.y, 20, 1e-6) && close(b.z, 30, 1e-6), 'orient (quaternion) op imports');
  ok(close(c.rotation.x, 10, 1e-6) && close(c.rotation.y, 20, 1e-6) && close(c.rotation.z, 30, 1e-6), 'transform (matrix) op imports rotation');
  ok(close(c.position.x, 5) && close(c.position.z, 7) && close(c.scale.x, 2) && close(c.scale.z, 4), 'transform (matrix) op imports translation and scale');
  const piv = importUsda(mk(`    double3 xformOp:translate = (1, 2, 3)\n    double3 xformOp:translate:pivot = (5, 0, 0)\n    float3 xformOp:rotateXYZ = (0, 90, 0)\n    uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:translate:pivot", "xformOp:rotateXYZ", "!invert!xformOp:translate:pivot"]`));
  const po = piv.objects[0];
  ok(piv.warnings.length === 0 && close(po.position.x, 6) && close(po.position.y, 2) && close(po.position.z, 8) && close(po.rotation.y, 90), `pivot ops (Maya-style !invert!) compose exactly (${JSON.stringify(po.position)})`);
}

// ---------------------------------------------------------------------------
// 3. Export → import round trip, including hierarchy, notes and stairs
// ---------------------------------------------------------------------------
console.log('\n[round trip]');
const objects = [
  {
    name: 'Wall 01', type: 'cube',
    position: { x: 128, y: 32, z: -64 }, rotation: { x: 0, y: 45, z: 0 }, scale: { x: 256, y: 64, z: 16 },
    color: [0.55, 0.58, 0.63], visible: true, children: []
  },
  {
    name: 'Pillar', type: 'cylinder',
    position: { x: 0, y: 96, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 48, y: 192, z: 48 },
    color: [0.77, 0.54, 0.35], visible: false, children: []
  },
  {
    name: 'Dome', type: 'sphere',
    position: { x: -200, y: 100, z: 50 }, rotation: { x: 10, y: 20, z: 30 }, scale: { x: 100, y: 100, z: 100 },
    color: null, visible: true, children: []
  },
  {
    name: 'Floor', type: 'plane',
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 512, y: 1, z: 512 },
    color: [0.34, 0.37, 0.42], visible: true, children: []
  },
  {
    name: 'Tower', type: 'group',
    position: { x: 300, y: 0, z: 300 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    color: null, visible: true,
    children: [
      {
        name: 'Base', type: 'cube',
        position: { x: 0, y: 32, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 128, y: 64, z: 128 },
        color: [0.5, 0.5, 0.5], visible: true,
        children: [
          {
            name: 'Flag', type: 'note', text: 'Objective "A"\nreach the top',
            position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
            color: [0.85, 0.64, 0.25], visible: true, children: []
          }
        ]
      },
      {
        name: 'Steps', type: 'stairs', params: { steps: 5 },
        position: { x: 100, y: 16, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 64, y: 32, z: 96 },
        color: [0.6, 0.6, 0.6], visible: true, children: []
      },
      {
        name: 'Ramp', type: 'wedge',
        position: { x: -100, y: 16, z: 0 }, rotation: { x: 0, y: 180, z: 0 }, scale: { x: 64, y: 32, z: 128 },
        color: [0.6, 0.6, 0.6], visible: true, children: []
      }
    ]
  }
];

const usda = exportUsda(objects, { appVersion: 'test', reference: { image: 'data:image/png;base64,AAAA', width: 1024, x: 10, z: -20, rotation: 90, opacity: 0.4 } });
ok(usda.startsWith('#usda 1.0'), 'file starts with #usda 1.0');
ok(usda.includes('metersPerUnit = 0.01'), 'declares cm units');
ok(usda.includes('upAxis = "Y"'), 'declares Y-up');
ok(usda.includes('def Xform "Wall_01"'), 'name sanitized to valid identifier');
ok(usda.includes('"ptah:name" = "Wall 01"'), 'original display name preserved');
ok(usda.includes('token visibility = "invisible"'), 'hidden object exported as invisible');
ok(/def Xform "Tower"[\s\S]*?\n        def Xform "Base"[\s\S]*?\n            def Xform "Flag"/.test(usda), 'children nest inside their parent Xform');
ok(usda.includes('"ptah:text" = "Objective \\"A\\"\\nreach the top"'), 'note text escaped in customData');
ok(usda.includes('int "ptah:steps" = 5'), 'stairs step count persisted');
ok(!/def Xform "Tower"[^{]*\{[^}]*def Mesh/.test(usda.split('def Xform "Base"')[0]), 'group Xform carries no Mesh');
ok(usda.includes('"ptah:reference"') && usda.includes('double width = 1024'), 'reference underlay written to customLayerData');

const { objects: back, warnings, reference } = importUsda(usda);
ok(warnings.length === 0, 'no import warnings (' + warnings.join('; ') + ')');
ok(back.length === 5, `5 root objects back (${back.length})`);
ok(countObjects(back) === 9, `9 objects in total (${countObjects(back)})`);

const wall = back.find(o => o.name === 'Wall 01');
ok(!!wall && wall.type === 'cube', 'wall round-trips as cube with display name');
ok(wall && close(wall.position.x, 128) && close(wall.position.z, -64), 'wall position preserved');
ok(wall && close(wall.rotation.y, 45), 'wall rotation preserved');
ok(wall && close(wall.scale.x, 256) && close(wall.scale.z, 16), 'wall scale preserved');
ok(wall && close(wall.color[0], 0.55), 'wall displayColor preserved');
ok(back.find(o => o.name === 'Pillar')?.visible === false, 'pillar visibility=false preserved');
ok(back.find(o => o.name === 'Dome')?.color === null, 'absent color imports as null');

const tower = back.find(o => o.name === 'Tower');
ok(tower && tower.type === 'group' && close(tower.rotation.y, 90), 'group round-trips with its own transform');
ok(tower && tower.children.length === 3, `group has 3 children (${tower && tower.children.length})`);
const base = tower && tower.children.find(o => o.name === 'Base');
ok(base && base.type === 'cube' && close(base.position.y, 32) && close(base.position.x, 0), 'child keeps LOCAL transform (not flattened)');
const flag = base && base.children.find(o => o.name === 'Flag');
ok(flag && flag.type === 'note' && flag.text === 'Objective "A"\nreach the top', 'nested note round-trips with exact text');
ok(flag && flag.color && close(flag.color[0], 0.85), 'note color survives (ptah:color)');
const steps = tower && tower.children.find(o => o.name === 'Steps');
ok(steps && steps.type === 'stairs' && steps.params && steps.params.steps === 5, 'stairs step count round-trips');
const ramp = tower && tower.children.find(o => o.name === 'Ramp');
ok(ramp && ramp.type === 'wedge' && close(ramp.rotation.y, 180), 'wedge round-trips');

ok(reference && reference.image === 'data:image/png;base64,AAAA' && reference.width === 1024
   && reference.x === 10 && reference.z === -20 && reference.rotation === 90 && close(reference.opacity, 0.4),
   'reference underlay round-trips');
ok(importUsda(exportUsda(objects)).reference === null, 'no reference → null');
{
  // base64 routinely contains "//" and strings may contain "#": neither is a comment
  const tricky = exportUsda([{ ...objects[0], name: 'Wall // #7 "A"' }], { reference: { image: 'data:image/jpeg;base64,AAA//BBB#CCC//', width: 256 } });
  const t = importUsda(tricky);
  ok(t.reference && t.reference.image === 'data:image/jpeg;base64,AAA//BBB#CCC//', 'comment stripping leaves string contents alone');
  ok(t.objects[0] && t.objects[0].name === 'Wall // #7 "A"', 'names with // and # survive');
  const commented = '#usda 1.0\n// header comment\n/* block\n comment */\ndef Xform "A" // trailing\n{\n    # hash comment\n    double3 xformOp:translate = (1, 2, 3)\n}\n';
  const c = importUsda(commented);
  ok(c.objects.length === 1 && c.objects[0].position.y === 2, 'real comments are stripped');
}

// second generation must be byte-identical (stable identifiers, no drift)
ok(exportUsda(back, { appVersion: 'test', reference }) === usda, 'export(import(x)) is byte-identical');

// ---------------------------------------------------------------------------
// 4. Foreign files: gprims, raw meshes, nested Xforms, empties
// ---------------------------------------------------------------------------
console.log('\n[foreign usda]');
const foreign = `#usda 1.0
(
    upAxis = "Y"
)

def Xform "Level"
{
    double3 xformOp:translate = (100, 0, 0)
    float3 xformOp:rotateXYZ = (0, 90, 0)
    uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ"]

    def Cube "Crate"
    {
        double size = 2
        float3 xformOp:scale = (32, 32, 32)
        uniform token[] xformOpOrder = ["xformOp:scale"]
        color3f[] primvars:displayColor = [(0.8, 0.2, 0.2)]
    }

    def Sphere "Ball"
    {
        double radius = 50
        double3 xformOp:translate = (0, 50, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }

    def Cylinder "Column"
    {
        double radius = 24
        double height = 300
    }

    def Xform "SpawnPoint"
    {
        double3 xformOp:translate = (5, 0, 5)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }

    def Scope "Looks"
    {
        def Material "Grey"
        {
        }
    }
}

def Mesh "Ramp"
{
    point3f[] points = [(0,0,0), (100,0,0), (100,50,0), (0,0,100)]
    int[] faceVertexCounts = [3, 3]
    int[] faceVertexIndices = [0, 1, 2, 0, 2, 3]
}

def Xform "Prop" (
    kind = "component"
)
{
    double3 xformOp:translate = (0, 10, 0)
    uniform token[] xformOpOrder = ["xformOp:translate"]

    def Mesh "Prop"
    {
        point3f[] points = [(0,0,0), (10,0,0), (0,10,0)]
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
    }
}
`;
const f = importUsda(foreign);
ok(f.objects.length === 3, `3 root objects (${f.objects.length}): ${f.objects.map(o => o.name).join(', ')}`);
const level = f.objects.find(o => o.name === 'Level');
ok(level && level.type === 'group' && close(level.rotation.y, 90) && close(level.position.x, 100), 'Xform with children imports as a group keeping rotation (no more flattening)');
ok(level && level.children.length === 4, `group keeps 4 children (${level && level.children.length}); Scope/Material skipped`);
const crate = level && level.children.find(o => o.name === 'Crate');
ok(crate && crate.type === 'cube' && close(crate.scale.x, 64), 'Cube gprim: size*scale folded into dimensions');
ok(crate && close(crate.position.x, 0), 'child position stays local to its parent');
const ball = level && level.children.find(o => o.name === 'Ball');
ok(ball && ball.type === 'sphere' && close(ball.scale.x, 100) && close(ball.position.y, 50), 'Sphere gprim: radius→diameter');
const col = level && level.children.find(o => o.name === 'Column');
ok(col && col.type === 'cylinder' && close(col.scale.y, 300) && close(col.scale.x, 48), 'Cylinder gprim: radius/height mapped');
ok(col && close(col.rotation.x, 90), 'Cylinder gprim defaults to the Z axis: imported standing along Z (rotated 90° about X)');
{
  const yCyl = importUsda('#usda 1.0\ndef Cylinder "C"\n{\n    token axis = "Y"\n    double radius = 10\n    double height = 50\n}\n').objects[0];
  ok(yCyl && close(yCyl.rotation.x, 0) && close(yCyl.scale.y, 50), 'Cylinder with axis = "Y" needs no rotation');
  const asset = importUsda('#usda 1.0\ndef Xform "P" (\n    references = @//nas/share/level.usd@\n)\n{\n    double3 xformOp:translate = (1, 2, 3)\n    uniform token[] xformOpOrder = ["xformOp:translate"]\n}\n');
  ok(asset.objects.length === 1 && close(asset.objects[0].position.y, 2), 'asset paths containing // are not treated as comments');
}
const spawn = level && level.children.find(o => o.name === 'SpawnPoint');
ok(spawn && spawn.type === 'group' && close(spawn.position.x, 5), 'empty Xform imports as an empty group (position kept)');
const rampF = f.objects.find(o => o.name === 'Ramp');
ok(rampF && rampF.type === 'mesh' && rampF.meshData.points.length === 4, 'raw Mesh imported as generic mesh');
const prop = f.objects.find(o => o.name === 'Prop');
ok(prop && prop.type === 'mesh' && close(prop.position.y, 10) && prop.children.length === 0, 'Xform + identity Mesh folds into one mesh object');

const usda2 = exportUsda(f.objects);
const back2 = importUsda(usda2);
ok(countObjects(back2.objects) === countObjects(f.objects), 'foreign objects re-export and re-import with same count');
const ramp2 = back2.objects.find(o => o.name === 'Ramp');
ok(ramp2 && ramp2.meshData && ramp2.meshData.faceVertexIndices.length === 6, 'generic mesh topology survives round trip');
{
  const badIndex = importUsda('#usda 1.0\ndef Mesh "BadIndex"\n{\n    point3f[] points = [(0,0,0), (1,0,0), (0,1,0)]\n    int[] faceVertexCounts = [3]\n    int[] faceVertexIndices = [0, 1, 3]\n}\n');
  ok(badIndex.objects.length === 0 && badIndex.warnings.includes('Mesh "BadIndex" has invalid topology, skipped.'), 'mesh index >= points.length is skipped with a warning');
  const negativeIndex = importUsda('#usda 1.0\ndef Mesh "NegativeIndex"\n{\n    point3f[] points = [(0,0,0), (1,0,0), (0,1,0)]\n    int[] faceVertexCounts = [3]\n    int[] faceVertexIndices = [0, 1, -1]\n}\n');
  ok(negativeIndex.objects.length === 0 && negativeIndex.warnings.includes('Mesh "NegativeIndex" has invalid topology, skipped.'), 'mesh negative index is skipped with a warning');
  const mismatchedCounts = importUsda('#usda 1.0\ndef Mesh "MismatchedCounts"\n{\n    point3f[] points = [(0,0,0), (1,0,0), (1,1,0), (0,1,0)]\n    int[] faceVertexCounts = [4]\n    int[] faceVertexIndices = [0, 1, 2]\n}\n');
  ok(mismatchedCounts.objects.length === 0 && mismatchedCounts.warnings.includes('Mesh "MismatchedCounts" has invalid topology, skipped.'), 'mesh count/index length mismatch is skipped with a warning');
  const shortFace = importUsda('#usda 1.0\ndef Mesh "ShortFace"\n{\n    point3f[] points = [(0,0,0), (1,0,0), (0,1,0)]\n    int[] faceVertexCounts = [2]\n    int[] faceVertexIndices = [0, 1]\n}\n');
  ok(shortFace.objects.length === 0 && shortFace.warnings.includes('Mesh "ShortFace" has invalid topology, skipped.'), 'mesh face count below 3 is skipped with a warning');
  const emptyFaces = importUsda('#usda 1.0\ndef Mesh "EmptyFaces"\n{\n    point3f[] points = [(0,0,0), (1,0,0), (0,1,0)]\n    int[] faceVertexCounts = []\n    int[] faceVertexIndices = []\n}\n');
  ok(emptyFaces.objects[0] && emptyFaces.objects[0].meshData.faceVertexCounts.length === 0, 'empty faceVertexCounts stays empty instead of parsing a 0');
  const trailingComma = importUsda('#usda 1.0\ndef Mesh "TrailingComma"\n{\n    point3f[] points = [(0,0,0), (1,0,0), (0,1,0)]\n    int[] faceVertexCounts = [3,]\n    int[] faceVertexIndices = [0, 1, 2,]\n}\n');
  ok(trailingComma.objects[0] && trailingComma.objects[0].meshData.faceVertexCounts.length === 1 && trailingComma.objects[0].meshData.faceVertexIndices.length === 3,
    'trailing commas in int arrays do not add a spurious 0');
}

// ---------------------------------------------------------------------------
// 5. Garbage handling
// ---------------------------------------------------------------------------
console.log('\n[robustness]');
const junk = importUsda('this is not a usd file at all { ] (');
ok(junk.objects.length === 0 && junk.warnings.length > 0, 'garbage input yields warnings, no crash');
const empty = importUsda('#usda 1.0\n');
ok(empty.objects.length === 0, 'empty stage imports cleanly');
const deep = { name: 'a', type: 'group', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, children: [] };
let cur = deep;
for (let i = 0; i < 30; i++) { const n = { ...deep, name: 'g' + i, children: [] }; cur.children.push(n); cur = n; }
ok(countObjects(importUsda(exportUsda([deep])).objects) === 31, '30-deep hierarchy round-trips');
{
  let nested = '#usda 1.0\n';
  for (let i = 0; i < 65; i++) nested += `${'    '.repeat(i)}def Xform "Level_${i}"\n${'    '.repeat(i)}{\n`;
  for (let i = 64; i >= 0; i--) nested += `${'    '.repeat(i)}}\n`;
  let depthErr = null;
  try { importUsda(nested); } catch (err) { depthErr = err; }
  ok(depthErr && depthErr.message === 'File nests prims more than 64 levels deep', '65-deep hierarchy throws the depth limit error');
}
{
  let many = '#usda 1.0\ndef Xform "Root"\n{\n';
  for (let i = 0; i < MAX_PRIMS; i++) many += `    def Xform "Prim_${i}"\n    {\n    }\n`;
  many += '}\n';
  let primErr = null;
  try { importUsda(many); } catch (err) { primErr = err; }
  ok(primErr && primErr.message === `File has more than ${MAX_PRIMS} prims`, `${MAX_PRIMS + 1} prims throw the prim-count limit error`);
}
let walked = 0; walkObjects(back, () => walked++);
ok(walked === 9, 'walkObjects visits every node');

// ---------------------------------------------------------------------------
// 5b. v0.3 format: intent, markers, tags, persistent ids, metrics profile.
// ---------------------------------------------------------------------------
console.log('\n[intent / markers / metrics]');
{
  const o = (name, type, extra = {}) => ({
    name, type, position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 64, y: 110, z: 32 },
    color: [0.85, 0.51, 0.18], visible: true, children: [], ...extra
  });
  const objs = [
    o('Cover_01', 'cube', { intent: 'cover', uid: 'deadbeef', tags: ['lane-a', 'he said "go"'] }),
    o('PlayerStart_01', 'marker', { marker: 'PlayerStart', scale: { x: 1, y: 1, z: 1 }, tags: ['team:blue'] }),
    o('Trigger_01', 'marker', { marker: 'Trigger', scale: { x: 256, y: 192, z: 256 } }),
    o('Plain_01', 'cube', {})
  ];
  const metrics = { ...METRICS_DEFAULTS, eyeHeight: 150.5, jumpHeight: 90, profile: 'custom' };
  const text = exportUsda(objs, { metrics });
  ok(/custom string ptah:intent = "cover"/.test(text), 'intent exported as a custom attribute on the Xform');
  ok(/string "ptah:id" = "deadbeef"/.test(text), 'persistent id exported in customData');
  ok(/custom string ptah:marker = "PlayerStart"/.test(text), 'marker type exported as a custom attribute');
  ok(/custom string\[\] ptah:tags = \["lane-a", "he said \\"go\\""\]/.test(text), 'tags exported as an escaped string array');
  ok(!/def Mesh/.test(text.split('def Xform "PlayerStart_01"')[1].split('def Xform "Trigger_01"')[0]), 'markers carry no Mesh');
  ok(/dictionary "ptah:metrics"/.test(text) && /double eyeHeight = 150.5/.test(text), 'metrics profile written to customLayerData');
  ok((text.match(/ptah:intent/g) || []).length === 1, 'objects without intent write no intent attribute');

  const back = importUsda(text);
  ok(back.warnings.length === 0, 'v0.3 file imports without warnings');
  const cover = back.objects.find(x => x.name === 'Cover_01');
  ok(cover && cover.intent === 'cover' && cover.uid === 'deadbeef', 'intent and id round-trip');
  ok(cover && cover.tags && cover.tags.length === 2 && cover.tags[1] === 'he said "go"', 'tags round-trip with escapes');
  const ps = back.objects.find(x => x.name === 'PlayerStart_01');
  ok(ps && ps.type === 'marker' && ps.marker === 'PlayerStart' && ps.tags[0] === 'team:blue', 'PlayerStart marker round-trips');
  ok(ps && close(ps.rotation.y, 90) && ps.color && close(ps.color[0], 0.85), 'marker keeps facing and color');
  const tr = back.objects.find(x => x.name === 'Trigger_01');
  ok(tr && tr.marker === 'Trigger' && tr.scale.x === 256 && tr.scale.y === 192, 'trigger volume size survives in the scale op');
  ok(back.objects.find(x => x.name === 'Plain_01').intent === undefined, 'no intent stays absent');
  ok(back.metrics && back.metrics.eyeHeight === 150.5 && back.metrics.jumpHeight === 90 && back.metrics.playerHeight === 192 && back.metrics.capsuleRadius === 42, 'metrics profile round-trips');
  ok(back.metrics.profile === 'custom' && /string profile = "custom"/.test(text), 'profile key round-trips as a string');
  ok(exportUsda(back.objects, { metrics: back.metrics }) === text, 'v0.3 re-export is byte-identical');

  // v0.2 files carry no metrics or intent and still load
  const legacy = importUsda(exportUsda([o('Old_01', 'cube')]));
  ok(legacy.metrics === null && legacy.objects[0].intent === undefined, 'files without a profile import with metrics = null');
  // a marker with no attribute (hand-edited) falls back to Spawn
  const noAttr = exportUsda([o('M', 'marker', { marker: 'Cover' })]).replace(/\s*custom string ptah:marker = "Cover"/, '');
  ok(importUsda(noAttr).objects[0].marker === 'Spawn', 'marker without ptah:marker attribute defaults to Spawn');
  // an intent attribute on a group is ignored (groups have no color)
  ok(MARKERS.length === 5 && INTENTS.length === 8, 'five marker kinds, eight intents');
  const protoBefore = Object.getPrototypeOf({});
  const polluted = importUsda(`#usda 1.0
def Xform "Marker" (
    customData = {
        string "ptah:type" = "marker"
    }
)
{
    custom string ptah:marker = "constructor"
}
def Xform "Cube" (
    customData = {
        string "ptah:type" = "cube"
    }
)
{
    custom string ptah:intent = "__proto__"
    def Mesh "Geom"
    {
        point3f[] points = [(-0.5, -0.5, -0.5), (0.5, -0.5, -0.5), (0.5, -0.5, 0.5), (-0.5, -0.5, 0.5), (-0.5, 0.5, -0.5), (0.5, 0.5, -0.5), (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5)]
        int[] faceVertexCounts = [4, 4, 4, 4, 4, 4]
        int[] faceVertexIndices = [0, 1, 2, 3, 7, 6, 5, 4, 4, 5, 1, 0, 6, 7, 3, 2, 5, 6, 2, 1, 7, 4, 0, 3]
        uniform token subdivisionScheme = "none"
    }
}
`);
  ok(polluted.warnings.length === 0, 'prototype-pollution USDA imports without warnings');
  ok(polluted.objects.find(o => o.name === 'Marker')?.marker === 'Spawn', 'marker lookup falls back to Spawn for "constructor"');
  ok(polluted.objects.find(o => o.name === 'Cube')?.intent === undefined, 'intent lookup drops "__proto__"');
  ok(Object.getPrototypeOf({}) === protoBefore && Object.prototype.__proto__ === null, 'Object.prototype is unchanged by file-supplied lookup keys');
}

// ---------------------------------------------------------------------------
// 5c. Metrics profile and presets: sizes track the profile.
// ---------------------------------------------------------------------------
console.log('\n[metrics / presets]');
{
  const n = normalizeMetrics({ playerHeight: 200, eyeHeight: -5, stepHeight: 'x' });
  ok(n.playerHeight === 200 && n.eyeHeight === 1 && n.stepHeight === METRICS_DEFAULTS.stepHeight, 'normalize clamps and fills defaults');
  ok(Object.keys(normalizeMetrics(null)).length === Object.keys(METRICS_DEFAULTS).length && normalizeMetrics(null).profile === 'ue-third', 'normalize(null) is the default profile (UE Third Person)');
  ok(normalizeMetrics({ playerHeight: 180 }).profile === 'custom' && normalizeMetrics({ profile: 'unity-first' }).profile === 'unity-first' && normalizeMetrics({ profile: 'bogus' }).profile === 'custom', 'profile key: known keeps, unknown or edited becomes custom');
  const edited = normalizeMetrics({ ...METRICS_DEFAULTS, profile: 'custom', base: 'unity-third', jumpHeight: 150 });
  ok(edited.base === 'unity-third' && normalizeMetrics({ ...edited, profile: 'ue-first' }).base === undefined && normalizeMetrics({ profile: 'custom', base: 'bogus' }).base === undefined, 'a Custom profile keeps the template it started from; a real profile or unknown base has none');
  const rt = importUsda(exportUsda([], { metrics: edited })).metrics;
  ok(rt && rt.profile === 'custom' && rt.base === 'unity-third', 'the Custom profile\'s base template round-trips through ptah:metrics');
  const imported = importUsda(`#usda 1.0
(
    customLayerData = {
        dictionary "ptah:metrics" = {
            string profile = "<img src=x onerror=alert(1)>"
            double eyeHeight = 150
        }
    }
)
`);
  ok(imported.metrics && imported.metrics.profile === '<img src=x onerror=alert(1)>' && normalizeMetrics(imported.metrics).profile === 'custom',
    'imported ptah:metrics profile only carries a key string; unknown values normalize to custom');
  // engine template profiles and the derivation rules
  ok(PROFILES.length === 4 && PROFILES.map(p => p.key).join() === 'ue-third,ue-first,unity-third,unity-first', 'four engine profiles');
  const ue = profileMetrics('ue-third');
  ok(ue.playerHeight === 192 && ue.capsuleRadius === 42 && ue.eyeHeight === 160 && ue.walkSpeed === 500 && ue.jumpHeight === 143 && ue.stepHeight === 45, 'UE Third Person core numbers (InitCapsuleSize 42/96)');
  ok(profileMetrics('ue-first').capsuleRadius === 55 && profileMetrics('ue-first').playerHeight === 192, 'UE First Person capsule (InitCapsuleSize 55/96)');
  ok(ue.characterHeight === 180 && ue.fov === 90 && profileMetrics('unity-third').characterHeight === 180 && profileMetrics('unity-third').fov === 66, 'visible character height (180) and template FOV (UE 90, Unity 66) are profile numbers');
  ok(normalizeMetrics({ fov: 500 }).fov === 150 && normalizeMetrics({ fov: 5 }).fov === 30, 'fov clamps to 30..150');
  const fovText = exportUsda([], { metrics: { ...METRICS_DEFAULTS, fov: 75, characterHeight: 170 } });
  const fovBack = importUsda(fovText).metrics;
  ok(fovBack.fov === 75 && fovBack.characterHeight === 170, 'fov and characterHeight round-trip');
  ok(ue.doorHeight === 360 && ue.doorWidth === 170 && ue.corridorWidth === 340 && ue.halfCover === 100 && ue.fullCover === 220, 'UE Third Person derived sizes (door clears height + jump + 20)');
  const uf = profileMetrics('unity-first');
  ok(uf.capsuleRadius === 50 && uf.doorWidth === 200 && uf.corridorWidth === 400 && uf.walkSpeed === 400 && uf.runSpeed === 600, 'Unity First Person: 4 × radius door, 2 × door corridor');
  ok(profileMetrics('unity-third').doorWidth === 120, 'door width floors at 120 for the thin Unity TP controller');
  for (const p of PROFILES) {
    const m = profileMetrics(p.key);
    const d = deriveMetrics(m);
    ok(Object.keys(d).every(k => m[k] === d[k]) && m.doorHeight >= m.playerHeight + m.jumpHeight, `${p.key}: derived fields consistent, door clears a jumping player`);
    // each template's gravity: UE default 980, UE Third Person scales it 1.75x, Unity Starter Assets use -15 m/s^2
    const g = p.key === 'ue-third' ? 980 * 1.75 : p.key === 'ue-first' ? 980 : 1500;
    const airTime = 2 * Math.sqrt(2 * m.jumpHeight / g);
    ok(close(m.jumpDistance, Math.round(airTime * m.runSpeed), 1.5), `${p.key}: jump distance = air time × top speed (${Math.round(airTime * m.runSpeed)})`);
  }
  ok(profileMetrics('nope').profile === 'ue-third', 'unknown profile key falls back to UE Third Person');
  const m = { ...METRICS_DEFAULTS, halfCover: 100, fullCover: 200, doorHeight: 220, doorWidth: 100, corridorWidth: 400, stepHeight: 30 };
  const p = presetSpecs(m);
  ok(PRESET_KEYS.every(k => p[k] && p[k].objects.length), 'every preset key produces objects');
  ok(p.halfcover.objects[0].scale.y === 100 && p.fullcover.objects[0].scale.y === 200, 'cover heights follow the profile');
  ok(p.halfcover.objects[0].intent === 'cover', 'cover presets carry the cover intent');
  const lintel = p.doorway.objects.find(x => x.name === 'Lintel');
  const postL = p.doorway.objects.find(x => x.name === 'Post_L');
  const postR = p.doorway.objects.find(x => x.name === 'Post_R');
  ok(close(postR.position.x - postR.scale.x / 2 - (postL.position.x + postL.scale.x / 2), 100), 'doorway opening equals doorWidth');
  ok(close(lintel.position.y - lintel.scale.y / 2, 220), 'lintel underside sits at doorHeight');
  const wl = p.corridor.objects.find(x => x.name === 'Wall_L'), wr = p.corridor.objects.find(x => x.name === 'Wall_R');
  ok(close(wr.position.x - wr.scale.x / 2 - (wl.position.x + wl.scale.x / 2), 400), 'corridor clear width equals corridorWidth');
  const st = p.steprun.objects[0];
  ok(close(st.scale.y / st.params.steps, 30), 'step run riser equals stepHeight');
  for (const k of PRESET_KEYS) {
    const rests = p[k].objects.every(x => close(x.position.y - x.scale.y / 2, 0) || x.name === 'Lintel');
    ok(rests, `preset ${k} rests on the ground`);
  }
}

// ---------------------------------------------------------------------------
// 5d. Face snapping (pure AABB math shared with the editor).
// ---------------------------------------------------------------------------
console.log('\n[face snap]');
{
  const B = (min, max) => ({ min, max });
  const other = B([168, 0, 0], [232, 64, 64]);
  let r = faceSnapDelta(B([100, 0, 0], [164, 64, 64]), [other], 32);
  ok(r.delta[0] === 4 && r.delta[1] === 0 && r.delta[2] === 0, 'butt joint: 4u gap on +X closes');
  ok(r.planes.length === 1 && r.planes[0].axis === 0 && r.planes[0].value === 168, 'one highlight plane at the shared face');
  r = faceSnapDelta(B([240, 0, 0], [304, 64, 64]), [other], 32);
  ok(r.delta[0] === -8, 'butt joint from the other side (moving.min meets other.max)');
  r = faceSnapDelta(B([100, 0, 300], [164, 64, 364]), [other], 32);
  ok(r.delta.every(v => v === 0), 'no snap when the boxes do not overlap on the other axes');
  r = faceSnapDelta(B([100, 0, 0], [164, 64, 64]), [other], 3);
  ok(r.delta[0] === 0, 'gap larger than the threshold does not snap');
  r = faceSnapDelta(B([170, 0, 5], [200, 40, 30]), [other], 32);
  ok(r.delta[0] === -2 && r.delta[2] === -5, 'flush alignment: min faces line up on X and Z');
  r = faceSnapDelta(B([168, 0, 0], [232, 64, 64]), [other], 32);
  ok(r.delta.every(v => v === 0) && r.planes.length === 0, 'already flush faces produce no move and no highlight');
  r = faceSnapDelta(B([100, 0, 0], [164, 64, 64]), [other, B([150, 0, 0], [161, 64, 64])], 32);
  ok(r.delta[0] === -3, 'the nearest candidate wins (flush with the 161 face beats the 168 butt)');
  r = faceSnapDelta(B([0, 70, 0], [64, 134, 64]), [B([0, 0, 0], [64, 64, 64])], 32);
  ok(r.delta[1] === -6, 'stacking: bottom face drops onto the top of the box below');
}

// ---------------------------------------------------------------------------
// 5e. The mannequin: our glTF reader on our own converter's output.
// ---------------------------------------------------------------------------
console.log('\n[mannequin / gltf]');
{
  const warnings = [];
  const origWarn = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  const buf = base64ToArrayBuffer(glbBase64);
  const g = parseGlb(buf);
  console.warn = origWarn;
  ok(g.skinnedMeshes.length === 1 && g.skinnedMeshes[0].skeleton.bones.length === 52, `one skinned mesh with 52 joints (${g.skinnedMeshes[0]?.skeleton.bones.length})`);
  ok(g.nodes.length === 66 && g.nodes.some(n => n.name === 'mixamorig1Hips'), 'skeleton nodes present with sanitised names');
  const mesh = g.skinnedMeshes[0];
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  ok(close(bb.max.y - bb.min.y, mannequinHeight, 0.01) && Math.abs(bb.min.y) < 1, `mesh stands on the ground, ${(bb.max.y - bb.min.y).toFixed(1)} u tall`);
  ok(mesh.geometry.attributes.skinIndex.itemSize === 4 && mesh.geometry.attributes.skinWeight.itemSize === 4, 'four joints per vertex');
  // rest pose == bind pose: every bone matrix is the identity
  g.scene.updateMatrixWorld(true);
  mesh.skeleton.update();
  let worst = 0;
  for (let b = 0; b < mesh.skeleton.bones.length; b++) {
    const m = mesh.skeleton.boneMatrices.subarray(b * 16, b * 16 + 16);
    for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(m[k] - ((k % 5 === 0) ? 1 : 0)));
  }
  ok(worst < 1e-3, `rest pose reproduces the bind pose (max deviation ${worst.toExponential(1)})`);
  ok(g.animations.length === 7 && g.animations.map(c => c.name).join() === mannequinClips.join(), 'seven clips: ' + g.animations.map(c => c.name).join(', '));
  const walking = g.animations.find(c => c.name === 'walking');
  ok(walking && close(walking.duration, 1.03, 0.02) && close(walking.userData.rootSpeed, 160, 5), `walking clip: ${walking.duration.toFixed(2)} s at ${walking.userData.rootSpeed} u/s natural speed`);
  ok(g.animations.find(c => c.name === 'idle').userData.rootSpeed < 1, 'idle has no root travel');
  // hips do not drift horizontally in locomotion clips (root motion stripped)
  const hipsPos = walking.tracks.find(t => t.name === 'mixamorig1Hips.position');
  let drift = 0;
  if (hipsPos) for (let i = 0; i < hipsPos.values.length; i += 3) drift = Math.max(drift, Math.abs(hipsPos.values[i] - hipsPos.values[0]), Math.abs(hipsPos.values[i + 2] - hipsPos.values[2]));
  ok(hipsPos && drift < 1e-3, `walking root motion stripped (max horizontal drift ${drift.toFixed(4)})`);
  // clips bind to the skeleton: playing walking moves bones away from the rest pose, with no unresolved tracks
  const mixer = new THREE.AnimationMixer(g.scene);
  mixer.clipAction(walking).play();
  mixer.update(0.5);
  g.scene.updateMatrixWorld(true);
  mesh.skeleton.update();
  let moved = 0;
  for (let b = 0; b < mesh.skeleton.bones.length; b++) {
    const m = mesh.skeleton.boneMatrices.subarray(b * 16, b * 16 + 16);
    for (let k = 0; k < 16; k++) moved = Math.max(moved, Math.abs(m[k] - ((k % 5 === 0) ? 1 : 0)));
  }
  ok(moved > 1 && warnings.length === 0, `walking animates the skeleton (max change ${moved.toFixed(1)}), ${warnings.length} binding warnings`);
}

console.log('\n[review 2026-09 regressions]');
{
  const cube = (extra = {}) => ({
    name: 'Box', type: 'cube', position: { x: 0, y: 50, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 100, y: 100, z: 100 }, color: [0.2, 0.4, 0.6], visible: true, children: [], ...extra
  });
  // F1: a `]` inside a string element must not end the array.
  const tagged = importUsda(exportUsda([cube({ tags: ['[wip]', 'lane-a', 'a]b"c'] })])).objects[0];
  ok(tagged && JSON.stringify(tagged.tags) === JSON.stringify(['[wip]', 'lane-a', 'a]b"c']), 'tags containing "]" and quotes survive a round trip');

  // F7: text ending in "def" must not be read as a prim head.
  const defTag = importUsda(exportUsda([cube({ tags: ['see def '] })])).objects[0];
  ok(defTag && defTag.type === 'cube' && JSON.stringify(defTag.tags) === '["see def "]', 'a tag ending in "def" does not swallow the next prim');
  ok(defTag && defTag.color && close(defTag.color[2], 0.6), 'cube tagged "see def " keeps its color');
  const tri = { points: [[0, 0, 0], [100, 0, 0], [0, 0, 100]], faceVertexCounts: [3], faceVertexIndices: [0, 1, 2] };
  const mesh = importUsda(exportUsda([{ ...cube({ tags: ['see def '] }), name: 'Tri', type: 'mesh', meshData: tri, scale: { x: 1, y: 1, z: 1 } }])).objects[0];
  ok(mesh && mesh.type === 'mesh' && mesh.meshData && mesh.meshData.points.length === 3, 'mesh tagged "see def " keeps its geometry');
  const pv = importUsda('#usda 1.0\ndef Mesh "M"\n{\n    point3f[] primvars:points = [(9, 9, 9)]\n    point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 0, 1)]\n    int[] faceVertexCounts = [3]\n    int[] faceVertexIndices = [0, 1, 2]\n}\n').objects[0];
  ok(pv && pv.meshData && pv.meshData.points.length === 3 && pv.meshData.points[1][0] === 1, '"points" does not match "primvars:points"');

  // F2: an X-axis cylinder is long along X, not a wide disc.
  const xc = importUsda('#usda 1.0\ndef Cylinder "Rod"\n{\n    uniform token axis = "X"\n    double radius = 1\n    double height = 10\n}\n').objects[0];
  ok(xc && close(xc.scale.y, 10) && close(xc.scale.x, 2) && close(xc.scale.z, 2), 'Cylinder axis = "X": height on local Y, diameter on X/Z');
  const R = matrixFromRotateOp('XYZ', [xc.rotation.x, xc.rotation.y, xc.rotation.z]);
  ok(close(Math.abs(R[0][1]), 1), 'Cylinder axis = "X": local Y (the height) points along world X');

  // F11: huge coordinates never serialize as Infinity.
  const huge = exportUsda([cube({ position: { x: 1e304, y: 0, z: 0 } })]);
  ok(!/Infinity|NaN/.test(huge), 'coordinates near Number.MAX_VALUE do not write Infinity');

  // F10: a UTF-8 BOM keeps stage metadata.
  const withMeta = exportUsda([cube()], { metrics: { ...METRICS_DEFAULTS, profile: 'UE Third Person' }, reference: { image: 'data:image/png;base64,iVBORw0KGgo=', width: 800, x: 0, z: 0, rotation: 0, opacity: 0.5 } });
  const bom = importUsda('﻿' + withMeta);
  ok(bom.metrics && bom.reference && bom.reference.width === 800 && bom.objects.length === 1 && bom.warnings.length === 0, 'BOM-prefixed file keeps metrics and reference');

  // ground size: saved only when set, read back
  const withGround = importUsda(exportUsda([cube()], { ground: 8192 }));
  ok(withGround.ground === 8192 && withGround.objects.length === 1 && withGround.warnings.length === 0, 'ground size round-trips through customLayerData');
  ok(importUsda(exportUsda([cube()], { ground: 8192 }).replace('size = 8192', 'size = 0')).ground === 0, 'an out-of-range ground size is read as written, for the editor to warn about');
  ok(importUsda(exportUsda([cube()])).ground === null && !/ptah:ground/.test(exportUsda([cube()])), 'no ground size written or read when it is not set');

  // T4: the version lives in package.json; app.js and the sample must agree.
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  const appVersion = (fs.readFileSync(path.join(repoRoot, 'renderer/js/app.js'), 'utf8').match(/const APP_VERSION = '([^']+)'/) || [])[1];
  const sampleVersion = (fs.readFileSync(path.join(here, 'sample.usda'), 'utf8').match(/editor v([\d.]+)/) || [])[1];
  ok(appVersion === pkgVersion, `APP_VERSION (${appVersion}) matches package.json (${pkgVersion})`);
  ok(sampleVersion === pkgVersion, `sample.usda version (${sampleVersion}) matches package.json (run npm run samples)`);
}

console.log('\n[foreign usd hardening]');
{
  const X = (body, head = '') => `#usda 1.0\n${head}def Xform "P"\n{\n${body}\n}\n`;
  const pos = (r) => r.objects[0].position;

  // F4: xformOpOrder is honored
  const ro = importUsda(X('    double3 xformOp:translate = (100, 0, 0)\n    float3 xformOp:rotateXYZ = (0, 90, 0)\n    uniform token[] xformOpOrder = ["xformOp:rotateXYZ", "xformOp:translate"]'));
  ok(close(pos(ro).x, 0, 1e-6) && close(pos(ro).z, -100, 1e-6) && close(ro.objects[0].rotation.y, 90, 1e-6), `rotate-then-translate order composes as listed (${JSON.stringify(pos(ro))})`);
  const unlisted = importUsda(X('    double3 xformOp:translate = (5, 0, 0)\n    double3 xformOp:scale = (3, 3, 3)\n    uniform token[] xformOpOrder = ["xformOp:translate"]'));
  ok(close(unlisted.objects[0].scale.x, 1), 'an authored op missing from xformOpOrder is ignored');
  const M = new THREE.Matrix4().compose(new THREE.Vector3(5, 6, 7), new THREE.Quaternion(), new THREE.Vector3(2, 2, 2)).elements;
  const rowsM = [0, 1, 2, 3].map(r => '(' + [0, 1, 2, 3].map(c => M[r * 4 + c]).join(', ') + ')').join(', ');
  const stray = importUsda(X(`    float3 xformOp:rotateXYZ = (0, 0, 0)\n    matrix4d xformOp:transform = (${rowsM})\n    uniform token[] xformOpOrder = ["xformOp:transform"]`));
  ok(close(pos(stray).x, 5) && close(stray.objects[0].scale.x, 2), 'a stray rotateXYZ next to an ordered transform does not drop the transform');
  const xy = importUsda(X('    float xformOp:rotateX = 90\n    float xformOp:rotateY = 90\n    uniform token[] xformOpOrder = ["xformOp:rotateX", "xformOp:rotateY"]'));
  const Rxy = matrixFromRotateOp('XYZ', [xy.objects[0].rotation.x, xy.objects[0].rotation.y, xy.objects[0].rotation.z]);
  const RX = matrixFromRotateOp('XYZ', [90, 0, 0]), RY = matrixFromRotateOp('XYZ', [0, 90, 0]);
  const want = RX.map(row => [0, 1, 2].map(j => row.reduce((acc, v, k) => acc + v * RY[k][j], 0)));   // RX * RY: Y applied first
  ok(Rxy.every((row, i) => row.every((v, j) => close(v, want[i][j], 1e-9))), '[rotateX, rotateY] composes X outermost (Y applied first)');

  // F8: mirrored transform keeps the mirror in the scale
  const Mm = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), new THREE.Vector3(-2, 3, 4)).elements;
  const rowsMm = [0, 1, 2, 3].map(r => '(' + [0, 1, 2, 3].map(c => Mm[r * 4 + c]).join(', ') + ')').join(', ');
  const mir = importUsda(X(`    matrix4d xformOp:transform = (${rowsMm})\n    uniform token[] xformOpOrder = ["xformOp:transform"]`)).objects[0];
  ok(close(mir.scale.x, -2) && close(mir.scale.y, 3) && close(mir.rotation.x, 0) && close(mir.rotation.y, 0) && close(mir.rotation.z, 0), `negative-determinant matrix: scale (${mir.scale.x}, ${mir.scale.y}, ${mir.scale.z}), no folded rotation`);

  // F6: inline comments and other string forms
  const inline = importUsda('#usda 1.0\ndef Cube "A"\n{\n    double size = 2 # a 6" cube\n}\ndef Cube "B" # trailing\n{\n    string note = \'single # "quoted"\'\n    string doc2 = """multi\n}\nline"""\n}\n');
  ok(inline.objects.length === 2 && inline.warnings.length === 0, `inline # comments, single- and triple-quoted strings do not unbalance the file (${inline.objects.length} objects; ${inline.warnings.join('; ')})`);
  const dataUrl = importUsda(exportUsda([], { reference: { image: 'data:image/png;base64,AA#//BB==', width: 10, x: 0, z: 0, rotation: 0, opacity: 0.5 } }));
  ok(dataUrl.reference && dataUrl.reference.image === 'data:image/png;base64,AA#//BB==', '# and // inside strings survive comment stripping');

  // F9: class, over and unselected variants are not live prims
  const variants = importUsda('#usda 1.0\nclass Xform "Proto"\n{\n    def Cube "Geo" {}\n}\nover "Elsewhere"\n{\n    def Cube "O" {}\n}\ndef Xform "Thing" (\n    variants = {\n        string look = "blue"\n    }\n    prepend variantSets = "look"\n)\n{\n    variantSet "look" = {\n        "red" {\n            def Cube "RedCube" {}\n        }\n        "blue" {\n            def Sphere "BlueBall" {}\n        }\n    }\n}\n');
  const names = []; walkObjects(variants.objects, o => names.push(o.name));
  ok(names.join() === 'Thing,BlueBall', `only defined prims and the selected variant import (${names.join()})`);
  ok(variants.warnings.some(w => /class\/over/.test(w)), 'skipped class/over prims are reported');

  // variants: nested sets, and attributes authored in the selected variant
  const nestedV = importUsda('#usda 1.0\ndef Xform "A" (\n    variants = {\n        string a = "x"\n        string b = "y"\n    }\n)\n{\n    variantSet "a" = {\n        "x" {\n            variantSet "b" = {\n                "y" {\n                    def Cube "C" {}\n                }\n                "z" {\n                    def Cube "Z" {}\n                }\n            }\n        }\n    }\n}\n');
  const nn = []; walkObjects(nestedV.objects, o => nn.push(o.name));
  ok(nn.join() === 'A,C', `nested variant sets import the selected leaf (${nn.join()})`);
  const vAttr = importUsda('#usda 1.0\ndef Xform "P" (\n    variants = {\n        string s = "on"\n    }\n)\n{\n    variantSet "s" = {\n        "on" {\n            double3 xformOp:translate = (5, 0, 0)\n            uniform token[] xformOpOrder = ["xformOp:translate"]\n        }\n        "off" {\n            double3 xformOp:translate = (9, 0, 0)\n            uniform token[] xformOpOrder = ["xformOp:translate"]\n        }\n    }\n}\n');
  ok(close(vAttr.objects[0].position.x, 5), `attributes authored in the selected variant apply (x = ${vAttr.objects[0].position.x})`);
  const vLocal = importUsda('#usda 1.0\ndef Xform "P" (\n    variants = {\n        string s = "on"\n    }\n)\n{\n    double3 xformOp:translate = (1, 0, 0)\n    uniform token[] xformOpOrder = ["xformOp:translate"]\n    variantSet "s" = {\n        "on" {\n            double3 xformOp:translate = (5, 0, 0)\n        }\n    }\n}\n');
  ok(close(vLocal.objects[0].position.x, 1), 'a local opinion beats the variant');
  const unsel = importUsda('#usda 1.0\ndef Xform "P"\n{\n    variantSet "s" = {\n        "on" {\n            def Cube "C" {}\n        }\n    }\n}\n');
  ok(unsel.warnings.some(w => /no selection/.test(w)), 'a variant set with no selection is reported');

  // zero scale on the matrix path keeps the rotation
  const flat = importUsda(X('    double3 xformOp:translate:pivot = (1, 0, 0)\n    float3 xformOp:rotateXYZ = (0, 45, 0)\n    double3 xformOp:scale = (0, 1, 1)\n    uniform token[] xformOpOrder = ["xformOp:translate:pivot", "xformOp:rotateXYZ", "xformOp:scale", "!invert!xformOp:translate:pivot"]')).objects[0];
  ok(close(flat.rotation.y, 45, 1e-6) && close(flat.scale.x, 0, 1e-9), `zero scale axis keeps the rotation (${flat.rotation.y})`);

  // F3: stage units and up axis
  const zUp = importUsda('#usda 1.0\n(\n    metersPerUnit = 1\n    upAxis = "Z"\n)\ndef Cube "Box"\n{\n    double size = 1\n    double3 xformOp:translate = (0, 0, 2)\n    uniform token[] xformOpOrder = ["xformOp:translate"]\n}\n');
  const wrap = zUp.objects[0];
  ok(zUp.objects.length === 1 && wrap.type === 'group' && close(wrap.rotation.x, -90) && close(wrap.scale.x, 100) && wrap.children[0].name === 'Box', 'Z-up metre file is wrapped in a converting group (rotateX -90, scale 100)');
  const Rw = matrixFromRotateOp('XYZ', [wrap.rotation.x, 0, 0]);
  const up = [0, 1, 2].map(i => Rw[i][2] * 2 * wrap.scale.x);
  ok(close(up[1], 200, 1e-6), `a point 2 m up the Z axis lands 200 cm up Y (${up.map(v => v.toFixed(3))})`);
  ok(zUp.warnings.some(w => /Z-up, metres/.test(w)), 'conversion is reported');
  const own = importUsda(exportUsda([{ name: 'C', type: 'cube', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: null, visible: true, children: [] }]));
  ok(own.objects.length === 1 && own.objects[0].name === 'C', "Ptah's own Y-up cm files are not wrapped");

  // F12: animated values warned once; a skipped mesh warns once
  const anim = importUsda('#usda 1.0\ndef Xform "A"\n{\n    double3 xformOp:translate.timeSamples = {\n        1: (0, 0, 0),\n    }\n    uniform token[] xformOpOrder = ["xformOp:translate"]\n}\ndef Xform "B"\n{\n    double3 xformOp:translate.timeSamples = { 1: (1, 0, 0) }\n}\n');
  ok(anim.warnings.filter(w => /timeSamples/.test(w)).length === 1 && /2 prims/.test(anim.warnings.join()), 'animated values produce one summary warning');
  const skipped = importUsda('#usda 1.0\ndef Xform "Holder"\n{\n    def Mesh "Broken"\n    {\n        point3f[] points = [(0, 0, 0)]\n    }\n}\n');
  ok(skipped.warnings.filter(w => /Broken/.test(w)).length === 1, `a skipped mesh warns once (${skipped.warnings.join('; ')})`);

  // F5: linear parse and early budgets
  let nested = '#usda 1.0\n';
  const D = 60;
  for (let i = 0; i < D; i++) nested += `def Xform "L${i}"\n{\n    double3 xformOp:translate = (1, 0, 0)\n    uniform token[] xformOpOrder = ["xformOp:translate"]\n`;
  nested += 'def Mesh "Leaf"\n{\n    point3f[] points = [' + Array.from({ length: 150000 }, (_, i) => `(${i}, 0, 0)`).join(', ') + ']\n    int[] faceVertexCounts = [3]\n    int[] faceVertexIndices = [0, 1, 2]\n}\n' + '}\n'.repeat(D);
  let t0 = performance.now();
  const deepRes = importUsda(nested);
  const deepMs = performance.now() - t0;
  let leaf = null; walkObjects(deepRes.objects, o => { if (o.meshData) leaf = o; });   // folded into L59
  ok(leaf && leaf.meshData.points.length === 150000, `60-deep file with a 150k-point mesh parses (${(nested.length / 1e6).toFixed(1)} MB in ${deepMs.toFixed(0)} ms)`);
  ok(deepMs < 15000, 'deep parse stays linear (under 15 s; it took 18 s when quadratic)');
  const huge = '#usda 1.0\ndef Mesh "Big"\n{\n    point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 0, 1)]\n    int[] faceVertexCounts = [3]\n    int[] faceVertexIndices = [' + '0, '.repeat(MAX_INDICES) + '0]\n}\n';
  t0 = performance.now();
  let budgetErr = null;
  try { importUsda(huge); } catch (err) { budgetErr = err; }
  const budgetMs = performance.now() - t0;
  ok(budgetErr && /face vertex indices/.test(budgetErr.message) && budgetMs < 6000, `index budget refuses before parsing (${budgetMs.toFixed(0)} ms)`);

  // F13: export nesting limit matches the importer
  ok(MAX_NESTING === 62, 'editor nesting limit leaves room for Root and the Geom child');
  const chain = { name: 'g0', type: 'group', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, children: [] };
  let tip = chain;
  for (let i = 1; i < MAX_NESTING - 1; i++) { const nn = { ...chain, name: 'g' + i, children: [] }; tip.children.push(nn); tip = nn; }
  tip.children.push({ name: 'Leaf', type: 'cube', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: null, visible: true, children: [] });
  let reopenErr = null, reopened = null;
  try { reopened = importUsda(exportUsda([chain])); } catch (err) { reopenErr = err; }
  ok(!reopenErr && countObjects(reopened.objects) === MAX_NESTING, `a level nested to the editor limit (${MAX_NESTING}) reopens`);
  const chainFile = (n, head = '') => {
    let t = `#usda 1.0\n${head}`;
    for (let i = 0; i < n; i++) t += `def Xform "N${i}"\n{\n`;
    return t + '}\n'.repeat(n);
  };
  let tooDeep = null;
  try { importUsda(chainFile(MAX_NESTING + 1)); } catch (err) { tooDeep = err; }
  ok(tooDeep && /levels deep/.test(tooDeep.message), 'a foreign file deeper than the editor limit is refused on import');
  let wrapDeep = null;
  try { importUsda(chainFile(MAX_NESTING, '(\n    upAxis = "Z"\n)\n')); } catch (err) { wrapDeep = err; }
  ok(wrapDeep && /levels deep/.test(wrapDeep.message), 'the Z-up conversion group cannot push a scene past the limit');
  ok(countObjects(importUsda(chainFile(MAX_NESTING)).objects) === MAX_NESTING, 'a foreign file exactly at the limit imports');
}

// ---------------------------------------------------------------------------
// 6. Checked-in fixtures: the v0.1 flat format still loads; the current sample
//    round-trips byte-identically.
// ---------------------------------------------------------------------------
console.log('\n[fixtures]');
{
  const mainText = fs.readFileSync(path.join(repoRoot, 'main.js'), 'utf8');
  const mainImportBytes = mainText.match(/const MAX_IMPORT_BYTES = (\d+) \* 1024 \* 1024;/);
  ok(mainImportBytes && Number(mainImportBytes[1]) * 1024 * 1024 === MAX_IMPORT_BYTES, 'main.js import-size constant matches usd.js');
  ok(mainText.includes(`const IMPORT_TOO_LARGE = '${IMPORT_TOO_LARGE}';`), 'main.js import-size message matches usd.js');
  const legacy = importUsda(fs.readFileSync(path.join(here, 'sample-v0.1.usda'), 'utf8'));
  ok(legacy.warnings.length === 0 && countObjects(legacy.objects) === 4, `v0.1 sample imports (${countObjects(legacy.objects)} objects, ${legacy.warnings.length} warnings)`);
  ok(legacy.objects.every(o => o.children.length === 0), 'v0.1 objects are flat roots');
  const sampleText = fs.readFileSync(path.join(here, 'sample.usda'), 'utf8');
  const sample = importUsda(sampleText);
  ok(sample.warnings.length === 0 && countObjects(sample.objects) === 12, `current sample imports (${countObjects(sample.objects)} objects)`);
  ok(sample.metrics && sample.metrics.eyeHeight === 160 && sample.objects.some(o => o.type === 'marker' && o.marker === 'Trigger'), 'current sample carries metrics and a trigger marker');
  ok(sample.reference && sample.reference.width === 1024, 'current sample carries its reference underlay');
  const version = sampleText.match(/editor v([\d.]+)/)[1];
  ok(exportUsda(sample.objects, { appVersion: version, reference: sample.reference, metrics: sample.metrics }) === sampleText, 'sample.usda is exactly what the exporter produces (run npm run samples after format changes)');
}

console.log('\n[review 0.8.2: strings, prim types, limits, history]');
{
  const wrap = (body) => `#usda 1.0\n(\n    defaultPrim = "Root"\n    metersPerUnit = 0.01\n    upAxis = "Y"\n)\n\ndef Xform "Root"\n{\n${body}\n}\n`;
  const note = (meta) => wrap(`    def Xform "N" (\n        customData = {\n${meta}\n            string "ptah:type" = "note"\n        }\n    )\n    {\n    }`);
  // what usd-core writes when it re-saves a Ptah file
  const sq = importUsda(note(`            string "ptah:name" = 'Say "hi"'\n            string "ptah:text" = 'He said "hi"'`)).objects[0];
  ok(sq.name === 'Say "hi"' && sq.text === 'He said "hi"', 'single-quoted strings (usd-core writes these for text containing ") keep name and note text: ' + JSON.stringify([sq.name, sq.text]));
  const tq = importUsda(note(`            string "ptah:text" = '''line one\nline "two"'''`)).objects[0];
  ok(tq.text === 'line one\nline "two"', 'triple-quoted multi-line note text is read: ' + JSON.stringify(tq.text));
  ok(unescapeUsdString('ctl\\x01x\\101\\a') === 'ctl\x01xA\x07', 'hex, octal and the other Sdf escapes decode');
  const coloured = importUsda(note(`            string "ptah:text" = "set ptah:color = (1, 0, 0) here"\n            color3f "ptah:color" = (0.2, 0.4, 0.6)`)).objects[0];
  ok(coloured.color && Math.abs(coloured.color[0] - 0.2) < 1e-6, 'a key inside note text is not read as the key itself: ' + JSON.stringify(coloured.color));
  const tagged = importUsda(wrap(`    def Xform "M" (\n        customData = {\n            string "ptah:type" = "marker"\n        }\n    )\n    {\n        custom string ptah:marker = "Spawn"\n        custom string[] ptah:tags = ['say "x"', "[wip]"]\n    }`)).objects[0];
  ok(tagged.tags && tagged.tags[0] === 'say "x"' && tagged.tags[1] === '[wip]', 'single-quoted tag elements read whole: ' + JSON.stringify(tagged.tags));
  // file-supplied lookup keys
  const ctor = importUsda(wrap(`    def Xform "C" (\n        customData = {\n            string "ptah:type" = "constructor"\n        }\n    )\n    {\n    }`));
  let saveErr = null;
  try { exportUsda(ctor.objects); } catch (err) { saveErr = err; }
  ok(!saveErr && !ctor.objects.some(o => o.type === 'constructor'), 'ptah:type "constructor" is not a primitive, and the level still saves');
  // stairs steps are capped on import and export
  const stairs = importUsda(wrap(`    def Xform "S" (\n        customData = {\n            string "ptah:type" = "stairs"\n            int "ptah:steps" = 1000000000\n        }\n    )\n    {\n    }`)).objects[0];
  ok(stairs.params && stairs.params.steps === 64, 'an absurd ptah:steps is capped at 64 on import: ' + JSON.stringify(stairs.params));
  ok(/int "ptah:steps" = 64/.test(exportUsda([{ ...stairs, params: { steps: 1e30 } }])), 'and on export');
  // SkelRoot keeps its transform and meshes; unsupported gprims are counted, not hoisted
  const skel = importUsda(wrap(`    def SkelRoot "Char"\n    {\n        double3 xformOp:translate = (100, 0, 0)\n        uniform token[] xformOpOrder = ["xformOp:translate"]\n        def Mesh "Body"\n        {\n            point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 0, 1)]\n            int[] faceVertexCounts = [3]\n            int[] faceVertexIndices = [0, 1, 2]\n        }\n    }\n    def Cone "Tip"\n    {\n    }`));
  const char = skel.objects[0];
  ok(char && char.position.x === 100 && (char.meshData || (char.children || []).some(c => c.meshData)), 'a SkelRoot imports with its transform and its mesh: ' + JSON.stringify(char && { type: char.type, x: char.position.x }));
  ok(skel.warnings.some(w => /1 Cone prim was skipped/.test(w)), 'an unsupported Cone is reported: ' + JSON.stringify(skel.warnings));
  // the layer header, however it is laid out
  const cube = `def Xform "Root"\n{\n    def Cube "C"\n    {\n    }\n}\n`;
  const zupIndented = importUsda(`#usda 1.0\n(\n    upAxis = "Z"\n    metersPerUnit = 1\n    )\n` + cube);
  const zupOneLine = importUsda(`#usda 1.0\n( upAxis = "Z"; metersPerUnit = 1 )\n` + cube);
  ok([zupIndented, zupOneLine].every(r => r.objects.length === 1 && /Z-up, metres/.test(r.objects[0].name)), 'Z-up metre headers with an indented or one-line closing paren get the conversion group: ' + JSON.stringify([zupIndented, zupOneLine].map(r => r.objects[0] && r.objects[0].name)));
  const docTrap = importUsda(`#usda 1.0\n(\n    doc = "exported with upAxis = \\"Z\\" and metersPerUnit = 1 elsewhere"\n    upAxis = "Y"\n)\n` + cube);
  ok(docTrap.objects.length === 1 && docTrap.objects[0].type === 'cube', 'upAxis and metersPerUnit inside a doc string are not the stage settings: ' + JSON.stringify(docTrap.objects.map(o => o.name)));
  // history survives a command that throws
  const h = new History();
  h.push({ label: 'ok', undo: () => {}, redo: () => {} });
  h.push({ label: 'bad', undo: () => { throw new Error('boom'); }, redo: () => {} });
  let threw = false;
  try { h.undo(); } catch { threw = true; }
  ok(threw && !h.canUndo && !h.canRedo, 'an undo that throws clears the history instead of leaving a half-applied stack');
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
