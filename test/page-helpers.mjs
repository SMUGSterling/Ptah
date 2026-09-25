// Page-side helpers shared by the runners. Each must stay self-contained: the
// browser runner passes it to page.evaluate, the Electron runner stringifies it.

/** Arm the cube tool, click once per [fx, fy] viewport fraction, disarm. Returns the object count. */
export function placeCubes(points) {
  const canvas = document.querySelector('#viewport canvas');
  const r = canvas.getBoundingClientRect();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true }));
  for (const [fx, fy] of points) {
    const o = { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, button: 0, pointerId: 1, bubbles: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', o));
    canvas.dispatchEvent(new PointerEvent('pointerup', o));
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  return window.__ptah.ids().length;
}
