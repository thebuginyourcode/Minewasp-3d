import { h, icon, iconButton, openMenu } from './ui.js';
import { openEasePicker, curveIcon, shortLabel } from './ease.js';
import { clamp } from './util.js';
import { flattenRows, projectEnd } from './project.js';

const ROW_H = window.matchMedia('(pointer: coarse)').matches ? 36 : 32;
const RULER_H = 28;
const PAD = 14;
const LONG_PRESS = 480;

export function typeIcon(tl) {
  switch (tl.type) {
    case 'model': return tl.ref === 'human' || tl.ref === 'villager' ? 'person' : 'paw';
    case 'bone': return 'bone';
    case 'block': return 'cube';
    case 'item': return 'sword';
    case 'scenery': return 'tree';
    case 'shape': return 'shapes';
    case 'camera': return 'camera';
    case 'pointlight': return 'bulb';
    case 'spotlight': return 'spot';
    default: return 'box';
  }
}

export class TimelinePanel {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.ppf = 12;
    this.scrollX = 0;
    this.scrollY = 0;
    this.rows = [];
    this.drag = null;
    this.pointers = new Map();
    this.build();
  }

  build() {
    const a = this.app;
    this.playBtn = iconButton('play', 'Play (Space)', () => a.togglePlay());
    this.loopBtn = iconButton('loop', 'Loop playback', () => { a.loop = !a.loop; this.syncToolbar(); });
    this.frameInput = h('input', { type: 'text', inputmode: 'numeric', enterkeyhint: 'done', 'aria-label': 'Current frame' });
    this.frameInput.addEventListener('change', () => {
      const v = parseInt(this.frameInput.value, 10);
      if (Number.isFinite(v)) a.setFrame(Math.max(0, v));
      this.frameInput.blur();
    });
    this.frameInput.addEventListener('focus', () => setTimeout(() => this.frameInput.select(), 0));
    this.endLabel = h('span', {});
    this.easeLabel = h('span', {});
    this.easeBtn = h('button', { class: 'btn-ghost ease-button', type: 'button', title: 'Keyframe easing', 'aria-label': 'Keyframe easing',
      onclick: (e) => openEasePicker(e.currentTarget, a.currentTransition(), (v) => a.setTransitionForSelection(v)) },
    curveIcon('linear'), this.easeLabel);

    const toolbar = h('div', { class: 'tl-toolbar' },
      iconButton('skipStart', 'Go to start (Home)', () => a.setFrame(0)),
      iconButton('prevKey', 'Previous keyframe', () => a.jumpKey(-1)),
      this.playBtn,
      iconButton('nextKey', 'Next keyframe', () => a.jumpKey(1)),
      iconButton('skipEnd', 'Go to end (End)', () => a.setFrame(projectEnd(a.project))),
      this.loopBtn,
      h('span', { class: 'divider' }),
      h('label', { class: 'frame-box' }, 'Frame', this.frameInput, this.endLabel),
      h('span', { class: 'divider' }),
      iconButton('keyAdd', 'Add keyframe (K)', () => a.addKeyframe(), { cls: 'tl-wide' }),
      iconButton('keyRemove', 'Delete keyframes (Del)', () => a.deleteSelectedKeys(), { cls: 'tl-wide' }),
      iconButton('copy', 'Copy keyframes', () => a.copyKeys(), { cls: 'tl-wide' }),
      iconButton('paste', 'Paste keyframes at current frame', () => a.pasteKeys(), { cls: 'tl-wide' }),
      h('span', { class: 'divider' }),
      this.easeBtn,
      h('span', { class: 'spacer' }),
      iconButton('more', 'Timeline options', (e) => this.optionsMenu(e.currentTarget)),
    );

    this.rowsInner = h('div', { class: 'tl-rows-inner' });
    this.rowsEl = h('div', { class: 'tl-rows' }, this.rowsInner);
    const list = h('div', { class: 'tl-list' }, h('div', { class: 'tl-list-head' }, 'Objects'), this.rowsEl);

    this.canvas = h('canvas');
    this.track = h('div', { class: 'tl-track' }, this.canvas);
    this.emptyEl = h('div', { class: 'tl-empty' },
      h('div', {}, 'Your scene is empty.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => a.openLibrary() }, icon('add'), 'Add object'));
    this.body = h('div', { class: 'tl-body' }, list, this.track, this.emptyEl);
    this.root.append(toolbar, this.body);

    this.bindTrack();
    this.bindList();
    new ResizeObserver(() => this.draw()).observe(this.track);
  }

  optionsMenu(anchor) {
    const a = this.app;
    openMenu(anchor, [
      { label: 'Zoom in', icon: 'add', action: () => this.zoomAt(this.ppf * 1.4, this.track.clientWidth / 2) },
      { label: 'Zoom out', icon: 'chevronDown', action: () => this.zoomAt(this.ppf / 1.4, this.track.clientWidth / 2) },
      { label: 'Fit project', icon: 'focus', action: () => this.fit() },
      'sep',
      { label: 'Select all keyframes', icon: 'keyframe', action: () => a.selectAllKeys() },
      { label: 'Clear selected lane', icon: 'keyRemove', disabled: !a.selectedId, action: () => a.clearLane(a.selectedId) },
      { label: 'Multi-select', icon: 'check', checked: a.multiSelect, action: () => { a.multiSelect = !a.multiSelect; } },
      'sep',
      { label: 'Expand all', icon: 'chevronDown', action: () => a.setExpandedAll(true) },
      { label: 'Collapse all', icon: 'chevronRight', action: () => a.setExpandedAll(false) },
    ], { align: 'right' });
  }

  fit() {
    const end = Math.max(24, projectEnd(this.app.project));
    this.ppf = clamp((this.track.clientWidth - PAD * 2) / end, 1, 48);
    this.scrollX = 0;
    this.draw();
  }

  /* ---------- Rows ---------- */

  refresh() {
    const a = this.app;
    this.rows = flattenRows(a.project);
    this.emptyEl.style.display = a.project.timelines.length ? 'none' : 'flex';
    this.rowsInner.replaceChildren(...this.rows.map(({ tl, depth, hasChildren }) => {
      const chev = hasChildren
        ? h('button', { class: 'chev-btn', type: 'button', 'aria-label': tl.expanded ? 'Collapse' : 'Expand', onclick: (e) => { e.stopPropagation(); a.toggleExpanded(tl.id); } }, icon(tl.expanded ? 'chevronDown' : 'chevronRight'))
        : h('span', { style: { width: '24px', flex: 'none' } });
      const eye = h('button', { class: 'eye-btn' + (tl.hidden ? ' off' : ''), type: 'button', 'aria-label': tl.hidden ? 'Show' : 'Hide', onclick: (e) => { e.stopPropagation(); a.toggleHidden(tl.id); } }, icon(tl.hidden ? 'eyeOff' : 'eye'));
      const row = h('div', {
        class: 'tl-row' + (tl.id === a.selectedId ? ' selected' : '') + (tl.hidden ? ' hidden-row' : ''),
        style: { paddingLeft: 2 + depth * 12 + 'px' },
        'data-id': tl.id,
      }, chev, icon(typeIcon(tl), 'row-icon'), h('span', { class: 'row-name' }, tl.name), eye);
      row.addEventListener('click', () => { if (!this.listDragged) a.select(tl.id); });
      return row;
    }));
    this.clampScroll();
    this.syncList();
    this.draw();
  }

  bindList() {
    let start = null, lp = 0;
    this.rowsEl.addEventListener('pointerdown', (e) => {
      start = { y: e.clientY, x: e.clientX, sy: this.scrollY, id: e.pointerId };
      this.listDragged = false;
      const row = e.target.closest('.tl-row');
      clearTimeout(lp);
      if (row) {
        lp = setTimeout(() => {
          if (!this.listDragged && start) {
            this.listDragged = true;
            this.app.select(row.dataset.id);
            this.app.objectMenu(row.dataset.id, { x: start.x, y: start.y });
          }
        }, LONG_PRESS);
      }
    });
    this.rowsEl.addEventListener('pointermove', (e) => {
      if (!start || start.id !== e.pointerId) return;
      const dy = e.clientY - start.y;
      if (Math.abs(dy) > 6) { this.listDragged = true; clearTimeout(lp); }
      if (this.listDragged) {
        this.scrollY = start.sy - dy;
        this.clampScroll();
        this.syncList();
        this.draw();
      }
    });
    const end = () => { start = null; clearTimeout(lp); setTimeout(() => { this.listDragged = false; }, 0); };
    this.rowsEl.addEventListener('pointerup', end);
    this.rowsEl.addEventListener('pointercancel', end);
    this.rowsEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const row = e.target.closest('.tl-row');
      if (row) { this.app.select(row.dataset.id); this.app.objectMenu(row.dataset.id, { x: e.clientX, y: e.clientY }); }
    });
    this.rowsEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scrollY += e.deltaY;
      this.clampScroll();
      this.syncList();
      this.draw();
    }, { passive: false });
  }

  syncList() {
    this.rowsInner.style.transform = `translateY(${-this.scrollY}px)`;
  }

  clampScroll() {
    const viewH = Math.max(0, this.track.clientHeight - RULER_H);
    const maxY = Math.max(0, this.rows.length * ROW_H - viewH + 8);
    this.scrollY = clamp(this.scrollY, 0, maxY);
    this.scrollX = Math.max(0, this.scrollX);
  }

  syncToolbar() {
    const a = this.app;
    this.playBtn.replaceChildren(icon(a.playing ? 'pause' : 'play'));
    this.playBtn.title = a.playing ? 'Pause (Space)' : 'Play (Space)';
    this.loopBtn.classList.toggle('active', a.loop);
    if (document.activeElement !== this.frameInput) this.frameInput.value = Math.floor(a.frame);
    this.endLabel.textContent = '/ ' + projectEnd(a.project);
    const tr = a.currentTransition();
    if (this.easeBtn.dataset.t !== tr) {
      this.easeBtn.dataset.t = tr;
      this.easeBtn.querySelector('svg').replaceWith(curveIcon(tr));
      this.easeLabel.textContent = shortLabel(tr);
    }
  }

  /* ---------- Track geometry ---------- */

  frameToX(f) { return f * this.ppf - this.scrollX + PAD; }
  xToFrame(x) { return Math.max(0, Math.round((x - PAD + this.scrollX) / this.ppf)); }
  rowAt(y) {
    if (y < RULER_H) return -1;
    const i = Math.floor((y - RULER_H + this.scrollY) / ROW_H);
    return i >= 0 && i < this.rows.length ? i : -1;
  }

  keyHit(rowIndex, x) {
    const row = this.rows[rowIndex];
    if (!row) return null;
    const tol = Math.max(10, this.ppf / 2);
    let best = null, bestD = tol;
    for (const k of row.tl.keys) {
      const d = Math.abs(this.frameToX(k.f) - x);
      if (d <= bestD) { best = k; bestD = d; }
    }
    return best;
  }

  zoomAt(ppf, anchorX) {
    const f = (anchorX - PAD + this.scrollX) / this.ppf;
    this.ppf = clamp(ppf, 1, 64);
    this.scrollX = f * this.ppf - anchorX + PAD;
    this.clampScroll();
    this.draw();
  }

  ensureFrameVisible(f) {
    const x = this.frameToX(f);
    const w = this.track.clientWidth;
    if (x > w - PAD) this.scrollX += x - w * 0.25;
    else if (x < PAD) this.scrollX = Math.max(0, f * this.ppf - w * 0.25);
  }

  /* ---------- Track input ---------- */

  bindTrack() {
    const el = this.track;
    const local = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        clearTimeout(this.drag?.lp);
        if (this.drag?.mode === 'move') this.drag.delta = 0;
        const [a, b] = [...this.pointers.values()];
        this.drag = { mode: 'pinch', dist: Math.abs(a.x - b.x) || 1, ppf: this.ppf, cx: (a.x + b.x) / 2 };
        this.draw();
        return;
      }
      if (this.pointers.size > 2) return;

      const app = this.app;
      if (p.y < RULER_H) {
        this.drag = { mode: 'scrub' };
        if (app.playing) app.togglePlay();
        app.setFrame(this.xToFrame(p.x));
        return;
      }
      const ri = this.rowAt(p.y);
      const key = ri >= 0 ? this.keyHit(ri, p.x) : null;
      const d = { start: p, sx: this.scrollX, sy: this.scrollY, row: ri, key, mode: key ? 'key-pending' : 'pan-pending', shift: e.shiftKey || e.ctrlKey || e.metaKey };
      d.lp = setTimeout(() => {
        if (this.drag !== d || !d.mode.endsWith('pending')) return;
        d.mode = 'done';
        const tl = this.rows[ri]?.tl;
        if (key && tl) {
          if (!app.isKeySelected(tl.id, key.f)) app.selectKey(tl.id, key.f, false);
          app.keyMenu({ x: e.clientX, y: e.clientY });
        } else {
          if (tl) app.select(tl.id);
          app.setFrame(this.xToFrame(p.x));
          app.keyMenu({ x: e.clientX, y: e.clientY });
        }
      }, LONG_PRESS);
      this.drag = d;
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      const d = this.drag;
      if (!d) return;
      const app = this.app;
      if (d.mode === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.abs(a.x - b.x) || 1;
        this.zoomAt(d.ppf * (dist / d.dist), d.cx);
        return;
      }
      if (d.mode === 'scrub') { app.setFrame(this.xToFrame(p.x)); this.autoEdge(p.x); return; }
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (d.mode === 'key-pending' && Math.hypot(dx, dy) > 6) {
        clearTimeout(d.lp);
        const tl = this.rows[d.row].tl;
        if (!app.isKeySelected(tl.id, d.key.f)) app.selectKey(tl.id, d.key.f, d.shift || app.multiSelect);
        d.mode = 'move';
        d.delta = 0;
      }
      if (d.mode === 'pan-pending' && Math.hypot(dx, dy) > 6) { clearTimeout(d.lp); d.mode = 'pan'; }
      if (d.mode === 'move') {
        const raw = Math.round(dx / this.ppf);
        d.delta = Math.max(raw, -app.minSelectedFrame());
        this.draw();
      } else if (d.mode === 'pan') {
        this.scrollX = d.sx - dx;
        this.scrollY = d.sy - dy;
        this.clampScroll();
        this.syncList();
        this.draw();
      }
    });

    const up = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const d = this.drag;
      if (!d) return;
      if (d.mode === 'pinch') { if (this.pointers.size === 0) this.drag = null; return; }
      if (this.pointers.size > 0) return;
      clearTimeout(d.lp);
      const app = this.app;
      const tl = this.rows[d.row]?.tl;
      if (e.type !== 'pointercancel') {
        if (d.mode === 'key-pending' && tl) {
          app.select(tl.id, { keepKeys: true });
          app.selectKey(tl.id, d.key.f, d.shift || app.multiSelect);
          if (!d.shift && !app.multiSelect) app.setFrame(d.key.f);
        } else if (d.mode === 'pan-pending') {
          const f = this.xToFrame(d.start.x);
          const now = performance.now();
          const last = this.lastTap;
          // Double-tap an empty spot to add a keyframe there.
          if (tl && last && now - last.t < 350 && last.id === tl.id && Math.abs(last.f - f) <= 1) {
            this.lastTap = null;
            app.select(tl.id);
            app.setFrame(f);
            app.addKeyframe();
          } else {
            this.lastTap = tl ? { t: now, id: tl.id, f } : null;
            if (tl) app.select(tl.id);
            if (!d.shift && !app.multiSelect) app.clearKeySelection();
            app.setFrame(f);
          }
        } else if (d.mode === 'move' && d.delta) {
          app.moveSelectedKeys(d.delta);
        }
      }
      this.drag = null;
      this.draw();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = local(e);
      const ri = this.rowAt(p.y);
      const key = ri >= 0 ? this.keyHit(ri, p.x) : null;
      const tl = this.rows[ri]?.tl;
      if (key && tl && !this.app.isKeySelected(tl.id, key.f)) this.app.selectKey(tl.id, key.f, false);
      this.app.keyMenu({ x: e.clientX, y: e.clientY });
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      if (e.ctrlKey || e.metaKey) {
        this.zoomAt(this.ppf * Math.exp(-e.deltaY * 0.0025), p.x);
      } else {
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.scrollX += e.deltaX || e.deltaY;
        else this.scrollY += e.deltaY;
        this.clampScroll();
        this.syncList();
        this.draw();
      }
    }, { passive: false });
  }

  autoEdge(x) {
    const w = this.track.clientWidth;
    if (x > w - 20) { this.scrollX += 8; this.draw(); }
    else if (x < 20 && this.scrollX > 0) { this.scrollX = Math.max(0, this.scrollX - 8); this.draw(); }
  }

  /* ---------- Drawing ---------- */

  draw() {
    const cv = this.canvas;
    const w = this.track.clientWidth, hgt = this.track.clientHeight;
    if (!w || !hgt) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hgt * dpr);
      cv.style.width = w + 'px';
      cv.style.height = hgt + 'px';
    }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = this.app;
    const fps = a.project.fps;
    const end = projectEnd(a.project);

    c.fillStyle = '#111111';
    c.fillRect(0, 0, w, hgt);

    // Rows
    const first = Math.max(0, Math.floor(this.scrollY / ROW_H));
    const last = Math.min(this.rows.length, Math.ceil((this.scrollY + hgt - RULER_H) / ROW_H) + 1);
    for (let i = first; i < last; i++) {
      const y = RULER_H + i * ROW_H - this.scrollY;
      const tl = this.rows[i].tl;
      if (tl.id === a.selectedId) { c.fillStyle = 'rgba(255,255,255,0.055)'; c.fillRect(0, y, w, ROW_H); }
      c.fillStyle = 'rgba(255,255,255,0.045)';
      c.fillRect(0, y + ROW_H - 1, w, 1);
    }

    // Beyond project end
    const ex = this.frameToX(end);
    if (ex < w) { c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(Math.max(0, ex), RULER_H, w - ex, hgt); }

    // Grid
    const f0 = Math.max(0, Math.floor((this.scrollX - PAD) / this.ppf));
    const f1 = Math.ceil((this.scrollX + w) / this.ppf);
    for (let f = f0; f <= f1; f++) {
      const major = f % fps === 0;
      if (!major && this.ppf < 7) continue;
      const x = Math.round(this.frameToX(f)) + 0.5;
      c.fillStyle = major ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.025)';
      c.fillRect(x, RULER_H, 1, hgt - RULER_H);
    }

    // Keyframes
    const drag = this.drag?.mode === 'move' ? this.drag : null;
    for (let i = first; i < last; i++) {
      const tl = this.rows[i].tl;
      const cy = RULER_H + i * ROW_H - this.scrollY + ROW_H / 2;
      for (const k of tl.keys) {
        const sel = a.isKeySelected(tl.id, k.f);
        const f = k.f + (sel && drag ? drag.delta : 0);
        const x = this.frameToX(f);
        if (x < -10 || x > w + 10) continue;
        this.drawKey(c, x, cy, sel, k.t, tl.type === 'bone');
      }
    }

    // Ruler
    c.fillStyle = '#0a0a0a';
    c.fillRect(0, 0, w, RULER_H);
    c.fillStyle = 'rgba(255,255,255,0.07)';
    c.fillRect(0, RULER_H - 1, w, 1);
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const step = steps.find((s) => s * this.ppf >= 52) || 5000;
    const minor = steps.find((s) => s * this.ppf >= 8 && step % s === 0) || step;
    c.font = '11px "Segoe UI Variable Text","Segoe UI",-apple-system,Roboto,sans-serif';
    c.textBaseline = 'middle';
    for (let f = Math.floor(f0 / minor) * minor; f <= f1; f += minor) {
      const x = Math.round(this.frameToX(f)) + 0.5;
      const isMajor = f % step === 0;
      c.fillStyle = isMajor ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)';
      c.fillRect(x, isMajor ? RULER_H - 9 : RULER_H - 5, 1, isMajor ? 8 : 4);
      if (isMajor) { c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillText(String(f), x + 4, 10); }
    }

    // Playhead
    const px = Math.round(this.frameToX(a.frame)) + 0.5;
    if (px > -40 && px < w + 40) {
      c.fillStyle = '#60cdff';
      c.fillRect(px - 0.75, RULER_H, 1.5, hgt - RULER_H);
      const label = String(Math.floor(a.frame));
      const tw = Math.max(22, c.measureText(label).width + 12);
      this.roundRect(c, px - tw / 2, 3, tw, RULER_H - 7, 4);
      c.fill();
      c.fillStyle = '#000';
      c.textAlign = 'center';
      c.font = '600 11px "Segoe UI Variable Text","Segoe UI",-apple-system,Roboto,sans-serif';
      c.fillText(label, px, RULER_H / 2 - 1);
      c.textAlign = 'start';
    }
  }

  drawKey(c, x, y, selected, transition, isBone) {
    const r = 6;
    c.beginPath();
    if (transition === 'instant') {
      c.rect(x - r + 1, y - r + 1, (r - 1) * 2, (r - 1) * 2);
    } else {
      c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath();
    }
    c.fillStyle = selected ? '#60cdff' : isBone ? '#b8b8b8' : '#e6e6e6';
    c.fill();
    c.lineWidth = 1;
    c.strokeStyle = selected ? '#e8f8ff' : 'rgba(0,0,0,0.6)';
    c.stroke();
    if (transition && transition !== 'linear' && transition !== 'instant') {
      c.fillStyle = selected ? '#00384f' : '#3a3a3a';
      c.beginPath();
      c.arc(x, y, 1.6, 0, Math.PI * 2);
      c.fill();
    }
  }

  roundRect(c, x, y, w, hh, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + hh, r);
    c.arcTo(x + w, y + hh, x, y + hh, r);
    c.arcTo(x, y + hh, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
}
