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
import { placeCubes } from './page-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argIdx = process.argv.indexOf('--screenshot');
const shot = argIdx >= 0 ? path.resolve(process.argv[argIdx + 1]) : path.join(here, '.out', 'browser.png');
fs.mkdirSync(path.dirname(shot), { recursive: true });

const { server, url } = await startServer(0);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });   // one origin: tabs share IndexedDB
const page = await context.newPage();

const errors = [];
page.on('console', (msg) => {
  const type = msg.type();
  console.log(`[renderer:${type}] ${msg.text()}`);
  if (type === 'error' || (type === 'warning' && /WebGL/.test(msg.text()))) errors.push(msg.text());
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

  // The topbar wraps instead of clipping on narrow windows (Electron's minimum is 1024 wide).
  try {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(100);
    const bar = await page.evaluate(() => { const t = document.getElementById('topbar'); return { scroll: t.scrollWidth, client: t.clientWidth }; });
    if (bar.scroll > bar.client) throw new Error(`topbar overflows at 1024 px (${bar.scroll} > ${bar.client})`);
    result.steps.push(`ok: topbar fits at 1024 px (${bar.scroll} <= ${bar.client})`);
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: narrow topbar — ' + e.message);
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // Idle throttle: full rate while active, a few frames a second when idle.
  try {
    await page.waitForTimeout(2000);
    const idle = await page.evaluate(async () => { const a = window.__ptah.frames(); await new Promise(r => setTimeout(r, 1000)); return window.__ptah.frames() - a; });
    const active = await page.evaluate(async () => {
      const c = document.querySelector('#viewport canvas');
      const a = window.__ptah.frames();
      for (let i = 0; i < 10; i++) { c.dispatchEvent(new PointerEvent('pointermove', { clientX: 300 + i, clientY: 300, bubbles: true })); await new Promise(r => setTimeout(r, 50)); }
      return window.__ptah.frames() - a;
    });
    if (idle > 8) throw new Error(`${idle} frames rendered in 1 s of idle`);
    // At the idle rate 0.5 s would give about idle/2 frames.
    if (active < idle + 3) throw new Error(`input did not raise the frame rate (idle ${idle}, active ${active} in 0.5 s)`);
    result.steps.push(`ok: idle throttle (${idle} frames/s idle, ${active} frames in 0.5 s of pointer movement)`);
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: idle throttle — ' + e.message);
  }

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
    await page.evaluate(placeCubes, [[0.7, 0.7]]);
    const before = await page.evaluate(async () => {
      const P = window.__ptah;
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

  // Web-only: snapshots are per tab; a live tab's work is never offered to
  // another tab, a closed tab's is; opening a file discards the old snapshot.
  try {
    const ctx = page.context();
    const boot = async (p) => {
      await p.waitForSelector('#viewport canvas', { timeout: 15000 });
      await p.waitForFunction(() => window.__ptah && (window.__ptah.pickerOpen() || !document.getElementById('recover-bar').classList.contains('hidden')), null, { timeout: 5000 });
    };
    const placeAndFlush = async (p, n) => {
      await p.evaluate(() => { if (window.__ptah.pickerOpen()) window.__ptah.pickProfile('ue-third'); });
      const count = await p.evaluate(placeCubes, Array.from({ length: n }, (_, i) => [0.3 + 0.1 * i, 0.7]));
      if (!(await p.evaluate(() => window.__ptah.autosave.flush()))) throw new Error('flush failed');
      return count;
    };
    const offered = async (p) => {
      await boot(p);
      await p.waitForTimeout(400);                      // roll call
      if (await p.evaluate(() => document.getElementById('recover-bar').classList.contains('hidden'))) return null;
      await p.click('#recover-restore');
      return p.evaluate(() => window.__ptah.ids().length);
    };

    // page A: one cube; page B: two cubes
    await page.reload({ waitUntil: 'load' }); await boot(page);
    const a = await placeAndFlush(page, 1);
    const pageB = await ctx.newPage();
    pageB.on('pageerror', (err) => errors.push('pageerror (tab B): ' + err.message));
    await pageB.goto(url + 'index.html', { waitUntil: 'load' });
    if ((await offered(pageB)) !== null) throw new Error('tab B was offered live tab A\'s snapshot');
    const b = await placeAndFlush(pageB, 2);
    if (a === b) throw new Error('test setup: both tabs have the same object count');

    // reloading A offers A's own work, not B's newer snapshot
    await page.reload({ waitUntil: 'load' });
    const gotA = await offered(page);
    if (gotA !== a) throw new Error(`tab A recovered ${gotA} objects, expected its own ${a}`);

    // "Duplicate tab" copies sessionStorage: the copy must take a new identity, not A's snapshot
    const aKey = await page.evaluate(() => window.__ptah.autosave.key);
    const aSession = await page.evaluate(() => sessionStorage.getItem('ptah.session'));
    const pageD = await ctx.newPage();
    pageD.on('pageerror', (err) => errors.push('pageerror (tab D): ' + err.message));
    await pageD.addInitScript((id) => { try { if (!sessionStorage.getItem('ptah.dup-seeded')) { sessionStorage.setItem('ptah.session', id); sessionStorage.setItem('ptah.dup-seeded', '1'); } } catch { /* ignore */ } }, aSession);
    await pageD.goto(url + 'index.html', { waitUntil: 'load' });
    if ((await offered(pageD)) !== null) throw new Error('a duplicated tab was offered the live original\'s snapshot');
    const dKey = await pageD.evaluate(() => window.__ptah.autosave.key);
    if (dKey === aKey) throw new Error('duplicated tab kept the original tab\'s autosave key');
    await pageD.evaluate(() => window.__ptah.autosave.clear());
    await pageD.close();

    // closing B orphans its snapshot; a new tab C is offered it
    await pageB.close();
    const pageC = await ctx.newPage();
    pageC.on('pageerror', (err) => errors.push('pageerror (tab C): ' + err.message));
    await pageC.goto(url + 'index.html', { waitUntil: 'load' });
    const gotC = await offered(pageC);
    if (gotC !== b) throw new Error(`new tab recovered ${gotC} objects, expected closed tab B's ${b}`);

    // opening (dropping) a file on C discards C's snapshot: nothing offered after a reload
    await pageC.evaluate(async () => { await window.__ptah.autosave.flush(); });
    pageC.once('dialog', (d) => d.accept());
    await pageC.evaluate((text) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], 'other.usda', { type: 'text/plain' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, '#usda 1.0\ndef Cube "Lonely"\n{\n    double size = 100\n}\n');
    await pageC.waitForFunction(() => window.__ptah.ids().length === 1, null, { timeout: 5000 });
    await pageC.waitForTimeout(200);
    await pageC.reload({ waitUntil: 'load' });
    if ((await offered(pageC)) !== null) throw new Error('snapshot of the discarded scene offered after Open');
    await pageC.close();
    await page.evaluate(() => window.__ptah.autosave.clear());
    result.steps.push(`ok: autosave is per tab (A ${a}, B ${b} objects): own snapshot on reload, closed tab's offered to a new tab, Open discards`);
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: per-tab autosave — ' + e.message);
  }

  // Web-only: the File System Access path (Chrome, Edge), with stand-in pickers
  // and files whose writes and reads the test can hold open. The main page hides
  // this API to exercise the download fallback, so it runs in its own tab.
  try {
    const pageF = await page.context().newPage();
    pageF.on('pageerror', (err) => errors.push('pageerror (FS Access tab): ' + err.message));
    await pageF.addInitScript(() => {
      // files are keyed by `key`, so two files in different folders can share a name
      const fsa = window.__fsa = { files: {}, writes: [], pickers: 0, next: null, nextKey: null, holdWrite: false, holdRead: false, held: [] };
      const hold = () => new Promise(r => fsa.held.push(r));
      const handle = (name, key = name) => ({
        kind: 'file', name,
        async createWritable() {
          let text = '';
          return { async write(c) { text += c; }, async close() { if (fsa.holdWrite) await hold(); fsa.files[key] = text; fsa.writes.push(key); } };
        },
        async getFile() {
          const text = fsa.files[key] || '';
          return { size: text.length, async text() { if (fsa.holdRead) await hold(); return text; } };
        }
      });
      const picked = () => { const h = handle(fsa.next, fsa.nextKey || fsa.next); fsa.nextKey = null; return h; };
      window.showSaveFilePicker = async () => { fsa.pickers++; return picked(); };
      window.showOpenFilePicker = async () => { fsa.pickers++; return [picked()]; };
      window.confirm = () => true;
      // the download fallback clicks a link with a download name: count those instead of downloading
      fsa.downloads = 0;
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { fsa.downloads++; return; } return click.call(this); };
    });
    await pageF.goto(url + 'index.html', { waitUntil: 'load' });
    await pageF.waitForSelector('#viewport canvas', { timeout: 15000 });
    const r = await pageF.evaluate(async () => {
      const P = window.__ptah, fsa = window.__fsa;
      const sleep = (ms) => new Promise(res => setTimeout(res, ms));
      const until = async (cond, what) => { for (const end = Date.now() + 3000; !cond(); await sleep(10)) if (Date.now() > end) throw new Error('timed out waiting for ' + what); };
      const assert = (c, m) => { if (!c) throw new Error(m); };
      const release = () => fsa.held.shift()();
      const edit = () => { P.createPreset('halfcover', 0, 0); assert(P.state.dirty, 'the test edit did not dirty the level'); };
      if (!document.getElementById('recover-bar').classList.contains('hidden')) document.getElementById('recover-dismiss').click();
      if (P.pickerOpen()) P.pickProfile('ue-third');

      // a Save As still writing when New starts: the new level must not inherit its file
      edit();
      fsa.next = 'a.usda'; fsa.holdWrite = true;
      let saving = P.saveFile(true);
      await until(() => fsa.held.length === 1, 'the held write');
      await P.newScene();
      if (P.pickerOpen()) P.pickProfile('ue-third');
      fsa.holdWrite = false; release(); await saving;
      assert(fsa.files['a.usda'] && P.state.filePath === null, 'after New: ' + P.state.filePath);
      assert(fsa.downloads === 0, 'the save held across New fell back to a download as well');
      edit();
      fsa.next = 'b.usda';
      const pickers = fsa.pickers;
      await P.saveFile(false);
      assert(fsa.pickers === pickers + 1 && fsa.writes.at(-1) === 'b.usda' && P.state.filePath === 'b.usda',
        `the new level's first Save wrote to ${fsa.writes.at(-1)} (${fsa.pickers - pickers} dialogs): the old save's file was kept`);

      // Save pressed while an opened file is still being read: the level still open saves to its own file
      fsa.files['o.usda'] = P.exportText();
      edit();
      fsa.next = 'o.usda'; fsa.holdRead = true;
      const opening = P.openFile();
      await until(() => fsa.held.length === 1, 'the held read');
      const before = fsa.pickers;
      await P.saveFile(false);
      assert(fsa.pickers === before && fsa.writes.at(-1) === 'b.usda',
        `a Save during Open went to ${fsa.writes.at(-1)} (${fsa.pickers - before} dialogs) instead of the open level's b.usda`);
      fsa.holdRead = false; release(); await opening;
      assert(P.state.filePath === 'o.usda', 'open did not finish: ' + P.state.filePath);
      edit();
      await P.saveFile(false);
      assert(fsa.pickers === before && fsa.writes.at(-1) === 'o.usda', 'Save after Open did not write the opened file in place');

      // opening another file with the same name that fails to import: the level on screen keeps saving to its own file
      fsa.files['elsewhere/o.usda'] = fsa.files['o.usda'];
      const other = fsa.files['elsewhere/o.usda'];
      fsa.next = 'o.usda'; fsa.nextKey = 'elsewhere/o.usda';
      edit();
      P.failImportedObjectName('HalfCover_01');
      try { await P.openFile(); } finally { P.failImportedObjectName(null); }
      assert(P.state.filePath === 'o.usda' && P.state.dirty, 'the failed import changed the level on screen: ' + P.state.filePath);
      await P.saveFile(false);
      assert(fsa.files['elsewhere/o.usda'] === other && fsa.writes.at(-1) === 'o.usda',
        'after a failed Open, Save wrote to ' + fsa.writes.at(-1) + ' instead of the level\'s own o.usda');
      assert(fsa.downloads === 0, fsa.downloads + ' unexpected download(s)');
      P.autosave.clear();
      return fsa.writes.join(' ');
    });
    await pageF.close();
    result.steps.push('ok: File System Access saves: New and Open during a save or read keep each level on its own file (' + r + ')');
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: File System Access saves — ' + e.message);
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
