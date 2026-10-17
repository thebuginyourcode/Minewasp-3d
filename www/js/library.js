import { h, icon, openDialog, iconButton } from './ui.js';
import { CATEGORIES, CATALOG } from './models.js';

const thumbCache = new Map();

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
    grid.replaceChildren(...entries.map((e) => {
      const thumb = h('div', { class: 'thumb' });
      const cached = thumbCache.get(e.id);
      if (cached) thumb.append(h('img', { src: cached, alt: '' }));
      else thumb.append(icon(e.icon || CATEGORIES.find((c) => c.id === e.cat).icon));
      tiles.set(e.id, thumb);
      return h('button', {
        class: 'lib-tile', type: 'button', title: e.name,
        onclick: () => { dlg.close(); app.addFromCatalog(e); },
      }, thumb, h('div', { class: 'tile-name' }, e.name), h('div', { class: 'tile-sub' }, e.sub));
    }));
    const missing = entries.filter((e) => !e.icon && !thumbCache.has(e.id));
    if (missing.length) {
      app.engine.thumbnails(missing, 160, (entry, url) => {
        thumbCache.set(entry.id, url);
        const t = tiles.get(entry.id);
        if (t) t.replaceChildren(h('img', { src: url, alt: '' }));
      });
    }
  };

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
      },
    }, icon(c.icon), h('span', {}, c.label))));
  };

  search.addEventListener('input', () => { query = search.value; renderNav(); renderGrid(); });

  const body = h('div', { class: 'library' },
    nav,
    h('div', { class: 'lib-main' },
      h('div', { class: 'lib-head' }, title, search, iconButton('close', 'Close', () => dlg.close())),
      grid));
  dlg = openDialog({ body, wide: true });
  renderNav();
  renderGrid();
}
