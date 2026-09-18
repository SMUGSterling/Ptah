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

  // Web-only: autosave snapshot survives a reload and is offered back.
  try {
    const before = await page.evaluate(async () => {
      const P = window.__ptah;
      const canvas = document.querySelector('#viewport canvas');
      const r = canvas.getBoundingClientRect();
      const pt = (type) => canvas.dispatchEvent(new PointerEvent(type, { clientX: r.left + r.width * 0.7, clientY: r.top + r.height * 0.7, button: 0, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true }));
      pt('pointerdown'); pt('pointerup');
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
      if (!P.state.dirty) throw new Error('scene not dirty after placing a cube');
      if (!P.autosave.pending) throw new Error('autosave not scheduled by the edit');
      const flushed = await P.autosave.flush();
      if (!flushed) throw new Error('autosave flush failed: ' + (P.autosave.lastError && P.autosave.lastError.message));
      return { count: P.ids().length, text: P.exportText() };
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#viewport canvas', { timeout: 15000 });
    await page.waitForSelector('#recover-bar:not(.hidden)', { timeout: 5000 });
    if (await page.evaluate(() => window.__ptah.pickerOpen())) throw new Error('picker must wait while recovery is offered');
    const banner = await page.textContent('#recover-text');
    if (!/Unsaved work from/.test(banner)) throw new Error('unexpected banner: ' + banner);
    await page.click('#recover-restore');
    const after = await page.evaluate(() => ({ count: window.__ptah.ids().length, dirty: window.__ptah.state.dirty, text: window.__ptah.exportText() }));
    if (after.count !== before.count) throw new Error(`restored ${after.count} objects, expected ${before.count}`);
    if (!after.dirty) throw new Error('recovered work should be marked unsaved');
    if (after.text !== before.text) throw new Error('recovered export differs from the snapshot');
    // dismiss path clears the snapshot so the next launch is clean
    await page.evaluate(() => window.__ptah.autosave.clear());
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#viewport canvas', { timeout: 15000 });
    await page.waitForTimeout(500);
    const shown = await page.evaluate(() => !document.getElementById('recover-bar').classList.contains('hidden'));
    if (shown) throw new Error('recovery offered after the snapshot was cleared');
    const picker = await page.evaluate(() => window.__ptah.pickerOpen());
    if (!picker) throw new Error('profile picker should be up on a clean launch');
    result.steps.push(`ok: autosave snapshot recovered after reload (${before.count} objects), cleared snapshot not offered, picker up on a clean launch`);
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: autosave recovery — ' + e.message);
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
