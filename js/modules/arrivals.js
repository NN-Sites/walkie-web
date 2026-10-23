// זמני הגעה בצד הלקוח: קאש קצר לכל תחנה, ביטול בקשות ישנות, וקיבוץ לפי קו.

import { ARRIVALS_CLIENT_TTL_MS, ARRIVALS_GROUP_LIMIT, ARRIVALS_MAX_AHEAD_MIN, ARRIVAL_GONE_MS } from '../config.js?v=1.5.0-mvkr2mw5';
import { fetchArrivals, fetchDepartures } from './api.js?v=1.5.0-mvkr2mw5';
import { demoArrivals, lineColor } from './stops.js?v=1.5.0-mvkr2mw5';
import { t } from './i18n.js?v=1.5.0-mvkr2mw5';
import { trackPerf } from './analytics.js?v=1.5.0-mvkr2mw5';

/**
 * מצב לכל תחנה:
 *   { status: 'idle' | 'loading' | 'ok' | 'error' | 'unsupported',
 *     arrivals: Array | null, live: boolean, demo: boolean, fetchedAt: number }
 */
export class ArrivalsStore {
  #entries = new Map();
  #controller = null;

  constructor(onChange) {
    this.onChange = onChange;
  }

  get(stop) {
    if (!stop) return null;
    if (stop.isDemo) {
      return { status: 'ok', arrivals: demoArrivals(stop), live: false, demo: true, fetchedAt: Date.now() };
    }
    if (!stop.code) return { status: 'unsupported', arrivals: null, live: false, demo: false };
    return this.#entries.get(stop.id) ?? { status: 'idle', arrivals: null, live: false, demo: false };
  }

  #load(stop, signal) {
    return loadDepartures(stop, signal);
  }

  async refresh(stop, { force = false } = {}) {
    if (!stop || stop.isDemo || !stop.code) return;

    const prev = this.#entries.get(stop.id);
    if (prev?.status === 'loading') return;
    if (!force && prev?.fetchedAt && Date.now() - prev.fetchedAt < ARRIVALS_CLIENT_TTL_MS) return;

    // רק תחנה אחת מוצגת בכל רגע – מבטלים בקשה קודמת
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;

    this.#entries.set(stop.id, {
      status: 'loading',
      arrivals: prev?.arrivals ?? null,
      live: prev?.live ?? false,
      demo: false,
      fetchedAt: prev?.fetchedAt ?? 0
    });
    this.onChange(stop.id);

    const startedAt = performance.now();
    try {
      const { arrivals, live } = await this.#load(stop, controller.signal);
      trackPerf('arrivals', performance.now() - startedAt);
      this.#entries.set(stop.id, {
        status: 'ok',
        arrivals,
        live,
        demo: false,
        fetchedAt: Date.now()
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        if (prev) this.#entries.set(stop.id, prev);
        else this.#entries.delete(stop.id);
        return;
      }
      this.#entries.set(stop.id, {
        status: 'error',
        arrivals: prev?.arrivals ?? null,
        live: false,
        demo: false,
        fetchedAt: Date.now()
      });
    } finally {
      if (this.#controller === controller) this.#controller = null;
    }

    this.onChange(stop.id);
  }
}

/**
 * לוח יציאות מלא (אוטובוס + רכבת + רכבת קלה, לוח זמנים + זמן אמת לאוטובוסים).
 * אם השירות לא זמין – גיבוי לזמן אמת בלבד (SIRI, אוטובוסים).
 */
export async function loadDepartures(stop, signal) {
  try {
    const data = await fetchDepartures({ code: stop.code, near: stop }, signal);
    if (!data.unknownStop) {
      const arrivals = (data.departures ?? []).map((d) => ({
        line: d.line,
        mode: d.mode,
        trainNumber: d.trainNumber,
        destination: d.headsign,
        agency: d.agency,
        eta: d.eta,
        live: !!d.live,
        tripId: d.tripId ?? null,
        color: d.color ?? null,
        vehicle: d.live?.vehicle ?? null,
        recordedAt: d.live?.recordedAt ?? null
      }));
      return { arrivals, live: arrivals.some((a) => a.live) };
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
  }
  const siri = await fetchArrivals(stop.code, signal);
  return {
    arrivals: (siri.arrivals ?? []).map((a) => ({ ...a, mode: 'bus', live: a.tracked !== false, tripId: a.vehicleRef ?? a.tripId })),
    live: (siri.arrivals ?? []).some((a) => a.tracked !== false)
  };
}

/** צבע קו בלוח היציאות ועל המפה: רכבת / רכבת קלה לפי סוג, אוטובוס לפי מספר הקו */
export function arrivalColor(a) {
  if (a.mode === 'rail') return '#1e3a8a';
  if (a.mode === 'lightrail') return '#dc2626';
  return lineColor(a.line, a.agency);
}

/** טקסט לחיצה על אוטובוס במפה: "קו 82 לכיוון … · מגיע בעוד 6 דק' · מיקום מלפני דקה" */
export function vehicleSummary(v, now = Date.now()) {
  const parts = [v.destination ? t('קו {line} לכיוון {dest}', { line: v.line, dest: v.destination }) : t('קו {line}', { line: v.line })];
  if (Number.isFinite(v.etaMin)) parts.push(v.etaMin <= 0 ? t('מגיע עכשיו') : t('מגיע בעוד {n} דק\'', { n: v.etaMin }));
  if (v.recordedAt) {
    const sec = Math.max(0, Math.round((now - Date.parse(v.recordedAt)) / 1000));
    parts.push(sec < 60 ? t('מיקום מלפני {n} שנ\'', { n: sec }) : t('מיקום מלפני {n} דק\'', { n: Math.round(sec / 60) }));
  }
  if (v.gps) parts.push(v.gps === 'ok' ? t('GPS מאומת 🟢') : t('GPS חלקי 🟡'));
  return parts.join(' · ');
}

const VEHICLE_MAX_AHEAD_MIN = 45;
const VEHICLE_MAX_AGE_MS = 5 * 60 * 1000;   // מיקום ישן יותר כבר לא משקף איפה האוטובוס
const MAX_VEHICLES = 14;

/**
 * אוטובוסים בדרך לתחנה, עם מיקום GPS עדכני – לשכבת האוטובוסים על המפה.
 * colorOf(arrival) – צבע הקו (כמו בלוח היציאות).
 * stop – התחנה שהאוטובוסים בדרך אליה: בין עדכון לעדכון הם מתקדמים לכיוונה לפי זמן ההגעה.
 */
export function vehiclesFromArrivals(arrivals, colorOf, { stop = null, now = Date.now() } = {}) {
  const seen = new Set();
  const out = [];
  for (const a of arrivals ?? []) {
    const v = a.vehicle;
    if (!v || !Number.isFinite(v.lat)) continue;
    const etaMs = Date.parse(a.eta);
    if (!Number.isFinite(etaMs) || etaMs < now - ARRIVAL_GONE_MS || etaMs > now + VEHICLE_MAX_AHEAD_MIN * 60000) continue;
    if (a.recordedAt && now - Date.parse(a.recordedAt) > VEHICLE_MAX_AGE_MS) continue;
    const id = a.tripId ?? `${a.line}@${a.eta}`;
    // אותו אוטובוס יכול להופיע פעמיים (שתי רשומות לאותה נסיעה) – לפי מיקום
    const posKey = `${v.lat.toFixed(5)},${v.lng.toFixed(5)}`;
    if (seen.has(id) || seen.has(posKey)) continue;
    seen.add(id);
    seen.add(posKey);
    out.push({
      id,
      lat: v.lat,
      lng: v.lng,
      line: a.line,
      mode: a.mode ?? 'bus',
      color: colorOf(a),
      etaMin: Math.max(0, Math.round((etaMs - now) / 60000)),
      destination: a.destination ?? null,
      recordedAt: a.recordedAt ?? null,
      motion: stop && Number.isFinite(stop.lat) ? { target: { lat: stop.lat, lng: stop.lng, at: etaMs } } : null
    });
    if (out.length >= MAX_VEHICLES) break;
  }
  return out;
}

/**
 * מקבץ הגעות לפי קו + יעד: [{ line, destination, agency, minutes: [3, 15, 27] }]
 * הדקות מחושבות מחדש בכל רינדור מתוך זמן ה-ETA המוחלט, כך שהן תמיד מעודכנות.
 */
export function groupArrivals(arrivals, now = Date.now()) {
  const groups = new Map();

  for (const a of arrivals ?? []) {
    const etaMs = Date.parse(a.eta);
    if (!Number.isFinite(etaMs) || etaMs < now - ARRIVAL_GONE_MS) continue;
    const minutes = Math.max(0, Math.round((etaMs - now) / 60000));
    if (minutes > ARRIVALS_MAX_AHEAD_MIN) continue;
    const key = `${a.line}|${a.destination ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      g = { line: a.line, mode: a.mode ?? 'bus', trainNumber: a.trainNumber ?? null, destination: a.destination ?? null, agency: a.agency ?? null, minutes: [], live: false };
      groups.set(key, g);
    }
    // הזמן הראשון קובע אם הקבוצה "בזמן אמת"
    if (g.minutes.length === 0) g.live = !!a.live;
    g.minutes.push(minutes);
  }

  return [...groups.values()]
    .map((g) => ({ ...g, minutes: g.minutes.sort((x, y) => x - y).slice(0, 3) }))
    .sort((a, b) => a.minutes[0] - b.minutes[0])
    .slice(0, ARRIVALS_GROUP_LIMIT);
}
