/* Character skins: the user's saved skin library, slim-arm detection and username lookup. */
import { uid } from './util.js';
import * as native from './native.js';

const KEY = 'mw.skins';
const MAX_SKINS = 40;

export function listSkins() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function store(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SKINS))); } catch { /* quota exceeded */ }
}

export function saveSkin({ name, data, slim }) {
  const list = listSkins().filter((s) => s.data !== data);
  const skin = { id: uid(), name, data, slim: !!slim };
  list.unshift(skin);
  store(list);
  return skin;
}

export function removeSkin(id) {
  store(listSkins().filter((s) => s.id !== id));
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Couldn’t read that image.'));
    img.src = src;
  });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function isSkinImage(img) {
  return img.width >= 64 && (img.height === img.width || img.height === img.width / 2);
}

/*
 * Slim (3px) arm skins leave the last two columns of the right arm's
 * front/back strip (x 54-55, y 20-31 at 64px) transparent.
 */
export function detectSlim(img) {
  if (img.height !== img.width) return false;
  const k = img.width / 64;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(54 * k, 20 * k, 2 * k, 12 * k).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
  return true;
}

/* Renders a skin's face (head front plus hat layer) as a small preview image. */
export function skinFace(img, size = 96) {
  const k = img.width / 64;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 8 * k, 8 * k, 8 * k, 8 * k, size * 0.1, size * 0.1, size * 0.8, size * 0.8);
  ctx.drawImage(img, 40 * k, 8 * k, 8 * k, 8 * k, size * 0.06, size * 0.06, size * 0.88, size * 0.88);
  return c.toDataURL('image/png');
}

async function getJson(url) {
  const blob = await native.download(url);
  const text = await blob.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/* Looks up a Minecraft Java player's current skin through Mojang's public profile API. */
export async function fetchSkinByUsername(name) {
  const clean = name.trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(clean)) throw new Error('Minecraft usernames use 1–16 letters, numbers or underscores.');
  // A missing player can surface as an empty body or a failed request, depending on the platform.
  const profile = await getJson(`https://api.mojang.com/users/profiles/minecraft/${clean}`).catch(() => null);
  if (!profile?.id) throw new Error(`Couldn’t find a Minecraft player named “${clean}”. Check the spelling and your connection.`);
  const session = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${profile.id}`);
  const prop = session?.properties?.find((p) => p.name === 'textures');
  if (!prop) throw new Error('That player’s skin couldn’t be loaded.');
  const textures = JSON.parse(atob(prop.value)).textures || {};
  if (!textures.SKIN?.url) throw new Error(`${profile.name} uses the default skin.`);
  const url = textures.SKIN.url.replace(/^http:/, 'https:');
  const data = await blobToDataUrl(await native.download(url));
  return { name: profile.name, data, slim: textures.SKIN.metadata?.model === 'slim' };
}
