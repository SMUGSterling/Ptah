// platform.js — the one place the editor touches the outside world.
//
// Ptah runs in two hosts with the same renderer code:
//   * Electron: preload.js exposes window.ptah (native dialogs over IPC).
//   * Browser:  File System Access API where available (Chromium), otherwise
//               download / <input type=file>; window.confirm; beforeunload.
//
// Both implement the same small interface:
//   name              'electron' | 'web'
//   saveUsd(opts)     -> { canceled, filePath }     opts: { content, filePath, suggestedName }
//   openUsd()         -> { canceled, filePath, content }
//   confirmDiscard(m) -> boolean
//   setTitle(title)
//   setDirty(bool)    host-side unsaved-changes guard (window close / tab close)
//
// `filePath` is an opaque token the editor hands back on Save. In Electron it
// is a real path; on the web it is the file's display name and the platform
// keeps the matching handle internally.

const USD_TYPES = [{ description: 'USD (text)', accept: { 'text/plain': ['.usda'] } }];

function electronPlatform(bridge) {
  return {
    name: 'electron',
    saveUsd: (opts) => bridge.saveUsd(opts),
    openUsd: () => bridge.openUsd(),
    confirmDiscard: (message) => bridge.confirmDiscard(message),
    setTitle: (title) => bridge.setTitle(title),
    setDirty: (dirty) => { if (bridge.setDirty) bridge.setDirty(!!dirty); }
  };
}

function webPlatform() {
  let handle = null;          // FileSystemFileHandle for the current document
  let dirty = false;
  const hasFsAccess = typeof window.showSaveFilePicker === 'function'
    && typeof window.showOpenFilePicker === 'function';

  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';      // legacy browsers need a truthy returnValue
  });

  const download = (content, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  };

  const isAbort = (err) => err && (err.name === 'AbortError' || err.name === 'NotAllowedError');

  return {
    name: 'web',

    async saveUsd({ content, filePath, suggestedName }) {
      const name = suggestedName || filePath || 'blockout.usda';
      if (hasFsAccess) {
        try {
          // Save (not Save As) with a live handle writes in place.
          if (!(filePath && handle && handle.name === filePath)) {
            handle = await window.showSaveFilePicker({ suggestedName: name, types: USD_TYPES });
          }
          const w = await handle.createWritable();
          await w.write(content);
          await w.close();
          return { canceled: false, filePath: handle.name };
        } catch (err) {
          if (isAbort(err)) return { canceled: true };
          // Permission or quota problem: fall through to a plain download.
          console.warn('File System Access save failed, downloading instead:', err);
        }
      }
      download(content, name.endsWith('.usda') ? name : name + '.usda');
      return { canceled: false, filePath: name };
    },

    async openUsd() {
      if (hasFsAccess) {
        try {
          const [h] = await window.showOpenFilePicker({ types: USD_TYPES, multiple: false });
          const file = await h.getFile();
          handle = h;
          return { canceled: false, filePath: h.name, content: await file.text() };
        } catch (err) {
          if (isAbort(err)) return { canceled: true };
          console.warn('File System Access open failed, using file input:', err);
        }
      }
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.usda,.usd';
        input.style.display = 'none';
        document.body.appendChild(input);
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; input.remove(); resolve(v); } };
        input.addEventListener('change', async () => {
          const f = input.files && input.files[0];
          if (!f) return done({ canceled: true });
          handle = null;
          done({ canceled: false, filePath: f.name, content: await f.text() });
        });
        input.addEventListener('cancel', () => done({ canceled: true }));
        input.click();
      });
    },

    async confirmDiscard(message) {
      return window.confirm(message || 'You have unsaved changes. Discard them?');
    },

    setTitle(title) { document.title = title; },

    setDirty(v) { dirty = !!v; },

    // for tests and the New command: forget the current handle
    _resetHandle() { handle = null; }
  };
}

export const platform = window.ptah ? electronPlatform(window.ptah) : webPlatform();
