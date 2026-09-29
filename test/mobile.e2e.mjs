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
    // Fingers need a moment off the glass before the next tap: on a slow machine Chrome was still
    // closing the drag's touch sequence and took a tap sent at once as part of it (no click).
    await page.waitForTimeout(150);
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
        if ((el.closest('#topbar, #toolrail, #sheet-tabs') || el.type === 'range' || el.classList.contains('swatch')) && (b.width < 44 || b.height < 44)) small.push(el.id || el.className || el.textContent.trim());
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

  await step('one-finger orbit: nothing while rotation is off, and it keeps to the polar limits', async () => {
    const b = await canvasBox(), x = b.x + b.width * 0.15;
    const phi = () => P(() => { const c = window.__ptah.camera(), t = window.__ptah.target(); return Math.acos((c.y - t.y) / Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z)); });
    const cam = () => P(() => window.__ptah.camera());
    try {
      await P(() => window.__ptah.setOrbit({ enableRotate: false }));
      const c0 = await cam();
      await drag([[x, b.y + b.height * 0.12]], [[b.x + b.width * 0.55, b.y + b.height * 0.3]]);
      const c1 = await cam();
      await P(() => window.__ptah.setOrbit({ enableRotate: true }));
      await P(() => window.__ptah.setOrbit({ minPolarAngle: 0.6, maxPolarAngle: 1.2 }));
      await drag([[x, b.y + b.height * 0.7]], [[x, b.y + b.height * 0.1]]);    // finger up: tilts down, toward the max
      const up = await phi();
      await drag([[x, b.y + b.height * 0.1]], [[x, b.y + b.height * 0.7]]);    // finger down: tilts up, toward the min
      const down = await phi();
      const still = Math.hypot(c1.x - c0.x, c1.y - c0.y, c1.z - c0.z);
      assert(still < 1e-6 && Math.abs(up - 1.2) < 1e-3 && Math.abs(down - 0.6) < 1e-3, JSON.stringify({ still, up, down }));
    } finally { await P(() => window.__ptah.setOrbit({ enableRotate: true, minPolarAngle: 0, maxPolarAngle: Math.PI })); }
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
    assert(await page.isVisible('#insp-size-x') && (await page.getAttribute('#sheet-tabs [data-panel="inspector-wrap"]', 'aria-expanded')) === 'true', 'the Inspector did not open');
    // every control the open Inspector shows is a touch target
    const small = await P(() => [...document.querySelectorAll('#inspector-wrap button, #inspector-wrap input, #inspector-wrap select, #inspector-wrap textarea')]
      .filter(e => e.offsetParent).map(e => [e.id || e.className, e.getBoundingClientRect()]).filter(([, r]) => r.width < 44 || r.height < 44).map(([n, r]) => `${n} ${Math.round(r.width)}×${Math.round(r.height)}`));
    assert(small.length === 0, 'Inspector controls under 44 px: ' + small.join(', '));
    await page.tap('#insp-size-x');
    await page.fill('#insp-size-x', '300');
    await page.keyboard.press('Enter');
    const sx = await P((id) => window.__ptah.serializeOne(id).scale.x, id);
    await page.tap('#btn-undo');
    const back = await P((id) => window.__ptah.serializeOne(id).scale.x, id);
    assert(sx === 300 && back !== 300, `size ${sx}, after undo ${back}`);
    await page.tap('#sheet-tabs [data-panel="inspector-wrap"]');
    const expanded = await P(() => [...document.querySelectorAll('#sheet-tabs button')].map(b => b.getAttribute('aria-expanded')).join());
    assert(!(await page.isVisible('#insp-size-x')) && expanded === 'false,false,false,false,false', 'tapping the open tab again did not close the sheet: ' + expanded);
  });

  // (a pan, fingers moving together: a pinch here would zoom in so far that the gizmo step's drag
  // stayed inside one snapped grid cell)
  await step('a two-finger gesture that starts on an object leaves the selection alone; a tap still selects it', async () => {
    const id = await P(() => window.__ptah.state.selection[0]);
    const b = await canvasBox();
    await page.touchscreen.tap(b.x + 6, b.y + 6);           // empty corner: deselect
    const c = await P((id) => { const w = window.__ptah.worldPosition(id); return window.__ptah.project(w.x, w.y, w.z); }, id);
    const x = b.x + b.width * c.fx, y = b.y + b.height * c.fy;
    await drag([[x, y], [x + 60, y + 60]], [[x + 30, y - 20], [x + 90, y + 40]], 8);
    const afterPinch = await P(() => window.__ptah.state.selection.length);
    const c2 = await P((id) => { const w = window.__ptah.worldPosition(id); window.__ptah.lookAt(w.x, w.y, w.z); return window.__ptah.project(w.x, w.y, w.z); }, id);
    await page.touchscreen.tap(b.x + b.width * c2.fx, b.y + b.height * c2.fy);
    const afterTap = await P(() => window.__ptah.state.selection[0]);
    // a fingertip rolls a few pixels on a tap: 7 px is still a tap (touch slop), not an orbit
    await page.touchscreen.tap(b.x + 6, b.y + 6);
    const tx = b.x + b.width * c2.fx, ty = b.y + b.height * c2.fy;
    await drag([[tx, ty]], [[tx + 7, ty]], 3);
    const afterRoll = await P(() => window.__ptah.state.selection[0]);
    assert(afterPinch === 0 && afterTap === id && afterRoll === id, `after the pinch ${afterPinch} selected, after the tap ${afterTap}, after a 7 px roll ${afterRoll}`);
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
    await touch('touchStart', [[hit[0], hit[1]]]);
    const atDown = await P(() => ({ g: window.__ptah.gizmo(), m: window.__ptah.state.marquee, tool: window.__ptah.state.tool }));
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[hit[0] + hit[2] * 9 * i, hit[1] + hit[3] * 9 * i]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(150);
    const x1 = await P((id) => window.__ptah.serializeOne(id).position.x, id);
    const u1 = await P(() => window.__ptah.undoDepth());
    const cam = await P(() => window.__ptah.state.selection[0]);
    assert(Math.abs(x1 - x0) >= 32 && u1 === u0 + 1 && cam === id, `x ${x0} → ${x1}, undo depth ${u0} → ${u1}, still selected ${cam === id}, at touch-down ${JSON.stringify(atDown)}`);
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

  await step('with the marker tool armed, a two-finger pan places nothing and a tap places one', async () => {
    await page.tap('#sheet-tabs [data-panel="more"]');
    await page.selectOption('#marker-select', 'Spawn');
    await page.tap('#sheet-tabs [data-panel="more"]');
    const tool = await P(() => window.__ptah.state.tool);
    const b = await canvasBox(), cx = b.x + b.width * 0.5, cy = b.y + b.height * 0.55;
    const n0 = await P(() => window.__ptah.ids().length);
    await drag([[cx - 40, cy], [cx + 40, cy]], [[cx - 10, cy - 50], [cx + 70, cy - 50]], 8);
    const n1 = await P(() => window.__ptah.ids().length);
    await page.touchscreen.tap(cx, cy);
    const n2 = await P(() => window.__ptah.ids().length);
    // A finger whose pointerdown reached the canvas but which lifts elsewhere, with no canvas pointerup
    // (capture refused), leaves no held tap; a mouse released on the canvas meanwhile does not replay
    // it. Reproduced with a real touch on the wordmark: the canvas is sent a pointerdown for that same
    // live pointer with capture refused, then a mouse pointerup, then the finger lifts.
    const word = await page.locator('.wordmark').boundingBox();
    await P(() => { window.__lastTouch = null; window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') window.__lastTouch = e.pointerId; }, { capture: true, once: true }); });
    await touch('touchStart', [[word.x + word.width / 2, word.y + word.height / 2]]);
    const held = await P(({ x, y }) => {
      const canvas = document.querySelector('#viewport canvas');
      // capture refused: no pointer is captured (three.js's own listeners call these too, so no throwing)
      canvas.setPointerCapture = canvas.releasePointerCapture = () => {};
      try {
        canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', isPrimary: true, pointerId: window.__lastTouch, button: 0, clientX: x, clientY: y, bubbles: true }));
        const down = !!window.__ptah.state.touchTap;
        canvas.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', isPrimary: true, pointerId: window.__lastTouch + 1000, button: 0, clientX: x, clientY: y, bubbles: true }));
        return { down, afterMouse: !!window.__ptah.state.touchTap, n: window.__ptah.ids().length };
      } finally { delete canvas.setPointerCapture; delete canvas.releasePointerCapture; }
    }, { x: cx, y: cy });
    await touch('touchEnd', []);
    await page.waitForTimeout(150);
    const stuck = { ...held, after: await P(() => window.__ptah.state.touchTap), n3: await P(() => window.__ptah.ids().length), n2 };
    await page.tap('#toolrail [data-mode="translate"]');
    assert(tool === 'place-marker-Spawn' && n1 === n0 && n2 === n0 + 1, `tool ${tool}: ${n0} objects, ${n1} after the pan, ${n2} after the tap`);
    assert(stuck.down && stuck.afterMouse && stuck.n === n2 && stuck.after === null && stuck.n3 === n2, 'a tap lifted off the canvas stayed held (or placed): ' + JSON.stringify(stuck));
  });

  await step('a note placed on a phone opens the Inspector and takes the typing', async () => {
    await page.tap('#toolrail [data-tool="place-note"]');
    const b = await canvasBox();
    await page.touchscreen.tap(b.x + b.width * 0.3, b.y + b.height * 0.7);
    const r = await P(() => ({ focus: document.activeElement?.id, open: document.getElementById('sidebar').classList.contains('open'),
      panel: document.getElementById('sidebar').dataset.panel, type: window.__ptah.ids().pop().type }));
    await P(() => document.activeElement.blur());
    await page.tap('#sheet-tabs [data-panel="inspector-wrap"]');     // close the sheet again
    assert(r.type === 'note' && r.focus === 'insp-text' && r.open && r.panel === 'inspector-wrap', JSON.stringify(r));
  });

  await step('a viewport squeezed to nothing keeps a finite camera', async () => {
    const r = await P(async () => {
      const v = document.getElementById('viewport');
      v.style.flex = '0 0 0px'; v.style.height = '0px';
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const squeezed = window.__ptah.projection();
      v.style.flex = ''; v.style.height = '';
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      return { squeezed, after: window.__ptah.projection(), h: v.clientHeight };
    });
    assert(r.squeezed.finite && Number.isFinite(r.squeezed.aspect) && r.after.finite && r.h > 0, JSON.stringify(r));
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
    // a hardware keyboard's Shift, released, lets go of Run, and the button says so
    await tapEl('#m-run');
    const runOn = await P(() => document.getElementById('m-run').getAttribute('aria-pressed'));
    await P(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', key: 'Shift' })));
    const runOff = await P(() => document.getElementById('m-run').getAttribute('aria-pressed'));
    assert(runOn === 'true' && runOff === 'false', `Run button after a Shift keyup: ${runOn} → ${runOff}`);
    // a screen reader's click (no pointer, detail 0) jumps too
    await page.waitForFunction(() => !window.__ptah.walk._state().airborne, null, { timeout: 4000 });
    await P(() => document.getElementById('m-jump').click());
    await page.waitForTimeout(80);
    const airByClick = await P(() => window.__ptah.walk._state().airborne);
    assert(airByClick, 'an assistive-technology click on Jump did not jump');
    await page.waitForFunction(() => !window.__ptah.walk._state().airborne, null, { timeout: 4000 });
    await tapEl('#m-crouch');
    await page.waitForTimeout(300);
    const crouched = await P(() => window.__ptah.walk._state().crouching);
    // leaving the app (window blur) lets go of held toggles, and the buttons say so
    await P(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(300);
    const afterBlur = await P(() => ({ pressed: document.getElementById('m-crouch').getAttribute('aria-pressed'), crouching: window.__ptah.walk._state().crouching }));
    assert(afterBlur.pressed === 'false' && !afterBlur.crouching, 'after blur: ' + JSON.stringify(afterBlur));
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
      barClips: (() => { const tb = document.getElementById('topbar'), r = tb.getBoundingClientRect(); return [...tb.querySelectorAll('button, select, input')].some(e => e.offsetParent && e.getBoundingClientRect().bottom > r.bottom + 0.5); })(),
      order: [...document.querySelectorAll('#topbar button, #topbar select')].map(e => e.id).slice(0, 4).join() }));
    assert(landscape.tabs && landscape.newInMore && !tablet.tabs && tablet.newInBar && !tablet.barClips && tablet.order === 'btn-new,btn-open,btn-save,btn-saveas', JSON.stringify({ landscape, tablet }));
  });

  await ctx.close();

  // If mobile.js cannot load, the panels are still reachable (a scrolling list) and the page says why
  const ctxF = await browser.newContext({ ...devices['iPhone 13'] });
  const pf = await ctxF.newPage();
  await pf.route('**/js/mobile.js', (r) => r.abort());
  await pf.goto(url + 'mobile/', { waitUntil: 'load' });
  await pf.waitForFunction(() => window.__ptah);
  await pf.waitForTimeout(500);
  await step('without mobile.js the phone editor keeps its panels reachable and says what is missing', async () => {
    const toast = await pf.evaluate(() => document.getElementById('toast').textContent);   // before picking a profile says its own
    await pf.tap('.profile-card[data-profile="ue-third"]');
    const r = await pf.evaluate(() => ({ inspector: !!document.getElementById('inspector-wrap').offsetParent, hierarchy: !!document.getElementById('hierarchy').offsetParent,
      sheet: document.getElementById('sidebar').classList.contains('sheet') }));
    r.toast = toast;
    assert(r.inspector && r.hierarchy && !r.sheet && /touch controls did not load/.test(r.toast), JSON.stringify(r));
  });
  await ctxF.close();

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
  await step('the desktop page offers a phone the mobile version; answered either way, it is not asked again this session', async () => {
    const href = await pd.getAttribute('#mobile-offer a', 'href');
    await pd.tap('#mobile-offer a');                        // accept: to the mobile page
    await pd.waitForURL(/\/mobile\//);
    await pd.goto(url + 'index.html', { waitUntil: 'load' });   // and back, as its Desktop layout link does
    await pd.waitForFunction(() => window.__ptah);
    const again = !!(await pd.$('#mobile-offer'));
    assert(href === 'mobile/' && !again, `offer ${href}, asked again after accepting: ${again}`);
  });
  await ctx3.close();
  // the desktop page on a touchscreen laptop: a finger dragged from an object selects it, and draws no box
  const ctx5 = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const pt = await ctx5.newPage();
  await pt.goto(url + 'index.html', { waitUntil: 'load' });
  await pt.waitForFunction(() => window.__ptah);
  await step('desktop page, touchscreen: a finger dragged from an object selects it and draws no box', async () => {
    await pt.click('.profile-card[data-profile="ue-third"]');
    await pt.evaluate(async (t) => { await window.__ptah.loadUsdaText(t, 'sample.usda'); }, fs.readFileSync(path.join(here, 'sample.usda'), 'utf8'));
    const cdp5 = await ctx5.newCDPSession(pt);
    const t5 = (type, pts) => cdp5.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
    const { id, fx, fy } = await pt.evaluate(() => {
      const P = window.__ptah, o = P.ids().find(r => r.name === 'HalfCover_01') || P.ids().find(r => r.type === 'cube');
      P.select([]); const w = P.worldPosition(o.id); P.lookAt(w.x, w.y, w.z);
      const s = P.project(w.x, w.y, w.z); return { id: o.id, fx: s.fx, fy: s.fy };
    });
    const b = await pt.locator('#viewport canvas').boundingBox(), x = b.x + b.width * fx, y = b.y + b.height * fy;
    await t5('touchStart', [[x, y]]);
    for (let i = 1; i <= 6; i++) await t5('touchMove', [[x + i * 12, y + i * 8]]);
    const box = await pt.evaluate(() => !document.getElementById('marquee').classList.contains('hidden'));
    await t5('touchEnd', []);
    await pt.waitForTimeout(150);
    const sel = await pt.evaluate(() => window.__ptah.state.selection);
    assert(!box && sel.length === 1 && sel[0] === id, `box drawn ${box}, selection ${JSON.stringify(sel)} (wanted ${id})`);
  });
  await ctx5.close();

  // a phone on its side (wide but short) is offered it too
  const ctx4 = await browser.newContext({ viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true });
  const pl = await ctx4.newPage();
  await pl.goto(url + 'index.html', { waitUntil: 'load' });
  await pl.waitForFunction(() => window.__ptah);
  await step('a landscape phone is offered the mobile version as well', async () => {
    assert(!!(await pl.$('#mobile-offer')), 'no offer at 932 × 430');
  });
  await ctx4.close();
}
