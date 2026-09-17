// Headless checks for renderer/js/usd.js. Run: node test/usd.test.mjs
import {
  exportUsda, importUsda, PRIMITIVE_GEOMETRY, primitiveVolume,
  usdString, unescapeUsdString, walkObjects, countObjects
} from '../renderer/js/usd.js';

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

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
