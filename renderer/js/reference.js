// reference.js — reference image underlay.
//
// A floorplan sketch, paper map or screenshot laid flat just under the grid so
// you can block out over it. The image is downscaled and embedded in the
// .usda (stage customLayerData) so the file reopens anywhere, in the browser
// build included, with no path bookkeeping. Engines ignore the metadata.

import * as THREE from 'three';

const MAX_EDGE = 2048;               // downscale longer edge to this many pixels
const JPEG_QUALITY = 0.85;
const KEEP_PNG_BELOW = 400 * 1024;   // small PNGs keep transparency
const Y_OFFSET = -0.6;               // just below the grid lines (y = 0)

export function createReference({ scene, history, markDirty, toast, onExtent = () => {} }) {
  const st = { image: null, width: 512, x: 0, z: 0, rotation: 0, opacity: 0.5, aspect: 1 };
  const group = new THREE.Group();
  group.name = 'Reference';
  scene.add(group);
  let mesh = null, texture = null;
  let generation = 0;                 // guards against an older image load landing after a newer one

  const ui = {
    panel: document.getElementById('reference'),
    empty: document.getElementById('reference-empty'),
    body: document.getElementById('reference-body'),
    load: document.getElementById('ref-load'),
    clear: document.getElementById('ref-clear'),
    file: document.getElementById('ref-file'),
    width: document.getElementById('ref-width'),
    x: document.getElementById('ref-x'),
    z: document.getElementById('ref-z'),
    rotation: document.getElementById('ref-rotation'),
    opacity: document.getElementById('ref-opacity'),
    opacityVal: document.getElementById('ref-opacity-val'),
    name: document.getElementById('ref-name'),
    thumb: document.getElementById('ref-thumb')
  };

  const isDataImage = (v) => typeof v === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v);

  function rebuild() {
    if (mesh) { group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
    if (texture) { texture.dispose(); texture = null; }
    group.visible = !!st.image;
    syncUi();
    const gen = ++generation;               // also when clearing: an image still loading must not land afterwards
    if (!st.image) return;
    const img = new Image();
    img.onload = () => {
      if (gen !== generation) return;          // superseded by a newer rebuild
      st.aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      // An image loaded here was downscaled on the way in; one embedded in a
      // hand-made file may not be. Never upload more than MAX_EDGE pixels a side.
      let source = img;
      const edge = Math.max(img.naturalWidth, img.naturalHeight);
      if (edge > MAX_EDGE) {
        const k = MAX_EDGE / edge;
        source = document.createElement('canvas');
        source.width = Math.max(1, Math.round(img.naturalWidth * k));
        source.height = Math.max(1, Math.round(img.naturalHeight * k));
        source.getContext('2d').drawImage(img, 0, 0, source.width, source.height);
      }
      texture = new THREE.Texture(source);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({
        map: texture, transparent: true, opacity: st.opacity, depthWrite: false, side: THREE.DoubleSide
      });
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.rotation.x = -Math.PI / 2;     // lay flat; image top points to -Z
      mesh.raycast = () => {};            // never selectable
      mesh.renderOrder = -1;
      group.add(mesh);
      place();
      onExtent();                              // the aspect is known only now
      if (ui.thumb) ui.thumb.src = st.image;
    };
    img.onerror = () => toast('Reference image could not be decoded', true);
    img.src = st.image;
  }

  function place() {
    group.position.set(st.x, Y_OFFSET, st.z);
    group.rotation.y = THREE.MathUtils.degToRad(st.rotation);
    if (mesh) {
      mesh.scale.set(st.width, st.width / st.aspect, 1);
      mesh.material.opacity = st.opacity;
    }
    syncUi();
  }

  function syncUi() {
    if (!ui.panel) return;
    const has = !!st.image;
    ui.empty.classList.toggle('hidden', has);
    ui.body.classList.toggle('hidden', !has);
    ui.clear.disabled = !has;
    if (document.activeElement !== ui.width) ui.width.value = String(Math.round(st.width));
    if (document.activeElement !== ui.x) ui.x.value = String(Math.round(st.x));
    if (document.activeElement !== ui.z) ui.z.value = String(Math.round(st.z));
    if (document.activeElement !== ui.rotation) ui.rotation.value = String(Math.round(st.rotation));
    ui.opacity.value = String(Math.round(st.opacity * 100));
    ui.opacityVal.textContent = Math.round(st.opacity * 100) + '%';
  }

  /** Change one numeric setting with undo. */
  function set(prop, value, { record = true } = {}) {
    const v = Number(value);
    if (!isFinite(v)) { syncUi(); return; }
    const prev = st[prop];
    const next = prop === 'opacity' ? THREE.MathUtils.clamp(v, 0.05, 1)
      : prop === 'width' ? Math.max(1, v) : v;
    if (prev === next) { syncUi(); return; }
    st[prop] = next;
    place();
    markDirty();
    if (record) {
      history.push({
        label: 'Reference ' + prop,
        undo: () => set(prop, prev, { record: false }),
        redo: () => set(prop, next, { record: false })
      });
    }
  }

  function snapshot() { return { image: st.image, width: st.width, x: st.x, z: st.z, rotation: st.rotation, opacity: st.opacity, name: st.name }; }
  function restore(s) { Object.assign(st, s); if (ui.name) ui.name.textContent = st.name || ''; rebuild(); markDirty(); }

  function setImage(dataUrl, name, { record = true } = {}) {
    const prev = snapshot();
    st.image = dataUrl;
    st.name = name || 'reference';
    rebuild();
    markDirty();
    if (record) {
      const next = snapshot();
      history.push({ label: 'Reference image', undo: () => restore(prev), redo: () => restore(next) });
    }
    if (ui.name) ui.name.textContent = st.name;
  }

  function clear({ record = true } = {}) {
    if (!st.image) return;
    const prev = snapshot();
    st.image = null;
    rebuild();
    markDirty();
    if (record) history.push({ label: 'Clear reference', undo: () => restore(prev), redo: () => restore({ ...prev, image: null }) });
  }

  /** Read a File/Blob, downscale, encode as a compact data URL. */
  async function loadFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('not an image'));
        i.src = url;
      });
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const keepPng = file.type === 'image/png' && file.size < KEEP_PNG_BELOW && scale === 1;
      const dataUrl = keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      // default width: one image pixel per unit (w is already capped at MAX_EDGE)
      if (!st.image) st.width = Math.max(64, Math.round(w / 64) * 64);
      setImage(dataUrl, file.name);
      toast(`Reference loaded (${Math.round(dataUrl.length / 1024)} KB embedded)`);
    } catch (err) {
      toast('Could not load reference: ' + err.message, true);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** For export: null when there is no image. */
  function serialize() {
    return st.image ? { image: st.image, width: st.width, x: st.x, z: st.z, rotation: st.rotation, opacity: st.opacity } : null;
  }

  /** From import (no undo, not dirty). Only embedded data URLs are accepted:
   *  a file must never make the editor fetch a remote or local URL. */
  function load(ref) {
    if (ref && ref.image && !isDataImage(ref.image)) {
      toast('Reference image in this file is not embedded image data; ignored', true);
      ref = { ...ref, image: null };
    }
    st.image = ref && ref.image ? ref.image : null;
    if (ref) {
      // file values are untrusted: NaN, negative or absurd numbers get the defaults set() would allow
      const fin = (v, d, lim) => (typeof v === 'number' && isFinite(v) ? THREE.MathUtils.clamp(v, -lim, lim) : d);
      st.width = Math.max(1, fin(ref.width, 512, 1e6)); st.x = fin(ref.x, 0, 1e7); st.z = fin(ref.z, 0, 1e7);
      st.rotation = fin(ref.rotation, 0, 360); st.opacity = THREE.MathUtils.clamp(fin(ref.opacity, 0.5, 1), 0.05, 1);
    }
    st.name = st.image ? 'embedded image' : null;
    if (ui.name) ui.name.textContent = st.name || '';
    rebuild();
  }

  // ---- UI wiring ----
  if (ui.panel) {
    ui.load.addEventListener('click', () => ui.file.click());
    ui.file.addEventListener('change', () => {
      const f = ui.file.files && ui.file.files[0];
      if (f) loadFile(f);
      ui.file.value = '';
    });
    ui.clear.addEventListener('click', () => clear());
    for (const prop of ['width', 'x', 'z', 'rotation']) {
      ui[prop].addEventListener('change', () => set(prop, ui[prop].value));
      ui[prop].addEventListener('keydown', (e) => { if (e.key === 'Enter') ui[prop].blur(); e.stopPropagation(); });
    }
    ui.opacity.addEventListener('input', () => { st.opacity = Number(ui.opacity.value) / 100; place(); });
    let opacityBefore = null;
    ui.opacity.addEventListener('pointerdown', () => { opacityBefore = st.opacity; });
    ui.opacity.addEventListener('change', () => {
      const prev = opacityBefore ?? st.opacity, next = Number(ui.opacity.value) / 100;
      opacityBefore = null;
      st.opacity = prev;                   // set() records prev -> next
      set('opacity', next);
    });
    // drag & drop an image anywhere on the panel
    ui.panel.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); ui.panel.classList.add('drop-hover'); } });
    ui.panel.addEventListener('dragleave', () => ui.panel.classList.remove('drop-hover'));
    ui.panel.addEventListener('drop', (e) => {
      ui.panel.classList.remove('drop-hover');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) { e.preventDefault(); e.stopPropagation(); loadFile(f); }
    });
  }
  syncUi();

  return { set, setImage, clear, loadFile, serialize, load, get state() { return { ...st }; } };
}
