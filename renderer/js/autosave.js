// autosave.js — crash recovery snapshots.
//
// A few seconds after any edit (and at least once a minute while the level is
// dirty) the current export text is written to IndexedDB, which both the
// browser build and the Electron renderer have. On the next launch app.js
// offers the snapshot back; a successful Save, an Open or a New level discards
// it. The snapshot is the same .usda text a Save would write, so recovery is a
// normal file load. Storage may be unavailable (private windows, quota,
// headless runners): every operation is wrapped so the editor never depends
// on it.
//
// Snapshots are keyed per editor session (one id per browser tab, kept in
// sessionStorage so a reload of the same tab finds its own work). Students
// open two tabs of the web build; with one shared key each tab overwrote the
// other's snapshot. On launch a tab offers its own snapshot first, otherwise
// the newest snapshot whose tab is no longer open. Open tabs answer a
// BroadcastChannel roll call, so a live tab's work is never offered to
// another tab.

const DB_NAME = 'ptah';
const STORE = 'recovery';
const LEGACY_KEY = 'current';                 // before 0.8.0: one shared snapshot
const PREFIX = 'session:';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;     // snapshots older than this are pruned on launch
const CHANNEL = 'ptah-autosave';

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

function newId() {
  const a = new Uint32Array(2);
  (globalThis.crypto || { getRandomValues: (x) => { for (let i = 0; i < x.length; i++) x[i] = Math.random() * 2 ** 32 >>> 0; return x; } }).getRandomValues(a);
  return a[0].toString(36) + a[1].toString(36);
}

/** This tab's session id: stable across reloads of the tab, new for every tab or app launch. */
export function sessionId() {
  try {
    let id = sessionStorage.getItem('ptah.session');
    if (!id) { id = newId(); sessionStorage.setItem('ptah.session', id); }
    return id;
  } catch { return newId(); }                 // no sessionStorage: a fresh id per load is still correct, just not reload-stable
}

/**
 * getSnapshot(): { text, filePath }   isDirty(): boolean
 * Returns { schedule, flush, clear, peek, discard, adopt, get pending }.
 */
export function createAutosave({ getSnapshot, isDirty, debounceMs = 3000, intervalMs = 60000, session = sessionId(), rollCallMs = 250 }) {
  let debounce = null, interval = null, lastError = null;
  let ownKey = PREFIX + session;
  const tab = newId();                        // this page load; never shared, unlike sessionStorage

  // Answer other tabs' roll calls so they never offer this tab's snapshot.
  let channel = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e) => { if (e.data && e.data.type === 'who') channel.postMessage({ type: 'here', session, tab }); };
  } catch { /* no BroadcastChannel: every other snapshot is treated as orphaned */ }

  // Sessions of the OTHER open tabs. `dupe` is true when one of them has this
  // tab's session id: "Duplicate tab" copies sessionStorage.
  function liveSessions() {
    if (!channel) return Promise.resolve({ seen: new Set(), dupe: false });
    return new Promise((resolve) => {
      const seen = new Set();
      let dupe = false, probe;
      try { probe = new BroadcastChannel(CHANNEL); } catch { resolve({ seen, dupe }); return; }
      probe.onmessage = (e) => {
        if (!e.data || e.data.type !== 'here' || e.data.tab === tab) return;
        seen.add(e.data.session);
        if (e.data.session === session) dupe = true;
      };
      probe.postMessage({ type: 'who' });
      setTimeout(() => { probe.close(); resolve({ seen, dupe }); }, rollCallMs);
    });
  }

  async function flush() {
    clearTimeout(debounce); debounce = null;
    if (!isDirty()) return false;
    try {
      const snap = getSnapshot();
      await withStore('readwrite', st => st.put({ text: snap.text, filePath: snap.filePath || null, savedAt: Date.now() }, ownKey));
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

  /** Discard a snapshot: this tab's by default, or the one `peek` offered. */
  async function discard(key = ownKey) {
    if (key === ownKey) { clearTimeout(debounce); debounce = null; }
    try { await withStore('readwrite', st => st.delete(key)); } catch (err) { lastError = err; }
  }
  const clear = () => discard(ownKey);

  async function readAll() {
    return withStore('readonly', st => {
      const out = [];
      const req = st.openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (c.value && typeof c.value.text === 'string') out.push({ key: String(c.key), ...c.value });
        c.continue();
      };
      return { get result() { return out; } };
    });
  }

  /**
   * The snapshot to offer on launch, or null: this tab's own snapshot, else
   * the newest one whose tab is gone (including a shared snapshot from before 0.8.0).
   * Carries `key` for discard/adopt.
   */
  async function peek() {
    try {
      const { seen: live, dupe } = await liveSessions();
      if (dupe) {                             // a duplicated tab: take a fresh identity before touching storage
        session = newId();
        ownKey = PREFIX + session;
        try { sessionStorage.setItem('ptah.session', session); } catch { /* keep the in-memory id */ }
      }
      const all = await readAll();
      const now = Date.now();
      for (const s of all) if (now - (s.savedAt || 0) > MAX_AGE_MS) discard(s.key);
      const fresh = all.filter(s => now - (s.savedAt || 0) <= MAX_AGE_MS);
      const own = fresh.find(s => s.key === ownKey);
      if (own) return own;
      const orphans = fresh
        .filter(s => s.key === LEGACY_KEY || (s.key.startsWith(PREFIX) && !live.has(s.key.slice(PREFIX.length))))
        .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      return orphans[0] || null;
    } catch (err) { lastError = err; return null; }
  }

  /** Take over an orphaned snapshot after restoring it: it now lives under this tab's key. */
  async function adopt(key) {
    if (key && key !== ownKey) await discard(key);
  }

  return {
    schedule, flush, clear, discard, peek, adopt,
    get key() { return ownKey; },
    get pending() { return debounce != null; },
    get lastError() { return lastError; }
  };
}
