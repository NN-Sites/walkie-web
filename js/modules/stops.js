// תחנות אוטובוס. סדר מקורות:
//   1. ה-API שלנו – GTFS רשמי של משרד התחבורה (כולל קודי תחנה -> זמני הגעה בזמן אמת)
//   2. OpenStreetMap דרך Overpass (גיבוי, אם אין backend)
//   3. תחנות דמה (גיבוי אחרון, כדי שהאפליקציה לעולם לא תהיה ריקה)

import {
  STOP_CELL_DEG,
  STOP_SEARCH_RADIUS_M,
  STOP_CACHE_TTL_MS,
  MAX_STOPS,
  STORAGE_KEYS
} from '../config.js?v=1.5.0-mvjqsjqk';
import { offsetMeters } from './geo.js?v=1.5.0-mvjqsjqk';
import { t } from './i18n.js?v=1.5.0-mvjqsjqk';
import { fetchNearbyFromApi, fetchWithTimeout } from './api.js?v=1.5.0-mvjqsjqk';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const OVERPASS_TIMEOUT_MS = 7000;

function cellOf({ lat, lng }) {
  const cLat = Math.round(lat / STOP_CELL_DEG) * STOP_CELL_DEG;
  const cLng = Math.round(lng / STOP_CELL_DEG) * STOP_CELL_DEG;
  return {
    key: `${cLat.toFixed(3)},${cLng.toFixed(3)}`,
    center: { lat: cLat, lng: cLng }
  };
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.stopsPrefix + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || Date.now() - entry.savedAt > STOP_CACHE_TTL_MS) return null;
    return Array.isArray(entry.stops) ? entry : null;
  } catch {
    return null;
  }
}

function writeCache(key, stops, source) {
  try {
    localStorage.setItem(
      STORAGE_KEYS.stopsPrefix + key,
      JSON.stringify({ savedAt: Date.now(), source, stops })
    );
  } catch {
    // אחסון מלא / חסום – ממשיכים בלי קאש
  }
}

// ---------- מקור 1: ה-API שלנו (GTFS) ----------

async function fromApi(center, signal) {
  const json = await fetchNearbyFromApi(center, STOP_SEARCH_RADIUS_M, signal);
  return (json.stops || []).slice(0, MAX_STOPS).map((s) => ({
    id: s.id,
    name: s.name || t('תחנה ללא שם'),
    code: s.code ?? null,
    city: s.city ?? null,
    lat: s.lat,
    lng: s.lng,
    routes: []
  }));
}

// ---------- מקור 2: Overpass (OSM) ----------

function buildOverpassQuery({ lat, lng }, radius) {
  return `[out:json][timeout:15];
(
  node["highway"="bus_stop"](around:${radius},${lat},${lng});
  node["public_transport"="platform"]["bus"="yes"](around:${radius},${lat},${lng});
);
out body ${MAX_STOPS};`;
}

function parseOverpass(elements) {
  const seen = new Set();
  const stops = [];
  for (const el of elements) {
    if (el.type !== 'node' || seen.has(el.id)) continue;
    seen.add(el.id);
    const tags = el.tags || {};
    const ref = tags.ref || tags['gtfs:stop_code'] || null;
    stops.push({
      id: `osm:${el.id}`,
      name: tags['name:he'] || tags.name || t('תחנה ללא שם'),
      // בישראל ref ב-OSM הוא בדרך כלל קוד התחנה של משרד התחבורה
      code: ref && /^\d{1,6}$/.test(ref) ? ref : null,
      city: null,
      lat: el.lat,
      lng: el.lon,
      routes: (tags.route_ref || '').split(/[;,]/).map((r) => r.trim()).filter(Boolean).slice(0, 12)
    });
  }
  return stops;
}

async function fromOverpass(center, signal) {
  const body = 'data=' + encodeURIComponent(buildOverpassQuery(center, STOP_SEARCH_RADIUS_M));
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body
        },
        { timeoutMs: OVERPASS_TIMEOUT_MS, signal }
      );
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const json = await res.json();
      if (json.remark && (!json.elements || json.elements.length === 0)) {
        throw new Error(`Overpass remark: ${json.remark}`);
      }
      return parseOverpass(json.elements || []);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      lastError = err;
    }
  }
  throw lastError ?? new Error('Overpass unavailable');
}

/**
 * מחזיר { stops, source } כאשר source הוא 'gtfs' | 'osm' | 'demo' (ועם fromCache).
 * זורק AbortError רק אם הבקשה בוטלה מבחוץ.
 */
export async function fetchNearbyStops(point, signal) {
  const { key, center } = cellOf(point);

  const cached = readCache(key);
  if (cached) return { stops: cached.stops, source: cached.source, fromCache: true };

  try {
    const stops = await fromApi(center, signal);
    writeCache(key, stops, 'gtfs');
    return { stops, source: 'gtfs', fromCache: false };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    console.info('[Walkie] API unavailable, trying OSM', err.message);
  }

  try {
    const stops = await fromOverpass(center, signal);
    if (stops.length > 0) writeCache(key, stops, 'osm');
    return { stops, source: 'osm', fromCache: false };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    console.warn('[Walkie] Overpass failed, using demo stops', err.message);
  }

  return { stops: demoStops(point), source: 'demo', fromCache: false };
}

// ---------- מקור 3: נתוני דמה ----------

const DEMO_STOP_NAMES = [
  'הרצל / בלפור',
  'מרכז העיר',
  'ספריה עירונית',
  'כיכר העצמאות',
  'בית ספר אלון',
  'קניון השרון'
];

const DEMO_OFFSETS = [
  [120, 60],
  [-90, 180],
  [240, -150],
  [-260, -80],
  [60, -320],
  [380, 260]
];

export function demoStops(point) {
  const { key } = cellOf(point);
  return DEMO_OFFSETS.map(([north, east], i) => {
    const pos = offsetMeters(point, north, east);
    return {
      id: `demo:${key}:${i}`,
      name: DEMO_STOP_NAMES[i],
      code: null,
      city: null,
      lat: pos.lat,
      lng: pos.lng,
      routes: [],
      isDemo: true
    };
  });
}

const DEMO_LINES = ['1', '4', '5', '18', '25', '42', '61', '66', '125', '189'];

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** זמני הגעה לדוגמה – רק לתחנות דמה. אותו מבנה כמו נתוני ה-API. */
export function demoArrivals(stop, now = Date.now()) {
  const rng = seededRandom(hashString(stop.id));
  const pool = [...DEMO_LINES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const lines = pool.slice(0, 3 + Math.floor(rng() * 3));
  const minute = Math.floor(now / 60000);
  const result = [];

  for (const line of lines) {
    const r = seededRandom(hashString(`${stop.id}|${line}`));
    const headway = 8 + Math.floor(r() * 17);
    const offset = Math.floor(r() * headway);
    const etaMin = (headway - ((minute + offset) % headway)) % headway;
    for (const m of [etaMin, etaMin + headway]) {
      result.push({
        line,
        destination: 'מסוף מרכזי',
        agency: null,
        eta: new Date((minute + m) * 60000).toISOString(),
        vehicle: null
      });
    }
  }
  return result;
}

// צבעי המפעילים (כמו על האוטובוסים עצמם). ההתאמה לפי חלק מהשם: "אלקטרה אפיקים" -> אפיקים.
// הסדר חשוב: "אגד תעבורה" לפני "אגד", "דן בדרום" נתפס ב"דן".
const OPERATOR_COLORS = [
  ['אפיקים', '#5fa31a'],      // ירוק בהיר
  ['אגד תעבורה', '#0f766e'],
  ['אגד', '#0b6b3a'],         // ירוק כהה
  ['מטרופולין', '#ea7a0c'],   // כתום
  ['סופרבוס', '#c62828'],
  ['קווים', '#7e3fa0'],
  ['נתיב אקספרס', '#b45309'],
  ['אקסטרה', '#be185d'],
  ['גלים', '#0284c7'],
  ['תנופה', '#d97706'],
  ['בית שמש אקספרס', '#4338ca'],
  ['כפיר', '#0e7490'],
  ['ש.א.מ', '#9333ea'],
  ['גולן', '#8d5a2b'],
  ['דן', '#1d5fbf']           // כחול (דן, דן בדרום, דן באר שבע)
];

/** צבע המפעיל לפי שם החברה, או null אם לא מוכרת */
export function operatorColor(agency) {
  if (!agency) return null;
  const name = String(agency);
  return OPERATOR_COLORS.find(([key]) => name.includes(key))?.[1] ?? null;
}

/** צבע קו: לפי המפעיל אם ידוע, אחרת צבע קבוע לפי מספר הקו */
export function lineColor(line, agency = null) {
  const op = operatorColor(agency);
  if (op) return op;
  const palette = ['#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#4f46e5'];
  return palette[hashString(String(line)) % palette.length];
}
