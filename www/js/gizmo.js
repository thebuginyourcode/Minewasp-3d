/*
 * Touch-first transform gizmo.
 *
 * - Handles never hide or fade on their own; only the axis being dragged is
 *   highlighted while a drag is in progress.
 * - Hit-testing is done in screen space with finger-sized tolerances.
 * - Drags follow the handle's on-screen direction, so they stay stable even
 *   when an axis points toward the camera.
 * - Rotation rings are gimbal rings: each one changes exactly one rotation
 *   value (X, Y or Z), matching the keyframed numbers.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
const COLORS = { x: 0xff5c5c, y: 0x7ed957, z: 0x4aa3ff, all: 0xe8e8e8 };
const ACTIVE = 0xffd84a;
const SCREEN_RADIUS = 92;     // gizmo radius on screen, CSS px
const HIT_AXIS = 26;          // touch tolerance for arrows, CSS px
const HIT_RING = 22;          // touch tolerance for rings, CSS px
const AXES = ['x', 'y', 'z'];
const UNIT = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

function material(color) {
  return new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, fog: false, toneMapped: false });
}

function arrow(color, tip) {
  const g = new THREE.Group();
  const m = material(color);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.72, 8), m);
  shaft.position.y = 0.15 + 0.36;
  const head = tip === 'cube'
    ? new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), m)
    : new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.24, 16), m);
  head.position.y = tip === 'cube' ? 0.95 : 0.99;
  g.add(shaft, head);
  g.userData.material = m;
  return g;
}

function ring(color) {
  const m = material(color);
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.032, 6, 72), m);
  mesh.userData.material = m;
  return mesh;
}

export class Gizmo {
  constructor(engine) {
    this.engine = engine;
    this.mode = 'translate';
    this.space = 'local';
    this.snap = true;
    this.axisLock = null;
    this.object = null;
    this.tl = null;
    this.drag = null;
    this.scale = 1;

    this.root = new THREE.Group();
    this.root.visible = false;
    this.root.renderOrder = 1000;
    this.parts = { translate: {}, rotate: {}, scale: {} };
    for (const ax of AXES) {
      const t = arrow(COLORS[ax], 'cone');
      const s = arrow(COLORS[ax], 'cube');
      const r = ring(COLORS[ax]);
      this.parts.translate[ax] = t;
      this.parts.scale[ax] = s;
      this.parts.rotate[ax] = r;
      this.root.add(t, s, r);
    }
    const center = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material(COLORS.all));
    center.userData.material = center.material;
    this.parts.scale.all = center;
    this.root.add(center);
    this.root.traverse((o) => { o.renderOrder = 1000; o.userData.noPick = true; });

    this.bindPointer();
  }

  get dragging() { return !!this.drag; }

  attach(object, tl) { this.object = object; this.tl = tl; this.syncVisibility(); }
  detach() { this.object = null; this.tl = null; this.drag = null; this.root.visible = false; }
  setMode(mode) { this.mode = mode; this.syncVisibility(); }
  setSpace(space) { this.space = space; }
  setSnap(on) { this.snap = on; }
  setAxisLock(axis) { this.axisLock = axis; this.syncVisibility(); }

  /* Which handles exist for the current mode and axis lock. */
  handles() {
    const axes = this.axisLock ? [this.axisLock] : AXES;
    const list = axes.map((ax) => ({ ax, obj: this.parts[this.mode][ax] }));
    if (this.mode === 'scale' && !this.axisLock) list.push({ ax: 'all', obj: this.parts.scale.all });
    return list;
  }

  syncVisibility() {
    for (const group of Object.values(this.parts)) for (const o of Object.values(group)) o.visible = false;
    if (!this.object || !this.parts[this.mode]) { this.root.visible = false; return; }
    for (const { obj } of this.handles()) obj.visible = true;
    this.root.visible = true;
    this.highlight(null);
  }

  highlight(activeAxis) {
    for (const { ax, obj } of this.handles()) {
      const m = obj.userData.material;
      m.color.setHex(ax === activeAxis ? ACTIVE : COLORS[ax]);
      m.opacity = activeAxis && ax !== activeAxis ? 0.3 : 0.95;
    }
  }

  /* ---------- Frames ---------- */

  parentQuat() {
    const q = new THREE.Quaternion();
    this.object.parent.getWorldQuaternion(q);
    return q;
  }

  /* World-space direction of an axis for the current mode. */
  axisWorld(ax) {
    const v = UNIT[ax].clone();
    if (this.mode === 'rotate') {
      // Gimbal axes for Euler XYZ: X in the parent frame, Y after X, Z after X and Y.
      const r = this.object.rotation;
      const pre = new THREE.Quaternion();
      if (ax === 'y') pre.setFromEuler(new THREE.Euler(r.x, 0, 0, 'XYZ'));
      if (ax === 'z') pre.setFromEuler(new THREE.Euler(r.x, r.y, 0, 'XYZ'));
      return v.applyQuaternion(pre).applyQuaternion(this.parentQuat()).normalize();
    }
    if (this.mode === 'scale' || this.space === 'local') {
      return v.applyQuaternion(this.object.getWorldQuaternion(new THREE.Quaternion())).normalize();
    }
    return v;
  }

  origin() {
    return this.object.getWorldPosition(new THREE.Vector3());
  }

  /* ---------- Per-frame update ---------- */

  update(camera, viewportHeight) {
    if (!this.object || !this.root.visible) return;
    const o = this.origin();
    const dist = camera.position.distanceTo(o);
    this.scale = (2 * dist * Math.tan((camera.fov * DEG) / 2) / Math.max(1, viewportHeight)) * SCREEN_RADIUS;
    this.root.position.copy(o);
    this.root.scale.setScalar(this.scale);
    const up = new THREE.Vector3(0, 1, 0);
    const zf = new THREE.Vector3(0, 0, 1);
    for (const ax of AXES) {
      const dir = this.axisWorld(ax);
      this.parts.translate[ax].quaternion.setFromUnitVectors(up, dir);
      this.parts.scale[ax].quaternion.setFromUnitVectors(up, dir);
      this.parts.rotate[ax].quaternion.setFromUnitVectors(zf, dir);
    }
    this.parts.scale.all.quaternion.copy(this.object.getWorldQuaternion(new THREE.Quaternion()));
  }

  /* ---------- Screen-space hit testing ---------- */

  toScreen(v) {
    const e = this.engine;
    const cam = e.activeCamera();
    const rect = e.renderer.domElement.getBoundingClientRect();
    const p = v.clone().project(cam);
    return { x: (p.x + 1) / 2 * rect.width, y: (1 - p.y) / 2 * rect.height, behind: p.z > 1 };
  }

  hit(px, py) {
    if (!this.object || !this.root.visible) return null;
    this.update(this.engine.activeCamera(), this.engine.renderer.domElement.clientHeight);
    const o = this.origin();
    const so = this.toScreen(o);
    let best = null;
    const consider = (ax, d, extra) => { if (!best || d < best.d) best = { ax, d, ...extra }; };
    for (const { ax } of this.handles()) {
      if (ax === 'all') {
        const d = Math.hypot(px - so.x, py - so.y);
        if (d < HIT_AXIS) consider('all', d);
        continue;
      }
      const dir = this.axisWorld(ax);
      if (this.mode === 'rotate') {
        const n = dir;
        const u = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? UNIT.y : UNIT.x).normalize();
        const w = new THREE.Vector3().crossVectors(n, u);
        let prev = null, bestRing = null;
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          const pw = o.clone().addScaledVector(u, Math.cos(a) * 0.9 * this.scale).addScaledVector(w, Math.sin(a) * 0.9 * this.scale);
          const ps = this.toScreen(pw);
          if (prev) {
            const d = segmentDistance(px, py, prev.s, ps);
            if (d < HIT_RING && (!bestRing || d < bestRing.d)) bestRing = { d, point: prev.w.clone().lerp(pw, 0.5) };
          }
          prev = { s: ps, w: pw };
        }
        if (bestRing) consider(ax, bestRing.d, { point: bestRing.point });
      } else {
        const a = this.toScreen(o.clone().addScaledVector(dir, 0.15 * this.scale));
        const b = this.toScreen(o.clone().addScaledVector(dir, 1.1 * this.scale));
        if (Math.hypot(b.x - a.x, b.y - a.y) < 10) continue;
        const d = segmentDistance(px, py, a, b);
        if (d < HIT_AXIS) consider(ax, d);
      }
    }
    return best;
  }

  /* ---------- Dragging ---------- */

  bindPointer() {
    const el = this.engine.container;
    const local = (e) => { const r = this.engine.renderer.domElement.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    // Capture phase on the container so the gizmo wins over orbiting and picking.
    el.addEventListener('pointerdown', (e) => {
      if (this.drag || this.pending || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const p = local(e);
      const h = this.hit(p.x, p.y);
      if (!h) return;
      e.preventDefault();
      e.stopPropagation();
      // Becomes a drag once the finger moves; a plain tap falls through to selection.
      this.pending = { h, p, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY };
    }, true);
    const move = (e) => {
      const pd = this.pending;
      if (pd && e.pointerId === pd.pointerId) {
        const q = local(e);
        if (Math.hypot(q.x - pd.p.x, q.y - pd.p.y) < 5) return;
        this.pending = null;
        this.startDrag(pd.h, pd.p, pd.pointerId);
      }
      if (!this.drag || e.pointerId !== this.drag.pointerId) return;
      this.dragTo(local(e));
    };
    const up = (e) => {
      const pd = this.pending;
      if (pd && e.pointerId === pd.pointerId) {
        this.pending = null;
        const id = this.engine.pick(pd.clientX, pd.clientY);
        if (id && id !== this.tl?.id) this.engine.app.select(id);
        return;
      }
      if (!this.drag || e.pointerId !== this.drag.pointerId) return;
      this.endDrag();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  startDrag(h, p, pointerId) {
    const e = this.engine;
    const obj = this.object;
    const o = this.origin();
    const dir = h.ax === 'all' ? null : this.axisWorld(h.ax);
    const drag = {
      ax: h.ax, pointerId, start: p, dir, origin: o,
      pos: obj.position.clone(), rot: [obj.rotation.x / DEG, obj.rotation.y / DEG, obj.rotation.z / DEG],
      scl: obj.scale.clone(), lastKey: null,
    };
    const so = this.toScreen(o);
    if (this.mode === 'rotate') {
      // Screen direction of increasing angle at the grabbed point on the ring.
      const radial = h.point.clone().sub(o).normalize();
      const tangent = new THREE.Vector3().crossVectors(dir, radial).normalize();
      const a = this.toScreen(h.point);
      const b = this.toScreen(h.point.clone().addScaledVector(tangent, 0.2 * this.scale));
      drag.screen = { x: b.x - a.x, y: b.y - a.y };
      drag.perUnit = 0.2 / 0.9; // radians represented by the sampled tangent length
    } else if (dir) {
      const b = this.toScreen(o.clone().addScaledVector(dir, this.scale));
      drag.screen = { x: b.x - so.x, y: b.y - so.y };
      if (Math.hypot(drag.screen.x, drag.screen.y) < 14) drag.screen = { x: 0, y: -14 };
      drag.perUnit = this.scale; // world units represented by the screen vector
    }
    this.drag = drag;
    e.orbit.enabled = false;
    e.app.beginEdit();
    this.highlight(h.ax);
    e.dirty = true;
  }

  dragTo(p) {
    const d = this.drag;
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    const values = {};
    const step = (s, v) => (this.snap ? Math.round(v / s) * s : v);
    if (d.ax === 'all') {
      const f = Math.max(0.01, 1 + (dx - dy) / 200);
      const s = (v) => +step(0.05, v * f).toFixed(4);
      Object.assign(values, { sx: s(d.scl.x), sy: s(d.scl.y), sz: s(d.scl.z) });
    } else {
      const len2 = d.screen.x ** 2 + d.screen.y ** 2;
      const along = (dx * d.screen.x + dy * d.screen.y) / Math.max(len2, 1e-6);
      if (this.mode === 'rotate') {
        let deg = (along * d.perUnit) / DEG;
        if (len2 < 36) deg = dx * 0.6;
        const i = AXES.indexOf(d.ax);
        values['r' + d.ax] = +step(5, d.rot[i] + deg).toFixed(2);
      } else if (this.mode === 'scale') {
        const i = d.ax;
        values['s' + i] = +step(0.05, d.scl[i] + along).toFixed(4);
      } else {
        const dist = step(0.5, along * d.perUnit);
        const parentInv = this.parentQuat().invert();
        const axisParent = d.dir.clone().applyQuaternion(parentInv);
        const ps = this.object.parent.getWorldScale(new THREE.Vector3());
        const k = dist / Math.max(1e-6, (ps.x + ps.y + ps.z) / 3);
        const np = d.pos.clone().addScaledVector(axisParent, k);
        Object.assign(values, { px: +np.x.toFixed(3), py: +np.y.toFixed(3), pz: +np.z.toFixed(3) });
      }
    }
    const key = JSON.stringify(values);
    if (key === d.lastKey) return;
    if (d.lastKey !== null && this.snap) this.engine.app.onSnapTick?.();
    d.lastKey = key;
    this.engine.app.setValuesLive(this.tl.id, values);
  }

  endDrag() {
    const e = this.engine;
    this.drag = null;
    e.orbit.enabled = true;
    this.highlight(null);
    e.app.endEdit();
    e.dirty = true;
  }
}

function segmentDistance(px, py, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / len2)) : 0;
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
}
