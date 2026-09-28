// autosave.js — crash recovery snapshots.
//
// A few seconds after any edit (and at least once a minute while the level is
// dirty) the current export text is written to IndexedDB, which both the
// browser build and the Electron renderer have. On the next launch app.js
// offers the snapshot back; a successful Save, an Open or a New level discards
// it (a Save the browser only downloaded keeps it, labelled, until downloads are
// known to arrive). The snapshot is the same .usda text a Save would write, so recovery is a
// normal file load. Storage may be unavailable (private windows, quota,
// headless runners): every operation is wrapped so the editor never depends
// on it.
//
// Snapshots are keyed per editor session (one id per browser tab, kept in
// sessionStorage so a reload of the same tab finds its own work). Students
// open two tabs of the web build; with one shared key each tab overwrote the
// other's snapshot. On launch a tab offers its own snapshot first, otherwise
// the newest snapshot whose tab is no longer open. Open tabs answer a
// BroadcastChannel roll call, and hold a Web Lock named after their session
// for as long as they are open (a tab too busy to answer within the roll
// call, or frozen in the background, still holds it), so a live tab's work
// is never offered to another tab.
//
// A snapshot offered in the recovery bar is first moved to a held key of its
// own (`session:<id>:offered:<n>`). The bar does not block the editor, and
// work started behind it autosaves under the tab's key, which would otherwise
// overwrite the very snapshot on offer.

const DB_NAME = 'ptah';
const STORE = 'recovery';
const LEGACY_KEY = 'current';                 // before 0.8.0: one shared snapshot
const PREFIX = 'session:';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;     // snapshots older than this are pruned on launch
const CHANNEL = 'ptah-autosave';
const LOCK = 'ptah-session:';                 // + session id: held by the tab of that session while it is open

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

/** The session a snapshot key belongs to ('session:<id>' or 'session:<id>:offered:<n>'), or null. */
const sessionOf = (key) => (key.startsWith(PREFIX) ? key.slice(PREFIX.length).split(':')[0] : null);

/**
 * getSnapshot(): { text, filePath }   isDirty(): boolean
 * onError(err): called once, on the first storage failure, so the editor can say autosave is off.
 * Returns { schedule, flush, keep, clear, peek, discard, adopt, get key, get pending, get lastError }.
 */
export function createAutosave({ getSnapshot, isDirty, onError = () => {}, debounceMs = 3000, intervalMs = 60000, session = sessionId(), rollCallMs = 250 }) {
  let debounce = null, interval = null, lastError = null, reported = false;
  let linked = null;                          // a restored snapshot not yet copied under ownKey: it is this level's too
  let ownKey = PREFIX + session;
  const fail = (err) => {
    lastError = err;                         // storage problems must never surface as editor errors
    if (!reported) { reported = true; try { onError(err); } catch { /* never throw from here */ } }
  };
  const tab = newId();                        // this page load; never shared, unlike sessionStorage

  // Hold this session's lock until the tab closes (the browser releases it then, even on a crash).
  // A tab whose main thread is busy cannot answer the roll call below, but its lock stays held.
  // releaseLock() gives it up: it cancels a request still waiting (the lock is another tab's), and ends
  // a granted one (aborting the signal alone does not release a lock once its callback runs).
  let releaseLock = () => {};
  const holdLock = () => {
    try {
      const abort = new AbortController();
      let release;
      const held = new Promise(r => { release = r; });
      navigator.locks.request(LOCK + session, { signal: abort.signal }, () => held).catch(() => {});
      releaseLock = () => { abort.abort(); release(); };
    } catch { releaseLock = () => {}; /* no Web Locks: the roll call alone decides */ }
  };
  holdLock();
  const lockedSessions = async () => {
    try {
      const { held = [] } = await navigator.locks.query();
      return new Set(held.map(l => l.name).filter(n => n && n.startsWith(LOCK)).map(n => n.slice(LOCK.length)));
    } catch { return new Set(); }
  };
  // keepLock: this tab still has the old session's snapshot on offer under the old key, so it keeps
  // that session's lock too (until the tab closes): no other tab offers the snapshot meanwhile.
  const newSession = ({ keepLock = false } = {}) => {
    if (!keepLock) releaseLock();
    session = newId();
    ownKey = PREFIX + session;
    try { sessionStorage.setItem('ptah.session', session); } catch { /* keep the in-memory id */ }
    holdLock();
  };

  // Answer other tabs' roll calls so they never offer this tab's snapshot.
  let channel = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e) => { if (e.data && e.data.type === 'who') channel.postMessage({ type: 'here', session, tab }); };
  } catch { /* no BroadcastChannel: every other snapshot is treated as orphaned */ }

  // Sessions of the OTHER open tabs. `dupe` is true when one of them has this
  // tab's session id: "Duplicate tab" copies sessionStorage. (Only a roll call
  // answer says so: a reload's own lock may be held a moment longer by the page
  // being unloaded, which is this tab, not a duplicate.)
  async function liveSessions() {
    const [calls, locked] = await Promise.all([rollCall(), lockedSessions()]);
    for (const s of locked) if (s !== session) calls.seen.add(s);
    return calls;
  }
  function rollCall() {
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

  async function write(extra) {
    try {
      const snap = getSnapshot();
      await withStore('readwrite', st => st.put({ text: snap.text, filePath: snap.filePath || null, savedAt: Date.now(), ...extra }, ownKey));
      lastError = null;
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }
  async function flush() {
    clearTimeout(debounce); debounce = null;
    if (!isDirty()) return false;
    return write();
  }
  /** Snapshot the level even though it is clean, with extra fields: a Save the browser
   *  only downloaded is kept as `{ downloaded: name }` until the download is known to land. */
  async function keep(extra) {
    clearTimeout(debounce); debounce = null;
    return write(extra);
  }

  function schedule() {
    clearTimeout(debounce);
    debounce = setTimeout(flush, debounceMs);
    if (!interval) interval = setInterval(() => { if (isDirty()) flush(); }, intervalMs);
  }

  /** Discard a snapshot: this tab's by default, or the one `peek` offered. */
  async function discard(key = ownKey) {
    if (key === ownKey) { clearTimeout(debounce); debounce = null; }
    try { await withStore('readwrite', st => st.delete(key)); return true; } catch (err) { fail(err); return false; }
  }
  /** Discard the current level's snapshot: this tab's, and a restored one still under its offered key. */
  async function clear() {
    const had = linked;
    await discard(ownKey);
    if (had && (await discard(had)) && linked === had) linked = null;
  }

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
   * Carries `key` for discard/adopt. This tab's own snapshot comes back under a
   * held key, so edits made while it is on offer cannot overwrite it.
   */
  async function peek() {
    try {
      const { seen: live, dupe } = await liveSessions();
      if (dupe) newSession();                  // a duplicated tab: take a fresh identity before touching storage
      const all = await readAll();
      const now = Date.now();
      for (const s of all) if (now - (s.savedAt || 0) > MAX_AGE_MS) discard(s.key);
      const fresh = all.filter(s => now - (s.savedAt || 0) <= MAX_AGE_MS);
      const newest = (list) => list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0] || null;
      const own = fresh.find(s => s.key === ownKey);
      if (own) {
        const held = ownKey + ':offered:' + newId();
        try {
          await withStore('readwrite', st => { st.put({ text: own.text, filePath: own.filePath, savedAt: own.savedAt, ...(own.downloaded ? { downloaded: own.downloaded } : {}) }, held); st.delete(ownKey); });
          return { ...own, key: held };
        } catch (err) {
          // The move failed (a quota: it briefly doubles the snapshot), so the snapshot on offer is
          // still under this tab's key, where work started behind the bar would autosave over it and
          // Dismiss would then delete that work. Leave it there, under the old key, and continue as a
          // new session. Autosave itself works: this is not the "unavailable" report.
          lastError = err;
          newSession({ keepLock: true });
          return own;
        }
      }
      // one already on offer when this tab was reloaded
      const mine = newest(fresh.filter(s => s.key.startsWith(ownKey + ':')));
      if (mine) return mine;
      return newest(fresh.filter(s => s.key === LEGACY_KEY || (sessionOf(s.key) != null && !live.has(sessionOf(s.key)))));
    } catch (err) { fail(err); return null; }
  }

  /** Take over a snapshot after restoring it (the level must be dirty): copy it under this
   *  tab's key, then drop the offered one. If the copy fails the offered key stays, as the
   *  only copy, and is linked to the level so a Save, New or Open still clears it. */
  async function adopt(key) {
    if (!key || key === ownKey) return;
    linked = key;
    if ((await flush()) && (await discard(key)) && linked === key) linked = null;
  }

  return {
    schedule, flush, keep, clear, discard, peek, adopt,
    get key() { return ownKey; },
    get pending() { return debounce != null; },
    get lastError() { return lastError; }
  };
}
