/*
 * Viewport action bar, placed in the thumb zone: frame stepping, axis choice,
 * a drag pad that adjusts the chosen axis precisely, and one-tap keyframing.
 */
import { h, icon, openMenu } from './ui.js';
import { evaluate, keyAt, findTl } from './project.js';
import { fmt } from './util.js';
import * as native from './native.js';

const TOOL_LABEL = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' };
const PREFIX = { translate: 'p', rotate: 'r', scale: 's' };
// Units per pixel of drag, and the step used when snapping is on / off.
const RATE = { translate: 0.1, rotate: 0.5, scale: 0.004 };
const STEP = { translate: [0.5, 0.05], rotate: [5, 0.5], scale: [0.05, 0.01] };

/* Button that repeats while held, for stepping through frames. */
function holdButton(iconName, label, fire) {
  const b = h('button', { class: 'btn-ghost icon-only', type: 'button', title: label, 'aria-label': label }, icon(iconName));
  let delay = 0, repeat = 0;
  const stop = () => { clearTimeout(delay); clearInterval(repeat); };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fire();
    delay = setTimeout(() => { repeat = setInterval(fire, 70); }, 380);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

export class ActionBar {
  constructor(root, app) {
    this.app = app;
    this.axis = null;

    const step = (d) => { if (app.playing) app.togglePlay(); app.setFrame(Math.max(0, Math.floor(app.frame) + d)); };
    const frames = h('div', { class: 'ab-group' },
      holdButton('chevronLeft', 'Previous frame', () => step(-1)),
      holdButton('chevronRight', 'Next frame', () => step(1)));

    this.axisBtns = {};
    const transform = h('div', { class: 'ab-group ab-transform' });
    for (const ax of ['x', 'y', 'z']) {
      const b = h('button', {
        class: `btn-ghost ab-axis ${ax}`, type: 'button', title: `${ax.toUpperCase()} axis`, 'aria-label': `${ax.toUpperCase()} axis`,
        onclick: () => this.setAxis(this.axis === ax ? null : ax),
      }, ax.toUpperCase());
      this.axisBtns[ax] = b;
      transform.append(b);
    }
    this.pad = h('div', { class: 'ab-pad', role: 'slider', 'aria-label': 'Drag to adjust the selected axis' });
    transform.append(this.pad);

    this.keyBtn = h('button', { class: 'ab-key', type: 'button', title: 'Add keyframe', 'aria-label': 'Add keyframe' }, icon('keyAdd'));

    root.append(frames, transform, this.keyBtn);
    this.bindPad();
    this.bindKey();
    this.sync();
  }

  setAxis(axis) {
    this.axis = axis;
    this.app.engine.setAxisLock(axis);
    native.haptic('tick');
    this.sync();
  }

  selected() {
    return findTl(this.app.project, this.app.selectedId);
  }

  /* The value(s) the pad drives, or a reason it can't. */
  target() {
    const a = this.app;
    const tl = this.selected();
    if (!tl) return { reason: 'Select a part to adjust it here' };
    if (a.tool === 'select') return { reason: 'Choose Move, Rotate or Scale above' };
    if (a.engine.viewCamId === tl.id) return { reason: 'Orbit the view to move this camera' };
    if (!this.axis) {
      if (a.tool === 'scale') return { tl, keys: ['sx', 'sy', 'sz'], tool: 'Scale', axis: 'all' };
      return { reason: 'Pick X, Y or Z, then drag here' };
    }
    return { tl, keys: [PREFIX[a.tool] + this.axis], tool: TOOL_LABEL[a.tool], axis: this.axis.toUpperCase() };
  }

  sync() {
    const a = this.app;
    const tl = this.selected();
    const f = Math.floor(a.frame);
    const keyed = !!(tl && keyAt(tl, f));
    this.keyBtn.disabled = !tl;
    this.keyBtn.classList.toggle('keyed', keyed);
    this.keyBtn.title = keyed ? `Keyframe at frame ${f} (hold for options)` : 'Add keyframe (hold for options)';
    this.keyBtn.replaceChildren(icon(keyed ? 'keyframe' : 'keyAdd'));
    for (const [k, b] of Object.entries(this.axisBtns)) b.classList.toggle('active', k === this.axis);
    if (!this.dragging) this.renderPad();
  }

  renderPad(value) {
    const t = this.target();
    this.pad.classList.toggle('disabled', !t.keys);
    if (!t.keys) { this.pad.replaceChildren(h('span', {}, t.reason)); return; }
    const v = value ?? evaluate(t.tl, this.app.frame, this.app.project)[t.keys[0]];
    const unit = this.app.tool === 'rotate' ? '°' : this.app.tool === 'scale' ? '×' : '';
    this.pad.replaceChildren(
      h('span', { class: 'pad-chev' }, '‹'),
      h('span', { class: 'pad-tool' }, t.tool),
      h('span', {}, t.axis),
      h('b', {}, fmt(v, 2) + unit),
      h('span', { class: 'pad-chev' }, '›'));
  }

  bindPad() {
    const pad = this.pad;
    let drag = null, lastTap = 0;
    pad.addEventListener('pointerdown', (e) => {
      const t = this.target();
      if (!t.keys) return;
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      const now = performance.now();
      // Double-tap resets the value.
      if (now - lastTap < 300) {
        lastTap = 0;
        const reset = Object.fromEntries(t.keys.map((k) => [k, k.startsWith('s') ? 1 : 0]));
        this.app.beginEdit();
        this.app.setValuesLive(t.tl.id, reset);
        this.app.endEdit();
        native.haptic('light');
        this.sync();
        return;
      }
      lastTap = now;
      const start = evaluate(t.tl, this.app.frame, this.app.project);
      drag = { x: e.clientX, id: t.tl.id, keys: t.keys, start: t.keys.map((k) => start[k]), last: null, began: false };
    });
    pad.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.began) {
        if (Math.abs(dx) < 4) return;
        drag.began = true;
        this.dragging = true;
        pad.classList.add('dragging');
        this.app.beginEdit();
      }
      const tool = this.app.tool;
      const step = STEP[tool][this.app.snap ? 0 : 1];
      const values = {};
      drag.keys.forEach((k, i) => {
        let v = drag.start[i] + dx * RATE[tool];
        v = Math.round(v / step) * step;
        values[k] = +v.toFixed(4);
      });
      const first = values[drag.keys[0]];
      pad.style.setProperty('--pad-shift', `${dx}px`);
      if (first !== drag.last) {
        if (drag.last !== null && this.app.snap) native.haptic('tick');
        drag.last = first;
        this.app.setValuesLive(drag.id, values);
        this.renderPad(first);
      }
    });
    const end = () => {
      if (!drag) return;
      if (drag.began) {
        this.app.endEdit();
        pad.classList.remove('dragging');
      }
      drag = null;
      this.dragging = false;
      this.sync();
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }

  bindKey() {
    const b = this.keyBtn;
    let timer = 0, held = false;
    b.addEventListener('pointerdown', () => {
      held = false;
      timer = setTimeout(() => { held = true; native.haptic('light'); this.keyMenu(); }, 480);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(timer));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(timer); held = true; this.keyMenu(); });
    b.addEventListener('click', () => {
      if (held) { held = false; return; }
      const tl = this.selected();
      if (!tl) return;
      const f = Math.floor(this.app.frame);
      if (keyAt(tl, f)) { this.app.keyMenuToast?.(f); return; }
      this.app.addKeyframe();
      native.haptic('light');
    });
  }

  keyMenu() {
    const a = this.app;
    const tl = this.selected();
    if (!tl) return;
    const f = Math.floor(a.frame);
    const root = tl.type === 'bone' ? findTl(a.project, tl.owner) : tl;
    const hasParts = a.project.timelines.some((t) => t.owner === root.id);
    openMenu(this.keyBtn, [
      { header: `Frame ${f}` },
      { label: 'Add keyframe', icon: 'keyAdd', disabled: !!keyAt(tl, f), action: () => a.addKeyframe() },
      ...(hasParts ? [{ label: `Key all of ${root.name}`, icon: 'layers', action: () => a.keyWholeObject(root.id) }] : []),
      'sep',
      { label: 'Delete this keyframe', icon: 'keyRemove', disabled: !keyAt(tl, f), action: () => a.deleteKeyAt(tl.id, f) },
      ...(hasParts ? [{ label: `Delete all of ${root.name} here`, icon: 'trash', action: () => a.deleteObjectKeysAt(root.id, f) }] : []),
    ], { align: 'right' });
  }
}
