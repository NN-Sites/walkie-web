// חנות ההטבות: כל הטבה נפתחת בצפייה בפרסומת ותקפה לזמן קצוב (נשמר במכשיר).
// ההטבות: בלי באנרים, צבע נקודה ומפה, תג תומך, מכסת מועדפים, היסטוריית נסיעות, לוגו.

const KEY = 'walkie:perks';
const PREFS_KEY = 'walkie:perkPrefs';
const H = 3600 * 1000;
const D = 24 * H;
const FOREVER = Number.MAX_SAFE_INTEGER;

export const FREE_FAVS = 3;   // מועדפים לכל סוג (מקומות / תחנות / קווים) בלי הטבה
export const PERK_FAVS = 10;

export const PERKS = {
  noAds: { icon: '🚫', title: 'בלי באנרים', desc: 'הבאנר בתחתית המסך נעלם', duration: '12 שעות', ms: 12 * H },
  colors: { icon: '🎨', title: 'צבע נקודת המיקום והמפה', desc: 'בוחרים צבע לנקודה שלך ולמפה כולה', duration: 'שבוע', ms: 7 * D },
  badge: { icon: '💚', title: 'תג תומך Walkie', desc: 'תג ליד השם שלך בהגדרות ובתודות', duration: 'שבוע', ms: 7 * D },
  favs: { icon: '⭐', title: 'עד 10 מועדפים', desc: `במקום ${FREE_FAVS}: 10 מקומות, 10 תחנות ו-10 קווים שמורים`, duration: 'חודש', ms: 30 * D },
  history: { icon: '🕘', title: 'היסטוריית נסיעות', desc: 'כל ההליכות והנסיעות האחרונות שלך, עם סיכום', duration: 'שבוע', ms: 7 * D },
  logo: { icon: '📱', title: 'החלפת לוגו האפליקציה', desc: '15 לוגואים לבחירה (באפליקציית האנדרואיד)', duration: 'לתמיד', ms: FOREVER }
};

export const DOT_COLORS = ['#2563eb', '#16a34a', '#e11d48', '#9333ea', '#f97316', '#0891b2', '#111827'];
// מסנני צבע למפה (המפה הבסיסית כמעט אפורה, לכן sepia ואז hue-rotate; ראו store.css)
export const MAP_TINTS = [
  { id: 'none', label: 'רגיל', swatch: '#e5e7eb' },
  { id: 'ocean', label: 'ים', swatch: '#7dd3fc' },
  { id: 'mint', label: 'מנטה', swatch: '#86efac' },
  { id: 'rose', label: 'ורוד', swatch: '#fda4af' },
  { id: 'violet', label: 'סגול', swatch: '#c4b5fd' },
  { id: 'sand', label: 'חול', swatch: '#fde68a' },
  { id: 'night', label: 'לילה', swatch: '#334155' }
];

const listeners = new Set();
export const onPerksChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = () => listeners.forEach((fn) => fn());

const readJson = (key) => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
};

export const perkUntil = (id) => Number(readJson(KEY)[id]) || 0;
export const perkLeftMs = (id) => Math.max(0, perkUntil(id) - Date.now());
export const perkActive = (id) => perkLeftMs(id) > 0;

export function grantPerk(id) {
  const perk = PERKS[id];
  if (!perk) return;
  writeJson(KEY, { ...readJson(KEY), [id]: perk.ms === FOREVER ? FOREVER : Date.now() + perk.ms });
  applyPerks();
  emit();
}

/** כמה זמן נשאר להטבה: { key, n } לתרגום, או null להטבה קבועה */
export function leftText(ms) {
  if (ms >= FOREVER / 2) return null;
  if (ms >= D) return { key: '{n} ימים', n: Math.ceil(ms / D) };
  if (ms >= H) return { key: '{n} שעות', n: Math.ceil(ms / H) };
  return { key: '{n} דק\'', n: Math.max(1, Math.ceil(ms / 60000)) };
}

export const getPrefs = () => ({ dot: DOT_COLORS[0], map: 'none', icon: 'default', ...readJson(PREFS_KEY) });
export function setPrefs(patch) {
  writeJson(PREFS_KEY, { ...getPrefs(), ...patch });
  applyPerks();
  emit();
}

export const favLimit = () => (perkActive('favs') ? PERK_FAVS : FREE_FAVS);

/** מחיל צבע נקודה וצבע מפה (רק בזמן שההטבה פעילה) */
export function applyPerks() {
  const root = document.documentElement;
  const { dot, map } = getPrefs();
  const on = perkActive('colors');
  if (on && dot !== DOT_COLORS[0]) root.style.setProperty('--user', dot);
  else root.style.removeProperty('--user');
  if (on && map !== 'none') root.dataset.mapTint = map;
  else delete root.dataset.mapTint;
}

// מרעננים כשהטבה פגה (גם אם האפליקציה נשארת פתוחה)
let expiryTimer = null;
function scheduleExpiry() {
  clearTimeout(expiryTimer);
  const now = Date.now();
  const next = Math.min(...Object.values(readJson(KEY)).map(Number).filter((u) => u > now && u < FOREVER), Infinity);
  if (next === Infinity) return;
  expiryTimer = setTimeout(() => {
    applyPerks();
    emit();
  }, Math.min(next - now + 500, 2 ** 31 - 1));
}
onPerksChange(scheduleExpiry);
applyPerks();
scheduleExpiry();
