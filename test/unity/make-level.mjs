// Writes the level the Unity harness converts: markers nested in groups, two of
// them with the same name (Yard written first, so a marker from Arena matched
// to Yard's same-named object would win), a group whose name contains ") {",
// and a note whose text looks like a marker prim (single-quoted, as usd-core writes it).
import fs from 'node:fs';
import { exportUsda } from '../../renderer/js/usd.js';

const T = (name, type, x, extra = {}) => ({ name, type, position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, children: [], ...extra });
const arena = T('Arena', 'group', 0, { children: [T('Spawn_01', 'marker', 10, { marker: 'Spawn', tags: ['wave 1', 'say "hi"'] }), T('Wall', 'cube', 5, { intent: 'wall', color: [1, 0, 0] })] });
const yard = T('Yard', 'group', 100, { children: [T('Spawn_01', 'marker', 20, { marker: 'Spawn', tags: ['wave 2'] }), T('Gate', 'marker', 30, { marker: 'Trigger', scale: { x: 200, y: 100, z: 50 } })] });
const start = T('PlayerStart_01', 'marker', 0, { marker: 'PlayerStart' });
// a group whose name contains ") {": the prim head must not end inside its ptah:name string
const room = T('Room (A) {v2}', 'group', 200, { children: [T('Spawn_02', 'marker', 40, { marker: 'Spawn', tags: ['room'] })] });
const note = T('Note {tricky}', 'note', 0, { text: 'def Xform "Fake" { custom string ptah:marker = "Spawn" }' });
let text = exportUsda([start, yard, arena, room, note], {});
// usd-core re-saves a string that contains " in single quotes, unescaped: the
// fake prim in the note then reads as real syntax to anything not string-aware
text = text.replace(/string "ptah:text" = ".*"/, `string "ptah:text" = 'def Xform "Fake" { custom string ptah:marker = "Spawn" }'`);
if (!text.includes(`'def Xform "Fake"`)) throw new Error('make-level: note text not found to rewrite');
// usd-core re-saves tags the same way: a tag holding " in single quotes, one holding both
// quotes escaped, one spanning lines triple-quoted (as Usd's ExportToString writes them)
const tags = 'custom string[] ptah:tags = ["wave 1", "say \\"hi\\""]';
if (!text.includes(tags)) throw new Error('make-level: Arena tags not found to rewrite');
text = text.replace(tags, 'custom string[] ptah:tags = ["wave 1", \'say "hi"\', \'br]acket "q"\', "it\'s \\"x\\"", "back\\\\slash", """two\nlines"""]');
// a group whose own body quotes a marker attribute in a string: not a marker
const roomHead = /(def Xform "Room__A___v2_"[\s\S]*?\n(\s*)\{\n)/;
if (!roomHead.test(text)) throw new Error('make-level: Room body not found');
text = text.replace(roomHead, (m, head, ind) => `${head}${ind}    custom string doc = 'custom string ptah:marker = "Spawn"'\n`);
fs.writeFileSync(process.argv[2], text);
