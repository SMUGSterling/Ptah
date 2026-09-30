// Triangles for imported polygon faces (renderer/js/triangulate.js): a concave face
// must not cover its notch, which the editor draws, picks and walks on.
// Run: node --import ./test/register-three.mjs test/triangulate.test.mjs
import * as THREE from 'three';
import { triangulateFaces } from '../renderer/js/triangulate.js';

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  pass  ' : '  FAIL  ') + msg); if (!cond) failures++; };

const tris = (pos) => { const t = []; for (let i = 0; i < pos.length; i += 9) t.push([pos.slice(i, i + 3), pos.slice(i + 3, i + 6), pos.slice(i + 6, i + 9)]); return t; };
const cross = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; };
const area = (pos) => tris(pos).reduce((s, [a, b, c]) => s + Math.hypot(...cross(a, b, c)) / 2, 0);
/** Does a ray straight down at (x, z) hit the geometry? */
function hitsDown(pos, x, z) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  return new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh).length > 0;
}
const fan = ({ points, faceVertexCounts, faceVertexIndices }) => {
  const pos = []; let c = 0;
  for (const n of faceVertexCounts) { for (let i = 1; i < n - 1; i++) for (const k of [0, i, i + 1]) pos.push(...points[faceVertexIndices[c + k]]); c += n; }
  return pos;
};

console.log('\n[triangulate]');
// A U on the floor, facing up (+Y), wound CCW seen from above as USD's front faces are:
// 300 wide, 200 deep, with a 100 x 150 notch open to +Z between x = 100 and 200.
const U = [[0, 0, 0], [0, 0, 200], [100, 0, 200], [100, 0, 50], [200, 0, 50], [200, 0, 200], [300, 0, 200], [300, 0, 0]];
const u = { points: U, faceVertexCounts: [8], faceVertexIndices: [0, 1, 2, 3, 4, 5, 6, 7] };
const out = triangulateFaces(u);
const trueArea = 300 * 200 - 100 * 150;
ok(hitsDown(fan(u), 150, 150), 'the fixture is the bug: a fan from the first corner covers the notch');
ok(!hitsDown(out, 150, 150) && !hitsDown(out, 110, 60) && !hitsDown(out, 190, 190), 'nothing in the U\'s notch: a ray down through it hits no triangle');
ok(hitsDown(out, 50, 150) && hitsDown(out, 250, 150) && hitsDown(out, 150, 25), 'both arms and the base are solid');
ok(Math.abs(area(out) - trueArea) < 1e-6, `the triangles cover exactly the face: ${area(out)} = ${trueArea}`);
ok(tris(out).length === 6 && tris(out).every(([a, b, c]) => cross(a, b, c)[1] > 0), 'six triangles, every one facing up as the face does');
// the same U facing down (wound the other way): the triangles follow
const down = triangulateFaces({ ...u, faceVertexIndices: [7, 6, 5, 4, 3, 2, 1, 0] });
ok(tris(down).every(([a, b, c]) => cross(a, b, c)[1] < 0) && Math.abs(area(down) - trueArea) < 1e-6, 'the U wound the other way: every triangle faces down');
// a U standing up as a wall, facing +Z (ear-clipped in x/y): same area, no triangle across its notch
const wall = triangulateFaces({ ...u, points: U.map(([x, , z]) => [x, z, 0]), faceVertexIndices: [7, 6, 5, 4, 3, 2, 1, 0] });
ok(Math.abs(area(wall) - trueArea) < 1e-6 && tris(wall).every(([a, b, c]) => cross(a, b, c)[2] > 0), 'a U standing as a wall facing +Z: exact area, every triangle facing +Z');
// the same U in any units: a face a millionth the size (or a hundred thousand times it) is as concave
for (const k of [1e-7, 1e5]) {
  const scaled = triangulateFaces({ ...u, points: U.map(p => p.map(c => c * k)) });
  ok(!hitsDown(scaled, 150 * k, 150 * k) && Math.abs(area(scaled) / (k * k) - trueArea) < 1e-6 * trueArea, `the U scaled by ${k}: nothing in its notch, the same area`);
}
// a face that crosses itself: ear clipping returns only part of it, so the fan (every corner) is kept instead
const crossed = { points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0]], faceVertexCounts: [5], faceVertexIndices: [0, 1, 2, 3, 4] };
ok(JSON.stringify(triangulateFaces(crossed)) === JSON.stringify(fan(crossed)), `a self-crossing face: all ${tris(fan(crossed)).length} fan triangles, not a part-done ear clip`);
// convex faces are fanned as before, so every existing mesh keeps its triangles
const quad = { points: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]], faceVertexCounts: [4, 3], faceVertexIndices: [0, 1, 2, 3, 0, 1, 2] };
ok(JSON.stringify(triangulateFaces(quad)) === JSON.stringify(fan(quad)), 'a convex quad and a triangle: the same fan as before');
// a face naming a point the file doesn't have keeps the triangles that don't
const missing = triangulateFaces({ points: [[0, 0, 0], [0, 0, 1], [1, 0, 1]], faceVertexCounts: [4], faceVertexIndices: [0, 1, 2, 9] });
ok(missing.length === 9, 'a face with a missing point: the fan triangle that has all its points stays');

console.log(failures ? `\n${failures} FAILURES` : '\nALL TRIANGULATE TESTS PASSED');
process.exit(failures ? 1 : 0);
