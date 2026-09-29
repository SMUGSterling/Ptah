// mobile.js — what the mobile page (renderer/mobile/) adds to the editor for touch.
//
// The page is the same editor as the desktop one (same markup, same app.js);
// mobile.css lays it out for phones and tablets. This module adds only what a
// layout cannot:
//   - on phones, the sidebar becomes a bottom sheet with one tab per panel, and
//     the top bar's less-used controls move into a More tab (and back, when a
//     phone is turned into a tablet-sized window);
//   - touch controls for walk mode: a stick, a look drag, Jump, Crouch, Run,
//     View and Exit buttons;
//   - wording for touch where the desktop page names keys.
// app.js loads it only on the mobile page and passes what it needs.

const PHONE = window.matchMedia('(max-width: 767px), (max-height: 500px)');   // as mobile.css: portrait or landscape phones
const LOOK_TOUCH = 0.0055;              // rad per pixel of look drag: a thumb's width turns about 20°

export function initMobile({ walk, canvas, frameSelection, setView }) {
  const $ = (id) => document.getElementById(id);
  const sidebar = $('sidebar');

  // ---- the More panel: top-bar controls a phone has no room for ----
  const more = document.createElement('section');
  more.id = 'more';
  more.innerHTML = '<header class="panel-head"><h2>More</h2></header><div id="more-body"></div>';
  sidebar.appendChild(more);
  const moreBody = more.querySelector('#more-body');
  const views = document.createElement('div');
  views.className = 'more-row';
  views.innerHTML = '<span class="insp-label">View</span>'
    + ['top', 'front', 'right'].map(v => `<button data-view="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')
    + '<button id="m-frame">Frame selection</button>'
    + '<a class="m-desktop" href="../">Desktop layout</a>';
  views.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.view) setView(b.dataset.view); else frameSelection();
  });
  // what moves on a phone: [element, its home parent, the node it sat before]
  const movable = [
    $('btn-new'), $('btn-saveas'),
    $('preset-select').closest('.tb-group'),
    $('grid-size').closest('.tb-group'),
    $('ticks-toggle'),
    $('theme-select').closest('.tb-group')
  ].map(el => [el, el.parentNode, el.nextSibling]);
  const fileRow = document.createElement('div');
  fileRow.className = 'more-row';
  const toolRow = document.createElement('div');
  toolRow.className = 'more-row';
  function arrange() {
    if (PHONE.matches) {
      moreBody.replaceChildren(fileRow, views);
      fileRow.replaceChildren($('btn-new'), $('btn-saveas'), $('theme-select').closest('.tb-group'));
      toolRow.replaceChildren($('ticks-toggle'));
      for (const [el] of movable.slice(2, 4)) moreBody.appendChild(el);
      moreBody.appendChild(toolRow);
    } else {
      // last first, so each element's old next sibling is already back home
      for (const [el, parent, next] of [...movable].reverse()) parent.insertBefore(el, next && next.parentNode === parent ? next : null);
      moreBody.replaceChildren(views);
    }
  }
  arrange();
  PHONE.addEventListener('change', arrange);

  // ---- the bottom sheet (phones): a button per panel; the open one again closes it ----
  // Disclosure buttons (aria-expanded), not a tablist: all panels can be closed at once.
  const TABS = [['inspector-wrap', 'Inspector'], ['hierarchy', 'Hierarchy'], ['metrics', 'Metrics'], ['reference', 'Reference'], ['more', 'More']];
  const tabs = document.createElement('nav');
  tabs.id = 'sheet-tabs';
  tabs.setAttribute('aria-label', 'Panels');
  tabs.innerHTML = TABS.map(([id, label]) => `<button type="button" data-panel="${id}" aria-controls="${id}" aria-expanded="false">${label}</button>`).join('');
  sidebar.prepend(tabs);
  function show(panel, open) {
    sidebar.dataset.panel = panel;
    sidebar.classList.toggle('open', open);
    for (const b of tabs.children) {
      const on = b.dataset.panel === panel;
      b.setAttribute('aria-expanded', String(on && open));
      b.classList.toggle('on', on && open);
    }
  }
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const same = sidebar.dataset.panel === b.dataset.panel && sidebar.classList.contains('open');
    show(b.dataset.panel, !same);
    b.blur();
  });
  show('inspector-wrap', false);

  // ---- touch wording ----
  $('inspector-empty').innerHTML = 'Nothing selected.<br />Tap an object, or pick a shape in the tool bar and tap the grid.';
  $('view-hints').textContent = 'drag to orbit · two fingers pan and pinch · tap to select';

  // ---- walk mode: stick, look drag and buttons, shown while walking ----
  const hud = $('walk-hud');
  const pad = document.createElement('div');
  pad.id = 'walk-touch';
  pad.innerHTML = `
    <div id="m-stick" class="m-stick" role="application" aria-label="Move: drag the stick"><div class="m-knob"></div></div>
    <div class="m-buttons">
      <button id="m-jump" aria-label="Jump">Jump</button>
      <button id="m-crouch" aria-pressed="false" aria-label="Crouch (toggle)">Crouch</button>
      <button id="m-run" aria-pressed="false" aria-label="Run (toggle)">Run</button>
      <button id="m-view" aria-label="Switch first and third person">View</button>
      <button id="m-exit" aria-label="Leave walk mode">Exit</button>
    </div>`;
  hud.appendChild(pad);
  const stick = pad.querySelector('#m-stick'), knob = pad.querySelector('.m-knob');
  let stickId = null;
  function stickAt(e) {
    const r = stick.getBoundingClientRect(), rad = r.width / 2;
    let x = (e.clientX - r.left - rad) / rad, y = (e.clientY - r.top - rad) / rad;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    knob.style.transform = `translate(${x * rad * 0.6}px, ${y * rad * 0.6}px)`;
    walk.stick(x, -y);
  }
  function stickEnd() { stickId = null; knob.style.transform = ''; walk.stick(0, 0); }
  stick.addEventListener('pointerdown', (e) => {
    stickId = e.pointerId;
    try { stick.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks: the stick still follows it */ }
    stickAt(e); e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) stickAt(e); });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(t, (e) => { if (e.pointerId === stickId) stickEnd(); });

  const toggleKey = (btn, code) => btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    if (on) walk.press(code); else walk.release(code);
  });
  toggleKey(pad.querySelector('#m-crouch'), 'KeyC');
  toggleKey(pad.querySelector('#m-run'), 'ShiftLeft');
  // A finger jumps on touching (a click would wait for the lift); a screen reader or switch
  // activates the button with a click that has no pointer behind it (detail 0).
  const jumpBtn = pad.querySelector('#m-jump');
  jumpBtn.addEventListener('pointerdown', (e) => { walk.press('Space'); e.preventDefault(); });
  jumpBtn.addEventListener('click', (e) => { if (e.detail === 0) walk.press('Space'); });
  pad.querySelector('#m-view').addEventListener('click', () => walk.setView(walk.view === 'third' ? 'first' : 'third', true));
  pad.querySelector('#m-exit').addEventListener('click', () => walk.exit());
  for (const b of pad.querySelectorAll('button')) b.addEventListener('click', () => b.blur());

  // look: a finger dragged on the view (not on a control) turns it
  const looks = new Map();
  canvas.addEventListener('pointerdown', (e) => { if (walk.active && e.pointerType !== 'mouse') looks.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  canvas.addEventListener('pointermove', (e) => {
    const p = looks.get(e.pointerId); if (!p) return;
    walk.lookBy(e.clientX - p.x, e.clientY - p.y, LOOK_TOUCH);
    p.x = e.clientX; p.y = e.clientY;
  });
  for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, (e) => looks.delete(e.pointerId));

  // a walk starts with the toggles off, and a finished one leaves nothing held
  new MutationObserver(() => {
    if (!hud.classList.contains('hidden')) return;
    stickEnd(); looks.clear();
    for (const [id, code] of [['m-crouch', 'KeyC'], ['m-run', 'ShiftLeft']]) { pad.querySelector('#' + id).setAttribute('aria-pressed', 'false'); walk.release(code); }
  }).observe(hud, { attributes: true, attributeFilter: ['class'] });
}
