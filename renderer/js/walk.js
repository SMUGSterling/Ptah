// walk.js — first- and third-person walk mode.
//
// Walk the blockout with WASD + mouse look (pointer lock). The player has a
// round body: the level's non-walkable faces are sliced at knee height (just
// above a step) and at the capsule's widest point, and the body's circle, swept
// along the frame's move, may not come within its radius of any slice. So walls
// and posts block however thin they are, gaps narrower than the body stop it,
// anything no taller than a step is walked over, and faces sloped 45° or less
// (UE's and Unity's default walkable slope) are floor. Downward rays at the centre
// and around the capsule's edge find the floor: like a capsule resting on a
// step's edge, the player stands on the highest flat surface under its body,
// so each riser is climbed as soon as the body reaches it, one at a time.
// A drop of more than a step is a fall. Every number comes from the level's metrics profile
// (metrics.js): eye height, crouch height, step height, capsule radius, walk and
// run speed, jump height and distance. Space jumps (a parabola whose apex is
// jumpHeight and whose reach at run speed is jumpDistance). Holding C (or Ctrl in the
// desktop app) crouches: half walk speed, the eye and the boom lowered to crouchHeight.
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
const CROUCH_TIME = 0.2;             // s to crouch or stand: the eye, the boom and the body's clip ease over it (UE snaps the capsule and smooths the camera over about this)
// A surface this steep or flatter is floor, not wall. The slack keeps an exact 45° face
// (rise = run: ny/|n| rounds to 0.7071067811865475) on the floor side of cos 45°'s own rounding.
const WALKABLE = Math.cos(THREE.MathUtils.degToRad(45)) - 1e-9;
const FLAT = Math.cos(THREE.MathUtils.degToRad(5));        // the capsule's edge rests only on (near-)flat surfaces: treads, tops
const KILL_DEPTH = 1000;            // falling this far below the lowest geometry (or the grid) respawns at the walk's start, like an engine's kill height
const LEVEL_EPS = 0.01;              // rounding in heights: a riser exactly stepHeight tall (up or down) is a step, a hair more is not
const GRID_MIN_TRIS = 64;            // meshes with more triangles get a spatial grid, so large imports cost no more than boxes
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
    airs: 0,                         // counts take-offs, so each one restarts the jump clip
    clipAir: -1,                     // the take-off the jump clip was last started for
    jumpQueued: false,               // a Space press not yet taken by a frame (a tap can be over before one runs)
    crouching: false,
    crouchBlend: 0,                  // 0 standing .. 1 crouched, eased so the eye, boom and body do not snap
    charYaw: 0,                      // mannequin facing (its +Z axis), radians about Y
    action: null,                    // current animation action name
    speed: 0,                        // last frame's horizontal speed, for the animation state
    vy0: 0,                          // launch velocity of the current jump
    y0: 0,                           // feet height where the current jump or fall began
    from: null,                      // name of the marker the walk started from
    hadLock: false                   // pointer lock was engaged at some point this walk
  };
  const m = () => metrics();
  const char = () => (typeof mannequin === 'function' ? mannequin() : mannequin) || null;
  const crownToEye = () => Math.max(0, m().playerHeight - m().eyeHeight);   // eye sits this far below the crown
  // the capsule's height now: standing, crouched, or on the way between
  const bodyHeight = () => THREE.MathUtils.lerp(m().playerHeight, m().crouchHeight, THREE.MathUtils.smoothstep(st.crouchBlend, 0, 1));
  const eyeHeight = () => Math.max(10, bodyHeight() - crownToEye());
  const stepHeight = () => m().stepHeight;
  const boomTargetHeight = () => bodyHeight() * 0.55;                      // about the capsule centre, like a spring arm socket

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
    const hit = rayDistance(target, back, BOOM_LENGTH);   // the walk's own triangle grid (a three.js raycast cost 80x more)
    if (hit < Infinity) len = Math.max(BOOM_MIN, hit - 12);
    camera.position.copy(target).addScaledVector(back, len);
    // The grid stops the boom only where it is the floor under the camera: over a pit or a basement
    // (however shallow) the level's own faces, found above, stop it instead.
    const grade = floorGrade;
    const overGrid = target.y >= BOOM_GROUND_CLEARANCE && floorAt(camera.position.x, camera.position.z, target.y) === 0;
    floorGrade = grade;                // a camera query, not the body's floor
    if (overGrid && back.y < 0) {
      len = Math.min(len, Math.max(BOOM_MIN, (target.y - BOOM_GROUND_CLEARANCE) / -back.y));
      camera.position.copy(target).addScaledVector(back, len);
    }
    if (overGrid) camera.position.y = Math.max(camera.position.y, BOOM_GROUND_CLEARANCE);
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
      // feet land. A fall off an edge holds the legs-reaching-down pose. Each
      // take-off starts the clip afresh: one still paused at the end of the last
      // landing would otherwise be reused and freeze the next landing.
      if (st.clipAir !== st.airs) { if (st.action === 'jump') st.action = null; st.clipAir = st.airs; }
      play('jump', { once: true, fade: 0.08, timeScale: 0 });
      const T = 2 * st.vy0 / Math.max(1, st.gravity);
      const f = st.jumping && T > 0 ? THREE.MathUtils.clamp(st.airT / T, 0, 0.98) : 0.8;
      c.actions.jump.time = keys.takeoff + (keys.touchdown - keys.takeoff) * f;
    } else if (st.landing > 0 && keys && st.action === 'jump' && !(moving && st.speed > 1)) {
      // the landing absorb, from the touchdown key on; landing on the move skips it and
      // blends into locomotion (as UE's template does), or the feet would slide through a crouch
      play('jump', { once: true, timeScale: 1 });
    } else if (moving && st.speed > 1) {
      st.landing = 0;                // a skipped absorb is not played later: stopping would replay the clip from its crouch
      // walk or run, whichever clip's natural speed is nearer (as a ratio) to how fast the player
      // moves, so neither is sped up too far; crouching walks crouched (or walks, with no such clip)
      if (st.crouching && c.actions.crouchWalking) {
        play('crouchWalking', { fade: CROUCH_TIME, timeScale: THREE.MathUtils.clamp(st.speed / (c.clipSpeed('crouchWalking') || 70), 0.6, 2.6) });
      } else {
        const walkN = c.clipSpeed('walking') || 160, runN = c.actions.running ? c.clipSpeed('running') : 0;
        const run = runN > 0 && !st.crouching && st.speed > Math.sqrt(walkN * runN);
        play(run ? 'running' : 'walking', { fade: st.action?.startsWith('crouch') ? CROUCH_TIME : 0.15, timeScale: THREE.MathUtils.clamp(st.speed / (run ? runN : walkN), 0.6, 2.6) });
      }
    } else if (st.crouching && c.actions.crouch) {
      play('crouch', { fade: CROUCH_TIME });
    } else {
      play('idle', { fade: st.action?.startsWith('crouch') ? CROUCH_TIME : 0.15 });
    }
    c.mixer.update(dt);
  }

  /** { takeoff, touchdown, duration } of the jump clip, in clip seconds (keys a clip from another source lacks are estimated). */
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
    st.crouching = false; st.crouchBlend = 0; st.airborne = false; st.jumping = false; st.vy = 0; st.speed = 0; st.airT = 0; st.landing = 0;
    st.px = start ? start.x : orbit.target.x; st.pz = start ? start.z : orbit.target.z;
    // stand on whatever is under the start point (a PlayerStart on a platform starts on the platform)
    const under = floorAt(st.px, st.pz, start && typeof start.y === 'number' ? start.y + stepHeight() + 1 : 1e6);
    st.feetY = st.viewFeet = isFinite(under) ? under : 0;   // a start with nothing under it stands on the grid above
    st.entry = { x: st.px, z: st.pz, feet: st.feetY, yaw: st.yaw };
    st.charYaw = st.yaw + Math.PI;       // the mannequin's forward is its +Z; the camera looks down -Z at yaw 0
    st.view = view === 'third' && char() ? 'third' : 'first';
    st.action = null;
    const c = char();
    if (c) { c.mixer.stopAllAction(); showMannequin(st.view === 'third'); placeMannequin(); if (st.view === 'third') animate(0, false); }
    placeCamera();
    orbit.enabled = false;
    st.active = true;
    st.keys.clear(); st.jumpQueued = false;
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
    st.keys.clear(); st.jumpQueued = false;
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
    // one jump per press from the ground: auto-repeat and presses in mid-air are ignored, so holding Space never jumps again on landing
    if (e.code === 'Space' && (e.repeat || st.airborne)) { e.preventDefault(); return; }
    if (e.code === 'Space') st.jumpQueued = true;
    if (MOVE_KEYS.has(e.code)) { st.keys.add(e.code); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { st.keys.delete(e.code); });
  window.addEventListener('blur', () => { st.keys.clear(); st.jumpQueued = false; });   // a press made before focus left is not kept for later

  // ---- physics-lite ----
  // Collision geometry: each mesh's triangles in world space with their bounds
  // and, for large meshes, an x/z grid of which triangles touch each cell.
  // Rebuilt only when the mesh moves or its geometry changes (never during a
  // walk, as the level cannot be edited meanwhile).
  const tris = new WeakMap();
  const _v = new THREE.Vector3();
  // One frame asks for the level's meshes a dozen times (floor samples, two wall slices,
  // the slide axes, the camera boom), and the host walks its whole scene for each: inside
  // update() the list, with each mesh's cache already checked, is resolved once.
  let frameCaches = null;
  const caches = () => frameCaches || collidables().map(worldTris);
  function worldTris(mesh) {
    const g = mesh.geometry, pos = g.attributes.position, idx = g.index, e = mesh.matrixWorld.elements;
    let c = tris.get(mesh);
    if (c && c.geometry === g && c.version === pos.version + (idx ? idx.version : 0) && c.matrix.every((x, i) => x === e[i])) return c;
    const n = idx ? idx.count : pos.count;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { _v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld); p[i * 3] = _v.x; p[i * 3 + 1] = _v.y; p[i * 3 + 2] = _v.z; }
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const count = Math.floor(n / 3);
    c = {
      geometry: g, version: pos.version + (idx ? idx.version : 0), matrix: e.slice(), p, count, box: new THREE.Box3().setFromArray(p),
      side: mat ? mat.side : THREE.FrontSide,
      flip: mesh.matrixWorld.determinant() < 0 ? -1 : 1,   // a mirrored mesh's triangles wind the other way
      grid: null, stamp: null, query: 0
    };
    if (count > GRID_MIN_TRIS) buildGrid(c);
    tris.set(mesh, c);
    return c;
  }
  function buildGrid(c) {
    const { p, count, box } = c;
    const w = box.max.x - box.min.x, d = box.max.z - box.min.z;
    const cs = Math.max(8, Math.max(w, d) / Math.ceil(Math.sqrt(count)));
    const nx = Math.max(1, Math.ceil(w / cs)), nz = Math.max(1, Math.ceil(d / cs));
    const cell = (v, o, k) => Math.min(k - 1, Math.max(0, Math.floor((v - o) / cs)));
    const range = (t) => {
      const i = t * 9;
      return [cell(Math.min(p[i], p[i + 3], p[i + 6]), box.min.x, nx), cell(Math.max(p[i], p[i + 3], p[i + 6]), box.min.x, nx),
              cell(Math.min(p[i + 2], p[i + 5], p[i + 8]), box.min.z, nz), cell(Math.max(p[i + 2], p[i + 5], p[i + 8]), box.min.z, nz)];
    };
    const start = new Int32Array(nx * nz + 1);
    for (let t = 0; t < count; t++) { const [a, b, e, f] = range(t); for (let z = e; z <= f; z++) for (let x = a; x <= b; x++) start[z * nx + x + 1]++; }
    for (let k = 0; k < nx * nz; k++) start[k + 1] += start[k];
    const fill = start.slice(0, nx * nz), items = new Int32Array(start[nx * nz]);
    for (let t = 0; t < count; t++) { const [a, b, e, f] = range(t); for (let z = e; z <= f; z++) for (let x = a; x <= b; x++) items[fill[z * nx + x]++] = t; }
    c.grid = { cs, nx, nz, start, items, cell };
    c.stamp = new Uint32Array(count);
  }
  /** Calls fn(t) for each triangle that may touch the x/z rectangle, each once; stops early when fn returns true. */
  function eachTri(c, x0, x1, z0, z1, fn) {
    const G = c.grid;
    if (!G) { for (let t = 0; t < c.count; t++) if (fn(t)) return true; return false; }
    if (++c.query === 0xffffffff) { c.stamp.fill(0); c.query = 1; }
    const q = c.query, { box } = c;
    const xa = G.cell(x0, box.min.x, G.nx), xb = G.cell(x1, box.min.x, G.nx), za = G.cell(z0, box.min.z, G.nz), zb = G.cell(z1, box.min.z, G.nz);
    for (let z = za; z <= zb; z++) {
      for (let x = xa; x <= xb; x++) {
        const k = z * G.nx + x;
        for (let j = G.start[k]; j < G.start[k + 1]; j++) {
          const t = G.items[j];
          if (c.stamp[t] === q) continue;
          c.stamp[t] = q;
          if (fn(t)) return true;
        }
      }
    }
    return false;
  }
  /** World normal of triangle t (unnormalised, as wound; `flip` corrects mirrored meshes). */
  const _nrm = [0, 0, 0];
  function triNormal(c, t) {
    const p = c.p, i = t * 9;
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    _nrm[0] = (uy * vz - uz * vy) * c.flip; _nrm[1] = (uz * vx - ux * vz) * c.flip; _nrm[2] = (ux * vy - uy * vx) * c.flip;
    return _nrm;
  }

  /**
   * Height of the first surface below (x, fromY, z) as a downward ray would find
   * it (one-sided faces only from their front), or the grid (0) where nothing has
   * been built below it: a pit or a basement floor under the grid opens it there.
   * Below the grid with nothing underneath, -Infinity (a fall; see KILL_DEPTH).
   * flatOnly: a sloped surface there is ignored (-Infinity).
   */
  let floorGrade = 0;                // rise per unit run of the surface the last centre sample hit
  function floorAt(x, z, fromY, flatOnly = false) {
    let bestY = -Infinity, bestNy = 1;
    for (const c of caches()) {
      const { box, p } = c;
      if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z || box.min.y > fromY) continue;
      eachTri(c, x, x, z, z, (t) => {
        const i = t * 9, ax = p[i], az = p[i + 2], bx = p[i + 3], bz = p[i + 5], cx = p[i + 6], cz = p[i + 8];
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) return false;                                 // edge-on from above: a vertical face
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-7 || l2 < -1e-7 || l3 < -1e-7) return false;
        const y = l1 * p[i + 1] + l2 * p[i + 4] + l3 * p[i + 7];
        if (y > fromY || y <= bestY) return false;
        const n = triNormal(c, t);
        if ((c.side === THREE.FrontSide && n[1] <= 0) || (c.side === THREE.BackSide && n[1] >= 0)) return false;
        bestY = y; bestNy = Math.abs(n[1]) / Math.hypot(n[0], n[1], n[2]);
        return false;
      });
    }
    if (!flatOnly) floorGrade = 0;
    if (bestY === -Infinity) return fromY >= 0 ? 0 : -Infinity;
    if (flatOnly && bestNy < FLAT) return -Infinity;
    if (!flatOnly) floorGrade = Math.min(1, Math.sqrt(Math.max(0, 1 - bestNy * bestNy)) / Math.max(bestNy, 1e-6));   // capped at 45°
    return bestY;
  }
  /** What the body stands on: the floor under its centre, or a higher flat surface under its edge. */
  function support(x, z, fromY) {
    const R = m().capsuleRadius * EDGE;
    let best = floorAt(x, z, fromY);
    const grade = floorGrade;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      best = Math.max(best, floorAt(x + Math.cos(a) * R, z + Math.sin(a) * R, fromY, true));
    }
    floorGrade = grade;
    return best;
  }

  /**
   * Distance along the unit ray (o, d) to the nearest level face within `far`, or Infinity:
   * the camera boom's test. Faces count from the sides a three.js raycast would hit them
   * (front only unless double-sided), through the same per-mesh grid as the floor queries.
   */
  const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _pv = new THREE.Vector3(), _tv = new THREE.Vector3(), _qv = new THREE.Vector3(), _end = new THREE.Vector3();
  const _ray = new THREE.Ray(), _hitBox = new THREE.Vector3();
  function rayDistance(o, d, far) {
    _end.copy(o).addScaledVector(d, far);
    _ray.set(o, d);
    const x0 = Math.min(o.x, _end.x), x1 = Math.max(o.x, _end.x), z0 = Math.min(o.z, _end.z), z1 = Math.max(o.z, _end.z);
    let best = Infinity;
    for (const c of caches()) {
      // skip a mesh whose box the ray enters beyond the nearest hit so far; from inside the box
      // intersectBox gives the exit, not a lower bound, so such a mesh is always searched
      if (!c.box.containsPoint(o)) {
        const hitBox = _ray.intersectBox(c.box, _hitBox);
        if (!hitBox || hitBox.distanceTo(o) > Math.min(best, far)) continue;
      }
      const p = c.p;
      eachTri(c, x0, x1, z0, z1, (t) => {
        const i = t * 9;
        _e1.set(p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]);
        _e2.set(p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]);
        _pv.crossVectors(d, _e2);
        const det = _e1.dot(_pv);                      // Möller-Trumbore: det = -d·n, so its sign is the side the ray meets
        if (Math.abs(det) < 1e-12) return false;
        const front = det * c.flip > 0;                // the ray runs against the face's (mirror-corrected) normal
        if (c.side === THREE.FrontSide ? !front : c.side === THREE.BackSide ? front : false) return false;
        const inv = 1 / det;
        _tv.set(o.x - p[i], o.y - p[i + 1], o.z - p[i + 2]);
        const u = _tv.dot(_pv) * inv;
        if (u < 0 || u > 1) return false;
        _qv.crossVectors(_tv, _e1);
        const v = d.dot(_qv) * inv;
        if (v < 0 || u + v > 1) return false;
        const dist = _e2.dot(_qv) * inv;
        if (dist >= 0 && dist <= far && dist < best) best = dist;   // both ends count, as a raycast's near (0) and far do
        return false;
      });
    }
    return best;
  }

  // 2D (x, z) distances
  function pointSeg(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
    const t = l > 0 ? THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / l, 0, 1) : 0;
    return Math.hypot(px - ax - t * dx, pz - az - t * dz);
  }
  function segSeg(ax, az, bx, bz, cx, cz, dx, dz) {
    const cross = (ox, oz, px, pz, qx, qz) => (px - ox) * (qz - oz) - (pz - oz) * (qx - ox);
    const d1 = cross(cx, cz, dx, dz, ax, az), d2 = cross(cx, cz, dx, dz, bx, bz);
    const d3 = cross(ax, az, bx, bz, cx, cz), d4 = cross(ax, az, bx, bz, dx, dz);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;   // they cross
    return Math.min(pointSeg(ax, az, cx, cz, dx, dz), pointSeg(bx, bz, cx, cz, dx, dz), pointSeg(cx, cz, ax, az, bx, bz), pointSeg(dx, dz, ax, az, bx, bz));
  }
  /** Does the move (a → b) cross the line through segment c–d, within the segment? Starting or ending on it is not crossing. */
  function crosses(ax, az, bx, bz, cx, cz, dx, dz) {
    const cross = (ox, oz, px, pz, qx, qz) => (px - ox) * (qz - oz) - (pz - oz) * (qx - ox);
    const d1 = cross(cx, cz, dx, dz, ax, az), d2 = cross(cx, cz, dx, dz, bx, bz);
    if (!(d1 * d2 < 0)) return false;
    return cross(ax, az, bx, bz, cx, cz) * cross(ax, az, bx, bz, dx, dz) <= 0;
  }
  /**
   * Does a circle of radius r, moving from (ax, az) to (bx, bz) at height y,
   * touch any non-walkable face? A body already overlapping a face may still
   * move away from it (it can start inside geometry), never closer and never
   * across it, however far past it one frame's move would carry it.
   */
  const _seg = new Float64Array(6), _hy = [0, 0, 0];
  function sweepHits(ax, az, bx, bz, y, r) {
    const x0 = Math.min(ax, bx) - r, x1 = Math.max(ax, bx) + r, z0 = Math.min(az, bz) - r, z1 = Math.max(az, bz) + r;
    for (const c of caches()) {
      const { box, p } = c;
      if (box.min.y > y || box.max.y < y || box.max.x < x0 || box.min.x > x1 || box.max.z < z0 || box.min.z > z1) continue;
      const hit = eachTri(c, x0, x1, z0, z1, (t) => {
        const i = t * 9;
        const ya = p[i + 1] - y, yb = p[i + 4] - y, yc = p[i + 7] - y;
        if ((ya > 0 && yb > 0 && yc > 0) || (ya < 0 && yb < 0 && yc < 0)) return false;   // does not cross this height
        if (Math.max(p[i], p[i + 3], p[i + 6]) < x0 || Math.min(p[i], p[i + 3], p[i + 6]) > x1 ||
            Math.max(p[i + 2], p[i + 5], p[i + 8]) < z0 || Math.min(p[i + 2], p[i + 5], p[i + 8]) > z1) return false;
        // a face sloped 45° or less is floor (ramps, treads), not wall
        const [nx, ny, nz] = triNormal(c, t);
        const nl = Math.hypot(nx, ny, nz);
        if (nl === 0 || Math.abs(ny) / nl >= WALKABLE) return false;
        // only a face the body is in front of: a solid's far side (a ramp's back
        // face, seen from on the ramp) and the inside of one it started in do not block
        if (c.side !== THREE.DoubleSide) {
          const facing = (ax - p[i]) * nx + (y - p[i + 1]) * ny + (az - p[i + 2]) * nz;
          if (c.side === THREE.BackSide ? facing > 0 : facing < 0) return false;
        }
        // the face's slice at this height: its vertices on the height, and where its edges cross it
        // (a vertex on the height is taken once, from itself, so it never crowds out the other end)
        let k = 0;
        _hy[0] = ya; _hy[1] = yb; _hy[2] = yc;
        for (let e = 0; e < 3; e++) {
          const f2 = (e + 1) % 3, yi = _hy[e], yj = _hy[f2];
          if (yi === 0) { _seg[k++] = p[i + e * 3]; _seg[k++] = p[i + e * 3 + 2]; continue; }
          if (yj === 0 || (yi > 0) === (yj > 0)) continue;
          const f = yi / (yi - yj);
          _seg[k++] = p[i + e * 3] + f * (p[i + f2 * 3] - p[i + e * 3]);
          _seg[k++] = p[i + e * 3 + 2] + f * (p[i + f2 * 3 + 2] - p[i + e * 3 + 2]);
        }
        if (k < 2) return false;
        let cx = _seg[0], cz = _seg[1], dx = k >= 4 ? _seg[2] : cx, dz = k >= 4 ? _seg[3] : cz;
        if (k === 6) {
          // three points (a sliver lying in the height): the slice spans the two farthest apart
          const d01 = Math.hypot(_seg[2] - _seg[0], _seg[3] - _seg[1]), d02 = Math.hypot(_seg[4] - _seg[0], _seg[5] - _seg[1]), d12 = Math.hypot(_seg[4] - _seg[2], _seg[5] - _seg[3]);
          if (d02 >= d01 && d02 >= d12) { dx = _seg[4]; dz = _seg[5]; }
          else if (d12 > d01) { cx = _seg[4]; cz = _seg[5]; }
        }
        if (segSeg(ax, az, bx, bz, cx, cz, dx, dz) >= r) return false;
        const dA = pointSeg(ax, az, cx, cz, dx, dz);
        if (dA >= r) return true;                                            // was clear: this move would touch it
        // Starting on the slice itself, no side has been crossed yet: a one-sided face's
        // back is the solid behind it, so ending there is crossing. (A double-sided face
        // has no inside: from on it, either side is out.)
        if (dA < 1e-9 && c.side !== THREE.DoubleSide) {
          const toEnd = (bx - cx) * nx + (bz - cz) * nz;
          if (c.side === THREE.BackSide ? toEnd > 0 : toEnd < 0) return true;
        }
        // already overlapping: it may move away or along, never across or closer
        return crosses(ax, az, bx, bz, cx, cz, dx, dz) || pointSeg(bx, bz, cx, cz, dx, dz) < dA;
      });
      if (hit) return true;
    }
    return false;
  }
  /** Would the body, moving `dist` along the horizontal unit `dir`, run into a wall? */
  function blocked(dir, dist) {
    // the knee slice sits a hair above step height: a riser of stepHeight is a step, anything taller is a wall
    const r = m().capsuleRadius, knee = stepHeight() + LEVEL_EPS;
    const bx = st.px + dir.x * dist, bz = st.pz + dir.z * dist;
    // at knee height the capsule's rounded bottom is narrower than its radius; above r it is full width
    const kneeR = knee >= r ? r : Math.sqrt(r * r - (r - knee) * (r - knee));
    if (sweepHits(st.px, st.pz, bx, bz, st.feetY + knee, kneeR)) return true;
    return knee < r && sweepHits(st.px, st.pz, bx, bz, st.feetY + r, r);
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
    st.y0 = st.feetY;
    st.airborne = true; st.jumping = true; st.airT = 0; st.landing = 0; st.airs++;
  }
  function killY() {
    let low = 0;
    for (const c of caches()) low = Math.min(low, c.box.min.y);
    return low - KILL_DEPTH;
  }
  function respawn() {
    const e = st.entry;
    st.px = e.x; st.pz = e.z; st.feetY = st.viewFeet = e.feet; st.yaw = e.yaw; st.pitch = 0;
    st.charYaw = st.yaw + Math.PI;     // the mannequin faces the way the camera does, as at the start
    st.airborne = false; st.jumping = false; st.vy = 0; st.airT = 0; st.landing = 0;
  }
  function fall() {
    st.gravity = gravity().g;
    st.vy = st.vy0 = 0;
    st.y0 = st.feetY;
    st.airborne = true; st.jumping = false; st.airT = 0; st.landing = 0; st.airs++;
  }
  function land(floor) {
    st.feetY = st.viewFeet = floor; st.airborne = false; st.vy = 0;   // the air arc was real: no easing into the landing
    const c = char(), keys = c && jumpKeys(c);
    if (keys && st.action === 'jump') { c.actions.jump.time = keys.touchdown; st.landing = keys.duration - keys.touchdown; }
  }

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
  const axis = new THREE.Vector3();
  function update(dt) {
    if (!st.active) return;
    frameCaches = collidables().map(worldTris);
    try { step(dt); } finally { frameCaches = null; }
  }
  function step(dt) {
    dt = Math.min(dt, 1 / 20);       // a hidden tab or a hitch must not become a 2-second free fall through the level
    const lag = st.viewFeet - st.feetY;
    const k = st.keys;
    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    st.crouching = !st.airborne && (k.has('KeyC') || (ctrlCrouch && (k.has('ControlLeft') || k.has('ControlRight'))));
    st.crouchBlend = THREE.MathUtils.clamp(st.crouchBlend + (st.crouching ? dt : -dt) / CROUCH_TIME, 0, 1);
    const speed = st.crouching ? m().walkSpeed * 0.5 : running ? m().runSpeed : m().walkSpeed;
    fwd.set(-Math.sin(st.yaw), 0, -Math.cos(st.yaw));
    right.set(Math.cos(st.yaw), 0, -Math.sin(st.yaw));
    move.set(0, 0, 0);
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(fwd);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);

    if ((st.jumpQueued || k.has('Space')) && !st.airborne) { jump(); k.delete('Space'); }   // one jump per press
    st.jumpQueued = false;

    const moving = move.lengthSq() > 0;
    let moved = 0;
    if (moving) {
      move.normalize();
      const dist = speed * dt;
      if (!blocked(move, dist)) {
        st.px += move.x * dist; st.pz += move.z * dist; moved = dist;
      } else {
        // slide along the wall: try each axis separately
        if (move.x && !blocked(axis.set(Math.sign(move.x), 0, 0), dist * Math.abs(move.x))) { st.px += move.x * dist; moved = dist * Math.abs(move.x); }
        else if (move.z && !blocked(axis.set(0, 0, Math.sign(move.z)), dist * Math.abs(move.z))) { st.pz += move.z * dist; moved = dist * Math.abs(move.z); }
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
      // the arc itself, sampled at this frame's time (stepping velocity per frame
      // overshot the apex and reach by 4-12%, more at lower frame rates)
      st.airT += dt;
      st.feetY = st.y0 + st.vy0 * st.airT - st.gravity * st.airT * st.airT / 2;
      st.vy = st.vy0 - st.gravity * st.airT;
      if (st.vy <= 0) {
        // Landing is a sweep, not a point test: the highest surface below where
        // the feet WERE (plus a step) is where they land if the feet have now
        // reached or passed it. Casting from the new position tunnelled through
        // any floor thinner than one frame of fall.
        const floor = support(st.px, st.pz, prevFeet + stepHeight() + LEVEL_EPS);   // never above where it looked from
        if (floor >= st.feetY) land(floor);
        else if (st.feetY < killY()) respawn();
      }
    } else {
      // follow the floor (stairs, ramps, platforms); more than a step down is a fall,
      // allowing on a slope for the drop of this frame's travel down it
      const floor = support(st.px, st.pz, st.feetY + stepHeight() + LEVEL_EPS);
      if (floor < st.feetY - stepHeight() - LEVEL_EPS - moved * floorGrade) fall();
      else st.feetY = floor;
      st.landing = Math.max(0, st.landing - dt);
    }
    // The view eases after a step. In the air it follows the arc exactly, carrying the lag it had
    // (a step-up still being eased) and fading it at the same rate: snapping it cost a 35u jolt.
    const ease = Math.min(1, dt * 14);
    st.viewFeet = st.airborne ? st.feetY + lag * (1 - ease) : st.viewFeet + (st.feetY - st.viewFeet) * ease;
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
    _state: () => ({ crouching: st.crouching, crouchBlend: st.crouchBlend, airborne: st.airborne, jumping: st.jumping, landing: st.landing, feetY: st.feetY, viewFeet: st.viewFeet, vy: st.vy, view: st.view, px: st.px, pz: st.pz, charYaw: st.charYaw, action: st.action, speed: st.speed }),
    _press: (code) => st.keys.add(code),
    _release: (code) => st.keys.delete(code),
    _look: (yaw, pitch) => { st.yaw = yaw; st.pitch = pitch; placeCamera(); },
    _fov: () => camera.fov
  };
}
