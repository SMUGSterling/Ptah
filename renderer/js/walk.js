// walk.js — first- and third-person walk mode.
//
// Walk the blockout with WASD + mouse look (pointer lock). Two cheap raycasts
// per frame give the player a body: a knee-height ray in the direction of
// travel blocks walls but steps over risers, and a downward ray follows floors,
// treads and ramps. Every number comes from the level's metrics profile
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
    vy: 0,                           // vertical velocity while airborne
    gravity: 0,
    airborne: false,
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
      camera.position.set(st.px, st.feetY + eyeHeight(), st.pz);
      return;
    }
    const target = new THREE.Vector3(st.px, st.feetY + boomTargetHeight(), st.pz);
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
    c.root.position.set(st.px, st.feetY, st.pz);
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
    if (st.airborne) {
      // the clip covers take-off to landing; stretch it over the real air time
      const T = Math.max(0.3, 2 * st.vy0 / Math.max(1, st.gravity));
      play('jump', { once: true, fade: 0.08, timeScale: (c.clips.find(x => x.name === 'jump')?.duration || 2) / (T + 0.4) });
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
    st.crouching = false; st.airborne = false; st.vy = 0; st.speed = 0;
    st.px = start ? start.x : orbit.target.x; st.pz = start ? start.z : orbit.target.z;
    // stand on whatever is under the start point (a PlayerStart on a platform starts on the platform)
    st.feetY = floorBelow(st.px, start && typeof start.y === 'number' ? start.y + stepHeight() + 1 : 1e6, st.pz);
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
    if (onView) onView(st.view);
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

  function setView(view) {
    if (view === 'third' && !char()) return;
    st.view = view === 'third' ? 'third' : 'first';
    if (!st.active) return;
    st.pitch = THREE.MathUtils.clamp(st.pitch, -1.3, 0.9);
    showMannequin(st.view === 'third');
    if (st.view === 'third') { st.action = null; animate(0, false); placeMannequin(); }
    placeCamera();
    if (onView) onView(st.view);
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
    if (e.code === 'KeyV' && !e.repeat) { setView(st.view === 'third' ? 'first' : 'third'); e.preventDefault(); return; }
    if (MOVE_KEYS.has(e.code)) { st.keys.add(e.code); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { st.keys.delete(e.code); });
  window.addEventListener('blur', () => st.keys.clear());

  // ---- physics-lite ----
  const down = new THREE.Vector3(0, -1, 0);
  function floorBelow(x, fromY, z) {
    st.raycaster.set(new THREE.Vector3(x, fromY, z), down);
    st.raycaster.far = fromY + 10;
    const hits = st.raycaster.intersectObjects(collidables(), false);
    st.raycaster.far = Infinity;
    return hits.length ? Math.max(0, hits[0].point.y) : 0;
  }

  function blocked(origin, dir, dist) {
    st.raycaster.set(origin, dir);
    st.raycaster.far = dist;
    const hits = st.raycaster.intersectObjects(collidables(), false);
    st.raycaster.far = Infinity;
    return hits.length > 0;
  }

  // Jump: symmetric parabola with apex jumpHeight whose total air time T puts
  // a running jump exactly jumpDistance forward. h = g T^2 / 8, v0 = 4 h / T.
  function jump() {
    const { jumpHeight: h, jumpDistance: d, runSpeed } = m();
    const T = Math.max(0.05, d / Math.max(1, runSpeed));
    st.gravity = 8 * h / (T * T);
    st.vy = st.vy0 = 4 * h / T;
    st.airborne = true;
  }

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
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
      const knee = new THREE.Vector3(st.px, st.feetY + stepHeight(), st.pz);
      const r = m().capsuleRadius;
      if (!blocked(knee, move, dist + r)) {
        st.px += move.x * dist; st.pz += move.z * dist; moved = dist;
      } else {
        // slide along the wall: try each axis separately
        const mx = new THREE.Vector3(move.x, 0, 0), mz = new THREE.Vector3(0, 0, move.z);
        if (mx.lengthSq() > 0 && !blocked(knee, mx.clone().normalize(), dist + r)) { st.px += mx.x * dist; moved = dist * Math.abs(move.x); }
        else if (mz.lengthSq() > 0 && !blocked(knee, mz.clone().normalize(), dist + r)) { st.pz += mz.z * dist; moved = dist * Math.abs(move.z); }
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
      st.feetY += st.vy * dt;
      st.vy -= st.gravity * dt;
      if (st.vy <= 0) {
        // Landing is a sweep, not a point test: the highest surface below where
        // the feet WERE (plus a step) is where they land if the feet have now
        // reached or passed it. Casting from the new position tunnelled through
        // any floor thinner than one frame of fall.
        const floor = floorBelow(st.px, prevFeet + stepHeight() + 1, st.pz);
        if (floor >= st.feetY && floor <= prevFeet + stepHeight()) { st.feetY = floor; st.airborne = false; st.vy = 0; }
      }
    } else {
      // follow the floor (stairs, ramps, platforms); drop to the grid if nothing is below
      const floor = floorBelow(st.px, st.feetY + stepHeight() + 1, st.pz);
      st.feetY += (floor - st.feetY) * Math.min(1, dt * 14);
    }
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
    _state: () => ({ crouching: st.crouching, airborne: st.airborne, feetY: st.feetY, vy: st.vy, view: st.view, px: st.px, pz: st.pz, charYaw: st.charYaw, action: st.action, speed: st.speed }),
    _press: (code) => st.keys.add(code),
    _release: (code) => st.keys.delete(code),
    _look: (yaw, pitch) => { st.yaw = yaw; st.pitch = pitch; placeCamera(); },
    _fov: () => camera.fov
  };
}
