// prepare-pages.mjs — package renderer/ for GitHub Pages deployment.
//
// GitHub Pages caches every file for about 10 minutes, so after a deploy a
// browser could pair the new index.html with old scripts, or new scripts with
// an old three.js. Everything the page loads (scripts, three.js, the mannequin,
// the stylesheets) moves into one per-commit folder, v-<version>/, and
// index.html and mobile/index.html point there: a page only ever loads files from its own deploy.
// The folders keep their relative layout, so imports between them still work.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSIONED = ['js', 'vendor', 'assets', 'style.css', 'mobile.css'];

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

  // Both pages point into the versioned folder: index.html, and the mobile page one level down.
  rewritePage(indexPath, '', dir);
  const mobilePath = path.join(rendererRoot, 'mobile', 'index.html');
  if (fs.existsSync(mobilePath)) rewritePage(mobilePath, '../', dir);
}

// `up` is the page's way back to renderer/ ('' or '../').
function rewritePage(pagePath, up, dir) {
  const name = up ? 'renderer/mobile/index.html' : 'renderer/index.html';
  // Line endings as the browser sees them: the HTML parser turns CRLF into LF
  // before hashing an inline script, and a Windows checkout has CRLF.
  let index = fs.readFileSync(pagePath, 'utf8').replace(/\r\n?/g, '\n');
  const replaceOnce = (from, to) => {
    if (!index.includes(from)) throw new Error(`${name} is missing ${from}`);
    index = index.replace(from, to);
  };
  replaceOnce(`src="${up}js/app.js"`, `src="${up}${dir}/js/app.js"`);
  replaceOnce(`href="${up}style.css"`, `href="${up}${dir}/style.css"`);
  replaceOnce(`src="${up}js/theme-boot.js"`, `src="${up}${dir}/js/theme-boot.js"`);
  if (up) replaceOnce(`href="${up}mobile.css"`, `href="${up}${dir}/mobile.css"`);

  const from = up ? `"${up}vendor/` : '"./vendor/';
  index = rewriteImportMap(index, from, `"${up || './'}${dir}/vendor/`, name);

  fs.writeFileSync(pagePath, index);
}

/**
 * The import map is an inline script, allowed by its hash in the CSP: rewrite its `from`
 * prefix to `to`, then replace the old hash with the new one. Shared with build-mobile.mjs.
 */
export function rewriteImportMap(html, from, to, name) {
  const mapRe = /(<script type="importmap">)([\s\S]*?)(<\/script>)/;
  const m = mapRe.exec(html);
  if (!m) throw new Error(`${name} has no import map`);
  const hash = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;
  const oldHash = hash(m[2]);
  if (!html.includes(oldHash)) throw new Error(`the CSP does not list the import map's hash; update it in ${name} first`);
  const newMap = m[2].replaceAll(from, to);
  if (newMap === m[2]) throw new Error(`the import map in ${name} has no ${from} entries`);
  // function replacements: a "$" in the map or hash must not be read as a pattern
  return html.replace(mapRe, (_, open, _map, close) => open + newMap + close).replace(oldHash, () => hash(newMap));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const version = process.argv[2] || process.env.PTAH_PAGES_VERSION || process.env.GITHUB_SHA;
  preparePagesSite({ repoRoot, version });
}
