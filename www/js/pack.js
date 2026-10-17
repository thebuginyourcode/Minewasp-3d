/*
 * Minecraft texture import. Reads textures from the user's own Minecraft Java
 * Edition client .jar or a resource pack .zip, stores them on the device, and
 * exposes them to the model and block builders. Nothing is bundled with the app.
 */

const DB_NAME = 'minewasp';
const STORE = 'pack';
const META_KEY = '__meta';
const TEX_ROOT = 'assets/minecraft/textures/';

const images = new Map();
let meta = null;
let stamp = 0;

export const packInfo = () => meta;
export const packStamp = () => stamp;

/* Returns a canvas for a texture path such as "entity/pig/pig.png", or null. */
export function packImage(path) {
  return images.get(path) || null;
}

export function firstPackImage(paths = []) {
  for (const p of paths) { const c = images.get(p); if (c) return c; }
  return null;
}

/* ---------- IndexedDB ---------- */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function decode(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

/* Loads previously imported textures. Safe to call when nothing was imported. */
export async function initPack() {
  try {
    const db = await openDb();
    const m = await tx(db, 'readonly', (s) => s.get(META_KEY));
    if (!m) return;
    const keys = await tx(db, 'readonly', (s) => s.getAllKeys());
    const blobs = await tx(db, 'readonly', (s) => s.getAll());
    images.clear();
    await Promise.all(keys.map(async (k, i) => {
      if (k === META_KEY) return;
      try { images.set(k, await decode(blobs[i])); } catch { /* skip unreadable image */ }
    }));
    meta = m;
    stamp++;
  } catch (e) {
    console.warn('Texture pack unavailable:', e);
  }
}

export async function clearPack() {
  const db = await openDb();
  await tx(db, 'readwrite', (s) => s.clear());
  images.clear();
  meta = null;
  stamp++;
}

/* ---------- ZIP reading ---------- */

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readCentralDirectory(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a .jar or .zip archive.');
  let count = dv.getUint16(eocd + 10, true);
  let offset = dv.getUint32(eocd + 16, true);
  if (offset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const z64 = Number(dv.getBigUint64(loc + 8, true));
      count = Number(dv.getBigUint64(z64 + 32, true));
      offset = Number(dv.getBigUint64(z64 + 48, true));
    }
  }
  const entries = [];
  const td = new TextDecoder();
  let p = offset;
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    let compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let local = dv.getUint32(p + 42, true);
    const name = td.decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (compSize === 0xffffffff || local === 0xffffffff) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = dv.getUint16(e, true), size = dv.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (dv.getUint32(p + 24, true) === 0xffffffff) q += 8;
          if (compSize === 0xffffffff) { compSize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (local === 0xffffffff) local = Number(dv.getBigUint64(q, true));
        }
        e += 4 + size;
      }
    }
    entries.push({ name, method, compSize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extract(buf, entry) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint16(entry.local + 26, true);
  const e = dv.getUint16(entry.local + 28, true);
  const start = entry.local + 30 + n + e;
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflate(data);
  throw new Error('Unsupported compression in archive.');
}

/*
 * Imports textures from a Minecraft client .jar or a resource pack .zip.
 * `wanted` lists texture paths (relative to assets/minecraft/textures/).
 */
export async function importPack(file, wanted, onProgress) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This device cannot read compressed archives.');
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = readCentralDirectory(buf);
  const want = new Set(wanted);
  const found = [];
  let prefix = null;
  for (const en of entries) {
    const i = en.name.indexOf(TEX_ROOT);
    if (i < 0) continue;
    const rel = en.name.slice(i + TEX_ROOT.length);
    if (want.has(rel)) { found.push([rel, en]); if (prefix === null) prefix = en.name.slice(0, i); }
  }
  if (!found.length) throw new Error('No Minecraft textures were found in this file.');

  let version = null;
  const versionEntry = entries.find((en) => en.name === (prefix || '') + 'version.json' || en.name === 'version.json');
  if (versionEntry) {
    try { version = JSON.parse(new TextDecoder().decode(await extract(buf, versionEntry))).name || null; } catch { /* optional */ }
  }

  const blobs = [];
  for (let i = 0; i < found.length; i++) {
    const [rel, en] = found[i];
    const bytes = await extract(buf, en);
    blobs.push([rel, new Blob([bytes], { type: 'image/png' })]);
    onProgress?.((i + 1) / found.length);
  }

  const decoded = new Map();
  for (const [rel, blob] of blobs) {
    try { decoded.set(rel, await decode(blob)); } catch { /* skip */ }
  }
  if (!decoded.size) throw new Error('The textures in this file could not be read.');

  const m = { name: file.name, version, count: decoded.size, date: Date.now() };
  const db = await openDb();
  await tx(db, 'readwrite', (s) => {
    s.clear();
    for (const [rel, blob] of blobs) if (decoded.has(rel)) s.put(blob, rel);
    s.put(m, META_KEY);
  });
  images.clear();
  for (const [k, v] of decoded) images.set(k, v);
  meta = m;
  stamp++;
  return m;
}
