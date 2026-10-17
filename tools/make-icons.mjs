// Generates app icons and splash screens for the Android and iOS projects.
// Usage: node tools/make-icons.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname;

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba, alpha) {
  const ch = alpha ? 4 : 3;
  const raw = Buffer.alloc((w * ch + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * ch + 1)] = 0;
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) raw[y * (w * ch + 1) + 1 + x * ch + c] = rgba[(y * w + x) * 4 + c];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function pngSize(file) {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function shrink(pts, f) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);
}

/* Isometric cube logo, faces in the app's accent blue. */
function logoFaces(cx, cy, s) {
  const k = 0.866;
  const T = [cx, cy - s], UR = [cx + k * s, cy - s / 2], LR = [cx + k * s, cy + s / 2];
  const B = [cx, cy + s], LL = [cx - k * s, cy + s / 2], UL = [cx - k * s, cy - s / 2], C = [cx, cy];
  return [
    [shrink([T, UR, C, UL], 0.93), [0x60, 0xcd, 0xff]],
    [shrink([UL, C, B, LL], 0.93), [0x2f, 0x93, 0xc4]],
    [shrink([C, UR, LR, B], 0.93), [0x1b, 0x5e, 0x80]],
  ];
}

/*
 * shape: 'square' | 'rounded' | 'circle' | 'none' (transparent background)
 * logoScale: hexagon radius relative to the image's smaller side
 */
function render(w, h, { shape = 'square', logoScale = 0.3, alpha = false, bg = [0, 0, 0] } = {}) {
  const px = new Uint8ClampedArray(w * h * 4);
  const m = Math.min(w, h);
  const faces = logoFaces(w / 2, h / 2, m * logoScale);
  const SS = 4;
  const radius = m * 0.22;
  const inShape = (x, y) => {
    if (shape === 'square') return true;
    if (shape === 'none') return false;
    if (shape === 'circle') return (x - w / 2) ** 2 + (y - h / 2) ** 2 <= (m / 2) ** 2;
    const dx = Math.max(radius - x, 0, x - (w - radius)), dy = Math.max(radius - y, 0, y - (h - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const X = x + (sx + 0.5) / SS, Y = y + (sy + 0.5) / SS;
      let col = null;
      for (const [poly, c] of faces) if (inPoly(X, Y, poly)) { col = c; break; }
      if (!col && inShape(X, Y)) col = bg;
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
    }
    const n = SS * SS, i = (y * w + x) * 4;
    const cov = a / n;
    if (alpha) {
      px[i] = cov ? r / (a / 255) : 0; px[i + 1] = cov ? g / (a / 255) : 0; px[i + 2] = cov ? b / (a / 255) : 0; px[i + 3] = cov;
    } else {
      // Composite onto black for opaque outputs.
      px[i] = r / n; px[i + 1] = g / n; px[i + 2] = b / n; px[i + 3] = 255;
    }
  }
  return encodePng(w, h, px, alpha);
}

const res = join(ROOT, 'android/app/src/main/res');
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, f] of Object.entries(dens)) {
  const dir = join(res, 'mipmap-' + d);
  const icon = Math.round(48 * f), fg = Math.round(108 * f);
  writeFileSync(join(dir, 'ic_launcher.png'), render(icon, icon, { shape: 'rounded', logoScale: 0.3, alpha: true }));
  writeFileSync(join(dir, 'ic_launcher_round.png'), render(icon, icon, { shape: 'circle', logoScale: 0.3, alpha: true }));
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), render(fg, fg, { shape: 'none', logoScale: 0.2, alpha: true }));
}
writeFileSync(join(res, 'values/ic_launcher_background.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#000000</color>\n</resources>\n');

for (const dir of readdirSync(res)) {
  const file = join(res, dir, 'splash.png');
  try { statSync(file); } catch { continue; }
  const [w, h] = pngSize(file);
  writeFileSync(file, render(w, h, { logoScale: 0.075 }));
}

const iosAssets = join(ROOT, 'ios/App/App/Assets.xcassets');
writeFileSync(join(iosAssets, 'AppIcon.appiconset/AppIcon-512@2x.png'), render(1024, 1024, { logoScale: 0.3 }));
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  writeFileSync(join(iosAssets, 'Splash.imageset', f), render(2732, 2732, { logoScale: 0.06 }));
}
console.log('Icons and splash screens written.');
