/*
 * Native platform bridge. Uses Capacitor plugins when running inside the
 * Android / iOS app shell and falls back to browser APIs during development.
 */

const cap = () => window.Capacitor;
export const isNative = () => !!cap()?.isNativePlatform?.();
const plugin = (name) => cap()?.Plugins?.[name];

const PROJECT_DIR = 'projects';
const LS_PROJECTS = 'mw.projects';
const LS_AUTOSAVE = 'mw.autosave';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function safeName(name) {
  return (name || 'Untitled').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'Untitled';
}

/* ---------- Exported files (images, video, project files) ---------- */

export async function saveExport(blob, filename, title = 'Export') {
  if (isNative()) {
    const fs = plugin('Filesystem');
    const share = plugin('Share');
    const data = await blobToBase64(blob);
    const res = await fs.writeFile({ path: filename, data, directory: 'CACHE' });
    if (share) {
      try {
        await share.share({ title, files: [res.uri], dialogTitle: title });
      } catch (e) {
        if (!/cancel/i.test(String(e?.message || e))) throw e;
      }
    }
    return res.uri;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return filename;
}

/*
 * Downloads a URL and resolves with a Blob. In the app the download runs
 * natively (no CORS limits) into the cache, then is read back through the
 * WebView's local file URL so large files never cross the JS bridge as base64.
 */
export async function download(url, onProgress) {
  if (isNative()) {
    const fs = plugin('Filesystem');
    const path = 'download-' + Date.now();
    let handle = null;
    if (onProgress) {
      handle = await fs.addListener('progress', (p) => {
        if (p.url === url && p.contentLength > 0) onProgress(p.bytes / p.contentLength);
      });
    }
    try {
      const res = await fs.downloadFile({ url, path, directory: 'CACHE', progress: !!onProgress });
      const local = await fetch(cap().convertFileSrc(res.path));
      if (!local.ok) throw new Error('Could not read the downloaded file.');
      return await local.blob();
    } finally {
      handle?.remove?.();
      fs.deleteFile({ path, directory: 'CACHE' }).catch(() => {});
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!onProgress || !total || !res.body) return res.blob();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got / total);
  }
  return new Blob(chunks);
}

/* Opens the system file chooser and resolves with a File (or null). */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.getElementById('filePicker');
    input.value = '';
    input.accept = accept;
    const done = () => { input.removeEventListener('change', onChange); resolve(input.files?.[0] || null); };
    const onChange = () => done();
    input.addEventListener('change', onChange);
    input.click();
  });
}

/* ---------- Project library (app-private storage) ---------- */

function lsProjects() {
  try { return JSON.parse(localStorage.getItem(LS_PROJECTS) || '{}'); } catch { return {}; }
}

export async function listProjects() {
  if (isNative()) {
    const fs = plugin('Filesystem');
    try {
      const res = await fs.readdir({ path: PROJECT_DIR, directory: 'DATA' });
      return res.files
        .filter((f) => (f.name || f).endsWith('.mwproj'))
        .map((f) => ({ name: (f.name || f).replace(/\.mwproj$/, ''), mtime: Number(f.mtime) || 0 }))
        .sort((a, b) => b.mtime - a.mtime);
    } catch {
      return [];
    }
  }
  return Object.entries(lsProjects()).map(([name, p]) => ({ name, mtime: p.mtime })).sort((a, b) => b.mtime - a.mtime);
}

export async function saveProject(name, text) {
  name = safeName(name);
  if (isNative()) {
    await plugin('Filesystem').writeFile({ path: `${PROJECT_DIR}/${name}.mwproj`, data: text, directory: 'DATA', encoding: 'utf8', recursive: true });
    return name;
  }
  const all = lsProjects();
  all[name] = { text, mtime: Date.now() };
  localStorage.setItem(LS_PROJECTS, JSON.stringify(all));
  return name;
}

export async function loadProject(name) {
  if (isNative()) {
    const res = await plugin('Filesystem').readFile({ path: `${PROJECT_DIR}/${safeName(name)}.mwproj`, directory: 'DATA', encoding: 'utf8' });
    return res.data;
  }
  return lsProjects()[name]?.text ?? null;
}

export async function deleteProject(name) {
  if (isNative()) {
    await plugin('Filesystem').deleteFile({ path: `${PROJECT_DIR}/${safeName(name)}.mwproj`, directory: 'DATA' });
    return;
  }
  const all = lsProjects();
  delete all[name];
  localStorage.setItem(LS_PROJECTS, JSON.stringify(all));
}

/* ---------- Autosave ---------- */

export function writeAutosave(text) {
  try { localStorage.setItem(LS_AUTOSAVE, text); } catch { /* quota exceeded */ }
}

export function readAutosave() {
  try { return localStorage.getItem(LS_AUTOSAVE); } catch { return null; }
}

/* ---------- System chrome ---------- */

export function initNativeChrome({ onBack }) {
  if (!isNative()) return;
  const sb = plugin('StatusBar');
  if (sb) {
    sb.setStyle?.({ style: 'DARK' }).catch(() => {});
  }
  const app = plugin('App');
  if (app) app.addListener('backButton', () => onBack());
}

export function minimizeApp() {
  plugin('App')?.minimizeApp?.().catch(() => {});
}
