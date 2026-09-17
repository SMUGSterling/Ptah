// walk.js — first-person walk mode.
//
// Drops the camera to the player's eye height and lets you walk the blockout
// with WASD + mouse look (pointer lock). Two cheap raycasts per frame give it
// a body: a knee-height ray in the direction of travel blocks walls but steps
// over risers, and a downward ray follows floors, treads and ramps. No
// gravity or jumping: this is a scale and sightline check, not a game.

import * as THREE from 'three';

const LOOK_SENSITIVITY = 0.0022;
const WALK_SPEED = 300;              // units/s (3 m/s)
const RUN_SPEED = 650;
const BODY_RADIUS = 20;
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

export function createWalkMode({ camera, orbit, canvas, player, collidables, onChange }) {
  const st = {
    active: false,
    yaw: 0,
    pitch: 0,
    keys: new Set(),
    saved: null,                     // camera pose to restore on exit
    raycaster: new THREE.Raycaster()
  };
  const eyeHeight = () => player.height * 0.93;
  const stepHeight = () => Math.min(48, player.height * 0.3);

  function applyLook() {
    camera.rotation.order = 'YXZ';
    camera.rotation.set(st.pitch, st.yaw, 0);
  }

  function enter() {
    if (st.active) return;
    st.saved = { pos: camera.position.clone(), quat: camera.quaternion.clone(), target: orbit.target.clone() };
    const dir = camera.getWorldDirection(new THREE.Vector3());
    st.yaw = Math.atan2(-dir.x, -dir.z);
    st.pitch = 0;
    // start where the orbit camera was looking, standing on whatever is there
    camera.position.set(orbit.target.x, eyeHeight(), orbit.target.z);
    const floor = floorBelow(camera.position.x, 1e6, camera.position.z);
    camera.position.y = floor + eyeHeight();
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
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
    camera.rotation.order = 'XYZ';
    if (st.saved) {
      camera.position.copy(st.saved.pos);
      camera.quaternion.copy(st.saved.quat);
      orbit.target.copy(st.saved.target);
    }
    orbit.enabled = true;
    onChange(false);
  }

  function toggle() { st.active ? exit() : enter(); }

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
    // The browser releases the lock on Esc; treat that as leaving walk mode.
    if (st.active && document.pointerLockElement !== canvas && st.hadLock) exit();
    st.hadLock = document.pointerLockElement === canvas;
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

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
  function update(dt) {
    if (!st.active) return;
    const k = st.keys;
    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = running ? RUN_SPEED : WALK_SPEED;
    fwd.set(-Math.sin(st.yaw), 0, -Math.cos(st.yaw));
    right.set(Math.cos(st.yaw), 0, -Math.sin(st.yaw));
    move.set(0, 0, 0);
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(fwd);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);

    const feetY = camera.position.y - eyeHeight();
    if (move.lengthSq() > 0) {
      move.normalize();
      const dist = speed * dt;
      const knee = new THREE.Vector3(camera.position.x, feetY + stepHeight(), camera.position.z);
      if (!blocked(knee, move, dist + BODY_RADIUS)) {
        camera.position.addScaledVector(move, dist);
      } else {
        // slide along the wall: try each axis separately
        const mx = new THREE.Vector3(move.x, 0, 0), mz = new THREE.Vector3(0, 0, move.z);
        if (mx.lengthSq() > 0 && !blocked(knee, mx.clone().normalize(), dist + BODY_RADIUS)) camera.position.addScaledVector(mx, dist);
        else if (mz.lengthSq() > 0 && !blocked(knee, mz.clone().normalize(), dist + BODY_RADIUS)) camera.position.addScaledVector(mz, dist);
      }
    }
    // follow the floor (stairs, ramps, platforms); drop to the grid if nothing is below
    const floor = floorBelow(camera.position.x, feetY + stepHeight() + 1, camera.position.z);
    const targetY = floor + eyeHeight();
    camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * 14);
  }

  return {
    get active() { return st.active; },
    enter, exit, toggle, update,
    // for tests
    _press: (code) => st.keys.add(code),
    _release: (code) => st.keys.delete(code),
    _look: (dx, dy) => { st.yaw -= dx * LOOK_SENSITIVITY; st.pitch = THREE.MathUtils.clamp(st.pitch - dy * LOOK_SENSITIVITY, -1.45, 1.45); applyLook(); }
  };
}
