// Focused regression test for GitHub Pages packaging and JS cache-busting.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { preparePagesSite } from '../tools/prepare-pages.mjs';

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  pass  ' + msg);
  else { failures++; console.log('  FAIL  ' + msg); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-pages-'));
const repo = path.join(tmp, 'repo');
const renderer = path.join(repo, 'renderer');
const assets = path.join(renderer, 'assets');
const js = path.join(renderer, 'js');
fs.mkdirSync(assets, { recursive: true });
fs.mkdirSync(js, { recursive: true });

fs.writeFileSync(path.join(repo, 'LICENSE'), 'license text\n');
fs.writeFileSync(path.join(renderer, 'package.json'), '{ "type": "module" }\n');
fs.writeFileSync(path.join(assets, 'mannequin.glb'), 'binary');
fs.writeFileSync(path.join(renderer, 'index.html'), `<!DOCTYPE html>
<script type="importmap">{ "imports": { "three": "./vendor/three.module.js" } }</script>
<script type="module" src="js/app.js"></script>
`);
fs.writeFileSync(path.join(js, 'app.js'), `import './usd.js';\nconsole.log('app');\n`);
fs.writeFileSync(path.join(js, 'usd.js'), `export const usd = true;\n`);

preparePagesSite({ repoRoot: repo, version: 'abc123' });

const versioned = path.join(renderer, 'js-abc123');
ok(fs.existsSync(path.join(renderer, 'LICENSE.txt')), 'copies LICENSE into renderer/LICENSE.txt');
ok(!fs.existsSync(path.join(renderer, 'package.json')), 'removes renderer/package.json');
ok(!fs.existsSync(path.join(assets, 'mannequin.glb')), 'removes renderer/assets/mannequin.glb');
ok(!fs.existsSync(js) && fs.existsSync(versioned), 'renames renderer/js to a versioned directory');
ok(fs.existsSync(path.join(versioned, 'app.js')) && fs.existsSync(path.join(versioned, 'usd.js')), 'keeps nested JS modules together in the versioned directory');

const index = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
ok(index.includes('src="js-abc123/app.js"') && !index.includes('src="js/app.js"'), 'rewrites the HTML entrypoint to the versioned JS directory');
ok(index.includes('"three": "./vendor/three.module.js"'), 'leaves the import map intact');

fs.rmSync(tmp, { recursive: true, force: true });
if (failures > 0) process.exit(1);
