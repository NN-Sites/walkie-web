// סטטיסטיקה אישית: הליכות ונסיעות שהושלמו (נשמר במכשיר, ונשלח לדף הניהול כמספרים מצטברים).

const STATS_KEY = 'walkie:stats';

const EMPTY_STATS = { walks: 0, walkMeters: 0, trips: 0, since: null };

export function getStats() {
  try {
    return { ...EMPTY_STATS, ...JSON.parse(localStorage.getItem(STATS_KEY) || '{}') };
  } catch {
    return { ...EMPTY_STATS };
  }
}

function saveStats(s) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function recordWalk(meters, dest = null) {
  const s = getStats();
  saveStats({ ...s, walks: s.walks + 1, walkMeters: s.walkMeters + Math.max(0, Math.round(meters || 0)), since: s.since ?? new Date().toISOString() });
  addHistory({ kind: 'walk', dest, meters: Math.round(meters || 0) });
}

export function recordTrip(dest = null) {
  const s = getStats();
  saveStats({ ...s, trips: s.trips + 1, since: s.since ?? new Date().toISOString() });
  addHistory({ kind: 'transit', dest });
}

// ---------- היסטוריית נסיעות (נשמרת תמיד במכשיר; ההצגה שלה היא הטבה בחנות) ----------

const HISTORY_KEY = 'walkie:history';
const HISTORY_MAX = 100;

export function getHistory() {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function addHistory(entry) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([{ at: Date.now(), ...entry }, ...getHistory()].slice(0, HISTORY_MAX)));
  } catch {
    // ignore
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}

/** CO₂ שנחסך לעומת נסיעה ברכב פרטי (~170 גרם לק"מ) – הערכה גסה להליכה בלבד */
export function co2SavedKg(stats = getStats()) {
  return (stats.walkMeters / 1000) * 0.17;
}
