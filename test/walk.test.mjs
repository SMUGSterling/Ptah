// Headless checks for renderer/js/walk.js: collision, floors, jumps and the
// mannequin's animation, in every metrics profile. Run:
//   node --import ./test/register-three.mjs test/walk.test.mjs
// walk.js only needs addEventListener on document, window and the canvas, so
// those are stubbed; the level is plain three.js meshes built from Ptah's own
// primitive generators, the same geometry the editor places.

const listeners = {};
const target = (name) => ({ addEventListener: (t, f) => { (listeners[name + ':' + t] ||= []).push(f); } });
globalThis.document = Object.assign(target('doc'), { pointerLockElement: null, exitPointerLock() {} });
globalThis.window = target('win');
const fire = (tgt, t, e) => (listeners[tgt + ':' + t] || []).forEach(f => f({ preventDefault() {}, repeat: false, ...e }));

const THREE = await import('three');
const { createWalkMode } = await import('../renderer/js/walk.js');
const { loadMannequin } = await import('../renderer/js/character.js');
const { PRIMITIVE_GEOMETRY } = await import('../renderer/js/usd.js');
const { PROFILES, profileMetrics, presetSpecs } = await import('../renderer/js/metrics.js');

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  pass  ' + msg);
  else { failures++; console.log('  FAIL  ' + msg); }
};

const profiles = PROFILES.map(p => [p.key, profileMetrics(p.key)]);

function mesh(type, params, pos, scale) {
  const md = PRIMITIVE_GEOMETRY[type](params);
  const p = [];
  let c = 0;
  for (const n of md.faceVertexCounts) {
    const idx = md.faceVertexIndices.slice(c, c + n);
    for (let i = 1; i < n - 1; i++) for (const k of [idx[0], idx[i], idx[i + 1]]) p.push(...md.points[k]);
    c += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial());
  m.position.set(...pos); m.scale.set(...scale); m.updateMatrixWorld(true);
  return m;
}
const box = (x, y, z, sx, sy, sz) => mesh('cube', null, [x, y, z], [sx, sy, sz]);
const fromSpec = (o) => mesh(o.type, o.params, [o.position.x, o.position.y, o.position.z], [o.scale.x, o.scale.y, o.scale.z]);

function setup({ metrics, objs = [], mannequin = null, views = [] }) {
  const camera = new THREE.PerspectiveCamera(60, 1.5, 1, 1e5);
  const orbit = { target: new THREE.Vector3(), enabled: true };
  const canvas = Object.assign(target('canvas'), { requestPointerLock() {} });
  const w = createWalkMode({
    camera, orbit, canvas, metrics: () => metrics, collidables: () => objs,
    onChange() {}, onView: (v, chosen) => views.push([v, chosen]), mannequin: () => mannequin
  });
  return { w, camera };
}
/** Walk forward (-Z) from z for `secs`; returns the final state and the highest the feet got. */
function walkFor(w, secs, { dt = 1 / 60, run = false } = {}) {
  w._press('KeyW'); if (run) w._press('ShiftLeft');
  let top = -Infinity;
  for (let t = 0; t < secs; t += dt) { w.update(dt); top = Math.max(top, w._state().feetY); }
  w._release('KeyW'); w._release('ShiftLeft');
  return { ...w._state(), top };
}

console.log('\n[stairs and steps]');
for (const [key, M] of profiles) {
  // the default stairs (8 steps: 16u risers, 32u treads): stopped the Unity profiles at the first riser
  const stairs = mesh('stairs', { steps: 8 }, [0, 64, 0], [128, 128, 256]);
  for (const run of [false, true]) {
    const { w } = setup({ metrics: M, objs: [stairs] });
    w.enter({ x: 0, y: 0, z: 228, yaw: 0 });
    const s = walkFor(w, 5, { run });
    ok(s.top > 127.5, `${key} ${run ? 'runs' : 'walks'} up the default stairs (feet reach ${s.top.toFixed(1)} of 128)`);
  }
  // the Step run preset: every riser exactly stepHeight, which grazed the knee ray and blocked
  const spec = presetSpecs(M).steprun.objects[0];
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const { w } = setup({ metrics: M, objs: [fromSpec(spec)] });
    w.enter({ x: 0, y: 0, z: spec.scale.z / 2 + 100, yaw: 0 });
    const s = walkFor(w, 4, { dt });
    ok(s.top > spec.scale.y - 0.5 && s.pz < -spec.scale.z / 2, `${key} climbs the Step run preset (${spec.params.steps} risers of ${M.stepHeight}u) at ${Math.round(1 / dt)} fps: top ${s.top.toFixed(1)} of ${spec.scale.y}`);
  }
  // a single box exactly stepHeight tall is a step; a little taller is a wall
  for (const [h, climb] of [[M.stepHeight, true], [M.stepHeight + 0.5, false], [M.stepHeight + 3, false]]) {
    const { w } = setup({ metrics: M, objs: [box(0, h / 2, -150, 300, h, 200)] });
    w.enter({ x: 0, y: 0, z: 150, yaw: 0 });
    const s = walkFor(w, 1.5);
    ok(climb ? s.top > h - 0.5 : s.top < 0.5 && s.pz > -50, `${key}: a ${h}u box is ${climb ? 'stepped onto' : 'a wall'} (feet ${s.top.toFixed(1)}, z ${s.pz.toFixed(0)})`);
  }
}

console.log('\n[ramps]');
for (const [key, M] of profiles) {
  const results = [];
  for (const deg of [20, 30, 40, 55]) {
    const len = 400, h = len * Math.tan(deg * Math.PI / 180);
    const { w } = setup({ metrics: M, objs: [mesh('wedge', null, [0, h / 2, 0], [200, h, len])] });
    w.enter({ x: 0, y: 0, z: len / 2 + 100, yaw: 0 });
    const s = walkFor(w, 4);
    results.push([deg, s.top / h]);
  }
  const walkable = results.filter(([d]) => d <= 40), steep = results.find(([d]) => d === 55);
  ok(walkable.every(([, f]) => f > 0.95), `${key} walks up 20°, 30° and 40° ramps (Unity and UE allow 45°): ${walkable.map(([d, f]) => `${d}° ${(f * 100).toFixed(0)}%`).join(', ')}`);
  ok(steep[1] < 0.2, `${key} cannot walk up a 55° ramp (reached ${(steep[1] * 100).toFixed(0)}% of its height)`);
  // exactly 45° (rise = run, no tan() rounding): its normal's ny/|n| rounds a hair under cos 45°, which made it a wall
  const g = new THREE.BufferGeometry();
  const A = [-100, 0, 0], B = [100, 0, 0], C = [100, 400, -400], D = [-100, 400, -400];
  g.setAttribute('position', new THREE.Float32BufferAttribute([...A, ...B, ...C, ...A, ...C, ...D], 3));
  const ramp = new THREE.Mesh(g, new THREE.MeshLambertMaterial()); ramp.updateMatrixWorld(true);
  const { w } = setup({ metrics: M, objs: [ramp] });
  w.enter({ x: 0, y: 0, z: 100, yaw: 0 });
  const s = walkFor(w, 1.2 * 566 / M.walkSpeed + 0.5);
  // the last frame on it may stop short of the top edge by one frame's rise
  ok(s.top > 400 - M.walkSpeed / 60 - 0.01, `${key} walks up an exact 45° ramp (feet reach ${s.top.toFixed(1)} of 400)`);
}

console.log('\n[body width]');
for (const [key, M] of profiles) {
  const r = M.capsuleRadius;
  // two 32u-thick walls leaving a slit; the wall front is at z = 16
  const slit = (gap) => [box(-(gap / 2 + 400), 150, 0, 800, 300, 32), box(gap / 2 + 400, 150, 0, 800, 300, 32)];
  for (const gap of [10, 2 * r - 8]) {
    const { w } = setup({ metrics: M, objs: slit(gap) });
    w.enter({ x: 0, y: 0, z: 300, yaw: 0 });
    const s = walkFor(w, 2);
    // the round front touches the slit's edges sqrt(r² - (gap/2)²) out from the wall face; allow a frame of travel (up to 10u)
    const contact = 16 + Math.sqrt(r * r - (gap / 2) ** 2);
    ok(s.pz > contact - 10.5 && s.pz < contact + 10.5, `${key}: a ${gap}u slit stops the ${2 * r}u-wide body where its round front meets the edges (z ${s.pz.toFixed(1)}, contact at ${contact.toFixed(1)})`);
  }
  {
    const { w } = setup({ metrics: M, objs: slit(2 * r + 8) });
    w.enter({ x: 0, y: 0, z: 300, yaw: 0 });
    ok(walkFor(w, 2).pz < -16, `${key}: a ${2 * r + 8}u gap lets the ${2 * r}u-wide body through`);
  }
  {
    // a post whose edge is half a radius from the path
    const { w } = setup({ metrics: M, objs: [box(r / 2 + 10, 150, 0, 20, 300, 20)] });
    w.enter({ x: 0, y: 0, z: 300, yaw: 0 });
    ok(walkFor(w, 2).pz > 10, `${key}: a post overlapping the body's path blocks it`);
  }
  {
    // posts far thinner than any ray spacing, anywhere across the body's width (a sampled fan let a 2u post at x = 7 through)
    const missed = [];
    for (let x = -r + 2; x <= r - 2; x += 5) {
      const { w } = setup({ metrics: M, objs: [box(x, 150, 0, 2, 300, 2)] });
      w.enter({ x: 0, y: 0, z: 200, yaw: 0 });
      const s = walkFor(w, 1.5);
      if (s.pz < 1 + Math.sqrt(r * r - Math.max(0, Math.abs(x) - 1) ** 2) - 11) missed.push(x);
    }
    ok(missed.length === 0, `${key}: a 2u post anywhere across the ${2 * r}u body blocks it${missed.length ? ' (walked into posts at x = ' + missed.join(', ') + ')' : ''}`);
  }
  {
    // the Doorway preset is sized for this profile and must be passable
    const door = presetSpecs(M).doorway.objects.map(fromSpec);
    const { w } = setup({ metrics: M, objs: door });
    w.enter({ x: 0, y: 0, z: 300, yaw: 0 });
    ok(walkFor(w, 2).pz < -50, `${key}: the Doorway preset (${M.doorWidth}u) is walkable`);
  }
}

console.log('\n[wall faces]');
{
  const M = profileMetrics('ue-third');
  // a Plane primitive stood up as a wall is double-sided: it blocks from both sides
  const plane = mesh('plane', null, [0, 150, 0], [600, 1, 300]);
  plane.rotation.x = Math.PI / 2; plane.material.side = THREE.DoubleSide; plane.updateMatrixWorld(true);
  for (const [from, yaw] of [[200, 0], [-200, Math.PI]]) {
    const { w } = setup({ metrics: M, objs: [plane] });
    w.enter({ x: 0, y: 0, z: from, yaw });
    const s = walkFor(w, 1.5);
    ok(Math.sign(s.pz) === Math.sign(from) && Math.abs(s.pz) > M.capsuleRadius - 11, `a double-sided plane wall blocks from ${from > 0 ? 'the front' : 'behind'} (z ${s.pz.toFixed(1)})`);
  }
  // a mirrored (negative-scale) box winds its faces the other way and still blocks
  {
    const { w } = setup({ metrics: M, objs: [box(0, 150, -100, -300, 300, 100)] });
    w.enter({ x: 0, y: 0, z: 200, yaw: 0 });
    ok(walkFor(w, 1.5).pz > -50 + M.capsuleRadius - 11, 'a mirrored box blocks');
  }
  // a body that starts inside a box can walk out of it, but not back in
  {
    const { w } = setup({ metrics: M, objs: [box(0, 150, 0, 300, 300, 300)] });
    w.enter({ x: 0, y: 0, z: 0, yaw: Math.PI });           // facing +Z
    const out = walkFor(w, 1.5);
    ok(out.pz > 150 + M.capsuleRadius, `starting inside a box, the body walks out (z ${out.pz.toFixed(0)})`);
    w._look(0, 0);                                         // and turns back
    const back = walkFor(w, 1.5);
    ok(back.pz > 150 + M.capsuleRadius - 11, `and cannot walk back in (z ${back.pz.toFixed(1)}, face at 150)`);
  }
  // a triangle with a vertex exactly on a slice's height blocks whichever vertex comes first
  // (the on-height vertex was taken twice and crowded out the slice's other end)
  {
    const U = profileMetrics('unity-first'), r = U.capsuleRadius;   // knee 25.01 < r: the second slice is at feet + r
    const A = [-100, 30, 0], B = [0, r, 0], C = [100, 200, 0];     // above the knee slice; B on the r slice
    const tri = (vs) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(vs.flat(), 3));
      const t = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })); t.updateMatrixWorld(true);
      return t;
    };
    const through = [];
    for (const [name, vs] of [['A,B,C', [A, B, C]], ['B,C,A', [B, C, A]], ['C,A,B', [C, A, B]]]) {
      for (const x of [-60, -30]) {
        const { w } = setup({ metrics: U, objs: [tri(vs)] });
        w.enter({ x, y: 0, z: 200, yaw: 0 });
        if (walkFor(w, 1.5).pz < r - 11) through.push(`${name} at x ${x}`);
      }
    }
    ok(through.length === 0, `a wall triangle with a vertex on the slice height blocks in every vertex order${through.length ? ' (passed: ' + through.join(', ') + ')' : ''}`);
  }
}

console.log('\n[no tunnelling]');
for (const [key, M] of profiles) {
  // A body within its radius of a wall (it started there, or a step up put it there) may move away
  // or along, never across: comparing only where it ended let one frame's run carry it through.
  const through = [];
  for (const gap of [2, 5, 10]) {
    for (const fps of [20, 30, 60]) {
      const { w } = setup({ metrics: M, objs: [box(0, 150, 0, 800, 300, 4)] });   // a 4u wall, front face at z = 2
      w.enter({ x: 0, y: 0, z: 2 + gap, yaw: 0 });
      const s = walkFor(w, 1, { dt: 1 / fps, run: true });
      if (s.pz < 2 + gap - 0.01) through.push(`${gap}u at ${fps} fps -> z ${s.pz.toFixed(0)}`);
    }
  }
  ok(through.length === 0, `${key}: a body inside its radius of a 4u wall never moves closer or through it${through.length ? ' (' + through.join('; ') + ')' : ''}`);
  // once past a solid's near face every other face is behind the body, so crossing it meant walking through the whole block
  const { w } = setup({ metrics: M, objs: [box(0, 150, -150, 800, 300, 300)] });
  w.enter({ x: 0, y: 0, z: 3, yaw: 0 });
  const s = walkFor(w, 1.5, { dt: 1 / 20, run: true });
  ok(s.pz >= 3 - 0.01, `${key}: starting 3u from a 300u-thick block, the body stays out of it (z ${s.pz.toFixed(1)})`);
}

console.log('\n[knee slice]');
for (const [key, M] of profiles) {
  // just above a step, the capsule's rounded bottom is narrower than its radius: a knee-high box stops it closer than r
  const r = M.capsuleRadius, knee = M.stepHeight + 0.01;
  if (knee >= r) continue;
  const kneeR = Math.sqrt(r * r - (r - knee) ** 2);
  if (r - kneeR < 3) continue;                     // too little difference to tell at this frame step
  const h = M.stepHeight + 3;                     // a wall to the knee slice, below the r slice
  const { w } = setup({ metrics: M, objs: [box(0, h / 2, -100, 800, h, 200)] });   // front face at z = 0
  w.enter({ x: 0, y: 0, z: 200, yaw: 0 });
  const dt = 1 / 144, s = walkFor(w, 2, { dt });
  ok(s.pz > kneeR - 0.01 && s.pz < kneeR + M.walkSpeed * dt + 0.01, `${key}: a ${h}u box stops the body at its knee width (z ${s.pz.toFixed(1)}, knee ${kneeR.toFixed(1)}, radius ${r})`);
}

console.log('\n[large meshes]');
{
  // imported meshes go through a spatial grid: the same answers, at the cost of a box
  const M = profileMetrics('ue-third');
  const terrainMesh = () => {
    const g = new THREE.PlaneGeometry(8000, 8000, 223, 223);   // ~100k triangles
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, 20 + 10 * Math.sin(pos.getX(i) / 300) * Math.cos(pos.getZ(i) / 300));
    const t = new THREE.Mesh(g, new THREE.MeshLambertMaterial()); t.updateMatrixWorld(true);
    return t;
  };
  const terrain = terrainMesh();
  const wallGeo = new THREE.PlaneGeometry(2000, 400, 100, 20);   // a finely subdivided imported wall, at z = -300
  const wall = new THREE.Mesh(wallGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }));
  wall.position.set(0, 200, -300); wall.updateMatrixWorld(true);
  const boxes = Array.from({ length: 200 }, (_, i) => box((i % 20) * 300 - 3000, 50, Math.floor(i / 20) * 300 - 4000, 100, 100, 100));
  const objs = [terrain, wall, ...boxes];
  const { w } = setup({ metrics: M, objs });
  w.enter({ x: 150, y: 50, z: 150, yaw: 0 });
  const heightAt = (x, z) => 20 + 10 * Math.sin(x / 300) * Math.cos(z / 300);
  ok(Math.abs(w._state().feetY - heightAt(150, 150)) < 0.2, `starts on a 100k-triangle terrain at its height (${w._state().feetY.toFixed(2)} vs ${heightAt(150, 150).toFixed(2)})`);
  w._press('KeyW');
  for (let i = 0; i < 5; i++) w.update(1 / 60);
  const t0 = performance.now();
  let n = 0, worst = 0;
  // the body rests on the ground under its centre, or on higher ground under its edge (0.9 × radius), never above or below that
  const R = M.capsuleRadius * 0.9;
  const highest = (x, z) => Math.max(heightAt(x, z), ...Array.from({ length: 8 }, (_, k) => heightAt(x + Math.cos(k * Math.PI / 4) * R, z + Math.sin(k * Math.PI / 4) * R)));
  for (; n < 120; n++) {
    w.update(1 / 60);
    const st = w._state();
    worst = Math.max(worst, heightAt(st.px, st.pz) - st.feetY, st.feetY - highest(st.px, st.pz));
  }
  const ms = (performance.now() - t0) / n;
  w._release('KeyW');
  ok(worst < 0.2, `the feet follow the terrain under the body (worst ${worst.toFixed(2)}u outside it)`);
  ok(w._state().pz > -300 + M.capsuleRadius - 11 && w._state().pz < -200, `a subdivided imported wall blocks (z ${w._state().pz.toFixed(1)})`);
  ok(ms < 5, `a frame costs ${ms.toFixed(2)} ms with a 100k-triangle terrain, a 2000-triangle wall and 200 boxes (was 88 ms in 0.9.0)`);
}

console.log('\n[falls and landing]');
for (const [drop, falls] of [[45, false], [45.5, true]]) {
  // UE step height 45: a drop of exactly a step is stepped down, anything more is a fall
  const M = profileMetrics('ue-third');
  const { w } = setup({ metrics: M, objs: [box(0, drop / 2, 150, 600, drop, 300)] });
  w.enter({ x: 0, y: drop, z: 150, yaw: 0 });
  let fell = false;
  w._press('KeyW');
  for (let i = 0; i < 40; i++) { w.update(1 / 60); if (w._state().airborne) fell = true; }
  w._release('KeyW');
  ok(fell === falls, `walking off a ${drop}u ledge (step height 45) ${falls ? 'falls' : 'steps down'}`);
}
for (const [key, M] of profiles) {
  // running down a 44° ramp at 20 fps (walk mode's slowest step) must not count as falling
  const len = 400, h = len * Math.tan(44 * Math.PI / 180);
  const { w } = setup({ metrics: M, objs: [mesh('wedge', null, [0, h / 2, 0], [200, h, len])] });
  w.enter({ x: 0, y: h, z: -len / 2 + 5, yaw: Math.PI });   // on the top edge, facing down the slope (+Z)
  let fell = false;
  w._press('KeyW'); w._press('ShiftLeft');
  for (let i = 0; i < 30; i++) { w.update(1 / 20); if (w._state().airborne) fell = true; }
  w._release('KeyW'); w._release('ShiftLeft');
  ok(!fell && w._state().feetY < 1, `${key} runs down a 44° ramp at 20 fps without falling (feet ${w._state().feetY.toFixed(1)})`);
}
{
  const M = profileMetrics('ue-third');
  const { w } = setup({ metrics: M, objs: [box(0, 100, 0, 400, 200, 400)] });
  w.enter({ x: 0, y: 200, z: 0, yaw: 0 });
  ok(Math.abs(w._state().feetY - 200) < 0.01, 'starts on a 200u platform');
  // off the edge (z -200) the feet leave the platform only by falling: never a glide on the ground
  let fell = false, glided = false;
  w._press('KeyW');
  for (let i = 0; i < 36; i++) {
    w.update(1 / 60);
    const st = w._state();
    if (st.airborne && !st.jumping) fell = true;
    if (!st.airborne && st.feetY > 0.01 && st.feetY < 199.99) glided = true;
  }
  w._release('KeyW');
  ok(fell && !glided, `walking off the edge falls instead of gliding down (fell ${fell}, glided ${glided})`);
  for (let i = 0; i < 120 && w._state().airborne; i++) w.update(1 / 60);
  ok(!w._state().airborne && Math.abs(w._state().feetY) < 0.01, 'and lands on the ground');
  // a step up moves the body at once and eases only the view
  const { w: w2 } = setup({ metrics: M, objs: [box(0, 20, -150, 300, 40, 200)] });
  w2.enter({ x: 0, y: 0, z: 150, yaw: 0 });
  w2._press('KeyW');
  let eased = false;
  for (let i = 0; i < 45; i++) {             // 375u: onto the box (z -50..-250), not off its far end
    w2.update(1 / 60);
    const st = w2._state();
    if (Math.abs(st.feetY - 40) < 0.01 && st.viewFeet < 39) eased = true;
  }
  ok(eased && Math.abs(w2._state().viewFeet - 40) < 0.5, 'a 40u step puts the feet on it at once and eases the camera up');
}
{
  // a 300u fall at 20 fps drops ~50u a frame: it must still land on a 2u slab, which it passes through between frames
  const M = profileMetrics('ue-third');
  const objs = [box(0, 200, 100, 600, 400, 200), box(0, 99, -400, 600, 2, 600)];   // tower (top 400, z 0..200), slab (top 100, z -100..-700)
  const { w } = setup({ metrics: M, objs });
  w.enter({ x: 0, y: 400, z: 150, yaw: 0 });
  w._press('KeyW');
  let fastest = 0;
  for (let i = 0; i < 40 && !(w._state().feetY < 399 && !w._state().airborne); i++) {
    const y = w._state().feetY; w.update(1 / 20); fastest = Math.max(fastest, y - w._state().feetY);
  }
  w._release('KeyW');
  const s = w._state();
  ok(!s.airborne && Math.abs(s.feetY - 100) < 0.01 && fastest > 10, `a fall at 20 fps lands on a 2u slab (feet ${s.feetY.toFixed(1)}, fastest ${fastest.toFixed(0)}u a frame)`);
}
{
  // floors are found by a downward ray: a one-sided face seen from behind is not there (a ceiling panel at knee height)
  const M = profileMetrics('ue-third');
  const g = new THREE.PlaneGeometry(600, 400); g.rotateX(Math.PI / 2);   // faces down
  const panel = new THREE.Mesh(g, new THREE.MeshLambertMaterial()); panel.position.set(0, 30, -200); panel.updateMatrixWorld(true);
  const { w } = setup({ metrics: M, objs: [panel] });
  w.enter({ x: 0, y: 0, z: 150, yaw: 0 });
  const s = walkFor(w, 1);
  ok(s.top < 0.01 && s.pz < -100, `a down-facing panel ${30}u up is not a floor: the body walks under it (feet ${s.top.toFixed(1)}, z ${s.pz.toFixed(0)})`);
}

console.log('\n[jump arc]');
for (const [key, M] of profiles) {
  // every frame's feet lie on the profile's parabola (apex jumpHeight, reach jumpDistance at run speed),
  // whatever the frame rate: stepping the velocity per frame overshot both by 4-12%
  const h = M.jumpHeight, d = M.jumpDistance, row = [];
  let bad = false;
  for (const fps of [20, 30, 60, 144]) {
    const dt = 1 / fps;
    const { w } = setup({ metrics: M });
    w.enter({ x: 0, y: 0, z: 0, yaw: 0 });
    w._press('KeyW'); w._press('ShiftLeft');
    w.update(dt);
    const z0 = w._state().pz;
    w._press('Space');
    let apex = 0, off = 0, n = 0, reach = 0;
    do {
      w.update(dt); n++;
      const st = w._state(), u = (z0 - st.pz) / d;
      if (st.airborne) { apex = Math.max(apex, st.feetY); off = Math.max(off, Math.abs(st.feetY - 4 * h * u * (1 - u))); }
      else reach = z0 - st.pz;
    } while (w._state().airborne && n < 1000);
    w._release('KeyW'); w._release('ShiftLeft');
    const T = d / M.runSpeed;
    if (off > 1e-6 || apex > h + 1e-6 || apex < h * (1 - (dt / T) ** 2) || reach < d - 1e-6 || reach > d + M.runSpeed * dt + 1e-6) bad = true;
    row.push(`${fps} fps apex ${apex.toFixed(2)} reach ${reach.toFixed(1)}`);
  }
  ok(!bad, `${key}: a running jump follows its ${h}u / ${d}u arc at every frame rate (${row.join(', ')})`);
}

console.log('\n[level changes between walks]');
{
  // collision geometry is cached per mesh: moving a wall, or changing its geometry, is seen by the next walk
  const M = profileMetrics('ue-third'), r = M.capsuleRadius;
  const wall = box(0, 150, -100, 800, 300, 20);            // front face at z = -90
  const { w } = setup({ metrics: M, objs: [wall] });
  const stopAt = () => { w.enter({ x: 0, y: 0, z: 200, yaw: 0 }); const s = walkFor(w, 2); w.exit(); return s.pz; };
  const z1 = stopAt();
  wall.position.z = -400; wall.updateMatrixWorld(true);
  const z2 = stopAt();
  const pos = wall.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + 0.5);   // the unit cube shifts 0.5 along its own z: 10u in the world
  pos.needsUpdate = true;
  const z3 = stopAt();
  const near = (z, face) => z > face + r - 0.01 && z < face + r + M.walkSpeed / 60 + 0.01;   // at most a frame short of contact
  ok(near(z1, -90) && near(z2, -390) && near(z3, -380), `the body stops at the wall where it is now (z ${[z1, z2, z3].map(z => z.toFixed(1)).join(', ')}; faces at -90, -390, -380)`);
}

console.log('\n[input]');
{
  const M = profileMetrics('ue-third');
  const { w } = setup({ metrics: M });
  w.enter({ x: 0, y: 0, z: 0, yaw: 0 });
  fire('win', 'keydown', { code: 'Space' });
  let jumps = 0, was = false;
  for (let i = 0; i < 180; i++) {             // Space held 3 s: auto-repeat sends a keydown every ~33 ms
    if (i % 2 === 0) fire('win', 'keydown', { code: 'Space', repeat: true });
    w.update(1 / 60);
    const a = w._state().airborne; if (a && !was) jumps++; was = a;
  }
  fire('win', 'keyup', { code: 'Space' });
  ok(jumps === 1, `holding Space jumps once (${jumps})`);
  // a press in mid-air, held through the landing, does not jump again
  fire('win', 'keydown', { code: 'Space' });
  w.update(1 / 60);
  for (let i = 0; i < 10; i++) w.update(1 / 60);
  fire('win', 'keydown', { code: 'Space' });               // pressed again while airborne, and held
  jumps = 0; was = w._state().airborne;
  for (let i = 0; i < 180; i++) { w.update(1 / 60); const a = w._state().airborne; if (a && !was) jumps++; was = a; }
  fire('win', 'keyup', { code: 'Space' });
  ok(!w._state().airborne && jumps === 0, `a Space pressed in mid-air and held through the landing does not jump again (${jumps})`);
  w.exit();
}

console.log('\n[mannequin animation]');
{
  const mq = await loadMannequin();
  const M = profileMetrics('ue-third');
  const views = [];
  const { w } = setup({ metrics: M, mannequin: mq, views });
  w.enter({ x: 0, y: 0, z: 0, yaw: 0 }, 'third');
  ok(views.length === 1 && views[0][1] === false, 'entering walk mode reports its view as not chosen by the user: ' + JSON.stringify(views));
  const ran = walkFor(w, 1, { run: true });
  ok(ran.action === 'running' && Math.abs(ran.speed - M.runSpeed) < 0.01, `runs at ${M.runSpeed} u/s with the run clip (${ran.speed.toFixed(1)} u/s, ${ran.action})`);
  fire('win', 'keydown', { code: 'KeyV' });
  for (let i = 0; i < 10; i++) w.update(1 / 60);
  fire('win', 'keydown', { code: 'KeyV' });
  ok(views.length === 3 && views[1][1] === true && views[2][1] === true, 'V reports a chosen view: ' + JSON.stringify(views));
  for (let i = 0; i < 120; i++) w.update(1 / 60);
  const running = Object.entries(mq.actions).filter(([, a]) => a.isRunning() && a.getEffectiveWeight() > 0.01).map(([n]) => n);
  ok(running.join() === 'idle', 'after V twice and standing still, only idle plays: ' + running.join());

  // jump: clip at its take-off key as the feet leave, at its touchdown key as they land, then the absorb
  const jump = mq.clips.find(c => c.name === 'jump'), { takeoff, touchdown } = jump.userData;
  ok(takeoff > 0 && touchdown > takeoff && touchdown < jump.duration, `jump clip carries its take-off (${takeoff}) and touchdown (${touchdown}) keys`);
  w._press('Space'); w.update(1 / 60); w._release('Space');
  const t0 = mq.actions.jump.time;
  ok(w._state().airborne && Math.abs(t0 - takeoff) < 0.05, `on launch the clip is at take-off (${t0.toFixed(3)})`);
  let apexClip = 0, apex = 0;
  while (w._state().airborne) { w.update(1 / 60); if (w._state().feetY > apex) { apex = w._state().feetY; apexClip = mq.actions.jump.time; } }
  const mid = (takeoff + touchdown) / 2;
  ok(Math.abs(apexClip - mid) < 0.05, `at the apex the clip is midway through the air phase (${apexClip.toFixed(3)} vs ${mid.toFixed(3)})`);
  ok(Math.abs(mq.actions.jump.time - touchdown) < 0.03, `on landing the clip is at touchdown (${mq.actions.jump.time.toFixed(3)})`);
  let absorb = 0, absorbTo = 0;
  while (w._state().action === 'jump' && absorb < 2) { w.update(1 / 60); absorb += 1 / 60; absorbTo = Math.max(absorbTo, mq.actions.jump.time); }
  ok(absorb > (jump.duration - touchdown) * 0.8 && w._state().action === 'idle', `the landing absorb plays (${absorb.toFixed(2)} s) before idle`);
  ok(absorbTo > touchdown + (jump.duration - touchdown) * 0.8, `and the clip runs on through it (to ${absorbTo.toFixed(3)} of ${jump.duration.toFixed(3)})`);
  // landing while running blends straight into the run instead
  w._press('KeyW'); w._press('ShiftLeft');
  for (let i = 0; i < 30; i++) w.update(1 / 60);
  w._press('Space'); w.update(1 / 60); w._release('Space');
  while (w._state().airborne) w.update(1 / 60);
  w.update(1 / 60);
  ok(w._state().action === 'running', 'landing on the move goes straight back to running: ' + w._state().action);
  w._release('KeyW'); w._release('ShiftLeft');
  // the clip's own keys drive it, not the estimates used when a clip lacks them (the mannequin's are close to those)
  {
    const saved = { ...jump.userData };
    jump.userData.takeoff = 0.1 * jump.duration; jump.userData.touchdown = 0.5 * jump.duration;
    for (let i = 0; i < 90; i++) w.update(1 / 60);
    w._press('Space'); w.update(1 / 60); w._release('Space');
    const launch = mq.actions.jump.time;
    while (w._state().airborne) w.update(1 / 60);
    const down = mq.actions.jump.time;
    Object.assign(jump.userData, saved);
    ok(Math.abs(launch - 0.1 * jump.duration) < 0.05 && Math.abs(down - 0.5 * jump.duration) < 0.03,
      `a clip's own take-off and touchdown keys place it (${launch.toFixed(3)} and ${down.toFixed(3)} for keys ${(0.1 * jump.duration).toFixed(3)} and ${(0.5 * jump.duration).toFixed(3)})`);
  }
  w.exit();
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
