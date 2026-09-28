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
      return {
        async write(c) { if (fsa.failWrite) throw new DOMException('Disk full', 'QuotaExceededError'); text += c; },
        async close() { if (fsa.holdWrite) await hold(); fsa.files[key] = text; fsa.writes.push(key); },
        async abort() { fsa.aborts = (fsa.aborts || 0) + 1; }
      };
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
    // ... and gives up its claim on the original's session lock, holding one for its new session
    const locks = await pageD.evaluate(async () => { const q = await navigator.locks.query(); return { held: q.held.map(l => l.name), pending: q.pending.map(l => l.name) }; });
    const dSession = dKey.slice('session:'.length);
    if (locks.pending.includes('ptah-session:' + aSession) || !locks.held.includes('ptah-session:' + dSession) || !locks.held.includes('ptah-session:' + aSession))
      throw new Error('session locks after a duplicated tab rotates: ' + JSON.stringify({ aSession, dSession, ...locks }));
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
    // a Restore whose copy under the tab's key fails keeps the offered copy, and a later Save still clears it
    await page.evaluate(() => { if (window.__ptah.pickerOpen()) window.__ptah.pickProfile('ue-third'); });
    await page.evaluate(placeCubes, [[0.45, 0.7]]);
    if (!(await page.evaluate(() => window.__ptah.autosave.flush()))) throw new Error('flush failed');
    await page.reload({ waitUntil: 'load' }); await boot();
    if (!(await barUp())) throw new Error('setup: snapshot not offered');
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (key === window.__ptah.autosave.key) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return put.call(this, value, key);
      };
      window.__restorePut = () => { IDBObjectStore.prototype.put = put; };
    });
    await page.click('#recover-restore');
    await page.waitForFunction(() => window.__ptah.state.dirty, null, { timeout: 3000 });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__restorePut());
    await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.keyboard.press('Control+s')]);
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: 'load' }); await boot();
    if (await barUp()) throw new Error('work restored and then saved was offered again: its offered copy outlived the Save');
    await page.evaluate(() => { localStorage.removeItem('ptah.downloadsConfirmed'); return window.__ptah.autosave.clear(); });
    result.steps.push(`ok: work placed behind the recovery bar (${behind} objects) survives Dismiss; a download save keeps a labelled copy until Dismiss confirms downloads arrive; a restored copy is cleared by the next Save`);
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
      fsa.pickerError = 'UnknownError';
      try { await P.saveFile(true); } finally { fsa.pickerError = null; }
      assert(fsa.downloads === 3 && /Downloaded/.test(toast()), `a failed picker was not reported: ${fsa.downloads} download(s), toast "${toast()}"`);
      // ... but a picker the browser blocked (no recent click, or another dialog open) asks to try again:
      // no download, and the level keeps its file
      for (const blocked of ['SecurityError', 'NotAllowedError']) {
        edit();
        const path0 = P.state.filePath;
        fsa.pickerError = blocked;
        try { await P.saveFile(true); } finally { fsa.pickerError = null; }
        assert(fsa.downloads === 3 && /Click Save As again/.test(toast()) && P.state.filePath === path0 && P.state.dirty,
          `a blocked Save As picker (${blocked}): ${fsa.downloads} download(s), toast "${toast()}", file ${P.state.filePath}`);
      }
      // a write that fails partway is aborted (the browser's temporary file is removed), then downloads
      edit();
      fsa.next = 'partial.usda'; fsa.failWrite = true;
      try { await P.saveFile(true); } finally { fsa.failWrite = false; }
      assert(fsa.aborts === 1 && fsa.downloads === 4 && !fsa.files['partial.usda'], `a failed write: ${fsa.aborts || 0} abort(s), ${fsa.downloads} download(s)`);
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
      fsa.pickerError = 'UnknownError';
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
    result.steps.push('ok: File System Access saves: New and Open during a save or read keep each level on its own file; a blocked Save As asks again; a failed write is aborted (' + r + ')');
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

  // Fixes from the 0.9.7 review: a download is named what the editor says it is, a new or opened level
  // does not inherit the last one's reference placement, and recovery offers never cost work.
  try {
    const fails = [];
    const boot = async (pg) => {
      await pg.waitForSelector('#viewport canvas', { timeout: 15000 });
      await pg.waitForFunction(() => window.__ptah && (window.__ptah.pickerOpen() || !document.getElementById('recover-bar').classList.contains('hidden')), null, { timeout: 5000 });
      await pg.waitForTimeout(300);
    };
    const barShown = (pg) => pg.evaluate(() => !document.getElementById('recover-bar').classList.contains('hidden'));
    const sample = fs.readFileSync(path.join(here, 'sample.usda'), 'utf8');

    // 1. download names, and 2. reference placement across New and Open (no File System Access)
    const ctxN = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg = await ctxN.newPage();
    pg.on('pageerror', (err) => errors.push('pageerror (0.9.7 tab): ' + err.message));
    await pg.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; window.confirm = () => true; });
    await pg.goto(url + 'index.html', { waitUntil: 'load' }); await boot(pg);
    await pg.evaluate((t) => { const P = window.__ptah; if (P.pickerOpen()) P.pickProfile('ue-third'); P.loadUsdaText(t, 'level.usd'); P.createPreset('halfcover', 0, 0); document.activeElement?.blur(); }, sample);
    const [download] = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.keyboard.press('Control+s')]);
    await pg.waitForFunction(() => /Downloaded/.test(document.getElementById('toast').textContent), null, { timeout: 3000 }).catch(() => {});
    const dl = { file: download.suggestedFilename(), filePath: await pg.evaluate(() => window.__ptah.state.filePath), toast: await pg.textContent('#toast') };
    if (dl.file !== 'level.usd' || dl.filePath !== 'level.usd' || !dl.toast.includes('Downloaded level.usd;')) fails.push('a .usd level downloads as ' + JSON.stringify(dl));
    const ref = await pg.evaluate(async () => {
      const P = window.__ptah, R = P.reference;
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const place = () => { R.setImage(png, 'plan.png'); R.set('width', 1024); R.set('x', 300); R.set('z', -200); R.set('rotation', 45); R.set('opacity', 0.9); };
      const placement = () => { const s = R.state; return { image: !!s.image, width: s.width, x: s.x, z: s.z, rotation: s.rotation, opacity: s.opacity }; };
      place();
      await P.newScene();
      if (P.pickerOpen()) P.pickProfile('ue-third');
      const afterNew = placement();
      place();
      P.loadUsdaText('#usda 1.0\ndef Cube "Box"\n{\n    double size = 100\n}\n', 'plain.usda');
      return { afterNew, afterOpen: placement() };
    });
    const defaults = JSON.stringify({ image: false, width: 512, x: 0, z: 0, rotation: 0, opacity: 0.5 });
    if (JSON.stringify(ref.afterNew) !== defaults || JSON.stringify(ref.afterOpen) !== defaults) fails.push('reference placement carried over: ' + JSON.stringify(ref));
    await pg.evaluate(() => window.__ptah.autosave.clear());
    await ctxN.close();

    // 3. the move of an offered snapshot to its held key fails (a quota): work done behind the bar survives Dismiss
    const ctxE = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pe = await ctxE.newPage();
    pe.on('pageerror', (err) => errors.push('pageerror (failed offer tab): ' + err.message));
    await pe.addInitScript(() => {
      window.confirm = () => true;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (v, k) {
        if (typeof k === 'string' && k.includes(':offered:')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return put.call(this, v, k);
      };
    });
    await pe.goto(url + 'index.html', { waitUntil: 'load' }); await boot(pe);
    await pe.evaluate(async () => { const P = window.__ptah; if (P.pickerOpen()) P.pickProfile('ue-third'); P.createPreset('halfcover', 0, 0); if (!(await P.autosave.flush())) throw new Error('flush failed'); });
    await pe.reload({ waitUntil: 'load' }); await boot(pe);
    if (!(await barShown(pe))) fails.push('setup: the snapshot was not offered after the reload');
    else {
      const e = await pe.evaluate(async () => {
        const P = window.__ptah;
        P.createPreset('halfcover', 0, 0); P.createPreset('halfcover', 256, 0);   // new work behind the bar
        await P.autosave.flush();
        document.getElementById('recover-dismiss').click();
        await new Promise(r => setTimeout(r, 300));
        const rows = await new Promise((res) => {
          const req = indexedDB.open('ptah', 1);
          req.onsuccess = () => { const db = req.result; const all = db.transaction('recovery').objectStore('recovery').getAll(); all.onsuccess = () => { db.close(); res(all.result); }; };
        });
        return { counts: rows.map(s => (s.text.match(/HalfCover_/g) || []).length), toast: document.getElementById('toast').textContent };
      });
      if (!e.counts.includes(2) || /Autosave is unavailable/.test(e.toast)) fails.push('after a failed offer move, Dismiss: snapshots with ' + JSON.stringify(e));
    }
    await pe.evaluate(() => window.__ptah.autosave.clear());
    await ctxE.close();

    // 4. a tab too busy to answer the roll call is still open: its work is not offered
    const ctxF = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pa = await ctxF.newPage();
    await pa.goto(url + 'index.html', { waitUntil: 'load' }); await boot(pa);
    await pa.evaluate(async () => { const P = window.__ptah; if (P.pickerOpen()) P.pickProfile('ue-third'); P.createPreset('halfcover', 0, 0); if (!(await P.autosave.flush())) throw new Error('flush failed'); });
    // tab A's main thread is taken for 8 s (a long import, or a tab the browser throttles): it cannot answer
    const BUSY_MS = 8000;
    const busyFrom = Date.now();
    await pa.evaluate((ms) => { setTimeout(() => { const end = Date.now() + ms; while (Date.now() < end); }, 0); }, BUSY_MS);
    const pb = await ctxF.newPage();
    pb.on('pageerror', (err) => errors.push('pageerror (second tab): ' + err.message));
    await pb.goto(url + 'index.html', { waitUntil: 'load' }); await boot(pb);
    const bootedIn = Date.now() - busyFrom;
    // B's roll call must fall inside A's busy spell, or A would simply have answered it
    if (bootedIn > BUSY_MS - 1000) fails.push(`setup: tab B took ${bootedIn} ms to boot, past tab A's busy spell`);
    else if (await barShown(pb)) fails.push('a busy tab\'s unsaved work was offered to another tab');
    await pa.evaluate(() => window.__ptah.autosave.clear());
    await ctxF.close();

    if (fails.length) throw new Error(fails.join('; '));
    result.steps.push('ok: a .usd level downloads under its own name; New and Open reset the reference placement; a failed offer move keeps work done behind the bar; a busy tab\'s work is not offered to another tab');
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: 0.9.7 save and autosave fixes — ' + e.message);
  }

  // Editor input with real mouse, keyboard and touch (synthetic events hid these).
  try {
    const ctxT = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const pg = await ctxT.newPage();
    pg.on('pageerror', (err) => errors.push('pageerror (input tab): ' + err.message));
    await pg.addInitScript(() => {
      window.__calls = { save: 0, open: 0, confirm: 0 };
      window.showSaveFilePicker = async () => { window.__calls.save++; throw new DOMException('closed', 'AbortError'); };
      window.showOpenFilePicker = async () => { window.__calls.open++; throw new DOMException('closed', 'AbortError'); };
      window.confirm = () => { window.__calls.confirm++; return false; };
    });
    await pg.goto(url + 'index.html', { waitUntil: 'load' });
    await pg.waitForSelector('#viewport canvas', { timeout: 15000 });
    await pg.waitForFunction(() => window.__ptah && (window.__ptah.pickerOpen() || !document.getElementById('recover-bar').classList.contains('hidden')), null, { timeout: 5000 });
    await pg.evaluate(() => { if (!document.getElementById('recover-bar').classList.contains('hidden')) document.getElementById('recover-dismiss').click(); if (window.__ptah.pickerOpen()) window.__ptah.pickProfile('ue-third'); });
    const calls = () => pg.evaluate(() => { const c = window.__calls; window.__calls = { save: 0, open: 0, confirm: 0 }; return c; });
    const box = await pg.locator('#viewport canvas').boundingBox();
    const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
    const fails = [];

    // 1. Ctrl+Shift+S / Ctrl+O from the Grid and Ground fields open one dialog, not two
    await pg.keyboard.press('c'); await pg.mouse.click(...at(0.5, 0.55)); await pg.keyboard.press('Escape');   // something unsaved
    for (const id of ['grid-size', 'ground-size']) {
      await calls();
      await pg.focus('#' + id); await pg.keyboard.press('Control+Shift+S'); await pg.waitForTimeout(200);
      const a = await calls();
      await pg.focus('#' + id); await pg.keyboard.press('Control+o'); await pg.waitForTimeout(200);
      const b = await calls();
      if (a.save !== 1 || b.confirm !== 1) fails.push(`${id}: Save As opened ${a.save} dialogs, Open asked ${b.confirm} times`);
    }

    // 2. placing a note puts the typing in its text box, not into shortcuts
    await pg.keyboard.press('n');
    await pg.mouse.click(...at(0.62, 0.62));
    await pg.keyboard.type('cover');
    const note = await pg.evaluate(() => ({ focus: document.activeElement.id, text: document.getElementById('insp-text').value, tool: window.__ptah.state.tool }));
    if (note.text !== 'cover' || note.tool !== 'select') fails.push('typing after placing a note: ' + JSON.stringify(note));
    await pg.evaluate(() => document.activeElement.blur());

    // 3. one finger runs the tool without orbiting; two fingers orbit
    const cdp = await ctxT.newCDPSession(pg);
    const touch = async (points0, points1) => {
      const P = (pts, t) => pts.map(([fx, fy], i) => ({ x: at(fx, fy)[0] + (t ? 0 : 0), y: at(fx, fy)[1], id: i }));
      // fingers land one after another, as real ones do (the first has already started the tool)
      for (let n = 1; n <= points0.length; n++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: P(points0.slice(0, n)) });
        await pg.waitForTimeout(16);
      }
      for (let k = 1; k <= 10; k++) {
        const pts = points0.map(([fx, fy], i) => [fx + (points1[i][0] - fx) * k / 10, fy + (points1[i][1] - fy) * k / 10]);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: P(pts) });
        await pg.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await pg.waitForTimeout(500);
    };
    const cam = () => pg.evaluate(() => window.__ptah.camera());
    const moved = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    await pg.keyboard.press('c');
    let c0 = await cam(), n0 = await pg.evaluate(() => window.__ptah.ids().length);
    await touch([[0.3, 0.5]], [[0.45, 0.5]]);
    let c1 = await cam();
    const placed = (await pg.evaluate(() => window.__ptah.ids().length)) - n0;
    if (moved(c0, c1) > 1 || placed !== 1) fails.push(`one-finger placement: camera moved ${moved(c0, c1).toFixed(0)}u, ${placed} placed`);
    await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape');
    c0 = await cam();
    await touch([[0.4, 0.4], [0.5, 0.4]], [[0.55, 0.4], [0.65, 0.4]]);
    c1 = await cam();
    if (moved(c0, c1) < 50) fails.push(`two fingers did not orbit (camera moved ${moved(c0, c1).toFixed(0)}u)`);
    // with a placement tool armed, two fingers orbit and three pan: what the first finger began is taken back
    const tgt = () => pg.evaluate(() => window.__ptah.target());
    await pg.keyboard.press('c');
    const lv0 = await pg.evaluate(() => ({ n: window.__ptah.ids().length, undo: window.__ptah.undoDepth(), dirty: window.__ptah.state.dirty }));
    await touch([[0.4, 0.4], [0.5, 0.4]], [[0.55, 0.4], [0.65, 0.4]]);
    await pg.waitForTimeout(1500);                 // the orbit's damping settles (it turns the view for over a second)
    c0 = await cam(); const t0 = await tgt();
    await touch([[0.4, 0.4], [0.5, 0.4], [0.45, 0.5]], [[0.55, 0.45], [0.65, 0.45], [0.6, 0.55]]);
    c1 = await cam(); const t1 = await tgt();
    const lv1 = await pg.evaluate(() => ({ n: window.__ptah.ids().length, undo: window.__ptah.undoDepth(), dirty: window.__ptah.state.dirty, tool: window.__ptah.state.tool }));
    const offDrift = Math.hypot((c1.x - t1.x) - (c0.x - t0.x), (c1.y - t1.y) - (c0.y - t0.y), (c1.z - t1.z) - (c0.z - t0.z));
    if (moved(c0, c1) < 50 || offDrift > 1) fails.push(`three fingers did not pan (camera moved ${moved(c0, c1).toFixed(0)}u, view direction drifted ${offDrift.toFixed(1)}u)`);
    if (lv1.n !== lv0.n || lv1.undo !== lv0.undo || lv1.dirty !== lv0.dirty) fails.push('orbiting or panning with the cube tool armed changed the level: ' + JSON.stringify({ before: lv0, after: lv1 }));
    await touch([[0.3, 0.6]], [[0.36, 0.6]]);
    if ((await pg.evaluate(() => window.__ptah.ids().length)) !== lv0.n + 1) fails.push('one finger no longer places after a two- or three-finger gesture');
    // a later finger landing on the gizmo does not drag it (the cube just placed is selected, with its gizmo)
    await pg.keyboard.press('Escape'); await pg.keyboard.press('w');
    const cubeId = await pg.evaluate(() => window.__ptah.ids().at(-1).id);
    await pg.evaluate((id) => window.__ptah.select([id]), cubeId);
    await pg.waitForTimeout(100);
    const g0 = await pg.evaluate((id) => ({ pos: window.__ptah.worldPosition(id), undo: window.__ptah.undoDepth(), attached: window.__ptah.gizmo().attached }), cubeId);
    const on = await pg.evaluate((p) => window.__ptah.project(p.x, p.y, p.z), g0.pos);
    await touch([[0.15, 0.2], [0.25, 0.2], [on.fx, on.fy]], [[0.2, 0.3], [0.3, 0.3], [on.fx + 0.05, on.fy + 0.1]]);
    const g1 = await pg.evaluate((id) => ({ pos: window.__ptah.worldPosition(id), undo: window.__ptah.undoDepth(), gizmo: window.__ptah.gizmo() }), cubeId);
    if (!g0.attached || Math.hypot(g1.pos.x - g0.pos.x, g1.pos.y - g0.pos.y, g1.pos.z - g0.pos.z) > 0.01 || g1.undo !== g0.undo)
      fails.push('a third finger on the gizmo moved the selection: ' + JSON.stringify({ g0, g1 }));
    // and the gizmo works again once the fingers are up
    const g2 = await pg.evaluate(() => window.__ptah.gizmo());
    if (!g2.attached) fails.push('the gizmo is gone after a three-finger pan');
    await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape');

    // 4. double-clicking a hierarchy row with the mouse renames it
    const nameBox = await pg.locator('.h-row .h-name').first().boundingBox();
    await pg.mouse.dblclick(nameBox.x + 5, nameBox.y + nameBox.height / 2);
    const renaming = await pg.evaluate(() => ({ input: document.querySelectorAll('.h-rename').length, focus: document.activeElement.className }));
    if (renaming.input !== 1 || renaming.focus !== 'h-rename') fails.push('double-click on a hierarchy row did not start a rename: ' + JSON.stringify(renaming));
    await pg.keyboard.press('Escape');

    // 5-8 through the editor's own hooks
    const r = await pg.evaluate(() => {
      const P = window.__ptah, out = [];
      const key = (code, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace('Key', '').toLowerCase(), ...opts, bubbles: true }));
      // 5. snapping a uniform scale drag keeps a 1u plane 1u thick
      const pl = P.createPreset ? null : null; void pl;
      key('KeyP');
      const canvas = document.querySelector('#viewport canvas'), rect = canvas.getBoundingClientRect();
      const pt = (fx, fy, type) => canvas.dispatchEvent(new PointerEvent(type, { clientX: rect.left + rect.width * fx, clientY: rect.top + rect.height * fy, button: 0, pointerId: 1, bubbles: true }));
      pt(0.3, 0.3, 'pointerdown'); pt(0.3, 0.3, 'pointerup'); key('Escape');
      const plane = P.ids().filter(o => o.type === 'plane').pop().id;
      P.select([plane]); key('KeyR');
      const n = P.state.objects.get(plane).node, s0 = n.scale.clone();
      const c = P.project(n.position.x, 0, n.position.z), nd = { x: c.fx * 2 - 1, y: -(c.fy * 2 - 1) };
      P.gizmoDrag('XYZ', { x: nd.x + 0.01, y: nd.y + 0.01 }, { x: nd.x + 0.013, y: nd.y + 0.013 });
      const s1 = P.state.objects.get(plane).node.scale;
      if (!(s0.y === 1 && s1.y === 1 && s1.x % P.state.gridSize === 0)) out.push(`uniform scale snap: ${JSON.stringify(s0)} -> ${JSON.stringify(s1)}`);
      key('KeyQ');
      // 6. Size field: a group mirrors with a negative size; a cube keeps its 1u minimum
      const cube = P.ids().find(o => o.type === 'cube').id;
      P.select([cube]); P.group();
      const grp = P.ids().find(o => o.type === 'group').id;
      const f = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); };
      P.select([grp]); f('insp-size-x', '-1');
      const gx = P.state.objects.get(grp).node.scale.x;
      P.select([cube]); f('insp-size-x', '0.2');
      const cx = P.state.objects.get(cube).node.scale.x;
      if (gx !== -1 || cx !== 1) out.push(`Size field: group -1 gave ${gx}, cube 0.2 gave ${cx}`);
      // 7. a child selected when its group is deleted loses its highlight after undo
      P.select([cube]);
      const em = () => P.state.objects.get(cube).node.material.emissive.getHex();
      const lit = em();
      [...document.querySelectorAll('.h-row')].find(row => row.dataset.id === grp).querySelector('.h-del').click();
      key('KeyZ', { ctrlKey: true });
      if (P.state.selection.includes(cube) || em() === lit || lit === 0) out.push(`child highlight after undoing a group delete: selected ${P.state.selection.includes(cube)}, emissive ${em().toString(16)} (selected was ${lit.toString(16)})`);
      return out;
    });
    fails.push(...r);

    // 8. the reference opacity slider with the keyboard is undoable and marks the level unsaved
    await pg.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 8; c.height = 8; c.getContext('2d').fillRect(0, 0, 8, 8);
      window.__ptah.reference.setImage(c.toDataURL('image/png'), 'x.png');
      window.__ptah.state.dirty = false;
    });
    const u0 = await pg.evaluate(() => ({ undo: window.__ptah.undoDepth(), op: window.__ptah.reference.state.opacity }));
    await pg.focus('#ref-opacity');
    await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('ArrowRight');
    await pg.evaluate(() => document.getElementById('ref-opacity').blur());
    const u1 = await pg.evaluate(() => ({ undo: window.__ptah.undoDepth(), op: window.__ptah.reference.state.opacity, dirty: window.__ptah.state.dirty }));
    // each arrow key is a committed change (the slider fires change per key): one undo step per press
    const u2 = await pg.evaluate((steps) => {
      for (let i = 0; i < steps; i++) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', ctrlKey: true, bubbles: true }));
      return window.__ptah.reference.state.opacity;
    }, u1.undo - u0.undo);
    if (!(u1.op > u0.op && u1.undo - u0.undo === 2 && u1.dirty && Math.abs(u2 - u0.op) < 1e-9)) fails.push(`keyboard opacity: before ${JSON.stringify(u0)}, after ${JSON.stringify(u1)}, undone to ${u2}`);

    await pg.evaluate(() => window.__ptah.autosave.clear());
    await ctxT.close();
    if (fails.length) throw new Error(fails.join('; '));
    result.steps.push('ok: real input: Save As/Open from the Grid and Ground fields fire once, a new note takes the typing, one finger runs the tool, two orbit and three pan (none of them leaving an object behind or dragging the gizmo), double-click renames, scale snap keeps 1u sizes, Size mirrors groups, no stale highlight after undo, keyboard opacity is undoable');
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: editor input — ' + e.message);
  }

  // A chosen theme comes back on the next launch, applied by theme-boot.js before app.js runs.
  try {
    const ctxT = await browser.newContext({ viewport: { width: 1200, height: 800 } });   // its own storage
    const pg = await ctxT.newPage();
    pg.on('pageerror', (err) => errors.push('pageerror (theme tab): ' + err.message));
    await pg.goto(url + 'index.html', { waitUntil: 'load' });
    await pg.waitForFunction(() => window.__ptah);
    await pg.selectOption('#theme-select', 'primer-light-hc');
    // on the reload, look before any module runs: DOMContentLoaded fires after classic scripts in <head>, and app.js is a module
    await pg.addInitScript(() => document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive' && !window.__themeAtParse) window.__themeAtParse = document.documentElement.dataset.theme || 'none';
    }));
    await pg.reload({ waitUntil: 'load' });
    await pg.waitForFunction(() => window.__ptah);
    const r = await pg.evaluate(() => ({ atParse: window.__themeAtParse, theme: document.documentElement.dataset.theme, picker: document.getElementById('theme-select').value,
      bar: getComputedStyle(document.getElementById('topbar')).backgroundColor, meta: document.querySelector('meta[name="theme-color"]').content }));
    // real key presses (a synthetic keydown does not move a <select>): arrows step through the themes,
    // applying each at once and keeping focus; a letter goes back to the editor as a shortcut
    await pg.click('.profile-card[data-profile="ue-third"]');
    await pg.focus('#theme-select');
    const at = () => pg.evaluate(() => ({ value: document.getElementById('theme-select').value, theme: document.documentElement.dataset.theme || 'ptah',
      focused: document.activeElement?.id, snap: window.__ptah.state.snap }));
    await pg.keyboard.press('ArrowDown');
    const down = await at();
    await pg.keyboard.press('ArrowUp');
    const up = await at();
    await pg.keyboard.press('g');
    const letter = await at();
    await pg.keyboard.press('g');
    if (down.value !== 'primer-dark-hc' || down.theme !== 'primer-dark-hc' || down.focused !== 'theme-select' || up.value !== 'primer-light-hc' || up.theme !== 'primer-light-hc' || up.focused !== 'theme-select'
        || letter.focused === 'theme-select' || letter.snap !== !up.snap) throw new Error('keyboard: ' + JSON.stringify({ down, up, letter }));
    // every top-bar control is on screen from Electron's minimum width up (the bar wraps rather than clip)
    const clipped = [];
    for (const w of [1024, 1280, 1366, 1400, 1440, 1536, 1920]) {
      await pg.setViewportSize({ width: w, height: 800 });
      clipped.push(...await pg.evaluate((w) => {
        const tb = document.getElementById('topbar'), right = tb.getBoundingClientRect().right;
        const out = [...tb.querySelectorAll('button, select, input')].filter(el => el.offsetParent && el.getBoundingClientRect().right > right + 0.5).map(el => `${el.id} at ${w}px`);
        // the status bar keeps its version at the right edge (it shares .tb-spacer with the top bar)
        const sb = document.getElementById('statusbar').getBoundingClientRect(), ver = document.getElementById('status-version').getBoundingClientRect();
        if (sb.right - ver.right > 20) out.push(`status-version ${Math.round(sb.right - ver.right)}px from the right at ${w}px`);
        return out;
      }, w));
    }
    await ctxT.close();
    if (clipped.length) throw new Error('layout: ' + clipped.join(', '));
    if (r.atParse !== 'primer-light-hc' || r.theme !== 'primer-light-hc' || r.picker !== 'primer-light-hc' || r.bar !== 'rgb(255, 255, 255)' || r.meta !== '#ffffff') throw new Error(JSON.stringify(r));
    result.steps.push('ok: a chosen theme is applied again on the next launch, before app.js runs; arrow keys step through the themes and a letter reaches the editor; no top-bar control is clipped from 1024 to 1920 px');
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: theme remembered — ' + e.message);
  }

  // The profile picker never opens over work, and picking a profile never marks work as saved.
  try {
    const ctxP = await browser.newContext({ viewport: { width: 1440, height: 900 } });   // its own storage: no snapshots from other steps
    const pg = await ctxP.newPage();
    pg.on('pageerror', (err) => errors.push('pageerror (picker tab): ' + err.message));
    await pg.addInitScript(() => { window.confirm = () => true; });
    const fails = [];
    // 1. work started in the moment before the storage check finishes
    await pg.goto(url + 'index.html', { waitUntil: 'load' });
    await pg.waitForFunction(() => window.__ptah);
    const early = await pg.evaluate(() => {
      const canvas = document.querySelector('#viewport canvas'), b = canvas.getBoundingClientRect();
      const was = window.__ptah.pickerOpen();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true }));
      const o = { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0, pointerId: 1, bubbles: true };
      canvas.dispatchEvent(new PointerEvent('pointerdown', o)); canvas.dispatchEvent(new PointerEvent('pointerup', o));
      return { was, n: window.__ptah.ids().length };
    });
    await pg.waitForTimeout(1500);
    const after = await pg.evaluate(() => ({ picker: window.__ptah.pickerOpen(), dirty: window.__ptah.state.dirty, n: window.__ptah.ids().length }));
    if (early.was) fails.push('setup: the picker was already open at boot');
    else if (after.picker || !after.dirty || after.n !== 1) fails.push('work placed right after launch: ' + JSON.stringify(after));
    // 2. a recovery that cannot be imported, restored over work done behind the bar
    await pg.evaluate(() => window.__ptah.autosave.clear());
    let deep = '#usda 1.0\n';
    for (let i = 0; i < 70; i++) deep += 'def Xform "X' + i + '" {\n';
    for (let i = 0; i < 70; i++) deep += '}\n';
    await pg.evaluate((text) => new Promise((res, rej) => {
      const req = indexedDB.open('ptah', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('recovery');
      req.onsuccess = () => { const db = req.result; const tx = db.transaction('recovery', 'readwrite'); tx.objectStore('recovery').put({ text, filePath: null, savedAt: Date.now() }, 'session:deadbeef'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = rej; };
    }), deep);
    await pg.reload({ waitUntil: 'load' });
    await pg.waitForSelector('#recover-bar:not(.hidden)', { timeout: 5000 });
    const box = await pg.locator('#viewport canvas').boundingBox();
    await pg.keyboard.press('c');
    await pg.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await pg.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.55);
    await pg.keyboard.press('Escape');
    await pg.click('#recover-restore');
    await pg.waitForTimeout(400);
    const r2 = await pg.evaluate(() => ({ picker: window.__ptah.pickerOpen(), dirty: window.__ptah.state.dirty, n: window.__ptah.ids().length }));
    if (r2.picker || !r2.dirty || r2.n !== 2) fails.push('after a failed restore over work: ' + JSON.stringify(r2));
    // 3. changing the profile from the Metrics panel on a level with work: undoable, stays unsaved
    const u0 = await pg.evaluate(() => window.__ptah.undoDepth());
    await pg.click('#metrics-change');
    await pg.click('.profile-card[data-profile="unity-first"]');
    const r3 = await pg.evaluate(() => ({ dirty: window.__ptah.state.dirty, undo: window.__ptah.undoDepth(), profile: window.__ptah.metrics().profile }));
    if (!r3.dirty || r3.undo !== u0 + 1 || r3.profile !== 'unity-first') fails.push('profile change on a level with work: ' + JSON.stringify(r3));
    await pg.evaluate(() => window.__ptah.autosave.clear());
    await ctxP.close();
    if (fails.length) throw new Error(fails.join('; '));
    result.steps.push('ok: the profile picker stays away from work started at launch or behind a failed restore; a profile change on a level with work is undoable and stays unsaved');
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: profile picker over work — ' + e.message);
  }

  // A saved level stays saved through gestures that are taken back, and a save mid-gesture writes only recorded edits.
  try {
    const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });   // its own storage
    const pg = await ctxC.newPage();
    await pg.addInitScript(() => { window.showSaveFilePicker = async () => { throw new DOMException('closed', 'AbortError'); }; });
    await pg.goto(url + 'index.html', { waitUntil: 'load' });
    await pg.waitForFunction(() => window.__ptah && window.__ptah.pickerOpen(), null, { timeout: 5000 });
    await pg.evaluate(() => window.__ptah.pickProfile('ue-third'));
    const box = await pg.locator('#viewport canvas').boundingBox();
    const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
    const cdp = await ctxC.newCDPSession(pg);
    const P = (pts) => pts.map(([fx, fy], i) => ({ x: at(fx, fy)[0], y: at(fx, fy)[1], id: i }));
    const touch = async (from, to) => {
      for (let n = 1; n <= from.length; n++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: P(from.slice(0, n)) }); await pg.waitForTimeout(16); }
      for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: P(from.map(([x, y], i) => [x + (to[i][0] - x) * k / 8, y + (to[i][1] - y) * k / 8])) }); await pg.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await pg.waitForTimeout(300);
    };
    const level = () => pg.evaluate(() => ({ n: window.__ptah.ids().length, undo: window.__ptah.undoDepth(), dirty: window.__ptah.state.dirty }));
    const snapshots = () => pg.evaluate(() => new Promise((res) => {
      const req = indexedDB.open('ptah', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('recovery');
      req.onsuccess = () => { const db = req.result; const c = db.transaction('recovery').objectStore('recovery').count(); c.onsuccess = () => { db.close(); res(c.result); }; };
    }));
    const fails = [];
    const l0 = await level();
    if (l0.dirty || l0.n !== 0) fails.push('a fresh level is not clean: ' + JSON.stringify(l0));
    await pg.keyboard.press('c');
    await touch([[0.4, 0.4], [0.5, 0.4]], [[0.55, 0.4], [0.65, 0.4]]);
    await touch([[0.4, 0.4], [0.5, 0.4], [0.45, 0.5]], [[0.55, 0.45], [0.65, 0.45], [0.6, 0.55]]);
    // and a mouse placement taken back with Esc
    const [mx, my] = at(0.3, 0.6);
    await pg.mouse.move(mx, my); await pg.mouse.down(); await pg.mouse.move(mx + 40, my + 10);
    await pg.keyboard.press('Escape');
    await pg.mouse.up();
    const l1 = await level();
    if (l1.dirty || l1.n !== 0 || l1.undo !== 0) fails.push('taking back a placement on a saved level left it changed: ' + JSON.stringify(l1));
    await pg.waitForTimeout(3500);                   // past the autosave debounce
    const snaps = await snapshots();
    if (snaps !== 0) fails.push(`taking back placements on a saved level wrote ${snaps} recovery snapshot(s)`);
    // another edit made while a placement is held (an inspector field, here a metrics change) stays unsaved when the placement is taken back
    await pg.keyboard.press('c');
    await pg.mouse.move(mx, my); await pg.mouse.down(); await pg.mouse.move(mx + 20, my);
    await pg.evaluate(() => window.__ptah.setMetrics({ ...window.__ptah.metrics(), stepHeight: window.__ptah.metrics().stepHeight + 1 }));
    await pg.keyboard.press('Escape');
    await pg.mouse.up();
    const le = await level();
    if (!le.dirty || le.n !== 0) fails.push('an edit made during a placement was marked saved when the placement was taken back: ' + JSON.stringify(le));
    // Save while a placement is held (the keyboard waits, but the Save button, tapped with another
    // pointer, and the desktop menu do not) records the placement first: the file holds recorded edits only
    await pg.keyboard.press('c');
    await pg.mouse.move(mx, my); await pg.mouse.down(); await pg.mouse.move(mx + 30, my);
    await pg.tap('#btn-save');
    await pg.waitForTimeout(200);
    const mid = await pg.evaluate(() => ({ placing: !!window.__ptah.state.placing, n: window.__ptah.ids().length, undo: window.__ptah.undoDepth() }));
    await pg.mouse.up();
    await pg.keyboard.press('Escape');
    const l2 = await level();
    if (mid.placing || mid.n !== 1 || mid.undo !== le.undo + 1 || l2.n !== 1 || !l2.dirty) fails.push('Save during a placement: ' + JSON.stringify({ mid, after: l2 }));
    await pg.evaluate(() => window.__ptah.autosave.clear());
    await ctxC.close();
    if (fails.length) throw new Error(fails.join('; '));
    result.steps.push('ok: two- and three-finger gestures and Esc take back a placement on a saved level without marking it unsaved or writing a snapshot, but an edit made meanwhile stays unsaved; Save mid-placement records the placement first');
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: saved level through taken-back gestures — ' + e.message);
  }

  // Editor fixes from the 0.9.2 review: the gizmo, a walk queued behind the mannequin, undo of a
  // multi-object inspector edit, a Hierarchy move that changes nothing, and selection without a rebuild.
  try {
    const ctxG = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg = await ctxG.newPage();
    let releaseMannequin;
    const gate = new Promise((r) => { releaseMannequin = r; });
    await pg.route('**/mannequin.glb.js', async (r) => { await gate; await r.continue(); });   // the mannequin "loads slowly"
    await pg.goto(url + 'index.html', { waitUntil: 'load' });
    await pg.waitForFunction(() => window.__ptah && window.__ptah.pickerOpen(), null, { timeout: 5000 });
    await pg.evaluate(() => window.__ptah.pickProfile('ue-third'));
    const loaded = await pg.evaluate((t) => window.__ptah.loadUsdaText(t), fs.readFileSync(path.join(here, 'sample.usda'), 'utf8'));
    await pg.evaluate(() => window.__ptah.pickProfile('ue-third'));   // after the load (the sample brings its own first-person metrics): the walk needs the mannequin
    const fails = [];
    if (loaded === false) fails.push('sample.usda did not load');
    const view = await pg.evaluate(() => window.__ptah.walkViewFor());
    if (view !== 'third') fails.push('the walk would not wait for the mannequin (view ' + view + ')');
    const byName = async (n) => pg.evaluate((n) => window.__ptah.ids().find(o => o.name === n).id, n);
    let [wall, half, note, start] = [await byName('Wall 01'), await byName('HalfCover_01'), await byName('Spawn'), await byName('PlayerStart_01')];
    const gizmo = async (ids, key) => { await pg.evaluate((ids) => window.__ptah.select(ids), ids); await pg.keyboard.press(key); return pg.evaluate(() => window.__ptah.gizmo().attached); };
    await pg.evaluate(() => document.activeElement?.blur());      // shortcuts go to the window, not a field
    // 1. no rotate/scale gizmo on what the inspector locks; move still works, and ordinary objects keep every mode
    const g = {
      noteRotate: await gizmo([note], 'KeyE'), noteScale: await gizmo([note], 'KeyR'), noteMove: await gizmo([note], 'KeyW'),
      startScale: await gizmo([start], 'KeyR'), startRotate: await gizmo([start], 'KeyE'),
      mixedScale: await gizmo([wall, start], 'KeyR'), cubeScale: await gizmo([wall], 'KeyR')
    };
    await pg.evaluate((ids) => window.__ptah.select(ids), [note]);
    await pg.keyboard.press('KeyE');
    const noteToast = await pg.textContent('#toast');
    await pg.keyboard.press('KeyW');
    if (g.noteRotate || g.noteScale || !g.noteMove || g.startScale || !g.startRotate || g.mixedScale || !g.cubeScale || !/notes only move/.test(noteToast))
      fails.push('gizmo modes on locked fields: ' + JSON.stringify({ ...g, noteToast }));
    // a Trigger's scale gizmo goes when it becomes a point marker, and comes back with undo
    const trigger = await byName('Trigger_01');
    const k = { volume: await gizmo([trigger], 'KeyR') };
    await pg.selectOption('#insp-marker', 'PlayerStart');
    k.point = await pg.evaluate(() => window.__ptah.gizmo().attached);
    await pg.evaluate(() => document.activeElement?.blur());
    await pg.keyboard.press('Control+z');
    k.undone = await pg.evaluate(() => window.__ptah.gizmo().attached);
    if (!k.volume || k.point || !k.undone) fails.push('scale gizmo across a marker kind change: ' + JSON.stringify(k));
    await pg.keyboard.press('KeyW');
    // 2. a walk asked for while the mannequin loads: any other key cancels it (a modifier too), Tab again toggles it
    //    off, a request left from a level replaced meanwhile is replaced rather than toggled, and one still
    //    waiting when the mannequin arrives starts
    const pending = () => pg.evaluate(() => window.__ptah.walkPending());
    await pg.evaluate(() => window.__ptah.select([]));
    await pg.keyboard.press('Tab');
    const t1 = await pg.textContent('#toast'), p0 = await pending();
    await pg.keyboard.press('KeyW');
    const p1 = await pending();
    await pg.keyboard.press('Tab'); await pg.keyboard.press('Tab');
    const t2 = await pg.textContent('#toast'), p2 = await pending();
    await pg.keyboard.press('Tab');
    await pg.evaluate((t) => { window.__ptah.loadUsdaText(t); window.__ptah.pickProfile('ue-third'); }, fs.readFileSync(path.join(here, 'sample.usda'), 'utf8'));
    await pg.evaluate(() => document.activeElement?.blur());
    await pg.keyboard.press('Tab');
    const t3 = await pg.textContent('#toast'), p3 = await pending();
    await pg.keyboard.press('Shift');
    const p4 = await pending();
    await pg.keyboard.press('Tab');                                   // asked again, then Tab used to move focus in the Hierarchy
    await pg.evaluate(() => document.querySelector('.h-row').focus());
    await pg.keyboard.press('Tab');
    const p5 = await pending();
    // the Walk button from the keyboard toggles it too (Enter on the focused button: it blurs itself after a click)
    await pg.focus('#walk-toggle'); await pg.keyboard.press('Enter');
    const p6 = await pending();
    await pg.focus('#walk-toggle'); await pg.keyboard.press('Enter');
    const p7 = await pending(), t4 = await pg.textContent('#toast');
    await pg.focus('#walk-toggle'); await pg.keyboard.press('Enter');   // asked again from the button, then another key on it cancels
    await pg.focus('#walk-toggle'); await pg.keyboard.press('KeyW');
    const p8 = await pending();
    await pg.evaluate(() => document.activeElement?.blur());
    [wall, half, note, start] = [await byName('Wall 01'), await byName('HalfCover_01'), await byName('Spawn'), await byName('PlayerStart_01')];
    await pg.keyboard.press('Tab');                                   // left waiting
    const beforeArrival = await pg.evaluate(() => window.__ptah.walk.active);
    releaseMannequin();
    await pg.evaluate(() => window.__ptah.mannequinReady());
    await pg.waitForTimeout(300);
    const started = await pg.evaluate(() => window.__ptah.walk.active && window.__ptah.walk.view === 'third');
    const q = { t1, p0, p1, t2, p2, t3, p3, p4, p5, p6, p7, t4, p8, beforeArrival, started };
    if (!/Loading the mannequin/.test(t1) || !p0 || p1 || !/Walk cancelled/.test(t2) || p2 || !/Loading the mannequin/.test(t3) || !p3 || p4 || p5 || !p6 || p7 || !/Walk cancelled/.test(t4) || p8 || beforeArrival || !started)
      fails.push('a walk queued behind the mannequin: ' + JSON.stringify(q));
    if (await pg.evaluate(() => window.__ptah.walk.active)) await pg.evaluate(() => window.__ptah.walk.exit());   // so the checks below run in the editor
    // 3. undoing an inspector edit of two objects reselects both
    await pg.evaluate((ids) => window.__ptah.select(ids), [wall, half]);
    await pg.fill('#insp-pos-x', '+=128'); await pg.press('#insp-pos-x', 'Enter');
    await pg.evaluate(() => window.__ptah.select([]));
    await pg.evaluate(() => document.activeElement?.blur());
    await pg.keyboard.press('Control+z');
    const reselected = await pg.evaluate(() => [...window.__ptah.state.selection].sort());
    if (reselected.join() !== [wall, half].sort().join()) fails.push('undo of a two-object inspector edit reselected ' + JSON.stringify(reselected));
    // 4. a Hierarchy move that leaves everything where it was records nothing and changes nothing
    const m0 = await pg.evaluate(() => ({ undo: window.__ptah.undoDepth(), dirty: window.__ptah.state.dirty, order: window.__ptah.ids().map(o => o.name).join() }));
    await pg.evaluate(() => { window.__ptah.state.dirty = false; });
    await pg.evaluate(([w, h]) => window.__ptah.move([w], null, h), [wall, half]);   // Wall 01 is already just before HalfCover_01
    const m1 = await pg.evaluate(() => ({ undo: window.__ptah.undoDepth(), dirty: window.__ptah.state.dirty, order: window.__ptah.ids().map(o => o.name).join() }));
    if (m1.undo !== m0.undo || m1.dirty || m1.order !== m0.order) fails.push('a move that changes nothing: ' + JSON.stringify({ m0, m1 }));
    await pg.evaluate(([w, h]) => window.__ptah.move([h], null, w), [wall, half]);   // a real reorder still records
    const m2 = await pg.evaluate(() => ({ undo: window.__ptah.undoDepth(), order: window.__ptah.ids().map(o => o.name).join() }));
    if (m2.undo !== m0.undo + 1 || m2.order === m0.order) fails.push('a real reorder was not recorded: ' + JSON.stringify({ m0, m2 }));
    // 5. clicking rows changes the selection without rebuilding them (the same elements stay), aria-selected follows
    const rowsBefore = await pg.evaluate(() => { const rows = [...document.querySelectorAll('.h-row')]; rows.forEach((r, i) => { r.__mark = i; }); return rows.length; });
    const clickRow = async (id, opts = {}) => {
      try { await pg.click(`.h-row[data-id="${id}"]`, { timeout: 5000, ...opts }); }
      catch (e) {
        const why = await pg.evaluate((id) => { const r = document.querySelector(`.h-row[data-id="${id}"]`); if (!r) return 'no row'; const b = r.getBoundingClientRect(); const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { box: [b.x, b.y, b.width, b.height], top: top && (top.id || top.className) }; }, id);
        fails.push('row click ' + (id === wall ? 'wall' : 'start') + ': ' + e.message.split('\n')[0] + ' ' + JSON.stringify(why));
      }
    };
    await clickRow(wall);
    await clickRow(start, { modifiers: ['Shift'] });
    const rows = await pg.evaluate(([w, s]) => {
      const all = [...document.querySelectorAll('.h-row')];
      return { kept: all.every(r => r.__mark !== undefined), n: all.length, sel: all.filter(r => r.getAttribute('aria-selected') === 'true').map(r => r.dataset.id).sort(), focused: document.activeElement?.dataset?.id, state: [...window.__ptah.state.selection].sort(), w, s };
    }, [wall, start]);
    if (!rows.kept || rows.n !== rowsBefore || rows.sel.join() !== rows.state.join() || rows.state.join() !== [wall, start].sort().join() || rows.focused !== start)
      fails.push('selecting rows: ' + JSON.stringify(rows));
    await pg.evaluate(() => window.__ptah.autosave.clear());
    await ctxG.close();
    if (fails.length) throw new Error(fails.join('; '));
    result.steps.push('ok: no rotate/scale gizmo on a note or scale gizmo on a point marker; a walk queued behind the mannequin is cancelled by other input or a second Tab; undo of a two-object inspector edit reselects both; a no-op Hierarchy move records nothing; selecting rows restyles them in place');
  } catch (e) {
    result.ok = false;
    result.steps.push('FAIL: editor fixes (gizmo, queued walk, inspector undo, no-op move, row selection) — ' + e.message);
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
