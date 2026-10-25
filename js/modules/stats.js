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

export function recordWalk(meters) {
  const s = getStats();
  saveStats({ ...s, walks: s.walks + 1, walkMeters: s.walkMeters + Math.max(0, Math.round(meters || 0)), since: s.since ?? new Date().toISOString() });
}

export function recordTrip() {
  const s = getStats();
  saveStats({ ...s, trips: s.trips + 1, since: s.since ?? new Date().toISOString() });
}

/** CO₂ שנחסך לעומת נסיעה ברכב פרטי (~170 גרם לק"מ) – הערכה גסה להליכה בלבד */
export function co2SavedKg(stats = getStats()) {
  return (stats.walkMeters / 1000) * 0.17;
}
