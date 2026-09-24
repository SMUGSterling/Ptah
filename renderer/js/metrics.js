// metrics.js — the level's design metrics profile and the presets built from it.
//
// Level designers block out to invariants, not to taste: the player capsule
// has a known height, and half cover, full cover and doorways follow from it
// (see deriveMetrics; the numbers come from the engine template picked at
// launch). This module holds that profile (saved per file in the stage's customLayerData as "ptah:metrics"),
// and turns it into correctly sized preset objects. Pure JS, no DOM or
// Three.js, so it is unit-tested under Node alongside usd.js.
//
// Units are scene units (1u = 1 cm). Speeds are units per second.

// Engine template profiles. A level is built to one of these; the picker on
// startup makes the choice explicit before anything is placed. Core values are
// the templates' own (cm, cm/s; Unity converted from meters). Cover, door and
// corridor sizes are not template facts, so they are derived by the rules in
// deriveMetrics() and stay editable.
//
// Sources (verified 2026-09): UE Third Person template: InitCapsuleSize(42, 96)
// so 192 tall and 84 wide, MaxWalkSpeed 500, JumpZVelocity 700, GravityScale
// 1.75, MaxStepHeight 45, CrouchedHalfHeight 40, BaseEyeHeight 64 above the
// capsule center. UE First Person template: InitCapsuleSize(55, 96), Character
// Movement defaults (600, 420, gravity 980), camera 60 above the capsule
// center. (The Character class defaults, 34/88, are NOT what the templates use.) Unity Starter Assets: Third Person MoveSpeed 2.0 / SprintSpeed 5.335,
// First Person 4.0 / 6.0, both JumpHeight 1.2 m and Gravity -15; controller
// height 1.8, radius 0.28 (TP) / 0.5 (FP), camera root 1.375, step 0.25.
// Unity templates have no crouch; half the standing height is assumed.
// characterHeight is the visible mesh (UE's Manny/Quinn stand about 180 inside
// the 192 capsule; Unity's armature matches its 180 controller); the walk-mode
// mannequin is scaled to it while ticks, markers and collision use the capsule.
// fov is the templates' horizontal camera field of view: UE 90; Unity's
// Cinemachine cameras default to 40 vertical, about 66 horizontal at 16:9.
const CORE = (o) => Object.freeze(o);
const lookupByKey = (arr) => Object.freeze(Object.assign(Object.create(null), Object.fromEntries(arr.map(x => [x.key, x]))));
export const PROFILES = Object.freeze([
  { key: 'ue-third', engine: 'Unreal Engine', label: 'Third Person template', short: 'UE 3rd person',
    hint: 'Capsule 192 × 42, walks 500, jumps 143. The most common starting point.',
    core: CORE({ playerHeight: 192, capsuleRadius: 42, characterHeight: 180, eyeHeight: 160, crouchHeight: 80, stepHeight: 45, walkSpeed: 500, runSpeed: 500, jumpHeight: 143, jumpDistance: 408, fov: 90 }) },
  { key: 'ue-first', engine: 'Unreal Engine', label: 'First Person template', short: 'UE 1st person',
    hint: 'Capsule 192 × 55, walks 600, jumps 90. Character Movement defaults.',
    core: CORE({ playerHeight: 192, capsuleRadius: 55, characterHeight: 180, eyeHeight: 156, crouchHeight: 80, stepHeight: 45, walkSpeed: 600, runSpeed: 600, jumpHeight: 90, jumpDistance: 514, fov: 90 }) },
  { key: 'unity-third', engine: 'Unity', label: 'Third Person (Starter Assets)', short: 'Unity 3rd person',
    hint: 'Controller 180 × 28, walks 200, sprints 534, jumps 120.',
    core: CORE({ playerHeight: 180, capsuleRadius: 28, characterHeight: 180, eyeHeight: 137.5, crouchHeight: 90, stepHeight: 25, walkSpeed: 200, runSpeed: 533.5, jumpHeight: 120, jumpDistance: 427, fov: 66 }) },
  { key: 'unity-first', engine: 'Unity', label: 'First Person (Starter Assets)', short: 'Unity 1st person',
    hint: 'Controller 180 × 50, walks 400, sprints 600, jumps 120.',
    core: CORE({ playerHeight: 180, capsuleRadius: 50, characterHeight: 180, eyeHeight: 137.5, crouchHeight: 90, stepHeight: 25, walkSpeed: 400, runSpeed: 600, jumpHeight: 120, jumpDistance: 480, fov: 66 }) }
]);
export const PROFILE_BY_KEY = lookupByKey(PROFILES);

const up10 = (v) => Math.ceil(v / 10) * 10;

/**
 * Cover, door and corridor sizes from the core numbers:
 *   half cover = crouch + 20 (hides a crouched capsule with margin)
 *   full cover = height + 20
 *   door height = height + jump + 20 (a jumping player clears the lintel)
 *   door width = 4 × radius, at least 120 (two abreast)
 *   corridor = 2 × door width
 */
export function deriveMetrics(core) {
  return {
    halfCover: up10(core.crouchHeight + 20),
    fullCover: up10(core.playerHeight + 20),
    doorHeight: up10(core.playerHeight + core.jumpHeight + 20),
    doorWidth: Math.max(120, up10(core.capsuleRadius * 4)),
    corridorWidth: 2 * Math.max(120, up10(core.capsuleRadius * 4))
  };
}

/** The full metrics object for a profile key (core + derived + the key itself). */
export function profileMetrics(key) {
  const p = PROFILE_BY_KEY[key] || PROFILE_BY_KEY['ue-third'];
  return { profile: p.key, ...p.core, ...deriveMetrics(p.core) };
}

export const METRICS_DEFAULTS = Object.freeze(profileMetrics('ue-third'));
export const METRIC_NUMBER_KEYS = Object.freeze(Object.keys(METRICS_DEFAULTS).filter(k => k !== 'profile'));

// Panel layout: [key, label, hint]. Order is the order in the Metrics panel.
export const METRICS_FIELDS = Object.freeze([
  ['playerHeight', 'Player height', 'Standing capsule height. Drives PlayerStart and Spawn capsules and their ticks.'],
  ['capsuleRadius', 'Capsule radius', 'Collision radius. Drives the capsule markers, walk-mode body and door width.'],
  ['characterHeight', 'Character height', 'Visible mesh height; the walk-mode mannequin is scaled to it. Unreal\'s capsule is taller than its mannequin.'],
  ['eyeHeight', 'Eye height', 'Walk-mode camera height.'],
  ['crouchHeight', 'Crouch height', 'Capsule height while crouched (hold C in walk mode).'],
  ['stepHeight', 'Step height', 'Tallest riser walked over without a jump.'],
  ['walkSpeed', 'Walk speed', 'Units per second.'],
  ['runSpeed', 'Run speed', 'Units per second (Shift in walk mode).'],
  ['jumpHeight', 'Jump height', 'Apex above the feet (Space in walk mode).'],
  ['jumpDistance', 'Jump distance', 'Horizontal reach of a running jump.'],
  ['fov', 'Camera FOV', 'Walk-mode horizontal field of view in degrees (the editor camera is unaffected).'],
  ['halfCover', 'Half cover', 'Derived: crouch + 20.'],
  ['fullCover', 'Full cover', 'Derived: height + 20.'],
  ['doorHeight', 'Door height', 'Derived: height + jump + 20, so a jumping player clears the lintel.'],
  ['doorWidth', 'Door width', 'Derived: 4 × capsule radius, at least 120.'],
  ['corridorWidth', 'Corridor width', 'Derived: 2 × door width.']
]);

const MIN = 1, MAX = 100000;

/** Fill missing keys with defaults, clamp every number, keep a known profile key or mark it custom. */
export function normalizeMetrics(m) {
  const out = {};
  for (const key of METRIC_NUMBER_KEYS) {
    const v = m && typeof m[key] === 'number' && isFinite(m[key]) ? m[key] : METRICS_DEFAULTS[key];
    out[key] = key === 'fov' ? Math.min(150, Math.max(30, v)) : Math.min(MAX, Math.max(MIN, v));
  }
  const p = m && typeof m.profile === 'string' ? m.profile : null;
  out.profile = p && (PROFILE_BY_KEY[p] || p === 'custom') ? p : (m ? 'custom' : METRICS_DEFAULTS.profile);
  return out;
}

export function sameMetrics(a, b) {
  return METRIC_NUMBER_KEYS.every(k => a[k] === b[k]) && a.profile === b.profile;
}

// Wall/post thickness used by the composite presets, in units. Blockout walls
// are thick on purpose: engines' collision and students' eyes both prefer it.
const WALL_T = 32;
const COVER_DEPTH = 32;
const COVER_WIDTH = 128;
const TREAD = 32;                     // stair tread depth for the step-run preset

/**
 * Preset objects sized from a metrics profile. Each preset is a list of object
 * specs relative to the click point (x on the ground); y is the object center,
 * so every piece rests on y = 0. Specs with more than one object are grouped by
 * the caller. Sizes are dimensions in units (they become the node scale).
 *
 * Returns { key: { label, hint, objects: [{ type, name, intent, position, scale, params? }] } }.
 */
export function presetSpecs(metricsIn) {
  const m = normalizeMetrics(metricsIn);
  const box = (name, intent, w, h, d, x = 0, z = 0) => ({
    type: 'cube', name, intent,
    position: { x, y: h / 2, z },
    scale: { x: w, y: h, z: d }
  });
  const steps = Math.max(2, Math.round(m.playerHeight / m.stepHeight / 2)); // a run about half player height
  const runH = steps * m.stepHeight;
  return {
    halfcover: {
      label: 'Half cover', hint: `${m.halfCover}u high: crouch behind, shoot over`,
      objects: [box('HalfCover', 'cover', COVER_WIDTH, m.halfCover, COVER_DEPTH)]
    },
    fullcover: {
      label: 'Full cover', hint: `${m.fullCover}u high: stand behind`,
      objects: [box('FullCover', 'cover', COVER_WIDTH, m.fullCover, COVER_DEPTH)]
    },
    doorway: {
      label: 'Doorway', hint: `${m.doorHeight}u x ${m.doorWidth}u opening`,
      group: 'Doorway',
      objects: [
        box('Post_L', 'wall', WALL_T, m.doorHeight, WALL_T, -(m.doorWidth / 2 + WALL_T / 2)),
        box('Post_R', 'wall', WALL_T, m.doorHeight, WALL_T, m.doorWidth / 2 + WALL_T / 2),
        { type: 'cube', name: 'Lintel', intent: 'wall',
          position: { x: 0, y: m.doorHeight + WALL_T / 2, z: 0 },
          scale: { x: m.doorWidth + WALL_T * 2, y: WALL_T, z: WALL_T } }
      ]
    },
    corridor: {
      label: 'Corridor', hint: `${m.corridorWidth}u wide, ${m.fullCover + m.stepHeight}u tall, 256u long`,
      group: 'Corridor',
      objects: [
        box('Floor', 'floor', m.corridorWidth + WALL_T * 2, 8, 256),
        box('Wall_L', 'wall', WALL_T, m.fullCover + m.stepHeight, 256, -(m.corridorWidth / 2 + WALL_T / 2)),
        box('Wall_R', 'wall', WALL_T, m.fullCover + m.stepHeight, 256, m.corridorWidth / 2 + WALL_T / 2)
      ]
    },
    steprun: {
      label: 'Step run', hint: `${steps} risers of ${m.stepHeight}u, ${TREAD}u treads`,
      objects: [{
        type: 'stairs', name: 'StepRun', intent: 'floor',
        position: { x: 0, y: runH / 2, z: 0 },
        scale: { x: COVER_WIDTH, y: runH, z: steps * TREAD },
        params: { steps }
      }]
    }
  };
}

export const PRESET_KEYS = Object.freeze(['halfcover', 'fullcover', 'doorway', 'corridor', 'steprun']);

// Intent palette: the only colors in the editor. Blockout color is a message to
// the environment artist, not decoration; students learn the vocabulary by
// picking from it. `hex` is the editor color; export writes the same value as
// displayColor plus a `ptah:intent` attribute on the prim.
export const INTENTS = Object.freeze([
  { key: 'floor',       label: 'Floor',       hex: 0x565e6c, hint: 'Walkable ground, stairs, ramps' },
  { key: 'wall',        label: 'Wall',        hex: 0x8d93a1, hint: 'Blocks movement and sight' },
  { key: 'cover',       label: 'Cover',       hex: 0xd9832f, hint: 'Combat cover (check height against metrics)' },
  { key: 'blocker',     label: 'Blocker',     hex: 0xc0392b, hint: 'Invisible or temporary blocking volume' },
  { key: 'water',       label: 'Water',       hex: 0x3d7dd8, hint: 'Water or other slow/hazard fluid' },
  { key: 'hazard',      label: 'Hazard',      hex: 0xe0c020, hint: 'Damage: fire, electricity, fall' },
  { key: 'interactive', label: 'Interactive', hex: 0x4cae5a, hint: 'Doors, switches, pickups, climbables' },
  { key: 'placeholder', label: 'Placeholder', hex: 0xb45fbf, hint: 'Stand-in for a prop or set piece' }
]);

export const INTENT_BY_KEY = lookupByKey(INTENTS);

// Gameplay markers: empties an engine script replaces with real actors.
// `capsule` markers draw a player-sized capsule; `volume` markers use the
// node's scale as their box size and export it in the Xform scale op.
export const MARKERS = Object.freeze([
  { key: 'PlayerStart', label: 'Player start', hex: 0x4cae5a, shape: 'capsule', hint: 'Where the player spawns; facing = initial view' },
  { key: 'Spawn',       label: 'Enemy spawn',  hex: 0xc0392b, shape: 'capsule', hint: 'Enemy or NPC spawn point with facing' },
  { key: 'Cover',       label: 'Cover point',  hex: 0xd9832f, shape: 'cover',   hint: 'AI cover position; arrow = direction covered from' },
  { key: 'Objective',   label: 'Objective',    hex: 0xd9a441, shape: 'gem',     hint: 'Goal, pickup or interaction point' },
  { key: 'Trigger',     label: 'Trigger volume', hex: 0x6f8ff0, shape: 'volume', hint: 'Box volume; size is the object Size' }
]);

export const MARKER_BY_KEY = lookupByKey(MARKERS);
export const MARKER_DEFAULT_SIZE = Object.freeze(Object.assign(Object.create(null), { Trigger: [256, 192, 256] }));
