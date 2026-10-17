import { h, icon, openDialog, iconButton, toggle, confirmDialog } from './ui.js';
import { listSkins, removeSkin, loadImage, skinFace } from './skins.js';
import { CATEGORIES, CATALOG } from './models.js';

const thumbCache = new Map();
const faceCache = new Map();

const segmentedPref = () => { try { return localStorage.getItem('mw.segmented') === '1'; } catch { return false; } };

export function clearThumbnails() {
  thumbCache.clear();
}

export function openLibrary(app, initialCat) {
  let cat = initialCat || sessionStorage.getItem('mw.libcat') || 'characters';
  let query = '';
  const grid = h('div', { class: 'lib-grid' });
  const nav = h('div', { class: 'lib-nav', role: 'tablist' });
  const title = h('h2', {});
  const search = h('input', { class: 'textbox lib-search', type: 'search', placeholder: 'Search', 'aria-label': 'Search library' });
  let dlg = null;

  const tiles = new Map();
  const renderGrid = () => {
    const q = query.trim().toLowerCase();
    const entries = CATALOG.filter((e) => (q ? e.name.toLowerCase().includes(q) : e.cat === cat));
    title.textContent = q ? 'Search results' : CATEGORIES.find((c) => c.id === cat).label;
    tiles.clear();
    const seg = segmentedPref();
    const add = (e) => { dlg.close(); app.addFromCatalog(e.type === 'model' && e.ref === 'human' ? { ...e, segmented: seg } : e); };
    grid.replaceChildren(...entries.map((e) => {
      const thumb = h('div', { class: 'thumb' });
      const cached = thumbCache.get(e.id);
      if (cached) thumb.append(h('img', { src: cached, alt: '' }));
      else thumb.append(icon(e.icon || CATEGORIES.find((c) => c.id === e.cat).icon));
      tiles.set(e.id, thumb);
      return h('button', {
        class: 'lib-tile', type: 'button', title: e.name,
        onclick: () => add(e),
      }, thumb, h('div', { class: 'tile-name' }, e.name), h('div', { class: 'tile-sub' }, e.sub));
    }));
    if (!q && cat === 'characters') grid.append(...skinTiles(seg));
    const missing = entries.filter((e) => !e.icon && !thumbCache.has(e.id));
    if (missing.length) {
      app.engine.thumbnails(missing, 160, (entry, url) => {
        thumbCache.set(entry.id, url);
        const t = tiles.get(entry.id);
        if (t) t.replaceChildren(h('img', { src: url, alt: '' }));
      });
    }
  };

  /* "Your skins": import from file, fetch by username, and saved skins. */
  const skinTiles = (seg) => {
    const actionTile = (iconName, name, sub, onclick) => h('button', { class: 'lib-tile', type: 'button', title: name, onclick },
      h('div', { class: 'thumb' }, icon(iconName)), h('div', { class: 'tile-name' }, name), h('div', { class: 'tile-sub' }, sub));
    const out = [
      h('div', { class: 'lib-section' }, 'Your skins'),
      actionTile('upload', 'Import skin', 'PNG file', async () => {
        const skin = await app.pickSkinFile();
        if (skin) { dlg.close(); app.addCharacterWithSkin(skin, seg); }
      }),
      actionTile('person', 'By username', 'Minecraft player', async () => {
        const skin = await app.pickSkinByUsername();
        if (skin) { dlg.close(); app.addCharacterWithSkin(skin, seg); }
      }),
    ];
    for (const s of listSkins()) {
      const thumb = h('div', { class: 'thumb' });
      const show = (url) => thumb.replaceChildren(h('img', { src: url, alt: '', style: { imageRendering: 'pixelated' } }));
      if (faceCache.has(s.id)) show(faceCache.get(s.id));
      else loadImage(s.data).then((img) => { const url = skinFace(img); faceCache.set(s.id, url); show(url); }).catch(() => {});
      const tile = h('button', { class: 'lib-tile', type: 'button', title: s.name, onclick: () => { dlg.close(); app.addCharacterWithSkin(s, seg); } },
        thumb, h('div', { class: 'tile-name' }, s.name), h('div', { class: 'tile-sub' }, s.slim ? 'Saved skin, slim arms' : 'Saved skin'));
      const del = async (ev) => {
        ev?.preventDefault?.();
        if (await confirmDialog('Remove skin', `Remove \u201c${s.name}\u201d from your skins? Characters already using it keep it.`, 'Remove')) {
          removeSkin(s.id);
          renderGrid();
        }
      };
      tile.addEventListener('contextmenu', del);
      let timer = 0;
      tile.addEventListener('pointerdown', () => { timer = setTimeout(() => { timer = -1; del(); }, 550); });
      tile.addEventListener('pointerup', () => clearTimeout(timer));
      tile.addEventListener('pointercancel', () => clearTimeout(timer));
      tile.addEventListener('click', (ev) => { if (timer === -1) { ev.stopImmediatePropagation(); timer = 0; } }, true);
      out.push(tile);
    }
    return out;
  };

  const segToggle = toggle({
    checked: segmentedPref(), label: 'Segmented limbs',
    onChange: (v) => { try { localStorage.setItem('mw.segmented', v ? '1' : '0'); } catch { /* ignore */ } },
  });
  segToggle.el.title = 'Split arms and legs into upper and lower parts you can rotate separately';

  const renderNav = () => {
    nav.replaceChildren(...CATEGORIES.map((c) => h('button', {
      class: 'lib-nav-item' + (c.id === cat && !query ? ' selected' : ''), type: 'button', role: 'tab',
      onclick: () => {
        cat = c.id;
        query = '';
        search.value = '';
        sessionStorage.setItem('mw.libcat', cat);
        renderNav();
        renderGrid();
        syncHead();
      },
    }, icon(c.icon), h('span', {}, c.label))));
  };

  search.addEventListener('input', () => { query = search.value; renderNav(); renderGrid(); syncHead(); });
  const syncHead = () => { segToggle.el.style.display = cat === 'characters' && !query ? '' : 'none'; };

  const body = h('div', { class: 'library' },
    nav,
    h('div', { class: 'lib-main' },
      h('div', { class: 'lib-head' }, title, search, iconButton('close', 'Close', () => dlg.close())),
      h('div', { class: 'lib-options' }, segToggle.el),
      grid));
  dlg = openDialog({ body, wide: true });
  renderNav();
  renderGrid();
  syncHead();
}
