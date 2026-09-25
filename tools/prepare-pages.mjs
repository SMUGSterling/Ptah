// prepare-pages.mjs — package renderer/ for GitHub Pages deployment.
//
// Publishes the web build with a versioned JS directory so a fresh index.html
// cannot load stale nested ES modules from the previous deploy.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function preparePagesSite({ repoRoot, version }) {
  if (!repoRoot) throw new Error('repoRoot is required');
  if (!version) throw new Error('version is required');

  const rendererRoot = path.join(repoRoot, 'renderer');
  const jsDir = path.join(rendererRoot, 'js');
  const versionedJsDir = path.join(rendererRoot, `js-${version}`);
  const indexPath = path.join(rendererRoot, 'index.html');

  fs.rmSync(path.join(rendererRoot, 'package.json'), { force: true });
  fs.rmSync(path.join(rendererRoot, 'assets', 'mannequin.glb'), { force: true });
  fs.copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(rendererRoot, 'LICENSE.txt'));

  fs.rmSync(versionedJsDir, { recursive: true, force: true });
  fs.renameSync(jsDir, versionedJsDir);

  const index = fs.readFileSync(indexPath, 'utf8');
  const next = index.replace('src="js/app.js"', `src="js-${version}/app.js"`);
  if (next === index) throw new Error('renderer/index.html is missing the expected js/app.js entrypoint');
  fs.writeFileSync(indexPath, next);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const version = process.argv[2] || process.env.PTAH_PAGES_VERSION || process.env.GITHUB_SHA;
  preparePagesSite({ repoRoot, version });
}
