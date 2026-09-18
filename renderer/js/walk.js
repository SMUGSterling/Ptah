// walk.js — first-person walk mode.
//
// Drops the camera to the player's eye height and lets you walk the blockout
// with WASD + mouse look (pointer lock). Two cheap raycasts per frame give it
// a body: a knee-height ray in the direction of travel blocks walls but steps
// over risers, and a downward ray follows floors, treads and ramps. Every
// number comes from the level's metrics profile (metrics.js): eye height,
// crouch height, step height, walk and run speed, jump height and distance.
// Space jumps (a parabola whose apex is jumpHeight and whose reach at run
// speed is jumpDistance); C or Ctrl crouches. It is a scale, cover and
// sightline check, not a character controller: no collision above the knee.

import * as THREE from 'three';

const LOOK_SENSITIVITY = 0.0022;
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'KeyC', 'ControlLeft', 'ControlRight']);

export function createWalkMode({ camera, orbit, canvas, metrics, collidables, onChange }) {
  const st = {
    active: false,
    yaw: 0,
    pitch: 0,
    keys: new Set(),
    saved: null,                     // camera pose to restore on exit
    raycaster: new THREE.Raycaster(),
    feetY: 0,                        // authoritative vertical position (camera.y = feetY + eye)
    vy: 0,                           // vertical velocity while airborne
    gravity: 0,
    airborne: false,
    crouching: false
  };
  const m = () => metrics();
  const crownToEye = () => Math.max(0, m().playerHeight - m().eyeHeight);   // eye sits this far below the crown
  const eyeHeight = () => Math.max(10, (st.crouching ? m().crouchHeight : m().playerHeight) - crownToEye());
  const stepHeight = () => m().stepHeight;

  function applyLook() {
    camera.rotation.order = 'YXZ';
    camera.rotation.set(st.pitch, st.yaw, 0);
  }

  /**
   * start: optional { x, y, z, yaw, from } — a PlayerStart marker's world pose
   * (yaw in radians, 0 = looking down -Z). Without it the walk begins where the
   * orbit camera was looking, facing the way it faced.
   */
  function enter(start = null) {
    if (st.active) return;
    st.saved = { pos: camera.position.clone(), quat: camera.quaternion.clone(), target: orbit.target.clone() };
    const dir = camera.getWorldDirection(new THREE.Vector3());
    st.yaw = start && typeof start.yaw === 'number' ? start.yaw : Math.atan2(-dir.x, -dir.z);
    st.pitch = 0;
    st.from = start && start.from ? start.from : null;
    st.crouching = false; st.airborne = false; st.vy = 0;
    const sx = start ? start.x : orbit.target.x, sz = start ? start.z : orbit.target.z;
    camera.position.set(sx, eyeHeight(), sz);
    // stand on whatever is under the start point (a PlayerStart on a platform starts on the platform)
    st.feetY = floorBelow(sx, start && typeof start.y === 'number' ? start.y + stepHeight() + 1 : 1e6, sz);
    camera.position.y = st.feetY + eyeHeight();
    applyLook();
    orbit.enabled = false;
    st.active = true;
    st.keys.clear();
    try {
      const p = canvas.requestPointerLock && canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* pointer lock unavailable (headless, iframe): mouse-drag look still works */ }
    onChange(true);
  }

  function exit() {
    if (!st.active) return;
    st.active = false;
    st.keys.clear();
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    camera.rotation.order = 'XYZ';
    if (st.saved) {
      camera.position.copy(st.saved.pos);
      camera.quaternion.copy(st.saved.quat);
      orbit.target.copy(st.saved.target);
    }
    orbit.enabled = true;
    onChange(false);
  }

  function toggle(start = null) { st.active ? exit() : enter(start); }

  // ---- input ----
  let dragging = false;
  document.addEventListener('mousemove', (e) => {
    if (!st.active) return;
    if (document.pointerLockElement !== canvas && !dragging) return;
    st.yaw -= e.movementX * LOOK_SENSITIVITY;
    st.pitch = THREE.MathUtils.clamp(st.pitch - e.movementY * LOOK_SENSITIVITY, -1.45, 1.45);
    applyLook();
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
    st.vy = 4 * h / T;
    st.airborne = true;
  }

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
  function update(dt) {
    if (!st.active) return;
    const k = st.keys;
    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    st.crouching = !st.airborne && (k.has('KeyC') || k.has('ControlLeft') || k.has('ControlRight'));
    const speed = st.crouching ? m().walkSpeed * 0.5 : running ? m().runSpeed : m().walkSpeed;
    fwd.set(-Math.sin(st.yaw), 0, -Math.cos(st.yaw));
    right.set(Math.cos(st.yaw), 0, -Math.sin(st.yaw));
    move.set(0, 0, 0);
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(fwd);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);

    if (k.has('Space') && !st.airborne) { jump(); k.delete('Space'); }   // one jump per press

    if (move.lengthSq() > 0) {
      move.normalize();
      const dist = speed * dt;
      const knee = new THREE.Vector3(camera.position.x, st.feetY + stepHeight(), camera.position.z);
      if (!blocked(knee, move, dist + m().capsuleRadius)) {
        camera.position.addScaledVector(move, dist);
      } else {
        // slide along the wall: try each axis separately
        const mx = new THREE.Vector3(move.x, 0, 0), mz = new THREE.Vector3(0, 0, move.z);
        if (mx.lengthSq() > 0 && !blocked(knee, mx.clone().normalize(), dist + m().capsuleRadius)) camera.position.addScaledVector(mx, dist);
        else if (mz.lengthSq() > 0 && !blocked(knee, mz.clone().normalize(), dist + m().capsuleRadius)) camera.position.addScaledVector(mz, dist);
      }
    }

    if (st.airborne) {
      st.feetY += st.vy * dt;
      st.vy -= st.gravity * dt;
      // land on whatever is under the feet once falling
      const floor = floorBelow(camera.position.x, st.feetY + 1, camera.position.z);
      if (st.vy <= 0 && st.feetY <= floor) { st.feetY = floor; st.airborne = false; st.vy = 0; }
      camera.position.y = st.feetY + eyeHeight();
    } else {
      // follow the floor (stairs, ramps, platforms); drop to the grid if nothing is below
      const floor = floorBelow(camera.position.x, st.feetY + stepHeight() + 1, camera.position.z);
      st.feetY += (floor - st.feetY) * Math.min(1, dt * 14);
      camera.position.y = st.feetY + eyeHeight();
    }
  }

  return {
    get active() { return st.active; },
    get from() { return st.from; },
    enter, exit, toggle, update,
    get eyeHeight() { return eyeHeight(); },
    // for tests
    _state: () => ({ crouching: st.crouching, airborne: st.airborne, feetY: st.feetY, vy: st.vy }),
    _press: (code) => st.keys.add(code),
    _release: (code) => st.keys.delete(code),
    _look: (dx, dy) => { st.yaw -= dx * LOOK_SENSITIVITY; st.pitch = THREE.MathUtils.clamp(st.pitch - dy * LOOK_SENSITIVITY, -1.45, 1.45); applyLook(); }
  };
}
