// GitHub Pages packaging: everything the page loads moves into one versioned
// folder, index.html and the import map point at it, and the CSP hash of the
// rewritten import map matches. Runs against a copy of the real renderer/.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePagesSite } from '../tools/prepare-pages.mjs';

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  pass  ' + msg);
  else { failures++; console.log('  FAIL  ' + msg); }
};

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-pages-'));
const repo = path.join(tmp, 'repo');
const renderer = path.join(repo, 'renderer');
fs.mkdirSync(repo);
fs.cpSync(path.join(here, '..', 'renderer'), renderer, { recursive: true });
fs.copyFileSync(path.join(here, '..', 'LICENSE'), path.join(repo, 'LICENSE'));

preparePagesSite({ repoRoot: repo, version: 'abc123' });

const v = path.join(renderer, 'v-abc123');
ok(fs.existsSync(path.join(renderer, 'LICENSE.txt')), 'copies LICENSE into renderer/LICENSE.txt');
ok(!fs.existsSync(path.join(renderer, 'package.json')), 'removes renderer/package.json');
ok(!fs.existsSync(path.join(v, 'assets', 'mannequin.glb')) && fs.existsSync(path.join(v, 'assets', 'mannequin.glb.js')), 'drops the mannequin source, keeps the module the app loads');
ok(['js', 'vendor', 'assets', 'style.css'].every(n => !fs.existsSync(path.join(renderer, n)) && fs.existsSync(path.join(v, n))),
  'moves js/, vendor/, assets/ and style.css into v-abc123/');
ok(fs.existsSync(path.join(v, 'js', 'app.js')) && fs.existsSync(path.join(v, 'vendor', 'three.module.js')), 'keeps their layout, so ../assets and the import map resolve');

const index = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
ok(index.includes('src="v-abc123/js/app.js"') && index.includes('href="v-abc123/style.css"'), 'index.html loads the script and stylesheet from the versioned folder');
const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(index)[1];
ok(map.includes('"./v-abc123/vendor/three.module.js"') && map.includes('"./v-abc123/vendor/addons/"') && !map.includes('"./vendor/'), 'the import map points at the versioned three.js');
const hash = `'sha256-${crypto.createHash('sha256').update(map, 'utf8').digest('base64')}'`;
ok(index.includes(hash), 'the CSP allows the rewritten import map by its new hash');

// every file index.html references must exist in the packaged site
const refs = [...index.matchAll(/(?:src|href)="(?!data:|https?:|#)([^"]+)"/g)].map(m => m[1]);
ok(refs.length >= 3 && refs.every(r => fs.existsSync(path.join(renderer, r))), 'every file index.html references exists: ' + refs.join(', '));

// a Windows checkout has CRLF line endings; the hash must be the one the browser computes (over LF)
const crlf = path.join(tmp, 'crlf');
fs.mkdirSync(crlf);
fs.cpSync(path.join(here, '..', 'renderer'), path.join(crlf, 'renderer'), { recursive: true });
fs.copyFileSync(path.join(here, '..', 'LICENSE'), path.join(crlf, 'LICENSE'));
const crlfIndex = path.join(crlf, 'renderer', 'index.html');
fs.writeFileSync(crlfIndex, fs.readFileSync(crlfIndex, 'utf8').replace(/\r?\n/g, '\r\n'));
preparePagesSite({ repoRoot: crlf, version: 'abc123' });
ok(fs.readFileSync(crlfIndex, 'utf8') === index, 'a CRLF checkout (Windows) packages to the same index.html and hash');

let err = null;
try { preparePagesSite({ repoRoot: repo, version: '../escape' }); } catch (e) { err = e; }
ok(err && /safe folder name/.test(err.message), 'refuses a version that is not a plain folder name');

fs.rmSync(tmp, { recursive: true, force: true });
if (failures > 0) process.exit(1);
