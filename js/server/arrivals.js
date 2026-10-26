// זמני הגעה בזמן אמת (SIRI) לפי קוד תחנה.
// מקור נוכחי: curlbus.app (פרויקט קהילתי שעוטף את SIRI של משרד התחבורה).
// לפרודקשן: להירשם ל-SIRI של משרד התחבורה ולהחליף את המימוש של #fetchUpstream בלבד.

import { fetchWithTimeout } from './geo.js?v=1.9.2-mvprzu4a';

const CURLBUS_BASE = 'https://curlbus.app';
const USER_AGENT = 'Walkie/0.2 (pedestrian & bus navigation)';
const MAX_ARRIVALS = 80;              // בתחנה מרכזית יש עשרות אוטובוסים בשעה הקרובה – לא לחתוך את המאוחרים
const MAX_CACHE_ENTRIES = 3000;
const FAILURE_COOLDOWN_MS = 15000;   // לא להציף את המקור אחרי כישלון
const TRACKED_MAX_AGE_MS = 10 * 60 * 1000;

export const STOP_CODE_RE = /^\d{1,6}$/;

export class UpstreamError extends Error {}

function parseTime(value) {
  if (!value) return null;
  const ms = Date.parse(String(value).replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeVisit(v, now) {
  const etaMs = parseTime(v.eta);
  if (etaMs === null || etaMs < now - 60000) return null;

  const route = v.static_info?.route ?? {};
  const lat = toNumber(v.location?.lat);
  const lng = toNumber(v.location?.lon);
  const recordedMs = parseTime(v.timestamp);
  const hasVehicle = lat !== null && lng !== null;

  return {
    line: String(v.line_name ?? '').trim() || '?',
    routeId: v.route_id != null ? String(v.route_id) : null,
    tripId: v.trip_id ?? null,
    direction: v.direction_id ?? null,
    destination: route.destination?.name?.HE ?? route.destination?.name?.EN ?? null,
    destinationCity: route.destination?.address?.city_multilingual?.HE ?? null,
    agency: route.agency?.name?.HE ?? route.agency?.name?.EN ?? null,
    vehicleRef: v.vehicle_ref ?? null,
    eta: new Date(etaMs).toISOString(),
    etaMin: Math.max(0, Math.round((etaMs - now) / 60000)),
    // שעת היציאה של הנסיעה מתחנת המוצא (שעון ישראל, "HH:MM") – מזהה את הנסיעה בדיוק יחד עם routeId
    departed: /\d{2}:\d{2}/.exec(String(v.departed ?? '').slice(11))?.[0] ?? null,
    recordedAt: recordedMs !== null ? new Date(recordedMs).toISOString() : null,
    // אוטובוס שבאמת נמצא במעקב: יש מיקום, או שהתחזית עודכנה בדקות האחרונות.
    // רשומות בלי מיקום שנוצרו לפני שעות הן תחזית לפי לוח זמנים בלבד – לא "זמן אמת"
    tracked: hasVehicle || (recordedMs !== null && now - recordedMs <= TRACKED_MAX_AGE_MS),
    vehicle: hasVehicle ? { lat, lng } : null
  };
}

export class ArrivalsService {
  #cache = new Map();
  #inflight = new Map();
  #failures = new Map();

  constructor({ ttlMs = 20000 } = {}) {
    this.ttlMs = ttlMs;
  }

  async get(stopCode) {
    const code = String(stopCode);
    if (!STOP_CODE_RE.test(code)) throw new RangeError('Invalid stop code');

    const hit = this.#cache.get(code);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.data;

    if (this.#inflight.has(code)) return this.#inflight.get(code);

    const failedAt = this.#failures.get(code);
    if (failedAt && Date.now() - failedAt < FAILURE_COOLDOWN_MS) {
      throw new UpstreamError('Upstream recently failed for this stop (cooldown)');
    }

    const promise = this.#fetchUpstream(code)
      .then((data) => {
        this.#cache.set(code, { at: Date.now(), data });
        if (this.#cache.size > MAX_CACHE_ENTRIES) {
          const oldest = this.#cache.keys().next().value;
          this.#cache.delete(oldest);
        }
        this.#failures.delete(code);
        return data;
      })
      .catch((err) => {
        this.#failures.set(code, Date.now());
        if (this.#failures.size > MAX_CACHE_ENTRIES) this.#failures.clear();
        throw err;
      })
      .finally(() => this.#inflight.delete(code));

    this.#inflight.set(code, promise);
    return promise;
  }

  async #fetchUpstream(code) {
    let res;
    try {
      res = await fetchWithTimeout(
        `${CURLBUS_BASE}/${code}`,
        { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } },
        9000
      );
    } catch (err) {
      throw new UpstreamError(err.message);
    }
    if (!res.ok) throw new UpstreamError(`curlbus HTTP ${res.status}`);

    let json;
    try {
      json = await res.json();
    } catch {
      throw new UpstreamError('curlbus returned invalid JSON');
    }

    const now = Date.now();
    const errors = Array.isArray(json.errors) ? json.errors : [];
    const unknownStop = errors.some((e) => /invalid stop code/i.test(String(e)));

    const visits = json.visits?.[code] ?? [];
    const arrivals = visits
      .map((v) => normalizeVisit(v, now))
      .filter(Boolean)
      .sort((a, b) => Date.parse(a.eta) - Date.parse(b.eta))
      .slice(0, MAX_ARRIVALS);

    return {
      stopCode: code,
      source: 'siri',
      unknownStop,
      updatedAt: new Date(now).toISOString(),
      arrivals
    };
  }
}
