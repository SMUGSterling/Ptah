// autosave.js — crash recovery snapshots.
//
// A few seconds after any edit (and at least once a minute while the level is
// dirty) the current export text is written to IndexedDB, which both the
// browser build and the Electron renderer have. On the next launch app.js
// offers the snapshot back; a successful Save or a New level discards it. The
// snapshot is the same .usda text a Save would write, so recovery is a normal
// file load. Storage may be unavailable (private windows, quota, headless
// runners): every operation is wrapped so the editor never depends on it.

const DB_NAME = 'ptah';
const STORE = 'recovery';
const KEY = 'current';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function withStore(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB transaction failed')); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('IndexedDB transaction aborted')); };
  }));
}

/**
 * getSnapshot(): { text, filePath }   isDirty(): boolean
 * Returns { schedule, flush, clear, peek, get pending }.
 */
export function createAutosave({ getSnapshot, isDirty, debounceMs = 3000, intervalMs = 60000 }) {
  let debounce = null, interval = null, lastError = null;

  async function flush() {
    clearTimeout(debounce); debounce = null;
    if (!isDirty()) return false;
    try {
      const snap = getSnapshot();
      await withStore('readwrite', st => st.put({ text: snap.text, filePath: snap.filePath || null, savedAt: Date.now() }, KEY));
      lastError = null;
      return true;
    } catch (err) {
      lastError = err;                       // storage problems must never surface as editor errors
      return false;
    }
  }

  function schedule() {
    clearTimeout(debounce);
    debounce = setTimeout(flush, debounceMs);
    if (!interval) interval = setInterval(() => { if (isDirty()) flush(); }, intervalMs);
  }

  async function clear() {
    clearTimeout(debounce); debounce = null;
    try { await withStore('readwrite', st => st.delete(KEY)); } catch (err) { lastError = err; }
  }

  async function peek() {
    try { return (await withStore('readonly', st => st.get(KEY))) || null; } catch (err) { lastError = err; return null; }
  }

  return { schedule, flush, clear, peek, get pending() { return debounce != null; }, get lastError() { return lastError; } };
}
