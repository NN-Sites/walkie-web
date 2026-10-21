// זמני הגעה בצד הלקוח: קאש קצר לכל תחנה, ביטול בקשות ישנות, וקיבוץ לפי קו.

import { ARRIVALS_CLIENT_TTL_MS, ARRIVALS_GROUP_LIMIT, ARRIVALS_MAX_AHEAD_MIN } from '../config.js';
import { fetchArrivals, fetchDepartures } from './api.js';
import { demoArrivals } from './stops.js';

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

    try {
      const { arrivals, live } = await this.#load(stop, controller.signal);
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
        live: !!d.live
      }));
      return { arrivals, live: arrivals.some((a) => a.live) };
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
  }
  const siri = await fetchArrivals(stop.code, signal);
  return {
    arrivals: (siri.arrivals ?? []).map((a) => ({ ...a, mode: 'bus', live: a.tracked !== false })),
    live: (siri.arrivals ?? []).some((a) => a.tracked !== false)
  };
}

/**
 * מקבץ הגעות לפי קו + יעד: [{ line, destination, agency, minutes: [3, 15, 27] }]
 * הדקות מחושבות מחדש בכל רינדור מתוך זמן ה-ETA המוחלט, כך שהן תמיד מעודכנות.
 */
export function groupArrivals(arrivals, now = Date.now()) {
  const groups = new Map();

  for (const a of arrivals ?? []) {
    const etaMs = Date.parse(a.eta);
    if (!Number.isFinite(etaMs) || etaMs < now - 60000) continue;
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
