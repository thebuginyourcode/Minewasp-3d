/* Visual easing controls: curve previews, the curve picker and quick presets. */
import { ease, transitionLabel } from './util.js';
import { h, showFlyout, closeFlyout, combo } from './ui.js';

export const FAMILIES = [
  ['Sine', 'Sine'], ['Quad', 'Quadratic'], ['Cubic', 'Cubic'], ['Quart', 'Quartic'], ['Quint', 'Quintic'],
  ['Expo', 'Exponential'], ['Circ', 'Circular'], ['Back', 'Back'], ['Elastic', 'Elastic'], ['Bounce', 'Bounce'],
];

const KINDS = [
  ['linear', 'Linear'], ['in', 'Ease in'], ['out', 'Ease out'], ['inout', 'Ease in-out'], ['instant', 'Instant'],
];

/* Splits a transition id into { kind, family }. */
export function splitTransition(id = 'linear') {
  if (id === 'linear' || id === 'instant') return { kind: id, family: null };
  const m = /^ease(InOut|In|Out)(\w+)$/.exec(id);
  if (!m) return { kind: 'linear', family: null };
  return { kind: { In: 'in', Out: 'out', InOut: 'inout' }[m[1]], family: m[2] };
}

export function joinTransition(kind, family = 'Sine') {
  if (kind === 'linear' || kind === 'instant') return kind;
  return 'ease' + { in: 'In', out: 'Out', inout: 'InOut' }[kind] + family;
}

/* Small SVG plot of a transition curve. */
export function curveIcon(id, w = 44, hgt = 30) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('class', 'curve-icon');
  svg.setAttribute('aria-hidden', 'true');
  const pad = 4;
  const ys = [];
  for (let i = 0; i <= 40; i++) ys.push(id === 'instant' ? (i < 40 ? 0 : 1) : ease(id, i / 40));
  const lo = Math.min(0, ...ys), hi = Math.max(1, ...ys);
  const X = (t) => pad + t * (w - pad * 2);
  const Y = (v) => hgt - pad - ((v - lo) / (hi - lo)) * (hgt - pad * 2);
  const base = document.createElementNS(NS, 'path');
  base.setAttribute('d', `M${X(0)} ${Y(0)}H${X(1)}M${X(0)} ${Y(1)}H${X(1)}`);
  base.setAttribute('class', 'curve-guide');
  const path = document.createElementNS(NS, 'path');
  let d = '';
  if (id === 'instant') d = `M${X(0)} ${Y(0)}H${X(1)}V${Y(1)}`;
  else ys.forEach((v, i) => { d += `${i ? 'L' : 'M'}${X(i / 40).toFixed(1)} ${Y(v).toFixed(1)}`; });
  path.setAttribute('d', d);
  path.setAttribute('class', 'curve-line');
  svg.append(base, path);
  return svg;
}

/* Short label for compact buttons, e.g. "Ease in-out · Sine". */
export function shortLabel(id) {
  const { kind, family } = splitTransition(id);
  const k = KINDS.find(([v]) => v === kind)?.[1] || 'Linear';
  return family ? `${k} · ${FAMILIES.find(([f]) => f === family)?.[0] || family}` : k;
}

/* Grid of every transition: rows are curve families, columns are in / out / in-out. */
export function openEasePicker(anchor, current, onPick) {
  const pick = (id) => { closeFlyout(); onPick(id); };
  const tile = (id, label) => {
    const b = h('button', { class: 'ease-tile' + (id === current ? ' selected' : ''), type: 'button', title: transitionLabel(id), 'aria-label': transitionLabel(id), onclick: () => pick(id) }, curveIcon(id));
    if (label) b.append(h('span', {}, label));
    return b;
  };
  const grid = h('div', { class: 'ease-grid' },
    h('span'), h('span', { class: 'ease-col' }, 'In'), h('span', { class: 'ease-col' }, 'Out'), h('span', { class: 'ease-col' }, 'In-out'));
  for (const [f, name] of FAMILIES) {
    grid.append(h('span', { class: 'ease-row' }, name),
      tile(joinTransition('in', f)), tile(joinTransition('out', f)), tile(joinTransition('inout', f)));
  }
  const content = h('div', { class: 'ease-picker' },
    h('div', { class: 'ease-basic' }, tile('linear', 'Linear'), tile('instant', 'Instant')),
    grid);
  showFlyout(anchor, content, { cls: 'ease-flyout', align: 'right' });
}

/*
 * Quick controls for the properties panel: one-tap kinds with curve previews
 * and a curve-family selector. Returns { el, set(id), setEnabled(on) }.
 */
export function easeControls(onChange) {
  let currentId = 'linear';
  let family = 'Sine';
  const buttons = {};
  const row = h('div', { class: 'ease-kinds', role: 'radiogroup', 'aria-label': 'Transition' });
  for (const [kind, label] of KINDS) {
    const b = h('button', { class: 'ease-kind', type: 'button', role: 'radio', onclick: () => onChange(joinTransition(kind, family)) },
      curveIcon(joinTransition(kind, 'Sine'), 40, 26), h('span', {}, label));
    buttons[kind] = b;
    row.append(b);
  }
  const fam = combo({
    value: family,
    options: FAMILIES.map(([v, label]) => ({ value: v, label })),
    onChange: (v) => {
      family = v;
      const { kind } = splitTransition(currentId);
      if (kind !== 'linear' && kind !== 'instant') onChange(joinTransition(kind, v));
      refreshIcons();
    },
  });
  const famRow = h('div', { class: 'field-row' }, h('span', { class: 'field-label' }, 'Curve'), h('div', { class: 'field-control' }, fam.el));
  const refreshIcons = () => {
    for (const k of ['in', 'out', 'inout']) buttons[k].querySelector('svg').replaceWith(curveIcon(joinTransition(k, family), 40, 26));
  };
  return {
    el: h('div', { class: 'ease-controls' }, row, famRow),
    set(id) {
      currentId = id;
      const s = splitTransition(id);
      if (s.family && s.family !== family) { family = s.family; fam.set(family); refreshIcons(); }
      for (const [k, b] of Object.entries(buttons)) { b.classList.toggle('selected', k === s.kind); b.setAttribute('aria-checked', k === s.kind); }
      famRow.style.opacity = s.family ? '' : '0.5';
    },
    setEnabled(on) {
      for (const b of Object.values(buttons)) b.disabled = !on;
      fam.el.querySelector('select').disabled = !on;
    },
  };
}
