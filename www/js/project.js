import { uid, lerp, lerpHex, ease } from './util.js';
import { getModelDef, HUMAN_SKINS, catalogName } from './models.js';

export const FORMAT_VERSION = 1;

const TRANSFORM = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'];
const LOOK = ['alpha', 'color', 'bright', 'vis'];

export const VALUE_DEFAULTS = {
  px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
  alpha: 1, color: '#ffffff', bright: 0, vis: 1, bend: 0,
  fov: 60, lcolor: '#ffffff', intensity: 1, range: 160, angle: 40, soft: 0.4,
};

const STEP_KEYS = new Set(['vis']);
const COLOR_KEYS = new Set(['color', 'lcolor']);

export const DRAWABLE = new Set(['model', 'bone', 'block', 'item', 'scenery', 'shape']);
export const isLight = (tl) => tl.type === 'pointlight' || tl.type === 'spotlight';

export function hasBend(tl, project) {
  if (tl.type !== 'bone') return false;
  const owner = project.timelines.find((t) => t.id === tl.owner);
  if (!owner) return false;
  const bone = getModelDef(owner)?.bones.find((b) => b.name === tl.bone);
  return !!bone?.bend;
}

export function valueKeys(tl, project) {
  const keys = [...TRANSFORM];
  if (DRAWABLE.has(tl.type)) keys.push(...LOOK);
  if (tl.type === 'bone' && project && hasBend(tl, project)) keys.push('bend');
  if (tl.type === 'camera') keys.push('fov');
  if (isLight(tl)) keys.push('lcolor', 'intensity', 'range');
  if (tl.type === 'spotlight') keys.push('angle', 'soft');
  return keys;
}

export function defaults(tl, project) {
  const out = {};
  for (const k of valueKeys(tl, project)) out[k] = VALUE_DEFAULTS[k];
  return out;
}

/* ---------- Project ---------- */

export function newProject() {
  return {
    version: FORMAT_VERSION,
    name: 'Untitled project',
    fps: 24,
    length: 120,
    settings: {
      sky: '#8fb8ef',
      fog: true,
      fogDistance: 1400,
      ground: true,
      groundBlock: 'grass',
      sunYaw: 35,
      sunPitch: 55,
      sunIntensity: 0.9,
      sunColor: '#fff6e8',
      ambient: 0.45,
      ambientColor: '#c9d8ff',
      shadows: true,
      defaultTransition: 'linear',
    },
    timelines: [],
  };
}

export function findTl(project, id) {
  return project.timelines.find((t) => t.id === id) || null;
}

export function childrenOf(project, id) {
  return project.timelines.filter((t) => (t.parent || null) === (id || null));
}

export function isDescendant(project, id, ancestorId) {
  let t = findTl(project, id);
  while (t) {
    if (t.parent === ancestorId) return true;
    t = findTl(project, t.parent);
  }
  return false;
}

/* Root timeline of an object (bones resolve to their owner). */
export function rootOf(project, tl) {
  if (!tl) return null;
  return tl.type === 'bone' ? findTl(project, tl.owner) : tl;
}

/* Sort so parents always precede children. */
export function topoSorted(project) {
  const out = [];
  const seen = new Set();
  const visit = (parentId) => {
    for (const t of project.timelines) {
      if ((t.parent || null) === parentId && !seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
        visit(t.id);
      }
    }
  };
  visit(null);
  for (const t of project.timelines) if (!seen.has(t.id)) { t.parent = null; out.push(t); }
  return out;
}

export function flattenRows(project) {
  const rows = [];
  const walk = (parentId, depth) => {
    for (const t of project.timelines) {
      if ((t.parent || null) !== parentId) continue;
      const kids = project.timelines.some((c) => c.parent === t.id);
      rows.push({ tl: t, depth, hasChildren: kids });
      if (kids && t.expanded) walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

function uniqueName(project, base) {
  const names = new Set(project.timelines.map((t) => t.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function createTimeline(project, entry, opts = {}) {
  const tl = {
    id: uid(),
    name: '',
    type: entry.type,
    ref: entry.ref,
    parent: opts.parent || null,
    expanded: false,
    hidden: false,
    keys: [],
  };
  if (entry.variant) tl.variant = entry.variant;
  if (entry.type === 'model' && entry.ref === 'human') {
    tl.variant = entry.variant || 'classic';
    tl.slim = !!HUMAN_SKINS[tl.variant]?.slim;
  }
  if (entry.type === 'shape') tl.tex = '';
  if (entry.segmented) tl.segmented = true;
  Object.assign(tl, opts.props || {});
  tl.name = uniqueName(project, entry.name || catalogName(tl));
  project.timelines.push(tl);

  const start = { ...defaults(tl, project), ...(opts.values || {}) };
  if (entry.type === 'pointlight' || entry.type === 'spotlight') {
    start.lcolor = '#ffd9a0';
    start.py = opts.values?.py ?? 40;
  }
  if (entry.type === 'block' && entry.ref === 'glowstone') start.bright = 0.6;
  tl.keys.push({ f: 0, v: start, t: project.settings.defaultTransition || 'linear' });

  if (entry.type === 'model') {
    const def = getModelDef(tl);
    const boneIds = {};
    for (const b of def.bones) {
      const bt = {
        id: uid(), name: b.label, type: 'bone', owner: tl.id, bone: b.name,
        parent: b.parent ? boneIds[b.parent] : tl.id, expanded: false, hidden: false, keys: [],
      };
      boneIds[b.name] = bt.id;
      project.timelines.push(bt);
    }
  }
  return tl;
}

export function deleteTimeline(project, id) {
  const tl = findTl(project, id);
  if (!tl || tl.type === 'bone') return;
  const doomed = new Set([id]);
  for (const t of project.timelines) if (t.owner === id) doomed.add(t.id);
  for (const t of project.timelines) {
    if (!doomed.has(t.id) && doomed.has(t.parent)) t.parent = null;
  }
  project.timelines = project.timelines.filter((t) => !doomed.has(t.id));
}

export function duplicateTimeline(project, id) {
  const tl = findTl(project, id);
  if (!tl || tl.type === 'bone') return null;
  const map = new Map();
  const group = [tl, ...project.timelines.filter((t) => t.owner === id)];
  for (const t of group) map.set(t.id, uid());
  const copies = group.map((t) => {
    const c = JSON.parse(JSON.stringify(t));
    c.id = map.get(t.id);
    if (c.owner) c.owner = map.get(c.owner);
    if (map.has(c.parent)) c.parent = map.get(c.parent);
    return c;
  });
  copies[0].name = uniqueName(project, tl.name);
  const idx = project.timelines.indexOf(tl);
  const ownedEnd = idx + 1;
  project.timelines.splice(ownedEnd, 0, ...copies);
  return copies[0];
}

/* ---------- Keyframes ---------- */

function search(keys, f) {
  let lo = 0, hi = keys.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].f <= f) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function evaluate(tl, frame, project) {
  const d = defaults(tl, project);
  const keys = tl.keys;
  if (!keys.length) return d;
  const i = search(keys, frame);
  if (i < 0) return Object.assign(d, keys[0].v);
  const k0 = keys[i];
  const a = Object.assign({}, d, k0.v);
  const k1 = keys[i + 1];
  if (!k1 || frame <= k0.f) return a;
  const tr = k0.t || 'linear';
  if (tr === 'instant') return a;
  const b = Object.assign({}, d, k1.v);
  const t = ease(tr, (frame - k0.f) / (k1.f - k0.f));
  for (const k in a) {
    if (STEP_KEYS.has(k)) continue;
    if (COLOR_KEYS.has(k)) a[k] = lerpHex(a[k], b[k], Math.min(1, Math.max(0, t)));
    else a[k] = lerp(a[k], b[k], t);
  }
  return a;
}

export function keyAt(tl, frame) {
  return tl.keys.find((k) => k.f === frame) || null;
}

export function sortKeys(tl) {
  tl.keys.sort((a, b) => a.f - b.f);
}

export function ensureKey(tl, frame, project) {
  let k = keyAt(tl, frame);
  if (!k) {
    const prev = tl.keys[search(tl.keys, frame)];
    k = { f: frame, v: evaluate(tl, frame, project), t: prev?.t || project.settings.defaultTransition || 'linear' };
    tl.keys.push(k);
    sortKeys(tl);
  }
  return k;
}

export function setValues(tl, frame, values, project) {
  const k = ensureKey(tl, frame, project);
  Object.assign(k.v, values);
  return k;
}

export function lastKeyFrame(project) {
  let m = 0;
  for (const t of project.timelines) for (const k of t.keys) if (k.f > m) m = k.f;
  return m;
}

export function projectEnd(project) {
  return Math.max(project.length, lastKeyFrame(project));
}

/* ---------- Serialization ---------- */

export function serialize(project) {
  return JSON.stringify(project);
}

export function deserialize(text) {
  const p = JSON.parse(text);
  if (!p || !Array.isArray(p.timelines)) throw new Error('Not a Minewasp project file.');
  const base = newProject();
  p.settings = Object.assign(base.settings, p.settings || {});
  p.fps = p.fps || 24;
  p.length = p.length || 120;
  p.name = p.name || 'Untitled project';
  for (const t of p.timelines) { t.keys = t.keys || []; sortKeys(t); }
  return p;
}
