// e2e.browser.mjs — drives the web build in headless Chromium via Playwright.
//
//   node test/e2e.browser.mjs               # run, screenshot to test/.out/browser.png
//   node test/e2e.browser.mjs --screenshot docs/screenshot.png
//
// Needs the `playwright` package and a Chromium it can find (npx playwright
// install chromium). Exits 0 on pass, 1 on any failed step or console error.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import { scenario } from './scenario.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argIdx = process.argv.indexOf('--screenshot');
const shot = argIdx >= 0 ? path.resolve(process.argv[argIdx + 1]) : path.join(here, '.out', 'browser.png');
fs.mkdirSync(path.dirname(shot), { recursive: true });

const { server, url } = await startServer(0);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', (msg) => {
  const type = msg.type();
  console.log(`[renderer:${type}] ${msg.text()}`);
  if (type === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

// Headless Chromium has no picker UI, so exercise the download fallback of the
// web platform layer by hiding the File System Access API.
await page.addInitScript(() => {
  delete window.showSaveFilePicker;
  delete window.showOpenFilePicker;
});

let result = { steps: [], ok: false };
try {
  await page.goto(url + 'index.html', { waitUntil: 'load' });
  await page.waitForSelector('#viewport canvas', { timeout: 15000 });
  await page.waitForTimeout(600); // let the first frames render
  result = await page.evaluate(scenario);

  // Web-only: Ctrl+S must hand the browser a .usda download.
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.keyboard.press('Control+s')
    ]);
    const name = download.suggestedFilename();
    const text = fs.readFileSync(await download.path(), 'utf8');
    if (!name.endsWith('.usda')) throw new Error('bad filename ' + name);
    if (!text.startsWith('#usda')) throw new Error('bad content');
    const label = await page.textContent('#file-label');
    if (/•/.test(label)) throw new Error('still dirty after save: ' + label);
    result.steps.push('ok: web save downloads ' + name + ' (' + text.length + ' bytes)');
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: web save download — ' + e.message);
  }
} catch (e) {
  errors.push('script threw: ' + e.message);
}

for (const s of result.steps || []) console.log('  ' + s);
for (const k of Object.keys(result)) {
  if (k !== 'steps' && k !== 'ok') console.log(`  ${k}: ${result[k]}`);
}

await page.waitForTimeout(300);
try {
  await page.screenshot({ path: shot });
  console.log('screenshot: ' + path.relative(process.cwd(), shot));
} catch (e) { console.log('screenshot failed: ' + e.message); }

await browser.close();
server.close();

const failed = errors.length > 0 || !result.ok;
console.log(failed ? 'BROWSER E2E FAIL' : 'BROWSER E2E PASS');
if (errors.length) console.log('errors:\n' + errors.join('\n'));
process.exit(failed ? 1 : 0);
