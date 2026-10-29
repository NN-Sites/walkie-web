// קישורים שנפתחים באפליקציה (אנדרואיד): walkie://t/<מזהה> מדף השיתוף באתר הרשמי.
// פותח את הנסיעה המשותפת בתוך האפליקציה (public/live/ בתוך מסגרת), בלי לצאת לדפדפן.

import { t } from './i18n.js?v=1.10.0-mvu1kw0g';

const ID_RE = /^[a-z0-9]{8,40}$/i;

/** מזהה שיתוף מכתובת: walkie://t/ID, .../t/?id=ID או .../t/ID. null אם זו לא כתובת שיתוף */
export function shareIdFromUrl(url) {
  try {
    const u = new URL(url);
    const fromPath = /\/t\/([a-z0-9]+)\/?$/i.exec(u.pathname)?.[1] ?? (u.protocol === 'walkie:' ? u.pathname.replace(/^\/+/, '') : null);
    const id = u.searchParams.get('id') || fromPath;
    return id && ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

let viewer = null;

export function closeLiveViewer() {
  if (!viewer) return false;
  viewer.remove();
  viewer = null;
  return true;
}

export const isLiveViewerOpen = () => !!viewer;

export function openLiveViewer(id) {
  closeLiveViewer();
  viewer = document.createElement('div');
  viewer.className = 'live-viewer';
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-modal', 'true');
  viewer.innerHTML = `
    <iframe src="live/index.html?embed=1&s=${encodeURIComponent(id)}" title="${t('נסיעה משותפת')}"></iframe>
    <button class="live-viewer-close" type="button" aria-label="${t('סגירה')}">✕</button>`;
  viewer.querySelector('button').addEventListener('click', closeLiveViewer);
  document.body.appendChild(viewer);
}

export function initDeepLinks() {
  const App = globalThis.Capacitor?.Plugins?.App;
  if (!App) return;
  const handle = (url) => {
    const id = url ? shareIdFromUrl(url) : null;
    if (id) openLiveViewer(id);
  };
  App.addListener('appUrlOpen', (e) => handle(e?.url));
  App.getLaunchUrl?.().then((r) => handle(r?.url)).catch(() => {});
}

const style = document.createElement('style');
style.textContent = `
.live-viewer { position: fixed; inset: 0; z-index: 9500; background: #0e141b; }
.live-viewer iframe { width: 100%; height: 100%; border: 0; display: block; }
.live-viewer-close { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 10px); inset-inline-end: 12px; z-index: 2;
  width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(11,19,36,.72); color: #fff; font-size: 18px; }
`;
document.head.appendChild(style);
