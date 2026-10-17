import * as THREE from 'three';
import { DEG } from './util.js';
import {
  Painter, boxUV, shade, paintHumanSkin, HUMAN_SKINS, BLOCKS, BLOCK_MAP, paintBlockAtlas, BLOCK_FACE_ORDER,
  ITEMS, ITEM_MAP, paintItem,
} from './textures.js';
import { firstPackImage, packImage } from './pack.js';

/* =====================================================================
   Model definitions

   Models are written in Minecraft's own entity-model terms (the same
   numbers as the vanilla Java model layers) and converted here:
   - pivot: PartPose offset, relative to the parent part (y down, front -Z)
   - rot:   rest rotation in degrees (applied Z, Y, X like vanilla)
   - cubes: texOffs [u, v], addBox [x, y, z, w, h, d], deformation, mirror
   Converted space: units are pixels (16 = one block), +Y up, front +Z,
   ground at y = 0 (vanilla y = 24).
   ===================================================================== */

function convertModel({ textures, parts }) {
  const bones = [];
  const abs = {};
  for (const p of parts) {
    const o = p.pivot || [0, 0, 0];
    const base = p.parent ? abs[p.parent] : null;
    const pivot = base ? [base[0] + o[0], base[1] - o[1], base[2] - o[2]] : [o[0], 24 - o[1], -o[2]];
    abs[p.name] = pivot;
    const boxes = (p.cubes || []).map((c) => {
      const [bx, by, bz, w, h, d] = c.box;
      return {
        from: [pivot[0] + bx, pivot[1] - (by + h), pivot[2] - (bz + d)],
        size: [w, h, d],
        uv: c.uv,
        inflate: c.inflate || 0,
        mirror: !!c.mirror,
        overlay: !!c.overlay,
        translucent: !!c.translucent,
        tex: c.tex || 'main',
        fallback: c.fallback,
        p: c.p,
      };
    });
    let bend = null;
    if (p.bend) {
      const b0 = boxes[0];
      bend = { at: b0.from[1] + b0.size[1] / 2, part: p.bend.part, sign: p.bend.sign };
    }
    bones.push({
      name: p.name, label: p.label, parent: p.parent || null, pivot,
      rot: p.rot ? [p.rot[0], -p.rot[1], -p.rot[2]] : null,
      boxes, bend,
    });
  }
  return { textures, bones };
}

/* ---------- Procedural paint helpers (used when no official textures are imported) ---------- */

function eyes(white, pupil, row = 3, inset = 1, wide = 1) {
  return (P, [x, y, w]) => {
    for (let i = 0; i < wide; i++) {
      P.px(x + inset + i, y + row, white);
      P.px(x + w - 1 - inset - i, y + row, white);
    }
    P.px(x + inset + wide, y + row, pupil);
    P.px(x + w - 1 - inset - wide, y + row, pupil);
  };
}
const bottomBand = (color, rows) => (P, [x, y, w, h]) => P.rect(x, y + h - rows, w, rows, color, 0.05);
const topBand = (color, rows) => (P, [x, y, w]) => P.rect(x, y, w, rows, color, 0.05);
function blotches(color, count) {
  return (P, [x, y, w, h]) => {
    for (let i = 0; i < count; i++) {
      const bx = x + Math.floor(P.rand() * w), by = y + Math.floor(P.rand() * h);
      const bw = 2 + Math.floor(P.rand() * 3), bh = 2 + Math.floor(P.rand() * 3);
      for (let j = 0; j < bh; j++) for (let k = 0; k < bw; k++) {
        if (bx + k < x + w && by + j < y + h) P.px(bx + k, by + j, color, 255, 0.05);
      }
    }
  };
}
const all = (...fns) => (P, r) => fns.forEach((f) => f(P, r));
const sides = (fn) => ({ front: fn, back: fn, left: fn, right: fn });

/* ---------- Humanoids ---------- */

const ARMOR_DEFAULT = { body: 'Body', head: 'Head', right_arm: 'Right arm', left_arm: 'Left arm', right_leg: 'Right leg', left_leg: 'Left leg' };

/*
 * Player-style humanoid (64x64 layout). The torso pivots at the hips like
 * Mine-imator; geometry is identical to the vanilla player model.
 */
function playerModel({ slim = false, armRot = null, paths, procedural }) {
  const aw = slim ? 3 : 4;
  const ay = slim ? 2.5 : 2;
  return convertModel({
    textures: { main: { size: [64, 64], paths, procedural } },
    parts: [
      { name: 'body', label: ARMOR_DEFAULT.body, pivot: [0, 12, 0], bend: { part: 'upper', sign: 1 }, cubes: [
        { uv: [16, 16], box: [-4, -12, -2, 8, 12, 4] },
        { uv: [16, 32], box: [-4, -12, -2, 8, 12, 4], inflate: 0.25, overlay: true },
      ] },
      { name: 'head', label: ARMOR_DEFAULT.head, parent: 'body', pivot: [0, -12, 0], cubes: [
        { uv: [0, 0], box: [-4, -8, -4, 8, 8, 8] },
        { uv: [32, 0], box: [-4, -8, -4, 8, 8, 8], inflate: 0.5, overlay: true },
      ] },
      { name: 'right_arm', label: ARMOR_DEFAULT.right_arm, parent: 'body', pivot: [-5, ay - 12, 0], rot: armRot, bend: { part: 'lower', sign: -1 }, cubes: [
        { uv: [40, 16], box: [slim ? -2 : -3, -2, -2, aw, 12, 4] },
        { uv: [40, 32], box: [slim ? -2 : -3, -2, -2, aw, 12, 4], inflate: 0.25, overlay: true },
      ] },
      { name: 'left_arm', label: ARMOR_DEFAULT.left_arm, parent: 'body', pivot: [5, ay - 12, 0], rot: armRot, bend: { part: 'lower', sign: -1 }, cubes: [
        { uv: [32, 48], box: [-1, -2, -2, aw, 12, 4], fallback: { uv: [40, 16], mirror: true } },
        { uv: [48, 48], box: [-1, -2, -2, aw, 12, 4], inflate: 0.25, overlay: true },
      ] },
      { name: 'right_leg', label: ARMOR_DEFAULT.right_leg, pivot: [-1.9, 12, 0], bend: { part: 'lower', sign: 1 }, cubes: [
        { uv: [0, 16], box: [-2, 0, -2, 4, 12, 4] },
        { uv: [0, 32], box: [-2, 0, -2, 4, 12, 4], inflate: 0.25, overlay: true },
      ] },
      { name: 'left_leg', label: ARMOR_DEFAULT.left_leg, pivot: [1.9, 12, 0], bend: { part: 'lower', sign: 1 }, cubes: [
        { uv: [16, 48], box: [-2, 0, -2, 4, 12, 4], fallback: { uv: [0, 16], mirror: true } },
        { uv: [0, 48], box: [-2, 0, -2, 4, 12, 4], inflate: 0.25, overlay: true },
      ] },
    ],
  });
}

const BONE = '#d2d2cc';
const ribs = (P, [x, y, w, h]) => {
  for (let j = 0; j < h; j++) if (j % 2 && j < 9) { P.clear(x, y + j, 3, 1); P.clear(x + 5, y + j, 3, 1); }
  P.clear(x, y + 9, 3, 3); P.clear(x + 5, y + 9, 3, 3);
};

/* Thin shank with a foot along the bottom row, transparent elsewhere. */
const chickenLeg = (P, [x, y, w, h]) => {
  P.clear(x, y, w, h);
  P.rect(x + 1, y, 1, h - 1, '#f0ad26');
  P.rect(x, y + h - 1, w, 1, '#e09a1a');
};

const MODELS = {
  human: playerModel({ paths: null }),
  human_slim: playerModel({ slim: true, paths: null }),

  zombie: playerModel({
    armRot: [-90, 0, 0],
    paths: ['entity/zombie/zombie.png'],
    procedural: () => paintHumanSkin('zombie'),
  }),

  skeleton: convertModel({
    textures: { main: { size: [64, 32], paths: ['entity/skeleton/skeleton.png'] } },
    parts: [
      { name: 'body', label: 'Body', pivot: [0, 12, 0], bend: { part: 'upper', sign: 1 }, cubes: [
        { uv: [16, 16], box: [-4, -12, -2, 8, 12, 4], p: { c: BONE, n: 0.05, faces: { front: ribs, back: ribs } } },
      ] },
      { name: 'head', label: 'Head', parent: 'body', pivot: [0, -12, 0], cubes: [
        { uv: [0, 0], box: [-4, -8, -4, 8, 8, 8], p: { c: BONE, n: 0.05, faces: { front: (P, [x, y]) => {
          P.rect(x + 1, y + 3, 2, 2, '#1c1c1c'); P.rect(x + 5, y + 3, 2, 2, '#1c1c1c'); P.rect(x + 3, y + 5, 2, 1, '#555'); P.rect(x + 1, y + 6, 6, 1, '#3a3a3a');
        } } } },
        { uv: [32, 0], box: [-4, -8, -4, 8, 8, 8], inflate: 0.5, overlay: true },
      ] },
      { name: 'right_arm', label: 'Right arm', parent: 'body', pivot: [-5, -10, 0], bend: { part: 'lower', sign: -1 }, cubes: [
        { uv: [40, 16], box: [-1, -2, -1, 2, 12, 2], p: { c: BONE, n: 0.06 } },
      ] },
      { name: 'left_arm', label: 'Left arm', parent: 'body', pivot: [5, -10, 0], bend: { part: 'lower', sign: -1 }, cubes: [
        { uv: [40, 16], box: [-1, -2, -1, 2, 12, 2], mirror: true },
      ] },
      { name: 'right_leg', label: 'Right leg', pivot: [-2, 12, 0], bend: { part: 'lower', sign: 1 }, cubes: [
        { uv: [0, 16], box: [-1, 0, -1, 2, 12, 2], p: { c: BONE, n: 0.06 } },
      ] },
      { name: 'left_leg', label: 'Left leg', pivot: [2, 12, 0], bend: { part: 'lower', sign: 1 }, cubes: [
        { uv: [0, 16], box: [-1, 0, -1, 2, 12, 2], mirror: true },
      ] },
    ],
  }),

  enderman: convertModel({
    textures: { main: { size: [64, 32], paths: ['entity/enderman/enderman.png'] } },
    parts: [
      { name: 'body', label: 'Body', pivot: [0, -2, 0], bend: { part: 'upper', sign: 1 }, cubes: [
        { uv: [32, 16], box: [-4, -12, -2, 8, 12, 4], p: { c: '#121212', n: 0.06 } },
      ] },
      { name: 'head', label: 'Head', parent: 'body', pivot: [0, -11, 0], cubes: [
        { uv: [0, 0], box: [-4, -8, -4, 8, 8, 8], p: { c: '#161616', n: 0.06, faces: { front: (P, [x, y]) => {
          P.rect(x, y + 4, 3, 1, '#e07cff'); P.rect(x + 5, y + 4, 3, 1, '#e07cff'); P.px(x + 1, y + 4, '#f8c8ff'); P.px(x + 6, y + 4, '#f8c8ff');
        } } } },
        { uv: [0, 16], box: [-4, -8, -4, 8, 8, 8], inflate: -0.5, overlay: true, p: { c: '#0e0e0e', n: 0.05 } },
      ] },
      { name: 'right_arm', label: 'Right arm', parent: 'body', pivot: [-5, -10, 0], bend: { part: 'lower', sign: -1 }, cubes: [
        { uv: [56, 0], box: [-1, -2, -1, 2, 30, 2], p: { c: '#111111', n: 0.06 } },
      ] },
      { name: 'left_arm', label: 'Left arm', parent: 'body', pivot: [5, -10, 0], bend: { part: 'lower', sign: -1 }, cubes: [
        { uv: [56, 0], box: [-1, -2, -1, 2, 30, 2], mirror: true },
      ] },
      { name: 'right_leg', label: 'Right leg', pivot: [-2, -5, 0], bend: { part: 'lower', sign: 1 }, cubes: [
        { uv: [56, 0], box: [-1, 0, -1, 2, 30, 2] },
      ] },
      { name: 'left_leg', label: 'Left leg', pivot: [2, -5, 0], bend: { part: 'lower', sign: 1 }, cubes: [
        { uv: [56, 0], box: [-1, 0, -1, 2, 30, 2], mirror: true },
      ] },
    ],
  }),

  villager: convertModel({
    textures: { main: { size: [64, 64], paths: ['entity/villager/villager.png'] } },
    parts: [
      { name: 'body', label: 'Body', pivot: [0, 12, 0], cubes: [
        { uv: [16, 20], box: [-4, -12, -3, 8, 12, 6], p: { c: '#6d4b34', n: 0.06, faces: { front: (P, [x, y, w, h]) => P.rect(x + 3, y, 2, h, '#5a3c28') } } },
        { uv: [0, 38], box: [-4, -12, -3, 8, 20, 6], inflate: 0.5, overlay: true, p: { c: '#6d4b34', n: 0.06, faces: { bottom: '#4a3424' } } },
      ] },
      { name: 'head', label: 'Head', parent: 'body', pivot: [0, -12, 0], cubes: [
        { uv: [0, 0], box: [-4, -10, -4, 8, 10, 8], p: { c: '#b4876a', n: 0.04, faces: {
          top: '#5a3c28', back: topBand('#5a3c28', 3),
          front: all(topBand('#5a3c28', 1), (P, [x, y]) => {
            P.rect(x + 1, y + 2, 6, 1, '#4a3424'); P.px(x + 1, y + 4, '#fff'); P.px(x + 2, y + 4, '#2f8a3a');
            P.px(x + 6, y + 4, '#fff'); P.px(x + 5, y + 4, '#2f8a3a'); P.rect(x + 2, y + 8, 4, 1, '#7a5040');
          }),
        } } },
        { uv: [32, 0], box: [-4, -10, -4, 8, 10, 8], inflate: 0.51, overlay: true },
      ] },
      { name: 'nose', label: 'Nose', parent: 'head', pivot: [0, -2, 0], cubes: [
        { uv: [24, 0], box: [-1, -1, -6, 2, 4, 2], p: { c: '#a67a5e', n: 0.04 } },
      ] },
      { name: 'arms', label: 'Arms', parent: 'body', pivot: [0, -9, -1], rot: [-42.97, 0, 0], cubes: [
        { uv: [44, 22], box: [-8, -2, -2, 4, 8, 4], p: { c: '#6d4b34', n: 0.06, faces: { bottom: '#b4876a' } } },
        { uv: [44, 22], box: [4, -2, -2, 4, 8, 4], mirror: true },
        { uv: [40, 38], box: [-4, 2, -2, 8, 4, 4], p: { c: '#6d4b34', n: 0.06, faces: { front: (P, [x, y, w, h]) => P.rect(x + 2, y, 4, h, '#b4876a', 0.04) } } },
      ] },
      { name: 'right_leg', label: 'Right leg', pivot: [-2, 12, 0], cubes: [
        { uv: [0, 22], box: [-2, 0, -2, 4, 12, 4], p: { c: '#4a3626', n: 0.06, faces: sides(bottomBand('#2e2219', 2)) } },
      ] },
      { name: 'left_leg', label: 'Left leg', pivot: [2, 12, 0], cubes: [
        { uv: [0, 22], box: [-2, 0, -2, 4, 12, 4], mirror: true },
      ] },
    ],
  }),

  creeper: (() => {
    const skin = { c: '#5ba64a', n: 0.22 };
    const leg = (name, label, x, z) => ({ name, label, pivot: [x, 18, z], cubes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4], p: { ...skin, faces: { bottom: '#3b6f30' } } }] });
    return convertModel({
      textures: { main: { size: [64, 32], paths: ['entity/creeper/creeper.png'] } },
      parts: [
        { name: 'body', label: 'Body', pivot: [0, 18, 0], cubes: [{ uv: [16, 16], box: [-4, -12, -2, 8, 12, 4], p: skin }] },
        { name: 'head', label: 'Head', parent: 'body', pivot: [0, -12, 0], cubes: [{ uv: [0, 0], box: [-4, -8, -4, 8, 8, 8], p: { ...skin, faces: { front: (P, [x, y]) => {
          const k = '#0d140b';
          P.rect(x + 1, y + 2, 2, 2, k); P.rect(x + 5, y + 2, 2, 2, k);
          P.rect(x + 3, y + 4, 2, 1, k); P.rect(x + 2, y + 5, 4, 2, k); P.px(x + 2, y + 7, k); P.px(x + 5, y + 7, k);
        } } } }] },
        leg('back_right_leg', 'Back right leg', -2, 4),
        leg('back_left_leg', 'Back left leg', 2, 4),
        leg('front_right_leg', 'Front right leg', -2, -4),
        leg('front_left_leg', 'Front left leg', 2, -4),
      ],
    });
  })(),

  pig: (() => {
    const skin = { c: '#eea3a1', n: 0.05 };
    const leg = (name, label, x, z) => ({ name, label, pivot: [x, 18, z], cubes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4], p: { c: '#e9999a', n: 0.05, faces: { ...sides(bottomBand('#b8706f', 1)), bottom: '#9a5a5a' } } }] });
    return convertModel({
      textures: { main: { size: [64, 32], paths: ['entity/pig/pig.png'] } },
      parts: [
        { name: 'body', label: 'Body', pivot: [0, 11, 2], rot: [90, 0, 0], cubes: [{ uv: [28, 8], box: [-5, -10, -7, 10, 16, 8], p: skin }] },
        { name: 'head', label: 'Head', pivot: [0, 12, -6], cubes: [
          { uv: [0, 0], box: [-4, -4, -8, 8, 8, 8], p: { ...skin, faces: { front: eyes('#ffffff', '#1a1a1a', 3, 0, 1) } } },
          { uv: [16, 16], box: [-2, 0, -9, 4, 3, 1], p: { c: '#e58f92', n: 0.03, faces: { front: (P, [x, y]) => { P.px(x, y + 1, '#8a4a4a'); P.px(x + 3, y + 1, '#8a4a4a'); } } } },
        ] },
        leg('back_right_leg', 'Back right leg', -3, 7),
        leg('back_left_leg', 'Back left leg', 3, 7),
        leg('front_right_leg', 'Front right leg', -3, -5),
        leg('front_left_leg', 'Front left leg', 3, -5),
      ],
    });
  })(),

  cow: (() => {
    const hide = { c: '#ebebeb', n: 0.04 };
    const leg = (name, label, x, z) => ({ name, label, pivot: [x, 12, z], cubes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4], p: { ...hide, faces: { ...sides(bottomBand('#3a3a3a', 2)), bottom: '#3a3a3a' } } }] });
    return convertModel({
      textures: { main: { size: [64, 32], paths: ['entity/cow/cow.png'] } },
      parts: [
        { name: 'body', label: 'Body', pivot: [0, 5, 2], rot: [90, 0, 0], cubes: [
          { uv: [18, 4], box: [-6, -10, -7, 12, 18, 10], p: { ...hide, faces: { ...sides(blotches('#2b2622', 5)), top: blotches('#2b2622', 3) } } },
          { uv: [52, 0], box: [-2, 2, -8, 4, 6, 1], p: { c: '#e7a3ab', n: 0.04 } },
        ] },
        { name: 'head', label: 'Head', pivot: [0, 4, -8], cubes: [
          { uv: [0, 0], box: [-4, -4, -6, 8, 8, 6], p: { c: '#2f2a26', n: 0.06, faces: { front: all((P, [x, y]) => { P.rect(x + 2, y, 4, 8, '#ebebeb', 0.03); P.rect(x + 2, y + 5, 4, 3, '#c79e8a', 0.03); }, eyes('#ffffff', '#111111', 3, 0, 1)) } } },
          { uv: [22, 0], box: [-5, -5, -4, 1, 3, 1], p: { c: '#ddd5bb', n: 0.03 } },
          { uv: [22, 0], box: [4, -5, -4, 1, 3, 1] },
        ] },
        leg('back_right_leg', 'Back right leg', -4, 7),
        leg('back_left_leg', 'Back left leg', 4, 7),
        leg('front_right_leg', 'Front right leg', -4, -6),
        leg('front_left_leg', 'Front left leg', 4, -6),
      ],
    });
  })(),

  sheep: (() => {
    const face = { c: '#d8c1a6', n: 0.04 };
    const wool = { c: '#e9e9e7', n: 0.06 };
    const leg = (name, label, x, z) => ({ name, label, pivot: [x, 12, z], cubes: [
      { uv: [0, 16], box: [-2, 0, -2, 4, 12, 4], p: face },
      { uv: [0, 16], box: [-2, 0, -2, 4, 6, 4], inflate: 0.5, tex: 'fur', p: wool },
    ] });
    return convertModel({
      textures: {
        main: { size: [64, 32], paths: ['entity/sheep/sheep.png'] },
        fur: { size: [64, 32], paths: ['entity/sheep/sheep_fur.png', 'entity/sheep/sheep_wool.png'] },
      },
      parts: [
        { name: 'body', label: 'Body', pivot: [0, 5, 2], rot: [90, 0, 0], cubes: [
          { uv: [28, 8], box: [-4, -10, -7, 8, 16, 6], p: { c: '#d0c8bc', n: 0.04 } },
          { uv: [28, 8], box: [-4, -10, -7, 8, 16, 6], inflate: 1.75, tex: 'fur', p: wool },
        ] },
        { name: 'head', label: 'Head', pivot: [0, 6, -8], cubes: [
          { uv: [0, 0], box: [-3, -4, -6, 6, 6, 8], p: { ...face, faces: { front: eyes('#ffffff', '#222', 2, 0, 1) } } },
          { uv: [0, 0], box: [-3, -4, -4, 6, 6, 6], inflate: 0.6, tex: 'fur', p: { ...wool, faces: { front: (P, [x, y, w, h]) => P.clear(x + 1, y + 2, w - 2, h - 2), bottom: (P, r) => P.clear(...r) } } },
        ] },
        leg('back_right_leg', 'Back right leg', -3, 7),
        leg('back_left_leg', 'Back left leg', 3, 7),
        leg('front_right_leg', 'Front right leg', -3, -5),
        leg('front_left_leg', 'Front left leg', 3, -5),
      ],
    });
  })(),

  chicken: convertModel({
    textures: { main: { size: [64, 32], paths: ['entity/chicken.png', 'entity/chicken/chicken.png'] } },
    parts: [
      { name: 'body', label: 'Body', pivot: [0, 16, 0], rot: [90, 0, 0], cubes: [{ uv: [0, 9], box: [-3, -4, -3, 6, 8, 6], p: { c: '#f2f2f2', n: 0.04 } }] },
      { name: 'head', label: 'Head', pivot: [0, 15, -4], cubes: [
        { uv: [0, 0], box: [-2, -6, -2, 4, 6, 3], p: { c: '#f2f2f2', n: 0.03, faces: { front: eyes('#f2f2f2', '#111', 1, 0, 0) } } },
        { uv: [14, 0], box: [-2, -4, -4, 4, 2, 2], p: { c: '#f0ad26', n: 0.03 } },
        { uv: [14, 4], box: [-1, -2, -3, 2, 2, 2], p: { c: '#d2261e', n: 0.03 } },
      ] },
      { name: 'right_wing', label: 'Right wing', pivot: [-4, 13, 0], cubes: [{ uv: [24, 13], box: [0, 0, -3, 1, 4, 6], p: { c: '#e6e6e6', n: 0.04 } }] },
      { name: 'left_wing', label: 'Left wing', pivot: [4, 13, 0], cubes: [{ uv: [24, 13], box: [-1, 0, -3, 1, 4, 6] }] },
      { name: 'right_leg', label: 'Right leg', pivot: [-2, 19, 1], cubes: [{ uv: [26, 0], box: [-1, 0, -3, 3, 5, 3], p: { c: '#f0ad26', faces: { ...sides(chickenLeg), top: (P, r) => P.clear(...r) } } }] },
      { name: 'left_leg', label: 'Left leg', pivot: [1, 19, 1], cubes: [{ uv: [26, 0], box: [-1, 0, -3, 3, 5, 3] }] },
    ],
  }),

  wolf: (() => {
    const fur = { c: '#d6d2cd', n: 0.05 };
    const leg = (name, label, x, z) => ({ name, label, pivot: [x, 16, z], cubes: [{ uv: [0, 18], box: [0, 0, -1, 2, 8, 2], p: fur }] });
    return convertModel({
      textures: { main: { size: [64, 32], paths: ['entity/wolf/wolf.png'] } },
      parts: [
        { name: 'body', label: 'Body', pivot: [0, 14, 2], rot: [90, 0, 0], cubes: [{ uv: [18, 14], box: [-3, -2, -3, 6, 9, 6], p: fur }] },
        { name: 'mane', label: 'Mane', pivot: [-1, 14, -3], rot: [90, 0, 0], cubes: [{ uv: [21, 0], box: [-3, -3, -3, 8, 6, 7], p: { c: '#cbc6c0', n: 0.06 } }] },
        { name: 'head', label: 'Head', pivot: [-1, 13.5, -7], cubes: [
          { uv: [0, 0], box: [-2, -3, -2, 6, 6, 4], p: { ...fur, faces: { front: (P, [x, y]) => { P.px(x + 1, y + 2, '#151515'); P.px(x + 4, y + 2, '#151515'); } } } },
          { uv: [16, 14], box: [-2, -5, 0, 2, 2, 1], p: { c: '#b9b3ac' } },
          { uv: [16, 14], box: [2, -5, 0, 2, 2, 1] },
          { uv: [0, 10], box: [-0.5, 0, -5, 3, 3, 4], p: { c: '#cfc9c2', n: 0.04, faces: { front: topBand('#1c1c1c', 1) } } },
        ] },
        { name: 'tail', label: 'Tail', pivot: [-1, 12, 8], rot: [36, 0, 0], cubes: [{ uv: [9, 18], box: [0, 0, -1, 2, 8, 2], p: { c: '#cbc6c0', n: 0.05 } }] },
        leg('back_right_leg', 'Back right leg', -2.5, 7),
        leg('back_left_leg', 'Back left leg', 0.5, 7),
        leg('front_right_leg', 'Front right leg', -2.5, -4),
        leg('front_left_leg', 'Front left leg', 0.5, -4),
      ],
    });
  })(),

  spider: (() => {
    const leg = { c: '#2a221f', n: 0.1 };
    // Rest pose from the vanilla spider animation at time zero.
    const legs = [
      ['1', -1, 45, 45], ['2', 0, 33.3, 22.5], ['3', 1, 33.3, -22.5], ['4', 2, 45, -45],
    ];
    const parts = [];
    for (const [n, z, zr, yr] of legs) {
      parts.push({ name: `right_leg_${n}`, label: `Right leg ${n}`, pivot: [-4, 15, z], rot: [0, -yr, -zr], cubes: [{ uv: [18, 0], box: [-15, -1, -1, 16, 2, 2], p: leg }] });
      parts.push({ name: `left_leg_${n}`, label: `Left leg ${n}`, pivot: [4, 15, z], rot: [0, yr, zr], cubes: [{ uv: [18, 0], box: [-1, -1, -1, 16, 2, 2] }] });
    }
    return convertModel({
      textures: { main: { size: [64, 32], paths: ['entity/spider/spider.png'] } },
      parts: [
        { name: 'body', label: 'Abdomen', pivot: [0, 15, 9], cubes: [{ uv: [0, 12], box: [-5, -4, -6, 10, 8, 12], p: { c: '#2f2723', n: 0.1, faces: { top: blotches('#4a1c18', 2) } } }] },
        { name: 'thorax', label: 'Thorax', pivot: [0, 15, 0], cubes: [{ uv: [0, 0], box: [-3, -3, -3, 6, 6, 6], p: { c: '#2a221f', n: 0.1 } }] },
        { name: 'head', label: 'Head', pivot: [0, 15, -3], cubes: [{ uv: [32, 4], box: [-4, -4, -8, 8, 8, 8], p: { c: '#2f2723', n: 0.1, faces: { front: (P, [x, y]) => {
          const r = '#d11f1f';
          P.rect(x + 1, y + 3, 2, 1, r); P.rect(x + 5, y + 3, 2, 1, r); P.px(x + 3, y + 2, r); P.px(x + 4, y + 2, r); P.px(x + 2, y + 4, r); P.px(x + 5, y + 4, r);
        } } } }] },
        ...parts,
      ],
    });
  })(),

  slime: convertModel({
    textures: { main: { size: [64, 32], paths: ['entity/slime/slime.png'] } },
    parts: [
      { name: 'body', label: 'Body', pivot: [0, 24, 0], cubes: [
        { uv: [0, 16], box: [-3, -7, -3, 6, 6, 6], p: { c: '#6fbf5a', n: 0.06 } },
        { uv: [32, 0], box: [-3.25, -6, -3.5, 2, 2, 2], p: { c: '#1d3a17' } },
        { uv: [32, 4], box: [1.25, -6, -3.5, 2, 2, 2], p: { c: '#1d3a17' } },
        { uv: [32, 8], box: [0, -3, -3.5, 1, 1, 1], p: { c: '#1d3a17' } },
        { uv: [0, 0], box: [-4, -8, -4, 8, 8, 8], translucent: true, p: { c: '#7fd468', n: 0.08, a: 120 } },
      ] },
    ],
  }),

  bee: convertModel({
    textures: { main: { size: [64, 64], paths: ['entity/bee/bee.png'] } },
    parts: [
      { name: 'body', label: 'Body', pivot: [0, 19, 0], cubes: [
        { uv: [0, 0], box: [-3.5, -4, -5, 7, 7, 10], p: { c: '#f0c22c', n: 0.05, faces: {
          left: (P, [x, y, w, h]) => { P.rect(x + 3, y, 2, h, '#3a2a12'); P.rect(x + 7, y, 1, h, '#3a2a12'); },
          right: (P, [x, y, w, h]) => { P.rect(x + w - 5, y, 2, h, '#3a2a12'); P.rect(x + w - 8, y, 1, h, '#3a2a12'); },
          top: (P, [x, y, w]) => { P.rect(x, y + 2, w, 2, '#3a2a12'); P.rect(x, y + 6, w, 1, '#3a2a12'); },
          front: (P, [x, y, w]) => { P.rect(x, y + 2, 2, 3, '#1b1b1b'); P.rect(x + w - 2, y + 2, 2, 3, '#1b1b1b'); P.px(x, y + 2, '#ffffff'); P.px(x + w - 1, y + 2, '#ffffff'); },
        } } },
        { uv: [26, 7], box: [0, -1, 5, 0, 1, 2], p: { c: '#2a2a2a' } },
      ] },
      { name: 'antennae', label: 'Antennae', parent: 'body', pivot: [0, -2, -5], cubes: [
        { uv: [2, 0], box: [1.5, -2, -3, 1, 2, 3], p: { c: '#2a2a2a' } },
        { uv: [2, 3], box: [-2.5, -2, -3, 1, 2, 3], p: { c: '#2a2a2a' } },
      ] },
      { name: 'right_wing', label: 'Right wing', parent: 'body', pivot: [-1.5, -4, -3], rot: [0, -15, 0], cubes: [
        { uv: [0, 18], box: [-9, 0, 0, 9, 0, 6], translucent: true, p: { c: '#dff2ff', a: 150 } },
      ] },
      { name: 'left_wing', label: 'Left wing', parent: 'body', pivot: [1.5, -4, -3], rot: [0, 15, 0], cubes: [
        { uv: [0, 18], box: [0, 0, 0, 9, 0, 6], mirror: true, translucent: true },
      ] },
      { name: 'front_legs', label: 'Front legs', parent: 'body', pivot: [1.5, 3, -2], cubes: [{ uv: [26, 1], box: [-5, 0, 0, 7, 2, 0], p: { c: '#2a2a2a' } }] },
      { name: 'middle_legs', label: 'Middle legs', parent: 'body', pivot: [1.5, 3, 0], cubes: [{ uv: [26, 3], box: [-5, 0, 0, 7, 2, 0], p: { c: '#2a2a2a' } }] },
      { name: 'back_legs', label: 'Back legs', parent: 'body', pivot: [1.5, 3, 2], cubes: [{ uv: [26, 5], box: [-5, 0, 0, 7, 2, 0], p: { c: '#2a2a2a' } }] },
    ],
  }),
};

/* Official default-skin files for the built-in character presets. */
const HUMAN_SKIN_PATHS = {
  classic: ['entity/player/wide/steve.png', 'entity/steve.png'],
  slim: ['entity/player/slim/alex.png', 'entity/alex.png'],
  zombie: ['entity/zombie/zombie.png'],
};

export function getModelDef(tl) {
  if (tl.ref === 'human') {
    const slim = tl.slim ?? HUMAN_SKINS[tl.variant]?.slim;
    return slim ? MODELS.human_slim : MODELS.human;
  }
  return MODELS[tl.ref] || MODELS.human;
}

export function modelDefs() {
  return MODELS;
}

export function modelBones(ref) {
  return (MODELS[ref] || MODELS.human).bones;
}

/* ---------- Textures ---------- */

function paintModelTexture(def, name, seed) {
  const [w, h] = def.textures[name].size;
  const P = new Painter(w, h, seed);
  P.clear(0, 0, w, h);
  for (const b of def.bones) for (const box of b.boxes) {
    if (!box.p || box.tex !== name) continue;
    const [bw, bh, bd] = box.size.map((v) => Math.ceil(v));
    const F = boxUV(box.uv[0], box.uv[1], bw, bh, bd);
    for (const [face, r] of Object.entries(F)) {
      if (r[2] <= 0 || r[3] <= 0) continue;
      const spec = box.p.faces?.[face];
      let base = typeof spec === 'string' ? spec : box.p.c;
      if (face === 'bottom' && typeof spec !== 'string') base = shade(base, 0.82);
      P.rect(r[0], r[1], r[2], r[3], base, box.p.n || 0, box.p.a ?? 255);
      if (typeof spec === 'function') spec(P, r);
    }
  }
  return P.finish();
}

let textureCache = new Map();
const itemGeoCache = new Map();

function makeTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* Drops cached textures so newly imported official textures take effect. */
export function clearTextureCache() {
  for (const t of textureCache.values()) t.texture?.dispose();
  textureCache = new Map();
  itemGeoCache.clear();
}

function cached(key, make) {
  if (!textureCache.has(key)) {
    const canvas = make();
    textureCache.set(key, { canvas, texture: makeTexture(canvas) });
  }
  return textureCache.get(key);
}

/*
 * Resolves every texture a model uses. Each entry carries the canvas, the GPU
 * texture and the layout size the UVs are written against.
 */
export function getModelTextures(tl, customCanvas) {
  const def = getModelDef(tl);
  const out = {};
  for (const [name, spec] of Object.entries(def.textures)) {
    if (name === 'main' && customCanvas) {
      out[name] = { canvas: customCanvas, texture: makeTexture(customCanvas), size: spec.size, owned: true };
      continue;
    }
    let entry;
    if (tl.ref === 'human') {
      const variant = tl.variant || 'classic';
      const official = firstPackImage(HUMAN_SKIN_PATHS[variant]);
      entry = cached(`human:${variant}:${official ? 'pack' : 'gen'}`, () => official || paintHumanSkin(variant));
    } else {
      const official = firstPackImage(spec.paths);
      entry = cached(`model:${tl.ref}:${name}:${official ? 'pack' : 'gen'}`,
        () => official || (spec.procedural ? spec.procedural() : paintModelTexture(def, name, 300 + tl.ref.length * 17)));
    }
    out[name] = { ...entry, size: spec.size };
  }
  return out;
}

/* ---------- Block textures ---------- */

/*
 * Official block texture names per face, plus biome tints for the textures
 * Minecraft stores in grayscale. Default plains colors.
 */
const GRASS = '#91bd59', FOLIAGE = '#77ab2f', WATER = '#3f76e4';
const MC_BLOCKS = {
  grass: { top: ['grass_block_top', GRASS], bottom: 'dirt', side: 'grass_block_side', sideOverlay: ['grass_block_side_overlay', GRASS] },
  dirt: { all: 'dirt' },
  stone: { all: 'stone' },
  cobblestone: { all: 'cobblestone' },
  oak_planks: { all: 'oak_planks' },
  oak_log: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' },
  bricks: { all: 'bricks' },
  sand: { all: 'sand' },
  glass: { all: 'glass' },
  leaves: { all: ['oak_leaves', FOLIAGE] },
  tnt: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' },
  crafting_table: { top: 'crafting_table_top', bottom: 'oak_planks', front: 'crafting_table_front', back: 'crafting_table_side', left: 'crafting_table_front', right: 'crafting_table_side' },
  bookshelf: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' },
  pumpkin: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'carved_pumpkin' },
  gold_block: { all: 'gold_block' },
  diamond_block: { all: 'diamond_block' },
  iron_block: { all: 'iron_block' },
  glowstone: { all: 'glowstone' },
  obsidian: { all: 'obsidian' },
  white_wool: { all: 'white_wool' },
  red_wool: { all: 'red_wool' },
  blue_wool: { all: 'blue_wool' },
  water: { all: ['water_still', WATER] },
};

const blockPath = (n) => `block/${n}.png`;

function faceSpec(m, face) {
  return m[face] || ((face === 'top' || face === 'bottom') ? m.all : (m.side || m.all)) || m.all;
}

/* Draws a texture frame (first frame of animated strips), optionally tinted. */
function drawFace(ctx, img, x, size, tint) {
  const fw = img.width;
  const tmp = document.createElement('canvas');
  tmp.width = size; tmp.height = size;
  const t = tmp.getContext('2d');
  t.imageSmoothingEnabled = false;
  t.drawImage(img, 0, 0, fw, fw, 0, 0, size, size);
  if (tint) {
    t.globalCompositeOperation = 'multiply';
    t.fillStyle = tint;
    t.fillRect(0, 0, size, size);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(img, 0, 0, fw, fw, 0, 0, size, size);
  }
  ctx.drawImage(tmp, x, 0);
}

function officialBlockAtlas(id) {
  const m = MC_BLOCKS[id];
  if (!m) return null;
  const faces = BLOCK_FACE_ORDER.map((f) => {
    const s = faceSpec(m, f);
    const [name, tint] = Array.isArray(s) ? s : [s, null];
    return { img: packImage(blockPath(name)), tint, face: f };
  });
  if (faces.some((f) => !f.img)) return null;
  const size = Math.max(16, ...faces.map((f) => f.img.width));
  const c = document.createElement('canvas');
  c.width = size * 6; c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  faces.forEach((f, i) => {
    drawFace(ctx, f.img, i * size, size, f.tint);
    const isSide = f.face !== 'top' && f.face !== 'bottom';
    if (isSide && m.sideOverlay) {
      const ov = packImage(blockPath(m.sideOverlay[0]));
      if (ov) drawFace(ctx, ov, i * size, size, m.sideOverlay[1]);
    }
  });
  return c;
}

export function getBlockTexture(id) {
  const official = officialBlockAtlas(id);
  return cached(`block:${id}:${official ? 'pack' : 'gen'}`, () => official || paintBlockAtlas(id));
}

/* Single face texture usable with repeat wrapping (for shapes and the ground). */
export function getBlockFaceTexture(id, face = 'front') {
  const atlas = getBlockTexture(id).canvas;
  const key = `face:${id}:${face}:${atlas.width}`;
  if (!textureCache.has(key)) {
    const s = atlas.height;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const i = BLOCK_FACE_ORDER.indexOf(face);
    c.getContext('2d').drawImage(atlas, i * s, 0, s, s, 0, 0, s, s);
    const t = makeTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    textureCache.set(key, { canvas: c, texture: t });
  }
  return textureCache.get(key);
}

/* ---------- Item textures ---------- */

const ITEM_PATHS = { torch: ['block/torch.png'] };

function itemPaths(id) {
  return ITEM_PATHS[id] || [`item/${id}.png`];
}

export function getItemTexture(id) {
  const official = firstPackImage(itemPaths(id));
  return cached(`item:${id}:${official ? 'pack' : 'gen'}`, () => {
    if (official) {
      // Normalise to a square sprite (first animation frame) of at most 32px for extrusion.
      const s = Math.min(32, official.width);
      const c = document.createElement('canvas');
      c.width = s; c.height = s;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(official, 0, 0, official.width, official.width, 0, 0, s, s);
      return c;
    }
    const it = ITEM_MAP[id] || ITEMS[0];
    return paintItem(it.kind, it.mat);
  });
}

/* Every texture path the app can use from an imported pack. */
export function texturePaths() {
  const set = new Set();
  for (const def of Object.values(MODELS)) for (const t of Object.values(def.textures)) for (const p of t.paths || []) set.add(p);
  for (const list of Object.values(HUMAN_SKIN_PATHS)) list.forEach((p) => set.add(p));
  for (const m of Object.values(MC_BLOCKS)) {
    for (const v of Object.values(m)) set.add(blockPath(Array.isArray(v) ? v[0] : v));
  }
  for (const it of ITEMS) itemPaths(it.id).forEach((p) => set.add(p));
  return [...set];
}

/* =====================================================================
   Geometry
   ===================================================================== */

class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }

  quad(corners, normal, uvRect, texW, texH, flipU = false, flipV = false) {
    const base = this.pos.length / 3;
    const e = 0.01;
    let [u0, v0, u1, v1] = uvRect;
    u0 += e; u1 -= e; v0 += e; v1 -= e;
    if (flipU) [u0, u1] = [u1, u0];
    if (flipV) [v0, v1] = [v1, v0];
    const uvs = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]];
    for (let i = 0; i < 4; i++) {
      this.pos.push(...corners[i]);
      this.nor.push(...normal);
      this.uv.push(uvs[i][0] / texW, 1 - uvs[i][1] / texH);
    }
    this.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  get empty() { return this.idx.length === 0; }
}

function boxRects(box) {
  if (box.faces) return box.faces;
  const [w, h, d] = box.size;
  return boxUV(box.uv[0], box.uv[1], w, h, d);
}

function addBox(gb, box, origin, slice, texW, texH) {
  const inf = box.inflate || 0;
  const [fx, fy, fz] = box.from;
  const [w, h, d] = box.size;
  const x0 = fx - inf - origin[0], x1 = fx + w + inf - origin[0];
  const y0 = fy - inf, y1 = fy + h + inf;
  const z0 = fz - inf - origin[2], z1 = fz + d + inf - origin[2];
  let sy0 = y0, sy1 = y1;
  if (slice) {
    sy0 = Math.max(y0, slice[0]);
    sy1 = Math.min(y1, slice[1]);
    if (sy1 - sy0 <= 1e-6 && h > 0) return;
  }
  const H = y1 - y0 || 1;
  const fTop = (y1 - sy1) / H, fBot = (y1 - sy0) / H;
  const R = boxRects(box);
  const mirror = !!box.mirror;
  const ya = sy0 - origin[1], yb = sy1 - origin[1];

  const rect = (r) => [r[0], r[1], r[0] + r[2], r[1] + r[3]];
  const sideRect = (r) => [r[0], r[1] + fTop * r[3], r[0] + r[2], r[1] + fBot * r[3]];
  const left = mirror ? R.right : R.left;
  const right = mirror ? R.left : R.right;

  if (R.front) gb.quad([[x0, yb, z1], [x1, yb, z1], [x0, ya, z1], [x1, ya, z1]], [0, 0, 1], sideRect(R.front), texW, texH, mirror);
  if (R.back) gb.quad([[x1, yb, z0], [x0, yb, z0], [x1, ya, z0], [x0, ya, z0]], [0, 0, -1], sideRect(R.back), texW, texH, mirror);
  if (right) gb.quad([[x0, yb, z0], [x0, yb, z1], [x0, ya, z0], [x0, ya, z1]], [-1, 0, 0], sideRect(right), texW, texH, mirror);
  if (left) gb.quad([[x1, yb, z1], [x1, yb, z0], [x1, ya, z1], [x1, ya, z0]], [1, 0, 0], sideRect(left), texW, texH, mirror);
  if (R.top && sy1 >= y1 - 1e-6) gb.quad([[x0, yb, z0], [x1, yb, z0], [x0, yb, z1], [x1, yb, z1]], [0, 1, 0], rect(R.top), texW, texH, mirror);
  if (R.bottom && sy0 <= y0 + 1e-6) gb.quad([[x0, ya, z1], [x1, ya, z1], [x0, ya, z0], [x1, ya, z0]], [0, -1, 0], rect(R.bottom), texW, texH, mirror, !box.faces);
}

/* Layout units -> texture coordinates; supports HD packs and 64x64 files using a 64x32 layout. */
function texUnits(tex) {
  const w = tex.size[0];
  return [w, tex.canvas.height * (w / tex.canvas.width)];
}

function regionEmpty(tex, box) {
  const { canvas } = tex;
  if (!canvas._alpha) canvas._alpha = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  const a = canvas._alpha, W = canvas.width, H = canvas.height;
  const k = W / tex.size[0];
  for (const r of Object.values(boxRects(box))) {
    const x0 = Math.floor(r[0] * k), y0 = Math.floor(r[1] * k), x1 = Math.ceil((r[0] + r[2]) * k), y1 = Math.ceil((r[1] + r[3]) * k);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (x >= 0 && y >= 0 && x < W && y < H && a[(y * W + x) * 4 + 3] > 0) return false;
    }
  }
  return true;
}

export function modelMaterial(texture, translucent = false) {
  return new THREE.MeshLambertMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: 0x000000,
    alphaTest: translucent ? 0 : 0.1,
    transparent: translucent,
    depthWrite: !translucent,
    side: THREE.DoubleSide,
  });
}

function meshesFor(boxes, origin, slice, texs, parent) {
  const out = [];
  for (const [name, tex] of Object.entries(texs)) {
    const [tw, th] = texUnits(tex);
    for (const translucent of [false, true]) {
      const gb = new GeoBuilder();
      for (const box of boxes) if ((box.tex || 'main') === name && !!box.translucent === translucent) addBox(gb, box, origin, slice, tw, th);
      if (gb.empty) continue;
      const mesh = new THREE.Mesh(gb.build(), modelMaterial(tex.texture, translucent));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.baseTransparent = translucent;
      parent.add(mesh);
      out.push(mesh);
    }
  }
  return out;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/* Picks the boxes to draw for a texture set: hides empty overlay layers and applies left-limb fallbacks. */
function resolveBoxes(boxes, texs) {
  const out = [];
  for (const box of boxes) {
    const tex = texs[box.tex || 'main'];
    if (!tex) continue;
    if (box.overlay && regionEmpty(tex, box)) continue;
    if (box.fallback && regionEmpty(tex, box)) out.push({ ...box, uv: box.fallback.uv, mirror: box.fallback.mirror });
    else out.push(box);
  }
  return out;
}

export function buildModel(def, texs) {
  const root = new THREE.Group();
  const parts = {};
  for (const bone of def.bones) {
    const parentPart = bone.parent ? parts[bone.parent] : null;
    const parentOrigin = parentPart ? parentPart.containerOrigin : [0, 0, 0];
    const offset = new THREE.Group();
    offset.position.fromArray(sub(bone.pivot, parentOrigin));
    if (bone.rot) offset.rotation.set(bone.rot[0] * DEG, bone.rot[1] * DEG, bone.rot[2] * DEG, 'ZYX');
    const anim = new THREE.Group();
    offset.add(anim);
    (parentPart ? parentPart.container : root).add(offset);

    const boxes = resolveBoxes(bone.boxes, texs);
    const meshes = [];
    let container = anim, containerOrigin = bone.pivot, bendGroup = null;
    if (bone.bend) {
      const at = bone.bend.at;
      const bp = [bone.pivot[0], at, bone.pivot[2]];
      bendGroup = new THREE.Group();
      bendGroup.position.fromArray(sub(bp, bone.pivot));
      anim.add(bendGroup);
      const lower = [-1e9, at], upper = [at, 1e9];
      const moving = bone.bend.part === 'lower' ? lower : upper;
      const fixed = bone.bend.part === 'lower' ? upper : lower;
      meshes.push(...meshesFor(boxes, bone.pivot, fixed, texs, anim));
      meshes.push(...meshesFor(boxes, bp, moving, texs, bendGroup));
      container = bendGroup;
      containerOrigin = bp;
    } else {
      meshes.push(...meshesFor(boxes, bone.pivot, null, texs, anim));
    }
    parts[bone.name] = { offset, anim, bendGroup, container, containerOrigin, meshes, bend: bone.bend };
  }
  return { root, parts };
}

/* Blocks: 16x16x16 cube, origin at bottom center. */
const BLOCK_RECTS = { top: [0, 0, 16, 16], bottom: [16, 0, 16, 16], front: [32, 0, 16, 16], back: [48, 0, 16, 16], left: [64, 0, 16, 16], right: [80, 0, 16, 16] };
let blockGeo = null;
export function blockGeometry() {
  if (!blockGeo) {
    const gb = new GeoBuilder();
    addBox(gb, { from: [-8, 0, -8], size: [16, 16, 16], faces: BLOCK_RECTS }, [0, 0, 0], null, 96, 16);
    blockGeo = gb.build();
  }
  return blockGeo;
}

export function blockMaterial(id) {
  const def = BLOCK_MAP[id] || BLOCKS[0];
  const tex = getBlockTexture(id).texture;
  const m = modelMaterial(tex, !!def.translucent);
  m.side = def.translucent || def.cutout ? THREE.DoubleSide : THREE.FrontSide;
  m.userData.emissiveBase = def.emissive ? 1 : 0;
  return m;
}

/* Items: extruded sprite one pixel deep, 16 units wide. Origin at bottom center. */
export function itemGeometry(id) {
  if (itemGeoCache.has(id)) return itemGeoCache.get(id);
  const { canvas } = getItemTexture(id);
  const N = canvas.width;
  const k = 16 / N;
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, N, N).data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < N && y < N && data[(y * N + x) * 4 + 3] > 0;
  const gb = new GeoBuilder();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!solid(x, y)) continue;
    const X0 = x * k - 8, X1 = (x + 1) * k - 8, Y1 = 16 - y * k, Y0 = 16 - (y + 1) * k, Z0 = -k / 2, Z1 = k / 2;
    const r = [x + 0.3, y + 0.3, x + 0.7, y + 0.7];
    gb.quad([[X0, Y1, Z1], [X1, Y1, Z1], [X0, Y0, Z1], [X1, Y0, Z1]], [0, 0, 1], r, N, N);
    gb.quad([[X1, Y1, Z0], [X0, Y1, Z0], [X1, Y0, Z0], [X0, Y0, Z0]], [0, 0, -1], r, N, N);
    if (!solid(x - 1, y)) gb.quad([[X0, Y1, Z0], [X0, Y1, Z1], [X0, Y0, Z0], [X0, Y0, Z1]], [-1, 0, 0], r, N, N);
    if (!solid(x + 1, y)) gb.quad([[X1, Y1, Z1], [X1, Y1, Z0], [X1, Y0, Z1], [X1, Y0, Z0]], [1, 0, 0], r, N, N);
    if (!solid(x, y - 1)) gb.quad([[X0, Y1, Z0], [X1, Y1, Z0], [X0, Y1, Z1], [X1, Y1, Z1]], [0, 1, 0], r, N, N);
    if (!solid(x, y + 1)) gb.quad([[X0, Y0, Z1], [X1, Y0, Z1], [X0, Y0, Z0], [X1, Y0, Z0]], [0, -1, 0], r, N, N);
  }
  const g = gb.build();
  itemGeoCache.set(id, g);
  return g;
}

/* ---------- Scenery (voxel structures) ---------- */

function sceneryTree(list, ox = 0, oy = 0, oz = 0, h = 5) {
  for (let y = 0; y < h; y++) list.push([ox, oy + y, oz, 'oak_log']);
  for (let y = h - 2; y <= h + 1; y++) {
    const r = y >= h ? 1 : 2;
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      if (x === 0 && z === 0 && y < h) continue;
      if (Math.abs(x) === r && Math.abs(z) === r && (y === h + 1 || (r === 2 && (x + z + y) % 2 === 0))) continue;
      list.push([ox + x, oy + y, oz + z, 'leaves']);
    }
  }
  return list;
}

function sceneryCottage() {
  const L = [];
  for (let x = -3; x <= 3; x++) for (let z = -2; z <= 2; z++) for (let y = 0; y < 4; y++) {
    const edgeX = Math.abs(x) === 3, edgeZ = Math.abs(z) === 2;
    if (!edgeX && !edgeZ) continue;
    let b = y === 0 ? 'cobblestone' : 'oak_planks';
    if (edgeX && edgeZ) b = 'oak_log';
    if (z === 2 && x === 0 && (y === 1 || y === 2)) continue;
    if (y === 2 && ((z === 2 && Math.abs(x) === 2) || (edgeX && z === 0))) b = 'glass';
    L.push([x, y, z, b]);
  }
  for (let level = 0; level < 4; level++) {
    const zr = 3 - level;
    for (let x = -4; x <= 4; x++) for (let z = -zr; z <= zr; z++) {
      if (Math.abs(z) === zr || level === 3) L.push([x, 4 + level, z, 'bricks']);
      else if (Math.abs(x) === 3) L.push([x, 4 + level, z, 'oak_planks']);
    }
  }
  return L;
}

function sceneryIsland() {
  const L = [];
  const layers = [[3, 3.6, 'grass'], [2, 3.1, 'dirt'], [1, 2.2, 'dirt'], [0, 1.2, 'stone']];
  for (const [y, r, b] of layers) {
    const ri = Math.ceil(r);
    for (let x = -ri; x <= ri; x++) for (let z = -ri; z <= ri; z++) if (Math.hypot(x, z) <= r) L.push([x, y, z, b]);
  }
  sceneryTree(L, 1, 4, -1, 4);
  return L;
}

function sceneryWell() {
  const L = [];
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    L.push([x, 0, z, x === 0 && z === 0 ? 'water' : 'cobblestone']);
  }
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { L.push([x, 1, z, 'oak_log']); L.push([x, 2, z, 'oak_log']); }
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) L.push([x, 3, z, 'oak_planks']);
  L.push([0, 4, 0, 'oak_planks']);
  return L;
}

function sceneryRuins() {
  const L = [];
  for (const [x, z, h] of [[-2, -2, 3], [-1, -2, 2], [0, -2, 1], [1, -2, 3], [2, -2, 2], [-2, -1, 2], [-2, 0, 1], [2, 0, 1], [-2, 1, 2]]) {
    for (let y = 0; y < h; y++) L.push([x, y, z, (x + y + z) % 3 ? 'cobblestone' : 'stone']);
  }
  L.push([0, 0, 0, 'crafting_table']);
  L.push([1, 0, 1, 'pumpkin']);
  return L;
}

const SCENERY = {
  oak_tree: { name: 'Oak tree', build: () => sceneryTree([]) },
  cottage: { name: 'Cottage', build: sceneryCottage },
  island: { name: 'Floating island', build: sceneryIsland },
  well: { name: 'Well', build: sceneryWell },
  ruins: { name: 'Ruins', build: sceneryRuins },
};

const sceneryCache = new Map();
export function buildScenery(id) {
  if (!sceneryCache.has(id)) {
    const list = (SCENERY[id] || SCENERY.oak_tree).build();
    const opaque = new Set();
    for (const [x, y, z, b] of list) {
      const def = BLOCK_MAP[b];
      if (!def.cutout && !def.translucent) opaque.add(`${x},${y},${z}`);
    }
    const byBlock = new Map();
    const dirs = [
      ['front', [0, 0, 1]], ['back', [0, 0, -1]], ['left', [1, 0, 0]], ['right', [-1, 0, 0]], ['top', [0, 1, 0]], ['bottom', [0, -1, 0]],
    ];
    for (const [x, y, z, b] of list) {
      if (!byBlock.has(b)) byBlock.set(b, new GeoBuilder());
      const gb = byBlock.get(b);
      const faces = {};
      for (const [f, [dx, dy, dz]] of dirs) faces[f] = opaque.has(`${x + dx},${y + dy},${z + dz}`) ? null : BLOCK_RECTS[f];
      addBox(gb, { from: [x * 16 - 8, y * 16, z * 16 - 8], size: [16, 16, 16], faces }, [0, 0, 0], null, 96, 16);
    }
    sceneryCache.set(id, [...byBlock.entries()].map(([b, gb]) => [b, gb.build()]));
  }
  return sceneryCache.get(id);
}

/* =====================================================================
   Library catalog
   ===================================================================== */

export const CATEGORIES = [
  { id: 'characters', label: 'Characters', icon: 'person' },
  { id: 'mobs', label: 'Mobs', icon: 'paw' },
  { id: 'blocks', label: 'Blocks', icon: 'cube' },
  { id: 'items', label: 'Items', icon: 'sword' },
  { id: 'scenery', label: 'Scenery', icon: 'tree' },
  { id: 'shapes', label: 'Shapes', icon: 'shapes' },
  { id: 'special', label: 'Cameras & lights', icon: 'camera' },
];

export const SHAPES = [
  { id: 'cube', name: 'Cube' }, { id: 'sphere', name: 'Sphere' }, { id: 'cylinder', name: 'Cylinder' },
  { id: 'cone', name: 'Cone' }, { id: 'plane', name: 'Surface' }, { id: 'torus', name: 'Torus' },
];

export const MOB_LIST = [
  ['zombie', 'Zombie'], ['skeleton', 'Skeleton'], ['creeper', 'Creeper'], ['enderman', 'Enderman'],
  ['spider', 'Spider'], ['slime', 'Slime'], ['pig', 'Pig'], ['cow', 'Cow'], ['sheep', 'Sheep'],
  ['chicken', 'Chicken'], ['wolf', 'Wolf'], ['bee', 'Bee'],
];

export const CATALOG = [
  ...Object.entries(HUMAN_SKINS).filter(([k]) => k !== 'zombie').map(([k, s]) => ({
    id: 'char_' + k, cat: 'characters', name: s.name, sub: s.slim ? 'Character, slim arms' : 'Character', type: 'model', ref: 'human', variant: k,
  })),
  { id: 'char_villager', cat: 'characters', name: 'Villager', sub: 'Character', type: 'model', ref: 'villager' },
  ...MOB_LIST.map(([id, name, ref, variant]) => ({ id: 'mob_' + id, cat: 'mobs', name, sub: 'Mob', type: 'model', ref: ref || id, variant })),
  ...BLOCKS.map((b) => ({ id: 'block_' + b.id, cat: 'blocks', name: b.name, sub: 'Block', type: 'block', ref: b.id })),
  ...ITEMS.map((i) => ({ id: 'item_' + i.id, cat: 'items', name: i.name, sub: 'Item', type: 'item', ref: i.id })),
  ...Object.entries(SCENERY).map(([k, s]) => ({ id: 'scenery_' + k, cat: 'scenery', name: s.name, sub: 'Scenery', type: 'scenery', ref: k })),
  ...SHAPES.map((s) => ({ id: 'shape_' + s.id, cat: 'shapes', name: s.name, sub: 'Shape', type: 'shape', ref: s.id })),
  { id: 'cam', cat: 'special', name: 'Camera', sub: 'Camera', type: 'camera', ref: 'camera', icon: 'camera' },
  { id: 'pointlight', cat: 'special', name: 'Point light', sub: 'Light', type: 'pointlight', ref: 'pointlight', icon: 'bulb' },
  { id: 'spotlight', cat: 'special', name: 'Spot light', sub: 'Light', type: 'spotlight', ref: 'spotlight', icon: 'spot' },
];

export function catalogName(tl) {
  const e = CATALOG.find((c) => c.type === tl.type && c.ref === tl.ref && (!c.variant || c.variant === tl.variant));
  return e ? e.name : tl.type;
}

export { HUMAN_SKINS, BLOCKS, BLOCK_MAP, ITEMS, ITEM_MAP, SCENERY };
