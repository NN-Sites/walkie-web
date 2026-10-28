// החלפת אייקון האפליקציה (פרס הזמנת חברים). עובד רק באפליקציית האנדרואיד (activity-alias + AppIconPlugin.java).
// התצוגות המקדימות נוצרות ב-scripts/app-icons.mjs אל icons/app/.

import { t } from './i18n.js?v=1.10.0-mvsf7kai';

export const APP_ICONS = [
  { id: 'default', label: 'ברירת מחדל' },
  { id: 'midnight', label: 'חצות' },
  { id: 'sunset', label: 'שקיעה' },
  { id: 'violet', label: 'סגול' },
  { id: 'ocean', label: 'אוקיינוס' },
  { id: 'gold', label: 'זהב' },
  { id: 'mint', label: 'מנטה' },
  { id: 'forest', label: 'יער' }
];

const KEY = 'walkie:appIcon';

export const appIconSupported = () =>
  !!globalThis.Capacitor?.isNativePlatform?.() && globalThis.Capacitor?.getPlatform?.() === 'android' && !!globalThis.Capacitor?.Plugins?.AppIcon;

export function currentAppIcon() {
  try { return localStorage.getItem(KEY) || 'default'; } catch { return 'default'; }
}

export async function setAppIcon(id) {
  if (!APP_ICONS.some((x) => x.id === id)) throw new Error('unknown icon');
  await globalThis.Capacitor.Plugins.AppIcon.set({ id });
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
}

export const appIconLabel = (id) => t(APP_ICONS.find((x) => x.id === id)?.label || '');
