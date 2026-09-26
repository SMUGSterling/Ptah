// prepare-pages.mjs — package renderer/ for GitHub Pages deployment.
//
// GitHub Pages caches every file for about 10 minutes, so after a deploy a
// browser could pair the new index.html with old scripts, or new scripts with
// an old three.js. Everything the page loads (scripts, three.js, the mannequin,
// the stylesheet) moves into one per-commit folder, v-<version>/, and
// index.html points there: a page only ever loads files from its own deploy.
// The folders keep their relative layout, so imports between them still work.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSIONED = ['js', 'vendor', 'assets', 'style.css'];

export function preparePagesSite({ repoRoot, version }) {
  if (!repoRoot) throw new Error('repoRoot is required');
  if (!version) throw new Error('version is required');
  if (!/^[\w.-]+$/.test(version)) throw new Error(`version "${version}" is not a safe folder name`);

  const rendererRoot = path.join(repoRoot, 'renderer');
  const dir = `v-${version}`;
  const versionedRoot = path.join(rendererRoot, dir);
  const indexPath = path.join(rendererRoot, 'index.html');

  fs.rmSync(path.join(rendererRoot, 'package.json'), { force: true });
  fs.rmSync(path.join(rendererRoot, 'assets', 'mannequin.glb'), { force: true });
  fs.copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(rendererRoot, 'LICENSE.txt'));

  fs.rmSync(versionedRoot, { recursive: true, force: true });
  fs.mkdirSync(versionedRoot);
  for (const name of VERSIONED) fs.renameSync(path.join(rendererRoot, name), path.join(versionedRoot, name));

  // Line endings as the browser sees them: the HTML parser turns CRLF into LF
  // before hashing an inline script, and a Windows checkout has CRLF.
  let index = fs.readFileSync(indexPath, 'utf8').replace(/\r\n?/g, '\n');
  const replaceOnce = (from, to) => {
    if (!index.includes(from)) throw new Error(`renderer/index.html is missing ${from}`);
    index = index.replace(from, to);
  };
  replaceOnce('src="js/app.js"', `src="${dir}/js/app.js"`);
  replaceOnce('href="style.css"', `href="${dir}/style.css"`);

  // The import map is an inline script, allowed by its hash in the CSP: rewrite
  // it, then replace the old hash with the new one.
  const mapRe = /(<script type="importmap">)([\s\S]*?)(<\/script>)/;
  const m = mapRe.exec(index);
  if (!m) throw new Error('renderer/index.html has no import map');
  const hash = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;
  const oldHash = hash(m[2]);
  if (!index.includes(oldHash)) throw new Error('the CSP does not list the import map\'s hash; update it in renderer/index.html first');
  const newMap = m[2].replaceAll('"./vendor/', `"./${dir}/vendor/`);
  if (newMap === m[2]) throw new Error('the import map has no ./vendor/ entries');
  index = index.replace(mapRe, `$1${newMap}$3`).replace(oldHash, hash(newMap));

  fs.writeFileSync(indexPath, index);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const version = process.argv[2] || process.env.PTAH_PAGES_VERSION || process.env.GITHUB_SHA;
  preparePagesSite({ repoRoot, version });
}
