import * as THREE from 'three';
import { TransformControls } from '../vendor/three/controls/TransformControls.js';
import { OrbitControls } from '../vendor/three/controls/OrbitControls.js';
import { DEG, clamp, hexToRgb, rgbToHex } from './util.js';
import {
  getModelDef, getModelTextures, buildModel, blockGeometry, blockMaterial, itemGeometry, getItemTexture,
  modelMaterial, buildScenery, getBlockFaceTexture, BLOCK_MAP,
} from './models.js';
import { normalizeSkinCanvas } from './textures.js';
import { topoSorted, evaluate, findTl, DRAWABLE, rootOf } from './project.js';

const ACCENT = 0x60cdff;
const PI = Math.PI;

const shapeGeoCache = new Map();
function shapeGeometry(id) {
  if (!shapeGeoCache.has(id)) {
    let g;
    switch (id) {
      case 'sphere': g = new THREE.SphereGeometry(8, 32, 16); g.translate(0, 8, 0); break;
      case 'cylinder': g = new THREE.CylinderGeometry(8, 8, 16, 32); g.translate(0, 8, 0); break;
      case 'cone': g = new THREE.ConeGeometry(8, 16, 32); g.translate(0, 8, 0); break;
      case 'plane': g = new THREE.PlaneGeometry(16, 16); g.rotateX(-PI / 2); g.translate(0, 0.02, 0); break;
      case 'torus': g = new THREE.TorusGeometry(6, 2, 16, 48); g.translate(0, 8, 0); break;
      default: g = new THREE.BoxGeometry(16, 16, 16); g.translate(0, 8, 0);
    }
    shapeGeoCache.set(id, g);
  }
  return shapeGeoCache.get(id);
}

function helperMaterial(color = 0xd0d0d0) {
  return new THREE.MeshBasicMaterial({ color, depthTest: true, fog: false, toneMapped: false });
}

function cameraHelperMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 7), helperMaterial(0x3a3a3a));
  body.position.z = 3.5;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 2, 16), helperMaterial(0x60cdff));
  lens.rotation.x = PI / 2;
  lens.position.z = -1;
  // Frustum outline pointing down -Z.
  const d = 14, hw = 8, hh = 4.5;
  const pts = [
    [0, 0, 0], [-hw, hh, -d], [0, 0, 0], [hw, hh, -d], [0, 0, 0], [-hw, -hh, -d], [0, 0, 0], [hw, -hh, -d],
    [-hw, hh, -d], [hw, hh, -d], [hw, hh, -d], [hw, -hh, -d], [hw, -hh, -d], [-hw, -hh, -d], [-hw, -hh, -d], [-hw, hh, -d],
    [-2.5, hh + 1, -d], [0, hh + 3, -d], [0, hh + 3, -d], [2.5, hh + 1, -d],
  ].flat();
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x60cdff, fog: false, toneMapped: false }));
  g.add(body, lens, lines);
  return g;
}

/* Builds the visual content for a non-bone timeline. Shared by the scene and thumbnails. */
export function buildVisual(tl, skinCanvas) {
  const out = { group: new THREE.Group(), meshes: [], parts: null, helpers: [], light: null, camera: null };
  const add = (mesh, helper = false) => {
    if (!helper) { mesh.castShadow = true; mesh.receiveShadow = true; out.meshes.push(mesh); }
    out.group.add(mesh);
    return mesh;
  };
  switch (tl.type) {
    case 'model': {
      const def = getModelDef(tl);
      const texs = getModelTextures(tl, skinCanvas);
      const { root, parts } = buildModel(def, texs);
      root.traverse((o) => { if (o.isMesh) o.userData.ownGeo = true; });
      out.group.add(root);
      out.parts = parts;
      out.ownedTexture = texs.main?.owned ? texs.main.texture : null;
      break;
    }
    case 'block': {
      const m = add(new THREE.Mesh(blockGeometry(), blockMaterial(tl.ref)));
      m.userData.baseTransparent = !!BLOCK_MAP[tl.ref]?.translucent;
      break;
    }
    case 'item': {
      add(new THREE.Mesh(itemGeometry(tl.ref), modelMaterial(getItemTexture(tl.ref).texture)));
      break;
    }
    case 'scenery': {
      for (const [b, geo] of buildScenery(tl.ref)) {
        const m = add(new THREE.Mesh(geo, blockMaterial(b)));
        m.userData.baseTransparent = !!BLOCK_MAP[b]?.translucent;
      }
      break;
    }
    case 'shape': {
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: tl.ref === 'plane' ? THREE.DoubleSide : THREE.FrontSide });
      if (tl.tex) {
        const t = getBlockFaceTexture(tl.tex, 'front').texture.clone();
        t.needsUpdate = true;
        t.userData.clone = true;
        const rep = tl.ref === 'sphere' || tl.ref === 'torus' ? [4, 2] : [1, 1];
        t.repeat.set(...rep);
        mat.map = t;
      }
      add(new THREE.Mesh(shapeGeometry(tl.ref), mat));
      break;
    }
    case 'camera': {
      const h = cameraHelperMesh();
      out.group.add(h);
      out.helpers.push(h);
      out.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 8000);
      out.group.add(out.camera);
      break;
    }
    case 'pointlight':
    case 'spotlight': {
      if (tl.type === 'pointlight') {
        out.light = new THREE.PointLight(0xffffff, PI, 160, 0);
      } else {
        out.light = new THREE.SpotLight(0xffffff, PI, 160, 40 * DEG, 0.4, 0);
        const target = new THREE.Object3D();
        target.position.set(0, 0, -16);
        out.group.add(target);
        out.light.target = target;
      }
      out.light.castShadow = false;
      out.group.add(out.light);
      const bulb = new THREE.Mesh(
        tl.type === 'pointlight' ? new THREE.OctahedronGeometry(3) : new THREE.ConeGeometry(3, 6, 12).rotateX(PI / 2),
        helperMaterial(0xffd9a0),
      );
      out.group.add(bulb);
      out.helpers.push(bulb);
      break;
    }
    default: break;
  }
  return out;
}

function disposeObject(obj, keepShared = true) {
  obj.traverse((o) => {
    if (o.isMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map && m.map.userData?.clone) m.map.dispose();
        m.dispose();
      }
      if (!keepShared || o.userData.ownGeo) o.geometry.dispose();
    }
    if (o.isLight && o.shadow?.map) o.shadow.map.dispose();
  });
}

export class Engine {
  constructor(container, app) {
    this.app = app;
    this.container = container;
    this.nodes = new Map();
    this.order = [];
    this.skinCanvases = new Map();
    this.helpers = [];
    this.selectedId = null;
    this.viewCamId = null;
    this.pickParts = true;
    this.showGrid = true;
    this.dirty = true;
    this.exporting = false;

    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    this.renderer = r;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.world = new THREE.Group();
    scene.add(this.world);

    this.workCam = new THREE.PerspectiveCamera(50, 1, 1, 8000);
    this.workCam.position.set(120, 84, 176);
    this.proxyCam = new THREE.PerspectiveCamera(60, 1, 0.5, 8000);

    // Transform gizmo first so it claims pointer events before the orbit controls.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.transform = new TransformControls(this.workCam, r.domElement);
    this.transform.setSpace('local');
    this.transform.setSize(coarse ? 1.15 : 0.85);
    this.gizmo = this.transform.getHelper();
    scene.add(this.gizmo);
    this.tuneRotateGizmo(coarse);

    this.orbit = new OrbitControls(this.workCam, r.domElement);
    this.orbit.target.set(0, 16, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.14;
    this.orbit.screenSpacePanning = true;
    this.orbit.minDistance = 4;
    this.orbit.maxDistance = 3000;
    this.orbit.zoomSpeed = 1.1;
    this.orbit.update();

    this.transform.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      if (e.value) this.app.beginEdit();
      else this.app.endEdit();
    });
    this.transform.addEventListener('objectChange', () => this.onGizmoChange());
    this.transform.addEventListener('change', () => { this.dirty = true; });

    this.orbitInteracting = false;
    this.orbit.addEventListener('start', () => {
      this.orbitInteracting = true;
      if (this.viewCamId) this.app.beginEdit();
    });
    this.orbit.addEventListener('end', () => {
      this.orbitInteracting = false;
      if (this.viewCamId) this.app.endEdit();
    });
    this.orbit.addEventListener('change', () => {
      this.dirty = true;
      if (this.viewCamId && this.orbitInteracting) this.writeCameraFromProxy();
      this.updateSun();
    });

    // Lighting & environment
    this.ambient = new THREE.AmbientLight(0xffffff, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -320; sc.right = 320; sc.top = 320; sc.bottom = -320; sc.near = 1; sc.far = 2000;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.ambient, this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(4096, 4096), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    this.ground.rotation.x = -PI / 2;
    this.ground.receiveShadow = true;
    this.ground.userData.ground = true;
    scene.add(this.ground);

    this.grid = new THREE.GridHelper(1024, 64, 0x5a5a5a, 0x3a3a3a);
    this.grid.position.y = 0.06;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.35;
    this.grid.material.depthWrite = false;
    scene.add(this.grid);

    this.selBox = new THREE.BoxHelper(undefined, ACCENT);
    this.selBox.material.depthTest = false;
    this.selBox.material.transparent = true;
    this.selBox.material.opacity = 0.7;
    this.selBox.visible = false;
    this.selBox.renderOrder = 999;
    scene.add(this.selBox);

    this.raycaster = new THREE.Raycaster();
    this.bindPointer();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /*
   * Makes the rotate gizmo predictable on touch screens: removes the free
   * trackball sphere and the screen-space ring (both easy to grab by accident
   * and they tumble a part on every axis) and widens the axis ring pickers.
   */
  tuneRotateGizmo(coarse) {
    const giz = this.transform._gizmo;
    for (const group of [giz.gizmo.rotate, giz.picker.rotate, giz.helper?.rotate]) {
      if (!group) continue;
      for (const c of [...group.children]) if (c.name === 'E' || c.name === 'XYZE') group.remove(c);
    }
    const tube = coarse ? 0.22 : 0.14;
    const rot = { X: [0, -Math.PI / 2, -Math.PI / 2], Y: [Math.PI / 2, 0, 0], Z: [0, 0, -Math.PI / 2] };
    for (const c of giz.picker.rotate.children) {
      if (!rot[c.name]) continue;
      const g = new THREE.TorusGeometry(0.5, tube, 6, 32);
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot[c.name])));
      c.geometry.dispose();
      c.geometry = g;
    }
  }

  /* Restricts the gizmo to one axis ('x' | 'y' | 'z') or shows all (null). */
  setAxisLock(axis) {
    this.axisLock = axis;
    this.transform.showX = !axis || axis === 'x';
    this.transform.showY = !axis || axis === 'y';
    this.transform.showZ = !axis || axis === 'z';
    this.dirty = true;
  }

  /* ---------- Layout ---------- */

  resize() {
    if (this.exporting) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    for (const c of [this.workCam, this.proxyCam]) { c.aspect = w / h; c.updateProjectionMatrix(); }
    this.dirty = true;
  }

  /* ---------- Settings ---------- */

  /* Forces textures to be rebuilt, e.g. after importing official textures. */
  refreshTextures() {
    this.groundBlock = null;
    this.applySettings(this.app.project.settings);
    this.rebuild();
  }

  applySettings(s) {
    this.scene.background = new THREE.Color(s.sky);
    this.scene.fog = s.fog ? new THREE.Fog(s.sky, s.fogDistance * 0.35, s.fogDistance) : null;
    this.ground.visible = !!s.ground;
    if (this.groundBlock !== s.groundBlock) {
      this.groundBlock = s.groundBlock;
      const t = getBlockFaceTexture(s.groundBlock || 'grass', 'top').texture.clone();
      t.needsUpdate = true;
      t.repeat.set(256, 256);
      if (this.ground.material.map) this.ground.material.map.dispose();
      this.ground.material.map = t;
      this.ground.material.needsUpdate = true;
    }
    this.sun.intensity = s.sunIntensity * PI;
    this.sun.color.set(s.sunColor);
    this.sun.castShadow = !!s.shadows;
    this.ambient.intensity = s.ambient * PI;
    this.ambient.color.set(s.ambientColor);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, (90 - s.sunPitch) * DEG, s.sunYaw * DEG);
    this.updateSun();
    this.dirty = true;
  }

  updateSun() {
    if (!this.sunDir) return;
    const t = this.orbit.target;
    const c = new THREE.Vector3(Math.round(t.x / 64) * 64, 0, Math.round(t.z / 64) * 64);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.sunDir, 800);
  }

  setGrid(v) { this.showGrid = v; this.grid.visible = v; this.dirty = true; }

  /* ---------- Scene graph ---------- */

  loadSkin(tl) {
    const key = tl.skin;
    if (!key) return null;
    const cached = this.skinCanvases.get(key);
    if (cached) return cached === 'loading' ? null : cached;
    this.skinCanvases.set(key, 'loading');
    const img = new Image();
    img.onload = () => {
      this.skinCanvases.set(key, normalizeSkinCanvas(img));
      this.rebuild();
    };
    img.onerror = () => this.skinCanvases.delete(key);
    img.src = key;
    return null;
  }

  rebuild() {
    const project = this.app.project;
    this.transform.detach();
    for (const child of [...this.world.children]) {
      this.world.remove(child);
      disposeObject(child);
    }
    for (const n of this.nodes.values()) if (n.ownedTexture) n.ownedTexture.dispose();
    this.nodes.clear();
    this.helpers = [];
    this.order = topoSorted(project);

    for (const tl of this.order) {
      if (tl.type === 'bone') {
        const owner = this.nodes.get(tl.owner);
        const part = owner?.parts?.[tl.bone];
        if (!part) continue;
        const node = { tl, offset: part.offset, anim: part.anim, container: part.container, bendGroup: part.bendGroup, bend: part.bend, meshes: part.meshes, helpers: [] };
        for (const m of part.meshes) m.userData.tlId = tl.id;
        this.nodes.set(tl.id, node);
        continue;
      }
      const vis = buildVisual(tl, tl.type === 'model' ? this.loadSkin(tl) : null);
      const offset = new THREE.Group();
      const anim = new THREE.Group();
      offset.add(anim);
      anim.add(vis.group);
      const node = { tl, offset, anim, container: anim, meshes: vis.meshes, parts: vis.parts, helpers: vis.helpers, light: vis.light, camera: vis.camera, ownedTexture: vis.ownedTexture };
      for (const m of vis.meshes) m.userData.tlId = tl.id;
      for (const h of vis.helpers) {
        h.traverse((o) => { if (o.isMesh) { o.userData.tlId = tl.id; o.userData.helper = true; } });
        this.helpers.push(h);
      }
      const parent = tl.parent ? this.nodes.get(tl.parent) : null;
      (parent ? parent.container : this.world).add(offset);
      this.nodes.set(tl.id, node);
    }
    this.apply(this.app.frame);
    this.setSelected(this.selectedId);
  }

  apply(frame) {
    const project = this.app.project;
    const eff = new Map();
    for (const tl of this.order) {
      const node = this.nodes.get(tl.id);
      if (!node) continue;
      const v = evaluate(tl, frame, project);
      node.values = v;
      const a = node.anim;
      a.position.set(v.px, v.py, v.pz);
      a.rotation.set(v.rx * DEG, v.ry * DEG, v.rz * DEG);
      const s = (x) => (Math.abs(x) < 1e-4 ? 1e-4 : x);
      a.scale.set(s(v.sx), s(v.sy), s(v.sz));
      if (node.bendGroup) node.bendGroup.rotation.x = (v.bend || 0) * node.bend.sign * DEG;

      const vis = !tl.hidden && (v.vis === undefined || v.vis >= 0.5);
      node.offset.visible = vis;

      if (DRAWABLE.has(tl.type)) {
        const p = eff.get(tl.parent);
        const own = hexToRgb(v.color);
        const pc = p ? p.rgb : [1, 1, 1];
        const e = {
          alpha: (p ? p.alpha : 1) * clamp(v.alpha, 0, 1),
          rgb: [own[0] * pc[0], own[1] * pc[1], own[2] * pc[2]],
          bright: Math.max(p ? p.bright : 0, v.bright),
        };
        eff.set(tl.id, e);
        const hex = rgbToHex(e.rgb);
        for (const mesh of node.meshes) {
          const m = mesh.material;
          m.color.set(hex);
          m.opacity = e.alpha;
          const transparent = !!mesh.userData.baseTransparent || e.alpha < 0.999;
          if (m.transparent !== transparent) {
            m.transparent = transparent;
            m.depthWrite = !transparent;
            m.needsUpdate = true;
          }
          const b = clamp(Math.max(e.bright, m.userData.emissiveBase || 0), 0, 1);
          if (m.emissive) m.emissive.set(hex).multiplyScalar(b);
          mesh.castShadow = e.alpha > 0.5;
        }
      }
      if (node.camera) {
        node.camera.fov = clamp(v.fov, 1, 170);
        node.camera.updateProjectionMatrix();
      }
      if (node.light) {
        node.light.color.set(v.lcolor);
        node.light.intensity = Math.max(0, v.intensity) * PI;
        node.light.distance = Math.max(0, v.range);
        if (node.light.isSpotLight) {
          node.light.angle = clamp(v.angle, 1, 89) * DEG;
          node.light.penumbra = clamp(v.soft, 0, 1);
        }
        for (const h of node.helpers) h.traverse((o) => { if (o.isMesh) o.material.color.set(v.lcolor); });
      }
    }
    if (this.viewCamId && !this.orbitInteracting) this.syncProxyFromCamera();
    this.dirty = true;
  }

  /* ---------- Selection & gizmo ---------- */

  setSelected(id) {
    this.selectedId = id;
    const node = id ? this.nodes.get(id) : null;
    const tl = node?.tl;
    const lockedByView = tl && tl.id === this.viewCamId;
    if (node && !lockedByView && this.tool !== 'select') {
      this.transform.attach(node.anim);
    } else {
      this.transform.detach();
    }
    this.selBox.visible = !!node && !lockedByView;
    if (node) this.selBox.setFromObject(node.anim);
    this.dirty = true;
  }

  setTool(tool) {
    this.tool = tool;
    if (tool !== 'select') this.transform.setMode(tool);
    this.setSelected(this.selectedId);
  }

  setSpace(space) { this.transform.setSpace(space); this.dirty = true; }

  setSnap(on) {
    this.transform.setTranslationSnap(on ? 1 : null);
    this.transform.setRotationSnap(on ? 5 * DEG : null);
    this.transform.setScaleSnap(on ? 0.05 : null);
  }

  onGizmoChange() {
    const node = this.nodes.get(this.selectedId);
    if (!node) return;
    const a = node.anim;
    const r = (x, dp = 3) => Math.round(x * 10 ** dp) / 10 ** dp;
    let values;
    switch (this.transform.mode) {
      case 'translate': values = { px: r(a.position.x), py: r(a.position.y), pz: r(a.position.z) }; break;
      case 'rotate': values = { rx: r(a.rotation.x / DEG, 2), ry: r(a.rotation.y / DEG, 2), rz: r(a.rotation.z / DEG, 2) }; break;
      default: values = { sx: r(a.scale.x), sy: r(a.scale.y), sz: r(a.scale.z) };
    }
    this.app.setValuesLive(node.tl.id, values);
  }

  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), gizmo: this.transform.axis !== null, id: e.pointerId };
    });
    el.addEventListener('pointerup', (e) => {
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 450;
      if (!down.gizmo && moved < 6 && quick && !this.transform.dragging) {
        const id = this.pick(e.clientX, e.clientY);
        this.app.select(id);
      }
      down = null;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pick(cx, cy) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.activeCamera());
    const hits = this.raycaster.intersectObjects(this.world.children, true);
    for (const h of hits) {
      let o = h.object, visible = true;
      while (o) { if (!o.visible) { visible = false; break; } o = o.parent; }
      if (!visible) continue;
      const id = h.object.userData.tlId;
      if (!id) continue;
      if (id === this.viewCamId) continue;
      let tl = findTl(this.app.project, id);
      if (!tl) continue;
      if (!this.pickParts && tl.type === 'bone') tl = rootOf(this.app.project, tl);
      return tl.id;
    }
    return null;
  }

  focusSelected() {
    const node = this.nodes.get(this.selectedId);
    const box = new THREE.Box3();
    if (node) box.setFromObject(node.anim);
    if (!node || box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 16, 0), new THREE.Vector3(48, 32, 48));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 8);
    const cam = this.orbit.object;
    const dir = cam.position.clone().sub(this.orbit.target).normalize();
    const dist = r / Math.sin((cam.fov * DEG) / 2) * 1.2;
    this.orbit.target.copy(sphere.center);
    cam.position.copy(sphere.center).addScaledVector(dir, dist);
    this.orbit.update();
    if (this.viewCamId) this.writeCameraFromProxy();
    this.dirty = true;
  }

  /* ---------- Camera views ---------- */

  activeCamera() {
    return this.viewCamId ? this.proxyCam : this.workCam;
  }

  setViewCamera(id) {
    const node = id ? this.nodes.get(id) : null;
    if (!node?.camera) id = null;
    if (id === this.viewCamId) return;
    if (!this.viewCamId) this.savedTarget = this.orbit.target.clone();
    this.viewCamId = id;
    if (id) {
      this.orbit.object = this.proxyCam;
      this.transform.camera = this.proxyCam;
      this.syncProxyFromCamera();
    } else {
      this.orbit.object = this.workCam;
      this.transform.camera = this.workCam;
      if (this.savedTarget) this.orbit.target.copy(this.savedTarget);
      this.orbit.update();
    }
    this.setSelected(this.selectedId);
    this.dirty = true;
  }

  syncProxyFromCamera() {
    const node = this.nodes.get(this.viewCamId);
    if (!node?.camera) return;
    node.camera.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    node.camera.matrixWorld.decompose(pos, quat, scl);
    this.proxyCam.position.copy(pos);
    this.proxyCam.quaternion.copy(quat);
    this.proxyCam.fov = node.camera.fov;
    this.proxyCam.updateProjectionMatrix();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    const dist = Math.max(16, this.orbit.target.distanceTo(pos) || 64);
    this.orbit.target.copy(pos).addScaledVector(dir, Math.min(dist, 400));
  }

  writeCameraFromProxy() {
    const node = this.nodes.get(this.viewCamId);
    if (!node) return;
    this.proxyCam.updateMatrixWorld();
    node.offset.updateWorldMatrix(true, false);
    const local = new THREE.Matrix4().copy(node.offset.matrixWorld).invert().multiply(this.proxyCam.matrixWorld);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    local.decompose(pos, quat, scl);
    const e = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
    const r = (x, dp = 3) => Math.round(x * 10 ** dp) / 10 ** dp;
    this.app.setValuesLive(this.viewCamId, {
      px: r(pos.x), py: r(pos.y), pz: r(pos.z), rx: r(e.x / DEG, 2), ry: r(e.y / DEG, 2), rz: r(e.z / DEG, 2),
    }, { fromView: true });
  }

  /* Copies the work camera view into a camera timeline's values. */
  cameraValuesFromWorkView(id) {
    const node = this.nodes.get(id);
    if (!node) return null;
    const cam = this.workCam;
    cam.updateMatrixWorld();
    node.offset.updateWorldMatrix(true, false);
    const local = new THREE.Matrix4().copy(node.offset.matrixWorld).invert().multiply(cam.matrixWorld);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    local.decompose(pos, quat, scl);
    const e = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
    const r = (x, dp = 3) => Math.round(x * 10 ** dp) / 10 ** dp;
    return { px: r(pos.x), py: r(pos.y), pz: r(pos.z), rx: r(e.x / DEG, 2), ry: r(e.y / DEG, 2), rz: r(e.z / DEG, 2), fov: Math.round(cam.fov) };
  }

  /* Placement point on the ground in front of the work camera. */
  placementPoint() {
    const t = this.orbit.target;
    return { px: Math.round(t.x), py: 0, pz: Math.round(t.z) };
  }

  /* ---------- Rendering ---------- */

  tick() {
    if (this.orbit.update()) this.dirty = true;
    if (this.dirty && !this.exporting) this.render();
  }

  render() {
    const viewNode = this.viewCamId ? this.nodes.get(this.viewCamId) : null;
    if (viewNode) for (const h of viewNode.helpers) h.visible = false;
    if (this.selBox.visible) {
      const node = this.nodes.get(this.selectedId);
      if (node) this.selBox.setFromObject(node.anim);
    }
    this.renderer.render(this.scene, this.activeCamera());
    if (viewNode) for (const h of viewNode.helpers) h.visible = true;
    this.dirty = false;
  }

  outputCamera(camId) {
    const node = camId ? this.nodes.get(camId) : null;
    return node?.camera || this.activeCamera();
  }

  beginExport(w, h) {
    this.exporting = true;
    this.saved = { pr: this.renderer.getPixelRatio(), grid: this.grid.visible, gizmo: this.gizmo.visible, sel: this.selBox.visible };
    this.grid.visible = false;
    this.gizmo.visible = false;
    this.selBox.visible = false;
    for (const hlp of this.helpers) hlp.visible = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.exportSize = [w, h];
  }

  renderExportFrame(camId, target) {
    const cam = this.outputCamera(camId);
    const [w, h] = this.exportSize;
    const aspect = cam.aspect;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    this.renderer.render(this.scene, cam);
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const ctx = target.getContext('2d');
    ctx.drawImage(this.renderer.domElement, 0, 0, w, h);
  }

  endExport() {
    this.exporting = false;
    this.grid.visible = this.saved.grid;
    this.gizmo.visible = this.saved.gizmo;
    this.selBox.visible = this.saved.sel;
    for (const hlp of this.helpers) hlp.visible = true;
    this.renderer.setPixelRatio(this.saved.pr);
    this.resize();
    this.render();
  }

  /* Renders small preview images for library entries. */
  async thumbnails(entries, size, onThumb) {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(1, 2, 1.5);
    scene.add(key);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.5, 4000);
    const out = document.createElement('canvas');
    out.width = size; out.height = size;
    const ctx = out.getContext('2d');
    const prevBg = this.scene.background;
    const saved = { pr: this.renderer.getPixelRatio(), clear: this.renderer.getClearColor(new THREE.Color()), alpha: this.renderer.getClearAlpha() };
    let i = 0;
    while (i < entries.length) {
      if (this.exporting) break;
      this.exporting = true;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(size, size, false);
      this.renderer.setClearColor(0x181818, 1);
      const batchEnd = Math.min(entries.length, i + 6);
      for (; i < batchEnd; i++) {
        const entry = entries[i];
        const vis = buildVisual({ type: entry.type, ref: entry.ref, variant: entry.variant, tex: '' });
        scene.add(vis.group);
        for (const h of vis.helpers) h.visible = false;
        const box = new THREE.Box3().setFromObject(vis.group);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const dir = new THREE.Vector3(0.9, 0.55, 1.5).normalize();
        const dist = sphere.radius / Math.sin((cam.fov * DEG) / 2) * 1.05;
        cam.position.copy(sphere.center).addScaledVector(dir, dist);
        cam.lookAt(sphere.center);
        cam.near = dist / 50; cam.far = dist * 4;
        cam.updateProjectionMatrix();
        this.renderer.render(scene, cam);
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(this.renderer.domElement, 0, 0, size, size);
        onThumb(entry, out.toDataURL('image/png'));
        scene.remove(vis.group);
        disposeObject(vis.group);
      }
      this.renderer.setClearColor(saved.clear, saved.alpha);
      this.renderer.setPixelRatio(saved.pr);
      this.exporting = false;
      this.resize();
      this.render();
      await new Promise((r) => requestAnimationFrame(r));
    }
    this.scene.background = prevBg;
  }
}
