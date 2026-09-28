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
  // starting exactly on its face (a PlayerStart placed against it): no side crossed yet, so the solid's side counts as across
  for (const fps of [20, 60]) {
    const { w: w2 } = setup({ metrics: M, objs: [box(0, 150, -150, 800, 300, 300)] });
    w2.enter({ x: 0, y: 0, z: 0, yaw: 0 });
    const into = walkFor(w2, 1.5, { dt: 1 / fps, run: true }).pz;
    w2._look(Math.PI, 0);
    const out = walkFor(w2, 1, { dt: 1 / fps }).pz;
    ok(into >= -0.01 && out > M.capsuleRadius, `${key}: starting on a block's face at ${fps} fps, the body cannot walk into it but can walk away (z ${into.toFixed(1)}, then ${out.toFixed(1)})`);
  }
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
  // a tap pressed and released between two frames (20 fps: 50 ms apart) still jumps
  const { w: w2 } = setup({ metrics: M });
  w2.enter({ x: 0, y: 0, z: 0, yaw: 0 });
  w2.update(1 / 20);
  fire('win', 'keydown', { code: 'Space' }); fire('win', 'keyup', { code: 'Space' });
  w2.update(1 / 20);
  ok(w2._state().airborne, 'a Space tap shorter than a frame jumps');
  // a press made just before the window loses focus is not kept to jump after it comes back
  while (w2._state().airborne) w2.update(1 / 60);
  fire('win', 'keydown', { code: 'Space' }); fire('win', 'keyup', { code: 'Space' });
  fire('win', 'blur', {});
  w2.update(1 / 20);
  ok(!w2._state().airborne, 'a Space press followed by losing focus does not jump later');
  w2.exit();
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

console.log('\n[third-person camera and frame cost]');
{
  const mq = await loadMannequin();
  const M = profileMetrics('ue-third');
  // the boom stops where a three.js raycast says, for terrain, boxes, a mirrored box, a double-sided plane and a roof
  const g = new THREE.PlaneGeometry(3000, 3000, 60, 60); g.rotateX(-Math.PI / 2);
  const gp = g.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setY(i, 60 * Math.sin(gp.getX(i) / 200) * Math.cos(gp.getZ(i) / 170));
  const hills = new THREE.Mesh(g, new THREE.MeshLambertMaterial()); hills.updateMatrixWorld(true);
  const pl = mesh('plane', null, [0, 150, -250], [600, 1, 300]); pl.rotation.x = Math.PI / 2; pl.material.side = THREE.DoubleSide; pl.updateMatrixWorld(true);
  const objs = [hills, box(200, 100, 150, 100, 200, 100), box(-150, 150, 250, -300, 300, 60), pl, box(0, 300, 0, 400, 20, 400)];
  const { w, camera } = setup({ metrics: M, objs, mannequin: mq });
  w.enter({ x: 0, y: 200, z: 0, yaw: 0 }, 'third');
  const rc = new THREE.Raycaster();
  let worst = 0, blockedBy = 0;
  for (let k = 0; k < 300; k++) {
    w._look(k * 0.37, -1.2 + (k % 37) / 36 * 2);
    const st = w._state();
    const target = new THREE.Vector3(st.px, st.viewFeet + M.playerHeight * 0.55, st.pz);
    const back = camera.position.clone().sub(target).normalize();
    rc.set(target, back); rc.far = 400;
    const hs = rc.intersectObjects(objs, false);
    let len = 400;
    if (hs.length) { len = Math.max(60, hs[0].distance - 12); blockedBy++; }
    // the hills cover the whole area (dipping below the grid), so the grid is never the floor under the camera: only faces stop it
    const want = target.clone().addScaledVector(back, len);
    worst = Math.max(worst, want.distanceTo(camera.position));
  }
  ok(worst < 1e-3 && blockedBy > 100, `the camera boom stops where a three.js raycast does (${blockedBy} of 300 directions blocked, worst ${worst.toExponential(1)}u off)`);
  w.exit();
  {
    // the boom target inside a mesh's bounds: a near face of that mesh counts even when another mesh, searched
    // first, has a hit nearer than where the ray leaves those bounds
    const quad = (z, y0 = 0) => [[-100, y0, z], [100, y0, z], [100, y0 + 300, z], [-100, y0, z], [100, y0 + 300, z], [-100, y0 + 300, z]];
    const pts = [...quad(30).reverse(), ...quad(-300), ...quad(400)].flat();   // the z=30 face turned toward the player
    const gA = new THREE.BufferGeometry(); gA.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const A = new THREE.Mesh(gA, new THREE.MeshLambertMaterial()); A.updateMatrixWorld(true);
    const B = box(0, 150, 200, 400, 300, 100);                                 // a wall whose face is at z = 150
    const { w: wb, camera: cb } = setup({ metrics: M, objs: [B, A], mannequin: mq });
    wb.enter({ x: 0, y: 0, z: 0, yaw: 0 }, 'third');
    wb._look(0, 0);                                                            // the boom runs straight back along +Z
    const st = wb._state(), tgt = new THREE.Vector3(st.px, st.viewFeet + M.playerHeight * 0.55, st.pz);
    rc.set(tgt, cb.position.clone().sub(tgt).normalize()); rc.far = 400;
    const first = rc.intersectObjects([B, A], false)[0];
    ok(first && first.object === A && Math.abs(cb.position.z - Math.max(60, first.distance - 12)) < 1e-6,
      `a near face of the mesh around the boom target stops it (camera z ${cb.position.z.toFixed(1)}; raycast hit at ${first ? first.distance.toFixed(1) : 'none'})`);
    wb.exit();
  }
  // third person over large meshes costs what first person does: the boom goes through the walk's grid, and the level's
  // meshes are asked for once a frame (a three.js raycast took 4.9 ms a frame and 4.4 ms per mouse move)
  const tg = new THREE.PlaneGeometry(8000, 8000, 223, 223); tg.rotateX(-Math.PI / 2);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, 20 + 10 * Math.sin(tp.getX(i) / 300) * Math.cos(tp.getZ(i) / 300));
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial()); terrain.updateMatrixWorld(true);
  let calls = 0;
  const camera2 = new THREE.PerspectiveCamera(60, 1.5, 1, 1e5);
  const w2 = createWalkMode({ camera: camera2, orbit: { target: new THREE.Vector3(), enabled: true }, canvas: Object.assign(target('canvas'), { requestPointerLock() {} }),
    metrics: () => M, collidables: () => { calls++; return [terrain]; }, onChange() {}, mannequin: () => mq });
  w2.enter({ x: 150, y: 50, z: 150, yaw: 0 }, 'third');
  w2._press('KeyW'); w2._press('KeyD');
  for (let i = 0; i < 5; i++) w2.update(1 / 60);
  calls = 0;
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) w2.update(1 / 60);
  const ms = (performance.now() - t0) / 60, frameCalls = calls;
  const t1 = performance.now();
  for (let i = 0; i < 200; i++) w2._look(i * 0.01, -0.2 - (i % 5) * 0.1);
  const look = (performance.now() - t1) / 200;
  w2._release('KeyW'); w2._release('KeyD');
  ok(frameCalls === 60, `the level's meshes are asked for once a frame (${frameCalls} calls in 60 frames; a frame asked 11-12 times)`);
  ok(ms < 2 && look < 0.5, `third person over a 100k-triangle terrain: ${ms.toFixed(2)} ms a frame, ${look.toFixed(3)} ms a mouse move`);
  w2.exit();
}

console.log('\n[jump clip]');
{
  const mq = await loadMannequin();
  const M = profileMetrics('ue-third');
  const J = mq.actions.jump, { touchdown } = mq.clips.find(c => c.name === 'jump').userData;
  const { w } = setup({ metrics: M, mannequin: mq });
  w.enter({ x: 0, y: 0, z: 0, yaw: 0 }, 'third');
  for (let i = 0; i < 30; i++) w.update(1 / 60);
  const jumpAndLand = () => { w._press('Space'); w.update(1 / 60); w._release('Space'); while (w._state().airborne) w.update(1 / 60); };
  // a jump pressed just as the landing absorb ends (the clip has finished and paused): the next landing still plays
  jumpAndLand();
  let n = 0;
  while (!(J.paused && w._state().landing > 0) && w._state().action === 'jump' && n++ < 200) w.update(1 / 60);
  jumpAndLand();
  const times = [];
  while (w._state().action === 'jump' && times.length < 200) { w.update(1 / 60); times.push(J.time); }
  const advanced = times.length > 1 && times.at(-1) - times[0] > (J.getClip().duration - touchdown) * 0.7;
  ok(advanced, `a jump pressed as the last landing ends still plays its own landing (clip ${times[0]?.toFixed(3)} to ${times.at(-1)?.toFixed(3)} over ${times.length} frames)`);
  // landing on the move skips the absorb; stopping right after must not replay the clip from its crouch
  w._press('KeyW'); w._press('ShiftLeft');
  for (let i = 0; i < 30; i++) w.update(1 / 60);
  jumpAndLand();
  w.update(1 / 60); w.update(1 / 60);
  w._release('KeyW'); w._release('ShiftLeft');
  const after = [];
  for (let i = 0; i < 30; i++) { w.update(1 / 60); after.push(w._state().action); }
  ok(!after.includes('jump'), 'stopping just after landing on the move goes to idle, not back into the jump clip: ' + [...new Set(after)].join());
  w.exit();
}

console.log('\n[view during jumps]');
{
  // a jump started while the view is still easing up a step or slope carries the lag and fades it, never snapping
  const M = profileMetrics('ue-third');
  const len = 400, h = len * Math.tan(40 * Math.PI / 180);
  const { w, camera } = setup({ metrics: M, objs: [mesh('wedge', null, [0, h / 2, 0], [200, h, len])] });
  w.enter({ x: 0, y: 0, z: len / 2 + 50, yaw: 0 });
  w._press('KeyW'); w._press('ShiftLeft');
  for (let i = 0; i < 40; i++) w.update(1 / 60);
  const lag = w._state().feetY - w._state().viewFeet, y0 = camera.position.y;
  w._press('Space'); w.update(1 / 60); w._release('Space');
  const rise = camera.position.y - y0;                                  // the camera's rise in the jump's first frame
  const arcStep = M.jumpHeight * 4 / (M.jumpDistance / M.runSpeed) / 60 + M.runSpeed / 60 * Math.tan(40 * Math.PI / 180);
  w._release('KeyW'); w._release('ShiftLeft');
  ok(lag > 10 && rise < arcStep + lag * 0.5, `jumping mid-slope: the camera rises ${rise.toFixed(1)}u in the first frame (the arc and slope give ${arcStep.toFixed(1)}u; the ${lag.toFixed(1)}u lag fades instead of snapping)`);
}

console.log('\n[below the grid]');
{
  const M = profileMetrics('ue-third');
  const mq3 = await loadMannequin();                   // third person needs the mannequin (without it the walk is first person)
  // a PlayerStart on a basement floor whose top is at -300 starts there, not on the grid above it
  const basement = box(0, -310, 0, 800, 20, 800);
  {
    const { w } = setup({ metrics: M, objs: [basement] });
    w.enter({ x: 0, y: -300, z: 0, yaw: 0 });
    ok(Math.abs(w._state().feetY + 300) < 1e-6, `a PlayerStart on a floor at -300 starts there (feet ${w._state().feetY})`);
    const s = walkFor(w, 0.5);
    ok(Math.abs(s.feetY + 300) < 1e-6 && !s.airborne && s.pz < -200, `and walks on it (feet ${s.feetY.toFixed(2)}, z ${s.pz.toFixed(0)})`);
  }
  // walking off the grid into a pit whose floor is at -300 drops into it, and lands
  {
    const pit = box(0, -310, -800, 800, 20, 800);
    const { w } = setup({ metrics: M, objs: [pit] });
    w.enter({ x: 0, y: 0, z: 0, yaw: 0 });
    ok(w._state().feetY === 0, 'the grid is the floor where nothing is built below it');
    walkFor(w, 1.4);                                  // in over the rim, then stop
    for (let i = 0; i < 90; i++) w.update(1 / 60);
    const s = w._state();
    ok(Math.abs(s.feetY + 300) < 1e-6 && !s.airborne && s.pz < -400, `walking over a pit drops into it and lands on its floor (feet ${s.feetY.toFixed(2)}, z ${s.pz.toFixed(0)})`);
  }
  // walking off an underground floor into nothing: a fall, then a respawn at the start once past the kill height
  {
    const ledge = box(0, -310, 0, 200, 20, 200);
    const { w } = setup({ metrics: M, objs: [ledge] });
    w.enter({ x: 0, y: -300, z: 0, yaw: 0 });
    const startYaw = w._state().charYaw;
    let turned = startYaw;
    w._press('KeyD');                                  // strafe off: the mannequin turns to face +X as it goes
    let fell = false, lowest = Infinity, back = false;
    for (let i = 0; i < 60 * 12 && !back; i++) {
      w.update(1 / 60);
      const st = w._state();
      if (st.airborne) { fell = true; turned = st.charYaw; }
      lowest = Math.min(lowest, st.feetY);
      if (fell && !st.airborne && Math.abs(st.feetY + 300) < 1e-6 && Math.abs(st.px) < 1e-6 && Math.abs(st.pz) < 1e-6) back = true;
    }
    w._release('KeyD');
    ok(fell && back && lowest < -320 - 1000 + 50 && isFinite(lowest), `walking off an underground ledge falls, then respawns at the start past the kill height (lowest feet ${lowest.toFixed(0)})`);
    ok(Math.abs(turned - startYaw) > 0.05 && Math.abs(w._state().charYaw - startYaw) < 1e-9, `and the mannequin faces the start's way again (charYaw ${turned.toFixed(3)} before the fall, ${w._state().charYaw.toFixed(3)} after; start ${startYaw.toFixed(3)})`);
  }
  // a surface at the grid still carries you over a pit's rim: nothing changes above ground
  {
    const plate = box(0, -10, 0, 800, 20, 800);
    const { w } = setup({ metrics: M, objs: [plate, box(0, -310, -1000, 400, 20, 400)] });
    w.enter({ x: 0, y: 0, z: 0, yaw: 0 });
    const s = walkFor(w, 0.5);
    ok(Math.abs(s.feetY) < 1e-6 && !s.airborne, `a floor plate at the grid is walked on as before (feet ${s.feetY})`);
  }
  // third person in a basement with a ceiling: the camera stays under the ceiling, not clamped up to the grid
  {
    const ceiling = box(0, -40, 0, 2000, 20, 2000);
    const { w, camera } = setup({ metrics: M, objs: [basement, ceiling], mannequin: mq3 });
    w.enter({ x: 0, y: -300, z: 0, yaw: 0 }, 'third');
    w._look(0, 0.3);                                   // looking a little up: the boom swings down behind, as it would near the grid
    ok(w._state().view === 'third' && camera.position.y < -50 && camera.position.y > -300, `a third-person camera below the grid stays under the ceiling, not lifted to the grid (camera y ${camera.position.y.toFixed(1)})`);
  }
  // a shallow pit (floor 60u below the grid: the camera target is still above it), looking up so the boom
  // swings low: it stops at the pit's floor, not the grid
  {
    const shallow = box(0, -70, 0, 3000, 20, 3000);
    const { w, camera } = setup({ metrics: M, objs: [shallow], mannequin: mq3 });
    w.enter({ x: 0, y: -60, z: 0, yaw: 0 }, 'third');
    w._look(0, 1.2);                                   // looking up: the boom swings low behind
    ok(w._state().view === 'third' && Math.abs(w._state().feetY + 60) < 1e-6 && camera.position.y < -40 && camera.position.y > -60,
      `in a shallow pit the boom stops at the pit floor, not 10u above the grid (camera y ${camera.position.y.toFixed(2)})`);
    // ... while on the grid itself the grid still stops it
    const { w: w2, camera: cam2 } = setup({ metrics: M, objs: [], mannequin: mq3 });
    w2.enter({ x: 0, y: 0, z: 0, yaw: 0 }, 'third');
    w2._look(0, 1.2);
    ok(w2._state().view === 'third' && Math.abs(cam2.position.y - 10) < 1e-6, `on the grid the boom stops 10u above it (camera y ${cam2.position.y.toFixed(2)})`);
  }
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
