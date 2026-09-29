// mobile.e2e.mjs — the mobile page (renderer/mobile/) on emulated phones and a tablet,
// driven with real touch events through the DevTools protocol. Run by e2e.browser.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devices } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function mobileSteps(browser, url, result, errors) {
  const step = async (name, fn) => {
    try { await fn(); result.steps.push('ok: mobile: ' + name); }
    catch (e) { result.ok = false; result.steps.push('FAIL: mobile: ' + name + ' — ' + e.message); }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => errors.push('pageerror (mobile): ' + err.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console (mobile): ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  /** Drag fingers from `from` to `to` (arrays of [x, y]) in `n` moves. */
  async function drag(from, to, n = 12) {
    await touch('touchStart', from.slice(0, 1));
    if (from.length > 1) await touch('touchStart', from);
    for (let i = 1; i <= n; i++) await touch('touchMove', from.map(([x, y], k) => [x + (to[k][0] - x) * i / n, y + (to[k][1] - y) * i / n]));
    await touch('touchEnd', []);
  }
  const canvasBox = async () => page.locator('#viewport canvas').boundingBox();
  // A real touch at an element's centre. (Playwright's own tap reports the top bar as intercepting
  // the walk buttons although elementsFromPoint and a raw touch both reach the button.)
  const tapEl = async (sel) => { const b = await page.locator(sel).boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
  const P = (fn, arg) => page.evaluate(fn, arg);

  await page.goto(url + 'mobile/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ptah && document.getElementById('sheet-tabs'));

  await step('the page fits a phone: no sideways scroll, and every control is a touch target', async () => {
    const r = await P(() => {
      const bad = [], small = [];
      for (const el of document.querySelectorAll('button, select, input:not([type=file]), .h-row')) {
        if (!el.offsetParent || el.closest('#walk-hud')) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 24 || b.height < 24) bad.push(el.id || el.className || el.tagName);   // WCAG 2.5.8 (AA)
        if (el.closest('#topbar, #toolrail, #sheet-tabs') && (b.width < 44 || b.height < 44)) small.push(el.id || el.textContent.trim());
      }
      return { scroll: document.documentElement.scrollWidth, vw: innerWidth, bad, small, mobile: document.documentElement.classList.contains('mobile') };
    });
    assert(r.mobile && r.scroll <= r.vw, 'layout: ' + JSON.stringify(r));
    assert(r.bad.length === 0 && r.small.length === 0, 'targets under 24 px: ' + r.bad.join(', ') + ' / bar controls under 44 px: ' + r.small.join(', '));
  });

  await step('a profile is picked with a tap, and a cube placed by tapping the tool and the grid', async () => {
    await page.tap('.profile-card[data-profile="ue-third"]');
    await page.tap('#toolrail [data-tool="place-cube"]');
    const b = await canvasBox();
    const n0 = await P(() => window.__ptah.ids().length);
    await page.touchscreen.tap(b.x + b.width * 0.5, b.y + b.height * 0.6);
    const n1 = await P(() => window.__ptah.ids().length);
    assert(n1 === n0 + 1, `objects ${n0} → ${n1}`);
    await page.tap('#toolrail [data-mode="translate"]');
  });

  await step('one finger on empty space orbits (no box select); a tap there deselects', async () => {
    const b = await canvasBox();
    await page.touchscreen.tap(b.x + b.width * 0.08, b.y + b.height * 0.1);
    const before = await P(() => ({ cam: window.__ptah.camera(), sel: window.__ptah.state.selection.length }));
    await drag([[b.x + b.width * 0.15, b.y + b.height * 0.12]], [[b.x + b.width * 0.55, b.y + b.height * 0.2]]);
    const after = await P(() => ({ cam: window.__ptah.camera(), sel: window.__ptah.state.selection.length, marquee: !document.getElementById('marquee').classList.contains('hidden') }));
    const moved = Math.hypot(after.cam.x - before.cam.x, after.cam.z - before.cam.z);
    assert(before.sel === 0 && after.sel === 0 && !after.marquee && moved > 100, 'orbit: ' + JSON.stringify({ before, after, moved }));
  });

  await step('two fingers pinch to zoom', async () => {
    const b = await canvasBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const dist = () => P(() => { const c = window.__ptah.camera(), t = window.__ptah.target(); return Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z); });
    const d0 = await dist();
    await drag([[cx - 30, cy], [cx + 30, cy]], [[cx - 140, cy], [cx + 140, cy]]);
    await page.waitForTimeout(400);     // damping
    const d1 = await dist();
    assert(d1 < d0 * 0.8, `camera distance ${d0.toFixed(0)} → ${d1.toFixed(0)}`);
  });

  await step('a tap selects; the Inspector tab opens its sheet, and a size typed there applies and undoes', async () => {
    const id = await P(() => window.__ptah.ids().filter(o => o.type === 'cube').pop().id);
    // the orbit and zoom above may have swung it off screen: look at it first
    const at = await P((id) => { const w = window.__ptah.worldPosition(id); window.__ptah.lookAt(w.x, w.y, w.z); return window.__ptah.project(w.x, w.y, w.z); }, id);
    const b = await canvasBox();
    await page.touchscreen.tap(b.x + b.width * at.fx, b.y + b.height * at.fy);
    assert(await P((id) => window.__ptah.state.selection[0] === id, id), 'tap did not select the cube');
    await page.tap('#sheet-tabs [data-panel="inspector-wrap"]');
    assert(await page.isVisible('#insp-size-x'), 'the Inspector did not open');
    await page.tap('#insp-size-x');
    await page.fill('#insp-size-x', '300');
    await page.keyboard.press('Enter');
    const sx = await P((id) => window.__ptah.serializeOne(id).scale.x, id);
    await page.tap('#btn-undo');
    const back = await P((id) => window.__ptah.serializeOne(id).scale.x, id);
    assert(sx === 300 && back !== 300, `size ${sx}, after undo ${back}`);
    await page.tap('#sheet-tabs [data-panel="inspector-wrap"]');
    assert(!(await page.isVisible('#insp-size-x')), 'tapping the open tab again did not close the sheet');
  });

  await step('a finger drags the move gizmo, and the object moves along the arrow', async () => {
    const id = await P(() => window.__ptah.state.selection[0]);
    assert(id, 'nothing selected');
    const b = await canvasBox();
    const c = await P((id) => { const w = window.__ptah.worldPosition(id); return window.__ptah.project(w.x, w.y, w.z); }, id);
    // find a pixel on the X arrow: hover a mouse over a grid around the object until the gizmo says X
    // (after a pause, so a render has refreshed the gizmo's picking meshes for the current camera)
    await page.waitForTimeout(400);
    let hit = null;
    const ox = b.x + b.width * c.fx, oy = b.y + b.height * c.fy;
    for (let r = 16; r <= 160 && !hit; r += 8) {
      for (let k = 0; k < 24 && !hit; k++) {
        const a = k / 24 * 2 * Math.PI, x = ox + Math.cos(a) * r, y = oy + Math.sin(a) * r;
        // stay on the canvas, the drag's end included: the gizmo only sees moves over it, so a
        // point off it would read the last axis, and fingers there land on the tool bar or tabs
        const inside = (px, py) => px > b.x + 4 && px < b.x + b.width - 4 && py > b.y + 4 && py < b.y + b.height - 4;
        if (!inside(x, y) || !inside(x + Math.cos(a) * 90, y + Math.sin(a) * 90)) continue;
        await page.mouse.move(x, y);
        if ((await P(() => window.__ptah.gizmo().axis)) === 'X') hit = [x, y, Math.cos(a), Math.sin(a)];
      }
    }
    assert(hit, 'no X handle found around the object');
    const x0 = await P((id) => window.__ptah.serializeOne(id).position.x, id);
    const u0 = await P(() => window.__ptah.undoDepth());
    await drag([[hit[0], hit[1]]], [[hit[0] + hit[2] * 90, hit[1] + hit[3] * 90]], 10);
    const x1 = await P((id) => window.__ptah.serializeOne(id).position.x, id);
    const u1 = await P(() => window.__ptah.undoDepth());
    const cam = await P(() => window.__ptah.state.selection[0]);
    assert(Math.abs(x1 - x0) >= 32 && u1 === u0 + 1 && cam === id, `x ${x0} → ${x1}, undo depth ${u0} → ${u1}, still selected ${cam === id}`);
  });

  await step('More holds the top-bar controls a phone has no room for, and they work there', async () => {
    await page.tap('#sheet-tabs [data-panel="more"]');
    const r = await P(() => ['btn-new', 'btn-saveas', 'theme-select', 'grid-size', 'snap-toggle', 'preset-select', 'ticks-toggle'].map(id => [id, !!document.getElementById(id).closest('#more'), !!document.getElementById(id).offsetParent]));
    const sheet = await P(() => ({ panel: document.getElementById('sidebar').dataset.panel, open: document.getElementById('sidebar').classList.contains('open'), active: document.activeElement?.id || document.activeElement?.tagName, gizmo: window.__ptah.gizmo() }));
    assert(r.every(([, inMore, shown]) => inMore && shown), JSON.stringify({ r, sheet }));
    await page.selectOption('#theme-select', 'primer-light');
    const bar = await P(() => getComputedStyle(document.getElementById('topbar')).backgroundColor);
    await page.selectOption('#theme-select', 'ptah');
    await page.tap('#sheet-tabs [data-panel="more"]');
    assert(bar === 'rgb(255, 255, 255)', 'theme from More: ' + bar);
  });

  await step('walk: the stick moves the player, Jump jumps, Crouch holds, Exit leaves; the view takes the screen', async () => {
    await page.tap('#walk-toggle', { timeout: 5000 });
    await page.waitForFunction(() => window.__ptah.walk.active, null, { timeout: 5000 });
    const shown = await P(() => ({ stick: !!document.getElementById('m-stick').offsetParent, rail: !!document.getElementById('toolrail').offsetParent, sheet: !!document.getElementById('sidebar').offsetParent }));
    assert(shown.stick && !shown.rail && !shown.sheet, 'walk layout: ' + JSON.stringify(shown));
    const s = await page.locator('#m-stick').boundingBox(), cx = s.x + s.width / 2, cy = s.y + s.height / 2;
    const p0 = await P(() => window.__ptah.walk._state());
    await touch('touchStart', [[cx, cy]]);
    await touch('touchMove', [[cx, cy - s.height / 2]]);
    await page.waitForTimeout(700);
    await touch('touchEnd', []);
    const p1 = await P(() => window.__ptah.walk._state());
    const went = Math.hypot(p1.px - p0.px, p1.pz - p0.pz);
    assert(went > 100, `the stick moved the player ${went.toFixed(0)} u`);
    await tapEl('#m-jump');
    await page.waitForTimeout(80);
    const air = await P(() => window.__ptah.walk._state().airborne);
    await page.waitForTimeout(1500);
    await tapEl('#m-crouch');
    await page.waitForTimeout(300);
    const crouched = await P(() => window.__ptah.walk._state().crouching);
    await tapEl('#m-crouch');
    // look: a finger dragged on the view turns it
    const b = await canvasBox();
    const yaw0 = (await P(() => window.__ptah.walk._state().charYaw));
    const cam0 = await P(() => window.__ptah.camera());
    await drag([[b.x + b.width * 0.6, b.y + b.height * 0.3]], [[b.x + b.width * 0.9, b.y + b.height * 0.3]]);
    const cam1 = await P(() => window.__ptah.camera());
    await tapEl('#m-exit');
    const out = await P(() => ({ active: window.__ptah.walk.active, rail: !!document.getElementById('toolrail').offsetParent }));
    assert(air && crouched && Math.hypot(cam1.x - cam0.x, cam1.z - cam0.z) > 1 && !out.active && out.rail, JSON.stringify({ air, crouched, cam0, cam1, yaw0, out }));
  });

  await step('turned on its side the phone keeps the phone layout; a tablet gets the side panels', async () => {
    // the narrowest common phone (many Androids are 360 px wide): nothing clipped or scrolled sideways
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(150);
    const narrow = await P(() => ({ bar: document.getElementById('topbar').offsetHeight, scroll: document.documentElement.scrollWidth, clipped: [...document.querySelectorAll('#topbar button, #sheet-tabs button')]
      .filter(e => e.offsetParent && (e.getBoundingClientRect().right > innerWidth + 0.5 || e.scrollWidth > e.clientWidth + 1)).map(e => e.id || e.textContent) }));
    assert(narrow.scroll <= 360 && narrow.clipped.length === 0 && narrow.bar <= 60, 'at 360 px (the top bar on one row): ' + JSON.stringify(narrow));
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(150);      // the media query's change event runs after the resize
    const landscape = await P(() => ({ tabs: !!document.getElementById('sheet-tabs').offsetParent, newInMore: !!document.getElementById('btn-new').closest('#more') }));
    await page.setViewportSize({ width: 1080, height: 810 });
    await page.waitForFunction(() => document.getElementById('btn-new').closest('#topbar'), null, { timeout: 3000 }).catch(() => {});
    const tablet = await P(() => ({ tabs: !!document.getElementById('sheet-tabs').offsetParent, newInBar: !!document.getElementById('btn-new').closest('#topbar'),
      order: [...document.querySelectorAll('#topbar button, #topbar select')].map(e => e.id).slice(0, 4).join() }));
    assert(landscape.tabs && landscape.newInMore && !tablet.tabs && tablet.newInBar && tablet.order === 'btn-new,btn-open,btn-save,btn-saveas', JSON.stringify({ landscape, tablet }));
  });

  await ctx.close();

  // Open on a phone: any file is offered (no .usda filter, which greys files out on iOS and Android)
  const ctx2 = await browser.newContext({ ...devices['Pixel 7'] });
  const pg = await ctx2.newPage();
  pg.on('pageerror', (err) => errors.push('pageerror (mobile 2): ' + err.message));
  await pg.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });   // as on Android and iOS
  await pg.goto(url + 'mobile/', { waitUntil: 'load' });
  await pg.waitForFunction(() => window.__ptah && document.getElementById('sheet-tabs'));
  await step('Open offers any file on a phone and reads a level from it', async () => {
    await pg.tap('.profile-card[data-profile="ue-third"]');
    const [chooser] = await Promise.all([pg.waitForEvent('filechooser'), pg.tap('#btn-open')]);
    const accept = await chooser.element().evaluate(el => el.accept);
    await chooser.setFiles(path.join(here, 'sample.usda'));
    await pg.waitForFunction(() => window.__ptah.ids().length > 5);
    assert(accept === '', 'accept filter: ' + accept);
  });
  await step('Save on a phone downloads the level as .usda', async () => {
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.tap('#btn-save')]);
    const text = fs.readFileSync(await dl.path(), 'utf8');
    assert(dl.suggestedFilename().endsWith('.usda') && text.startsWith('#usda'), dl.suggestedFilename());
  });
  await ctx2.close();

  // the desktop page offers a phone the mobile one, and the mobile page links back
  const ctx3 = await browser.newContext({ ...devices['iPhone 13'] });
  const pd = await ctx3.newPage();
  await pd.goto(url + 'index.html', { waitUntil: 'load' });
  await pd.waitForFunction(() => window.__ptah);
  await step('the desktop page offers a phone the mobile version; Not now hides it', async () => {
    const href = await pd.getAttribute('#mobile-offer a', 'href');
    await pd.tap('#mobile-offer button');
    assert(href === 'mobile/' && !(await pd.$('#mobile-offer')), 'offer ' + href);
  });
  await ctx3.close();
}
