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
//   onMenu(fn)        native menu commands (Electron on macOS; a no-op on the web)
//   forgetFile()      the next Save must ask where: the scene no longer comes from the last opened file
//
// `filePath` is an opaque token the editor hands back on Save. In Electron it
// is a real path; on the web it is the file's display name and the platform
// keeps the matching handle internally.

import { MAX_IMPORT_BYTES, IMPORT_TOO_LARGE } from './usd.js';

const USD_TYPES = [{ description: 'USD (text)', accept: { 'text/plain': ['.usda'] } }];

function electronPlatform(bridge) {
  return {
    name: 'electron',
    saveUsd: (opts) => bridge.saveUsd(opts),
    openUsd: () => bridge.openUsd(),
    confirmDiscard: (message) => bridge.confirmDiscard(message),
    setTitle: (title) => bridge.setTitle(title),
    setDirty: (dirty) => { if (bridge.setDirty) bridge.setDirty(!!dirty); },
    onMenu: (fn) => { if (bridge.onMenu) bridge.onMenu(fn); },
    forgetFile() { /* main.js only writes without a dialog to paths picked in one */ }
  };
}

function webPlatform() {
  let handle = null;          // FileSystemFileHandle for the current document
  let fileGen = 0;            // bumped by Open and New: a save still writing then must not adopt its handle
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
    // a browser that asks before downloading needs the URL until the student answers
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  };

  const isAbort = (err) => err && (err.name === 'AbortError' || err.name === 'NotAllowedError');

  return {
    name: 'web',

    async saveUsd({ content, filePath, suggestedName }) {
      const name = suggestedName || filePath || 'blockout.usda';
      if (hasFsAccess) {
        const gen = fileGen;
        try {
          // Save (not Save As) with a live handle writes in place.
          let h = handle;
          if (!(filePath && h && h.name === filePath)) {
            h = await window.showSaveFilePicker({ suggestedName: name, types: USD_TYPES });
          }
          const w = await h.createWritable();
          await w.write(content);
          await w.close();
          if (gen === fileGen) handle = h;
          return { canceled: false, filePath: h.name };
        } catch (err) {
          if (isAbort(err)) return { canceled: true };
          // Permission or quota problem: fall through to a plain download.
          console.warn('File System Access save failed, downloading instead:', err);
        }
      }
      download(content, name.endsWith('.usda') ? name : name + '.usda');
      return { canceled: false, filePath: name, downloaded: true };   // handed to the browser; it may still ask or refuse
    },

    async openUsd() {
      if (hasFsAccess) {
        try {
          const [h] = await window.showOpenFilePicker({ types: USD_TYPES, multiple: false });
          const file = await h.getFile();
          if (file.size > MAX_IMPORT_BYTES) return { canceled: false, error: IMPORT_TOO_LARGE };
          handle = h;
          fileGen++;
          return { canceled: false, filePath: h.name, content: await file.text() };
        } catch (err) {
          if (isAbort(err)) return { canceled: true };
          // The picker needs a recent click; after a slow confirm dialog the file input would be blocked the same way.
          if (err && err.name === 'SecurityError') return { canceled: false, error: 'The browser blocked the file picker. Click Open again.' };
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
          if (f.size > MAX_IMPORT_BYTES) return done({ canceled: false, error: IMPORT_TOO_LARGE });
          handle = null;
          fileGen++;
          done({ canceled: false, filePath: f.name, content: await f.text() });
        });
        input.addEventListener('cancel', () => done({ canceled: true }));
        // browsers without the input's cancel event: the window regains focus when the chooser closes
        window.addEventListener('focus', () => setTimeout(() => { if (!input.files || !input.files.length) done({ canceled: true }); }, 1000), { once: true });
        input.click();
      });
    },

    async confirmDiscard(message) {
      return window.confirm(message || 'You have unsaved changes. Discard them?');
    },

    setTitle(title) { document.title = title; },

    setDirty(v) { dirty = !!v; },
    onMenu() { /* browsers have no application menu */ },

    forgetFile() { handle = null; fileGen++; }
  };
}

export const platform = window.ptah ? electronPlatform(window.ptah) : webPlatform();
