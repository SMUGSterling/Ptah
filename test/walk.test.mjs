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
  for (const [h, climb] of [[M.stepHeight, true], [M.stepHeight + 3, false]]) {
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
    ok(s.pz > 16 + r * 0.5, `${key}: a ${gap}u slit stops the ${2 * r}u-wide body before the wall (z ${s.pz.toFixed(1)}, wall face 16)`);
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
    // the Doorway preset is sized for this profile and must be passable
    const door = presetSpecs(M).doorway.objects.map(fromSpec);
    const { w } = setup({ metrics: M, objs: door });
    w.enter({ x: 0, y: 0, z: 300, yaw: 0 });
    ok(walkFor(w, 2).pz < -50, `${key}: the Doorway preset (${M.doorWidth}u) is walkable`);
  }
}

console.log('\n[falls and landing]');
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
  const s = walkFor(w, 0.6);
  ok(s.airborne && !s.jumping || s.feetY < 199, `walking off the edge falls instead of gliding down (${JSON.stringify({ airborne: s.airborne, feetY: +s.feetY.toFixed(1) })})`);
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
  walkFor(w, 1, { run: true });
  ok(w._state().action === 'running', 'runs at 500 u/s');
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
  let absorb = 0;
  while (w._state().action === 'jump' && absorb < 2) { w.update(1 / 60); absorb += 1 / 60; }
  ok(absorb > (jump.duration - touchdown) * 0.8 && w._state().action === 'idle', `the landing absorb plays (${absorb.toFixed(2)} s) before idle`);
  // landing while running blends straight into the run instead
  w._press('KeyW'); w._press('ShiftLeft');
  for (let i = 0; i < 30; i++) w.update(1 / 60);
  w._press('Space'); w.update(1 / 60); w._release('Space');
  while (w._state().airborne) w.update(1 / 60);
  w.update(1 / 60);
  ok(w._state().action === 'running', 'landing on the move goes straight back to running: ' + w._state().action);
  w._release('KeyW'); w._release('ShiftLeft');
  w.exit();
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
