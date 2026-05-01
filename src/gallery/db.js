// IndexedDB-backed photo gallery.
// 记录格式：{ id, ts, blob, presetId?, borderId?, developMs?, albumLabel }
const DB = 'dazz-cam';
const STORE = 'photos';
const DB_VERSION = 2;

export const DEFAULT_LABEL = 'ALL';

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;
      let store;
      if (!db.objectStoreNames.contains(STORE)) {
        store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('ts', 'ts');
      } else {
        store = tx.objectStore(STORE);
      }
      // v2: 老记录补默认 albumLabel，并建立索引。
      // 顺序：先迭代回填，再 createIndex —— 同一升级事务内同步链式调用合法。
      if (!store.indexNames.contains('albumLabel')) {
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = (ev) => {
          const c = ev.target.result;
          if (c) {
            const v = c.value;
            if (!v.albumLabel) {
              v.albumLabel = DEFAULT_LABEL;
              c.update(v);
            }
            c.continue();
          } else {
            // 游标走完，在升级事务结束前建索引
            if (!store.indexNames.contains('albumLabel')) {
              store.createIndex('albumLabel', 'albumLabel');
            }
          }
        };
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
  });
  return dbp;
}

export async function add(blob, meta = {}) {
  const db = await open();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const albumLabel = sanitizeLabel(meta.albumLabel) || DEFAULT_LABEL;
  const record = { id, ts: Date.now(), blob, ...meta, albumLabel };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function list() {
  const db = await open();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('ts');
    const items = [];
    idx.openCursor(null, 'prev').onsuccess = (e) => {
      const c = e.target.result;
      if (c) {
        // 防御性补默认值（理论上 v2 已回填）
        const v = c.value;
        if (!v.albumLabel) v.albumLabel = DEFAULT_LABEL;
        items.push(v);
        c.continue();
      } else {
        resolve(items);
      }
    };
  });
}

export async function listByLabel(label) {
  const items = await list();
  const target = sanitizeLabel(label) || DEFAULT_LABEL;
  return items.filter((it) => (it.albumLabel || DEFAULT_LABEL) === target);
}

export async function listLabels() {
  const items = await list();
  const set = new Set([DEFAULT_LABEL]);
  for (const it of items) {
    const l = it.albumLabel || DEFAULT_LABEL;
    if (l) set.add(l);
  }
  // ALL 永远在第一位，其余按字母序
  const rest = [...set].filter((l) => l !== DEFAULT_LABEL).sort((a, b) => a.localeCompare(b));
  return [DEFAULT_LABEL, ...rest];
}

export async function setLabel(id, label) {
  const db = await open();
  const next = sanitizeLabel(label) || DEFAULT_LABEL;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const rec = getReq.result;
      if (!rec) {
        resolve(null);
        return;
      }
      rec.albumLabel = next;
      store.put(rec);
    };
    tx.oncomplete = () => resolve(next);
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function removeLabel(label) {
  const target = sanitizeLabel(label);
  if (!target || target === DEFAULT_LABEL) return 0;
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let count = 0;
    store.openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (c) {
        const v = c.value;
        if ((v.albumLabel || DEFAULT_LABEL) === target) {
          v.albumLabel = DEFAULT_LABEL;
          c.update(v);
          count += 1;
        }
        c.continue();
      }
    };
    tx.oncomplete = () => resolve(count);
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function remove(id) {
  const db = await open();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
  });
}

export async function count() {
  const db = await open();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    tx.objectStore(STORE).count().onsuccess = (e) => resolve(e.target.result);
  });
}

export async function trim(maxN) {
  const items = await list();
  if (items.length <= maxN) return 0;
  const db = await open();
  const dropped = items.slice(maxN);
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const s = tx.objectStore(STORE);
    for (const it of dropped) s.delete(it.id);
    tx.oncomplete = () => resolve(dropped.length);
  });
}

export async function latest() {
  const items = await list();
  return items[0] || null;
}

export function sanitizeLabel(input) {
  if (input == null) return '';
  const s = String(input).trim();
  return s;
}

export function isValidNewLabel(input) {
  const s = sanitizeLabel(input);
  if (!s) return false;
  if (s.length > 8) return false;
  if (s.toUpperCase() === DEFAULT_LABEL) return false;
  return true;
}

export const Gallery = {
  open,
  add,
  list,
  listByLabel,
  listLabels,
  setLabel,
  removeLabel,
  remove,
  count,
  trim,
  latest,
  DEFAULT_LABEL,
  isValidNewLabel,
  sanitizeLabel,
};
