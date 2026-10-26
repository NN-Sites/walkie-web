// הגדרות משתמש: נשמרות במכשיר (localStorage), משפיעות על תכנון המסלולים ועל התצוגה.

import { STORAGE_KEYS } from '../config.js?v=1.8.0-mvpj3lro';

const KEY = 'walkie:settings';

export const DEFAULT_SETTINGS = Object.freeze({
  modes: { bus: true, rail: true, lightrail: true },  // אמצעי תחבורה בתכנון מסלול
  maxWalkMin: 30,                                     // הליכה מקסימלית לתחנה/מתחנה
  walkSpeed: 'normal',                                // slow | normal | fast
  wheelchair: false,                                  // מסלולים נגישים
  vibrate: true,                                      // רטט לפני פנייה / ירידה
  showStops: true,                                    // סמני תחנות במפה (מסך הבית)
  showBuses: true,                                    // אוטובוסים בזמן אמת על המפה
  shareBusPosition: true,                             // לדייק מיקום אוטובוס: אם אני נוסע על מסלול קו במהירות אוטובוס, מיקומי משמש אחרים
  analytics: true,                                    // נתוני שימוש אנונימיים לשיפור האפליקציה
  theme: 'system',                                 // system | light | dark
  lang: null                                          // he | en | null = עברית
});

const listeners = new Set();
let current = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // ברירת המחדל הישנה (15 דק') נשמרה אצל מי שלא בחר בעצמו – מעבירים אותו לברירת המחדל החדשה
    if (saved.maxWalkMin === 15 && !saved.walkChosen) delete saved.maxWalkMin;
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      modes: { ...DEFAULT_SETTINGS.modes, ...(saved.modes ?? {}) }
    };
  } catch {
    return { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes } };
  }
}

export function getSettings() {
  return current;
}

export function updateSettings(patch) {
  current = {
    ...current,
    ...patch,
    ...(patch.maxWalkMin !== undefined ? { walkChosen: true } : {}),
    modes: { ...current.modes, ...(patch.modes ?? {}) }
  };
  // לפחות אמצעי תחבורה אחד חייב להישאר פעיל
  if (!Object.values(current.modes).some(Boolean)) current.modes = { ...current.modes, bus: true };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
  for (const fn of listeners) fn(current);
  return current;
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** פרמטרים לתכנון נסיעה לפי ההגדרות */
export function transitPrefsParams() {
  const s = current;
  const params = {};
  const modes = Object.entries(s.modes).filter(([, on]) => on).map(([m]) => m);
  if (modes.length < 3) params.modes = modes.join(',');
  if (s.maxWalkMin) params.maxWalk = String(s.maxWalkMin);
  if (s.wheelchair) params.wheelchair = '1';
  return params;
}

export function vibrate(pattern) {
  if (current.vibrate) navigator.vibrate?.(pattern);
}

/** ניקוי נתונים שמורים במכשיר (חיפושים אחרונים, קאש תחנות) */
export function clearLocalData() {
  try {
    localStorage.removeItem(STORAGE_KEYS.recentSearches);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(STORAGE_KEYS.stopsPrefix)) localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}
