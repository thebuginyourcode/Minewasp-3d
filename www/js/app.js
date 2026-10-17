import * as THREE from 'three';
import { Engine } from './engine.js';
import { TimelinePanel } from './timeline.js';
import { PropertiesPanel, ScenePanel } from './properties.js';
import { openLibrary, clearThumbnails } from './library.js';
import {
  h, icon, iconButton, openMenu, closeFlyout, openDialog, confirmDialog, promptDialog, toast, combo, numberBox, fieldRow,
} from './ui.js';
import {
  newProject, createTimeline, findTl, setValues, ensureKey, keyAt, sortKeys, deleteTimeline, duplicateTimeline,
  serialize, deserialize, projectEnd, defaults, rootOf, isDescendant,
} from './project.js';
import { debounce, DEG, TRANSITION_GROUPS } from './util.js';
import { CATALOG, texturePaths, clearTextureCache } from './models.js';
import { initPack, importPack, clearPack, packInfo } from './pack.js';
import * as native from './native.js';
import { ZipWriter } from './zip.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.project = newProject();
    this.frame = 0;
    this.playing = false;
    this.loop = true;
    this.selectedId = null;
    this.selKeys = new Set();
    this.multiSelect = false;
    this.clipboard = null;
    this.undoStack = [];
    this.redoStack = [];
    this.editDepth = 0;
    this.pending = null;
    this.savedName = null;
    this.tool = 'translate';

    this.el = $('app');
    this.engine = new Engine($('viewport'), this);
    this.timeline = new TimelinePanel($('paneTimeline'), this);
    this.props = new PropertiesPanel($('paneProps'), this);
    this.scenePanel = new ScenePanel($('paneScene'), this);

    this.autosave = debounce(() => native.writeAutosave(serialize(this.project)), 700);
    this.buildChrome();
    this.bindKeys();

    const saved = native.readAutosave();
    let loaded = false;
    if (saved) {
      try { this.project = deserialize(saved); loaded = true; } catch { /* fall back to demo */ }
    }
    if (!loaded) this.project = buildDemo();
    this.afterLoad();

    native.initNativeChrome({ onBack: () => this.handleBack() });
    let last = performance.now();
    const loop = (t) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      if (this.playing) this.advance(dt);
      this.engine.tick();
    };
    requestAnimationFrame(loop);
  }

  /* ---------- Chrome ---------- */

  buildChrome() {
    const cmd = $('commandbar');
    const cmdBtn = (iconName, label, onClick, opts = {}) => {
      const b = h('button', { class: 'btn-ghost', type: 'button', title: opts.title || label, 'aria-label': label, onclick: onClick },
        icon(iconName), h('span', { class: 'cmd-label' }, label), opts.menu ? icon('chevronDown', 'chev cmd-label') : null);
      return b;
    };
    this.undoBtn = iconButton('undo', 'Undo (Ctrl+Z)', () => this.undo());
    this.redoBtn = iconButton('redo', 'Redo (Ctrl+Y)', () => this.redo());
    cmd.append(
      cmdBtn('add', 'Add', () => this.openLibrary(), { title: 'Add object (A)' }),
      cmdBtn('folder', 'File', (e) => this.fileMenu(e.currentTarget), { menu: true }),
      cmdBtn('rename', 'Edit', (e) => this.editMenu(e.currentTarget), { menu: true }),
      cmdBtn('video', 'Render', (e) => this.renderMenu(e.currentTarget), { menu: true }),
      h('span', { class: 'titlebar-sep', style: { margin: '0 4px' } }),
      this.undoBtn, this.redoBtn,
    );
    $('projectName').addEventListener('click', async () => {
      const name = await promptDialog('Rename project', this.project.name, 'Rename');
      if (name && name.trim()) this.setProjectProp({ name: name.trim() });
    });

    // Viewport toolbars
    const tools = [['select', 'pointer', 'Select (Q)'], ['translate', 'move', 'Move (W)'], ['rotate', 'rotate', 'Rotate (E)'], ['scale', 'scale', 'Scale (R)']];
    this.toolBtns = {};
    const left = $('vpToolsLeft');
    for (const [id, ic, label] of tools) {
      const b = iconButton(ic, label, () => this.setTool(id));
      this.toolBtns[id] = b;
      left.append(b);
    }
    this.spaceBtn = iconButton('cubeLocal', 'Local space (toggle world)', () => this.toggleSpace());
    this.snapBtn = iconButton('magnet', 'Snap', () => this.toggleSnap());
    left.append(h('span', { class: 'divider' }), this.spaceBtn, this.snapBtn);

    this.camBtn = h('button', { class: 'btn-ghost', type: 'button', title: 'View camera', onclick: (e) => this.cameraMenu(e.currentTarget) },
      icon('camera'), h('span', { class: 'cam-label' }, 'Work camera'), icon('chevronDown', 'chev'));
    $('vpToolsRight').append(
      this.camBtn,
      h('span', { class: 'divider' }),
      iconButton('focus', 'Focus selection (F)', () => this.engine.focusSelected()),
      iconButton('more', 'View options', (e) => this.viewMenu(e.currentTarget)),
    );
    this.status = $('vpStatus');

    // Dock tabs (compact) and side pivot (wide)
    const tabs = [['timeline', 'timeline', 'Timeline'], ['properties', 'sliders', 'Properties'], ['scene', 'settings', 'Scene']];
    this.dockTabs = {};
    for (const [id, ic, label] of tabs) {
      const b = h('button', { class: 'pivot-item', type: 'button', role: 'tab', onclick: () => this.setDock(id) }, icon(ic, 'sm'), label);
      this.dockTabs[id] = b;
      $('dockTabs').append(b);
    }
    this.sideTabs = {};
    for (const [id, label] of [['properties', 'Properties'], ['scene', 'Scene']]) {
      const b = h('button', { class: 'pivot-item', type: 'button', role: 'tab', onclick: () => this.setSide(id) }, label);
      this.sideTabs[id] = b;
      $('sidePivot').append(b);
    }
    this.setDock(localStorage.getItem('mw.dock') || 'timeline');
    this.setSide('properties');

    const snap = localStorage.getItem('mw.snap') !== '0';
    this.snap = snap;
    this.engine.setSnap(snap);
    this.space = 'local';
    this.setTool('translate');
    this.syncViewToolbar();
  }

  setDock(id) {
    this.dock = id;
    this.el.dataset.dock = id;
    for (const [k, b] of Object.entries(this.dockTabs)) b.setAttribute('aria-selected', k === id);
    if (id === 'properties' || id === 'scene') this.setSide(id);
    try { localStorage.setItem('mw.dock', id); } catch { /* ignore */ }
    requestAnimationFrame(() => this.timeline.draw());
  }

  setSide(id) {
    this.side = id;
    this.el.dataset.side = id;
    for (const [k, b] of Object.entries(this.sideTabs)) b.setAttribute('aria-selected', k === id);
    if (id === 'scene') this.scenePanel.render();
  }

  setTool(tool) {
    this.tool = tool;
    this.engine.setTool(tool);
    for (const [k, b] of Object.entries(this.toolBtns)) b.classList.toggle('active', k === tool);
  }

  toggleSpace() {
    this.space = this.space === 'local' ? 'world' : 'local';
    this.engine.setSpace(this.space);
    this.syncViewToolbar();
  }

  toggleSnap() {
    this.snap = !this.snap;
    this.engine.setSnap(this.snap);
    try { localStorage.setItem('mw.snap', this.snap ? '1' : '0'); } catch { /* ignore */ }
    this.syncViewToolbar();
  }

  syncViewToolbar() {
    this.spaceBtn.replaceChildren(icon(this.space === 'local' ? 'cubeLocal' : 'globe'));
    this.spaceBtn.title = this.space === 'local' ? 'Local space (tap for world)' : 'World space (tap for local)';
    this.snapBtn.classList.toggle('active', this.snap);
    const cam = this.engine.viewCamId ? findTl(this.project, this.engine.viewCamId) : null;
    this.camBtn.querySelector('.cam-label').textContent = cam ? cam.name : 'Work camera';
    this.camBtn.classList.toggle('active', !!cam);
    $('viewportArea').querySelector('.vp-camera-badge')?.remove();
    if (cam) $('viewportArea').append(h('div', { class: 'vp-camera-badge' }));
    this.undoBtn.disabled = !this.undoStack.length;
    this.redoBtn.disabled = !this.redoStack.length;
  }

  updateStatus() {
    const f = Math.floor(this.frame);
    const secs = (this.frame / this.project.fps).toFixed(2);
    const cam = this.engine.viewCamId ? findTl(this.project, this.engine.viewCamId) : null;
    this.status.replaceChildren(
      h('span', {}, 'Frame ', h('b', {}, String(f))),
      h('span', {}, secs + ' s'),
      ...(cam ? [h('span', { class: 'rec' }, 'Viewing ' + cam.name)] : []),
    );
  }

  /* ---------- Menus ---------- */

  fileMenu(anchor) {
    openMenu(anchor, [
      { label: 'New project', icon: 'document', action: () => this.newProject() },
      { label: 'Open…', icon: 'folder', key: 'Ctrl+O', action: () => this.openProjectDialog() },
      'sep',
      { label: 'Save', icon: 'save', key: 'Ctrl+S', action: () => this.saveProject() },
      { label: 'Save as…', icon: 'save', action: () => this.saveProject(true) },
      'sep',
      { label: 'Import project file…', icon: 'import', action: () => this.importProjectFile() },
      { label: 'Export project file…', icon: 'share', action: () => this.exportProjectFile() },
      'sep',
      { label: 'Import Minecraft textures…', icon: 'cube', action: () => this.importTextures() },
    ]);
  }

  editMenu(anchor) {
    const tl = findTl(this.project, this.selectedId);
    openMenu(anchor, [
      { label: 'Undo', icon: 'undo', key: 'Ctrl+Z', disabled: !this.undoStack.length, action: () => this.undo() },
      { label: 'Redo', icon: 'redo', key: 'Ctrl+Y', disabled: !this.redoStack.length, action: () => this.redo() },
      'sep',
      { label: 'Duplicate object', icon: 'duplicate', key: 'Ctrl+D', disabled: !tl || tl.type === 'bone', action: () => this.duplicate(tl.id) },
      { label: 'Delete object', icon: 'trash', disabled: !tl || tl.type === 'bone', action: () => this.deleteObject(tl.id) },
      'sep',
      { label: 'Add keyframe', icon: 'keyAdd', key: 'K', disabled: !tl, action: () => this.addKeyframe() },
      { label: 'Copy keyframes', icon: 'copy', key: 'Ctrl+C', action: () => this.copyKeys() },
      { label: 'Paste keyframes', icon: 'paste', key: 'Ctrl+V', disabled: !this.clipboard, action: () => this.pasteKeys() },
      { label: 'Select all keyframes', icon: 'keyframe', key: 'Ctrl+A', action: () => this.selectAllKeys() },
    ]);
  }

  renderMenu(anchor) {
    openMenu(anchor, [
      { label: 'Render image…', icon: 'image', action: () => this.renderImageDialog() },
      { label: 'Render animation…', icon: 'video', action: () => this.renderAnimationDialog() },
    ], { align: 'right' });
  }

  cameraMenu(anchor) {
    const cams = this.project.timelines.filter((t) => t.type === 'camera');
    openMenu(anchor, [
      { header: 'View through' },
      { label: 'Work camera', icon: 'focus', checked: !this.engine.viewCamId, action: () => this.setViewCamera(null) },
      ...cams.map((c) => ({ label: c.name, icon: 'camera', checked: this.engine.viewCamId === c.id, action: () => this.setViewCamera(c.id) })),
      'sep',
      { label: 'Add camera from view', icon: 'add', action: () => this.addFromCatalog(CATALOG.find((e) => e.type === 'camera')) },
    ], { align: 'right' });
  }

  viewMenu(anchor) {
    openMenu(anchor, [
      { label: 'Show grid', icon: 'grid', checked: this.engine.showGrid, action: () => this.setGrid(!this.engine.showGrid) },
      { label: 'Select body parts', icon: 'bone', checked: this.engine.pickParts, action: () => { this.engine.pickParts = !this.engine.pickParts; } },
      'sep',
      { label: 'Reset view', icon: 'focus', action: () => { this.setViewCamera(null); this.engine.selectedId = null; this.engine.focusSelected(); this.engine.setSelected(this.selectedId); } },
    ], { align: 'right' });
  }

  objectMenu(id, point) {
    const tl = findTl(this.project, id);
    if (!tl) return;
    const isBone = tl.type === 'bone';
    const anchor = document.body;
    openMenu(anchor, [
      { label: 'Rename…', icon: 'rename', action: async () => { const n = await promptDialog('Rename', tl.name, 'Rename'); if (n && n.trim()) this.rename(id, n.trim()); } },
      { label: 'Focus', icon: 'focus', action: () => { this.select(id); this.engine.focusSelected(); } },
      ...(tl.type === 'camera' ? [{ label: this.engine.viewCamId === id ? 'Exit camera view' : 'Look through', icon: 'camera', action: () => this.setViewCamera(this.engine.viewCamId === id ? null : id) }] : []),
      ...(isBone
        ? [{ label: 'Reset at frame', icon: 'undo', action: () => this.resetPose(id) }, { label: 'Select owner', icon: 'person', action: () => this.select(tl.owner) }]
        : ['sep', { label: 'Duplicate', icon: 'duplicate', action: () => this.duplicate(id) }, { label: 'Delete', icon: 'trash', action: () => this.deleteObject(id) }]),
    ], { point });
  }

  keyMenu(point) {
    const common = ['linear', 'instant', 'easeInOutSine', 'easeOutQuad', 'easeOutBack', 'easeOutBounce'];
    const labelOf = (id) => TRANSITION_GROUPS.flatMap((g) => g.items).find((i) => i.id === id).label;
    const hasSel = this.selKeys.size > 0;
    openMenu(document.body, [
      { label: 'Add keyframe here', icon: 'keyAdd', disabled: !this.selectedId, action: () => this.addKeyframe() },
      { label: 'Copy', icon: 'copy', disabled: !hasSel, action: () => this.copyKeys() },
      { label: 'Paste', icon: 'paste', disabled: !this.clipboard, action: () => this.pasteKeys() },
      { label: 'Delete', icon: 'trash', disabled: !hasSel, action: () => this.deleteSelectedKeys() },
      'sep',
      { header: 'Transition' },
      ...common.map((t) => ({ label: labelOf(t), icon: t === this.currentTransition() ? 'check' : null, disabled: !hasSel, action: () => this.setTransitionForSelection(t) })),
    ], { point });
  }

  handleBack() {
    const layer = $('layer');
    const dlg = layer.querySelector('.dialog-smoke');
    if (layer.querySelector('.flyout-wrap')) { closeFlyout(); return; }
    if (dlg) { dlg.remove(); return; }
    if (this.engine.viewCamId) { this.setViewCamera(null); return; }
    native.minimizeApp();
  }

  /* ---------- Load / refresh ---------- */

  afterLoad() {
    this.undoStack = [];
    this.redoStack = [];
    this.selKeys.clear();
    if (this.selectedId && !findTl(this.project, this.selectedId)) this.selectedId = null;
    this.engine.viewCamId = null;
    this.engine.setViewCamera(null);
    this.engine.applySettings(this.project.settings);
    this.engine.rebuild();
    this.frame = Math.min(this.frame, projectEnd(this.project));
    this.refreshAll();
    this.timeline.fit();
  }

  refreshAll() {
    $('projectName').textContent = this.project.name;
    document.title = `${this.project.name} - Minewasp 3D`;
    this.engine.setSelected(this.selectedId);
    this.timeline.refresh();
    this.timeline.syncToolbar();
    this.props.render();
    if (this.side === 'scene') this.scenePanel.render();
    this.syncViewToolbar();
    this.updateStatus();
  }

  /* ---------- History ---------- */

  beginEdit() {
    if (this.playing) this.togglePlay();
    if (this.editDepth++ === 0) this.pending = serialize(this.project);
  }

  endEdit() {
    if (this.editDepth === 0) return;
    if (--this.editDepth > 0) return;
    const before = this.pending;
    this.pending = null;
    if (before !== null && before !== serialize(this.project)) {
      this.undoStack.push(before);
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
      this.autosave();
    }
    this.timeline.syncToolbar();
    this.timeline.draw();
    this.syncViewToolbar();
  }

  /* Runs a discrete change with undo support. */
  mutate(fn, { structural = false, keepView = false } = {}) {
    this.beginEdit();
    try { fn(); } finally {
      if (structural) this.engine.rebuild(); else this.engine.apply(this.frame);
      this.endEdit();
      if (structural) this.refreshAll();
      else if (!keepView) { this.props.update(); this.timeline.draw(); this.timeline.syncToolbar(); }
    }
  }

  restore(text) {
    const viewCam = this.engine.viewCamId;
    this.project = deserialize(text);
    this.selKeys.clear();
    if (this.selectedId && !findTl(this.project, this.selectedId)) this.selectedId = null;
    this.engine.applySettings(this.project.settings);
    this.engine.rebuild();
    if (viewCam && findTl(this.project, viewCam)) this.engine.setViewCamera(viewCam);
    else this.engine.setViewCamera(null);
    this.refreshAll();
    this.autosave();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(serialize(this.project));
    this.restore(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(serialize(this.project));
    this.restore(this.redoStack.pop());
  }

  /* ---------- Playback ---------- */

  togglePlay() {
    this.playing = !this.playing;
    if (this.playing && this.frame >= projectEnd(this.project)) this.frame = 0;
    this.timeline.syncToolbar();
  }

  advance(dt) {
    const end = projectEnd(this.project);
    let f = this.frame + dt * this.project.fps;
    if (f > end) {
      if (this.loop && end > 0) f = 0;
      else { f = end; this.playing = false; }
    }
    this.setFrame(f, true);
  }

  setFrame(f, fromPlayback = false) {
    this.frame = Math.max(0, f);
    this.engine.apply(this.frame);
    if (fromPlayback) this.timeline.ensureFrameVisible(this.frame);
    this.timeline.syncToolbar();
    this.timeline.draw();
    this.props.update();
    this.updateStatus();
  }

  jumpKey(dir) {
    const tl = findTl(this.project, this.selectedId);
    const frames = new Set();
    for (const t of tl ? [tl] : this.project.timelines) for (const k of t.keys) frames.add(k.f);
    const sorted = [...frames].sort((a, b) => a - b);
    const cur = Math.floor(this.frame);
    const target = dir > 0 ? sorted.find((f) => f > cur) : [...sorted].reverse().find((f) => f < cur);
    if (target !== undefined) this.setFrame(target);
  }

  /* ---------- Selection ---------- */

  select(id, { keepKeys = false } = {}) {
    if (id && !findTl(this.project, id)) id = null;
    const changed = id !== this.selectedId;
    this.selectedId = id;
    if (!keepKeys && changed) this.selKeys.clear();
    this.engine.setSelected(id);
    if (id) {
      // Reveal the row in the timeline.
      let t = findTl(this.project, findTl(this.project, id).parent);
      let expanded = false;
      while (t) { if (!t.expanded) { t.expanded = true; expanded = true; } t = findTl(this.project, t.parent); }
      if (expanded) this.timeline.refresh();
    }
    for (const row of document.querySelectorAll('.tl-row')) row.classList.toggle('selected', row.dataset.id === id);
    this.timeline.draw();
    this.timeline.syncToolbar();
    if (changed) this.props.render();
  }

  isKeySelected(id, f) { return this.selKeys.has(id + '|' + f); }

  selectKey(id, f, additive) {
    const k = id + '|' + f;
    if (!additive) { this.selKeys.clear(); this.selKeys.add(k); }
    else if (this.selKeys.has(k)) this.selKeys.delete(k);
    else this.selKeys.add(k);
    this.timeline.draw();
    this.timeline.syncToolbar();
  }

  clearKeySelection() { this.selKeys.clear(); this.timeline.draw(); }

  selectAllKeys() {
    this.selKeys.clear();
    const tl = findTl(this.project, this.selectedId);
    for (const t of tl ? [tl] : this.project.timelines) for (const k of t.keys) this.selKeys.add(t.id + '|' + k.f);
    this.timeline.draw();
  }

  selectedKeyRefs() {
    const out = [];
    for (const s of this.selKeys) {
      const i = s.lastIndexOf('|');
      const tl = findTl(this.project, s.slice(0, i));
      const key = tl ? keyAt(tl, +s.slice(i + 1)) : null;
      if (key) out.push({ tl, key });
    }
    return out;
  }

  minSelectedFrame() {
    let m = Infinity;
    for (const { key } of this.selectedKeyRefs()) m = Math.min(m, key.f);
    return m === Infinity ? 0 : m;
  }

  /* ---------- Keyframe editing ---------- */

  setValuesLive(id, values, opts = {}) {
    const tl = findTl(this.project, id);
    if (!tl) return;
    const wrap = this.editDepth === 0;
    if (wrap) this.beginEdit();
    setValues(tl, Math.floor(this.frame), values, this.project);
    this.engine.apply(this.frame);
    if (!opts.fromView || id === this.selectedId) this.props.update();
    this.timeline.draw();
    if (wrap) this.endEdit();
  }

  addKeyframe() {
    const tl = findTl(this.project, this.selectedId);
    if (!tl) { toast('Select an object or body part first.'); return; }
    this.mutate(() => {
      ensureKey(tl, Math.floor(this.frame), this.project);
      this.selKeys.clear();
      this.selKeys.add(tl.id + '|' + Math.floor(this.frame));
    });
  }

  deleteKeyAt(id, f) {
    const tl = findTl(this.project, id);
    if (!tl || !keyAt(tl, f)) return;
    this.mutate(() => { tl.keys = tl.keys.filter((k) => k.f !== f); this.selKeys.delete(id + '|' + f); });
  }

  deleteSelectedKeys() {
    const refs = this.selectedKeyRefs();
    if (!refs.length) {
      const tl = findTl(this.project, this.selectedId);
      if (tl && keyAt(tl, Math.floor(this.frame))) this.deleteKeyAt(tl.id, Math.floor(this.frame));
      else toast('Select keyframes to delete.');
      return;
    }
    this.mutate(() => {
      for (const { tl, key } of refs) tl.keys = tl.keys.filter((k) => k !== key);
      this.selKeys.clear();
    });
  }

  moveSelectedKeys(delta) {
    const refs = this.selectedKeyRefs();
    if (!refs.length || !delta) return;
    this.mutate(() => {
      const byTl = new Map();
      for (const r of refs) { if (!byTl.has(r.tl)) byTl.set(r.tl, []); byTl.get(r.tl).push(r.key); }
      this.selKeys.clear();
      for (const [tl, keys] of byTl) {
        const moving = new Set(keys);
        for (const k of keys) k.f = Math.max(0, k.f + delta);
        const targets = new Set(keys.map((k) => k.f));
        tl.keys = tl.keys.filter((k) => moving.has(k) || !targets.has(k.f));
        sortKeys(tl);
        for (const k of keys) this.selKeys.add(tl.id + '|' + k.f);
      }
    });
  }

  copyKeys() {
    let refs = this.selectedKeyRefs();
    if (!refs.length) {
      const tl = findTl(this.project, this.selectedId);
      const k = tl && keyAt(tl, Math.floor(this.frame));
      if (k) refs = [{ tl, key: k }];
    }
    if (!refs.length) { toast('Select keyframes to copy.'); return; }
    const base = Math.min(...refs.map((r) => r.key.f));
    this.clipboard = refs.map(({ tl, key }) => ({ id: tl.id, type: tl.type, off: key.f - base, key: JSON.parse(JSON.stringify(key)) }));
    toast(`Copied ${refs.length} keyframe${refs.length > 1 ? 's' : ''}.`);
  }

  pasteKeys() {
    if (!this.clipboard) { toast('Nothing to paste.'); return; }
    const ids = new Set(this.clipboard.map((c) => c.id));
    const sel = findTl(this.project, this.selectedId);
    const retarget = ids.size === 1 && sel && sel.type === this.clipboard[0].type;
    const base = Math.floor(this.frame);
    this.mutate(() => {
      this.selKeys.clear();
      for (const c of this.clipboard) {
        const tl = retarget ? sel : findTl(this.project, c.id);
        if (!tl) continue;
        const f = base + c.off;
        tl.keys = tl.keys.filter((k) => k.f !== f);
        tl.keys.push({ ...JSON.parse(JSON.stringify(c.key)), f });
        sortKeys(tl);
        this.selKeys.add(tl.id + '|' + f);
      }
    });
  }

  currentTransition() {
    const refs = this.selectedKeyRefs();
    if (refs.length) return refs[0].key.t || 'linear';
    const tl = findTl(this.project, this.selectedId);
    const k = tl && keyAt(tl, Math.floor(this.frame));
    return k ? k.t || 'linear' : this.project.settings.defaultTransition;
  }

  setTransitionForSelection(t) {
    let refs = this.selectedKeyRefs();
    if (!refs.length) {
      const tl = findTl(this.project, this.selectedId);
      const k = tl && keyAt(tl, Math.floor(this.frame));
      if (k) refs = [{ tl, key: k }];
    }
    if (!refs.length) { toast('Select a keyframe to set its transition.'); this.timeline.syncToolbar(); return; }
    this.mutate(() => { for (const { key } of refs) key.t = t; });
  }

  setTransitionAt(id, f, t) {
    const tl = findTl(this.project, id);
    const k = tl && keyAt(tl, f);
    if (k) this.mutate(() => { k.t = t; });
  }

  resetPose(id) {
    const tl = findTl(this.project, id);
    if (!tl) return;
    this.mutate(() => setValues(tl, Math.floor(this.frame), defaults(tl, this.project), this.project));
  }

  /* ---------- Objects ---------- */

  openLibrary() { openLibrary(this); }

  addFromCatalog(entry) {
    let tl;
    this.mutate(() => {
      const values = {};
      if (entry.type === 'camera') {
        const c = this.engine.workCam;
        const e = new THREE.Euler().setFromQuaternion(c.quaternion, 'XYZ');
        Object.assign(values, { px: c.position.x, py: c.position.y, pz: c.position.z, rx: e.x / DEG, ry: e.y / DEG, rz: e.z / DEG });
        for (const k of Object.keys(values)) values[k] = Math.round(values[k] * 100) / 100;
      } else {
        Object.assign(values, this.engine.placementPoint());
        if (entry.type === 'pointlight' || entry.type === 'spotlight') values.py = 40;
        if (entry.type === 'item') values.py = 0;
      }
      tl = createTimeline(this.project, entry, { values });
      this.selectedId = tl.id;
      this.selKeys.clear();
    }, { structural: true });
    this.props.render();
    toast(`Added ${tl.name}.`);
  }

  rename(id, name) {
    const tl = findTl(this.project, id);
    if (!tl || tl.name === name) return;
    this.mutate(() => { tl.name = name; }, { structural: true });
  }

  duplicate(id) {
    let copy;
    this.mutate(() => {
      copy = duplicateTimeline(this.project, id);
      if (copy) {
        for (const k of copy.keys) k.v.px = (k.v.px ?? 0) + 16;
        this.selectedId = copy.id;
      }
    }, { structural: true });
    if (copy) toast(`Duplicated as ${copy.name}.`);
  }

  deleteObject(id) {
    const tl = findTl(this.project, id);
    if (!tl) return;
    if (tl.type === 'bone') { toast('Body parts can’t be deleted on their own.'); return; }
    const name = tl.name;
    this.mutate(() => {
      if (this.engine.viewCamId === id) this.engine.setViewCamera(null);
      deleteTimeline(this.project, id);
      this.selectedId = null;
      this.selKeys.clear();
    }, { structural: true });
    toast(`Deleted ${name}.`);
  }

  setParent(id, parentId) {
    const tl = findTl(this.project, id);
    if (!tl || (parentId && (parentId === id || isDescendant(this.project, parentId, id)))) return;
    this.mutate(() => { tl.parent = parentId; }, { structural: true });
  }

  setObjectProp(id, props) {
    const tl = findTl(this.project, id);
    if (!tl) return;
    this.mutate(() => {
      for (const [k, v] of Object.entries(props)) { if (v === null) delete tl[k]; else tl[k] = v; }
    }, { structural: true });
  }

  async importSkin(id) {
    const file = await native.pickFile('image/png');
    if (!file) return;
    const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    const img = new Image();
    img.onload = () => {
      const ok = img.width >= 64 && (img.height === img.width || img.height === img.width / 2);
      if (!ok) { toast('Skin must be a 64×64 or 64×32 PNG.', 'error'); return; }
      this.setObjectProp(id, { skin: url });
      toast('Skin applied.');
    };
    img.onerror = () => toast('Couldn’t read that image.', 'error');
    img.src = url;
  }

  toggleExpanded(id) {
    const tl = findTl(this.project, id);
    if (!tl) return;
    tl.expanded = !tl.expanded;
    this.timeline.refresh();
    this.autosave();
  }

  setExpandedAll(v) {
    for (const t of this.project.timelines) t.expanded = v;
    this.timeline.refresh();
  }

  toggleHidden(id) {
    const tl = findTl(this.project, id);
    if (tl) this.mutate(() => { tl.hidden = !tl.hidden; }, { structural: true });
  }

  /* ---------- Cameras ---------- */

  setViewCamera(id) {
    this.engine.setViewCamera(id);
    this.syncViewToolbar();
    this.updateStatus();
    if (findTl(this.project, this.selectedId)?.type === 'camera') this.props.render();
  }

  cameraFromView(id) {
    const values = this.engine.cameraValuesFromWorkView(id);
    if (values) this.setValuesLive(id, values);
    toast('Camera keyed from the current view.');
  }

  /* ---------- Settings ---------- */

  setSetting(key, value, live = false) {
    const apply = () => { this.project.settings[key] = value; this.engine.applySettings(this.project.settings); };
    if (live && this.editDepth > 0) apply();
    else this.mutate(apply, { keepView: true });
  }

  setProjectProp(props) {
    this.mutate(() => Object.assign(this.project, props), { structural: true });
    this.scenePanel.render();
  }

  setGrid(v) {
    this.engine.setGrid(v);
    if (this.side === 'scene') this.scenePanel.render();
  }

  /* ---------- Files ---------- */

  async newProject() {
    const ok = await confirmDialog('New project', 'Start a new, empty project? Unsaved changes to the current project will be lost (it stays in Undo until you close the app).', 'New project');
    if (!ok) return;
    const before = serialize(this.project);
    this.project = newProject();
    this.selectedId = null;
    this.savedName = null;
    this.frame = 0;
    this.afterLoad();
    this.undoStack = [before];
    this.syncViewToolbar();
    this.autosave();
  }

  async saveProject(asNew = false) {
    let name = this.savedName || this.project.name;
    if (asNew || !this.savedName) {
      name = await promptDialog(asNew ? 'Save as' : 'Save project', name, 'Save');
      if (!name || !name.trim()) return;
      name = name.trim();
    }
    try {
      this.savedName = await native.saveProject(name, serialize(this.project));
      if (this.project.name !== this.savedName) { this.project.name = this.savedName; this.refreshAll(); }
      toast(`Saved ${this.savedName}.`);
    } catch (e) {
      toast('Couldn’t save the project: ' + (e.message || e), 'error');
    }
  }

  async openProjectDialog() {
    const list = await native.listProjects();
    const body = h('div', { class: 'form' });
    let dlg;
    const render = (items) => {
      if (!items.length) {
        body.replaceChildren(h('p', { class: 'dialog-text' }, 'No saved projects yet. Use File › Save to keep projects on this device, or import a project file.'));
        return;
      }
      body.replaceChildren(...items.map((p) => h('div', { class: 'field-row' },
        h('button', { class: 'btn', type: 'button', style: { flex: '1 1 auto', justifyContent: 'flex-start' }, onclick: async () => {
          const text = await native.loadProject(p.name);
          if (!text) { toast('Couldn’t open that project.', 'error'); return; }
          try {
            this.project = deserialize(text);
            this.savedName = p.name;
            this.selectedId = null;
            this.frame = 0;
            this.afterLoad();
            this.autosave();
            dlg.close();
          } catch (e) { toast(e.message, 'error'); }
        } }, icon('document'), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, p.name)),
        iconButton('trash', 'Delete ' + p.name, async () => {
          if (await confirmDialog('Delete project', `Delete “${p.name}” from this device? This can’t be undone.`, 'Delete')) {
            await native.deleteProject(p.name);
            render(await native.listProjects());
          }
        }))));
    };
    render(list);
    dlg = openDialog({ title: 'Open project', body, buttons: [{ label: 'Import file…', action: () => { this.importProjectFile(); } }, { label: 'Close' }] });
  }

  async importProjectFile() {
    const file = await native.pickFile('.mwproj,.json,application/json');
    if (!file) return;
    try {
      const text = await file.text();
      this.project = deserialize(text);
      this.savedName = null;
      this.selectedId = null;
      this.frame = 0;
      this.afterLoad();
      this.autosave();
      toast(`Opened ${this.project.name}.`);
    } catch (e) {
      toast('That file isn’t a valid project.', 'error');
    }
  }

  async exportProjectFile() {
    const blob = new Blob([serialize(this.project)], { type: 'application/json' });
    try {
      await native.saveExport(blob, `${this.project.name.replace(/[^\w\- ]+/g, '_')}.mwproj`, 'Export project');
    } catch (e) { toast('Export failed: ' + (e.message || e), 'error'); }
  }

  /* ---------- Minecraft textures ---------- */

  texturesChanged() {
    clearTextureCache();
    clearThumbnails();
    this.engine.refreshTextures();
    if (this.side === 'scene') this.scenePanel.render();
  }

  async importTextures() {
    const file = await native.pickFile('.jar,.zip,application/java-archive,application/zip,application/x-zip-compressed');
    if (!file) return;
    const bar = h('div');
    const dlg = openDialog({
      title: 'Importing textures', dismissible: false,
      body: h('div', {}, h('p', { class: 'dialog-text', style: { margin: 0 } }, `Reading ${file.name}\u2026`), h('div', { class: 'progress' }, bar)),
    });
    try {
      const m = await importPack(file, texturePaths(), (p) => { bar.style.width = p * 100 + '%'; });
      dlg.close();
      this.texturesChanged();
      toast(`Using ${m.count} textures from ${m.version ? 'Minecraft ' + m.version : m.name}.`);
    } catch (e) {
      dlg.close();
      toast(e.message || String(e), 'error');
    }
  }

  async removeTextures() {
    const ok = await confirmDialog('Remove Minecraft textures', 'Switch back to the built-in textures? You can import them again at any time.', 'Remove');
    if (!ok) return;
    await clearPack();
    this.texturesChanged();
    toast('Using built-in textures.');
  }

  textureStatus() {
    const m = packInfo();
    if (!m) return null;
    return { title: m.version ? `Minecraft ${m.version}` : m.name, detail: `${m.count} textures from ${m.name}` };
  }

  /* ---------- Rendering ---------- */

  renderOptions() {
    const cams = this.project.timelines.filter((t) => t.type === 'camera');
    const sizes = [
      { value: '1280x720', label: 'HD — 1280 × 720' },
      { value: '1920x1080', label: 'Full HD — 1920 × 1080' },
      { value: '1080x1920', label: 'Vertical — 1080 × 1920' },
      { value: '1080x1080', label: 'Square — 1080 × 1080' },
      { value: '2560x1440', label: 'QHD — 2560 × 1440' },
      { value: '3840x2160', label: '4K — 3840 × 2160' },
    ];
    const state = { size: localStorage.getItem('mw.rsize') || '1920x1080', cam: this.engine.viewCamId || cams[0]?.id || '' };
    const sizeCombo = combo({ value: state.size, options: sizes, onChange: (v) => { state.size = v; localStorage.setItem('mw.rsize', v); } });
    const camCombo = combo({ value: state.cam, options: [{ value: '', label: 'Current view' }, ...cams.map((c) => ({ value: c.id, label: c.name }))], onChange: (v) => { state.cam = v; } });
    return { state, rows: [fieldRow('Resolution', sizeCombo.el), fieldRow('Camera', camCombo.el)] };
  }

  renderImageDialog() {
    const { state, rows } = this.renderOptions();
    openDialog({
      title: 'Render image',
      body: h('div', { class: 'form' }, h('p', { class: 'dialog-text', style: { margin: 0 } }, `Renders frame ${Math.floor(this.frame)} without editor overlays.`), ...rows),
      buttons: [{ label: 'Render', primary: true, action: () => { setTimeout(() => this.renderImage(state), 30); } }, { label: 'Cancel' }],
    });
  }

  async renderImage(state) {
    const [w, hgt] = state.size.split('x').map(Number);
    const out = document.createElement('canvas');
    out.width = w; out.height = hgt;
    try {
      this.engine.beginExport(w, hgt);
      this.engine.apply(this.frame);
      this.engine.renderExportFrame(state.cam || null, out);
    } finally {
      this.engine.endExport();
    }
    const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    try {
      await native.saveExport(blob, `${this.project.name.replace(/[^\w\- ]+/g, '_')}_f${Math.floor(this.frame)}.png`, 'Rendered image');
      if (!native.isNative()) toast('Image rendered.');
    } catch (e) { toast('Couldn’t save image: ' + (e.message || e), 'error'); }
  }

  renderAnimationDialog() {
    const { state, rows } = this.renderOptions();
    const end = projectEnd(this.project);
    state.start = 0; state.end = end;
    const canVideo = typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
    state.format = canVideo ? 'video' : 'png';
    const fmtCombo = combo({
      value: state.format,
      options: [...(canVideo ? [{ value: 'video', label: 'Video (MP4 / WebM)' }] : []), { value: 'png', label: 'PNG image sequence (ZIP)' }],
      onChange: (v) => { state.format = v; },
    });
    const startBox = numberBox({ axis: 'S', value: 0, min: 0, max: 100000, step: 1, dp: 0, onCommit: (v) => { state.start = Math.round(v); } });
    const endBox = numberBox({ axis: 'E', value: end, min: 1, max: 100000, step: 1, dp: 0, onCommit: (v) => { state.end = Math.round(v); } });
    openDialog({
      title: 'Render animation',
      body: h('div', { class: 'form' }, ...rows, fieldRow('Format', fmtCombo.el),
        fieldRow('Frames', h('div', { class: 'vec3', style: { gridTemplateColumns: '1fr 1fr', flex: '1 1 auto' } }, startBox.el, endBox.el)),
        h('div', { class: 'field-caption' }, `${this.project.fps} fps. Video renders in real time; keep the app open until it finishes.`)),
      buttons: [{ label: 'Render', primary: true, action: () => { setTimeout(() => this.renderAnimation(state), 30); } }, { label: 'Cancel' }],
    });
  }

  async renderAnimation(state) {
    const [w, hgt] = state.size.split('x').map(Number);
    const start = Math.min(state.start, state.end), end = Math.max(state.start, state.end);
    const total = end - start + 1;
    const fps = this.project.fps;
    if (this.playing) this.togglePlay();

    const bar = h('div');
    const label = h('p', { class: 'dialog-text', style: { margin: 0 } }, 'Preparing…');
    let cancelled = false;
    const dlg = openDialog({
      title: 'Rendering animation', dismissible: false,
      body: h('div', {}, label, h('div', { class: 'progress' }, bar)),
      buttons: [{ label: 'Cancel', action: () => { cancelled = true; return false; } }],
    });
    const progress = (i) => { bar.style.width = (i / total) * 100 + '%'; label.textContent = `Frame ${start + i} of ${end} (${Math.round((i / total) * 100)}%)`; };

    const out = document.createElement('canvas');
    out.width = w; out.height = hgt;
    const name = this.project.name.replace(/[^\w\- ]+/g, '_');
    let blob = null, filename = '';
    this.engine.beginExport(w, hgt);
    try {
      if (state.format === 'video') {
        const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
        const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
        const stream = out.captureStream(fps);
        const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: Math.round(w * hgt * fps * 0.2) });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        const stopped = new Promise((r) => { rec.onstop = r; });
        this.engine.apply(start);
        this.engine.renderExportFrame(state.cam || null, out);
        rec.start(250);
        const t0 = performance.now();
        for (let i = 0; i < total && !cancelled; i++) {
          this.engine.apply(start + i);
          this.engine.renderExportFrame(state.cam || null, out);
          progress(i + 1);
          const due = t0 + ((i + 1) * 1000) / fps;
          await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
        }
        rec.stop();
        await stopped;
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || mime || 'video/webm';
        blob = new Blob(chunks, { type });
        filename = `${name}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      } else {
        const zip = new ZipWriter();
        for (let i = 0; i < total && !cancelled; i++) {
          this.engine.apply(start + i);
          this.engine.renderExportFrame(state.cam || null, out);
          const png = await new Promise((r) => out.toBlob(r, 'image/png'));
          zip.add(`${name}_${String(start + i).padStart(5, '0')}.png`, new Uint8Array(await png.arrayBuffer()));
          progress(i + 1);
          if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
        }
        blob = zip.finish();
        filename = `${name}_frames.zip`;
      }
    } catch (e) {
      toast('Rendering failed: ' + (e.message || e), 'error');
      blob = null;
    } finally {
      this.engine.endExport();
      this.engine.apply(this.frame);
      dlg.close();
    }
    if (cancelled || !blob) { if (cancelled) toast('Render cancelled.'); return; }
    try {
      await native.saveExport(blob, filename, 'Rendered animation');
      if (!native.isNative()) toast('Animation rendered.');
    } catch (e) { toast('Couldn’t save the render: ' + (e.message || e), 'error'); }
  }

  /* ---------- Keyboard (hardware keyboards / desktop) ---------- */

  bindKeys() {
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if ($('layer').querySelector('.dialog-smoke')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); return; }
      if (mod && k === 's') { e.preventDefault(); this.saveProject(); return; }
      if (mod && k === 'o') { e.preventDefault(); this.openProjectDialog(); return; }
      if (mod && k === 'c') { e.preventDefault(); this.copyKeys(); return; }
      if (mod && k === 'v') { e.preventDefault(); this.pasteKeys(); return; }
      if (mod && k === 'a') { e.preventDefault(); this.selectAllKeys(); return; }
      if (mod && k === 'd') { e.preventDefault(); if (this.selectedId) this.duplicate(rootOf(this.project, findTl(this.project, this.selectedId)).id); return; }
      if (mod) return;
      switch (k) {
        case ' ': e.preventDefault(); this.togglePlay(); break;
        case 'q': this.setTool('select'); break;
        case 'w': this.setTool('translate'); break;
        case 'e': this.setTool('rotate'); break;
        case 'r': this.setTool('scale'); break;
        case 'k': this.addKeyframe(); break;
        case 'a': this.openLibrary(); break;
        case 'f': this.engine.focusSelected(); break;
        case 'home': this.setFrame(0); break;
        case 'end': this.setFrame(projectEnd(this.project)); break;
        case 'arrowleft': this.setFrame(Math.max(0, Math.floor(this.frame) - 1)); break;
        case 'arrowright': this.setFrame(Math.floor(this.frame) + 1); break;
        case 'delete':
        case 'backspace':
          if (this.selKeys.size) this.deleteSelectedKeys();
          else if (this.selectedId) this.deleteObject(this.selectedId);
          break;
        case 'escape': this.select(null); break;
        default: break;
      }
    });
  }
}

/* ---------- Demo scene ---------- */

function lookAt(pos, target) {
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(...pos);
  cam.lookAt(new THREE.Vector3(...target));
  const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'XYZ');
  const r = (x) => Math.round(x * 100) / 100;
  return { px: pos[0], py: pos[1], pz: pos[2], rx: r(e.x / DEG), ry: r(e.y / DEG), rz: r(e.z / DEG) };
}

function buildDemo() {
  const p = newProject();
  p.name = 'Welcome scene';
  p.length = 96;
  const entry = (id) => CATALOG.find((e) => e.id === id);
  const ease = 'easeInOutSine';
  const key = (tl, f, v, t = ease) => { const k = ensureKey(tl, f, p); Object.assign(k.v, v); k.t = t; };
  const bone = (owner, name) => p.timelines.find((t) => t.owner === owner.id && t.bone === name);

  const hero = createTimeline(p, entry('char_classic'), { values: { px: 0, pz: 0, ry: 15 } });
  hero.name = 'Hero';
  hero.expanded = true;
  hero.keys[0].t = ease;
  const ra = bone(hero, 'right_arm');
  key(ra, 0, { rz: 0, bend: 0 });
  key(ra, 12, { rz: -150, bend: 25 });
  key(ra, 20, { rz: -128, bend: 40 });
  key(ra, 28, { rz: -155, bend: 20 });
  key(ra, 36, { rz: -128, bend: 40 });
  key(ra, 44, { rz: -150, bend: 25 });
  key(ra, 60, { rz: 0, bend: 0 });
  const la = bone(hero, 'left_arm');
  key(la, 0, { rx: 0, rz: 0 });
  key(la, 30, { rx: -8, rz: 6 });
  key(la, 60, { rx: 0, rz: 0 });
  const head = bone(hero, 'head');
  key(head, 0, { ry: 0, rx: 0 });
  key(head, 18, { ry: 18, rx: -6 });
  key(head, 48, { ry: -10, rx: 4 });
  key(head, 72, { ry: 0, rx: 0 });
  const body = bone(hero, 'body');
  key(body, 0, { rz: 0, bend: 0 });
  key(body, 24, { rz: 4, bend: 6 });
  key(body, 60, { rz: 0, bend: 0 });

  const pig = createTimeline(p, entry('mob_pig'), { values: { px: 46, pz: -22, ry: -35 } });
  pig.keys[0].t = ease;
  key(pig, 48, { px: 30, pz: 6, ry: -10 });
  key(pig, 96, { px: 46, pz: -22, ry: -35 });
  const pigHead = bone(pig, 'head');
  key(pigHead, 0, { rx: 0 });
  key(pigHead, 24, { rx: 18 });
  key(pigHead, 40, { rx: 0 });
  const legs = ['front_right_leg', 'back_left_leg', 'front_left_leg', 'back_right_leg'];
  legs.forEach((n, i) => {
    const b = bone(pig, n);
    const s = i < 2 ? 1 : -1;
    for (let f = 0; f <= 96; f += 12) key(b, f, { rx: (f / 12) % 2 ? -22 * s : 22 * s });
  });

  createTimeline(p, entry('scenery_oak_tree'), { values: { px: -88, pz: -56 } });
  createTimeline(p, entry('scenery_cottage'), { values: { px: 120, pz: -150, ry: -25 } });
  createTimeline(p, entry('block_crafting_table'), { values: { px: -36, pz: 10, ry: 10 } });
  createTimeline(p, entry('block_oak_log'), { values: { px: -36, pz: 34 } });
  const sword = createTimeline(p, entry('item_diamond_sword'), { values: { px: -36, py: 16, pz: 10, rx: -90, rz: 45 } });
  sword.name = 'Sword';

  const cam = createTimeline(p, entry('cam'), { values: lookAt([64, 30, 104], [0, 18, 0]) });
  cam.name = 'Camera';
  cam.keys[0].t = ease;
  key(cam, 96, lookAt([-58, 36, 92], [0, 18, 0]));
  return p;
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await initPack();
    window.minewasp = new App();
  } catch (e) {
    document.body.innerHTML = '';
    document.body.append(h('div', { class: 'empty-state', style: { height: '100%', justifyContent: 'center' } },
      icon('error'), h('div', { class: 'es-title' }, 'Minewasp 3D couldn’t start'), h('div', {}, String(e.message || e))));
    throw e;
  }
});

