// מצב לילה: לפי ההגדרה (בהיר / כהה / לפי המכשיר).
// הערך הראשוני נקבע כבר ב-index.html (בלי הבהוב לבן בפתיחה). כאן – עדכון כשההגדרה או מצב המכשיר משתנים.

import { getSettings, onSettingsChange } from './settings.js?v=1.10.0-mvsdq7td';

const media = window.matchMedia('(prefers-color-scheme: dark)');
const COLORS = { light: '#ffffff', dark: '#141b25' };

export function resolvedTheme(setting = getSettings().theme) {
  if (setting === 'dark' || setting === 'light') return setting;
  return media.matches ? 'dark' : 'light';
}

function apply({ animate = true } = {}) {
  const root = document.documentElement;
  const theme = resolvedTheme();
  if (root.dataset.theme === theme) return;
  if (animate) {
    root.classList.add('theme-anim');
    setTimeout(() => root.classList.remove('theme-anim'), 400);
  }
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[theme]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  // שורת המצב של אנדרואיד (אם התוסף זמין)
  globalThis.Capacitor?.Plugins?.StatusBar?.setStyle?.({ style: theme === 'dark' ? 'DARK' : 'LIGHT' }).catch?.(() => {});
}

export function initTheme() {
  apply({ animate: false });
  media.addEventListener('change', () => apply());
  onSettingsChange(() => apply());
}
