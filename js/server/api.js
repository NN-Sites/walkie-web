// ה-API של Walkie – לא תלוי ב-framework.
// אותו קוד רץ גם בשרת הפיתוח המקומי (server/dev-server.js) וגם ב-Firebase Cloud Functions.
//
// GET /api/health
// GET /api/stops/nearby?lat=..&lng=..&radius=..
// GET /api/stops/:code/arrivals
// GET /api/search?q=..&lat=..&lng=..&category=..   (category = חיפוש מקומות מסוג מסוים סביב המיקום)
// GET /api/route/walk?from=lat,lng&to=lat,lng&speed=slow|normal|fast&lang=he|en
// GET /api/route/transit?from=lat,lng&to=lat,lng&time=ISO&arriveBy=0|1&cursor=..&modes=bus,rail,lightrail&maxWalk=MIN&wheelchair=1
// GET /api/transit/live?stop=CODE&trip=GTFS_TRIP_ID&line=..&scheduled=ISO&route=..&start=HH:MM
// GET /api/stations/nearby?lat=..&lng=..&mode=all|bus|rail|lightrail
// GET /api/stations/departures?stopIds=a,b  |  ?code=..&lat=..&lng=..
// GET /api/stations/search?q=..&lat=..&lng=..     (שם / עיר / קוד תחנה)
// GET /api/stations/by-code?code=..&lat=..&lng=..
// GET /api/lines/search?q=..&lat=..&lng=..
// GET /api/lines/nearby?lat=..&lng=..
// GET /api/lines/:lineRef?lat=..&lng=..

import { STOP_CODE_RE, UpstreamError } from './arrivals.js?v=1.10.0-mvsedwod';
import { RoutingError } from './walk-router.js?v=1.10.0-mvsedwod';
import { TransitError } from './transit-planner.js?v=1.10.0-mvsedwod';
import { LinesError } from './lines.js?v=1.10.0-mvsedwod';
import { stopMode } from './stops-index.js?v=1.10.0-mvsedwod';
import { distanceMeters } from './geo.js?v=1.10.0-mvsedwod';

// CORS פתוח לקריאה – האפליקציה לאנדרואיד (Capacitor) רצה ממקור אחר
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };
const VALID_MODES = new Set(['bus', 'rail', 'lightrail']);
const WALK_SPEEDS = { slow: 3.8, normal: 4.7, fast: 5.6 };

function reply(status, body, cacheSeconds = 0) {
  return {
    status,
    headers: {
      ...JSON_HEADERS,
      'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function parseCoord(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function parsePoint(value) {
  const [lat, lng] = String(value ?? '').split(',');
  const pLat = parseCoord(lat, -90, 90);
  const pLng = parseCoord(lng, -180, 180);
  return pLat === null || pLng === null ? null : { lat: pLat, lng: pLng };
}

function parseNear(params) {
  const lat = parseCoord(params.get('lat'), -90, 90);
  const lng = parseCoord(params.get('lng'), -180, 180);
  return lat !== null && lng !== null ? { lat, lng } : null;
}

function parseTime(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  // חלון סביר: יום אחורה עד 14 יום קדימה
  if (ms < Date.now() - 24 * 3600 * 1000 || ms > Date.now() + 14 * 24 * 3600 * 1000) return undefined;
  return new Date(ms).toISOString();
}

export function createApi({ stopsIndex, arrivalsService, walkRouter, geocoder, transitPlanner, stations, lines, log = console }) {
  async function transitRoute(params) {
    const from = parsePoint(params.get('from'));
    const to = parsePoint(params.get('to'));
    if (!from || !to) return reply(400, { error: 'invalid_points' });
    const time = parseTime(params.get('time'));
    if (time === undefined) return reply(400, { error: 'invalid_time' });
    const arriveBy = params.get('arriveBy') === '1' || params.get('arriveBy') === 'true';
    const cursor = params.get('cursor')?.slice(0, 200) || null;

    // העדפות משתמש (מסך הגדרות)
    const modes = (params.get('modes') ?? '').split(',').filter((m) => VALID_MODES.has(m));
    // רק אם המשתמש שינה בהגדרות; בלי פרמטר – ברירת המחדל של המנוע (15 דק')
    const rawMaxWalk = Number(params.get('maxWalk'));
    const maxWalk = params.has('maxWalk') && Number.isFinite(rawMaxWalk) && rawMaxWalk > 0
      ? Math.min(40, Math.max(3, rawMaxWalk))
      : null;
    const wheelchair = params.get('wheelchair') === '1';

    try {
      const plan = await transitPlanner.plan({
        from, to, time, arriveBy, cursor,
        prefs: { modes: modes.length ? modes : null, maxWalkMin: maxWalk, wheelchair }
      });
      return reply(200, plan, 30);
    } catch (err) {
      if (err instanceof TransitError) {
        log.warn?.(`[api] transit: ${err.message}`);
        return reply(err.code === 'too_close' ? 422 : 502, { error: err.code });
      }
      throw err;
    }
  }

  async function transitLive(params) {
    const stopCode = params.get('stop') ?? '';
    if (!STOP_CODE_RE.test(stopCode)) return reply(400, { error: 'invalid_stop_code' });
    const scheduled = parseTime(params.get('scheduled'));
    if (!scheduled) return reply(400, { error: 'invalid_time' });
    const live = await transitPlanner.live({
      stopCode,
      tripId: params.get('trip')?.slice(0, 64) || null,
      line: params.get('line')?.slice(0, 12) || null,
      scheduled,
      routeId: /^\d{1,9}$/.test(params.get('route') ?? '') ? params.get('route') : null,
      tripStart: /^\d{2}:\d{2}$/.test(params.get('start') ?? '') ? params.get('start') : null
    });
    return reply(200, { live }, 15);
  }

  async function nearby(params) {
    const near = parseNear(params);
    if (!near) return reply(400, { error: 'invalid_coordinates' });

    const radius = Math.min(2000, Math.max(100, Number(params.get('radius')) || 700));
    const limit = Math.min(120, Math.max(1, Number(params.get('limit')) || 80));

    await stopsIndex.ensureLoaded();
    const stops = stopsIndex.nearby(near, radius, limit);
    return reply(200, { source: 'gtfs', gtfsDate: stopsIndex.date, count: stops.length, stops }, 3600);
  }

  async function arrivals(code) {
    if (!STOP_CODE_RE.test(code)) return reply(400, { error: 'invalid_stop_code' });
    const data = await arrivalsService.get(code);
    return reply(200, data, 15);
  }

  async function search(params) {
    const q = params.get('q') ?? '';
    const near = parseNear(params);
    const categoryId = params.get('category')?.slice(0, 32) || null;
    const { mode, category, results, degraded = false } = await geocoder.search(q, near, { categoryId });
    return reply(200, { query: q, mode, category, results, degraded }, degraded ? 0 : 300);
  }

  async function walkRoute(params) {
    const from = parsePoint(params.get('from'));
    const to = parsePoint(params.get('to'));
    if (!from || !to) return reply(400, { error: 'invalid_points' });
    const speedKmh = WALK_SPEEDS[params.get('speed')] ?? WALK_SPEEDS.normal;
    try {
      const route = await walkRouter.route(from, to, { speedKmh, lang: params.get('lang') === 'en' ? 'en' : 'he' });
      return reply(200, route, 300);
    } catch (err) {
      if (err instanceof RoutingError) {
        const status = err.code === 'too_far' || err.code === 'too_close' ? 422 : err.code === 'no_route' ? 404 : 502;
        return reply(status, { error: err.code });
      }
      throw err;
    }
  }

  // ---------- תחנות ----------

  async function stationsNearby(params) {
    const near = parseNear(params);
    if (!near) return reply(400, { error: 'invalid_coordinates' });
    const mode = ['all', 'bus', 'rail', 'lightrail'].includes(params.get('mode')) ? params.get('mode') : 'all';
    const results = await stations.nearby(near, mode);
    return reply(200, { mode, results }, 300);
  }

  /** חיפוש תחנה בכל הארץ: לפי שם, עיר או קוד תחנה (אינדקס ה-GTFS), ממוין לפי קרבה */
  async function stationsSearch(params) {
    const q = (params.get('q') ?? '').trim().slice(0, 60);
    if (q.length < 2) return reply(200, { results: [] });
    const near = parseNear(params);
    await stopsIndex.ensureLoaded();
    const results = stopsIndex.search(q, near, 25).map((s) => {
      const mode = stopMode(s);
      return {
        id: `code:${s.code}`,
        name: s.name,
        city: s.city ?? null,
        code: s.code,
        lat: s.lat,
        lng: s.lng,
        modes: [mode],
        primaryMode: mode,
        distance: near ? Math.round(distanceMeters(near, s)) : null
      };
    });
    return reply(200, { results }, 300);
  }

  /** תחנה מלאה (סוגי תחבורה + מזהי רציפים) לפי קוד ומיקום – לפתיחת תוצאת חיפוש */
  async function stationByCode(params) {
    const code = params.get('code') ?? '';
    const near = parseNear(params);
    if (!STOP_CODE_RE.test(code) || !near) return reply(400, { error: 'invalid_stop' });
    const station = await stations.findByCode(code, near);
    return station ? reply(200, { station }, 3600) : reply(404, { error: 'not_found' });
  }

  async function stationDepartures(params) {
    let stopIds = (params.get('stopIds') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[\w:-]{3,80}$/.test(s))
      .slice(0, 4);
    let code = params.get('code');
    if (code && !STOP_CODE_RE.test(code)) return reply(400, { error: 'invalid_stop_code' });

    // תחנה מה-GTFS שלנו (קוד + מיקום) -> מזהי התחנה ב-MOTIS
    if (stopIds.length === 0) {
      const near = parseNear(params);
      if (!code || !near) return reply(400, { error: 'missing_stop' });
      const station = await stations.findByCode(code, near);
      if (!station) return reply(200, { departures: [], unknownStop: true }, 60);
      stopIds = station.stopIds;
    }

    const data = await stations.departures({ stopIds, code }, { limit: 60 });
    return reply(200, data, 15);
  }

  // ---------- קווים ----------

  async function linesSearch(params) {
    const data = await lines.search(params.get('q') ?? '', parseNear(params));
    return reply(200, data, 600);
  }

  async function linesNearby(params) {
    const near = parseNear(params);
    if (!near) return reply(400, { error: 'invalid_coordinates' });
    const data = await lines.nearby(near);
    return reply(200, data, 30);
  }

  async function lineDetails(ref, params) {
    try {
      const data = await lines.details(ref, parseNear(params));
      return reply(200, data, 60);
    } catch (err) {
      if (err instanceof LinesError) {
        const status = err.code === 'invalid' ? 400 : err.code === 'not_found' ? 404 : 502;
        return reply(status, { error: err.code });
      }
      throw err;
    }
  }

  return async function handleApi(method, rawUrl) {
    if (method !== 'GET') return reply(405, { error: 'method_not_allowed' });

    const url = new URL(rawUrl, 'http://localhost');
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ['api', ...]
    if (parts[0] !== 'api') return reply(404, { error: 'not_found' });
    const p = url.searchParams;

    try {
      if (parts.length === 2 && parts[1] === 'health') {
        return reply(200, { ok: true, stops: stopsIndex.size, gtfsDate: stopsIndex.date });
      }
      if (parts.length === 3 && parts[1] === 'stops' && parts[2] === 'nearby') return await nearby(p);
      if (parts.length === 4 && parts[1] === 'stops' && parts[3] === 'arrivals') return await arrivals(decodeURIComponent(parts[2]));
      if (parts.length === 2 && parts[1] === 'search') return await search(p);
      if (parts.length === 3 && parts[1] === 'route' && parts[2] === 'walk') return await walkRoute(p);
      if (parts.length === 3 && parts[1] === 'route' && parts[2] === 'transit') return await transitRoute(p);
      if (parts.length === 3 && parts[1] === 'transit' && parts[2] === 'live') return await transitLive(p);
      if (parts.length === 3 && parts[1] === 'stations' && parts[2] === 'nearby') return await stationsNearby(p);
      if (parts.length === 3 && parts[1] === 'stations' && parts[2] === 'departures') return await stationDepartures(p);
      if (parts.length === 3 && parts[1] === 'stations' && parts[2] === 'search') return await stationsSearch(p);
      if (parts.length === 3 && parts[1] === 'stations' && parts[2] === 'by-code') return await stationByCode(p);
      if (parts.length === 3 && parts[1] === 'lines' && parts[2] === 'search') return await linesSearch(p);
      if (parts.length === 3 && parts[1] === 'lines' && parts[2] === 'nearby') return await linesNearby(p);
      if (parts.length === 3 && parts[1] === 'lines') return await lineDetails(decodeURIComponent(parts[2]), p);
      return reply(404, { error: 'not_found' });
    } catch (err) {
      if (err instanceof UpstreamError || err instanceof LinesError) {
        log.warn?.(`[api] upstream: ${err.message}`);
        return reply(502, { error: 'upstream_unavailable' });
      }
      if (/HTTP \d{3}|Timeout/.test(err?.message ?? '')) {
        log.warn?.(`[api] upstream: ${err.message}`);
        return reply(502, { error: 'upstream_unavailable' });
      }
      log.error?.('[api] error', err);
      return reply(500, { error: 'internal_error' });
    }
  };
}
