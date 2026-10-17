import { h, icon, numberBox, slider, toggle, combo, colorField, fieldRow, section } from './ui.js';
import { TRANSITION_GROUPS, transitionLabel } from './util.js';
import { evaluate, keyAt, valueKeys, findTl, isDescendant, isLight, DRAWABLE } from './project.js';
import { HUMAN_SKINS, BLOCKS, ITEMS, SCENERY, SHAPES, catalogName } from './models.js';
import { typeIcon } from './timeline.js';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const TYPE_LABEL = {
  model: 'Character', bone: 'Body part', block: 'Block', item: 'Item', scenery: 'Scenery',
  shape: 'Shape', camera: 'Camera', pointlight: 'Point light', spotlight: 'Spot light',
};

export class PropertiesPanel {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.controls = {};
  }

  /* Wires a value control to the selected timeline. */
  bind(key, ctl) {
    this.controls[key] = ctl;
    return ctl;
  }

  valueHandlers(key) {
    const a = this.app;
    return {
      onBegin: () => a.beginEdit(),
      onInput: (v) => {
        if (key.startsWith('s') && key.length === 2 && this.uniformScale) {
          a.setValuesLive(a.selectedId, { sx: v, sy: v, sz: v });
        } else a.setValuesLive(a.selectedId, { [key]: v });
      },
      onCommit: () => a.endEdit(),
    };
  }

  vec3(label, keys, opts) {
    const axes = ['X', 'Y', 'Z'];
    const boxes = keys.map((k, i) => this.bind(k, numberBox({ axis: axes[i], axisCls: axes[i].toLowerCase(), ...opts, ...this.valueHandlers(k) })));
    return h('div', {}, h('div', { class: 'field-group-label' }, label), h('div', { class: 'vec3', style: { marginTop: '6px' } }, boxes.map((b) => b.el)));
  }

  render() {
    const a = this.app;
    const tl = findTl(a.project, a.selectedId);
    this.controls = {};
    this.tl = tl;
    if (!tl) {
      this.root.replaceChildren(h('div', { class: 'empty-state' },
        icon('sliders'),
        h('div', { class: 'es-title' }, 'Nothing selected'),
        h('div', {}, 'Tap an object in the viewport or the timeline to edit its properties.'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => a.openLibrary() }, icon('add'), 'Add object')));
      return;
    }
    const keys = new Set(valueKeys(tl, a.project));
    const owner = tl.type === 'bone' ? findTl(a.project, tl.owner) : null;
    const nodes = [];

    const nameInput = h('input', { class: 'ph-title', value: tl.name, 'aria-label': 'Name', spellcheck: 'false' });
    nameInput.addEventListener('change', () => a.rename(tl.id, nameInput.value.trim() || tl.name));
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });
    const sub = tl.type === 'bone' ? `Body part of ${owner?.name ?? ''}` : `${TYPE_LABEL[tl.type] || tl.type} · ${catalogName(tl)}`;
    nodes.push(h('div', { class: 'prop-header' },
      h('div', { class: 'ph-icon' }, icon(typeIcon(tl))),
      h('div', { class: 'ph-text' }, nameInput, h('div', { class: 'ph-sub' }, sub))));

    // Transform
    const tf = [
      this.vec3('Position', ['px', 'py', 'pz'], { step: 0.5, dp: 2, scrub: 0.5 }),
      this.vec3('Rotation', ['rx', 'ry', 'rz'], { step: 1, dp: 1, scrub: 0.5 }),
      this.vec3('Scale', ['sx', 'sy', 'sz'], { step: 0.05, dp: 2, scrub: 0.2 }),
    ];
    this.uniformScale = store.get('mw.uniformScale') === '1';
    tf.push(toggle({ checked: this.uniformScale, label: 'Uniform scale', onChange: (v) => { this.uniformScale = v; store.set('mw.uniformScale', v ? '1' : '0'); } }).el);
    if (keys.has('bend')) {
      tf.push(fieldRow('Bend', this.bind('bend', slider({ min: -180, max: 180, step: 1, dp: 0, ...this.valueHandlers('bend') })).el));
    }
    nodes.push(section('Transform', tf, { id: 'transform', store }));

    // Appearance
    if (DRAWABLE.has(tl.type)) {
      const vis = this.bind('vis', toggle({
        checked: true, label: 'Visible',
        onChange: (v) => { a.beginEdit(); a.setValuesLive(tl.id, { vis: v ? 1 : 0 }); a.endEdit(); },
      }));
      nodes.push(section('Appearance', [
        vis.el,
        fieldRow('Opacity', this.bind('alpha', slider({ min: 0, max: 1, step: 0.01, dp: 2, ...this.valueHandlers('alpha') })).el),
        fieldRow('Color', this.bind('color', colorField({ value: '#ffffff', ...this.valueHandlers('color') })).el),
        fieldRow('Brightness', this.bind('bright', slider({ min: 0, max: 1, step: 0.01, dp: 2, ...this.valueHandlers('bright') })).el),
      ], { id: 'appearance', store }));
    }

    // Camera
    if (tl.type === 'camera') {
      const looking = a.engine.viewCamId === tl.id;
      nodes.push(section('Camera', [
        fieldRow('Field of view', this.bind('fov', slider({ min: 5, max: 150, step: 1, dp: 0, ...this.valueHandlers('fov') })).el),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn' + (looking ? ' primary' : ''), type: 'button', onclick: () => a.setViewCamera(looking ? null : tl.id) }, icon('camera'), looking ? 'Exit camera view' : 'Look through'),
          h('button', { class: 'btn', type: 'button', onclick: () => a.cameraFromView(tl.id), disabled: looking }, icon('focus'), 'Set from view')),
        h('div', { class: 'field-caption' }, 'While looking through a camera, orbiting and zooming the viewport moves the camera and keys its position.'),
      ], { id: 'camera', store }));
    }

    // Light
    if (isLight(tl)) {
      const rows = [
        fieldRow('Color', this.bind('lcolor', colorField({ value: '#ffffff', ...this.valueHandlers('lcolor') })).el),
        fieldRow('Intensity', this.bind('intensity', slider({ min: 0, max: 5, step: 0.05, dp: 2, ...this.valueHandlers('intensity') })).el),
        fieldRow('Range', this.bind('range', slider({ min: 0, max: 800, step: 1, dp: 0, ...this.valueHandlers('range') })).el),
      ];
      if (tl.type === 'spotlight') {
        rows.push(fieldRow('Spot angle', this.bind('angle', slider({ min: 1, max: 89, step: 1, dp: 0, ...this.valueHandlers('angle') })).el));
        rows.push(fieldRow('Softness', this.bind('soft', slider({ min: 0, max: 1, step: 0.01, dp: 2, ...this.valueHandlers('soft') })).el));
      }
      nodes.push(section('Light', rows, { id: 'light', store }));
    }

    // Keyframe
    this.keyInfo = h('div', { class: 'field-caption' });
    this.keyTrans = combo({
      value: 'linear',
      options: TRANSITION_GROUPS.map((g) => ({ group: g.label, items: g.items.map((i) => ({ value: i.id, label: i.label })) })),
      onChange: (v) => a.setTransitionAt(tl.id, Math.floor(a.frame), v),
    });
    this.keyAddBtn = h('button', { class: 'btn', type: 'button', onclick: () => a.addKeyframe() }, icon('keyAdd'), 'Add keyframe');
    this.keyDelBtn = h('button', { class: 'btn', type: 'button', onclick: () => a.deleteKeyAt(tl.id, Math.floor(a.frame)) }, icon('keyRemove'), 'Remove');
    this.keyTransRow = fieldRow('Transition', this.keyTrans.el);
    nodes.push(section('Keyframe', [this.keyInfo, this.keyTransRow, h('div', { class: 'btn-row' }, this.keyAddBtn, this.keyDelBtn)], { id: 'keyframe', store }));

    // Object
    if (tl.type !== 'bone') nodes.push(this.objectSection(tl));
    else {
      nodes.push(section('Body part', [
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => a.resetPose(tl.id) }, icon('undo'), 'Reset at frame'),
          h('button', { class: 'btn', type: 'button', onclick: () => a.select(tl.owner) }, icon('person'), 'Select owner')),
      ], { id: 'bone', store }));
    }

    this.root.replaceChildren(...nodes);
    this.update();
  }

  objectSection(tl) {
    const a = this.app;
    const rows = [];
    const parentOptions = [{ value: '', label: 'None' }];
    for (const t of a.project.timelines) {
      if (t.id === tl.id || t.owner === tl.id || isDescendant(a.project, t.id, tl.id)) continue;
      const owner = t.type === 'bone' ? findTl(a.project, t.owner) : null;
      parentOptions.push({ value: t.id, label: owner ? `${owner.name} › ${t.name}` : t.name });
    }
    rows.push(fieldRow('Parent', combo({ value: tl.parent || '', options: parentOptions, onChange: (v) => a.setParent(tl.id, v || null) }).el));

    if (tl.type === 'model' && tl.ref === 'human') {
      rows.push(fieldRow('Skin', combo({
        value: tl.skin ? '__custom' : tl.variant,
        options: [...Object.entries(HUMAN_SKINS).map(([k, s]) => ({ value: k, label: s.name })), ...(tl.skin ? [{ value: '__custom', label: 'Custom skin' }] : [])],
        onChange: (v) => { if (v !== '__custom') a.setObjectProp(tl.id, { variant: v, skin: null, slim: !!HUMAN_SKINS[v]?.slim }); },
      }).el));
      rows.push(toggle({ checked: !!tl.slim, label: 'Slim arms', onChange: (v) => a.setObjectProp(tl.id, { slim: v }) }).el);
      rows.push(h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => a.importSkin(tl.id) }, icon('upload'), 'Import skin'),
        tl.skin ? h('button', { class: 'btn', type: 'button', onclick: () => a.setObjectProp(tl.id, { skin: null }) }, icon('close'), 'Clear') : null));
      rows.push(h('div', { class: 'field-caption' }, 'Accepts standard 64×64 or legacy 64×32 skin PNG files.'));
    }
    if (tl.type === 'block') {
      rows.push(fieldRow('Block', combo({ value: tl.ref, options: BLOCKS.map((b) => ({ value: b.id, label: b.name })), onChange: (v) => a.setObjectProp(tl.id, { ref: v }) }).el));
    }
    if (tl.type === 'item') {
      rows.push(fieldRow('Item', combo({ value: tl.ref, options: ITEMS.map((b) => ({ value: b.id, label: b.name })), onChange: (v) => a.setObjectProp(tl.id, { ref: v }) }).el));
    }
    if (tl.type === 'scenery') {
      rows.push(fieldRow('Structure', combo({ value: tl.ref, options: Object.entries(SCENERY).map(([k, s]) => ({ value: k, label: s.name })), onChange: (v) => a.setObjectProp(tl.id, { ref: v }) }).el));
    }
    if (tl.type === 'shape') {
      rows.push(fieldRow('Shape', combo({ value: tl.ref, options: SHAPES.map((s) => ({ value: s.id, label: s.name })), onChange: (v) => a.setObjectProp(tl.id, { ref: v }) }).el));
      rows.push(fieldRow('Texture', combo({ value: tl.tex || '', options: [{ value: '', label: 'None (solid color)' }, ...BLOCKS.map((b) => ({ value: b.id, label: b.name }))], onChange: (v) => a.setObjectProp(tl.id, { tex: v }) }).el));
    }
    rows.push(h('div', { class: 'btn-row' },
      h('button', { class: 'btn', type: 'button', onclick: () => a.duplicate(tl.id) }, icon('duplicate'), 'Duplicate'),
      h('button', { class: 'btn', type: 'button', onclick: () => a.deleteObject(tl.id) }, icon('trash'), 'Delete')));
    return section('Object', rows, { id: 'object', store });
  }

  /* Refreshes control values without rebuilding the DOM. */
  update() {
    const a = this.app;
    const tl = this.tl;
    if (!tl || !findTl(a.project, tl.id)) return;
    const f = Math.floor(a.frame);
    const v = evaluate(tl, a.frame, a.project);
    const key = keyAt(tl, f);
    for (const [k, ctl] of Object.entries(this.controls)) {
      if (!(k in v)) continue;
      ctl.set(k === 'vis' ? v[k] >= 0.5 : v[k]);
      ctl.setKeyed?.(!!key);
    }
    if (this.keyInfo) {
      this.keyInfo.textContent = key
        ? `Keyframe at frame ${f} · ${transitionLabel(key.t)} to next`
        : `No keyframe at frame ${f}. Editing a value adds one automatically.`;
      this.keyTransRow.style.display = key ? '' : 'none';
      this.keyDelBtn.disabled = !key;
      this.keyAddBtn.disabled = !!key;
      if (key) this.keyTrans.set(key.t || 'linear');
    }
  }
}

export class ScenePanel {
  constructor(root, app) {
    this.root = root;
    this.app = app;
  }

  texturesSection() {
    const a = this.app;
    const st = a.textureStatus();
    return section('Minecraft textures', [
      h('div', { class: 'field-caption', style: { color: 'var(--text-1)', fontSize: '13px' } }, st ? st.title : 'Built-in textures'),
      h('div', { class: 'field-caption' }, st
        ? st.detail
        : 'Import your own Minecraft Java Edition .jar or a resource pack to use the official textures. Files stay on this device.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn' + (st ? '' : ' primary'), type: 'button', onclick: () => a.importTextures() }, icon('import'), st ? 'Replace' : 'Import .jar or pack'),
        st ? h('button', { class: 'btn', type: 'button', onclick: () => a.removeTextures() }, icon('close'), 'Remove') : null),
      h('div', { class: 'field-caption' }, 'The game .jar is in .minecraft/versions/<version>/<version>.jar.'),
    ], { id: 'mctextures', store });
  }

  render() {
    const a = this.app;
    const p = a.project;
    const s = p.settings;
    const set = (key, live = false) => (v) => a.setSetting(key, v, live);
    const begin = () => a.beginEdit();
    const end = () => a.endEdit();
    const live = (key) => ({ onBegin: begin, onInput: set(key, true), onCommit: end });

    const nameInput = h('input', { class: 'textbox', value: p.name, spellcheck: 'false' });
    nameInput.addEventListener('change', () => a.setProjectProp({ name: nameInput.value.trim() || 'Untitled project' }));

    const fpsCombo = combo({ value: String(p.fps), options: [12, 15, 20, 24, 25, 30, 50, 60].map((n) => ({ value: String(n), label: `${n} fps` })), onChange: (v) => a.setProjectProp({ fps: +v }) });
    const lengthBox = numberBox({ value: p.length, min: 1, max: 100000, step: 1, dp: 0, scrub: 0.5, onCommit: (v) => a.setProjectProp({ length: Math.round(v) }) });

    const groundBlocks = BLOCKS.filter((b) => !b.translucent && !b.cutout);

    this.root.replaceChildren(
      h('div', { class: 'prop-header' }, h('div', { class: 'ph-icon' }, icon('settings')),
        h('div', { class: 'ph-text' }, h('div', { class: 'ph-title', style: { borderBottom: 0 } }, 'Scene'), h('div', { class: 'ph-sub' }, 'Project, environment and lighting'))),
      section('Project', [
        fieldRow('Name', nameInput),
        fieldRow('Frame rate', fpsCombo.el),
        fieldRow('Length', lengthBox.el),
        h('div', { class: 'field-caption' }, `${p.length} frames · ${(p.length / p.fps).toFixed(2)} seconds`),
        fieldRow('New keyframes', combo({
          value: s.defaultTransition,
          options: TRANSITION_GROUPS.map((g) => ({ group: g.label, items: g.items.map((i) => ({ value: i.id, label: i.label })) })),
          onChange: set('defaultTransition'),
        }).el),
      ], { id: 'project', store }),
      section('Environment', [
        fieldRow('Sky color', colorField({ value: s.sky, ...live('sky') }).el),
        toggle({ checked: s.fog, label: 'Fog', onChange: set('fog') }).el,
        fieldRow('Fog distance', slider({ value: s.fogDistance, min: 200, max: 4000, step: 10, dp: 0, ...live('fogDistance') }).el),
        toggle({ checked: s.ground, label: 'Ground', onChange: set('ground') }).el,
        fieldRow('Ground block', combo({ value: s.groundBlock, options: groundBlocks.map((b) => ({ value: b.id, label: b.name })), onChange: set('groundBlock') }).el),
        toggle({ checked: a.engine.showGrid, label: 'Show grid in editor', onChange: (v) => a.setGrid(v) }).el,
      ], { id: 'environment', store }),
      this.texturesSection(),
      section('Lighting', [
        fieldRow('Sun direction', slider({ value: s.sunYaw, min: 0, max: 360, step: 1, dp: 0, ...live('sunYaw') }).el),
        fieldRow('Sun height', slider({ value: s.sunPitch, min: 5, max: 90, step: 1, dp: 0, ...live('sunPitch') }).el),
        fieldRow('Sun strength', slider({ value: s.sunIntensity, min: 0, max: 2, step: 0.01, dp: 2, ...live('sunIntensity') }).el),
        fieldRow('Sun color', colorField({ value: s.sunColor, ...live('sunColor') }).el),
        fieldRow('Ambient', slider({ value: s.ambient, min: 0, max: 2, step: 0.01, dp: 2, ...live('ambient') }).el),
        fieldRow('Ambient color', colorField({ value: s.ambientColor, ...live('ambientColor') }).el),
        toggle({ checked: s.shadows, label: 'Shadows', onChange: set('shadows') }).el,
      ], { id: 'lighting', store }),
    );
  }
}
