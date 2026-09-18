// screenshots.mjs — regenerate the README images from the web build.
//   node test/screenshots.mjs          # writes docs/editor.png and docs/walk.png
// Needs playwright + Chromium like the browser E2E.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.join(here, '..', 'docs');
fs.mkdirSync(docs, { recursive: true });

const { server, url } = await startServer(0);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error('pageerror', e.message); process.exitCode = 1; });
await page.goto(url + 'index.html');
await page.waitForSelector('#viewport canvas');
await page.waitForTimeout(500);

const sample = fs.readFileSync(path.join(here, 'sample.usda'), 'utf8');
const corridor = fs.readFileSync(path.join(here, 'fixtures', 'corridor.usda'), 'utf8');

// 1. Editor overview: the sample level, tower group selected, note visible.
await page.evaluate((usda) => {
  const P = window.__ptah;
  const key = (code, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace('Key', ''), ...opts, bubbles: true }));
  P.loadUsdaText(usda, 'sample.usda');
  P.reference.clear({ record: false });          // the 2x2 checker is not a useful visual
  key('KeyH');
  const tower = P.ids().find(o => o.name === 'Tower');
  P.select([tower.id]);
  key('KeyF');
  document.getElementById('toast').classList.remove('show');
}, sample);
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(docs, 'editor.png') });

// 2. Walk mode: standing at the foot of the corridor stairs.
await page.evaluate((usda) => {
  const P = window.__ptah;
  const key = (code, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace('Key', ''), ...opts, bubbles: true }));
  P.loadUsdaText(usda, 'corridor.usda');
  key('KeyH');
  // Headless Chromium's pointer-lock grant is asynchronous and can stall the
  // screenshot; the picture does not need a real lock.
  document.querySelector('#viewport canvas').requestPointerLock = () => Promise.resolve();
  P.lookAt(0, 0, 40);          // stand at the foot of the stairs
  key('Numpad1');              // face -Z
  key('Tab');
  P.walk._look(0, -60);
  document.getElementById('toast').classList.remove('show');
}, corridor);
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(docs, 'walk.png') });

await browser.close();
server.close();
console.log('wrote docs/editor.png and docs/walk.png');
