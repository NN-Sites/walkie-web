// אינדקס תחנות ארצי מ-GTFS של משרד התחבורה (דרך Stride API של הסדנא לידע ציבורי).
// נטען פעם ביום לזיכרון, עם קאש (דיסק בשרת / IndexedDB באפליקציה), ומאונדקס ברשת (Grid) לחיפוש מהיר לפי מיקום.

import { distanceMeters, israelDate, fetchWithTimeout } from './geo.js?v=1.10.0-mvu1kw0g';

const STRIDE_BASE = 'https://open-bus-stride-api.hasadna.org.il';
const PAGE_SIZE = 15000;          // המקסימום שה-API מאפשר לבקשה
const MAX_PAGES = 10;
const STALE_MAX_DAYS = 21;        // קאש ישן עד כמה ימים משמש מיד (ומתרענן ברקע)
const CELL_DEG = 0.01;            // ~1.1 ק"מ
const USER_AGENT = 'Walkie/0.2 (pedestrian & bus navigation)';

const cellKey = (latIdx, lngIdx) => `${latIdx}:${lngIdx}`;

// תחנות רכבת ישראל (וכרמלית) ב-GTFS של משרד התחבורה הן בקודים 17xxx.
// יש גם כמה תחנות אוטובוס בטווח הזה (למשל באשדוד) – לתחנת אוטובוס יש "רחוב/רחוב" בשם
export const stopMode = (s) => (/^17\d{3}$/.test(s.code) && !String(s.name ?? '').includes('/') ? 'rail' : 'bus');

// נרמול טקסט עברי לחיפוש: בלי גרשיים/מקפים/לוכסנים, רווחים בודדים
function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/["'`׳״]/g, '')
    .replace(/[-–/\\.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class StopsIndex {
  /** cache = { read(key), write(key, value) } – ראו fs-cache.js */
  constructor({ cache = null, log = console } = {}) {
    this.cache = cache;
    this.refreshing = null;
    this.log = log;
    this.date = null;
    this.stops = [];
    this.cells = new Map();
    this.byCode = new Map();
    this.searchKeys = [];
    this.loading = null;
  }

  get size() {
    return this.stops.length;
  }

  async ensureLoaded() {
    const today = israelDate();
    if (this.date === today && this.stops.length > 0) return;
    if (!this.loading) {
      this.loading = this.#load(today).finally(() => {
        this.loading = null;
      });
    }
    await this.loading;
    if (this.stops.length === 0) throw new Error('Stops index is empty');
  }

  nearby({ lat, lng }, radiusM = 700, limit = 60) {
    const latSpan = Math.ceil(radiusM / 111320 / CELL_DEG);
    const lngSpan = Math.ceil(radiusM / (111320 * Math.cos((lat * Math.PI) / 180)) / CELL_DEG);
    const latIdx = Math.floor(lat / CELL_DEG);
    const lngIdx = Math.floor(lng / CELL_DEG);
    const origin = { lat, lng };
    const found = [];

    for (let i = latIdx - latSpan; i <= latIdx + latSpan; i++) {
      for (let j = lngIdx - lngSpan; j <= lngIdx + lngSpan; j++) {
        const bucket = this.cells.get(cellKey(i, j));
        if (!bucket) continue;
        for (const stop of bucket) {
          const d = distanceMeters(origin, stop);
          if (d <= radiusM) found.push({ stop, d });
        }
      }
    }

    return found
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map(({ stop, d }) => ({ ...stop, mode: stopMode(stop), distance: Math.round(d) }));
  }

  /** חיפוש תחנה לפי קוד (מדויק) או לפי מילים בשם/עיר, ממוין לפי קרבה */
  search(query, near = null, limit = 5) {
    const q = normalizeText(query);
    if (!q) return [];

    if (/^\d{2,6}$/.test(q)) {
      const exact = this.byCode.get(q);
      if (exact) return [exact];
    }

    const tokens = q.split(' ');
    const matches = [];
    for (let k = 0; k < this.stops.length; k++) {
      const hay = this.searchKeys[k];
      if (!tokens.every((t) => hay.includes(t))) continue;
      const stop = this.stops[k];
      const startsWith = hay.startsWith(tokens[0]) ? 0 : 1;
      const d = near ? distanceMeters(near, stop) : 0;
      // תחנת רכבת היא כמעט תמיד מה שמחפשים כשהיא מתאימה – לפני תחנות אוטובוס באותו שם
      const rail = stopMode(stop) === 'rail' ? -200000 : 0;
      matches.push({ stop, score: rail + startsWith * 50000 + d });
      if (matches.length > 400) break;
    }

    return matches
      .sort((a, b) => a.score - b.score)
      .slice(0, limit)
      .map((m) => m.stop);
  }

  async #load(today) {
    // 1. קאש של היום – או קאש ישן שמשמש מיד בזמן שמרעננים ברקע (תחנות כמעט לא משתנות)
    const cached = await this.#readCache();
    if (cached?.date === today) {
      this.#build(today, cached.stops);
      this.log.info?.(`[stops] loaded ${cached.stops.length} stops from cache (${today})`);
      return;
    }
    if (cached && daysBetween(cached.date, today) <= STALE_MAX_DAYS) {
      this.#build(today, cached.stops);
      this.log.info?.(`[stops] using cached stops from ${cached.date}, refreshing in background`);
      this.#refreshInBackground(today);
      return;
    }

    // 2. Stride – היום, ואם עוד לא עודכן אז אתמול
    if (await this.#loadFromStride(today)) return;

    // 3. נשארים עם הנתונים הקודמים אם יש (או עם קאש ישן מאוד)
    if (this.stops.length > 0) {
      this.log.warn?.('[stops] keeping previous index');
      return;
    }
    if (cached) {
      this.#build(today, cached.stops);
      this.log.warn?.(`[stops] Stride unavailable, using old cache from ${cached.date}`);
      return;
    }
    throw new Error('Could not load stops from any source');
  }

  async #loadFromStride(today) {
    for (const date of [today, israelDate(-1)]) {
      try {
        const stops = await this.#fetchFromStride(date);
        if (stops.length > 0) {
          this.#build(today, stops);
          await this.cache?.write('stops', { date: today, stops });
          this.log.info?.(`[stops] loaded ${stops.length} stops from Stride (gtfs date ${date})`);
          return true;
        }
      } catch (err) {
        this.log.warn?.(`[stops] Stride fetch failed for ${date}: ${err.message}`);
      }
    }
    return false;
  }

  #refreshInBackground(today) {
    if (this.refreshing) return;
    this.refreshing = this.#loadFromStride(today).finally(() => {
      this.refreshing = null;
    });
  }

  async #fetchFromStride(date) {
    const all = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url =
        `${STRIDE_BASE}/gtfs_stops/list?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}` +
        `&date_from=${date}&date_to=${date}`;
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }, 60000);
      if (!res.ok) throw new Error(`Stride HTTP ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error('Unexpected Stride response');
      for (const r of rows) {
        if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon) || r.code == null) continue;
        all.push({
          id: `gtfs:${r.code}`,
          code: String(r.code),
          name: r.name || 'תחנה ללא שם',
          city: r.city || null,
          lat: r.lat,
          lng: r.lon
        });
      }
      if (rows.length < PAGE_SIZE) break;
    }

    // הסרת כפילויות לפי קוד תחנה
    const byCode = new Map();
    for (const s of all) byCode.set(s.code, s);
    return [...byCode.values()];
  }

  #build(date, stops) {
    const cells = new Map();
    for (const s of stops) {
      const key = cellKey(Math.floor(s.lat / CELL_DEG), Math.floor(s.lng / CELL_DEG));
      let bucket = cells.get(key);
      if (!bucket) {
        bucket = [];
        cells.set(key, bucket);
      }
      bucket.push(s);
    }
    this.date = date;
    this.stops = stops;
    this.cells = cells;
    this.byCode = new Map(stops.map((s) => [s.code, s]));
    // לתחנות רכבת אין עיר ב-GTFS – מוסיפים "רכבת" כדי שיימצאו גם בחיפוש "רכבת השלום"
    this.searchKeys = stops.map((s) => normalizeText(`${s.name} ${s.city ?? ''}${stopMode(s) === 'rail' ? ' רכבת תחנת רכבת' : ''}`));
  }

  async #readCache() {
    const data = await this.cache?.read('stops');
    return typeof data?.date === 'string' && Array.isArray(data.stops) && data.stops.length > 0 ? data : null;
  }
}

function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000);
}
