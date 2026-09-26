// build-mannequin.mjs — generates Ptah's walk-mode mannequin from code.
//
//   node --import ./test/register-three.mjs tools/mannequin/build-mannequin.mjs
//   (npm run mannequin)
//
// Writes renderer/assets/mannequin.glb and mannequin.glb.js. Everything here is
// original: a segmented, artist's-mannequin style figure (rigid parts on a
// 17-bone skeleton, like a wooden drawing mannequin), and four clips authored
// as motion functions, not keyframed by hand or captured:
//   idle     breathing and a slow look around
//   walking  a gait solved with two-bone IK so the stance foot stays planted
//   running  the same, faster, with a flight phase, a forward lean and bent arms
//   jump     crouch, take-off, tuck in the air, land and absorb
// Proportions are an adult of 180 cm (about 7.5 heads); the app scales it to
// each profile's character height. Facing +Z, Y up, 1 unit = 1 cm, which is
// what character.js and walk.js expect.

import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', '..', 'renderer', 'assets');
const HEIGHT = 180;
const FPS = 30;
const deg = THREE.MathUtils.degToRad;

// ---------------------------------------------------------------------------
// Skeleton: world positions of each joint in the rest pose (arms in a slight A).
// ---------------------------------------------------------------------------
const A_POSE = deg(10);
const SHOULDER = [17, 145, 0], UPPER_ARM = 29, FOREARM = 25;
const armDir = (side) => [side * Math.sin(A_POSE), -Math.cos(A_POSE), 0];
const add = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const HIP_X = 9, HIP_Y = 92, KNEE_Y = 50, ANKLE_Y = 8;
const L1 = HIP_Y - KNEE_Y, L2 = KNEE_Y - ANKLE_Y;      // thigh, shin

const bones = [];
function bone(name, world, parent = null) { bones.push({ name, world, parent }); return bones.length - 1; }
const hips = bone('Hips', [0, 97, 0]);
const spine = bone('Spine', [0, 108, 0], hips);
const chest = bone('Chest', [0, 122, 0], spine);
const neck = bone('Neck', [0, 146, 0], chest);
const head = bone('Head', [0, 157, 0], neck);
const arm = {}, leg = {};
for (const [side, s] of [['L', 1], ['R', -1]]) {        // facing +Z, the character's left is +X
  const sh = [s * SHOULDER[0], SHOULDER[1], SHOULDER[2]];
  const el = add(sh, armDir(s), UPPER_ARM), wr = add(el, armDir(s), FOREARM);
  const u = bone('UpperArm_' + side, sh, chest), l = bone('LowerArm_' + side, el, u), h = bone('Hand_' + side, wr, l);
  arm[side] = { u, l, h, sh, el, wr, s };
}
for (const [side, s] of [['L', 1], ['R', -1]]) {
  const hp = [s * HIP_X, HIP_Y, 0], kn = [s * HIP_X, KNEE_Y, 0], an = [s * HIP_X, ANKLE_Y, 0];
  const u = bone('UpperLeg_' + side, hp, hips), l = bone('LowerLeg_' + side, kn, u), f = bone('Foot_' + side, an, l);
  leg[side] = { u, l, f, hp, kn, an, s };
}
const local = (b) => {
  const w = bones[b].world, p = bones[b].parent === null ? [0, 0, 0] : bones[bones[b].parent].world;
  return [w[0] - p[0], w[1] - p[1], w[2] - p[2]];
};

// ---------------------------------------------------------------------------
// Geometry: rigid parts, each bound 100% to one bone, in two materials.
// ---------------------------------------------------------------------------
const parts = { body: [], accent: [] };
function place(geo, b, mat = 'body') { parts[mat].push({ geo, b }); }
const v3 = (a) => new THREE.Vector3(...a);

/** Round-ended cone from a (radius ra) to b (radius rb), like a capsule that tapers. */
function limb(a, b, ra, rb, segs = 14) {
  const A = v3(a), B = v3(b), L = A.distanceTo(B);
  const pts = [];
  const n = 5;
  for (let i = 0; i <= n; i++) { const t = -Math.PI / 2 + (i / n) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, ra * Math.cos(t)), ra * Math.sin(t))); }
  for (let i = 0; i <= n; i++) { const t = (i / n) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, rb * Math.cos(t)), L + rb * Math.sin(t))); }
  const g = new THREE.LatheGeometry(pts, segs);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
}
/** Ellipsoid at c with radii r, optionally turned so its Y axis points along `up`. */
function blob(c, r, up = null, w = 18, h = 12) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(r[0], r[1], r[2]);
  if (up) g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v3(up).normalize()));
  g.translate(c[0], c[1], c[2]);
  return g;
}

place(blob([0, 95, 0], [15, 10.5, 10]), hips);                    // pelvis
place(blob([0, 111, -0.5], [12.5, 10, 8.5]), spine);              // abdomen
place(blob([0, 133, -0.5], [17.5, 15, 10.5]), chest);             // ribcage
place(limb([0, 144, -1], [0, 158, 0], 5, 4.6), neck);
place(blob([0, 168.3, 0.5], [8.3, 11.7, 9.8], null, 24, 16), head);
// visor at eye height: shows which way the figure faces and where its eyes are
place(blob([0, 167.5, 8.3], [7, 2.7, 3.2]), head, 'accent');
for (const side of ['L', 'R']) {
  const a = arm[side], d = armDir(a.s);
  place(blob(a.sh, [6, 6, 6]), a.u);                              // shoulder ball
  place(limb(a.sh, a.el, 5, 4.2), a.u);
  place(limb(a.el, a.wr, 4.1, 3.3), a.l);
  place(blob(add(a.wr, d, 8.5), [2.3, 8, 4.6], d), a.h);          // mitten hand
  const g = leg[side];
  place(limb(g.hp, g.kn, 7.5, 5.4), g.u);
  place(limb(g.kn, g.an, 5.2, 3.8), g.l);
  place(blob([g.an[0], 4, 6], [4.6, 4, 12.5]), g.f);              // foot: heel at z -6.5, toe at 18.5, sole at y 0
  place(blob([g.an[0], 1.2, 6], [4.8, 1.2, 12.7]), g.f, 'accent');                  // dark sole
}

function merge(list) {
  const pos = [], nor = [], idx = [], joints = [];
  for (const { geo, b } of list) {
    const g = geo;
    const base = pos.length / 3;
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); joints.push(b); }
    const ix = g.index ? Array.from(g.index.array) : [...Array(p.count).keys()];
    for (const i of ix) idx.push(base + i);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint16Array(idx), joints };
}

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------
const qX = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);   // + : toe down / limb back
const qY = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
const qZ = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
const mul = (...qs) => qs.reduce((acc, q) => acc.multiply(q), new THREE.Quaternion());
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = THREE.MathUtils.lerp;

/**
 * Sagittal two-bone IK. Hip joint at height hy, ankle target at (z, y) in the
 * body frame. Returns forward thigh swing, knee flex and the shin's world swing.
 */
function legIK(hy, z, y) {
  const dz = z, dy = y - hy;
  let d = Math.hypot(dz, dy);
  d = Math.min(d, L1 + L2 - 0.05);
  const line = Math.atan2(dz, -dy);                                // forward angle of the hip→ankle line
  const alpha = Math.acos(THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const flex = Math.PI - Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  return { thigh: line + alpha, flex };
}
/** Local rotations for a leg: forward thigh swing, knee flex, and the foot's world pitch (+ = toe down). */
function legPose(thigh, flex, toe) {
  return { u: qX(-thigh), l: qX(flex), f: qX(toe + thigh - flex) };
}
/** Maximum hip height at which an ankle target (z, y) is reachable. */
const reachHeight = (z, y) => y + Math.sqrt(Math.max(0, (L1 + L2 - 0.6) ** 2 - z * z));

function clip(name, duration, poseAt, extras = {}) {
  const frames = Math.round(duration * FPS) + 1;
  const times = [], rot = bones.map(() => []), hipPos = [];
  for (let k = 0; k < frames; k++) {
    const t = Math.min(duration, k / FPS);
    times.push(t);
    const pose = poseAt(t);
    for (let b = 0; b < bones.length; b++) { const q = pose.rot[b] || new THREE.Quaternion(); rot[b].push(q.x, q.y, q.z, q.w); }
    const lp = local(hips);
    hipPos.push(lp[0] + (pose.hip?.[0] || 0), lp[1] + (pose.hip?.[1] || 0), lp[2] + (pose.hip?.[2] || 0));
  }
  return { name, times, rot, hipPos, extras: { duration, ...extras } };
}

// ---- walking and running ---------------------------------------------------
// A gait cycle is two steps. While a foot is on the ground, one point of its
// sole is fixed to the ground, which moves back at exactly the gait's speed in
// the body frame, so the foot is planted: it lands on the heel, rolls flat, then
// pivots on the ball of the foot as the heel lifts. The swing foot arcs forward.
// The hips drop as far as the stance leg needs to reach; running adds a bob
// (lowest at mid-stance, highest in the flight phase, when both feet are up).
const WALK = { name: 'walking', T: 1.0, speed: 140, duty: 0.6, front: 0.4, heelUp: 14, toeOff: 32, q1: 0.15, q2: 0.5,
  clear: 9, clearPeak: 0.45, hipBase: HIP_Y - 1.5, hipBob: 0, lean: 3, armGain: 0.55, armOffset: -3, elbow: 14, elbowSwing: 0.8, yaw: 5, roll: 2.5 };
const RUN = { name: 'running', T: 0.7, speed: 400, duty: 0.3, front: 0.35, heelUp: 6, toeOff: 40, q1: 0.12, q2: 0.4,
  clear: 30, clearPeak: 0.4, hipBase: HIP_Y - 3, hipBob: 3, lean: 14, armGain: 1.5, armOffset: -12, elbow: 75, elbowSwing: 0.35, yaw: 8, roll: 3 };
// ankle position relative to the heel and to the ball of the foot, as [up, forward] at rest
const ANKLE_FROM_HEEL = [ANKLE_Y, 6.5], ANKLE_FROM_BALL = [ANKLE_Y, -13];
const pitched = ([y, z], th) => [y * Math.cos(th) - z * Math.sin(th), y * Math.sin(th) + z * Math.cos(th)];   // rotX(th) in the Y-Z plane
/** Ankle height that puts the lowest point of the pitched foot (its rounded sole) exactly on the floor. */
function soleDrop(th) {
  let low = Infinity;
  for (const [cy, cz, ry, rz] of [[4 - ANKLE_Y, 6, 4, 12.5], [1.2 - ANKLE_Y, 6, 1.2, 12.7]]) {   // foot and sole, relative to the ankle
    for (let i = 0; i < 360; i++) { const a = (i / 360) * 2 * Math.PI; low = Math.min(low, pitched([cy + ry * Math.sin(a), cz + rz * Math.cos(a)], th)[0]); }
  }
  return -low;
}

function footTrack(g, p) {                                        // p in [0,1): 0 = heel strike
  const travel = g.speed * g.T * g.duty;
  if (p < g.duty) {
    const q = p / g.duty;
    const G = g.front * travel - q * travel;                      // where the ankle is when the foot is flat
    if (q < g.q1) {                                               // heel contact, toe coming down
      const toe = lerp(deg(-g.heelUp), 0, smooth(q / g.q1));
      const z = pitched(ANKLE_FROM_HEEL, toe)[1];
      return { z: G - ANKLE_FROM_HEEL[1] + z, y: soleDrop(toe), toe };
    }
    if (q < g.q2) return { z: G, y: ANKLE_Y, toe: 0 };            // foot flat
    const toe = lerp(0, deg(g.toeOff), ((q - g.q2) / (1 - g.q2)) ** 1.5);   // heel lifts, pivoting on the ball
    const z = pitched(ANKLE_FROM_BALL, toe)[1];
    return { z: G - ANKLE_FROM_BALL[1] + z, y: soleDrop(toe), toe };
  }
  const u = (p - g.duty) / (1 - g.duty);
  const from = footTrack(g, g.duty - 1e-6), to = footTrack(g, 0);
  const e = smooth(u);
  const shape = Math.log(0.5) / Math.log(g.clearPeak);           // puts the highest point of the arc at clearPeak
  const y = lerp(from.y, to.y, e) + g.clear * Math.sin(Math.PI * u ** shape);
  const toe = u < 0.6 ? lerp(from.toe, deg(-5), smooth(u / 0.6)) : lerp(deg(-5), to.toe, smooth((u - 0.6) / 0.4));
  return { z: lerp(from.z, to.z, e), y, toe };
}
function gaitHipHeight(g, t) {
  const pL = ((t / g.T) % 1 + 1) % 1, pR = (pL + 0.5) % 1;
  const flightMid = (g.duty + 0.5) / 2;
  const need = [g.hipBase + g.hipBob * Math.cos(4 * Math.PI * (pL - flightMid))];
  for (const p of [pL, pR]) if (p < g.duty) { const f = footTrack(g, p); need.push(reachHeight(f.z, f.y)); }
  return Math.min(...need);
}
// smooth the hip height over a small window so the bob has no corners
const hipCurve = (g, t) => { let s = 0; const n = 9; for (let i = 0; i < n; i++) s += gaitHipHeight(g, t + (i - (n - 1) / 2) * g.T * 0.012); return s / n; };
const gaitPose = (g) => (t) => {
  const rot = {};
  const phase = t / g.T;
  const hy = hipCurve(g, t);
  const w = 2 * Math.PI * phase;
  const pelvisYaw = deg(g.yaw) * Math.sin(w);                     // left hip forward as the left leg swings through
  rot[hips] = mul(qY(pelvisYaw), qZ(deg(g.roll) * Math.sin(2 * w)));
  const swing = {};
  for (const [side, off] of [['L', 0], ['R', 0.5]]) {
    const p = ((phase + off) % 1 + 1) % 1;
    const f = footTrack(g, p);
    // the turning, rolling pelvis carries each hip joint a little up, down, forward or back
    const rest = v3(local(leg[side].u)), moved = rest.clone().applyQuaternion(rot[hips]);
    const hj = hy + moved.y - rest.y, dz = moved.z - rest.z;
    // ankle target relative to the hip joint; clamp so the swing foot never over-reaches
    const ik = legIK(hj, f.z - dz, Math.max(f.y, hj - (L1 + L2 - 0.05)));
    const lp = legPose(ik.thigh, ik.flex, f.toe);
    rot[leg[side].u] = lp.u; rot[leg[side].l] = lp.l; rot[leg[side].f] = lp.f;
    swing[side] = ik.thigh;
  }
  // legs hang from the turning, rolling pelvis: take its rotation back out of the thighs
  // so each leg keeps swinging in its own vertical plane and the feet track straight
  const unPelvis = rot[hips].clone().invert();
  for (const side of ['L', 'R']) rot[leg[side].u] = mul(unPelvis, rot[leg[side].u]);
  rot[spine] = mul(qX(deg(g.lean * 0.6)), qY(-pelvisYaw * 0.5));
  rot[chest] = mul(qY(-pelvisYaw * 0.9), qX(deg(g.lean * 0.4)));
  rot[neck] = qY(pelvisYaw * 0.4);
  rot[head] = qX(deg(-2 - g.lean * 0.8));                         // eyes stay level as the body leans
  for (const [side, other] of [['L', 'R'], ['R', 'L']]) {          // arms swing with the opposite leg
    const a = arm[side];
    const fwd = g.armGain * swing[other] + deg(g.armOffset);
    rot[a.u] = mul(qZ(-a.s * deg(2)), qX(-fwd));
    rot[a.l] = qX(-(deg(g.elbow) + Math.max(0, fwd) * g.elbowSwing));
    rot[a.h] = qX(deg(4));
  }
  return { rot: bones.map((_, b) => rot[b]), hip: [0, hy - HIP_Y, 0] };
};

const HIP_NOMINAL = HIP_Y - 1.5;                                   // standing: knees just off locked

// ---- idle ----------------------------------------------------------------------
const IDLE_T = 4;
function idlePose(t) {
  const rot = {};
  const w = 2 * Math.PI * t / IDLE_T;
  const breathe = Math.sin(2 * w);
  const hy = HIP_NOMINAL + 0.4 * breathe;
  const standing = legIK(hy, 0.5, ANKLE_Y);                        // feet stay planted as the hips rise and fall
  for (const side of ['L', 'R']) { const lp = legPose(standing.thigh, standing.flex, 0); rot[leg[side].u] = lp.u; rot[leg[side].l] = lp.l; rot[leg[side].f] = lp.f; }
  rot[spine] = qX(deg(1.5) * breathe * 0.4);
  rot[chest] = qX(deg(-1.5) * breathe);
  rot[neck] = qY(deg(6) * Math.sin(w));
  rot[head] = mul(qY(deg(8) * Math.sin(w)), qX(deg(2) * Math.sin(2 * w + 1)));
  for (const side of ['L', 'R']) {
    const a = arm[side];
    rot[a.u] = mul(qZ(-a.s * deg(1.5) * (1 + breathe) * 0.5), qX(deg(-2)));
    rot[a.l] = qX(deg(-10));
  }
  return { rot: bones.map((_, b) => rot[b]), hip: [0, hy - HIP_Y, 0] };
}

// ---- jump ------------------------------------------------------------------------
// Keyed poses, eased between. `drop` lowers the hips with feet on the ground
// (legs solved by IK); `air` poses set the leg angles directly.
const JUMP_KEYS = [
  { t: 0.00, drop: 1.5, arms: -2, lean: 2, elbow: 10 },
  { t: 0.20, drop: 24, arms: -40, lean: 22, elbow: 25 },
  { t: 0.34, drop: -3, arms: 140, lean: -2, elbow: 20, rise: 12, toe: 40 },
  { t: 0.55, air: { thigh: 55, flex: 85, toe: 25 }, arms: 110, lean: 8, elbow: 35 },
  { t: 0.82, air: { thigh: 22, flex: 25, toe: 5 }, arms: 70, lean: 4, elbow: 25 },
  { t: 0.94, drop: 2, arms: 45, lean: 6, elbow: 25, toe: -5 },
  { t: 1.08, drop: 20, arms: 25, lean: 20, elbow: 30 },
  { t: 1.30, drop: 1.5, arms: -2, lean: 2, elbow: 10 }
];
function keyLegs(k) {
  if (k.air) return { thigh: deg(k.air.thigh), flex: deg(k.air.flex), toe: deg(k.air.toe), hy: HIP_Y };
  const hy = HIP_Y - k.drop;
  const ik = legIK(hy, 0.5, ANKLE_Y + (k.rise || 0));
  return { thigh: ik.thigh, flex: ik.flex, toe: deg(k.toe || 0), hy };
}
function jumpPose(t) {
  let i = 0;
  while (i < JUMP_KEYS.length - 2 && t > JUMP_KEYS[i + 1].t) i++;
  const a = JUMP_KEYS[i], b = JUMP_KEYS[i + 1];
  const s = smooth(THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1));
  let L;
  if (!a.air && !b.air) {
    // both feet on the ground: ease the hip height and solve the legs each frame, so the feet stay on the floor
    const hy = HIP_Y - lerp(a.drop, b.drop, s);
    const ik = legIK(hy, 0.5, ANKLE_Y + lerp(a.rise || 0, b.rise || 0, s));
    L = { thigh: ik.thigh, flex: ik.flex, toe: deg(lerp(a.toe || 0, b.toe || 0, s)), hy };
  } else {
    const la = keyLegs(a), lb = keyLegs(b);
    L = { thigh: lerp(la.thigh, lb.thigh, s), flex: lerp(la.flex, lb.flex, s), toe: lerp(la.toe, lb.toe, s), hy: lerp(la.hy, lb.hy, s) };
  }
  const rot = {};
  for (const side of ['L', 'R']) { const lp = legPose(L.thigh, L.flex, L.toe); rot[leg[side].u] = lp.u; rot[leg[side].l] = lp.l; rot[leg[side].f] = lp.f; }
  const lean = deg(lerp(a.lean, b.lean, s));
  rot[spine] = qX(lean * 0.6);
  rot[chest] = qX(lean * 0.4);
  rot[head] = qX(-lean * 0.7);
  const arms = deg(lerp(a.arms, b.arms, s)), elbow = deg(lerp(a.elbow, b.elbow, s));
  for (const side of ['L', 'R']) { const ar = arm[side]; rot[ar.u] = qX(-arms); rot[ar.l] = qX(-elbow); }
  return { rot: bones.map((_, b) => rot[b]), hip: [0, L.hy - HIP_Y, 0] };
}

const clips = [
  clip('idle', IDLE_T, idlePose, { rootSpeed: 0 }),
  clip('walking', WALK.T, gaitPose(WALK), { rootSpeed: WALK.speed }),
  clip('running', RUN.T, gaitPose(RUN), { rootSpeed: RUN.speed }),
  clip('jump', 1.3, jumpPose, { rootSpeed: 0 })
];

// ---------------------------------------------------------------------------
// GLB writer
// ---------------------------------------------------------------------------
const chunks = [], views = [], accessors = [];
let byteLength = 0;
function pushView(typed, target) {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  chunks.push(bytes);
  views.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
  byteLength += bytes.byteLength;
  return views.length - 1;
}
function accessor(typed, type, componentType, count, extra = {}, target) {
  accessors.push({ bufferView: pushView(typed, target), componentType, count, type, ...extra });
  return accessors.length - 1;
}
const minmax = (arr, n) => {
  const min = Array(n).fill(Infinity), max = Array(n).fill(-Infinity);
  for (let i = 0; i < arr.length; i++) { const c = i % n; min[c] = Math.min(min[c], arr[i]); max[c] = Math.max(max[c], arr[i]); }
  return { min, max };
};

const color = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b, 1]; };   // linear, as glTF stores it
const materials = [
  { name: 'Mannequin', pbrMetallicRoughness: { baseColorFactor: color(0x8d93a1), metallicFactor: 0, roughnessFactor: 0.9 } },
  { name: 'Accent', pbrMetallicRoughness: { baseColorFactor: color(0x2e333b), metallicFactor: 0, roughnessFactor: 0.6 } }
];
const primitives = [];
let totalTris = 0;
Object.values(parts).forEach((list, mi) => {
  const m = merge(list);
  totalTris += m.idx.length / 3;
  const j = new Uint8Array(m.joints.length * 4), w = new Float32Array(m.joints.length * 4);
  m.joints.forEach((b, i) => { j[i * 4] = b; w[i * 4] = 1; });
  primitives.push({
    attributes: {
      POSITION: accessor(m.pos, 'VEC3', 5126, m.pos.length / 3, minmax(m.pos, 3), 34962),
      NORMAL: accessor(m.nor, 'VEC3', 5126, m.nor.length / 3, {}, 34962),
      JOINTS_0: accessor(j, 'VEC4', 5121, m.joints.length, {}, 34962),
      WEIGHTS_0: accessor(w, 'VEC4', 5126, m.joints.length, {}, 34962)
    },
    indices: accessor(m.idx, 'SCALAR', 5123, m.idx.length, {}, 34963),
    material: mi, mode: 4
  });
});

const nodes = bones.map((b, i) => ({ name: b.name, translation: local(i), children: bones.map((c, k) => (c.parent === i ? k : -1)).filter(k => k >= 0) }));
for (const n of nodes) if (!n.children.length) delete n.children;
const meshNode = nodes.length;
nodes.push({ name: 'Mannequin', mesh: 0, skin: 0 });
const ibm = new Float32Array(bones.length * 16);
bones.forEach((b, i) => new THREE.Matrix4().makeTranslation(-b.world[0], -b.world[1], -b.world[2]).toArray(ibm, i * 16));
const skins = [{ joints: bones.map((_, i) => i), skeleton: hips, inverseBindMatrices: accessor(ibm, 'MAT4', 5126, bones.length) }];

const animations = clips.map((c) => {
  const input = accessor(new Float32Array(c.times), 'SCALAR', 5126, c.times.length, { min: [0], max: [c.times.at(-1)] });
  const samplers = [], channels = [];
  bones.forEach((_, b) => {
    samplers.push({ input, output: accessor(new Float32Array(c.rot[b]), 'VEC4', 5126, c.times.length), interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: b, path: 'rotation' } });
  });
  samplers.push({ input, output: accessor(new Float32Array(c.hipPos), 'VEC3', 5126, c.times.length), interpolation: 'LINEAR' });
  channels.push({ sampler: samplers.length - 1, target: { node: hips, path: 'translation' } });
  return { name: c.name, samplers, channels, extras: c.extras };
});

const bin = new Uint8Array(byteLength + ((4 - (byteLength % 4)) % 4));
{ let o = 0; for (const c of chunks) { bin.set(c, o); o += c.byteLength; } }
const json = {
  asset: { version: '2.0', generator: 'ptah build-mannequin.mjs', extras: { source: 'original, generated by tools/mannequin/build-mannequin.mjs', height: HEIGHT } },
  scene: 0, scenes: [{ nodes: [hips, meshNode] }],
  nodes, meshes: [{ name: 'Mannequin', primitives }], materials, skins, animations,
  buffers: [{ byteLength: bin.byteLength }], bufferViews: views, accessors
};
let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
jsonBytes = Uint8Array.from([...jsonBytes, ...Array(jsonPad).fill(0x20)]);
const total = 12 + 8 + jsonBytes.byteLength + 8 + bin.byteLength;
const glb = Buffer.alloc(total);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(total, 8);
glb.writeUInt32LE(jsonBytes.byteLength, 12); glb.writeUInt32LE(0x4e4f534a, 16); Buffer.from(jsonBytes).copy(glb, 20);
const binAt = 20 + jsonBytes.byteLength;
glb.writeUInt32LE(bin.byteLength, binAt); glb.writeUInt32LE(0x004e4942, binAt + 4); Buffer.from(bin).copy(glb, binAt + 8);

fs.writeFileSync(path.join(OUT, 'mannequin.glb'), glb);
fs.writeFileSync(path.join(OUT, 'mannequin.glb.js'),
  '// Generated by tools/mannequin/build-mannequin.mjs (npm run mannequin): an original mannequin, no third-party assets.\n'
  + '// A base64 GLB so the app can import it as a module under a strict CSP (no fetch). Do not edit.\n'
  + `export const name = "Mannequin";\nexport const clips = ${JSON.stringify(clips.map(c => c.name))};\nexport const height = ${HEIGHT.toFixed(3)};\n`
  + `export const glbBase64 = "${glb.toString('base64')}";\n`);
console.log(`wrote mannequin.glb: ${bones.length} bones, ${totalTris} triangles, clips ${clips.map(c => `${c.name} ${c.extras.duration}s`).join(', ')}, ${(glb.byteLength / 1024).toFixed(0)} KB`);
