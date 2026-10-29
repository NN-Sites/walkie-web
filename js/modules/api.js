// לקוח ה-API של Walkie + fetch עם Timeout.

import {
  API_BASE,
  API_NEARBY_TIMEOUT_MS,
  API_ARRIVALS_TIMEOUT_MS,
  API_SEARCH_TIMEOUT_MS,
  API_ROUTE_TIMEOUT_MS,
  MAX_STOPS
} from '../config.js?v=1.10.0-mvu2228r';
import { getSettings, transitPrefsParams } from './settings.js?v=1.10.0-mvu2228r';
import { LANG } from './i18n.js?v=1.10.0-mvu2228r';

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

/**
 * fetch עם Timeout פנימי + תמיכה ב-signal חיצוני.
 * ביטול חיצוני -> AbortError (מתעלמים ממנו). Timeout -> ApiError רגילה (מפעילה fallback).
 */
export async function fetchWithTimeout(url, options = {}, { timeoutMs = 10000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuterAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (err?.name === 'AbortError') throw new ApiError(`Timeout: ${url}`);
    throw new ApiError(err?.message || 'Network error');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

// באפליקציה (Capacitor) ה-API רץ בתוך האפליקציה עצמה – ראו local-api.js
const LOCAL_API = !!globalThis.WALKIE_CONFIG?.localApi;
let localApi = null;

async function getLocalJson(path, { timeoutMs, signal }) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  localApi ??= import('../local-api.js?v=1.10.0-mvu2228r');
  const { request } = await localApi;

  let timer;
  let onAbort;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(`Timeout: ${path}`)), timeoutMs);
    onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const { status, body } = await Promise.race([request(path), guard]);
    if (status < 200 || status >= 300) throw new ApiError(`API ${status} for ${path}`, status);
    return body;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function getJson(path, { timeoutMs, signal }) {
  if (LOCAL_API) return getLocalJson(path, { timeoutMs, signal });
  const res = await fetchWithTimeout(
    `${API_BASE}${path}`,
    { headers: { Accept: 'application/json' } },
    { timeoutMs, signal }
  );
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('application/json')) {
    throw new ApiError(`API ${res.status} for ${path}`, res.status);
  }
  return res.json();
}

export function fetchNearbyFromApi({ lat, lng }, radius, signal) {
  const qs = `lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&radius=${Math.round(radius)}&limit=${MAX_STOPS}`;
  return getJson(`/stops/nearby?${qs}`, { timeoutMs: API_NEARBY_TIMEOUT_MS, signal });
}

export function fetchArrivals(stopCode, signal) {
  return getJson(`/stops/${encodeURIComponent(stopCode)}/arrivals`, {
    timeoutMs: API_ARRIVALS_TIMEOUT_MS,
    signal
  });
}

/** חיפוש טקסט, או קטגוריה מפורשת (category = 'restaurant' וכו') סביב near */
export function fetchSearch(query, near, signal, { category = null } = {}) {
  const params = new URLSearchParams({ q: query ?? '' });
  if (category) params.set('category', category);
  if (near) {
    params.set('lat', near.lat.toFixed(4));
    params.set('lng', near.lng.toFixed(4));
  }
  return getJson(`/search?${params}`, { timeoutMs: API_SEARCH_TIMEOUT_MS, signal });
}

/**
 * תכנון נסיעה בתחבורה ציבורית.
 * when = { type: 'depart' | 'arrive', time: Date | null }  (null = עכשיו)
 */
export function fetchTransitPlan(from, to, when = {}, cursor = null, signal) {
  const params = new URLSearchParams({
    from: `${from.lat.toFixed(6)},${from.lng.toFixed(6)}`,
    to: `${to.lat.toFixed(6)},${to.lng.toFixed(6)}`
  });
  if (when.time) params.set('time', when.time.toISOString());
  if (when.type === 'arrive') params.set('arriveBy', '1');
  if (cursor) params.set('cursor', cursor);
  // העדפות מההגדרות: אמצעי תחבורה, הליכה מקסימלית, נגישות
  for (const [k, v] of Object.entries(transitPrefsParams())) params.set(k, v);
  return getJson(`/route/transit?${params}`, { timeoutMs: API_ROUTE_TIMEOUT_MS, signal });
}

// ---------- תחנות וקווים ----------

const nearParams = (near) => (near ? `lat=${near.lat.toFixed(5)}&lng=${near.lng.toFixed(5)}` : '');

/** mode: all | bus | rail | lightrail */
export function fetchStationsNearby(near, mode = 'all', signal) {
  return getJson(`/stations/nearby?${nearParams(near)}&mode=${mode}`, { timeoutMs: API_ROUTE_TIMEOUT_MS, signal });
}

/** חיפוש תחנה בכל הארץ לפי שם, עיר או קוד */
export function fetchStationsSearch(query, near, signal) {
  return getJson(`/stations/search?q=${encodeURIComponent(query)}&${nearParams(near)}`, { timeoutMs: API_ROUTE_TIMEOUT_MS, signal });
}

/** תחנה מלאה (סוגי תחבורה + רציפים) לפי קוד ומיקום */
export function fetchStationByCode(code, point, signal) {
  return getJson(`/stations/by-code?code=${encodeURIComponent(code)}&${nearParams(point)}`, { timeoutMs: API_ROUTE_TIMEOUT_MS, signal });
}

/** לוח יציאות: לפי מזהי תחנה (stopIds) או לפי קוד + מיקום (תחנות מסך הבית) */
export function fetchDepartures({ stopIds = null, code = null, near = null }, signal) {
  const params = new URLSearchParams();
  if (stopIds?.length) params.set('stopIds', stopIds.join(','));
  if (code) params.set('code', code);
  if (near) {
    params.set('lat', near.lat.toFixed(5));
    params.set('lng', near.lng.toFixed(5));
  }
  return getJson(`/stations/departures?${params}`, { timeoutMs: API_ROUTE_TIMEOUT_MS, signal });
}

export function fetchLinesSearch(query, near, signal) {
  return getJson(`/lines/search?q=${encodeURIComponent(query)}&${nearParams(near)}`, { timeoutMs: API_ROUTE_TIMEOUT_MS, signal });
}

export function fetchLinesNearby(near, signal) {
  return getJson(`/lines/nearby?${nearParams(near)}`, { timeoutMs: API_ROUTE_TIMEOUT_MS, signal });
}

export function fetchLineDetails(lineRef, near, signal) {
  return getJson(`/lines/${encodeURIComponent(lineRef)}?${nearParams(near)}`, { timeoutMs: API_ROUTE_TIMEOUT_MS, signal });
}

/** זמן אמת לרגל תחבורה ציבורית (האוטובוס הספציפי של הנסיעה) */
export function fetchTransitLive(leg, signal) {
  const params = new URLSearchParams({
    stop: leg.from.code,
    scheduled: leg.scheduledStart,
    line: leg.line ?? ''
  });
  if (leg.tripId) params.set('trip', leg.tripId);
  if (leg.routeId) params.set('route', leg.routeId);
  if (leg.tripStart) params.set('start', leg.tripStart);
  return getJson(`/transit/live?${params}`, { timeoutMs: API_ARRIVALS_TIMEOUT_MS, signal });
}

/** מסלול הליכה. זורק ApiError עם status (404 = אין מסלול, 422 = רחוק/קרוב מדי) */
export function fetchWalkRoute(from, to, signal) {
  const f = `${from.lat.toFixed(6)},${from.lng.toFixed(6)}`;
  const t = `${to.lat.toFixed(6)},${to.lng.toFixed(6)}`;
  const speed = getSettings().walkSpeed;
  // lang – שפת הוראות ההליכה ("פנו ימינה" / "Turn right")
  return getJson(`/route/walk?from=${f}&to=${t}&speed=${speed}&lang=${LANG === 'he' ? 'he' : 'en'}`, { timeoutMs: API_ROUTE_TIMEOUT_MS, signal });
}
