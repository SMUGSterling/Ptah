// Writes the level the Unity harness converts: markers nested in groups, two of
// them with the same name, and a note whose text looks like a marker prim.
import fs from 'node:fs';
import { exportUsda } from '../../renderer/js/usd.js';

const T = (name, type, x, extra = {}) => ({ name, type, position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, children: [], ...extra });
const arena = T('Arena', 'group', 0, { children: [T('Spawn_01', 'marker', 10, { marker: 'Spawn', tags: ['wave 1', 'say "hi"'] }), T('Wall', 'cube', 5, { intent: 'wall', color: [1, 0, 0] })] });
const yard = T('Yard', 'group', 100, { children: [T('Spawn_01', 'marker', 20, { marker: 'Spawn', tags: ['wave 2'] }), T('Gate', 'marker', 30, { marker: 'Trigger', scale: { x: 200, y: 100, z: 50 } })] });
const start = T('PlayerStart_01', 'marker', 0, { marker: 'PlayerStart' });
const note = T('Note {tricky}', 'note', 0, { text: 'def Xform "Fake" { custom string ptah:marker = "Spawn" }' });
fs.writeFileSync(process.argv[2], exportUsda([start, arena, yard, note], {}));
