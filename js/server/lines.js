// קווים: חיפוש קו (מספר או יעד), קווים באזור, ופרטי קו (כל התחנות, מסלול, יציאות קרובות).
//
// מקורות:
//  - רשימת הקווים הרשמית ליום הנוכחי: GTFS של משרד התחבורה דרך Stride (הסדנא לידע ציבורי)
//  - הנסיעה הבאה של הקו (תחנות, שעות, מסלול): Transitous (MOTIS)
//  line_ref של Stride = route_id ב-GTFS = routeId ב-MOTIS, ולכן ההתאמה בין המקורות מדויקת.

import { fetchWithTimeout, distanceMeters, israelDate } from './geo.js?v=1.5.0-mvkunw6c';
import { decodePolyline } from './polyline.js?v=1.5.0-mvkunw6c';
import { normalizeStopTime, MAX_AHEAD_MS } from './stations.js?v=1.5.0-mvkunw6c';
import { matchLiveArrival, stripFeed, tripStartOf } from './transit-planner.js?v=1.5.0-mvkunw6c';

const STRIDE = 'https://open-bus-stride-api.hasadna.org.il';
const MOTIS = 'https://api.transitous.org/api/v1';
const USER_AGENT = 'Walkie/0.6 (pedestrian & public transport navigation)';

const SEARCH_TTL_MS = 30 * 60 * 1000;
const DETAILS_TTL_MS = 10 * 60 * 1000;   // פרטי הקו (שם, כיוונים, תחנת מוצא)
const TRIP_TTL_MS = 30 * 1000;           // נסיעה + זמן אמת – מתעדכנים מהר
const LATE_LOOKBACK_MS = 20 * 60 * 1000; // אוטובוס מאחר עד 20 דק' עדיין נחשב "בדרך"
const NEARBY_TTL_MS = 60 * 1000;

const ROUTE_TYPE_MODE = { 0: 'lightrail', 1: 'lightrail', 2: 'rail', 3: 'bus', 715: 'bus' };

export class LinesError extends Error {
  constructor(message, code = 'upstream') {
    super(message);
    this.code = code;
  }
}

// ---------- פענוח שם הקו ----------

/** "ת.רק''ל הקוממיות/דרך בגין-בת ים<->קריית חינוך-תל אביב יפו-1#" -> { from, to } */
export function parseLongName(longName) {
  const clean = String(longName ?? '').replace(/''/g, '"').replace(/-\d+[#א-ת]?$/, '');
  const [a, b] = clean.split('<->');
  const part = (p) => {
    if (!p) return null;
    const i = p.lastIndexOf('-');
    if (i <= 0) return { name: p.trim(), city: null };
    return { name: p.slice(0, i).trim(), city: p.slice(i + 1).trim() || null };
  };
  return { from: part(a), to: part(b) };
}

function normalizeRoute(r) {
  const mode = ROUTE_TYPE_MODE[Number(r.route_type)] ?? 'bus';
  const { from, to } = parseLongName(r.route_long_name);
  const short = r.route_short_name && r.route_short_name !== 'NaN' ? r.route_short_name : '';
  return {
    lineRef: String(r.line_ref),
    line: mode === 'rail' ? 'רכבת' : short,
    mode,
    agency: r.agency_name ?? null,
    mkt: r.route_mkt ?? null,
    direction: r.route_direction ?? null,
    alternative: r.route_alternative && r.route_alternative !== '#' ? r.route_alternative : null,
    from,
    to
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shiftIso = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

/** אינדקס התחנה האחרונה שהאוטובוס כבר עבר (לפי המיקום שלו), או -1 */
function passedStopIndex(stops, vehicle) {
  let i = -1;
  let best = Infinity;
  stops.forEach((s, k) => {
    if (!Number.isFinite(s.lat)) return;
    const d = distanceMeters(vehicle, s);
    if (d < best) {
      best = d;
      i = k;
    }
  });
  if (i < 0) return -1;
  const next = stops[i + 1];
  if (!next) return i;
  // האוטובוס כבר אחרי התחנה הקרובה אם הוא קרוב יותר לתחנה הבאה ממנה
  return distanceMeters(vehicle, next) < distanceMeters(stops[i], next) ? i : i - 1;
}

/** אינדקס התחנה הקרובה למיקום (לא כולל התחנה האחרונה – שם רק יורדים) */
function nearestStopIndex(stops, near) {
  let best = -1;
  let bestDist = Infinity;
  stops.forEach((s, i) => {
    if (!Number.isFinite(s.lat) || i === stops.length - 1) return;
    const d = distanceMeters(near, s);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return bestDist <= 3000 ? best : -1;
}

export class LinesService {
  #cache = new Map();

  constructor({ stopsIndex, stations, log = console }) {
    this.stopsIndex = stopsIndex;
    this.stations = stations;
    this.log = log;
  }

  async #cached(key, ttl, producer) {
    const hit = this.#cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.data;
    const data = await producer();
    this.#cache.set(key, { at: Date.now(), data });
    if (this.#cache.size > 800) this.#cache.delete(this.#cache.keys().next().value);
    return data;
  }

  // ---------- חיפוש ----------

  /** מספר קו ("26", "1א") או טקסט ביעד ("נהריה", "רכבת חיפה") */
  async search(rawQuery, near) {
    const q = String(rawQuery ?? '').trim().slice(0, 40);
    if (!q) return { results: [] };
    const loc = near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : '';

    return this.#cached(`s|${q}|${loc}`, SEARCH_TTL_MS, async () => {
      const isNumber = /^[0-9]{1,4}[א-תA-Za-z]?$/.test(q);
      const params = { date_from: israelDate(), date_to: israelDate(), limit: '150' };

      if (isNumber) {
        params.route_short_name = q;
      } else {
        const wantsRail = /רכבת|train/i.test(q);
        const text = q.replace(/רכבת|train/gi, '').trim();
        if (wantsRail) params.route_type = '2';
        if (text.length >= 2) params.route_long_name_contains = text;
        else if (!wantsRail) return { results: [] };
      }

      const rows = await this.#stride('/gtfs_routes/list', params);
      const routes = rows.map(normalizeRoute);
      return { results: this.#group(routes, near).slice(0, 25) };
    });
  }

  /** מאחד שני כיווני נסיעה של אותו קו לכרטיס אחד, ומדרג לפי קרבה למשתמש */
  #group(routes, near) {
    const groups = new Map();
    for (const r of routes) {
      const key = `${r.agency}|${r.mkt ?? r.lineRef}|${r.line}`;
      let g = groups.get(key);
      if (!g) {
        g = { key, line: r.line, mode: r.mode, agency: r.agency, directions: [] };
        groups.set(key, g);
      }
      // חלופות (א/ב) של אותו כיוון – מציגים את כולן כדי לא להסתיר מסלול קיים
      g.directions.push({ lineRef: r.lineRef, direction: r.direction, alternative: r.alternative, from: r.from, to: r.to });
    }

    const list = [...groups.values()].map((g) => {
      g.directions.sort((a, b) => String(a.direction).localeCompare(String(b.direction)) || String(a.alternative ?? '').localeCompare(String(b.alternative ?? '')));
      let distance = null;
      if (near) {
        for (const d of g.directions) {
          for (const end of [d.from, d.to]) {
            const p = this.#locateEnd(end, near);
            if (p) {
              const dist = distanceMeters(near, p);
              if (distance === null || dist < distance) distance = dist;
            }
          }
        }
      }
      return { ...g, distance: distance === null ? null : Math.round(distance) };
    });

    return list.sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9));
  }

  /** מיקום משוער של קצה קו (שם תחנה + עיר) לפי אינדקס התחנות */
  #locateEnd(end, near) {
    if (!end?.name || !this.stopsIndex.size) return null;
    const hits = this.stopsIndex.search(`${end.name} ${end.city ?? ''}`.trim(), near, 1);
    return hits[0] ?? null;
  }

  // ---------- קווים באזור ----------

  /** הקווים שעוברים בתחנות הקרובות (כולל תחנת רכבת קרובה), עם היציאה הבאה */
  async nearby(near) {
    const key = `n|${near.lat.toFixed(3)},${near.lng.toFixed(3)}`;
    return this.#cached(key, NEARBY_TTL_MS, async () => {
      const [stops, rail] = await Promise.all([
        this.stations.nearby(near, 'all'),
        this.stations.nearby(near, 'rail').catch(() => [])
      ]);
      const picked = stops.filter((s) => s.distance <= 500).slice(0, 4);
      const nearRail = rail.find((s) => s.distance <= 2500);
      if (nearRail && !picked.some((s) => s.id === nearRail.id)) picked.push(nearRail);

      const boards = await Promise.all(
        picked.map((s) =>
          this.stations
            .departures({ stopIds: s.stopIds, code: s.code }, { limit: 20 })
            .then((b) => ({ station: s, departures: b.departures }))
            .catch(() => ({ station: s, departures: [] }))
        )
      );

      const lines = new Map();
      for (const { station, departures } of boards) {
        for (const d of departures) {
          const k = `${d.lineRef}|${d.headsign}`;
          const existing = lines.get(k);
          if (!existing || Date.parse(d.eta) < Date.parse(existing.next.eta)) {
            lines.set(k, {
              lineRef: d.lineRef,
              line: d.line,
              mode: d.mode,
              agency: d.agency,
              headsign: d.headsign,
              color: d.color,
              station: { id: station.id, name: station.name, code: station.code, distance: station.distance },
              next: { eta: d.eta, scheduled: d.scheduled, live: d.live, trainNumber: d.trainNumber }
            });
          }
        }
      }

      const results = [...lines.values()].sort((a, b) => Date.parse(a.next.eta) - Date.parse(b.next.eta));
      return { results: results.slice(0, 40) };
    });
  }

  // ---------- פרטי קו ----------

  async details(lineRef, near = null) {
    const ref = String(lineRef);
    if (!/^\d{1,9}$/.test(ref)) throw new LinesError('invalid line', 'invalid');

    const base = await this.#cached(`d|${ref}`, DETAILS_TTL_MS, async () => {
      const rows = await this.#stride('/gtfs_routes/list', { line_refs: ref, date_from: israelDate(), date_to: israelDate(), limit: '1' });
      if (!rows.length) throw new LinesError('line not found', 'not_found');
      const route = normalizeRoute(rows[0]);

      // כיוון נגדי של אותו קו (אותו מק"ט, כיוון אחר)
      let otherDirections = [];
      if (rows[0].route_mkt) {
        const siblings = await this.#stride('/gtfs_routes/list', {
          route_mkt: rows[0].route_mkt, date_from: israelDate(), date_to: israelDate(), limit: '10'
        }).catch(() => []);
        otherDirections = siblings
          .map(normalizeRoute)
          .filter((r) => r.lineRef !== route.lineRef && r.agency === route.agency)
          .map((r) => ({ lineRef: r.lineRef, from: r.from, to: r.to, alternative: r.alternative }));
      }

      const origins = await this.#resolveOrigins(route, near);
      return { route, otherDirections, origins };
    });

    const { route, otherDirections, origins } = base;
    const nearKey = near ? `${near.lat.toFixed(3)},${near.lng.toFixed(3)}` : '';

    return this.#cached(`t|${ref}|${nearKey}`, TRIP_TTL_MS, async () => {
      let departures = [];
      let trip = null;
      let refIndex = -1;
      let tripLive = null;

      // תחנת המוצא: המועמד הראשון שהקו באמת יוצא ממנו
      let origin = null;
      for (const o of origins) {
        departures = await this.#lineDepartures(o, ref);
        if (departures.length) {
          origin = o;
          break;
        }
      }
      origin ??= origins[0] ?? null;

      if (origin) {
        departures = await this.#withLive(origin.code, departures, route);

        // הנסיעה הבאה מתחנת המוצא (תחנות + מסלול)
        let tripId = departures[0]?.motisTripId ?? null;
        trip = tripId ? await this.#safeTrip(tripId) : null;

        // אם המשתמש באמצע הקו – הנסיעה שתגיע אליו ראשונה (יכולה להיות נסיעה שכבר יצאה מהמוצא)
        if (trip && near) {
          refIndex = nearestStopIndex(trip.stops, near);
          const refStop = trip.stops[refIndex];
          if (refIndex > 0 && refStop?.stopId) {
            const next = await this.#nextAtStop(refStop, ref, route).catch(() => null);
            if (next && next.motisTripId !== tripId) {
              const better = await this.#safeTrip(next.motisTripId);
              if (better) {
                trip = better;
                tripId = next.motisTripId;
                const i = trip.stops.findIndex((s) => s.stopId === refStop.stopId);
                refIndex = i >= 0 ? i : nearestStopIndex(trip.stops, near);
              }
            }
          }
        }

        // זמן אמת לאוטובוס: העיכוב בתחנה של המשתמש (או במוצא) מוחל על כל זמני הנסיעה
        if (trip && route.mode === 'bus') {
          const at = Math.max(0, refIndex);
          tripLive = await this.#tripDelay(trip, at, { tripId: stripFeed(tripId), tripStart: tripStartOf(tripId), routeId: ref, line: route.line });
          if (tripLive) {
            // תחנות שהאוטובוס כבר עבר (לפי המיקום שלו) – נשארות עם הזמן המתוכנן ומסומנות
            const passed = tripLive.vehicle ? passedStopIndex(trip.stops, tripLive.vehicle) : -1;
            tripLive.passedIndex = Math.min(passed, at - 1);
            trip.stops = trip.stops.map((s, i) => {
              if (!s.time) return s;
              if (i <= tripLive.passedIndex) return { ...s, scheduled: s.time, passed: true };
              return { ...s, scheduled: s.time, time: shiftIso(s.time, tripLive.delayMs) };
            });
          }
        }
      }

      return {
        ...route,
        otherDirections,
        origin: origin ? { name: origin.name, code: origin.code, lat: origin.lat, lng: origin.lng } : null,
        departures: departures
          .filter((d) => Date.parse(d.eta) <= Date.now() + MAX_AHEAD_MS)
          .slice(0, 8)
          .map(({ motisTripId, ...d }) => d),
        stops: (trip?.stops ?? []).map(({ stopId, ...s }) => s),
        geometry: trip?.geometry ?? [],
        tripStart: trip?.start ?? null,
        tripLive: tripLive
          ? {
              delayMin: Math.round(tripLive.delayMs / 60000),
              stopIndex: Math.max(0, refIndex),
              exact: tripLive.exact,
              vehicle: tripLive.vehicle,
              passedIndex: tripLive.passedIndex,
              recordedAt: tripLive.recordedAt
            }
          : null
      };
    });
  }

  #safeTrip(motisTripId) {
    return this.#trip(motisTripId).catch((err) => {
      this.log.warn?.(`[lines] trip failed: ${err.message}`);
      return null;
    });
  }

  /**
   * הנסיעה הבאה של הקו שתגיע לתחנה מסוימת.
   * מתחילים 20 דק' אחורה ומשלבים זמן אמת – אוטובוס מאחר שזמנו המתוכנן כבר עבר עדיין בדרך.
   */
  async #nextAtStop(stop, lineRef, route) {
    for (const n of [80, 250]) {
      let list = (await this.#stopTimes(stop.stopId, n, Date.now() - LATE_LOOKBACK_MS)).filter((d) => d.lineRef === lineRef);
      if (!list.length) continue;
      list = await this.#withLive(stop.code, list, route);
      const now = Date.now();
      // בלי זמן אמת: נסיעה שזמנה עבר נחשבת כאילו כבר עברה
      const hit = list.find((d) => Date.parse(d.eta) >= now - 60000);
      if (hit) return hit;
    }
    return null;
  }

  /** זמן אמת (SIRI) ליציאות מתחנת המוצא */
  async #withLive(code, departures, route) {
    if (route.mode !== 'bus' || !code || !departures.length) return departures;
    try {
      const siri = await this.stations.arrivalsService.get(code);
      const matches = departures.map((d) => matchLiveArrival(siri.arrivals, { tripId: d.tripId, line: d.line, scheduled: d.scheduled, routeId: d.lineRef, tripStart: d.tripStart }));

      // בקו תדיר אותו אוטובוס יכול להתאים לשתי נסיעות – משאירים אותו רק לנסיעה המתאימה ביותר
      const owner = new Map();
      matches.forEach((live, i) => {
        if (!live) return;
        const key = `${live.eta}|${live.vehicle?.lat},${live.vehicle?.lng}`;
        const score = live.exact ? -1 : Math.abs(live.delayMin);
        const prev = owner.get(key);
        if (!prev || score < prev.score) owner.set(key, { i, score });
      });
      const kept = new Set([...owner.values()].map((o) => o.i));

      return departures
        .map((d, i) => (kept.has(i) ? { ...d, eta: matches[i].eta, live: matches[i] } : d))
        .sort((a, b) => Date.parse(a.eta) - Date.parse(b.eta));
    } catch (err) {
      this.log.warn?.(`[lines] SIRI failed for ${code}: ${err.message}`);
      return departures;
    }
  }

  /** עיכוב הנסיעה לפי SIRI בתחנה נתונה: { delayMs, exact, vehicle, recordedAt } או null */
  async #tripDelay(trip, index, { tripId, tripStart, routeId, line }) {
    const stop = trip.stops[index];
    if (!stop?.code || !stop.time) return null;
    try {
      const siri = await this.stations.arrivalsService.get(stop.code);
      const live = matchLiveArrival(siri.arrivals, { tripId, line, scheduled: stop.time, routeId, tripStart });
      if (!live) return null;
      return { delayMs: Date.parse(live.eta) - Date.parse(stop.time), exact: live.exact, vehicle: live.vehicle, recordedAt: live.recordedAt };
    } catch (err) {
      this.log.warn?.(`[lines] SIRI failed for ${stop.code}: ${err.message}`);
      return null;
    }
  }

  /** מועמדים לתחנת המוצא (עד 3), שם זהה קודם */
  async #resolveOrigins(route, near) {
    const end = route.from;
    if (!end?.name) return [];
    try {
      await this.stopsIndex.ensureLoaded();
    } catch {
      return [];
    }
    // כמה מועמדים בשם הזה (תחנה סופית יכולה להיות עם כמה רציפים).
    // ברכבת: לתחנות אין עיר ב-GTFS ("נתב"ג") – מחפשים לפי שם בלבד ובקודי תחנות רכבת (17xxx)
    let candidates = this.stopsIndex.search(`${end.name} ${end.city ?? ''}`.trim(), near, 4);
    if (route.mode === 'rail' || candidates.length === 0) {
      const byName = this.stopsIndex.search(end.name, near, 12);
      const preferred = route.mode === 'rail' ? byName.filter((s) => /^17\d{3}$/.test(s.code)) : byName;
      candidates = [...preferred.slice(0, 4), ...candidates];
    }
    // "ת. רכבת יבנה מזרח" לפני "ת. רכבת יבנה מזרח/העצמאות"
    const exact = (c) => (String(c.name ?? '').replace(/''/g, '"').trim() === end.name ? 0 : 1);
    candidates = candidates.map((c, i) => ({ c, i })).sort((a, b) => exact(a.c) - exact(b.c) || a.i - b.i).map((x) => x.c);

    const out = [];
    for (const c of candidates) {
      const station = await this.stations.findByCode(c.code, c).catch(() => null);
      if (station && !out.some((o) => o.id === station.id)) out.push(station);
      if (out.length === 3) break;
    }
    return out;
  }

  async #lineDepartures(station, lineRef) {
    // קו תדיר נמצא מיד; קו נדיר – מחפשים בחלון ארוך יותר
    for (const n of [80, 250]) {
      const lists = await Promise.all(station.stopIds.slice(0, 3).map((id) => this.#stopTimes(id, n)));
      // אותה נסיעה חוזרת מכמה רציפים של תחנת המוצא – מסירים כפולים לפי מזהה נסיעה
      const seen = new Set();
      const mine = lists
        .flat()
        .filter((d) => d.lineRef === lineRef && !seen.has(d.tripId) && seen.add(d.tripId))
        .sort((a, b) => Date.parse(a.scheduled) - Date.parse(b.scheduled));
      if (mine.length) return mine;
      await sleep(100);
    }
    return [];
  }

  async #stopTimes(stopId, n, fromMs = Date.now() - 60000) {
    const params = new URLSearchParams({ stopId, n: String(n), time: new Date(fromMs).toISOString() });
    const res = await fetchWithTimeout(`${MOTIS}/stoptimes?${params}`, { headers: { 'User-Agent': USER_AGENT } }, 15000);
    if (!res.ok) throw new LinesError(`stoptimes HTTP ${res.status}`);
    const json = await res.json();
    // MOTIS מצרף גם תחנות "שקולות" סמוכות – כאן זה רצוי (רציף אחר של תחנת המוצא); הסינון לפי lineRef שומר על הכיוון
    return (json.stopTimes ?? []).map(normalizeStopTime).filter(Boolean);
  }

  async #trip(motisTripId) {
    const res = await fetchWithTimeout(`${MOTIS}/trip?tripId=${encodeURIComponent(motisTripId)}`, { headers: { 'User-Agent': USER_AGENT } }, 15000);
    if (!res.ok) throw new Error(`trip HTTP ${res.status}`);
    const json = await res.json();
    const leg = (json.legs ?? []).find((l) => l.mode !== 'WALK');
    if (!leg) return null;

    const stop = (s) => ({
      stopId: s.stopId ?? null,
      name: String(s.name ?? '').replace(/''/g, '"'),
      code: s.stopCode ? String(s.stopCode) : null,
      lat: s.lat,
      lng: s.lon,
      time: s.departure ?? s.arrival ?? null
    });

    return {
      start: leg.startTime,
      stops: [stop(leg.from), ...(leg.intermediateStops ?? []).map(stop), { ...stop(leg.to), time: leg.to.arrival ?? leg.endTime }],
      geometry: leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points, leg.legGeometry.precision ?? 7) : []
    };
  }

  async #stride(path, params) {
    const qs = new URLSearchParams(params);
    let res;
    try {
      res = await fetchWithTimeout(`${STRIDE}${path}?${qs}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }, 25000);
    } catch (err) {
      throw new LinesError(err.message);
    }
    if (!res.ok) throw new LinesError(`Stride HTTP ${res.status}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }
}

