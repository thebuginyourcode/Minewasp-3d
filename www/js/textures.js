import { mulberry32, clamp } from './util.js';

/* ---------- Pixel painter ---------- */

function toRgb(c) {
  if (Array.isArray(c)) return c;
  const n = parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(c, f) {
  const [r, g, b] = toRgb(c);
  const t = (v) => clamp(Math.round(v * f), 0, 255).toString(16).padStart(2, '0');
  return '#' + t(r) + t(g) + t(b);
}

export class Painter {
  constructor(w, h, seed = 1) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.img = this.ctx.createImageData(w, h);
    this.d = this.img.data;
    this.rand = mulberry32(seed);
  }

  px(x, y, color, a = 255, noise = 0) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b] = toRgb(color);
    const f = noise ? 1 + (this.rand() * 2 - 1) * noise : 1;
    const i = (y * this.w + x) * 4;
    this.d[i] = clamp(r * f, 0, 255);
    this.d[i + 1] = clamp(g * f, 0, 255);
    this.d[i + 2] = clamp(b * f, 0, 255);
    this.d[i + 3] = a;
  }

  rect(x, y, w, h, color, noise = 0, a = 255) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, color, a, noise);
  }

  clear(x, y, w, h) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const xx = x + i, yy = y + j;
      if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) continue;
      this.d[(yy * this.w + xx) * 4 + 3] = 0;
    }
  }

  line(x0, y0, x1, y1, color, noise = 0) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, color, 255, noise);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  points(list, color, noise = 0) {
    for (const [x, y] of list) this.px(x, y, color, 255, noise);
  }

  alphaAt(x, y) {
    return this.d[(y * this.w + x) * 4 + 3];
  }

  finish() {
    this.ctx.putImageData(this.img, 0, 0);
    return this.canvas;
  }
}

/* Standard box UV layout (width w, height h, depth d at u,v). */
export function boxUV(u, v, w, h, d) {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + 2 * d + w, v + d, w, h],
  };
}

/* ---------- Humanoid skins (standard 64x64 layout) ---------- */

export const HUMAN_SKINS = {
  classic: {
    name: 'Classic', skin: '#c48a64', hair: '#3a2414', iris: '#4152c4', white: '#f2f2f2', mouth: '#8a5238',
    shirt: '#1d9aa0', pants: '#33358f', shoes: '#4a4a4a', sleeve: 5,
  },
  slim: {
    name: 'Slim', skin: '#efc39f', hair: '#c9682a', iris: '#3c8f45', white: '#f2f2f2', mouth: '#b46e5a',
    shirt: '#5e9e3a', pants: '#5d4128', shoes: '#383838', sleeve: 4, longHair: true, slim: true,
  },
  zombie: {
    name: 'Zombie', skin: '#4e8b3c', hair: '#36622a', iris: '#111111', white: '#111111', mouth: '#2d4f22',
    shirt: '#1f8a8a', pants: '#3a3a9a', shoes: '#3a3a9a', sleeve: 0, torn: true,
  },
  knight: {
    name: 'Knight', skin: '#c48a64', hair: '#5a3a22', iris: '#4a4a4a', white: '#f2f2f2', mouth: '#8a5238',
    shirt: '#9a9a9a', pants: '#7c7c7c', shoes: '#4c4c4c', sleeve: 12, helmet: '#bdbdbd', tabard: '#a1262c',
  },
  explorer: {
    name: 'Explorer', skin: '#a8714f', hair: '#1f1611', iris: '#3a2a1a', white: '#f2f2f2', mouth: '#6c3e2a',
    shirt: '#b08b55', pants: '#5b5b3a', shoes: '#3a2a1e', sleeve: 7, longHair: false, hat: '#7a5a34',
  },
  scientist: {
    name: 'Scientist', skin: '#e2b493', hair: '#8c8c8c', iris: '#4a6a8a', white: '#f2f2f2', mouth: '#a8705a',
    shirt: '#ececec', pants: '#2f2f3a', shoes: '#222222', sleeve: 11, coat: true,
  },
};

export function paintHumanSkin(variant) {
  const c = HUMAN_SKINS[variant] || HUMAN_SKINS.classic;
  const p = new Painter(64, 64, 7 + variant.length * 13);
  const aw = c.slim ? 3 : 4;
  const n = 0.04;

  // Head
  const H = boxUV(0, 0, 8, 8, 8);
  for (const f of Object.values(H)) p.rect(...f, c.skin, n);
  p.rect(...H.top, c.hair, 0.08);
  p.rect(H.back[0], H.back[1], 8, c.longHair ? 8 : 6, c.hair, 0.08);
  for (const side of ['right', 'left']) {
    const [x, y] = H[side];
    p.rect(x, y, 8, 2, c.hair, 0.08);
    const bx = side === 'right' ? x : x + 5;
    p.rect(bx, y + 2, 3, c.longHair ? 6 : 3, c.hair, 0.08);
  }
  {
    const [x, y] = H.front;
    p.rect(x, y, 8, 2, c.hair, 0.08);
    p.px(x, y + 2, c.hair); p.px(x + 7, y + 2, c.hair);
    if (c.longHair) { p.rect(x, y + 2, 1, 4, c.hair, 0.08); p.rect(x + 7, y + 2, 1, 4, c.hair, 0.08); }
    p.px(x + 1, y + 4, c.white); p.px(x + 2, y + 4, c.iris);
    p.px(x + 5, y + 4, c.iris); p.px(x + 6, y + 4, c.white);
    p.rect(x + 3, y + 5, 2, 1, shade(c.skin, 0.86));
    p.rect(x + 3, y + 6, 2, 1, c.mouth);
    if (variant === 'zombie') { p.rect(x + 2, y + 6, 4, 1, c.mouth); p.px(x + 1, y + 3, shade(c.skin, 0.8)); }
  }

  // Body
  const B = boxUV(16, 16, 8, 12, 4);
  for (const f of Object.values(B)) p.rect(...f, c.shirt, n);
  {
    const [x, y] = B.front;
    p.rect(x + 3, y, 2, 1, c.skin);
    if (c.coat) { p.rect(x + 3, y + 1, 2, 11, '#4e7ab8', 0.05); p.rect(x + 3, y, 2, 1, c.skin); }
    if (c.tabard) { p.rect(x + 2, y + 1, 4, 11, c.tabard, 0.05); p.rect(x + 3, y + 4, 2, 3, '#e3c04a'); }
    if (variant === 'explorer') { p.rect(x, y + 9, 8, 1, '#4a3420'); p.px(x + 4, y + 9, '#d9b44a'); }
    if (c.torn) { p.clear(x + 1, y + 11, 1, 1); p.clear(x + 6, y + 10, 1, 2); }
  }
  for (const f of [B.right, B.left, B.back]) p.rect(f[0], f[1] + 9, f[2], 1, shade(c.shirt, 0.85));

  // Arms
  const arms = [boxUV(40, 16, aw, 12, 4), boxUV(32, 48, aw, 12, 4)];
  for (const A of arms) {
    for (const k of ['right', 'front', 'left', 'back']) {
      const [x, y, w] = A[k];
      p.rect(x, y, w, 12, c.skin, n);
      if (c.sleeve) p.rect(x, y, w, c.sleeve, c.shirt, n);
      if (c.sleeve === 12 && variant === 'knight') p.rect(x, y + 10, w, 2, '#6e6e6e', 0.06);
      if (c.sleeve && c.sleeve < 12) p.rect(x, y + c.sleeve - 1, w, 1, shade(c.shirt, 0.82));
    }
    p.rect(...A.top, c.sleeve ? c.shirt : c.skin, n);
    p.rect(...A.bottom, c.skin, n);
  }

  // Legs
  const legs = [boxUV(0, 16, 4, 12, 4), boxUV(16, 48, 4, 12, 4)];
  for (const L of legs) {
    for (const k of ['right', 'front', 'left', 'back']) {
      const [x, y, w] = L[k];
      p.rect(x, y, w, 12, c.pants, n);
      p.rect(x, y + 10, w, 2, c.shoes, 0.06);
      if (c.coat) p.rect(x, y, w, 3, c.shirt, n);
    }
    p.rect(...L.top, c.pants, n);
    p.rect(...L.bottom, c.shoes, n);
  }

  // Overlay layers
  if (c.helmet) {
    const O = boxUV(32, 0, 8, 8, 8);
    for (const f of Object.values(O)) p.rect(...f, c.helmet, 0.07);
    p.clear(...O.bottom);
    const [x, y] = O.front;
    p.clear(x + 1, y + 3, 6, 4);
    p.rect(x + 3, y + 3, 2, 3, c.helmet, 0.05);
    p.rect(x, y + 2, 8, 1, shade(c.helmet, 0.8));
  }
  if (c.hat) {
    const O = boxUV(32, 0, 8, 8, 8);
    p.rect(...O.top, c.hat, 0.06);
    for (const k of ['front', 'back', 'left', 'right']) {
      const [x, y, w] = O[k];
      p.rect(x, y, w, 2, c.hat, 0.06);
      p.rect(x, y + 2, w, 1, '#3a2a18');
    }
  }
  return p.finish();
}

/*
 * Prepares an imported skin. Legacy 64x32 skins are placed in the top half of a
 * square canvas so the left limbs fall back to mirrored right limbs, as in vanilla.
 * HD skins keep their native resolution.
 */
export function normalizeSkinCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.width;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  return c;
}

/* ---------- Block textures (96x16 atlas: top, bottom, front, back, left, right) ---------- */

function noiseFill(p, ox, color, amt, flecks = 0, fleckColors = []) {
  p.rect(ox, 0, 16, 16, color, amt);
  for (let i = 0; i < flecks; i++) {
    const x = Math.floor(p.rand() * 16), y = Math.floor(p.rand() * 16);
    p.px(ox + x, y, fleckColors[Math.floor(p.rand() * fleckColors.length)], 255, 0.05);
  }
}

const T = {
  grassTop(p, o) { noiseFill(p, o, '#5f9f3c', 0.13, 30, ['#4d8a30', '#71b347']); },
  dirt(p, o) { noiseFill(p, o, '#87613f', 0.12, 26, ['#6b4a2e', '#9c7650', '#5d4129']); },
  grassSide(p, o) {
    T.dirt(p, o);
    for (let x = 0; x < 16; x++) {
      const d = 2 + Math.floor(p.rand() * 3);
      for (let y = 0; y < d; y++) p.px(o + x, y, '#5f9f3c', 255, 0.13);
    }
  },
  stone(p, o) { noiseFill(p, o, '#7c7c7c', 0.08, 34, ['#6a6a6a', '#8c8c8c', '#5e5e5e']); },
  cobble(p, o) {
    const pts = [];
    for (let i = 0; i < 9; i++) pts.push([p.rand() * 16, p.rand() * 16, 0.82 + p.rand() * 0.3]);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let a = 1e9, b = 1e9, ci = 0;
      for (let i = 0; i < pts.length; i++) {
        for (const dx of [-16, 0, 16]) for (const dy of [-16, 0, 16]) {
          const d = Math.hypot(x - pts[i][0] - dx, y - pts[i][1] - dy);
          if (d < a) { b = a; a = d; ci = i; } else if (d < b) b = d;
        }
      }
      const edge = b - a < 1.3;
      p.px(o + x, y, edge ? '#4c4c4c' : shade('#828282', pts[ci][2]), 255, edge ? 0.05 : 0.07);
    }
  },
  planks(p, o) {
    p.rect(o, 0, 16, 16, '#a3824f', 0.07);
    for (let r = 0; r < 4; r++) {
      const y = r * 4 + 3;
      p.rect(o, y, 16, 1, '#6e5532', 0.05);
      const seam = (r % 2 ? 4 : 11);
      p.rect(o + seam, r * 4, 1, 3, '#7d6139', 0.05);
      for (let i = 0; i < 3; i++) p.px(o + Math.floor(p.rand() * 16), r * 4 + Math.floor(p.rand() * 3), '#8f7244');
    }
  },
  logSide(p, o) {
    for (let x = 0; x < 16; x++) {
      const base = p.rand() < 0.3 ? '#4f3a22' : p.rand() < 0.5 ? '#6a5032' : '#5d4529';
      for (let y = 0; y < 16; y++) p.px(o + x, y, base, 255, 0.08);
    }
  },
  logTop(p, o) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const c = r > 6.5 ? '#5d4529' : Math.floor(r) % 2 ? '#b5925c' : '#9b7a47';
      p.px(o + x, y, c, 255, 0.06);
    }
  },
  bricks(p, o) {
    p.rect(o, 0, 16, 16, '#97503e', 0.1);
    for (let r = 0; r < 4; r++) {
      p.rect(o, r * 4 + 3, 16, 1, '#b2a69a', 0.05);
      const off = r % 2 ? 0 : 4;
      p.rect(o + off, r * 4, 1, 3, '#b2a69a', 0.05);
      p.rect(o + off + 8, r * 4, 1, 3, '#b2a69a', 0.05);
    }
  },
  sand(p, o) { noiseFill(p, o, '#dccf9e', 0.05, 20, ['#c9bc8a', '#e8dcae']); },
  glass(p, o) {
    p.clear(o, 0, 16, 16);
    for (let i = 0; i < 16; i++) {
      p.px(o + i, 0, '#dcf0f4'); p.px(o + i, 15, '#9fc4cc');
      p.px(o, i, '#dcf0f4'); p.px(o + 15, i, '#9fc4cc');
    }
    p.points([[o + 3, 3], [o + 4, 4], [o + 4, 3], [o + 5, 5], [o + 11, 10], [o + 12, 11]], '#eaf8fb');
  },
  leaves(p, o) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (p.rand() < 0.22) { p.clear(o + x, y, 1, 1); continue; }
      p.px(o + x, y, p.rand() < 0.3 ? '#2f6e22' : '#3f8a2e', 255, 0.12);
    }
  },
  tntSide(p, o) {
    p.rect(o, 0, 16, 16, '#c3331f', 0.08);
    for (let x = 0; x < 16; x += 4) p.rect(o + x, 0, 1, 16, '#9a2614');
    p.rect(o, 5, 16, 6, '#e6e6e6', 0.03);
    const L = [[1, 0], [2, 0], [3, 0], [2, 1], [2, 2], [2, 3], [2, 4]];
    const N = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 1], [2, 2], [3, 3], [3, 0], [3, 1], [3, 2], [3, 4], [3, 3]];
    for (const [x, y] of L) p.px(o + x, 6 + y, '#222');
    for (const [x, y] of N) p.px(o + 6 + x, 6 + y, '#222');
    for (const [x, y] of L) p.px(o + 11 + x, 6 + y, '#222');
  },
  tntTop(p, o) {
    p.rect(o, 0, 16, 16, '#c3331f', 0.08);
    p.rect(o + 1, 1, 14, 14, '#a52a18', 0.06);
    p.rect(o + 6, 6, 4, 4, '#555', 0.1);
    p.rect(o + 7, 7, 2, 2, '#1a1a1a');
  },
  tntBottom(p, o) { p.rect(o, 0, 16, 16, '#a52a18', 0.08); },
  craftTop(p, o) {
    T.planks(p, o);
    for (let i = 0; i < 16; i++) { p.px(o + i, 0, '#5a4322'); p.px(o + i, 15, '#5a4322'); p.px(o, i, '#5a4322'); p.px(o + 15, i, '#5a4322'); }
    p.rect(o + 5, 1, 1, 14, '#5a4322'); p.rect(o + 10, 1, 1, 14, '#5a4322');
    p.rect(o + 1, 5, 14, 1, '#5a4322'); p.rect(o + 1, 10, 14, 1, '#5a4322');
  },
  craftSide(p, o) {
    T.planks(p, o);
    p.rect(o, 0, 16, 3, '#6e5532', 0.05);
    p.rect(o + 3, 5, 2, 8, '#7c7c7c'); p.rect(o + 2, 5, 4, 2, '#9a9a9a');
    p.rect(o + 10, 6, 1, 7, '#6b4a2e'); p.rect(o + 9, 5, 4, 2, '#a8a8a8');
  },
  bookshelf(p, o) {
    T.planks(p, o);
    const cols = ['#7a2a2a', '#2a4f7a', '#3e6b2e', '#7a6a2a', '#5a2a6b', '#2a6b6b'];
    for (const y0 of [1, 9]) {
      p.rect(o, y0 - 1, 16, 1, '#5a4322');
      for (let x = 1; x < 15; x++) {
        const c = cols[Math.floor(p.rand() * cols.length)];
        const h = 5 + Math.floor(p.rand() * 2);
        p.rect(o + x, y0 + (6 - h), 1, h, c, 0.06);
      }
    }
  },
  metal(base) {
    return (p, o) => {
      p.rect(o, 0, 16, 16, base, 0.04);
      for (let i = 0; i < 16; i++) { p.px(o + i, 0, shade(base, 1.18)); p.px(o, i, shade(base, 1.18)); p.px(o + i, 15, shade(base, 0.72)); p.px(o + 15, i, shade(base, 0.72)); }
      p.rect(o + 3, 3, 10, 10, shade(base, 0.94), 0.03);
      for (let i = 3; i < 13; i++) { p.px(o + i, 3, shade(base, 0.82)); p.px(o + 3, i, shade(base, 0.82)); }
    };
  },
  glowstone(p, o) {
    p.rect(o, 0, 16, 16, '#9c7444', 0.1);
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(p.rand() * 14), y = Math.floor(p.rand() * 14);
      p.rect(o + x, y, 2 + Math.floor(p.rand() * 2), 2, p.rand() < 0.5 ? '#fbe6a2' : '#e9c06a', 0.05);
    }
  },
  obsidian(p, o) { noiseFill(p, o, '#1a1224', 0.15, 22, ['#3a2a52', '#0e0a14', '#2a1d3b']); },
  wool(color) {
    return (p, o) => {
      p.rect(o, 0, 16, 16, color, 0.05);
      for (let y = 0; y < 16; y++) for (let x = (y % 2); x < 16; x += 2) p.px(o + x, y, shade(color, 0.95), 255, 0.03);
    };
  },
  water(p, o) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const w = Math.sin((x + y * 0.6) * 0.8) * 0.5 + 0.5;
      p.px(o + x, y, w > 0.75 ? '#5b8cf0' : '#3b6ad8', 190, 0.04);
    }
  },
  pumpkinSide(p, o) {
    p.rect(o, 0, 16, 16, '#d9862a', 0.06);
    for (const x of [2, 6, 10, 14]) p.rect(o + x, 0, 1, 16, '#b8691d');
  },
  pumpkinFace(p, o) {
    T.pumpkinSide(p, o);
    p.rect(o + 3, 4, 3, 3, '#3a2408'); p.rect(o + 10, 4, 3, 3, '#3a2408');
    p.rect(o + 3, 10, 10, 2, '#3a2408'); p.rect(o + 5, 12, 2, 1, '#3a2408'); p.rect(o + 9, 12, 2, 1, '#3a2408');
  },
  pumpkinTop(p, o) {
    p.rect(o, 0, 16, 16, '#c97a22', 0.06);
    p.rect(o + 7, 6, 2, 3, '#5a4322');
  },
};

export const BLOCKS = [
  { id: 'grass', name: 'Grass block', faces: { top: T.grassTop, bottom: T.dirt, side: T.grassSide } },
  { id: 'dirt', name: 'Dirt', faces: { all: T.dirt } },
  { id: 'stone', name: 'Stone', faces: { all: T.stone } },
  { id: 'cobblestone', name: 'Cobblestone', faces: { all: T.cobble } },
  { id: 'oak_planks', name: 'Oak planks', faces: { all: T.planks } },
  { id: 'oak_log', name: 'Oak log', faces: { top: T.logTop, bottom: T.logTop, side: T.logSide } },
  { id: 'bricks', name: 'Bricks', faces: { all: T.bricks } },
  { id: 'sand', name: 'Sand', faces: { all: T.sand } },
  { id: 'glass', name: 'Glass', faces: { all: T.glass }, cutout: true },
  { id: 'leaves', name: 'Oak leaves', faces: { all: T.leaves }, cutout: true },
  { id: 'tnt', name: 'TNT', faces: { top: T.tntTop, bottom: T.tntBottom, side: T.tntSide } },
  { id: 'crafting_table', name: 'Crafting table', faces: { top: T.craftTop, bottom: T.planks, side: T.craftSide } },
  { id: 'bookshelf', name: 'Bookshelf', faces: { top: T.planks, bottom: T.planks, side: T.bookshelf } },
  { id: 'pumpkin', name: 'Carved pumpkin', faces: { top: T.pumpkinTop, bottom: T.pumpkinTop, side: T.pumpkinSide, front: T.pumpkinFace } },
  { id: 'gold_block', name: 'Block of gold', faces: { all: T.metal('#f2c93a') } },
  { id: 'diamond_block', name: 'Block of diamond', faces: { all: T.metal('#62d9cf') } },
  { id: 'iron_block', name: 'Block of iron', faces: { all: T.metal('#d9d9d9') } },
  { id: 'glowstone', name: 'Glowstone', faces: { all: T.glowstone }, emissive: true },
  { id: 'obsidian', name: 'Obsidian', faces: { all: T.obsidian } },
  { id: 'white_wool', name: 'White wool', faces: { all: T.wool('#e8eaea') } },
  { id: 'red_wool', name: 'Red wool', faces: { all: T.wool('#a62c2a') } },
  { id: 'blue_wool', name: 'Blue wool', faces: { all: T.wool('#35399d') } },
  { id: 'water', name: 'Water', faces: { all: T.water }, translucent: true },
];

export const BLOCK_MAP = Object.fromEntries(BLOCKS.map((b) => [b.id, b]));
export const BLOCK_FACE_ORDER = ['top', 'bottom', 'front', 'back', 'left', 'right'];

export function paintBlockAtlas(id) {
  const def = BLOCK_MAP[id] || BLOCKS[0];
  const p = new Painter(96, 16, 1000 + id.length * 31 + id.charCodeAt(0));
  BLOCK_FACE_ORDER.forEach((face, i) => {
    const f = def.faces;
    const fn = f[face] || ((face === 'top' || face === 'bottom') ? f.all : (f.side || f.all)) || f.all;
    fn(p, i * 16);
  });
  return p.finish();
}

/* ---------- Item sprites (16x16) ---------- */

const MAT = {
  iron: ['#f0f0f0', '#cfcfcf', '#8f8f8f'],
  gold: ['#fff2a0', '#f2c93a', '#b0861c'],
  diamond: ['#d6fff9', '#5fd8cf', '#2a9a92'],
  wood: ['#c9a36a', '#a3824f', '#6e5532'],
  stone: ['#b0b0b0', '#8a8a8a', '#5a5a5a'],
};
const HANDLE = ['#8a6a3c', '#5e4527'];

function handle(p, x0, y0, x1, y1) {
  p.line(x0, y0, x1, y1, HANDLE[0]);
  p.line(x0 + 1, y0, x1 + 1, y1, HANDLE[1]);
}

const ITEM_DRAW = {
  sword(p, m) {
    const [hi, mid, lo] = MAT[m];
    p.line(6, 9, 13, 2, mid); p.line(7, 9, 14, 2, lo); p.line(6, 8, 12, 2, hi);
    p.px(14, 1, hi); p.px(13, 1, mid);
    p.line(3, 8, 7, 12, '#4a3620');
    handle(p, 2, 13, 4, 11);
    p.px(1, 14, '#4a3620'); p.px(2, 14, '#4a3620');
  },
  pickaxe(p, m) {
    const [hi, mid, lo] = MAT[m];
    handle(p, 2, 13, 10, 5);
    p.points([[4, 3], [5, 2], [6, 2], [7, 1], [8, 1], [9, 1], [10, 2], [11, 2]], hi);
    p.points([[4, 4], [5, 3], [6, 3], [7, 2], [8, 2], [9, 2], [10, 3], [11, 3], [12, 3]], mid);
    p.points([[12, 4], [13, 5], [13, 6], [13, 7], [14, 8], [14, 9], [14, 10], [12, 5], [12, 6]], mid);
    p.points([[13, 4], [14, 5], [14, 6], [14, 7], [15, 8], [15, 9]], lo);
    p.points([[3, 4], [3, 5]], lo);
  },
  axe(p, m) {
    const [hi, mid, lo] = MAT[m];
    handle(p, 2, 13, 10, 5);
    const rows = { 1: [8, 10], 2: [7, 11], 3: [7, 12], 4: [8, 12], 5: [11, 13], 6: [11, 12] };
    for (const [y, [a, b]] of Object.entries(rows)) for (let x = a; x <= b; x++) p.px(x, +y, x === a ? hi : x === b ? lo : mid);
  },
  shovel(p, m) {
    const [hi, mid, lo] = MAT[m];
    handle(p, 2, 13, 9, 6);
    const pts = [[10, 2], [11, 2], [12, 2], [9, 3], [10, 3], [11, 3], [12, 3], [13, 3], [9, 4], [10, 4], [11, 4], [12, 4], [13, 4], [10, 5], [11, 5], [12, 5], [11, 6]];
    for (const [x, y] of pts) p.px(x, y, mid);
    p.points([[10, 2], [9, 3], [9, 4]], hi);
    p.points([[13, 3], [13, 4], [12, 5], [11, 6]], lo);
  },
  apple(p) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot((x - 7.5) / 5.6, (y - 9) / 5.2);
      if (d < 1) p.px(x, y, d > 0.82 ? '#8a1414' : '#d42a24', 255, 0.05);
    }
    p.points([[5, 6], [5, 7], [6, 6]], '#ff8a7a');
    p.points([[8, 2], [8, 3], [8, 4]], '#5e4527');
    p.points([[9, 2], [10, 2], [10, 3], [11, 2]], '#4f9a2e');
  },
  diamond(p) {
    const rows = [[6, 9], [4, 11], [3, 12], [4, 11], [5, 10], [6, 9], [7, 8]];
    rows.forEach(([a, b], i) => { for (let x = a; x <= b; x++) p.px(x, 4 + i, x === a ? '#d6fff9' : x === b ? '#2a9a92' : '#5fd8cf'); });
    p.points([[6, 5], [7, 5]], '#ffffff');
  },
  stick(p) { handle(p, 3, 13, 12, 4); },
  bone(p) {
    p.line(4, 11, 11, 4, '#ece6d2'); p.line(5, 11, 12, 4, '#bfb69a');
    p.points([[3, 11], [3, 12], [4, 13], [5, 12], [11, 3], [12, 3], [13, 4], [12, 5]], '#ece6d2');
  },
  torch(p) {
    p.rect(7, 6, 2, 9, '#8a6a3c'); p.rect(8, 6, 1, 9, '#5e4527');
    p.rect(7, 4, 2, 2, '#ffd34a'); p.px(7, 3, '#fff1a0'); p.px(8, 5, '#ff9a2a');
  },
  emerald(p) {
    for (let y = 3; y < 13; y++) {
      const w = y < 8 ? y - 2 : 13 - y;
      for (let x = 8 - w; x < 8 + w; x++) p.px(x, y, x < 7 ? '#7dff9a' : '#2fbf55', 255, 0.05);
    }
  },
};

export function paintItem(kind, material) {
  const p = new Painter(16, 16, 55);
  p.clear(0, 0, 16, 16);
  ITEM_DRAW[kind](p, material);
  return p.finish();
}

export const ITEMS = [
  { id: 'iron_sword', name: 'Iron sword', kind: 'sword', mat: 'iron' },
  { id: 'diamond_sword', name: 'Diamond sword', kind: 'sword', mat: 'diamond' },
  { id: 'golden_sword', name: 'Golden sword', kind: 'sword', mat: 'gold' },
  { id: 'wooden_sword', name: 'Wooden sword', kind: 'sword', mat: 'wood' },
  { id: 'iron_pickaxe', name: 'Iron pickaxe', kind: 'pickaxe', mat: 'iron' },
  { id: 'diamond_pickaxe', name: 'Diamond pickaxe', kind: 'pickaxe', mat: 'diamond' },
  { id: 'stone_pickaxe', name: 'Stone pickaxe', kind: 'pickaxe', mat: 'stone' },
  { id: 'iron_axe', name: 'Iron axe', kind: 'axe', mat: 'iron' },
  { id: 'diamond_axe', name: 'Diamond axe', kind: 'axe', mat: 'diamond' },
  { id: 'iron_shovel', name: 'Iron shovel', kind: 'shovel', mat: 'iron' },
  { id: 'apple', name: 'Apple', kind: 'apple' },
  { id: 'diamond', name: 'Diamond', kind: 'diamond' },
  { id: 'emerald', name: 'Emerald', kind: 'emerald' },
  { id: 'stick', name: 'Stick', kind: 'stick' },
  { id: 'bone', name: 'Bone', kind: 'bone' },
  { id: 'torch', name: 'Torch', kind: 'torch' },
];
export const ITEM_MAP = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
