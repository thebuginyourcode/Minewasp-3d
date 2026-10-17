import { clamp, fmt } from './util.js';

/* ---------- DOM helper ---------- */

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* ---------- Icons (24px grid, 1.5 stroke) ---------- */

const P = {
  menu: 'M4 6.5h16M4 12h16M4 17.5h16',
  add: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  document: 'M7 3.5h7l4.5 4.5v12.5H7z M14 3.5V8h4.5',
  folder: 'M3.5 6.5h6l2 2h9v10h-17z',
  save: 'M5 4h11l3 3v13H5z M8 4v5h7V4 M8 20v-6h8v6',
  export: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v6h14v-6',
  import: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 14v6h14v-6',
  undo: 'M9 14 4.5 9.5 9 5 M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3',
  redo: 'M15 14l4.5-4.5L15 5 M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3',
  trash: 'M5 7h14M10 4h4M7 7l1 13h8l1-13M10 11v6M14 11v6',
  copy: 'M9 9h10v11H9z M5 15V4h10',
  paste: 'M9 4h6v3H9z M7 5.5H5.5V21h13V5.5H17',
  duplicate: 'M8 8h11v11H8z M5 16V5h11 M13.5 11v5M11 13.5h5',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 5.5v13M16 5.5v13',
  skipStart: 'M6.5 5.5v13M18 5.5v13l-9.5-6.5z',
  skipEnd: 'M17.5 5.5v13M6 5.5v13l9.5-6.5z',
  prevKey: 'M10 12l3.5-3.5L17 12l-3.5 3.5z M7 6v12',
  nextKey: 'M7 12l3.5-3.5L14 12l-3.5 3.5z M17 6v12',
  loop: 'M17 4.5 19.5 7 17 9.5 M19.5 7H8a3.5 3.5 0 0 0-3.5 3.5v1 M7 19.5 4.5 17 7 14.5 M4.5 17H16a3.5 3.5 0 0 0 3.5-3.5v-1',
  keyframe: 'M12 4.5 19.5 12 12 19.5 4.5 12z',
  keyAdd: 'M10 6l6 6-6 6-6-6z M18.5 3.5v5M16 6h5',
  keyRemove: 'M10 6l6 6-6 6-6-6z M16 6h5',
  pointer: 'M6 3.5v15l4-4 2.8 6 2.4-1.1-2.8-5.9H18z',
  move: 'M12 3.5v17M3.5 12h17M9.5 6 12 3.5 14.5 6M9.5 18l2.5 2.5 2.5-2.5M6 9.5 3.5 12 6 14.5M18 9.5l2.5 2.5-2.5 2.5',
  rotate: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3 M19.5 4v4.5H15',
  scale: 'M4 20V9h11v11z M13 4h7v7 M20 4l-7.5 7.5',
  globe: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M3.5 12h17 M12 3.5c2.5 2.5 3.5 5.3 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.3-3.5-8.5s1-6 3.5-8.5z',
  cubeLocal: 'M12 3.5 19.5 7.5v9L12 20.5 4.5 16.5v-9z M4.5 7.5 12 11.5l7.5-4 M12 11.5v9',
  magnet: 'M6 4v7a6 6 0 0 0 12 0V4h-3.5v7a2.5 2.5 0 0 1-5 0V4z M6 8h3.5M14.5 8H18',
  camera: 'M3.5 7.5h11v9h-11z M14.5 10.5l6-3v9l-6-3',
  video: 'M3.5 6.5h12v11h-12z M15.5 10l5-2.5v9l-5-2.5',
  image: 'M4 5h16v14H4z M4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17.5 M15 9.5h.01',
  eye: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  eyeOff: 'M4 4l16 16 M9.9 6.3A9.9 9.9 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.7 3.4 M6.2 7.7A15.6 15.6 0 0 0 2.5 12s3.5 6 9.5 6a9.6 9.6 0 0 0 4.3-1',
  person: 'M12 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M5 20c.5-4 3.3-6 7-6s6.5 2 7 6',
  paw: 'M8 6.5a1.5 2 0 1 0 0 .01z M16 6.5a1.5 2 0 1 0 0 .01z M4.5 11a1.5 2 0 1 0 0 .01z M19.5 11a1.5 2 0 1 0 0 .01z M12 12c-3 0-5 3-5 5.5 0 1.5 1.5 2.5 3 2l2-.5 2 .5c1.5.5 3-.5 3-2 0-2.5-2-5.5-5-5.5z',
  cube: 'M12 3.5 19.5 7.5v9L12 20.5 4.5 16.5v-9z M4.5 7.5 12 11.5l7.5-4 M12 11.5v9',
  sword: 'M19.5 4.5 10 14 M19.5 4.5v4L11 17l-1-1M19.5 4.5h-4L7 13l1 1 M6.5 13.5l4 4 M8.5 15.5 4.5 19.5',
  tree: 'M12 3.5 6 11h3l-4 5.5h14L15 11h3z M12 16.5v4',
  shapes: 'M7.5 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M13.5 13.5h7v7h-7z M16.5 3.5l4 7h-8z M3.5 20.5l3.5-6 3.5 6z',
  bulb: 'M9 17.5h6M10 20.5h4 M12 3.5a5.5 5.5 0 0 0-3.3 9.9c.8.6 1.3 1.5 1.3 2.4v1.7h4v-1.7c0-.9.5-1.8 1.3-2.4A5.5 5.5 0 0 0 12 3.5z',
  spot: 'M9 3.5h6l1 5H8z M8 8.5 4 20.5h16l-4-12',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2l-.3 2h-4l-.3-2a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L3 9.9l2-3.4 1.9.7a7 7 0 0 1 2-1.2l.3-2h4l.3 2a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4z',
  focus: 'M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5 M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  grid: 'M4 4h16v16H4z M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  layers: 'M12 4 20.5 8.5 12 13 3.5 8.5z M3.5 12.5 12 17l8.5-4.5 M3.5 16.5 12 21l8.5-4.5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2',
  upload: 'M12 16V4.5M7.5 9 12 4.5 16.5 9 M4.5 15v4.5h15V15',
  timeline: 'M4 6h9M4 12h16M4 18h12 M16 4v4M8 10v4M19 16v4',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9 M15 5v4M9 15v4',
  share: 'M16.5 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M7.5 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M16.5 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M9.7 10.8l4.6-2.6M9.7 13.2l4.6 2.6',
  info: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M12 11v5.5M12 7.5h.01',
  error: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M12 7.5V13M12 16.5h.01',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M15.5 15.5 20 20',
  rename: 'M4 20h4L19 9l-4-4L4 16z M13 7l4 4',
  bone: 'M7 7l10 10 M5.5 8.5a2 2 0 1 1 3-3 2 2 0 1 1 3 3 M18.5 15.5a2 2 0 1 1-3 3 2 2 0 1 1-3-3',
  box: 'M4 7.5 12 3.5l8 4v9l-8 4-8-4z',
};

const FILLED = new Set(['play', 'keyframe']);

export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon ' + cls);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', P[name] || P.box);
  if (FILLED.has(name)) {
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1');
    path.setAttribute('stroke-linejoin', 'round');
  } else {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.appendChild(path);
  return svg;
}

export function iconButton(name, title, onClick, opts = {}) {
  const b = h('button', { class: 'btn-ghost icon-only' + (opts.cls ? ' ' + opts.cls : ''), type: 'button', title, 'aria-label': title, onclick: onClick }, icon(name));
  return b;
}

/* ---------- Layer helpers ---------- */

const layer = () => document.getElementById('layer');

let openFlyout = null;
export function closeFlyout() {
  if (openFlyout) { openFlyout.remove(); openFlyout = null; }
}

/*
 * items: [{ label, icon, key, action, disabled, checked } | 'sep' | { header }]
 */
export function openMenu(anchor, items, opts = {}) {
  closeFlyout();
  const wrap = h('div', { class: 'flyout-wrap' });
  const scrim = h('div', { class: 'flyout-scrim' });
  scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); closeFlyout(); });
  const fly = h('div', { class: 'flyout', role: 'menu' });
  for (const it of items) {
    if (it === 'sep') { fly.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.header) { fly.append(h('div', { class: 'menu-header' }, it.header)); continue; }
    const btn = h('button', {
      class: 'menu-item' + (it.checked ? ' checked' : ''), type: 'button', role: 'menuitem', disabled: it.disabled,
      onclick: () => { closeFlyout(); it.action?.(); },
    }, it.icon ? icon(it.icon) : h('span', { style: { width: '16px', flex: 'none' } }), h('span', { class: 'mi-label' }, it.label), it.key ? h('span', { class: 'mi-key' }, it.key) : null);
    fly.append(btn);
  }
  wrap.append(scrim, fly);
  layer().append(wrap);
  openFlyout = wrap;

  const r = anchor.getBoundingClientRect();
  const fw = fly.offsetWidth, fh = fly.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = opts.align === 'right' ? r.right - fw : r.left;
  let y = r.bottom + 4;
  if (opts.point) { x = opts.point.x; y = opts.point.y; }
  if (y + fh > vh - 8) y = Math.max(8, (opts.point ? opts.point.y : r.top) - fh - 4);
  x = clamp(x, 8, vw - fw - 8);
  fly.style.left = x + 'px';
  fly.style.top = y + 'px';
  return wrap;
}

export function openDialog({ title, body, buttons = [], wide = false, dismissible = true, onClose }) {
  closeFlyout();
  const smoke = h('div', { class: 'dialog-smoke' });
  const dlg = h('div', { class: 'dialog' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
  const close = (result) => { smoke.remove(); document.removeEventListener('keydown', onKey); onClose?.(result); };
  const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(null); };
  document.addEventListener('keydown', onKey);
  if (dismissible) smoke.addEventListener('pointerdown', (e) => { if (e.target === smoke) close(null); });
  if (title !== undefined || body) {
    const content = h('div', { class: 'dialog-body' }, title ? h('h2', { class: 'dialog-title' }, title) : null, body);
    if (wide) { dlg.append(body); } else dlg.append(content);
  }
  if (buttons.length) {
    dlg.append(h('div', { class: 'dialog-footer' }, buttons.map((b) => h('button', {
      class: 'btn' + (b.primary ? ' primary' : ''), type: 'button',
      onclick: async () => { const keep = await b.action?.(); if (keep !== false) close(b.value ?? b.label); },
    }, b.label))));
  }
  smoke.append(dlg);
  layer().append(smoke);
  return { close, el: dlg };
}

export function confirmDialog(title, text, okLabel = 'OK') {
  return new Promise((resolve) => {
    openDialog({
      title, body: h('p', { class: 'dialog-text' }, text),
      buttons: [{ label: okLabel, primary: true, value: true }, { label: 'Cancel', value: false }],
      onClose: (v) => resolve(v === true),
    });
  });
}

export function promptDialog(title, value, okLabel = 'Save') {
  return new Promise((resolve) => {
    const input = h('input', { class: 'textbox', value, style: { width: '100%' } });
    let result = null;
    const d = openDialog({
      title, body: input,
      buttons: [{ label: okLabel, primary: true, action: () => { result = input.value; } }, { label: 'Cancel' }],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { result = input.value; d.close(); } });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

let toastTimer = 0;
export function toast(text, kind = 'info') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, icon(kind === 'error' ? 'error' : 'info'), h('span', {}, text));
  layer().append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2800);
}

/* ---------- Form controls ---------- */

/*
 * Number box with a scrub handle. Dragging the axis label scrubs the value;
 * tapping the field allows typing.
 */
export function numberBox({ axis = '', axisCls = '', handle: showHandle = true, value = 0, step = 1, min = -Infinity, max = Infinity, dp = 2, scrub = 0.25, onBegin, onInput, onCommit }) {
  const input = h('input', { type: 'text', inputmode: 'decimal', enterkeyhint: 'done', autocomplete: 'off', spellcheck: 'false' });
  const handle = h('span', { class: 'nb-axis ' + axisCls }, axis || '↔');
  const box = h('div', { class: 'numbox' }, showHandle ? handle : null, input);
  let current = value;
  const show = (v) => { if (document.activeElement !== input) input.value = fmt(v, dp); };
  show(value);

  const parse = (s) => {
    const expr = String(s).replace(/,/g, '.').trim();
    if (!/^[-+*/().\d\s]+$/.test(expr)) return NaN;
    try { return Function(`"use strict";return (${expr})`)(); } catch { return NaN; }
  };

  input.addEventListener('focus', () => { box.classList.add('focused'); setTimeout(() => input.select(), 0); });
  input.addEventListener('blur', () => {
    box.classList.remove('focused');
    const v = parse(input.value);
    if (Number.isFinite(v) && v !== current) {
      current = clamp(v, min, max);
      onBegin?.();
      onInput?.(current);
      onCommit?.(current);
    }
    input.value = fmt(current, dp);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = fmt(current, dp); input.blur(); }
  });

  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, start: current, began: false };
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.began && Math.abs(dx) < 3) return;
    if (!drag.began) { drag.began = true; onBegin?.(); }
    const fine = e.shiftKey ? 0.1 : 1;
    let v = drag.start + dx * scrub * step * fine;
    v = Math.round(v / (step * fine)) * (step * fine);
    v = clamp(+v.toFixed(6), min, max);
    if (v !== current) { current = v; input.value = fmt(v, dp); onInput?.(v); }
  });
  const end = () => {
    if (drag?.began) onCommit?.(current);
    drag = null;
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);

  return {
    el: box,
    set(v) { current = v; show(v); },
    setKeyed(on) { box.classList.toggle('keyed', !!on); },
  };
}

export function slider({ value = 0, min = 0, max = 1, step = 0.01, dp = 2, onBegin, onInput, onCommit }) {
  const range = h('input', { type: 'range', class: 'slider', min, max, step, value });
  const nb = numberBox({ handle: false, value, min, max, step, dp, scrub: (max - min) / step / 200, onBegin, onInput: (v) => { setRange(v); onInput?.(v); }, onCommit });
  const setRange = (v) => {
    range.value = v;
    range.style.setProperty('--pct', ((clamp(v, min, max) - min) / (max - min)) * 100 + '%');
  };
  setRange(value);
  let began = false;
  range.addEventListener('input', () => {
    if (!began) { began = true; onBegin?.(); }
    const v = +range.value;
    setRange(v);
    nb.set(v);
    onInput?.(v);
  });
  range.addEventListener('change', () => { began = false; onCommit?.(+range.value); });
  const wrap = h('div', { class: 'slider-wrap' }, range, nb.el);
  return { el: wrap, set(v) { setRange(v); nb.set(v); }, setKeyed: nb.setKeyed };
}

export function toggle({ checked, label = '', onChange }) {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange?.(input.checked));
  const el = h('label', { class: 'toggle' }, input, h('span', { class: 'track' }), label ? h('span', {}, label) : null);
  return { el, set(v) { input.checked = !!v; } };
}

export function combo({ value, options, onChange }) {
  const sel = h('select');
  const addOpt = (parent, o) => parent.append(h('option', { value: o.value }, o.label));
  for (const o of options) {
    if (o.group) {
      const g = h('optgroup', { label: o.group });
      o.items.forEach((it) => addOpt(g, it));
      sel.append(g);
    } else addOpt(sel, o);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange?.(sel.value));
  const el = h('div', { class: 'combo' }, sel, icon('chevronDown'));
  return { el, set(v) { sel.value = v; } };
}

export function colorField({ value, onBegin, onInput, onCommit }) {
  const sw = h('span', { class: 'swatch' });
  const label = h('span', {});
  const input = h('input', { type: 'color', value });
  const set = (v) => { sw.style.background = v; label.textContent = v.toUpperCase(); input.value = v; };
  set(value);
  let began = false;
  input.addEventListener('input', () => {
    if (!began) { began = true; onBegin?.(); }
    set(input.value);
    onInput?.(input.value);
  });
  input.addEventListener('change', () => { began = false; onCommit?.(input.value); });
  return { el: h('label', { class: 'color-field' }, sw, label, input), set };
}

export function fieldRow(label, control) {
  return h('div', { class: 'field-row' }, h('span', { class: 'field-label', title: label }, label), h('div', { class: 'field-control' }, control));
}

export function section(title, body, { collapsed = false, id, store } = {}) {
  const key = id ? 'mw.section.' + id : null;
  let isCollapsed = collapsed;
  if (key && store) { const s = store.get(key); if (s !== null) isCollapsed = s === '1'; }
  const sec = h('div', { class: 'section' + (isCollapsed ? ' collapsed' : '') });
  const head = h('button', { class: 'section-head', type: 'button' }, h('span', { class: 'grow' }, title), icon('chevronDown', 'chev'));
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed');
    if (key && store) store.set(key, sec.classList.contains('collapsed') ? '1' : '0');
  });
  sec.append(head, h('div', { class: 'section-body' }, body));
  return sec;
}
