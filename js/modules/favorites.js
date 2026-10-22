// מועדפים: בית, מקום שני (עבודה / בית ספר), מקומות שמורים, תחנות וקווים מועדפים.
// נשמר במכשיר (localStorage). בחשבון חינמי יש מגבלה – ראו premium.js.

import { allowAdd } from './premium.js?v=1.5.0-mvjqsjqk';

// שמירה דורשת חשבון Google (auth-gate.js מגדיר את הבדיקה). מחזיר false = הפעולה בוטלה.
let saveGuard = () => true;
export function setFavoritesGuard(fn) {
  saveGuard = fn;
}
const canAdd = (kind, count) => saveGuard() && allowAdd(kind, count);

const KEY = 'walkie:favorites';

export const SECOND_LABELS = {
  work: { label: 'עבודה', emoji: '💼' },
  school: { label: 'בית ספר', emoji: '🎒' }
};

const EMPTY = { home: null, second: null, secondType: 'work', places: [], stops: [], lines: [] };

const listeners = new Set();
let data = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      ...EMPTY,
      ...saved,
      places: Array.isArray(saved.places) ? saved.places : [],
      stops: Array.isArray(saved.stops) ? saved.stops : [],
      lines: Array.isArray(saved.lines) ? saved.lines : []
    };
  } catch {
    return { ...EMPTY };
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
  for (const fn of listeners) fn(data);
}

/** רק השדות שצריך לשמור ממקום */
function slimPlace(p) {
  return {
    id: p.id ?? `pt:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`,
    name: p.name,
    subtitle: p.subtitle ?? null,
    kind: p.kind ?? 'place',
    lat: p.lat,
    lng: p.lng
  };
}

export function getFavorites() {
  return data;
}

export function onFavoritesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- בית ומקום שני ----------

export function setHome(place) {
  if (place && !saveGuard()) return;
  data = { ...data, home: place ? slimPlace(place) : null };
  save();
}

export function setSecond(place) {
  if (place && !saveGuard()) return;
  data = { ...data, second: place ? slimPlace(place) : null };
  save();
}

/** 'work' | 'school' */
export function setSecondType(type) {
  if (!SECOND_LABELS[type]) return;
  data = { ...data, secondType: type };
  save();
}

export function secondLabel() {
  return SECOND_LABELS[data.secondType] ?? SECOND_LABELS.work;
}

// ---------- מקומות ----------

export function isPlaceSaved(place) {
  return data.places.some((p) => samePlace(p, place));
}

function samePlace(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  return Math.abs(a.lat - b.lat) < 0.00015 && Math.abs(a.lng - b.lng) < 0.00015;
}

export function togglePlace(place) {
  if (isPlaceSaved(place)) {
    data = { ...data, places: data.places.filter((p) => !samePlace(p, place)) };
    save();
    return false;
  }
  if (!canAdd('places', data.places.length)) return null;
  data = { ...data, places: [slimPlace(place), ...data.places].slice(0, 30) };
  save();
  return true;
}

export function removePlace(id) {
  data = { ...data, places: data.places.filter((p) => p.id !== id) };
  save();
}

// ---------- תחנות ----------

export function isStopSaved(stop) {
  return data.stops.some((s) => s.code && s.code === stop.code);
}

export function toggleStop(stop) {
  if (!stop?.code) return false;
  if (isStopSaved(stop)) {
    data = { ...data, stops: data.stops.filter((s) => s.code !== stop.code) };
    save();
    return false;
  }
  if (!canAdd('stops', data.stops.length)) return null;
  const slim = { id: stop.id, code: stop.code, name: stop.name, lat: stop.lat, lng: stop.lng, mode: stop.mode ?? stop.primaryMode ?? 'bus' };
  data = { ...data, stops: [slim, ...data.stops].slice(0, 20) };
  save();
  return true;
}

// ---------- קווים ----------

export function isLineSaved(lineRef) {
  return data.lines.some((l) => l.lineRef === String(lineRef));
}

export function toggleLine(line) {
  if (isLineSaved(line.lineRef)) {
    data = { ...data, lines: data.lines.filter((l) => l.lineRef !== String(line.lineRef)) };
    save();
    return false;
  }
  if (!canAdd('lines', data.lines.length)) return null;
  const slim = {
    lineRef: String(line.lineRef),
    line: line.line,
    mode: line.mode,
    agency: line.agency ?? null,
    to: line.to?.name ?? line.headsign ?? null
  };
  data = { ...data, lines: [slim, ...data.lines].slice(0, 20) };
  save();
  return true;
}

// ---------- סנכרון עם חשבון Google (account.js) ----------

/** עותק לשמירה בחשבון */
export function exportFavorites() {
  return JSON.parse(JSON.stringify(data));
}

/**
 * מיזוג מועדפים מהחשבון: איחוד בלי כפילויות, המקומי קודם.
 * בית ומקום שני – המקומי אם הוגדר, אחרת מהחשבון. מגבלת החשבון החינמי לא חלה על שחזור.
 */
export function mergeFavorites(remote) {
  if (!remote || typeof remote !== 'object') return false;
  const union = (local, extra, key) => {
    const seen = new Set(local.map(key));
    return [...local, ...(Array.isArray(extra) ? extra : []).filter((x) => x && !seen.has(key(x)))];
  };
  const next = {
    ...data,
    home: data.home ?? remote.home ?? null,
    second: data.second ?? remote.second ?? null,
    secondType: data.second ? data.secondType : remote.secondType ?? data.secondType,
    places: union(data.places, remote.places, (p) => p.id ?? `${p.lat},${p.lng}`).slice(0, 30),
    stops: union(data.stops, remote.stops, (s) => s.code).slice(0, 20),
    lines: union(data.lines, remote.lines, (l) => String(l.lineRef)).slice(0, 20)
  };
  const changed = JSON.stringify(next) !== JSON.stringify(data);
  if (changed) {
    data = next;
    save();
  }
  return changed;
}
