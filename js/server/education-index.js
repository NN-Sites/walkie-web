// אינדקס מוסדות חינוך רשמי – משרד החינוך (data.gov.il, "מוסדות חינוך").
// משלים את OpenStreetMap: ב-OSM חסרים בתי ספר רבים (למשל "אור העתיד"), ובמאגר הרשמי יש את כולם.
//
// פרטיות: נכללים רק בתי ספר וגני ילדים. מעונות יום ומשפחתונים לא נכללים – רבים מהם בבתים פרטיים.

import { distanceMeters, israelDate, fetchWithTimeout } from './geo.js?v=1.10.0-mvu2khrx';
import { itmToWgs84 } from './itm.js?v=1.10.0-mvu2khrx';

const DATASTORE = 'https://data.gov.il/api/3/action/datastore_search';
const RESOURCE_ID = '2055063b-93e8-4d6a-b2c5-c253d18c0cf6';
const PAGE_SIZE = 32000;
const USER_AGENT = 'Walkie/0.5 (pedestrian & bus navigation)';
const REFRESH_DAYS = 7;   // המאגר מתעדכן לאט – פעם בשבוע מספיק

const INCLUDED_TYPES = new Set(['בית ספר', 'גן ילדים']);
const FIELDS = ['SEMEL_MOSAD', 'SHEM_MOSAD', 'ISV_SHEM_ISHUV', 'TEUR_TAT_SUG_MISGERET', 'TEUR_STATUS', 'TEUR_SHLAV_HINUH', 'TEUR_PIKOH1', 'X', 'Y'];

// מילים כלליות שלא מופיעות בשם הרשמי: "בית ספר אור העתיד" -> "אור העתיד"
const GENERIC_WORDS = new Set(['בית', 'ספר', 'ביס', 'ביהס', 'בהס', 'גן', 'ילדים', 'גני', 'של', 'עש']);
const KINDERGARTEN_WORDS = new Set(['גן', 'גני', 'ילדים']);

// מרשמים נפוצים: "ממד" / "ממ"ד", "חטב" / "חט"ב", "בי"ס" – בלי גרשיים בשני הצדדים
function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/["״׳']/g, '')
    .replace(/[-–/\\.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** שמות במאגר נחתכים ב-20 תווים ("מכללת אור העתיד גן י") – מסירים שארית של שם היישוב */
function cleanName(name, city) {
  let n = String(name ?? '').trim();
  if (city) {
    for (let k = city.length; k >= 1; k--) {
      const tail = city.slice(0, k);
      if (n.endsWith(` ${tail}`) && n.length - tail.length > 3) {
        n = n.slice(0, n.length - tail.length - 1).trim();
        break;
      }
    }
  }
  return n.replace(/\s+/g, ' ');
}

function stageLabel(stage) {
  if (!stage) return null;
  if (stage.includes('יסודי')) return 'יסודי';
  if (stage.includes('ביניים')) return 'חטיבת ביניים';
  if (stage.includes('עליונה')) return 'תיכון';
  return null;
}

export class EducationIndex {
  /** cache = { read(key), write(key, value) } – ראו fs-cache.js */
  constructor({ cache = null, log = console } = {}) {
    this.cache = cache;
    this.log = log;
    this.items = [];
    this.keys = [];
    this.nameKeys = [];
    this.loadedAt = null;
    this.loading = null;
  }

  get size() {
    return this.items.length;
  }

  async ensureLoaded() {
    if (this.items.length > 0 && this.loadedAt && Date.now() - this.loadedAt < REFRESH_DAYS * 86400000) return;
    if (!this.loading) {
      this.loading = this.#load().finally(() => {
        this.loading = null;
      });
    }
    await this.loading;
  }

  /**
   * חיפוש לפי שם (+ עיר / שלב: "תיכון", "יסודי"): כל המילים הלא-כלליות צריכות להופיע.
   * ממוין לפי קרבה, עם קנס (בק"מ) לגן ילדים כשמחפשים בית ספר, להתאמה באמצע מילה ולשם שלא מתחיל במילה הראשונה.
   */
  search(query, near = null, limit = 5) {
    const words = normalizeText(query).split(' ').filter(Boolean);
    const tokens = words.filter((t) => !GENERIC_WORDS.has(t));
    if (tokens.length === 0) return [];
    const wantsKindergarten = words.some((w) => KINDERGARTEN_WORDS.has(w));
    const wantsSchool = !wantsKindergarten && words.some((w) => ['ספר', 'ביס', 'ביהס', 'תיכון', 'יסודי', 'חטב', 'מקיף'].includes(w));

    const matches = [];
    for (let i = 0; i < this.items.length; i++) {
      const hay = this.keys[i];
      if (!tokens.every((t) => hay.includes(t))) continue;
      const item = this.items[i];
      const isKindergarten = item.type === 'גן ילדים';
      if (wantsSchool && isKindergarten) continue;
      const nameKey = this.nameKeys[i];
      const wordStarts = tokens.filter((t) => hay.startsWith(t) || hay.includes(` ${t}`)).length;
      const km = near ? distanceMeters(near, item) / 1000 : 0;
      const score = km
        + (nameKey.startsWith(tokens[0]) ? 0 : 6)
        + (tokens.length - wordStarts) * 8
        + (isKindergarten && !wantsKindergarten ? 15 : 0);
      matches.push({ item, d: km * 1000, score });
    }

    return matches
      .sort((a, b) => a.score - b.score)
      .slice(0, limit)
      .map(({ item, d }) => ({ ...item, distance: near ? Math.round(d) : undefined }));
  }

  /** מוסדות הכי קרובים למיקום (בית ספר, או גן ילדים) ברדיוס נתון, ממוינים לפי מרחק */
  nearby(near, { kindergarten = false } = {}, radiusKm = 5, limit = 25) {
    const want = kindergarten ? 'גן ילדים' : 'בית ספר';
    const out = [];
    for (const item of this.items) {
      if (item.type !== want) continue;
      if (Math.abs(item.lat - near.lat) > radiusKm / 111) continue;
      const d = distanceMeters(near, item);
      if (d <= radiusKm * 1000) out.push({ ...item, distance: Math.round(d) });
    }
    return out.sort((a, b) => a.distance - b.distance).slice(0, limit);
  }

  async #load() {
    const cached = await this.#readCache();
    if (cached) {
      this.#build(cached.items, cached.savedAt);
      this.log.info?.(`[edu] loaded ${cached.items.length} institutions from cache`);
      // קאש ישן: משמש מיד, ומתרענן ברקע
      if (Date.now() - cached.savedAt > REFRESH_DAYS * 86400000) {
        this.loadedAt = Date.now();
        this.#fetchAndStore().catch((err) => this.log.warn?.(`[edu] background refresh failed: ${err.message}`));
      }
      return;
    }

    try {
      await this.#fetchAndStore();
    } catch (err) {
      this.log.warn?.(`[edu] load failed: ${err.message}`);
      if (this.items.length === 0) throw err;
    }
  }

  async #fetchAndStore() {
    const items = await this.#fetchAll();
    this.#build(items, Date.now());
    await this.#writeCache(items);
    this.log.info?.(`[edu] loaded ${items.length} institutions from data.gov.il`);
  }

  async #fetchAll() {
    const items = [];
    for (let offset = 0; offset < 200000; offset += PAGE_SIZE) {
      const params = new URLSearchParams({
        resource_id: RESOURCE_ID,
        limit: String(PAGE_SIZE),
        offset: String(offset),
        fields: FIELDS.join(','),
        filters: JSON.stringify({ TEUR_STATUS: 'פעיל' })
      });
      const res = await fetchWithTimeout(`${DATASTORE}?${params}`, { headers: { 'User-Agent': USER_AGENT } }, 90000);
      if (!res.ok) throw new Error(`data.gov.il HTTP ${res.status}`);
      const json = await res.json();
      const records = json.result?.records ?? [];

      for (const r of records) {
        if (!INCLUDED_TYPES.has(r.TEUR_TAT_SUG_MISGERET)) continue;
        const x = Number(r.X);
        const y = Number(r.Y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 100000 || y < 350000) continue;
        const { lat, lng } = itmToWgs84(x, y);
        const city = r.ISV_SHEM_ISHUV?.trim() || null;
        items.push({
          id: `edu:${r.SEMEL_MOSAD}`,
          name: cleanName(r.SHEM_MOSAD, city),
          city,
          type: r.TEUR_TAT_SUG_MISGERET,
          stage: stageLabel(r.TEUR_SHLAV_HINUH),
          sector: r.TEUR_PIKOH1 ?? null,
          lat: Math.round(lat * 1e6) / 1e6,
          lng: Math.round(lng * 1e6) / 1e6
        });
      }
      if (records.length < PAGE_SIZE) break;
    }
    return items;
  }

  #build(items, savedAt) {
    this.items = items;
    this.loadedAt = savedAt;
    this.nameKeys = items.map((it) => normalizeText(it.name));
    // השלב והסוג בתוך המפתח – "תיכון דה שליט" נמצא גם כשהמילה "תיכון" לא בשם הרשמי
    this.keys = items.map((it, i) => `${this.nameKeys[i]} ${normalizeText(`${it.city ?? ''} ${it.stage ?? ''} ${it.stage === 'חטיבת ביניים' ? 'חטב' : ''} ${it.type ?? ''}`)}`);
  }

  async #readCache() {
    const data = await this.cache?.read('education');
    return Array.isArray(data?.items) && data.items.length > 0 && Number.isFinite(data.savedAt) ? data : null;
  }

  async #writeCache(items) {
    await this.cache?.write('education', { savedAt: Date.now(), date: israelDate(), items });
  }
}
