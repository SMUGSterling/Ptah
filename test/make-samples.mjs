// make-samples.mjs — regenerate test/sample.usda from the exporter so the
// checked-in sample always matches the current format. Run: npm run samples
//
// The sample is a small but complete level: a grouped tower with nested
// children, stairs with a custom step count, a wedge ramp, a hidden object,
// a note, intent-tagged cover, gameplay markers (a player start with tags and
// a trigger volume), a metrics profile, and a tiny embedded reference image.
// CI validates it with Pixar's usd-core (test/usd-validate.py).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportUsda } from '../renderer/js/usd.js';
import { METRICS_DEFAULTS } from '../renderer/js/metrics.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const O = (name, type, position, scale, extra = {}) => ({
  name, type, position, scale,
  rotation: extra.rotation || { x: 0, y: 0, z: 0 },
  color: extra.color === undefined ? [0.55, 0.58, 0.63] : extra.color,
  visible: extra.visible !== false,
  children: extra.children || [],
  ...(extra.params ? { params: extra.params } : {}),
  ...(extra.text != null ? { text: extra.text } : {}),
  ...(extra.intent ? { intent: extra.intent } : {}),
  ...(extra.marker ? { marker: extra.marker } : {}),
  ...(extra.tags ? { tags: extra.tags } : {}),
  ...(extra.uid ? { uid: extra.uid } : {})
});

const objects = [
  O('Floor', 'plane', { x: 0, y: 0, z: 0 }, { x: 1024, y: 1, z: 1024 }, { color: [0.34, 0.37, 0.42], intent: 'floor', uid: 'a1b2c3d4' }),
  O('Wall 01', 'cube', { x: 128, y: 32, z: -64 }, { x: 256, y: 64, z: 16 }, { rotation: { x: 0, y: 45, z: 0 }, intent: 'wall' }),
  O('HalfCover_01', 'cube', { x: -200, y: 55, z: -100 }, { x: 128, y: 110, z: 32 }, { color: [0.85, 0.51, 0.18], intent: 'cover', tags: ['lane-a'] }),
  O('Pillar', 'cylinder', { x: 0, y: 96, z: 0 }, { x: 48, y: 192, z: 48 }, { color: [0.77, 0.54, 0.35], visible: false }),
  O('Tower', 'group', { x: 300, y: 0, z: 300 }, { x: 1, y: 1, z: 1 }, {
    rotation: { x: 0, y: 90, z: 0 }, color: null,
    children: [
      O('Base', 'cube', { x: 0, y: 32, z: 0 }, { x: 128, y: 64, z: 128 }, {
        color: [0.5, 0.5, 0.5],
        children: [
          O('Flag', 'note', { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 1 }, { color: [0.85, 0.64, 0.25], text: 'Objective "A"\nReach the top of the tower.' })
        ]
      }),
      O('Steps', 'stairs', { x: 100, y: 16, z: 0 }, { x: 64, y: 32, z: 96 }, { params: { steps: 5 } }),
      O('Ramp', 'wedge', { x: -100, y: 16, z: 0 }, { x: 64, y: 32, z: 128 }, { rotation: { x: 0, y: 180, z: 0 } })
    ]
  }),
  O('Spawn', 'note', { x: -256, y: 0, z: 256 }, { x: 1, y: 1, z: 1 }, { color: [0.36, 0.5, 0.91], text: 'Player spawn. First sightline: the tower.' }),
  O('PlayerStart_01', 'marker', { x: -256, y: 0, z: 200 }, { x: 1, y: 1, z: 1 }, { color: [0.3, 0.68, 0.35], rotation: { x: 0, y: -45, z: 0 }, marker: 'PlayerStart', tags: ['team:blue', 'wave "1"'] }),
  O('Trigger_01', 'marker', { x: 300, y: 96, z: 60 }, { x: 256, y: 192, z: 256 }, { color: [0.44, 0.56, 0.94], marker: 'Trigger' })
];

// 2x2 checker PNG, the smallest honest reference image
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwPCfgYGB4T8DAwMDAB0JBP8X4G0JAAAAAElFTkSuQmCC';

const text = exportUsda(objects, {
  appVersion: JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version,
  reference: { image: png, width: 1024, x: 0, z: 0, rotation: 0, opacity: 0.5 },
  metrics: { ...METRICS_DEFAULTS, eyeHeight: 160 }
});
const out = path.join(here, 'sample.usda');
fs.writeFileSync(out, text);
console.log(`wrote ${path.relative(process.cwd(), out)} (${text.length} bytes)`);
