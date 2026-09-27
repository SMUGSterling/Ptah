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

// Stand-in File System Access pickers and files whose writes and reads a test
// can hold open, deny or fail (Chromium without picker UI).
const fsaStubs = () => {
  // files are keyed by `key`, so two files in different folders can share a name
  const fsa = window.__fsa = { files: {}, writes: [], pickers: 0, next: null, nextKey: null, holdWrite: false, holdRead: false, held: [] };
  const hold = () => new Promise(r => fsa.held.push(r));
  const handle = (name, key = name) => ({
    kind: 'file', name,
    async createWritable() {
      if (fsa.denyWrite) throw new DOMException('Write permission denied', 'NotAllowedError');
      let text = '';
      return { async write(c) { text += c; }, async close() { if (fsa.holdWrite) await hold(); fsa.files[key] = text; fsa.writes.push(key); } };
    },
    async getFile() {
      if (fsa.denyRead) throw new DOMException('Read permission denied', 'NotAllowedError');
      const text = fsa.files[key] || '';
      return { size: text.length, async text() { if (fsa.holdRead) await hold(); return text; } };
    }
  });
  const picked = () => { const h = handle(fsa.next, fsa.nextKey || fsa.next); fsa.nextKey = null; return h; };
  window.showSaveFilePicker = async () => { fsa.pickers++; if (fsa.pickerError) throw new DOMException('Picker failed', fsa.pickerError); return picked(); };
  window.showOpenFilePicker = async () => { fsa.pickers++; return [picked()]; };
  window.confirm = () => true;
  // the download fallback clicks a link with a download name: count those instead of downloading
  fsa.downloads = 0;
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) { fsa.downloads++; fsa.lastDownload = this.download; return; } return click.call(this); };
};

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
    // the walk-mode hint stays inside the viewport (it used to run under the Inspector)
    for (const w of [1024, 1440]) {
      await page.setViewportSize({ width: w, height: w === 1024 ? 768 : 900 });
      await page.waitForTimeout(50);
      const fit = await page.evaluate(() => {
        const hud = document.getElementById('walk-hud'), wasHidden = hud.classList.contains('hidden');
        hud.classList.remove('hidden');
        const vp = document.getElementById('viewport').getBoundingClientRect(), h = hud.querySelector('.walk-hint').getBoundingClientRect();
        if (wasHidden) hud.classList.add('hidden');
        return { left: h.left - vp.left, right: vp.right - h.right };
      });
      if (fit.left < 0 || fit.right < 0) throw new Error(`walk hint overflows the viewport at ${w} px: ${JSON.stringify(fit)}`);
    }
    result.steps.push('ok: the walk-mode hint stays inside the viewport at 1024 and 1440 px');
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

  // Web-only: work started behind the recovery bar survives Dismiss, and a Save the
  // browser only downloaded keeps a labelled recovery copy until downloads are confirmed.
  try {
    const boot = async () => {
      await page.waitForSelector('#viewport canvas', { timeout: 15000 });
      await page.waitForFunction(() => window.__ptah && (window.__ptah.pickerOpen() || !document.getElementById('recover-bar').classList.contains('hidden')), null, { timeout: 5000 });
      await page.waitForTimeout(400);                   // roll call
    };
    const barUp = () => page.evaluate(() => !document.getElementById('recover-bar').classList.contains('hidden'));
    await page.evaluate(() => { try { localStorage.removeItem('ptah.downloadsConfirmed'); } catch { /* ignore */ } });
    await page.reload({ waitUntil: 'load' }); await boot();
    await page.evaluate(() => { if (window.__ptah.pickerOpen()) window.__ptah.pickProfile('ue-third'); });
    await page.evaluate(placeCubes, [[0.4, 0.7]]);
    if (!(await page.evaluate(() => window.__ptah.autosave.flush()))) throw new Error('flush failed');
    await page.reload({ waitUntil: 'load' }); await boot();
    if (!(await barUp())) throw new Error('setup: the one-cube snapshot was not offered');
    const behind = await page.evaluate(placeCubes, [[0.3, 0.7], [0.5, 0.7]]);
    if (!(await page.evaluate(() => window.__ptah.autosave.flush()))) throw new Error('flush behind the bar failed');
    await page.click('#recover-dismiss');
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: 'load' }); await boot();
    if (!(await barUp())) throw new Error('Dismiss deleted the work done behind the recovery bar');
    await page.click('#recover-restore');
    const got = await page.evaluate(() => window.__ptah.ids().length);
    if (got !== behind) throw new Error(`recovered ${got} objects after Dismiss, expected the ${behind} placed behind the bar`);

    // a download save: clean, but the copy is kept and labelled
    await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.keyboard.press('Control+s')]);
    if (await page.evaluate(() => window.__ptah.state.dirty)) throw new Error('still dirty after the download save');
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: 'load' }); await boot();
    if (!(await barUp())) throw new Error('a Save that was only downloaded left no recovery copy');
    const text = await page.textContent('#recover-text');
    if (!/downloaded/.test(text)) throw new Error('the kept copy is not labelled as a download: ' + text);
    await page.click('#recover-dismiss');              // "it arrived": later download saves clear the copy
    await page.evaluate(() => { if (window.__ptah.pickerOpen()) window.__ptah.pickProfile('ue-third'); });
    await page.evaluate(placeCubes, [[0.6, 0.7]]);
    await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.keyboard.press('Control+s')]);
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: 'load' }); await boot();
    if (await barUp()) throw new Error('a download save after downloads were confirmed still kept a copy');
    await page.evaluate(() => { localStorage.removeItem('ptah.downloadsConfirmed'); return window.__ptah.autosave.clear(); });
    result.steps.push(`ok: work placed behind the recovery bar (${behind} objects) survives Dismiss; a download save keeps a labelled copy until Dismiss confirms downloads arrive`);
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: recovery bar and download copies — ' + e.message);
  }

  // Web-only: storage that cannot be opened is said once, not silently ignored.
  try {
    const pageN = await page.context().newPage();
    pageN.on('pageerror', (err) => errors.push('pageerror (no-storage tab): ' + err.message));
    await pageN.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
      window.__toasts = [];
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById('toast');
        new MutationObserver(() => window.__toasts.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
      });
    });
    await pageN.goto(url + 'index.html', { waitUntil: 'load' });
    await pageN.waitForSelector('#viewport canvas', { timeout: 15000 });
    await pageN.waitForFunction(() => window.__ptah && window.__ptah.pickerOpen(), null, { timeout: 5000 });
    await pageN.evaluate(() => window.__ptah.pickProfile('ue-third'));
    await pageN.evaluate(placeCubes, [[0.5, 0.7]]);
    await pageN.evaluate(() => window.__ptah.autosave.flush());
    const said = await pageN.evaluate(() => window.__toasts.filter(t => /Autosave is unavailable/.test(t)).length);
    await pageN.close();
    if (said !== 1) throw new Error(`the autosave-unavailable notice was shown ${said} times, expected once`);
    result.steps.push('ok: with no usable storage, the autosave-unavailable notice is shown once');
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: autosave unavailable notice — ' + e.message);
  }

  // Web-only: the File System Access path (Chrome, Edge), with stand-in pickers
  // and files whose writes and reads the test can hold open. The main page hides
  // this API to exercise the download fallback, so it runs in its own tab.
  try {
    const pageF = await page.context().newPage();
    pageF.on('pageerror', (err) => errors.push('pageerror (FS Access tab): ' + err.message));
    await pageF.addInitScript(fsaStubs);
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

      // the browser refuses write permission: Save must not silently do nothing
      const toast = () => document.getElementById('toast').textContent;
      edit();
      const writes0 = fsa.writes.length;
      fsa.denyWrite = true;
      try { await P.saveFile(false); } finally { fsa.denyWrite = false; }
      assert(fsa.writes.length === writes0 && fsa.downloads === 1 && /Downloaded/.test(toast()),
        `a refused write was not reported: ${fsa.downloads} download(s), toast "${toast()}"`);
      // Save As to a new name whose write is refused downloads under the name that was picked
      fsa.next = 'renamed.usda'; fsa.denyWrite = true;
      try { await P.saveFile(true); } finally { fsa.denyWrite = false; }
      assert(fsa.downloads === 2 && fsa.lastDownload === 'renamed.usda', 'refused Save As downloaded as ' + fsa.lastDownload);
      // a picker that fails for another reason (not a cancel) also downloads, and says so
      edit();
      fsa.pickerError = 'SecurityError';
      try { await P.saveFile(true); } finally { fsa.pickerError = null; }
      assert(fsa.downloads === 3 && /Downloaded/.test(toast()), `a failed picker was not reported: ${fsa.downloads} download(s), toast "${toast()}"`);
      // closing the picker is still a quiet cancel
      edit();
      const d3 = fsa.downloads;
      fsa.pickerError = 'AbortError';
      try { await P.saveFile(true); } finally { fsa.pickerError = null; }
      assert(fsa.downloads === d3 && P.state.dirty, 'closing the Save As picker should change nothing');
      // a refused Save As to a same-named file in another folder must not leave the old file's
      // handle behind: the next Save would otherwise write into A/level.usda
      fsa.files['A/level.usda'] = P.exportText();
      fsa.next = 'level.usda'; fsa.nextKey = 'A/level.usda';
      await P.openFile();
      assert(P.state.filePath === 'level.usda', 'setup: A/level.usda did not open');
      const aBefore = fsa.files['A/level.usda'];
      edit();
      fsa.next = 'level.usda'; fsa.nextKey = 'B/level.usda'; fsa.denyWrite = true;
      try { await P.saveFile(true); } finally { fsa.denyWrite = false; }
      assert(!fsa.files['B/level.usda'] && fsa.lastDownload === 'level.usda', 'setup: the refused Save As should download');
      edit();
      const pick0 = fsa.pickers;
      fsa.next = 'level.usda'; fsa.nextKey = 'C/level.usda';
      await P.saveFile(false);
      assert(fsa.files['A/level.usda'] === aBefore && fsa.pickers === pick0 + 1 && fsa.writes.at(-1) === 'C/level.usda',
        `after a refused Save As, Save wrote to ${fsa.writes.at(-1)} with ${fsa.pickers - pick0} dialog(s); A/level.usda ${fsa.files['A/level.usda'] === aBefore ? 'untouched' : 'OVERWRITTEN'}`);
      // the same when the Save As picker itself fails (not a cancel): the next Save must not write into A
      fsa.next = 'level.usda'; fsa.nextKey = 'A/level.usda';
      await P.openFile();
      const aAgain = fsa.files['A/level.usda'];
      edit();
      fsa.pickerError = 'SecurityError';
      try { await P.saveFile(true); } finally { fsa.pickerError = null; }
      edit();
      const pick1 = fsa.pickers;
      fsa.next = 'level.usda'; fsa.nextKey = 'D/level.usda';
      await P.saveFile(false);
      assert(fsa.files['A/level.usda'] === aAgain && fsa.pickers === pick1 + 1 && fsa.writes.at(-1) === 'D/level.usda',
        `after a failed Save As picker, Save wrote to ${fsa.writes.at(-1)} with ${fsa.pickers - pick1} dialog(s)`);

      // ... and read permission on Open: an error, and the level on screen stays
      const onScreen = P.state.filePath;
      fsa.next = 'o.usda'; fsa.denyRead = true;
      try { await P.openFile(); } finally { fsa.denyRead = false; }
      assert(P.state.filePath === onScreen && /did not allow/.test(toast()), `a refused read was not reported: toast "${toast()}"`);
      P.autosave.clear();
      return fsa.writes.join(' ');
    });
    await pageF.close();
    result.steps.push('ok: File System Access saves: New and Open during a save or read keep each level on its own file (' + r + ')');
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: File System Access saves — ' + e.message);
  }

  // Web-only: restoring a snapshot must not write into a same-named file opened behind the bar.
  try {
    const pageR = await page.context().newPage();
    pageR.on('pageerror', (err) => errors.push('pageerror (restore tab): ' + err.message));
    await pageR.addInitScript(fsaStubs);
    const bootR = async () => {
      await pageR.waitForSelector('#viewport canvas', { timeout: 15000 });
      await pageR.waitForFunction(() => window.__ptah && (window.__ptah.pickerOpen() || !document.getElementById('recover-bar').classList.contains('hidden')), null, { timeout: 5000 });
      await pageR.waitForTimeout(400);
    };
    await pageR.goto(url + 'index.html', { waitUntil: 'load' }); await bootR();
    await pageR.evaluate(async () => {
      const P = window.__ptah, fsa = window.__fsa;
      if (!document.getElementById('recover-bar').classList.contains('hidden')) document.getElementById('recover-dismiss').click();
      if (P.pickerOpen()) P.pickProfile('ue-third');
      fsa.files['mine/level.usda'] = P.exportText();
      fsa.next = 'level.usda'; fsa.nextKey = 'mine/level.usda';
      await P.openFile();
      P.createPreset('halfcover', 0, 0);
      if (!(await P.autosave.flush())) throw new Error('flush failed');
    });
    await pageR.reload({ waitUntil: 'load' }); await bootR();
    const r = await pageR.evaluate(async () => {
      const P = window.__ptah, fsa = window.__fsa;
      if (document.getElementById('recover-bar').classList.contains('hidden')) throw new Error('setup: the snapshot of level.usda was not offered');
      // behind the bar: another folder's level.usda
      fsa.files['theirs/level.usda'] = '#usda 1.0\ndef Cube "Theirs"\n{\n    double size = 100\n}\n';
      const theirs = fsa.files['theirs/level.usda'];
      fsa.next = 'level.usda'; fsa.nextKey = 'theirs/level.usda';
      await P.openFile();
      if (P.state.filePath !== 'level.usda') throw new Error('setup: theirs/level.usda did not open');
      document.getElementById('recover-restore').click();
      for (const end = Date.now() + 3000; !P.state.dirty; await new Promise(res => setTimeout(res, 20))) if (Date.now() > end) throw new Error('Restore did not finish');
      const pickers = fsa.pickers;
      fsa.next = 'level.usda'; fsa.nextKey = 'new/level.usda';
      await P.saveFile(false);
      if (fsa.files['theirs/level.usda'] !== theirs) throw new Error('Save after Restore overwrote the same-named file opened behind the bar');
      if (fsa.pickers !== pickers + 1 || !fsa.files['new/level.usda']) throw new Error(`Save after Restore did not ask where (${fsa.pickers - pickers} dialogs)`);
      await P.autosave.clear();
      return fsa.writes.join(' ');
    });
    await pageR.close();
    result.steps.push('ok: Save after Restore asks where instead of writing a same-named file opened behind the bar (' + r + ')');
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: Restore and a same-named file — ' + e.message);
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
