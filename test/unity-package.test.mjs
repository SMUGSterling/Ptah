// Checks the Unity package in tools/unity (installed from Git by Package Manager). Unity ignores
// any file or folder in an immutable (Git) package that has no .meta, so every one must have one,
// each with its own GUID; the assemblies must compile the runtime component for players and the
// menu for the Editor only; and the package's version must be Ptah's. Run: node test/unity-package.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pkgDir = path.join(root, 'tools', 'unity');
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  pass  ' + msg); else { failures++; console.log('  FAIL  ' + msg); } };

console.log('\n[unity package]');
const entries = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    entries.push(p);
    if (fs.statSync(p).isDirectory()) walk(p);
  }
})(pkgDir);
const assets = entries.filter(p => !p.endsWith('.meta'));
const metas = entries.filter(p => p.endsWith('.meta'));
const rel = (p) => path.relative(pkgDir, p);
const missing = assets.filter(p => !fs.existsSync(p + '.meta')).map(rel);
ok(missing.length === 0, `every file and folder has a .meta (${assets.length} assets)${missing.length ? '; missing: ' + missing.join(', ') : ''}`);
const orphans = metas.filter(p => !fs.existsSync(p.slice(0, -5))).map(rel);
ok(orphans.length === 0, 'no .meta without its file' + (orphans.length ? ': ' + orphans.join(', ') : ''));
const guids = metas.map(p => (fs.readFileSync(p, 'utf8').match(/^guid: ([0-9a-f]{32})$/m) || [])[1]);
ok(guids.every(Boolean) && new Set(guids).size === guids.length, 'each .meta has its own 32-hex GUID');
const folderMetas = metas.filter(p => fs.statSync(p.slice(0, -5)).isDirectory());
ok(folderMetas.every(p => /^folderAsset: yes$/m.test(fs.readFileSync(p, 'utf8'))), 'folder .meta files mark folders');

const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const ptah = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
ok(pkg.version === ptah.version, `package version ${pkg.version} matches Ptah's ${ptah.version}`);
ok(/^com\.[a-z0-9-]+\.[a-z0-9-]+$/.test(pkg.name) && /^\d{4}\.\d$/.test(pkg.unity), `package name ${pkg.name} and minimum Unity ${pkg.unity} are valid`);

const runtime = JSON.parse(fs.readFileSync(path.join(pkgDir, 'Runtime', 'Ptah.Markers.asmdef'), 'utf8'));
const editor = JSON.parse(fs.readFileSync(path.join(pkgDir, 'Editor', 'Ptah.Markers.Editor.asmdef'), 'utf8'));
ok(!runtime.includePlatforms || runtime.includePlatforms.length === 0, 'the runtime assembly (PtahMarker) builds for every platform, so the component exists in players');
ok(editor.includePlatforms?.join() === 'Editor' && editor.references?.includes(runtime.name), 'the editor assembly (the menu) is Editor-only and references the runtime one');
ok(runtime.autoReferenced !== false, 'project scripts can use PtahMarker without an assembly reference of their own');

// the README's install URL points at this folder and this version
const readme = fs.readFileSync(path.join(pkgDir, 'README.md'), 'utf8');
ok(readme.includes(`https://github.com/SMUGSterling/Ptah.git?path=/tools/unity#v${ptah.version}`), 'the install URL in the package README names this version');
const guide = fs.readFileSync(path.join(root, 'docs', 'importing.md'), 'utf8');
ok(guide.includes(`https://github.com/SMUGSterling/Ptah.git?path=/tools/unity#v${ptah.version}`), 'docs/importing.md gives the same install URL');

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
