// IndexedDB-backed photo gallery.
// 记录格式：{ id, ts, blob, presetId?, borderId?, developMs? }
const DB = 'dazz-cam';
const STORE = 'photos';

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('ts', 'ts');
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbp;
}

export async function add(blob, meta = {}) {
  const db = await open();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = { id, ts: Date.now(), blob, ...meta };
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
        items.push(c.value);
        c.continue();
      } else {
        resolve(items);
      }
    };
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

export const Gallery = { open, add, list, remove, count, trim, latest };
