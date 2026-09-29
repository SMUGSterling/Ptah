// build-mobile.mjs — generates renderer/mobile/index.html from renderer/index.html.
//
//   node tools/build-mobile.mjs          (npm run mobile)
//
// The mobile page is the same editor with a touch layout: the same markup, so
// every element app.js looks up exists, with <html class="mobile">, paths one
// folder up, and mobile.css after style.css. app.js sees the class and loads
// js/mobile.js. The import map moves with the paths, so its CSP hash is
// recomputed. test/mobile.test.mjs fails when the checked-in page is stale:
// edit renderer/index.html, then run this.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function buildMobilePage(index) {
  let html = index.replace(/\r\n?/g, '\n');
  const once = (from, to) => {
    if (!html.includes(from)) throw new Error(`renderer/index.html is missing ${from}`);
    html = html.replace(from, to);
  };
  once('<html lang="en">', '<html lang="en" class="mobile">');
  // viewport-fit=cover lets the bars sit under a notch's safe areas (mobile.css pads for them).
  // Zoom stays allowed: text must scale to 200% (WCAG 1.4.4); the canvas takes its own gestures.
  once('<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />');
  once('<title>Ptah</title>', '<title>Ptah (mobile)</title>');
  // its own manifest (buildMobileManifest), so installing this page starts this page
  once('href="manifest.webmanifest"', 'href="manifest.webmanifest"');
  once('<link rel="stylesheet" href="style.css" />', '<link rel="stylesheet" href="../style.css" />\n  <link rel="stylesheet" href="../mobile.css" />');
  once('src="js/theme-boot.js"', 'src="../js/theme-boot.js"');
  once('src="js/app.js"', 'src="../js/app.js"');
  const mapRe = /(<script type="importmap">)([\s\S]*?)(<\/script>)/;
  const m = mapRe.exec(html);
  if (!m) throw new Error('renderer/index.html has no import map');
  const hash = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;
  const oldHash = hash(m[2]);
  if (!html.includes(oldHash)) throw new Error("the CSP does not list the import map's hash; update it in renderer/index.html first");
  const newMap = m[2].replaceAll('"./vendor/', '"../vendor/');
  if (newMap === m[2]) throw new Error('the import map has no ./vendor/ entries');
  html = html.replace(mapRe, `$1${newMap}$3`).replace(oldHash, hash(newMap));
  once('<head>\n', '<head>\n  <!-- Generated from renderer/index.html by tools/build-mobile.mjs (npm run mobile). Do not edit. -->\n');
  return html;
}

/** The mobile page's manifest: the site's, starting at the mobile page. */
export function buildMobileManifest(manifestText) {
  const m = JSON.parse(manifestText);
  return JSON.stringify({ ...m, name: m.name + ' (mobile)', start_url: './index.html', id: './index.html' }, null, 2) + '\n';
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const renderer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
  const out = path.join(renderer, 'mobile', 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buildMobilePage(fs.readFileSync(path.join(renderer, 'index.html'), 'utf8')));
  const manifest = path.join(renderer, 'mobile', 'manifest.webmanifest');
  fs.writeFileSync(manifest, buildMobileManifest(fs.readFileSync(path.join(renderer, 'manifest.webmanifest'), 'utf8')));
  console.log('wrote ' + path.relative(process.cwd(), out) + ' and ' + path.relative(process.cwd(), manifest));
}
