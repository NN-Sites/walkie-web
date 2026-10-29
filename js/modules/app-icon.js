// החלפת לוגו האפליקציה (הטבה בחנות). עובד רק באפליקציית האנדרואיד (activity-alias + AppIconPlugin.java).
// התצוגות המקדימות נוצרות ב-scripts/app-icons.mjs אל icons/app/. להוספת לוגו: הסקריפט + alias ב-AndroidManifest.xml + ALIASES ב-AppIconPlugin.java + כאן.

import { t } from './i18n.js?v=1.10.0-mvu2khrx';
import { getPrefs, setPrefs } from './rewards.js?v=1.10.0-mvu2khrx';

export const APP_ICONS = [
  { id: 'default', label: 'ברירת מחדל' },
  { id: 'midnight', label: 'חצות' },
  { id: 'sunset', label: 'שקיעה' },
  { id: 'violet', label: 'סגול' },
  { id: 'ocean', label: 'אוקיינוס' },
  { id: 'gold', label: 'זהב' },
  { id: 'mint', label: 'מנטה' },
  { id: 'forest', label: 'יער' },
  { id: 'neon', label: 'ניאון' },
  { id: 'pin', label: 'סיכה' },
  { id: 'bus', label: 'אוטובוס' },
  { id: 'steps', label: 'צעדים' },
  { id: 'compass', label: 'מצפן' },
  { id: 'retro', label: 'רטרו' },
  { id: 'pixel', label: 'פיקסלים' }
];

export const appIconSupported = () =>
  !!globalThis.Capacitor?.isNativePlatform?.() && globalThis.Capacitor?.getPlatform?.() === 'android' && !!globalThis.Capacitor?.Plugins?.AppIcon;

export const currentAppIcon = () => getPrefs().icon;

export async function setAppIcon(id) {
  if (!APP_ICONS.some((x) => x.id === id)) return;
  await globalThis.Capacitor.Plugins.AppIcon.set({ id });
  setPrefs({ icon: id });
}

export const appIconLabel = (id) => t(APP_ICONS.find((x) => x.id === id)?.label || '');
