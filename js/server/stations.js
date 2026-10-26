// תחנות מכל הסוגים (אוטובוס, רכבת ישראל, רכבת קלה) + לוח יציאות לכל תחנה.
//
// מקור: Transitous (MOTIS) מעל ה-GTFS הרשמי של משרד התחבורה – מחזיר תחנות עם סוג התחבורה,
// ויציאות לפי לוח זמנים לכל אמצעי. לאוטובוסים מוסיפים זמן אמת מ-SIRI.

import { fetchWithTimeout, distanceMeters } from './geo.js?v=1.9.3-mvps6z6v';
import { MODE_FAMILY, formatHeadsign, stripFeed, matchLiveArrival, tripStartOf } from './transit-planner.js?v=1.9.3-mvps6z6v';

const MOTIS = 'https://api.transitous.org/api/v1';
const USER_AGENT = 'Walkie/0.6 (pedestrian & public transport navigation)';

const AREA_CELL_DEG = 0.1;          // תא קאש של אזור (~11 ק"מ)
const AREA_HALF_DEG = 0.16;         // שאילתה סביב מרכז התא (~35 ק"מ) – בתוך המגבלה של השירות
const AREA_TTL_MS = 12 * 3600 * 1000;
const MAX_AREAS = 40;
const DEPARTURES_TTL_MS = 20000;
const LATE_LOOKBACK_MS = 60 * 60 * 1000;
const STOPTIMES_N = 260;
export const MAX_AHEAD_MS = 3 * 3600 * 1000; // יציאה בעוד יותר מ-3 שעות (למשל מחר בבוקר) לא מוצגת

// רדיוס ומספר תוצאות לכל מסנן בלשונית "תחנות"
const NEARBY_RULES = {
  all: { radius: 900, limit: 30 },
  bus: { radius: 900, limit: 30 },
  rail: { radius: 40000, limit: 12 },
  lightrail: { radius: 15000, limit: 20 }
};

function familyOf(mode) {
  return MODE_FAMILY[mode] ?? (mode === 'BUS' ? 'bus' : null);
}

const MODE_ORDER = { rail: 0, lightrail: 1, bus: 2 };

export class StationsService {
  #areas = new Map();
  #departures = new Map();

  constructor({ arrivalsService, log = console }) {
    this.arrivalsService = arrivalsService;
    this.log = log;
  }

  // ---------- תחנות ----------

  /** כל התחנות באזור (~35 ק"מ) עם סוג התחבורה, מאוחדות לפי שם+קוד (רציפים של אותה תחנה) */
  async area(near) {
    const cLat = Math.round(near.lat / AREA_CELL_DEG) * AREA_CELL_DEG;
    const cLng = Math.round(near.lng / AREA_CELL_DEG) * AREA_CELL_DEG;
    const key = `${cLat.toFixed(1)},${cLng.toFixed(1)}`;

    const hit = this.#areas.get(key);
    if (hit && Date.now() - hit.at < AREA_TTL_MS) return hit.stations;
    if (hit?.pending) return hit.pending;

    const pending = this.#fetchArea(cLat, cLng)
      .then((stations) => {
        this.#areas.set(key, { at: Date.now(), stations });
        if (this.#areas.size > MAX_AREAS) this.#areas.delete(this.#areas.keys().next().value);
        return stations;
      })
      .catch((err) => {
        this.#areas.delete(key);
        throw err;
      });
    this.#areas.set(key, { at: 0, pending });
    return pending;
  }

  async #fetchArea(cLat, cLng) {
    const min = `${(cLat - AREA_HALF_DEG).toFixed(4)},${(cLng - AREA_HALF_DEG).toFixed(4)}`;
    const max = `${(cLat + AREA_HALF_DEG).toFixed(4)},${(cLng + AREA_HALF_DEG).toFixed(4)}`;
    const res = await fetchWithTimeout(`${MOTIS}/map/stops?min=${min}&max=${max}`, { headers: { 'User-Agent': USER_AGENT } }, 20000);
    if (!res.ok) throw new Error(`map/stops HTTP ${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw)) throw new Error('map/stops: unexpected response');

    const groups = new Map();
    for (const s of raw) {
      const families = [...new Set((s.modes ?? []).map(familyOf).filter(Boolean))];
      if (families.length === 0) continue; // מוניות שירות / הסעות לפי הזמנה
      const name = String(s.name ?? '').replace(/''/g, '"');
      const key = `${name}|${s.stopCode ?? s.parentId ?? s.stopId}`;
      let g = groups.get(key);
      if (!g) {
        g = { id: `st:${stripFeed(s.parentId ?? s.stopId)}`, name, code: s.stopCode ? String(s.stopCode) : null, stopIds: [], modes: new Set(), lat: 0, lng: 0, n: 0 };
        groups.set(key, g);
      }
      g.stopIds.push(s.stopId);
      for (const f of families) g.modes.add(f);
      g.lat += s.lat;
      g.lng += s.lon;
      g.n++;
    }

    return [...groups.values()].map((g) => {
      const modes = [...g.modes].sort((a, b) => (MODE_ORDER[a] ?? 9) - (MODE_ORDER[b] ?? 9));
      return {
        id: g.id,
        name: g.name,
        code: g.code,
        stopIds: g.stopIds,
        modes,
        primaryMode: modes[0],
        lat: Math.round((g.lat / g.n) * 1e6) / 1e6,
        lng: Math.round((g.lng / g.n) * 1e6) / 1e6
      };
    });
  }

  /** תחנות קרובות לפי מסנן: all | bus | rail | lightrail */
  async nearby(near, mode = 'all') {
    const rule = NEARBY_RULES[mode] ?? NEARBY_RULES.all;
    const stations = await this.area(near);
    return stations
      .filter((s) => mode === 'all' || s.modes.includes(mode))
      .map((s) => ({ ...s, distance: Math.round(distanceMeters(near, s)) }))
      .filter((s) => s.distance <= rule.radius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, rule.limit);
  }

  /** מאתר תחנה לפי קוד (ומיקום משוער) – לחיבור בין תחנות ה-GTFS שלנו לתחנות של MOTIS */
  async findByCode(code, near) {
    const stations = await this.area(near);
    const matches = stations.filter((s) => s.code === String(code));
    if (matches.length === 0) return null;
    return matches.sort((a, b) => distanceMeters(near, a) - distanceMeters(near, b))[0];
  }

  // ---------- יציאות ----------

  /**
   * לוח יציאות לתחנה: כל הקווים (אוטובוס/רכבת/רכבת קלה), לפי לוח הזמנים,
   * ולאוטובוסים – זמן אמת מ-SIRI (התאמה לפי מזהה נסיעה, או קו+שעה).
   */
  async departures({ stopIds, code = null }, { limit = 25 } = {}) {
    const key = `${stopIds.join(',')}|${limit}`;
    const hit = this.#departures.get(key);
    if (hit && Date.now() - hit.at < DEPARTURES_TTL_MS) return hit.data;

    // מתחילים שעה אחורה: אוטובוס מאחר שזמנו המתוכנן עבר עדיין בדרך (זמן אמת יקבע אם כן).
    // בתחנה עמוסה עוברים ~100 אוטובוסים בשעה, לכן n גדול – כדי שהרשימה תגיע גם הרבה קדימה
    const time = new Date(Date.now() - LATE_LOOKBACK_MS).toISOString();
    const lists = await Promise.all(stopIds.slice(0, 4).map((id) => this.#stopTimes(id, time, STOPTIMES_N)));

    const seen = new Set();
    let items = lists
      .flat()
      .filter((d) => {
        if (seen.has(d.tripId)) return false;
        seen.add(d.tripId);
        return true;
      })
      .sort((a, b) => Date.parse(a.scheduled) - Date.parse(b.scheduled));

    // זמן אמת לאוטובוסים
    if (code && items.some((d) => d.mode === 'bus')) {
      try {
        const siri = await this.arrivalsService.get(code);
        items = items.map((d) => {
          if (d.mode !== 'bus') return d;
          const live = matchLiveArrival(siri.arrivals, { tripId: d.tripId, line: d.line, scheduled: d.scheduled, routeId: d.lineRef, tripStart: d.tripStart });
          return live ? { ...d, eta: live.eta, live } : d;
        });
      } catch (err) {
        this.log.warn?.(`[stations] SIRI failed for ${code}: ${err.message}`);
      }
    }

    // מסירים מה שכבר יצא (לפי זמן אמת או לוח זמנים)
    const now = Date.now();
    items = items
      .filter((d) => Date.parse(d.eta) >= now - 60000 && Date.parse(d.eta) <= now + MAX_AHEAD_MS)
      .sort((a, b) => Date.parse(a.eta) - Date.parse(b.eta))
      .slice(0, limit);

    const data = { generatedAt: new Date().toISOString(), departures: items };
    this.#departures.set(key, { at: Date.now(), data });
    if (this.#departures.size > 2000) this.#departures.delete(this.#departures.keys().next().value);
    return data;
  }

  async #stopTimes(stopId, time, n) {
    const params = new URLSearchParams({ stopId, n: String(n), time });
    const res = await fetchWithTimeout(`${MOTIS}/stoptimes?${params}`, { headers: { 'User-Agent': USER_AGENT } }, 12000);
    if (!res.ok) throw new Error(`stoptimes HTTP ${res.status}`);
    const json = await res.json();
    // MOTIS מצרף תחנות "שקולות" סמוכות (למשל התחנה שמעבר לכביש, בכיוון ההפוך) – משאירים רק את התחנה שביקשנו
    return (json.stopTimes ?? []).filter((t) => t.place?.stopId === stopId).map(normalizeStopTime).filter(Boolean);
  }
}

/** רשומת stoptime של MOTIS -> יציאה של Walkie */
export function normalizeStopTime(t, { keepCancelled = false } = {}) {
  const cancelled = !!(t.cancelled || t.tripCancelled);
  if (cancelled && !keepCancelled) return null;
  if (t.place?.pickupType === 'NOT_ALLOWED') return null; // תחנה סופית – רק ירידה
  const mode = familyOf(t.mode);
  if (!mode) return null;

  const numericHeadsign = /^\d+$/.test(String(t.headsign ?? '').trim());
  const scheduled = t.place?.scheduledDeparture ?? t.place?.departure;
  if (!scheduled) return null;

  return {
    mode,
    line: mode === 'rail' ? 'רכבת' : (t.routeShortName || t.displayName || ''),
    trainNumber: mode === 'rail' ? (t.tripShortName || (numericHeadsign ? String(t.headsign).trim() : null)) : null,
    headsign: mode === 'rail' || numericHeadsign ? (t.tripTo?.name ?? null) : (formatHeadsign(t.headsign) ?? t.tripTo?.name ?? null),
    agency: t.agencyName ?? null,
    lineRef: stripFeed(t.routeId),
    tripId: stripFeed(t.tripId),
    tripStart: tripStartOf(t.tripId),
    motisTripId: t.tripId,
    color: t.routeColor ? `#${t.routeColor}` : null,
    scheduled,
    eta: t.place?.departure ?? scheduled,
    live: null,
    cancelled,
    stopName: t.place?.name ?? null,
    accessible: t.wheelchairAccessible === 'ACCESSIBLE'
  };
}
