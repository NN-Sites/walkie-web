// ניווט רגלי ריאליסטי (Walkie Pedestrian Model).
//
// 1. Valhalla (פרופיל הולכי רגל) מחשב עד 3 מסלולים חלופיים. הפרופיל לעולם לא עובר בכבישים מהירים
//    ובכבישים שאסורים להולכי רגל, ומעדיף מדרכות ושבילים על פני סמטאות וחניונים.
// 2. לכל מסלול מושכים את מאפייני הקטעים (trace_attributes): מעברי חצייה, רמזורים וסוג הכביש שנחצה.
// 3. לכל חצייה מוסיפים זמן המתנה צפוי: רמזור על כביש ראשי ≈ 45 שנ', מעבר בלי רמזור בכביש שכונתי ≈ 3 שנ'.
// 4. בוחרים את המסלול עם זמן ההגעה הריאליסטי הקצר ביותר, ולא בהכרח את הקצר ביותר במרחק.
//
// גיבוי: אם Valhalla לא זמין, OSRM (פרופיל foot) עם הערכה גסה של זמני חצייה.

import { fetchWithTimeout, distanceMeters } from './geo.js?v=1.10.0-mvu2228r';
import { decodePolyline } from './polyline.js?v=1.10.0-mvu2228r';

const VALHALLA_BASE = 'https://valhalla1.openstreetmap.de';
const OSRM_FOOT_BASE = 'https://routing.openstreetmap.de/routed-foot';
const USER_AGENT = 'Walkie/0.3 (pedestrian & bus navigation)';

const WALK_KMH = 4.7;
const MAX_WALK_DISTANCE_M = 25000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 500;

const PEDESTRIAN_COSTING = {
  walking_speed: WALK_KMH,
  walkway_factor: 0.9,      // העדפה קלה לשבילים
  sidewalk_factor: 0.9,     // ולמדרכות
  alley_factor: 2,          // הימנעות מסמטאות
  driveway_factor: 5,       // הימנעות חזקה מחניונים/שבילי גישה
  step_penalty: 10,         // מדרגות – קנס קל
  use_ferry: 0,
  use_living_streets: 0.6,
  use_tracks: 0.3
};

// דירוג סוג כביש, וזמן המתנה צפוי (שניות) לפי סוג הכביש שנחצה
const CLASS_RANK = {
  service_other: 0,
  residential: 1,
  unclassified: 2,
  tertiary: 3,
  secondary: 4,
  primary: 5,
  trunk: 6,
  motorway: 7
};
const SIGNAL_WAIT_S = [10, 15, 18, 28, 35, 45, 55, 60];
const UNSIGNALIZED_WAIT_S = [2, 3, 4, 7, 10, 14, 25, 30];

const ROAD_USES = new Set(['road', 'living_street', 'service_road', 'parking_aisle', 'driveway', 'alley']);

export class RoutingError extends Error {
  constructor(message, code = 'routing_failed') {
    super(message);
    this.code = code;
  }
}

function rankOf(roadClass) {
  return CLASS_RANK[roadClass] ?? 0;
}

// סוג הכביש החשוב ביותר שנחצה בצומת (מתוך הקטעים המצטלבים)
function crossedRoadRank(...nodes) {
  let best = -1;
  for (const node of nodes) {
    for (const ie of node?.intersecting_edges ?? []) {
      if (ie.use && ie.use !== 'road') continue;
      best = Math.max(best, rankOf(ie.road_class));
    }
  }
  return best;
}

/**
 * מנתח את קטעי המסלול ומחזיר אירועי חצייה עם זמן המתנה צפוי לכל אחד.
 * edges – מ-trace_attributes. geometry – נקודות המסלול [lat,lng].
 */
export function analyzeCrossings(edges, geometry) {
  const events = [];
  let i = 0;

  while (i < edges.length) {
    const edge = edges[i];
    const prevNode = i > 0 ? edges[i - 1].end_node : null;

    if (edge.use === 'pedestrian_crossing') {
      // מעבר חצייה ממופה – לפעמים מפוצל לכמה קטעים רצופים
      let j = i;
      let signal = !!(edge.traffic_signal || prevNode?.traffic_signal);
      const nodes = [prevNode];
      while (j < edges.length && edges[j].use === 'pedestrian_crossing') {
        signal = signal || !!edges[j].traffic_signal || !!edges[j].end_node?.traffic_signal;
        nodes.push(edges[j].end_node);
        j++;
      }
      const rank = Math.max(0, crossedRoadRank(...nodes));
      const at = geometry[Math.min(geometry.length - 1, edge.begin_shape_index ?? 0)];
      events.push({
        kind: 'marked',
        signal,
        rank,
        waitS: signal ? SIGNAL_WAIT_S[rank] : UNSIGNALIZED_WAIT_S[rank],
        lat: at?.[0],
        lng: at?.[1]
      });
      i = j;
      continue;
    }

    // הליכה לאורך כביש (בלי מדרכה ממופה) שמגיעה לצומת – חצייה מרומזת
    const node = edge.end_node;
    const next = edges[i + 1];
    if (
      next &&
      ROAD_USES.has(edge.use) &&
      node?.type === 'street_intersection' &&
      next.use !== 'pedestrian_crossing'
    ) {
      const rank = crossedRoadRank(node);
      if (rank >= 0) {
        const signal = !!node.traffic_signal;
        const at = geometry[Math.min(geometry.length - 1, edge.end_shape_index ?? 0)];
        events.push({
          kind: 'implicit',
          signal,
          rank,
          // חצייה מרומזת לא תמיד קורית בפועל (לפעמים ממשיכים באותו צד) – חצי משקל
          waitS: Math.round((signal ? SIGNAL_WAIT_S[rank] : UNSIGNALIZED_WAIT_S[rank]) * 0.5),
          lat: at?.[0],
          lng: at?.[1]
        });
      }
    }
    i++;
  }

  return events;
}

function summarizeCrossings(events) {
  // מציגים רק חציות משמעותיות: כל רמזור, וכל מעבר ממופה
  const visible = events.filter((e) => e.signal || e.kind === 'marked');
  return {
    signalized: visible.filter((e) => e.signal).length,
    marked: visible.filter((e) => !e.signal).length,
    waitSeconds: events.reduce((sum, e) => sum + e.waitS, 0),
    list: visible
      .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng))
      .map((e) => ({ lat: e.lat, lng: e.lng, signal: e.signal, waitS: e.waitS }))
  };
}

// ---------- OSRM fallback: הוראות בעברית מתוך סוג התמרון ----------

const OSRM_MODIFIERS_HE = {
  left: 'פנה שמאלה',
  right: 'פנה ימינה',
  'slight left': 'פנה מעט שמאלה',
  'slight right': 'פנה מעט ימינה',
  'sharp left': 'פנה חדות שמאלה',
  'sharp right': 'פנה חדות ימינה',
  uturn: 'הסתובב',
  straight: 'המשך ישר'
};

// מיפוי לסוגי התמרון של Valhalla, כדי שללקוח יהיה פורמט אחד
const OSRM_TO_VALHALLA_TYPE = {
  left: 15,
  right: 10,
  'slight left': 16,
  'slight right': 9,
  'sharp left': 14,
  'sharp right': 11,
  uturn: 13,
  straight: 8
};

const OSRM_MODIFIERS_EN = {
  left: 'Turn left',
  right: 'Turn right',
  'slight left': 'Bear left',
  'slight right': 'Bear right',
  'sharp left': 'Turn sharp left',
  'sharp right': 'Turn sharp right',
  uturn: 'Make a U-turn',
  straight: 'Continue straight'
};

function osrmInstruction(step, lang = 'he') {
  const { type, modifier } = step.maneuver;
  if (lang === 'en') {
    const onto = step.name ? ` onto ${step.name}` : '';
    if (type === 'depart') return `Head out${step.name ? ` on ${step.name}` : ''}.`;
    if (type === 'arrive') return 'You have arrived.';
    if (type === 'roundabout' || type === 'rotary') return `Enter the roundabout and exit${onto}.`;
    return `${OSRM_MODIFIERS_EN[modifier] ?? 'Continue'}${onto}.`;
  }
  const street = step.name ? ` אל ${step.name}` : '';
  if (type === 'depart') return `צא לדרך${step.name ? ` על ${step.name}` : ''}.`;
  if (type === 'arrive') return 'הגעת ליעד.';
  if (type === 'roundabout' || type === 'rotary') return `היכנס לכיכר וצא${street}.`;
  return `${OSRM_MODIFIERS_HE[modifier] ?? 'המשך'}${street}.`;
}

// ---------- Router ----------

export class WalkRouter {
  #cache = new Map();

  constructor({ log = console } = {}) {
    this.log = log;
  }

  /** options.speedKmh – מהירות הליכה מההגדרות (איטית/רגילה/מהירה) */
  async route(from, to, { speedKmh = WALK_KMH, lang = 'he' } = {}) {
    const direct = distanceMeters(from, to);
    if (direct > MAX_WALK_DISTANCE_M) throw new RoutingError('Too far to walk', 'too_far');
    if (direct < 5) throw new RoutingError('Origin equals destination', 'too_close');

    const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}>${to.lat.toFixed(4)},${to.lng.toFixed(4)}@${speedKmh}|${lang}`;
    const hit = this.#cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

    let data;
    try {
      data = await this.#valhalla(from, to, speedKmh, lang);
    } catch (err) {
      if (err instanceof RoutingError && err.code === 'no_route') throw err;
      this.log.warn?.(`[route] Valhalla failed (${err.message}), falling back to OSRM`);
      data = await this.#osrm(from, to, speedKmh, lang);
    }

    this.#cache.set(key, { at: Date.now(), data });
    if (this.#cache.size > MAX_CACHE) this.#cache.delete(this.#cache.keys().next().value);
    return data;
  }

  async #valhalla(from, to, speedKmh, lang = 'he') {
    const costing = { ...PEDESTRIAN_COSTING, walking_speed: speedKmh };
    const request = {
      locations: [
        { lat: from.lat, lon: from.lng },
        { lat: to.lat, lon: to.lng }
      ],
      costing: 'pedestrian',
      costing_options: { pedestrian: costing },
      alternates: 2,
      directions_options: { units: 'kilometers', language: lang === 'en' ? 'en-US' : 'he-IL' }
    };

    const res = await fetchWithTimeout(
      `${VALHALLA_BASE}/route?json=${encodeURIComponent(JSON.stringify(request))}`,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
      12000
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.trip) {
      // 442 = לא נמצא מסלול בין הנקודות
      if (json?.error_code === 442 || json?.error_code === 171) throw new RoutingError('No route', 'no_route');
      throw new Error(`Valhalla HTTP ${res.status}: ${json?.error ?? ''}`);
    }

    const trips = [json.trip, ...(json.alternates ?? []).map((a) => a.trip)].filter(Boolean);
    const candidates = await Promise.all(trips.map((trip, idx) => this.#analyzeTrip(trip, idx === 0, costing)));

    // המסלול הנבחר: זמן ריאליסטי מינימלי
    candidates.sort((a, b) => a.realisticSeconds - b.realisticSeconds);
    const best = candidates[0];
    best.alternativesConsidered = candidates.length;
    best.chosenBecause =
      candidates.length > 1 && best !== candidates.find((c) => c.isPrimary)
        ? 'fewer_waits'
        : 'fastest';
    delete best.isPrimary;
    return best;
  }

  async #analyzeTrip(trip, isPrimary, costing = PEDESTRIAN_COSTING) {
    const leg = trip.legs[0];
    const geometry = decodePolyline(leg.shape, 6);
    const baseSeconds = Math.round(leg.summary.time);

    let crossings = { signalized: 0, marked: 0, waitSeconds: 0, list: [] };
    let analysis = 'full';
    try {
      const edges = await this.#traceAttributes(leg.shape, costing);
      crossings = summarizeCrossings(analyzeCrossings(edges, geometry));
    } catch (err) {
      this.log.warn?.(`[route] trace_attributes failed: ${err.message}`);
      analysis = 'estimated';
      crossings.waitSeconds = Math.round(baseSeconds * 0.08);
    }

    return {
      provider: 'valhalla',
      analysis,
      isPrimary, // המסלול ש-Valhalla עצמו העדיף
      distance: Math.round(leg.summary.length * 1000),
      baseSeconds,
      realisticSeconds: baseSeconds + crossings.waitSeconds,
      crossings,
      geometry,
      maneuvers: leg.maneuvers.map((m) => ({
        instruction: m.instruction,
        verbal: m.verbal_pre_transition_instruction ?? m.instruction,
        type: m.type,
        distance: Math.round((m.length ?? 0) * 1000),
        seconds: Math.round(m.time ?? 0),
        beginIndex: m.begin_shape_index,
        endIndex: m.end_shape_index,
        streets: m.street_names ?? []
      }))
    };
  }

  async #traceAttributes(encodedShape, costing = PEDESTRIAN_COSTING) {
    const body = {
      encoded_polyline: encodedShape,
      costing: 'pedestrian',
      costing_options: { pedestrian: costing },
      shape_match: 'edge_walk',
      filters: {
        action: 'include',
        attributes: [
          'edge.use',
          'edge.road_class',
          'edge.traffic_signal',
          'edge.begin_shape_index',
          'edge.end_shape_index',
          'node.type',
          'node.traffic_signal',
          'node.intersecting_edge.road_class',
          'node.intersecting_edge.use'
        ]
      }
    };
    const res = await fetchWithTimeout(
      `${VALHALLA_BASE}/trace_attributes`,
      {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body)
      },
      12000
    );
    if (!res.ok) throw new Error(`trace_attributes HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.edges)) throw new Error('trace_attributes: no edges');
    return json.edges;
  }

  async #osrm(from, to, speedKmh = WALK_KMH, lang = 'he') {
    const url =
      `${OSRM_FOOT_BASE}/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}` +
      '?overview=full&geometries=polyline&steps=true';
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, 12000);
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.code !== 'Ok' || !json.routes?.length) {
      if (json?.code === 'NoRoute') throw new RoutingError('No route', 'no_route');
      throw new RoutingError(`OSRM failed: ${json?.code ?? res.status}`);
    }

    const route = json.routes[0];
    const geometry = decodePolyline(route.geometry, 5);
    const baseSeconds = Math.round(route.distance / (speedKmh / 3.6));
    const waitSeconds = Math.round(baseSeconds * 0.08); // הערכה: ~8% המתנה בחציות

    // OSRM נותן נקודת תמרון; מוצאים לה אינדקס בגיאומטריה
    let cursor = 0;
    const indexOf = ([lng, lat]) => {
      let best = cursor;
      let bestD = Infinity;
      for (let k = cursor; k < geometry.length; k++) {
        const d = Math.abs(geometry[k][0] - lat) + Math.abs(geometry[k][1] - lng);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
        if (d < 1e-6) break;
      }
      cursor = best;
      return best;
    };

    const steps = route.legs[0].steps;
    const maneuvers = steps.map((s, k) => {
      const beginIndex = indexOf(s.maneuver.location);
      const type =
        s.maneuver.type === 'depart' ? 1 :
        s.maneuver.type === 'arrive' ? 4 :
        s.maneuver.type === 'roundabout' || s.maneuver.type === 'rotary' ? 26 :
        OSRM_TO_VALHALLA_TYPE[s.maneuver.modifier] ?? 8;
      return {
        instruction: osrmInstruction(s, lang),
        verbal: osrmInstruction(s),
        type,
        distance: Math.round(s.distance),
        seconds: Math.round(s.distance / (speedKmh / 3.6)),
        beginIndex,
        endIndex: k < steps.length - 1 ? null : geometry.length - 1,
        streets: s.name ? [s.name] : []
      };
    });
    maneuvers.forEach((m, k) => {
      if (m.endIndex === null) m.endIndex = maneuvers[k + 1].beginIndex;
    });

    return {
      provider: 'osrm',
      analysis: 'estimated',
      distance: Math.round(route.distance),
      baseSeconds,
      realisticSeconds: baseSeconds + waitSeconds,
      crossings: { signalized: 0, marked: 0, waitSeconds, list: [] },
      geometry,
      maneuvers,
      alternativesConsidered: 1,
      chosenBecause: 'fastest'
    };
  }
}
