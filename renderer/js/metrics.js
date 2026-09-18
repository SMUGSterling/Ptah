// metrics.js — the level's design metrics profile and the presets built from it.
//
// Level designers block out to invariants, not to taste: the player is 180u
// tall, half cover is 110u, a doorway is 240x120u. This module holds that
// profile (saved per file in the stage's customLayerData as "ptah:metrics"),
// and turns it into correctly sized preset objects. Pure JS, no DOM or
// Three.js, so it is unit-tested under Node alongside usd.js.
//
// Units are scene units (1u = 1 cm). Speeds are units per second.

export const METRICS_DEFAULTS = Object.freeze({
  playerHeight: 180,      // standing capsule height (the H marker and PlayerStart capsule)
  eyeHeight: 165,         // camera height in walk mode
  crouchHeight: 120,      // capsule height while crouched (C in walk mode)
  stepHeight: 40,         // tallest riser the player walks over without jumping
  walkSpeed: 400,         // 4 m/s
  runSpeed: 650,          // 6.5 m/s
  jumpHeight: 110,        // apex above the feet
  jumpDistance: 400,      // horizontal reach of a running jump
  halfCover: 110,         // crouch behind it, shoot over it
  fullCover: 190,         // stand behind it
  doorHeight: 240,
  doorWidth: 120,
  corridorWidth: 300
});

// Panel layout: [key, label, hint]. Order is the order in the Metrics panel.
export const METRICS_FIELDS = Object.freeze([
  ['playerHeight', 'Player height', 'Standing height. Drives the H marker and PlayerStart capsules.'],
  ['eyeHeight', 'Eye height', 'Walk-mode camera height.'],
  ['crouchHeight', 'Crouch height', 'Capsule height while crouched (hold C in walk mode).'],
  ['stepHeight', 'Step height', 'Tallest riser walked over without a jump.'],
  ['walkSpeed', 'Walk speed', 'Units per second.'],
  ['runSpeed', 'Run speed', 'Units per second (Shift in walk mode).'],
  ['jumpHeight', 'Jump height', 'Apex above the feet (Space in walk mode).'],
  ['jumpDistance', 'Jump distance', 'Horizontal reach of a running jump.'],
  ['halfCover', 'Half cover', 'Height of crouch cover.'],
  ['fullCover', 'Full cover', 'Height of standing cover.'],
  ['doorHeight', 'Door height', ''],
  ['doorWidth', 'Door width', ''],
  ['corridorWidth', 'Corridor width', '']
]);

const MIN = 1, MAX = 100000;

/** Fill missing keys with defaults and clamp every value to a sane positive range. */
export function normalizeMetrics(m) {
  const out = {};
  for (const key of Object.keys(METRICS_DEFAULTS)) {
    const v = m && typeof m[key] === 'number' && isFinite(m[key]) ? m[key] : METRICS_DEFAULTS[key];
    out[key] = Math.min(MAX, Math.max(MIN, v));
  }
  return out;
}

export function sameMetrics(a, b) {
  return Object.keys(METRICS_DEFAULTS).every(k => a[k] === b[k]);
}

// Wall/post thickness used by the composite presets, in units.
const WALL_T = 16;
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

export const INTENT_BY_KEY = Object.freeze(Object.fromEntries(INTENTS.map(i => [i.key, i])));

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

export const MARKER_BY_KEY = Object.freeze(Object.fromEntries(MARKERS.map(m => [m.key, m])));
export const MARKER_DEFAULT_SIZE = Object.freeze({ Trigger: [256, 192, 256] });
