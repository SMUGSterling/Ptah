// walk.js — first- and third-person walk mode.
//
// Walk the blockout with WASD + mouse look (pointer lock). A handful of cheap
// raycasts per frame give the player a round body. A fan of knee-height rays,
// as wide as the capsule, blocks walls, gaps narrower than the body included,
// but passes over anything no taller than a step and up any slope of 45° or
// less (UE's and Unity's default walkable slope). Downward rays at the centre
// and around the capsule's edge find the floor: like a capsule resting on a
// step's edge, the player stands on the highest flat surface under its body,
// so each riser is climbed as soon as the body reaches it, one at a time.
// A drop of more than a step is a fall. Every number comes from the level's metrics profile
// (metrics.js): eye height, crouch height, step height, capsule radius, walk and
// run speed, jump height and distance. Space jumps (a parabola whose apex is
// jumpHeight and whose reach at run speed is jumpDistance); C or Ctrl crouches.
//
// Two views, V switches: first person puts the camera at eye height; third
// person shows the mannequin (character.js) on a boom camera the way Unreal's
// and Unity's third-person templates do: the mouse orbits the camera, input is
// camera-relative, the character turns to face where it moves, and the boom
// shortens when a wall is in the way. It is a scale, cover and sightline check,
// not a character controller: no collision above the knee.

import * as THREE from 'three';

const LOOK_SENSITIVITY = 0.0022;
const BOOM_LENGTH = 400;             // UE5 Third Person template: TargetArmLength 400
const BOOM_MIN = 60;
const BOOM_GROUND_CLEARANCE = 10;    // the grid floor is not a mesh, so the boom stops above it explicitly
// Browsers report the cursor's jump to the lock point as one mousemove when
// pointer lock engages (hundreds of px); a real mouse moves far less per event.
const MAX_LOOK_STEP = 200;
const TURN_RATE = 9;                 // rad/s the mannequin turns toward its movement (UE template RotationRate 500°/s)
const WALKABLE = Math.cos(THREE.MathUtils.degToRad(45));   // a surface this steep or flatter is floor, not wall
const FLAT = Math.cos(THREE.MathUtils.degToRad(5));        // the capsule's edge rests only on (near-)flat surfaces: treads, tops
const KNEE_CLEARANCE = 1;            // the wall rays pass just above step height: a riser exactly stepHeight tall is a step
const RAY_SPACING = 15;              // wall rays across the body at most this far apart: nothing wider slips between them
const EDGE = 0.9;                    // the floor is also sampled this far out (× radius) around the body
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'KeyC', 'ControlLeft', 'ControlRight', 'KeyV']);

// ctrlCrouch: browsers reserve Ctrl+W (close tab) and preventDefault cannot stop it,
// so Ctrl crouches only where the host owns the keyboard (the desktop app).
export function createWalkMode({ camera, orbit, canvas, metrics, collidables, onChange, onView, mannequin, ctrlCrouch = false }) {
  const st = {
    active: false,
    view: 'first',                   // 'first' | 'third'
    yaw: 0,
    pitch: 0,
    keys: new Set(),
    saved: null,                     // camera pose to restore on exit
    raycaster: new THREE.Raycaster(),
    px: 0, pz: 0,                    // player position on the ground plane (the camera is derived from it)
    feetY: 0,                        // authoritative vertical position
    viewFeet: 0,                     // feetY eased for the camera and mannequin, so a step up is not a jolt
    vy: 0,                           // vertical velocity while airborne
    gravity: 0,
    airborne: false,
    jumping: false,                  // airborne from a jump (false: fell off an edge)
    airT: 0,                         // seconds since leaving the ground
    landing: 0,                      // seconds of the jump clip's landing still to play
    crouching: false,
    charYaw: 0,                      // mannequin facing (its +Z axis), radians about Y
    action: null,                    // current animation action name
    speed: 0,                        // last frame's horizontal speed, for the animation state
    vy0: 0,                          // launch velocity of the current jump
    from: null,                      // name of the marker the walk started from
    hadLock: false                   // pointer lock was engaged at some point this walk
  };
  const m = () => metrics();
  const char = () => (typeof mannequin === 'function' ? mannequin() : mannequin) || null;
  const crownToEye = () => Math.max(0, m().playerHeight - m().eyeHeight);   // eye sits this far below the crown
  const eyeHeight = () => Math.max(10, (st.crouching ? m().crouchHeight : m().playerHeight) - crownToEye());
  const stepHeight = () => m().stepHeight;
  const boomTargetHeight = () => m().playerHeight * 0.55;                  // about the capsule centre, like a spring arm socket

  // ---- camera ----
  const _fwd = new THREE.Vector3();
  function lookDir() {                // camera forward for the current yaw/pitch (Euler YXZ)
    const cp = Math.cos(st.pitch);
    return _fwd.set(-cp * Math.sin(st.yaw), Math.sin(st.pitch), -cp * Math.cos(st.yaw));
  }
  function placeCamera() {
    camera.rotation.order = 'YXZ';
    camera.rotation.set(st.pitch, st.yaw, 0);
    if (st.view === 'first') {
      camera.position.set(st.px, st.viewFeet + eyeHeight(), st.pz);
      return;
    }
    const target = new THREE.Vector3(st.px, st.viewFeet + boomTargetHeight(), st.pz);
    const back = lookDir().clone().negate();
    let len = BOOM_LENGTH;
    st.raycaster.set(target, back);
    st.raycaster.far = BOOM_LENGTH;
    const hits = st.raycaster.intersectObjects(collidables(), false);
    st.raycaster.far = Infinity;
    if (hits.length) len = Math.max(BOOM_MIN, hits[0].distance - 12);
    if (back.y < 0) len = Math.min(len, Math.max(BOOM_MIN, (target.y - BOOM_GROUND_CLEARANCE) / -back.y));
    camera.position.copy(target).addScaledVector(back, len);
    camera.position.y = Math.max(camera.position.y, BOOM_GROUND_CLEARANCE);
  }

  // ---- mannequin ----
  function placeMannequin() {
    const c = char();
    if (!c) return;
    c.root.position.set(st.px, st.viewFeet, st.pz);
    c.root.rotation.set(0, st.charYaw, 0);
  }
  function showMannequin(on) {
    const c = char();
    if (!c) return;
    if (on) c.setHeight(m().characterHeight || m().playerHeight);   // the visible body, not the collision capsule
    c.root.visible = on;
  }
  // The templates' cameras are wider than the editor's: UE 90° horizontal,
  // Unity's Cinemachine about 66°. Applied for the walk, restored on exit.
  function applyFov() {
    const h = THREE.MathUtils.degToRad(m().fov || 90);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / camera.aspect));
    camera.updateProjectionMatrix();
  }
  /** Crossfade to a clip by name; `once` clips play to the end and hold. */
  function play(name, { fade = 0.15, once = false, timeScale = 1 } = {}) {
    const c = char();
    if (!c || !c.actions[name]) return;
    const next = c.actions[name];
    if (st.action === name) { next.timeScale = timeScale; return; }
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.timeScale = timeScale;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    const prev = st.action ? c.actions[st.action] : null;
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    st.action = name;
  }
  function animate(dt, moving) {
    const c = char();
    if (!c) return;
    const keys = jumpKeys(c);
    if (st.airborne && keys) {
      // The physics leaves the ground at once, so the clip starts at its take-off
      // key and is driven by the jump itself, reaching its touchdown key as the
      // feet land. A fall off an edge holds the legs-reaching-down pose.
      play('jump', { once: true, fade: 0.08, timeScale: 0 });
      const T = 2 * st.vy0 / Math.max(1, st.gravity);
      const f = st.jumping && T > 0 ? THREE.MathUtils.clamp(st.airT / T, 0, 0.98) : 0.8;
      c.actions.jump.time = keys.takeoff + (keys.touchdown - keys.takeoff) * f;
    } else if (st.landing > 0 && keys && !(moving && st.speed > 1)) {
      play('jump', { once: true, timeScale: 1 });   // the landing absorb, from the touchdown key on
    } else if (moving && st.speed > 1) {
      // walk or run, whichever clip's natural speed is nearer (as a ratio) to how fast the player
      // moves, so neither is sped up too far; crouching always walks
      const walkN = c.clipSpeed('walking') || 160, runN = c.actions.running ? c.clipSpeed('running') : 0;
      const run = runN > 0 && !st.crouching && st.speed > Math.sqrt(walkN * runN);
      play(run ? 'running' : 'walking', { timeScale: THREE.MathUtils.clamp(st.speed / (run ? runN : walkN), 0.6, 2.6) });
    } else {
      play('idle');
    }
    c.mixer.update(dt);
  }

  /** { takeoff, touchdown, duration } of the jump clip, in clip seconds (keys a converted Mixamo clip lacks are estimated). */
  function jumpKeys(c) {
    const clip = c.actions.jump && c.clips.find(x => x.name === 'jump');
    if (!clip) return null;
    const d = clip.duration, u = clip.userData || {};
    return { duration: d, takeoff: u.takeoff ?? 0.26 * d, touchdown: u.touchdown ?? 0.72 * d };
  }

  /**
   * start: optional { x, y, z, yaw, from } — a PlayerStart marker's world pose
   * (yaw in radians, 0 = looking down -Z). Without it the walk begins where the
   * orbit camera was looking, facing the way it faced.
   * view: 'first' | 'third'; defaults to the last view used.
   */
  function enter(start = null, view = st.view) {
    if (st.active) return;
    st.saved = { pos: camera.position.clone(), quat: camera.quaternion.clone(), target: orbit.target.clone(), fov: camera.fov };
    applyFov();
    const dir = camera.getWorldDirection(new THREE.Vector3());
    st.yaw = start && typeof start.yaw === 'number' ? start.yaw : Math.atan2(-dir.x, -dir.z);
    st.pitch = 0;
    st.from = start && start.from ? start.from : null;
    st.crouching = false; st.airborne = false; st.jumping = false; st.vy = 0; st.speed = 0; st.airT = 0; st.landing = 0;
    st.px = start ? start.x : orbit.target.x; st.pz = start ? start.z : orbit.target.z;
    // stand on whatever is under the start point (a PlayerStart on a platform starts on the platform)
    st.feetY = st.viewFeet = floorAt(st.px, st.pz, start && typeof start.y === 'number' ? start.y + stepHeight() + 1 : 1e6);
    st.charYaw = st.yaw + Math.PI;       // the mannequin's forward is its +Z; the camera looks down -Z at yaw 0
    st.view = view === 'third' && char() ? 'third' : 'first';
    st.action = null;
    const c = char();
    if (c) { c.mixer.stopAllAction(); showMannequin(st.view === 'third'); placeMannequin(); if (st.view === 'third') animate(0, false); }
    placeCamera();
    orbit.enabled = false;
    st.active = true;
    st.keys.clear();
    try {
      const p = canvas.requestPointerLock && canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* pointer lock unavailable (headless, iframe): mouse-drag look still works */ }
    onChange(true);
    if (onView) onView(st.view, false);
  }

  function exit() {
    if (!st.active) return;
    st.active = false;
    st.keys.clear();
    showMannequin(false);
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    camera.rotation.order = 'XYZ';
    if (st.saved) {
      camera.position.copy(st.saved.pos);
      camera.quaternion.copy(st.saved.quat);
      orbit.target.copy(st.saved.target);
      camera.fov = st.saved.fov; camera.updateProjectionMatrix();
    }
    orbit.enabled = true;
    onChange(false);
  }

  function toggle(start = null, view) { st.active ? exit() : enter(start, view); }

  /** chosen: the user picked this view (V), so the host may keep it for later walks. */
  function setView(view, chosen = false) {
    if (view === 'third' && !char()) return;
    st.view = view === 'third' ? 'third' : 'first';
    if (!st.active) return;
    st.pitch = THREE.MathUtils.clamp(st.pitch, -1.3, 0.9);
    showMannequin(st.view === 'third');
    if (st.view === 'third') {
      // the clip left playing when third person was last shown still has full
      // weight (the mixer is not run in first person): start clean
      char().mixer.stopAllAction();
      st.action = null; animate(0, false); placeMannequin();
    }
    placeCamera();
    if (onView) onView(st.view, chosen);
  }

  // ---- input ----
  let dragging = false;
  document.addEventListener('mousemove', (e) => {
    if (!st.active) return;
    if (document.pointerLockElement !== canvas && !dragging) return;
    if (Math.abs(e.movementX) > MAX_LOOK_STEP || Math.abs(e.movementY) > MAX_LOOK_STEP) return;
    st.yaw -= e.movementX * LOOK_SENSITIVITY;
    const lim = st.view === 'third' ? [-1.3, 0.9] : [-1.45, 1.45];
    st.pitch = THREE.MathUtils.clamp(st.pitch - e.movementY * LOOK_SENSITIVITY, lim[0], lim[1]);
    placeCamera();
  });
  canvas.addEventListener('pointerdown', (e) => { if (st.active && e.button === 0) dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    // A lock granted after we already left walk mode (the request is async)
    // must be released, or it blocks pointer capture for the whole session.
    if (locked && !st.active) { document.exitPointerLock(); return; }
    // The browser releases the lock on Esc; treat that as leaving walk mode.
    if (st.active && !locked && st.hadLock) exit();
    st.hadLock = locked;
  });
  window.addEventListener('keydown', (e) => {
    if (!st.active) return;
    if (e.code === 'KeyV' && !e.repeat) { setView(st.view === 'third' ? 'first' : 'third', true); e.preventDefault(); return; }
    if (e.code === 'Space' && e.repeat) { e.preventDefault(); return; }   // one jump per press, however long it is held
    if (MOVE_KEYS.has(e.code)) { st.keys.add(e.code); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { st.keys.delete(e.code); });
  window.addEventListener('blur', () => st.keys.clear());

  // ---- physics-lite ----
  const down = new THREE.Vector3(0, -1, 0);
  const _o = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
  function cast(origin, dir, far) {
    st.raycaster.set(origin, dir);
    st.raycaster.far = far;
    const hits = st.raycaster.intersectObjects(collidables(), false);
    st.raycaster.far = Infinity;
    return hits;
  }
  /** |y| of the hit face's world normal: 1 = flat, 0 = vertical (objects are often scaled non-uniformly). */
  function normalY(hit) {
    if (!hit.face) return 1;
    return Math.abs(_n.copy(hit.face.normal).applyMatrix3(_nm.getNormalMatrix(hit.object.matrixWorld)).normalize().y);
  }
  /** Height of the first surface below (x, fromY, z), or the grid (0). flatOnly: a sloped surface there is ignored (-Infinity). */
  function floorAt(x, z, fromY, flatOnly = false) {
    const hits = cast(_o.set(x, fromY, z), down, fromY + 10);
    if (!hits.length) return 0;
    if (flatOnly && normalY(hits[0]) < FLAT) return -Infinity;
    return Math.max(0, hits[0].point.y);
  }
  /** What the body stands on: the floor under its centre, or a higher flat surface under its edge. */
  function support(x, z, fromY) {
    const R = m().capsuleRadius * EDGE;
    let best = floorAt(x, z, fromY);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      best = Math.max(best, floorAt(x + Math.cos(a) * R, z + Math.sin(a) * R, fromY, true));
    }
    return best;
  }

  /** Would the body, moving `dist` along the horizontal unit `dir`, run into a wall at knee height? */
  const _perp = new THREE.Vector3(), _ray = new THREE.Vector3();
  function blocked(knee, dir, dist) {
    const r = m().capsuleRadius, n = Math.max(1, Math.ceil(r / RAY_SPACING));
    _perp.set(dir.z, 0, -dir.x);
    for (let i = -n; i <= n; i++) {
      const off = r * i / n;
      // The front of a round body: rays off the centre line reach less far
      // ahead. Each reaches as far as the circle does at the next ray inward,
      // so the rays bound the circle from outside and nothing between two of them slips in.
      const inner = r * Math.max(0, Math.abs(i) - 1) / n;
      const reach = dist + Math.sqrt(r * r - inner * inner);
      const hits = cast(_ray.copy(knee).addScaledVector(_perp, off), dir, reach);
      if (hits.some(h => normalY(h) < WALKABLE)) return true;     // a ramp's face is floor, not wall
    }
    return false;
  }

  // Jump: symmetric parabola with apex jumpHeight whose total air time T puts
  // a running jump exactly jumpDistance forward. h = g T^2 / 8, v0 = 4 h / T.
  function gravity() {
    const { jumpHeight: h, jumpDistance: d, runSpeed } = m();
    const T = Math.max(0.05, d / Math.max(1, runSpeed));
    return { g: 8 * h / (T * T), v0: 4 * h / T };
  }
  function jump() {
    const { g, v0 } = gravity();
    st.gravity = g;
    st.vy = st.vy0 = v0;
    st.airborne = true; st.jumping = true; st.airT = 0; st.landing = 0;
  }
  function fall() {
    st.gravity = gravity().g;
    st.vy = st.vy0 = 0;
    st.airborne = true; st.jumping = false; st.airT = 0; st.landing = 0;
  }
  function land(floor) {
    st.feetY = st.viewFeet = floor; st.airborne = false; st.vy = 0;   // the air arc was real: no easing into the landing
    const c = char(), keys = c && jumpKeys(c);
    if (keys && st.action === 'jump') { c.actions.jump.time = keys.touchdown; st.landing = keys.duration - keys.touchdown; }
  }

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
  const knee = new THREE.Vector3(), axis = new THREE.Vector3();
  function update(dt) {
    if (!st.active) return;
    dt = Math.min(dt, 1 / 20);       // a hidden tab or a hitch must not become a 2-second free fall through the level
    const k = st.keys;
    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    st.crouching = !st.airborne && (k.has('KeyC') || (ctrlCrouch && (k.has('ControlLeft') || k.has('ControlRight'))));
    const speed = st.crouching ? m().walkSpeed * 0.5 : running ? m().runSpeed : m().walkSpeed;
    fwd.set(-Math.sin(st.yaw), 0, -Math.cos(st.yaw));
    right.set(Math.cos(st.yaw), 0, -Math.sin(st.yaw));
    move.set(0, 0, 0);
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(fwd);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);

    if (k.has('Space') && !st.airborne) { jump(); k.delete('Space'); }   // one jump per press

    const moving = move.lengthSq() > 0;
    let moved = 0;
    if (moving) {
      move.normalize();
      const dist = speed * dt;
      knee.set(st.px, st.feetY + stepHeight() + KNEE_CLEARANCE, st.pz);
      if (!blocked(knee, move, dist)) {
        st.px += move.x * dist; st.pz += move.z * dist; moved = dist;
      } else {
        // slide along the wall: try each axis separately
        if (move.x && !blocked(knee, axis.set(Math.sign(move.x), 0, 0), dist)) { st.px += move.x * dist; moved = dist * Math.abs(move.x); }
        else if (move.z && !blocked(knee, axis.set(0, 0, Math.sign(move.z)), dist)) { st.pz += move.z * dist; moved = dist * Math.abs(move.z); }
      }
      // the mannequin turns to face where it is going (orient rotation to movement)
      const want = Math.atan2(move.x, move.z);
      let d = want - st.charYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      st.charYaw += THREE.MathUtils.clamp(d, -TURN_RATE * dt, TURN_RATE * dt);
    }
    st.speed = dt > 0 ? moved / dt : 0;

    if (st.airborne) {
      const prevFeet = st.feetY;
      st.airT += dt;
      st.feetY += st.vy * dt;
      st.vy -= st.gravity * dt;
      if (st.vy <= 0) {
        // Landing is a sweep, not a point test: the highest surface below where
        // the feet WERE (plus a step) is where they land if the feet have now
        // reached or passed it. Casting from the new position tunnelled through
        // any floor thinner than one frame of fall.
        const floor = support(st.px, st.pz, prevFeet + stepHeight() + KNEE_CLEARANCE);
        if (floor >= st.feetY && floor <= prevFeet + stepHeight() + KNEE_CLEARANCE) land(floor);
      }
    } else {
      // follow the floor (stairs, ramps, platforms); more than a step down is a fall
      // (plus this frame's travel: walking down a 45° slope drops that much)
      const floor = support(st.px, st.pz, st.feetY + stepHeight() + KNEE_CLEARANCE);
      if (floor < st.feetY - stepHeight() - KNEE_CLEARANCE - moved) fall();
      else st.feetY = floor;
      st.landing = Math.max(0, st.landing - dt);
    }
    st.viewFeet = st.airborne ? st.feetY : st.viewFeet + (st.feetY - st.viewFeet) * Math.min(1, dt * 14);
    if (st.view === 'third') { placeMannequin(); animate(dt, moving); }
    placeCamera();
  }

  return {
    get active() { return st.active; },
    get from() { return st.from; },
    get view() { return st.view; },
    enter, exit, toggle, update, setView,
    get eyeHeight() { return eyeHeight(); },
    applyFov,
    // for tests
    _state: () => ({ crouching: st.crouching, airborne: st.airborne, jumping: st.jumping, landing: st.landing, feetY: st.feetY, viewFeet: st.viewFeet, vy: st.vy, view: st.view, px: st.px, pz: st.pz, charYaw: st.charYaw, action: st.action, speed: st.speed }),
    _press: (code) => st.keys.add(code),
    _release: (code) => st.keys.delete(code),
    _look: (yaw, pitch) => { st.yaw = yaw; st.pitch = pitch; placeCamera(); },
    _fov: () => camera.fov
  };
}
