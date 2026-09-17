// Headless checks for renderer/js/usd.js. Run: node test/usd.test.mjs
import {
  exportUsda, importUsda, PRIMITIVE_GEOMETRY
} from '../renderer/js/usd.js';

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  pass  ' + msg);
  else { failures++; console.log('  FAIL  ' + msg); }
};
const close = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

// ---------------------------------------------------------------------------
// 1. Face winding: with vertices in CCW order (USD/three front-face
//    convention), the Newell normal must point away from the object center.
// ---------------------------------------------------------------------------
console.log('\n[winding]');
for (const [name, gen] of Object.entries(PRIMITIVE_GEOMETRY)) {
  const g = gen();
  const center = [0, 0, 0]; // all primitives centered at origin (plane at y=0)
  let bad = 0, cursor = 0;
  for (const count of g.faceVertexCounts) {
    const idx = g.faceVertexIndices.slice(cursor, cursor + count);
    cursor += count;
    // Newell normal
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < count; i++) {
      const [x1, y1, z1] = g.points[idx[i]];
      const [x2, y2, z2] = g.points[idx[(i + 1) % count]];
      nx += (y1 - y2) * (z1 + z2);
      ny += (z1 - z2) * (x1 + x2);
      nz += (x1 - x2) * (y1 + y2);
      cx += x1; cy += y1; cz += z1;
    }
    cx /= count; cy /= count; cz /= count;
    let dot = nx * (cx - center[0]) + ny * (cy - center[1]) + nz * (cz - center[2]);
    if (name === 'plane') dot = ny; // flat: outward = +Y
    if (dot <= 0) bad++;
  }
  ok(bad === 0, `${name}: all ${g.faceVertexCounts.length} faces wound outward (${bad} bad)`);
}

// ---------------------------------------------------------------------------
// 2. Export → import round trip
// ---------------------------------------------------------------------------
console.log('\n[round trip]');
const objects = [
  {
    name: 'Wall 01', type: 'cube',
    position: { x: 128, y: 32, z: -64 },
    rotation: { x: 0, y: 45, z: 0 },
    scale: { x: 256, y: 64, z: 16 },
    color: [0.55, 0.58, 0.63], visible: true
  },
  {
    name: 'Pillar', type: 'cylinder',
    position: { x: 0, y: 96, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 48, y: 192, z: 48 },
    color: [0.77, 0.54, 0.35], visible: false
  },
  {
    name: 'Dome', type: 'sphere',
    position: { x: -200, y: 100, z: 50 },
    rotation: { x: 10, y: 20, z: 30 },
    scale: { x: 100, y: 100, z: 100 },
    color: null, visible: true
  },
  {
    name: 'Floor', type: 'plane',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 512, y: 1, z: 512 },
    color: [0.34, 0.37, 0.42], visible: true
  }
];

const usda = exportUsda(objects, { appVersion: 'test' });
ok(usda.startsWith('#usda 1.0'), 'file starts with #usda 1.0');
ok(usda.includes('metersPerUnit = 0.01'), 'declares cm units');
ok(usda.includes('upAxis = "Y"'), 'declares Y-up');
ok(usda.includes('def Xform "Wall_01"'), 'name sanitized to valid identifier');
ok(usda.includes('"ptah:name" = "Wall 01"'), 'original display name preserved');
ok(usda.includes('token visibility = "invisible"'), 'hidden object exported as invisible');

const { objects: back, warnings } = importUsda(usda);
ok(warnings.length === 0, 'no import warnings (' + warnings.join('; ') + ')');
ok(back.length === 4, `4 objects back (${back.length})`);

const wall = back.find(o => o.name === 'Wall 01');
ok(!!wall && wall.type === 'cube', 'wall round-trips as cube with display name');
ok(wall && close(wall.position.x, 128) && close(wall.position.z, -64), 'wall position preserved');
ok(wall && close(wall.rotation.y, 45), 'wall rotation preserved');
ok(wall && close(wall.scale.x, 256) && close(wall.scale.z, 16), 'wall scale preserved');
ok(wall && close(wall.color[0], 0.55), 'wall displayColor preserved');

const pillar = back.find(o => o.name === 'Pillar');
ok(pillar && pillar.visible === false, 'pillar visibility=false preserved');

const dome = back.find(o => o.name === 'Dome');
ok(dome && dome.color === null, 'absent color imports as null');

// ---------------------------------------------------------------------------
// 3. Foreign files: gprims and raw meshes
// ---------------------------------------------------------------------------
console.log('\n[foreign usda]');
const foreign = `#usda 1.0
(
    upAxis = "Y"
)

def Xform "Level"
{
    double3 xformOp:translate = (100, 0, 0)
    uniform token[] xformOpOrder = ["xformOp:translate"]

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
}

def Mesh "Ramp"
{
    point3f[] points = [(0,0,0), (100,0,0), (100,50,0), (0,0,100)]
    int[] faceVertexCounts = [3, 3]
    int[] faceVertexIndices = [0, 1, 2, 0, 2, 3]
}
`;
const f = importUsda(foreign);
ok(f.objects.length === 4, `4 foreign objects (${f.objects.length}): ${f.objects.map(o => o.name).join(', ')}`);
const crate = f.objects.find(o => o.name === 'Crate');
ok(crate && crate.type === 'cube' && close(crate.scale.x, 64), 'Cube gprim: size*scale folded into dimensions');
ok(crate && close(crate.position.x, 100), 'parent translation composed');
const ball = f.objects.find(o => o.name === 'Ball');
ok(ball && ball.type === 'sphere' && close(ball.scale.x, 100) && close(ball.position.y, 50), 'Sphere gprim: radius→diameter');
const col = f.objects.find(o => o.name === 'Column');
ok(col && col.type === 'cylinder' && close(col.scale.y, 300) && close(col.scale.x, 48), 'Cylinder gprim: radius/height mapped');
const ramp = f.objects.find(o => o.name === 'Ramp');
ok(ramp && ramp.type === 'mesh' && ramp.meshData.points.length === 4, 'raw Mesh imported as generic mesh');

// generic mesh re-exports and survives another round trip
const usda2 = exportUsda(f.objects);
const back2 = importUsda(usda2);
ok(back2.objects.length === 4, 'foreign objects re-export and re-import');
const ramp2 = back2.objects.find(o => o.name === 'Ramp');
ok(ramp2 && ramp2.meshData && ramp2.meshData.faceVertexIndices.length === 6, 'generic mesh topology survives round trip');

// ---------------------------------------------------------------------------
// 4. Garbage handling
// ---------------------------------------------------------------------------
console.log('\n[robustness]');
const junk = importUsda('this is not a usd file at all { ] (');
ok(junk.objects.length === 0 && junk.warnings.length > 0, 'garbage input yields warnings, no crash');
const empty = importUsda('#usda 1.0\n');
ok(empty.objects.length === 0, 'empty stage imports cleanly');

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
