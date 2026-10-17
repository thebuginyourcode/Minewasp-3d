import * as THREE from 'three';
import { DEG } from './util.js';
import {
  Painter, boxUV, shade, paintHumanSkin, HUMAN_SKINS, BLOCKS, BLOCK_MAP, paintBlockAtlas,
  ITEMS, ITEM_MAP, paintItem,
} from './textures.js';

/* =====================================================================
   Model definitions
   Units are pixels (16 = one block). +Y is up, models face +Z.
   Each bone: pivot (absolute), optional rest rotation, boxes, optional bend.
   ===================================================================== */

function humanDef(slim) {
  const aw = slim ? 3 : 4;
  return {
    texture: 'human',
    bones: [
      {
        name: 'body', label: 'Body', parent: null, pivot: [0, 12, 0],
        bend: { at: 18, part: 'upper', sign: 1 },
        boxes: [
          { from: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] },
          { from: [-4, 12, -2], size: [8, 12, 4], uv: [16, 32], inflate: 0.25, overlay: true },
        ],
      },
      {
        name: 'head', label: 'Head', parent: 'body', pivot: [0, 24, 0],
        boxes: [
          { from: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] },
          { from: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5, overlay: true },
        ],
      },
      {
        name: 'right_arm', label: 'Right arm', parent: 'body', pivot: [-5, 22, 0],
        bend: { at: 18, part: 'lower', sign: -1 },
        boxes: [
          { from: [-4 - aw, 12, -2], size: [aw, 12, 4], uv: [40, 16] },
          { from: [-4 - aw, 12, -2], size: [aw, 12, 4], uv: [40, 32], inflate: 0.25, overlay: true },
        ],
      },
      {
        name: 'left_arm', label: 'Left arm', parent: 'body', pivot: [5, 22, 0],
        bend: { at: 18, part: 'lower', sign: -1 },
        boxes: [
          { from: [4, 12, -2], size: [aw, 12, 4], uv: [32, 48] },
          { from: [4, 12, -2], size: [aw, 12, 4], uv: [48, 48], inflate: 0.25, overlay: true },
        ],
      },
      {
        name: 'right_leg', label: 'Right leg', parent: null, pivot: [-2, 12, 0],
        bend: { at: 6, part: 'lower', sign: 1 },
        boxes: [
          { from: [-4, 0, -2], size: [4, 12, 4], uv: [0, 16] },
          { from: [-4, 0, -2], size: [4, 12, 4], uv: [0, 32], inflate: 0.25, overlay: true },
        ],
      },
      {
        name: 'left_leg', label: 'Left leg', parent: null, pivot: [2, 12, 0],
        bend: { at: 6, part: 'lower', sign: 1 },
        boxes: [
          { from: [0, 0, -2], size: [4, 12, 4], uv: [16, 48] },
          { from: [0, 0, -2], size: [4, 12, 4], uv: [0, 48], inflate: 0.25, overlay: true },
        ],
      },
    ],
  };
}

/* Paint helpers for auto-packed mob textures. */
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
function bottomBand(color, rows) {
  return (P, [x, y, w, h]) => P.rect(x, y + h - rows, w, rows, color, 0.05);
}
function topBand(color, rows) {
  return (P, [x, y, w]) => P.rect(x, y, w, rows, color, 0.05);
}
function blotches(color, count, seedOffset = 0) {
  return (P, [x, y, w, h]) => {
    for (let i = 0; i < count + seedOffset; i++) {
      const bx = x + Math.floor(P.rand() * w), by = y + Math.floor(P.rand() * h);
      const bw = 2 + Math.floor(P.rand() * 3), bh = 2 + Math.floor(P.rand() * 3);
      for (let j = 0; j < bh; j++) for (let k = 0; k < bw; k++) {
        if (bx + k < x + w && by + j < y + h) P.px(bx + k, by + j, color, 255, 0.05);
      }
    }
  };
}
const all = (...fns) => (P, r) => fns.forEach((f) => f(P, r));

function quadLegs(size, height, cx, cz, paint, prefix = '') {
  const [w, , d] = size;
  const legs = [
    ['front_right_leg', 'Front right leg', -cx, cz],
    ['front_left_leg', 'Front left leg', cx, cz],
    ['back_right_leg', 'Back right leg', -cx, -cz],
    ['back_left_leg', 'Back left leg', cx, -cz],
  ];
  return legs.map(([name, label, x, z]) => ({
    name: prefix + name, label, parent: null, pivot: [x, height, z],
    boxes: [{ from: [x - w / 2, 0, z - d / 2], size: [w, height, d], p: paint }],
  }));
}

function skeletonLike({ head, body, limb, legLen = 12, armLen = 12, headSize = [8, 8, 8], limbW = 2, extra = [] }) {
  const bodyY = legLen;
  const top = bodyY + 12;
  const half = limbW / 2;
  return {
    texture: 'pack',
    bones: [
      { name: 'body', label: 'Body', parent: null, pivot: [0, bodyY, 0], bend: { at: bodyY + 6, part: 'upper', sign: 1 }, boxes: [{ from: [-4, bodyY, -2], size: [8, 12, 4], p: body }] },
      { name: 'head', label: 'Head', parent: 'body', pivot: [0, top, 0], boxes: [{ from: [-headSize[0] / 2, top, -headSize[2] / 2], size: headSize, p: head }] },
      { name: 'right_arm', label: 'Right arm', parent: 'body', pivot: [-4 - half, top - 2, 0], bend: { at: top - 2 - armLen / 2, part: 'lower', sign: -1 }, boxes: [{ from: [-4 - limbW, top - 2 - armLen + 2, -half], size: [limbW, armLen, limbW], p: limb }] },
      { name: 'left_arm', label: 'Left arm', parent: 'body', pivot: [4 + half, top - 2, 0], bend: { at: top - 2 - armLen / 2, part: 'lower', sign: -1 }, boxes: [{ from: [4, top - 2 - armLen + 2, -half], size: [limbW, armLen, limbW], p: limb }] },
      { name: 'right_leg', label: 'Right leg', parent: null, pivot: [-2, legLen, 0], bend: { at: legLen / 2, part: 'lower', sign: 1 }, boxes: [{ from: [-2 - half, 0, -half], size: [limbW, legLen, limbW], p: limb }] },
      { name: 'left_leg', label: 'Left leg', parent: null, pivot: [2, legLen, 0], bend: { at: legLen / 2, part: 'lower', sign: 1 }, boxes: [{ from: [2 - half, 0, -half], size: [limbW, legLen, limbW], p: limb }] },
      ...extra,
    ],
  };
}

const BONE = '#d2d2cc';
const MODELS = {
  human: humanDef(false),
  human_slim: humanDef(true),

  skeleton: skeletonLike({
    head: { c: BONE, n: 0.05, faces: { front: all(
      (P, [x, y]) => { P.rect(x + 1, y + 3, 2, 2, '#1c1c1c'); P.rect(x + 5, y + 3, 2, 2, '#1c1c1c'); P.rect(x + 3, y + 5, 2, 1, '#555'); P.rect(x + 1, y + 6, 6, 1, '#3a3a3a'); },
    ) } },
    body: { c: BONE, n: 0.05, faces: {
      front: (P, [x, y, w, h]) => { for (let j = 0; j < h; j++) if (j % 2 && j < 9) { P.clear(x, y + j, 3, 1); P.clear(x + 5, y + j, 3, 1); } P.clear(x, y + 9, 3, 3); P.clear(x + 5, y + 9, 3, 3); },
      back: (P, [x, y, w, h]) => { for (let j = 0; j < h; j++) if (j % 2 && j < 9) { P.clear(x, y + j, 3, 1); P.clear(x + 5, y + j, 3, 1); } P.clear(x, y + 9, 3, 3); P.clear(x + 5, y + 9, 3, 3); },
    } },
    limb: { c: BONE, n: 0.06 },
  }),

  enderman: skeletonLike({
    legLen: 28, armLen: 30, limbW: 2,
    head: { c: '#161616', n: 0.06, faces: { front: (P, [x, y]) => { P.rect(x, y + 4, 3, 1, '#e07cff'); P.rect(x + 5, y + 4, 3, 1, '#e07cff'); P.px(x + 1, y + 4, '#f8c8ff'); P.px(x + 6, y + 4, '#f8c8ff'); } } },
    body: { c: '#121212', n: 0.06 },
    limb: { c: '#111111', n: 0.06 },
  }),

  villager: {
    texture: 'pack',
    bones: [
      { name: 'body', label: 'Body', parent: null, pivot: [0, 12, 0], boxes: [
        { from: [-4, 12, -3], size: [8, 12, 6], p: { c: '#6d4b34', n: 0.06, faces: { front: (P, [x, y, w, h]) => P.rect(x + 3, y, 2, h, '#5a3c28') } } },
        { from: [-4, 4, -3], size: [8, 8, 6], p: { c: '#6d4b34', n: 0.06 } },
      ] },
      { name: 'head', label: 'Head', parent: 'body', pivot: [0, 24, 0], boxes: [
        { from: [-4, 24, -4], size: [8, 10, 8], p: { c: '#b4876a', n: 0.04, faces: { top: '#5a3c28', back: topBand('#5a3c28', 3), front: all(topBand('#5a3c28', 1), (P, [x, y]) => { P.rect(x + 1, y + 2, 6, 1, '#4a3424'); P.px(x + 1, y + 4, '#fff'); P.px(x + 2, y + 4, '#2f8a3a'); P.px(x + 6, y + 4, '#fff'); P.px(x + 5, y + 4, '#2f8a3a'); P.rect(x + 2, y + 8, 4, 1, '#7a5040'); }) } } },
      ] },
      { name: 'nose', label: 'Nose', parent: 'head', pivot: [0, 27, 4], boxes: [{ from: [-1, 23, 4], size: [2, 4, 2], p: { c: '#a67a5e', n: 0.04 } }] },
      { name: 'arms', label: 'Arms', parent: 'body', pivot: [0, 22, 1], rot: [-35, 0, 0], boxes: [
        { from: [-4, 16, 1], size: [8, 4, 4], p: { c: '#6d4b34', n: 0.06, faces: { front: (P, [x, y, w, h]) => P.rect(x + 2, y, 4, h, '#b4876a', 0.04) } } },
        { from: [-8, 16, -1], size: [4, 8, 4], p: { c: '#6d4b34', n: 0.06, faces: { bottom: '#b4876a' } } },
        { from: [4, 16, -1], size: [4, 8, 4], p: { c: '#6d4b34', n: 0.06, faces: { bottom: '#b4876a' } } },
      ] },
      { name: 'right_leg', label: 'Right leg', parent: null, pivot: [-2, 12, 0], boxes: [{ from: [-4, 0, -2], size: [4, 12, 4], p: { c: '#4a3626', n: 0.06, faces: { front: bottomBand('#2e2219', 2) } } }] },
      { name: 'left_leg', label: 'Left leg', parent: null, pivot: [2, 12, 0], boxes: [{ from: [0, 0, -2], size: [4, 12, 4], p: { c: '#4a3626', n: 0.06, faces: { front: bottomBand('#2e2219', 2) } } }] },
    ],
  },

  creeper: {
    texture: 'pack',
    bones: [
      { name: 'body', label: 'Body', parent: null, pivot: [0, 6, 0], boxes: [{ from: [-4, 6, -2], size: [8, 12, 4], p: { c: '#5ba64a', n: 0.22 } }] },
      { name: 'head', label: 'Head', parent: 'body', pivot: [0, 18, 0], boxes: [{ from: [-4, 18, -4], size: [8, 8, 8], p: { c: '#5ba64a', n: 0.22, faces: { front: (P, [x, y]) => {
        const k = '#0d140b';
        P.rect(x + 1, y + 2, 2, 2, k); P.rect(x + 5, y + 2, 2, 2, k);
        P.rect(x + 3, y + 4, 2, 1, k); P.rect(x + 2, y + 5, 4, 2, k); P.px(x + 2, y + 7, k); P.px(x + 5, y + 7, k);
      } } } }] },
      ...[
        ['front_right_leg', 'Front right leg', -2, 4], ['front_left_leg', 'Front left leg', 2, 4],
        ['back_right_leg', 'Back right leg', -2, -4], ['back_left_leg', 'Back left leg', 2, -4],
      ].map(([name, label, x, z]) => ({
        name, label, parent: null, pivot: [x, 6, z],
        boxes: [{ from: [x - 2, 0, z - 2], size: [4, 6, 4], p: { c: '#5ba64a', n: 0.22, faces: { bottom: '#3b6f30' } } }],
      })),
    ],
  },

  pig: {
    texture: 'pack',
    bones: [
      { name: 'body', label: 'Body', parent: null, pivot: [0, 10, 0], boxes: [{ from: [-5, 6, -8], size: [10, 8, 16], p: { c: '#eea3a1', n: 0.05 } }] },
      { name: 'head', label: 'Head', parent: null, pivot: [0, 12, 7], boxes: [
        { from: [-4, 8, 7], size: [8, 8, 8], p: { c: '#eea3a1', n: 0.05, faces: { front: eyes('#ffffff', '#1a1a1a', 3, 0, 1) } } },
        { from: [-2, 9, 15], size: [4, 3, 1], p: { c: '#e58f92', n: 0.03, faces: { front: (P, [x, y]) => { P.px(x, y + 1, '#8a4a4a'); P.px(x + 3, y + 1, '#8a4a4a'); } } } },
      ] },
      ...quadLegs([4, 6, 4], 6, 3, 5, { c: '#e9999a', n: 0.05, faces: { front: bottomBand('#b8706f', 1), bottom: '#9a5a5a' } }),
    ],
  },

  cow: {
    texture: 'pack',
    bones: [
      { name: 'body', label: 'Body', parent: null, pivot: [0, 17, 0], boxes: [
        { from: [-6, 12, -9], size: [12, 10, 18], p: { c: '#ebebeb', n: 0.04, faces: {
          top: blotches('#2b2622', 6), left: blotches('#2b2622', 6), right: blotches('#2b2622', 6), back: blotches('#2b2622', 2), front: blotches('#2b2622', 2),
        } } },
        { from: [-2, 11, -6], size: [4, 1, 6], p: { c: '#e7a3ab', n: 0.04 } },
      ] },
      { name: 'head', label: 'Head', parent: null, pivot: [0, 19, 8], boxes: [
        { from: [-4, 15, 8], size: [8, 8, 6], p: { c: '#2f2a26', n: 0.06, faces: { front: all((P, [x, y]) => P.rect(x + 2, y, 4, 8, '#ebebeb', 0.03), eyes('#ffffff', '#111111', 3, 0, 1)) } } },
        { from: [-2, 15, 14], size: [4, 3, 1], p: { c: '#c79e8a', n: 0.03 } },
        { from: [-5, 21, 10], size: [1, 3, 1], p: { c: '#ddd5bb', n: 0.03 } },
        { from: [4, 21, 10], size: [1, 3, 1], p: { c: '#ddd5bb', n: 0.03 } },
      ] },
      ...quadLegs([4, 12, 4], 12, 4, 6, { c: '#ebebeb', n: 0.04, faces: { front: bottomBand('#3a3a3a', 2), back: bottomBand('#3a3a3a', 2), left: bottomBand('#3a3a3a', 2), right: bottomBand('#3a3a3a', 2), bottom: '#3a3a3a' } }),
    ],
  },

  sheep: {
    texture: 'pack',
    bones: [
      { name: 'body', label: 'Body', parent: null, pivot: [0, 16, 0], boxes: [{ from: [-5, 11, -8], size: [10, 10, 16], p: { c: '#e9e9e7', n: 0.06 } }] },
      { name: 'head', label: 'Head', parent: null, pivot: [0, 18, 7], boxes: [
        { from: [-3, 15, 7], size: [6, 6, 7], p: { c: '#d8c1a6', n: 0.04, faces: { top: '#e9e9e7', front: all(topBand('#e9e9e7', 1), eyes('#ffffff', '#222', 2, 0, 1)) } } },
      ] },
      ...quadLegs([4, 12, 4], 12, 3, 5, { c: '#d8c1a6', n: 0.04, faces: { front: topBand('#e9e9e7', 5), back: topBand('#e9e9e7', 5), left: topBand('#e9e9e7', 5), right: topBand('#e9e9e7', 5), top: '#e9e9e7' } }),
    ],
  },

  chicken: {
    texture: 'pack',
    bones: [
      { name: 'body', label: 'Body', parent: null, pivot: [0, 7, 0], boxes: [{ from: [-3, 4, -4], size: [6, 6, 8], p: { c: '#f2f2f2', n: 0.04 } }] },
      { name: 'head', label: 'Head', parent: null, pivot: [0, 9, 3], boxes: [
        { from: [-2, 9, 2], size: [4, 6, 3], p: { c: '#f2f2f2', n: 0.03, faces: { front: eyes('#f2f2f2', '#111', 1, 0, 0) } } },
        { from: [-2, 11, 5], size: [4, 2, 2], p: { c: '#f0ad26', n: 0.03 } },
        { from: [-1, 9, 5], size: [2, 2, 1], p: { c: '#d2261e', n: 0.03 } },
      ] },
      { name: 'right_wing', label: 'Right wing', parent: null, pivot: [-3, 10, 0], boxes: [{ from: [-4, 5, -3], size: [1, 4, 6], p: { c: '#e6e6e6', n: 0.04 } }] },
      { name: 'left_wing', label: 'Left wing', parent: null, pivot: [3, 10, 0], boxes: [{ from: [3, 5, -3], size: [1, 4, 6], p: { c: '#e6e6e6', n: 0.04 } }] },
      { name: 'right_leg', label: 'Right leg', parent: null, pivot: [-1.5, 5, 0], boxes: [{ from: [-2, 0, -0.5], size: [1, 5, 1], p: { c: '#f0ad26' } }, { from: [-3, 0, -0.5], size: [3, 0.5, 3], p: { c: '#f0ad26' } }] },
      { name: 'left_leg', label: 'Left leg', parent: null, pivot: [1.5, 5, 0], boxes: [{ from: [1, 0, -0.5], size: [1, 5, 1], p: { c: '#f0ad26' } }, { from: [0, 0, -0.5], size: [3, 0.5, 3], p: { c: '#f0ad26' } }] },
    ],
  },

  wolf: {
    texture: 'pack',
    bones: [
      { name: 'body', label: 'Body', parent: null, pivot: [0, 10, 0], boxes: [
        { from: [-3, 7, -6], size: [6, 6, 8], p: { c: '#d6d2cd', n: 0.05 } },
        { from: [-4, 6.5, 1], size: [8, 7, 6], p: { c: '#cbc6c0', n: 0.06 } },
      ] },
      { name: 'head', label: 'Head', parent: null, pivot: [0, 11, 7], boxes: [
        { from: [-3, 8, 7], size: [6, 6, 4], p: { c: '#d6d2cd', n: 0.05, faces: { front: (P, [x, y]) => { P.px(x + 1, y + 2, '#151515'); P.px(x + 4, y + 2, '#151515'); } } } },
        { from: [-1.5, 8, 11], size: [3, 3, 4], p: { c: '#cfc9c2', n: 0.04, faces: { front: topBand('#1c1c1c', 1) } } },
        { from: [-3, 14, 8], size: [2, 2, 1], p: { c: '#b9b3ac' } },
        { from: [1, 14, 8], size: [2, 2, 1], p: { c: '#b9b3ac' } },
      ] },
      { name: 'tail', label: 'Tail', parent: null, pivot: [0, 12, -6], rot: [-40, 0, 0], boxes: [{ from: [-1, 4, -7], size: [2, 8, 2], p: { c: '#cbc6c0', n: 0.05 } }] },
      ...quadLegs([2, 8, 2], 8, 1.5, 4, { c: '#d6d2cd', n: 0.05 }).map((b) => {
        if (b.name.startsWith('back')) { b.pivot[2] = -5; b.boxes[0].from[2] = -6; }
        return b;
      }),
    ],
  },

  spider: {
    texture: 'pack',
    bones: [
      { name: 'body', label: 'Abdomen', parent: null, pivot: [0, 8, -2], boxes: [{ from: [-5, 4, -14], size: [10, 8, 12], p: { c: '#2f2723', n: 0.1, faces: { top: blotches('#4a1c18', 2) } } }] },
      { name: 'thorax', label: 'Thorax', parent: null, pivot: [0, 8, 1], boxes: [{ from: [-3, 5, -2], size: [6, 6, 6], p: { c: '#2a221f', n: 0.1 } }] },
      { name: 'head', label: 'Head', parent: null, pivot: [0, 8, 4], boxes: [{ from: [-4, 4, 4], size: [8, 8, 8], p: { c: '#2f2723', n: 0.1, faces: { front: (P, [x, y]) => {
        const r = '#d11f1f';
        P.rect(x + 1, y + 3, 2, 1, r); P.rect(x + 5, y + 3, 2, 1, r); P.px(x + 3, y + 2, r); P.px(x + 4, y + 2, r); P.px(x + 2, y + 4, r); P.px(x + 5, y + 4, r);
      } } } }] },
      ...[3, 1, -1, -3].flatMap((z, i) => {
        const yaw = [40, 15, -15, -40][i];
        const leg = { c: '#2a221f', n: 0.1 };
        return [
          { name: `right_leg_${i + 1}`, label: `Right leg ${i + 1}`, parent: null, pivot: [-3, 8, z], rot: [0, yaw, 35], boxes: [{ from: [-19, 7, z - 1], size: [16, 2, 2], p: leg }] },
          { name: `left_leg_${i + 1}`, label: `Left leg ${i + 1}`, parent: null, pivot: [3, 8, z], rot: [0, -yaw, -35], boxes: [{ from: [3, 7, z - 1], size: [16, 2, 2], p: leg }] },
        ];
      }),
    ],
  },

  slime: {
    texture: 'pack',
    bones: [
      { name: 'body', label: 'Body', parent: null, pivot: [0, 0, 0], boxes: [
        { from: [-3, 1, -3], size: [6, 6, 6], p: { c: '#6fbf5a', n: 0.06, faces: { front: (P, [x, y]) => { P.rect(x, y + 1, 2, 2, '#1d3a17'); P.rect(x + 4, y + 1, 2, 2, '#1d3a17'); P.px(x + 3, y + 4, '#1d3a17'); } } } },
        { from: [-4, 0, -4], size: [8, 8, 8], translucent: true, p: { c: '#7fd468', n: 0.08, a: 120 } },
      ] },
    ],
  },

  bee: {
    texture: 'pack',
    bones: [
      { name: 'body', label: 'Body', parent: null, pivot: [0, 6, 0], boxes: [
        { from: [-3.5, 2, -5], size: [7, 7, 10], p: { c: '#f0c22c', n: 0.05, faces: {
          left: (P, [x, y, w, h]) => { P.rect(x + 3, y, 2, h, '#3a2a12'); P.rect(x + 7, y, 1, h, '#3a2a12'); },
          right: (P, [x, y, w, h]) => { P.rect(x + w - 5, y, 2, h, '#3a2a12'); P.rect(x + w - 8, y, 1, h, '#3a2a12'); },
          top: (P, [x, y, w]) => { P.rect(x, y + 5, w, 2, '#3a2a12'); P.rect(x, y + 2, w, 1, '#3a2a12'); },
          front: (P, [x, y, w]) => { P.rect(x, y + 2, 2, 3, '#1b1b1b'); P.rect(x + w - 2, y + 2, 2, 3, '#1b1b1b'); P.px(x, y + 2, '#ffffff'); P.px(x + w - 1, y + 2, '#ffffff'); },
        } } },
        { from: [-0.5, 5, -6], size: [1, 1, 1], p: { c: '#2a2a2a' } },
        { from: [-2, 8, 5], size: [1, 1, 3], p: { c: '#2a2a2a' } },
        { from: [1, 8, 5], size: [1, 1, 3], p: { c: '#2a2a2a' } },
      ] },
      { name: 'right_wing', label: 'Right wing', parent: 'body', pivot: [-1, 9, 0], rot: [0, -15, 0], boxes: [{ from: [-8, 9, -2], size: [7, 0, 6], translucent: true, p: { c: '#dff2ff', a: 150 } }] },
      { name: 'left_wing', label: 'Left wing', parent: 'body', pivot: [1, 9, 0], rot: [0, 15, 0], boxes: [{ from: [1, 9, -2], size: [7, 0, 6], translucent: true, p: { c: '#dff2ff', a: 150 } }] },
    ],
  },
};

export function getModelDef(tl) {
  if (tl.ref === 'human') {
    const slim = tl.slim ?? HUMAN_SKINS[tl.variant]?.slim;
    return slim ? MODELS.human_slim : MODELS.human;
  }
  return MODELS[tl.ref];
}

export function modelBones(ref) {
  return (MODELS[ref] || MODELS.human).bones;
}

/* ---------- Auto-packed textures ---------- */

function packModel(def) {
  if (def._packed) return def._packed;
  const boxes = [];
  for (const b of def.bones) for (const box of b.boxes) if (box.p) boxes.push(box);
  const sized = boxes.map((box) => {
    const [w, h, d] = box.size.map((v) => Math.ceil(v));
    return { box, w: Math.max(1, 2 * (w + d)), h: Math.max(1, d + h) };
  }).sort((a, b) => b.h - a.h);
  let texW = 64;
  for (;;) {
    let x = 0, y = 0, rowH = 0, ok = true;
    for (const s of sized) {
      if (s.w > texW) { ok = false; break; }
      if (x + s.w > texW) { x = 0; y += rowH; rowH = 0; }
      s.u = x; s.v = y;
      x += s.w;
      rowH = Math.max(rowH, s.h);
    }
    const used = y + rowH;
    if (ok && used <= texW) {
      for (const s of sized) s.box.uv = [s.u, s.v];
      def._packed = { w: texW, h: Math.max(16, 2 ** Math.ceil(Math.log2(used))) };
      return def._packed;
    }
    texW *= 2;
  }
}

function paintPacked(def, seed) {
  const size = packModel(def);
  const P = new Painter(size.w, size.h, seed);
  P.clear(0, 0, size.w, size.h);
  for (const b of def.bones) for (const box of b.boxes) {
    if (!box.p) continue;
    const [w, h, d] = box.size.map((v) => Math.ceil(v));
    const F = boxUV(box.uv[0], box.uv[1], w, h, d);
    for (const [face, r] of Object.entries(F)) {
      if (r[2] <= 0 || r[3] <= 0) continue;
      const spec = box.p.faces?.[face];
      const base = typeof spec === 'string' ? spec : box.p.c;
      P.rect(r[0], r[1], r[2], r[3], base, box.p.n || 0, box.p.a ?? 255);
      if (face === 'bottom' && typeof spec !== 'string' && box.p.c) P.rect(r[0], r[1], r[2], r[3], shade(base, 0.82), box.p.n || 0, box.p.a ?? 255);
      if (typeof spec === 'function') spec(P, r);
    }
  }
  return P.finish();
}

const textureCache = new Map();

function makeTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function getModelTexture(tl, customCanvas) {
  if (customCanvas) return { canvas: customCanvas, texture: makeTexture(customCanvas), owned: true };
  const def = getModelDef(tl);
  const key = def.texture === 'human' ? 'human:' + (tl.variant || 'classic') : 'model:' + tl.ref;
  if (!textureCache.has(key)) {
    const canvas = def.texture === 'human' ? paintHumanSkin(tl.variant || 'classic') : paintPacked(def, 300 + tl.ref.length * 17);
    textureCache.set(key, { canvas, texture: makeTexture(canvas) });
  }
  return textureCache.get(key);
}

export function getBlockTexture(id) {
  const key = 'block:' + id;
  if (!textureCache.has(key)) {
    const canvas = paintBlockAtlas(id);
    textureCache.set(key, { canvas, texture: makeTexture(canvas) });
  }
  return textureCache.get(key);
}

/* Single 16x16 face texture usable with repeat wrapping (for shapes / ground). */
export function getBlockFaceTexture(id, face = 'front') {
  const key = `face:${id}:${face}`;
  if (!textureCache.has(key)) {
    const atlas = getBlockTexture(id).canvas;
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const i = ['top', 'bottom', 'front', 'back', 'left', 'right'].indexOf(face);
    c.getContext('2d').drawImage(atlas, i * 16, 0, 16, 16, 0, 0, 16, 16);
    const t = makeTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    textureCache.set(key, { canvas: c, texture: t });
  }
  return textureCache.get(key);
}

export function getItemTexture(id) {
  const key = 'item:' + id;
  if (!textureCache.has(key)) {
    const it = ITEM_MAP[id] || ITEMS[0];
    const canvas = paintItem(it.kind, it.mat);
    textureCache.set(key, { canvas, texture: makeTexture(canvas) });
  }
  return textureCache.get(key);
}

/* =====================================================================
   Geometry
   ===================================================================== */

class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }

  quad(corners, normal, uvRect, texW, texH, flipU = false) {
    const base = this.pos.length / 3;
    const e = 0.01;
    let [u0, v0, u1, v1] = uvRect;
    u0 += e; u1 -= e; v0 += e; v1 -= e;
    if (flipU) [u0, u1] = [u1, u0];
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
  const [w, h, d] = box.p ? box.size.map((v) => Math.ceil(v)) : box.size;
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
  if (R.bottom && sy0 <= y0 + 1e-6) gb.quad([[x0, ya, z1], [x1, ya, z1], [x0, ya, z0], [x1, ya, z0]], [0, -1, 0], rect(R.bottom), texW, texH, mirror);
}

function regionEmpty(canvas, box) {
  if (!canvas._alpha) canvas._alpha = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  const a = canvas._alpha, W = canvas.width;
  for (const r of Object.values(boxRects(box))) {
    for (let y = Math.floor(r[1]); y < r[1] + r[3]; y++) for (let x = Math.floor(r[0]); x < r[0] + r[2]; x++) {
      if (x >= 0 && y >= 0 && x < W && y < canvas.height && a[(y * W + x) * 4 + 3] > 0) return false;
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

function meshesFor(boxes, origin, slice, tex, parent) {
  const out = [];
  for (const translucent of [false, true]) {
    const gb = new GeoBuilder();
    for (const box of boxes) if (!!box.translucent === translucent) addBox(gb, box, origin, slice, tex.canvas.width, tex.canvas.height);
    if (gb.empty) continue;
    const mesh = new THREE.Mesh(gb.build(), modelMaterial(tex.texture, translucent));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.baseTransparent = translucent;
    parent.add(mesh);
    out.push(mesh);
  }
  return out;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function buildModel(def, tex) {
  if (def.texture === 'pack') packModel(def);
  const root = new THREE.Group();
  const parts = {};
  for (const bone of def.bones) {
    const parentPart = bone.parent ? parts[bone.parent] : null;
    const parentOrigin = parentPart ? parentPart.containerOrigin : [0, 0, 0];
    const offset = new THREE.Group();
    offset.position.fromArray(sub(bone.pivot, parentOrigin));
    if (bone.rot) offset.rotation.set(bone.rot[0] * DEG, bone.rot[1] * DEG, bone.rot[2] * DEG);
    const anim = new THREE.Group();
    offset.add(anim);
    (parentPart ? parentPart.container : root).add(offset);

    const boxes = bone.boxes.filter((b) => !(b.overlay && regionEmpty(tex.canvas, b)));
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
      meshes.push(...meshesFor(boxes, bone.pivot, fixed, tex, anim));
      meshes.push(...meshesFor(boxes, bp, moving, tex, bendGroup));
      container = bendGroup;
      containerOrigin = bp;
    } else {
      meshes.push(...meshesFor(boxes, bone.pivot, null, tex, anim));
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

/* Items: extruded 16x16 sprite, one pixel deep. Origin at bottom center. */
const itemGeoCache = new Map();
export function itemGeometry(id) {
  if (itemGeoCache.has(id)) return itemGeoCache.get(id);
  const { canvas } = getItemTexture(id);
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 16, 16).data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && data[(y * 16 + x) * 4 + 3] > 0;
  const gb = new GeoBuilder();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (!solid(x, y)) continue;
    const X0 = x - 8, X1 = x - 7, Y1 = 16 - y, Y0 = 15 - y, Z0 = -0.5, Z1 = 0.5;
    const r = [x + 0.3, y + 0.3, x + 0.7, y + 0.7];
    gb.quad([[X0, Y1, Z1], [X1, Y1, Z1], [X0, Y0, Z1], [X1, Y0, Z1]], [0, 0, 1], r, 16, 16);
    gb.quad([[X1, Y1, Z0], [X0, Y1, Z0], [X1, Y0, Z0], [X0, Y0, Z0]], [0, 0, -1], r, 16, 16);
    if (!solid(x - 1, y)) gb.quad([[X0, Y1, Z0], [X0, Y1, Z1], [X0, Y0, Z0], [X0, Y0, Z1]], [-1, 0, 0], r, 16, 16);
    if (!solid(x + 1, y)) gb.quad([[X1, Y1, Z1], [X1, Y1, Z0], [X1, Y0, Z1], [X1, Y0, Z0]], [1, 0, 0], r, 16, 16);
    if (!solid(x, y - 1)) gb.quad([[X0, Y1, Z0], [X1, Y1, Z0], [X0, Y1, Z1], [X1, Y1, Z1]], [0, 1, 0], r, 16, 16);
    if (!solid(x, y + 1)) gb.quad([[X0, Y0, Z1], [X1, Y0, Z1], [X0, Y0, Z0], [X1, Y0, Z0]], [0, -1, 0], r, 16, 16);
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
  ['zombie', 'Zombie', 'human', 'zombie'], ['skeleton', 'Skeleton'], ['creeper', 'Creeper'], ['enderman', 'Enderman'],
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
