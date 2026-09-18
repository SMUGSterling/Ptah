// Headless checks for renderer/js/usd.js. Run: node test/usd.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  exportUsda, importUsda, PRIMITIVE_GEOMETRY, primitiveVolume,
  usdString, unescapeUsdString, walkObjects, countObjects,
  matrixFromRotateOp, matrixFromQuat, rotateXYZFromMatrix
} from '../renderer/js/usd.js';
import * as THREE from '../renderer/vendor/three.module.js';
import { METRICS_DEFAULTS, normalizeMetrics, presetSpecs, PRESET_KEYS, INTENTS, MARKERS, PROFILES, profileMetrics, deriveMetrics } from '../renderer/js/metrics.js';
import { faceSnapDelta } from '../renderer/js/snap.js';

const here = path.dirname(fileURLToPath(import.meta.url));

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
  ok(piv.warnings.some(w => /approximate/.test(w)), 'pivot ops produce an "approximate" warning instead of silent garbage');
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
  ok(back.metrics && back.metrics.eyeHeight === 150.5 && back.metrics.jumpHeight === 90 && back.metrics.playerHeight === 176 && back.metrics.capsuleRadius === 34, 'metrics profile round-trips');
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
  // engine template profiles and the derivation rules
  ok(PROFILES.length === 4 && PROFILES.map(p => p.key).join() === 'ue-third,ue-first,unity-third,unity-first', 'four engine profiles');
  const ue = profileMetrics('ue-third');
  ok(ue.playerHeight === 176 && ue.capsuleRadius === 34 && ue.walkSpeed === 500 && ue.jumpHeight === 143 && ue.stepHeight === 45, 'UE Third Person core numbers');
  ok(ue.doorHeight === 340 && ue.doorWidth === 140 && ue.corridorWidth === 280 && ue.halfCover === 100 && ue.fullCover === 200, 'UE Third Person derived sizes (door clears height + jump + 20)');
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
// 6. Checked-in fixtures: the v0.1 flat format still loads; the current sample
//    round-trips byte-identically.
// ---------------------------------------------------------------------------
console.log('\n[fixtures]');
{
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

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
