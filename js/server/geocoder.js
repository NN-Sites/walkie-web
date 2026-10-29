// חיפוש יעדים:
//  - טקסט חופשי: עסקים, מקומות וכתובות (Photon, מבוסס OSM), בתי ספר וגנים (מאגר משרד החינוך),
//    ותחנות אוטובוס (GTFS). "גרג יבנה", "בית ספר אור העתיד", "רמי לוי", "דיזנגוף 50".
//  - קטגוריה ("מסעדה", "בתי ספר", "סופר"...): כל המקומות מהסוג הזה סביב המשתמש, לפי מרחק.

import { fetchWithTimeout, distanceMeters } from './geo.js?v=1.10.0-mvu2228r';
import { getCategory, matchCategory, labelForTag } from './categories.js?v=1.10.0-mvu2228r';

const PHOTON_SEARCH = 'https://photon.komoot.io/api/';
const PHOTON_REVERSE = 'https://photon.komoot.io/reverse';
const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const ISRAEL_BBOX = '34.2,29.4,35.95,33.4';
const USER_AGENT = 'Walkie/0.5 (pedestrian & bus navigation)';

// Photon הציבורי לפעמים עמוס/נופל. אחרי כישלון – מדלגים עליו לדקה ועוברים ל-Nominatim
const PHOTON_COOLDOWN_MS = 3 * 60 * 1000;
// מדיניות Nominatim: לכל היותר בקשה אחת בשנייה (נאכף בתור בצד השרת)
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 1000;

// חיפוש קטגוריה: קודם רדיוס הליכה, ואם יש מעט תוצאות – מרחיבים
const CATEGORY_RADII_KM = [1.5, 5, 15];
const CATEGORY_MIN_RESULTS = 6;
const CATEGORY_MAX_RESULTS = 25;

// חיפוש טקסט: אזור "מקומי" סביב המשתמש (~30 ק"מ)
const LOCAL_DLAT = 0.14;
const LOCAL_DLNG = 0.17;
const MAX_TEXT_RESULTS = 12;

const POI_KEYS = new Set(['amenity', 'shop', 'tourism', 'leisure', 'office', 'building', 'healthcare', 'historic', 'railway', 'public_transport', 'aeroway', 'craft', 'club', 'sport']);
const AREA_TYPES = new Set(['city', 'locality', 'district', 'county', 'state']);

// מילים כלליות שלא חייבות להופיע בשם: "בית ספר אור העתיד" -> מספיק "אור העתיד"
const GENERIC_WORDS = new Set(['בית', 'ספר', 'ביס', 'בי"ס', 'ביה"ס', 'סניף']);

function kindOf(p) {
  if (AREA_TYPES.has(p.type)) return 'area';
  if (POI_KEYS.has(p.osm_key)) return 'poi';
  if (p.osm_key === 'highway' && !p.housenumber) return 'street';
  if (p.type === 'house' || p.housenumber) return 'address';
  return 'place';
}

// תחנות אוטובוס מ-OSM – כבר יש לנו אותן מה-GTFS הרשמי
function isTransitStop(p) {
  return p.osm_value === 'bus_stop' || p.osm_value === 'platform' || p.osm_value === 'stop_position';
}

function normalizeFeature(f, { fallbackLabel = null } = {}) {
  const p = f.properties ?? {};
  if (isTransitStop(p)) return null;
  const [lng, lat] = f.geometry?.coordinates ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const tag = labelForTag(p.osm_key, p.osm_value);
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  // מקום בלי שם (למשל כספומט) – מציגים את סוג המקום
  const name = p.name || (fallbackLabel ? (tag?.label ?? fallbackLabel) : street);
  if (!name) return null;

  const city = p.city || p.locality || p.district || p.county || null;
  const subtitleParts = [];
  if (tag?.label && tag.label !== name) subtitleParts.push(tag.label);
  if (street && street !== name) subtitleParts.push(street);
  if (city && city !== name) subtitleParts.push(city);

  return {
    id: `osm:${p.osm_type ?? ''}${p.osm_id ?? `${lat},${lng}`}`,
    kind: kindOf(p),
    name,
    subtitle: subtitleParts.join(' · ') || null,
    category: tag?.id ?? null,
    emoji: tag?.emoji ?? null,
    lat,
    lng
  };
}

const NOMINATIM_AREA_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter', 'county', 'state', 'municipality']);

/** תוצאת Nominatim -> אותו פורמט כמו Photon */
function normalizeNominatim(x, { fallbackLabel = null } = {}) {
  if (!x || ['bus_stop', 'platform', 'stop_position'].includes(x.type)) return null;
  const lat = Number(x.lat);
  const lng = Number(x.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const a = x.address ?? {};
  const tag = labelForTag(x.category, x.type);
  const street = [a.road, a.house_number].filter(Boolean).join(' ');
  const name = x.name || (fallbackLabel ? (tag?.label ?? fallbackLabel) : street) || String(x.display_name ?? '').split(',')[0];
  if (!name) return null;

  const city = a.city || a.town || a.village || a.suburb || null;
  const subtitleParts = [];
  if (tag?.label && tag.label !== name) subtitleParts.push(tag.label);
  if (street && street !== name) subtitleParts.push(street);
  if (city && city !== name) subtitleParts.push(city);

  let kind = 'place';
  if (x.type === 'house' || (a.house_number && x.category !== 'highway')) kind = 'address';
  else if (NOMINATIM_AREA_TYPES.has(x.addresstype) || x.category === 'boundary' || x.category === 'place') kind = 'area';
  else if (POI_KEYS.has(x.category)) kind = 'poi';
  else if (x.category === 'highway') kind = 'street';
  else if (a.house_number) kind = 'address';

  const osmType = String(x.osm_type ?? '').charAt(0).toUpperCase();
  return {
    id: `osm:${osmType}${x.osm_id ?? `${lat},${lng}`}`,
    kind,
    name,
    subtitle: subtitleParts.join(' · ') || null,
    category: tag?.id ?? null,
    emoji: tag?.emoji ?? null,
    lat,
    lng
  };
}

function viewbox(near, dLat, dLng) {
  // Nominatim: left,top,right,bottom
  return [near.lng - dLng, near.lat + dLat, near.lng + dLng, near.lat - dLat].map((v) => v.toFixed(4)).join(',');
}

// ---------- רלוונטיות ----------

function norm(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[״"׳'`]/g, '')
    .replace(/[-–־/\\.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTokens(query) {
  const all = norm(query).split(' ').filter((t) => t.length >= 2);
  const specific = all.filter((t) => !GENERIC_WORDS.has(t));
  return specific.length ? specific : all;
}

/**
 * כתובת מדויקת: "הרצל 10 חיפה", "10 הרצל", "דיזנגוף 99א". מספר בית הוא מילה של 1-4 ספרות (אפשר עם אות).
 * מספר לבד הוא קוד תחנה, ולכן דורשים לפחות עוד מילה.
 */
function parseAddress(query) {
  const tokens = String(query ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const number = tokens.find((t) => /^\d{1,4}[א-תa-z]?$/i.test(t));
  if (!number) return null;
  return { number: norm(number), raw: number };
}

/** האם התוצאה היא בדיוק הבית המבוקש (מספר הבית מופיע בשם או בכתובת) */
function hasHouseNumber(r, number) {
  const text = ` ${norm(r.name)} ${norm(r.subtitle)} `;
  return text.includes(` ${number} `);
}

/**
 * כמה התוצאה מתאימה לשאילתה:
 *  full      – כל המילים מופיעות בשם או בכתובת ("קפה גרג · יבנה" עבור "גרג יבנה")
 *  firstInName – המילה הראשונה (בדרך כלל שם המקום) מופיעה בשם
 */
function matchInfo(r, tokens) {
  const name = norm(r.name);
  const all = `${name} ${norm(r.subtitle)}`;
  let hits = 0;
  for (const t of tokens) if (all.includes(t)) hits++;
  return {
    full: tokens.length > 0 && hits === tokens.length,
    firstInName: tokens.length > 0 && name.includes(tokens[0]),
    anyInName: tokens.some((t) => name.includes(t))
  };
}

/**
 * דירוג: התאמה מלאה > השם מתחיל במילה הראשונה > התאמה חלקית; עסקים לפני ערים/אזורים;
 * בתוך כל דרגה – קרוב (עד 3 ק"מ) לפי מרחק, ואז סדר הרלוונטיות של מנוע החיפוש.
 */
function rankResults(results, tokens, addr = null) {
  const tier = (d) => (!Number.isFinite(d) ? 1 : d <= 3000 ? 0 : d <= 15000 ? 1 : 2);
  return results
    .map((r, index) => {
      const m = matchInfo(r, tokens);
      const exact = addr && hasHouseNumber(r, addr.number) && m.full && tokens.some((t) => t !== addr.number && norm(r.name).split(' ').includes(t));
      // מספר הבית נמצא, אבל ברחוב אחר ("הרצליה 10" עבור "הרצל 10"): לא התאמה טובה
      const wrongStreet = addr && !exact && hasHouseNumber(r, addr.number);
      const bucket = exact ? 0 : wrongStreet ? 2 : m.full && m.anyInName ? 0 : m.firstInName ? 1 : m.anyInName ? 2 : 3;
      return { r, index, bucket, area: r.kind === 'area' ? 1 : 0, tier: tier(r.distance) };
    })
    .sort((a, b) =>
      a.bucket - b.bucket ||
      a.area - b.area ||
      a.tier - b.tier ||
      (a.tier === 0 ? a.r.distance - b.r.distance : a.index - b.index))
    .map(({ r, bucket }) => ({ ...r, _bucket: bucket }));
}

/** איחוד רשימות תוצאות לפי מזהה, שומר על הסדר */
function mergeById(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const r of list) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

function similarName(a, b) {
  const x = norm(a).replace(/\s/g, '');
  const y = norm(b).replace(/\s/g, '');
  return x === y || x.includes(y) || y.includes(x);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Geocoder ----------

export class Geocoder {
  #cache = new Map();

  constructor({ stopsIndex, educationIndex = null, log = console }) {
    this.stopsIndex = stopsIndex;
    this.educationIndex = educationIndex;
    this.log = log;
    this.photonDownUntil = 0;
    this.nominatimQueue = Promise.resolve();
    this.nominatimLastAt = 0;
  }

  /**
   * מחזיר { mode: 'text' | 'category', category: {id,label,emoji} | null, results, degraded? }
   * categoryId – חיפוש קטגוריה מפורש (לחיצה על כפתור קטגוריה)
   */
  async search(rawQuery, near, { categoryId = null } = {}) {
    const query = String(rawQuery ?? '').trim().slice(0, 80);
    // "מסעדה" / "בתי ספר" / "סופר קרוב" -> כל המקומות מהסוג הזה סביב המשתמש. אפשר גם בבקשה מפורשת עם category=...
    const category = categoryId ? getCategory(categoryId) : (near ? matchCategory(query) : null);

    if (!category && query.length < 2) return { mode: 'text', category: null, results: [] };

    // "מסעדות תל אביב", "בתי ספר בחיפה": קטגוריה + מקום -> מוצאים את המקום ומחפשים את הקטגוריה סביבו
    if (!category && !categoryId) {
      const hit = await this.#categoryInPlace(query);
      if (hit) return this.#cached(`p|${hit.category.id}|${hit.center.lat.toFixed(3)},${hit.center.lng.toFixed(3)}`, () => this.#categorySearch(hit.category, hit.center));
    }
    if (category && !near) {
      // חיפוש "מסעדה" בלי מיקום לא משמעותי – נופלים לחיפוש טקסט
      return this.#cached(`t|${query}|`, () => this.#textSearch(query, null));
    }

    const loc = near ? `${near.lat.toFixed(3)},${near.lng.toFixed(3)}` : '';
    if (category) {
      return this.#cached(`c|${category.id}|${loc}`, () => this.#categorySearch(category, near));
    }
    return this.#cached(`t|${query}|${loc}`, () => this.#textSearch(query, near));
  }

  async #categoryInPlace(query) {
    const words = query.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 5) return null;
    for (let k = Math.min(2, words.length - 1); k >= 1; k--) {
      const category = matchCategory(words.slice(0, k).join(' '));
      if (!category) continue;
      const rest = words.slice(k).join(' ');
      // "בחיפה" -> גם "חיפה"
      const variants = /^ב.{3,}/.test(rest) ? [rest, rest.slice(1)] : [rest];
      for (const place of variants) {
        try {
          const found = await this.#nominatimText(place, null);
          const area = found.find((r) => r.kind === 'area');
          if (area) return { category, center: { lat: area.lat, lng: area.lng } };
        } catch (err) {
          this.log.warn?.(`[search] place lookup failed: ${err.message}`);
          return null;
        }
      }
    }
    return null;
  }

  async #cached(key, producer) {
    const hit = this.#cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
    const data = await producer();
    // תוצאה חלקית בגלל תקלה בשירות החיפוש – לא שומרים, כדי שהניסיון הבא יצליח
    if (!data.degraded) {
      this.#cache.set(key, { at: Date.now(), data });
      if (this.#cache.size > MAX_CACHE) this.#cache.delete(this.#cache.keys().next().value);
    }
    return data;
  }

  // ---------- חיפוש קטגוריה ----------

  async #categorySearch(category, near) {
    let results = [];
    let degraded = false;
    for (const radius of CATEGORY_RADII_KM) {
      try {
        results = await this.#withFallback(
          () => this.#photonNearby(category, near, radius),
          () => this.#nominatimNearby(category, near, radius)
        );
      } catch (err) {
        this.log.warn?.(`[search] category ${category.id} failed: ${err.message}`);
        degraded = true;
        break;
      }
      if (results.length >= CATEGORY_MIN_RESULTS) break;
    }

    // בתי ספר וגנים: המאגר הרשמי של משרד החינוך שלם יותר מ-OpenStreetMap
    if ((category.id === 'school' || category.id === 'kindergarten') && this.educationIndex) {
      try {
        await this.educationIndex.ensureLoaded();
        const official = this.educationIndex
          .nearby(near, { kindergarten: category.id === 'kindergarten' }, CATEGORY_RADII_KM[1], CATEGORY_MAX_RESULTS)
          .map((s) => ({
            id: s.id,
            kind: 'poi',
            name: s.name,
            subtitle: [s.type === 'גן ילדים' ? 'גן ילדים' : s.stage ? `בית ספר ${s.stage}` : 'בית ספר', s.city].filter(Boolean).join(' · '),
            category: category.id,
            emoji: category.emoji,
            source: 'moe',
            lat: s.lat,
            lng: s.lng,
            distance: s.distance
          }));
        results = [...results, ...official.filter((o) => !results.some((r) => similarName(r.name, o.name) && distanceMeters(r, o) < 400))]
          .sort((a, b) => a.distance - b.distance);
      } catch (err) {
        this.log.warn?.(`[search] education nearby failed: ${err.message}`);
      }
    }

    // הסרת כפולים (אותו מקום ממופה גם כנקודה וגם כבניין)
    const seen = new Set();
    const unique = results.filter((r) => {
      const k = `${r.name}|${Math.round(r.lat * 2000)}|${Math.round(r.lng * 2000)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return {
      mode: 'category',
      category: { id: category.id, label: category.label, emoji: category.emoji },
      results: unique.slice(0, CATEGORY_MAX_RESULTS),
      degraded
    };
  }

  async #photonNearby(category, near, radiusKm) {
    const params = new URLSearchParams({
      lat: near.lat.toFixed(5),
      lon: near.lng.toFixed(5),
      radius: String(radiusKm),
      limit: '50'
    });
    for (const tag of category.tags) params.append('osm_tag', tag);

    const json = await this.#photonFetch(`${PHOTON_REVERSE}?${params}`);
    return (json.features ?? [])
      .map((f) => normalizeFeature(f, { fallbackLabel: category.singular }))
      .filter(Boolean)
      .map((r) => ({ ...r, kind: 'poi', category: r.category ?? category.id, emoji: r.emoji ?? category.emoji, distance: Math.round(distanceMeters(near, r)) }))
      .filter((r) => r.distance <= radiusKm * 1000 * 1.05)
      .sort((a, b) => a.distance - b.distance);
  }

  // ---------- כתובת מדויקת ----------

  /**
   * "הרצל 10 חיפה": Nominatim מכיר מספרי בתים (Photon מחזיר לרוב רק את הרחוב).
   * אם הבית לא ממופה, מחזירים את הרחוב עם הסבר, כדי שיהיה אפשר להמשיך אליו.
   */
  async #houseLookup(query, addr, near) {
    const isHouse = (r) => r.kind !== 'street' && hasHouseNumber(r, addr.number);
    // קודם באזור המשתמש ("דיזנגוף 50" בתל אביב ולא ברחוב באותו שם בעיר אחרת), ואז בכל הארץ
    // ואם כתבו גם עיר ("הרצל 10 חיפה") – קודם בכל הארץ, כי העיר עשויה להיות רחוקה מהמשתמש
    const hasCity = norm(query).split(' ').length >= 3;
    const first = await this.#nominatimText(query, near, { local: !hasCity && !!near });
    let found = first;
    if (!found.some(isHouse)) found = mergeById(found, await this.#nominatimText(query, near, { local: hasCity && !!near }));
    if (found.some(isHouse)) return found;

    // "הרצל 10 חיפה": מאתרים את העיר ומחפשים את "הרצל 10" רק בתוכה
    if (hasCity) {
      const words = query.split(/\s+/).filter(Boolean);
      const at = words.indexOf(addr.raw);
      const split = at >= 0 ? words.filter((_, i) => i !== at) : words;
      for (const cityWords of [split.slice(-1), split.slice(-2)]) {
        const streetWords = split.slice(0, split.length - cityWords.length);
        if (streetWords.length === 0) continue;
        const area = (await this.#nominatimText(cityWords.join(' '), null)).find((r) => r.kind === 'area');
        if (!area) continue;
        const inCity = await this.#nominatimText(`${streetWords.join(' ')} ${addr.raw}`, { lat: area.lat, lng: area.lng }, { local: true });
        if (inCity.length > 0) {
          found = mergeById(inCity, found);
          if (inCity.some(isHouse)) return found;
          break;
        }
      }
    }

    const street = found.find((r) => r.kind === 'street');
    if (!street) return found;
    const note = `לא נמצא מספר ${addr.raw} במפה`;
    return found.map((r) => (r === street ? { ...r, subtitle: [r.subtitle, note].filter(Boolean).join(' · ') } : r));
  }

  // ---------- חיפוש טקסט ----------

  async #textSearch(query, near) {
    let degraded = false;
    const safe = (promise) => promise.catch((err) => {
      this.log.warn?.(`[search] ${err.message}`);
      degraded = true;
      return [];
    });

    const tokens = queryTokens(query);
    const fullMatches = (list) => list.filter((r) => {
      const m = matchInfo(r, tokens);
      return m.full && m.anyInName;
    }).length;

    // מקורות מקומיים (מהירים, בלי רשת): תחנות + מוסדות חינוך רשמיים
    const [stops, schools] = await Promise.all([this.#searchStops(query, near), this.#searchSchools(query, near)]);

    // כתובת עם מספר בית ("הרצל 10 חיפה"): מחפשים את הבית עצמו בנתוני OpenStreetMap. מצאנו – אין צורך בחיפוש הכללי
    const addr = parseAddress(query);
    let places = addr ? await safe(this.#houseLookup(query, addr, near)) : [];
    const foundHouse = addr && places.some((r) => r.kind !== 'street' && hasHouseNumber(r, addr.number));

    if (!foundHouse) {
      // 1) חיפוש מקומי סביב המשתמש  2) ארצי – רק אם אין מספיק התאמות טובות (חוסך עומס על השירות)
      let general = near ? await safe(this.#photon(query, near, { local: true })) : [];
      if (fullMatches([...general, ...schools]) < 3) {
        general = mergeById(general, await safe(this.#photon(query, near)));
      }
      places = mergeById(places, general);
    }

    // "מקדונלדס יבנה" כשאין סניף ביבנה: מחפשים את שם המקום לבד באזור (הסניף הקרוב)
    const words = query.split(/\s+/).filter(Boolean);
    if (near && words.length >= 2 && fullMatches([...places, ...schools]) === 0) {
      for (const variant of [words.slice(0, -1).join(' '), words.slice(1).join(' ')]) {
        const extra = await safe(this.#photon(variant, near, { local: true }));
        places = mergeById(places, extra);
        if (extra.some((r) => matchInfo(r, queryTokens(variant)).anyInName)) break;
      }
    }

    // מוסד חינוך מהמאגר הרשמי שכבר קיים ב-OSM (אותו שם, קרוב) – לא מציגים פעמיים
    const uniqueSchools = schools.filter((s) => !places.some((p) => similarName(p.name, s.name) && distanceMeters(p, s) < 400));

    const ranked = rankResults([...places, ...uniqueSchools], tokens, addr);
    const stopsFirst = /^\d{2,6}$/.test(query) || query.includes('/');
    const strong = ranked.filter((r) => r._bucket <= 1);
    const weak = ranked.filter((r) => r._bucket > 1);

    const ordered = stopsFirst
      ? [...stops, ...ranked]
      : [...strong.slice(0, 9), ...stops.slice(0, 3), ...weak];

    // הסרת כפילויות (אותו שם ואותה תת-כותרת)
    const seen = new Set();
    const results = [];
    for (const r of ordered) {
      const k = `${r.kind === 'stop' ? 'stop' : 'p'}|${r.name}|${r.subtitle ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const { _bucket, ...clean } = r;
      results.push(clean);
    }

    return { mode: 'text', category: null, results: results.slice(0, MAX_TEXT_RESULTS), degraded };
  }

  async #searchStops(query, near) {
    try {
      await this.stopsIndex.ensureLoaded();
    } catch {
      return [];
    }
    return this.stopsIndex.search(query, near, 4).map((s) => ({
      id: s.id,
      kind: 'stop',
      name: s.name,
      subtitle: [`תחנה ${s.code}`, s.city].filter(Boolean).join(' · '),
      lat: s.lat,
      lng: s.lng,
      code: s.code,
      distance: near ? Math.round(distanceMeters(near, s)) : undefined
    }));
  }

  async #searchSchools(query, near) {
    if (!this.educationIndex) return [];
    try {
      await this.educationIndex.ensureLoaded();
    } catch {
      return [];
    }
    return this.educationIndex.search(query, near, 5).map((s) => ({
      id: s.id,
      kind: 'poi',
      name: s.name,
      subtitle: [s.type === 'גן ילדים' ? 'גן ילדים' : s.stage ? `בית ספר ${s.stage}` : 'בית ספר', s.city].filter(Boolean).join(' · '),
      category: s.type === 'גן ילדים' ? 'kindergarten' : 'school',
      emoji: s.type === 'גן ילדים' ? '🧸' : '🏫',
      source: 'moe',
      lat: s.lat,
      lng: s.lng,
      distance: s.distance
    }));
  }

  /** חיפוש טקסט: Photon, ואם הוא לא זמין – Nominatim */
  #photon(query, near, opts = {}) {
    return this.#withFallback(
      () => this.#photonText(query, near, opts),
      () => this.#nominatimText(query, near, opts)
    );
  }

  /** מריץ את הספק הראשי; בכישלון מסמן אותו כלא זמין לדקה ומריץ את הגיבוי */
  async #withFallback(primary, fallback) {
    if (Date.now() >= this.photonDownUntil) {
      try {
        return await primary();
      } catch (err) {
        this.photonDownUntil = Date.now() + PHOTON_COOLDOWN_MS;
        this.log.warn?.(`[search] Photon unavailable (${err.message}) – using Nominatim for ${PHOTON_COOLDOWN_MS / 1000}s`);
      }
    }
    return fallback();
  }

  async #nominatimText(query, near, { local = false } = {}) {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '10',
      countrycodes: 'il',
      'accept-language': 'he',
      addressdetails: '1'
    });
    if (near) {
      params.set('viewbox', viewbox(near, LOCAL_DLAT, LOCAL_DLNG));
      if (local) params.set('bounded', '1');
    }
    const list = await this.#nominatimFetch(`${NOMINATIM_SEARCH}?${params}`);
    const results = list.map((x) => normalizeNominatim(x)).filter(Boolean);
    if (near) for (const r of results) r.distance = Math.round(distanceMeters(near, r));
    return results;
  }

  async #nominatimNearby(category, near, radiusKm) {
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.cos((near.lat * Math.PI) / 180));
    const params = new URLSearchParams({
      q: category.phrase,
      format: 'jsonv2',
      limit: '40',
      countrycodes: 'il',
      'accept-language': 'he',
      addressdetails: '1',
      viewbox: viewbox(near, dLat, dLng),
      bounded: '1'
    });
    const list = await this.#nominatimFetch(`${NOMINATIM_SEARCH}?${params}`);
    const tagSet = new Set(category.tags);
    return list
      .filter((x) => tagSet.has(`${x.category}:${x.type}`) || tagSet.has(x.category))
      .map((x) => normalizeNominatim(x, { fallbackLabel: category.singular }))
      .filter(Boolean)
      .map((r) => ({ ...r, kind: 'poi', category: r.category ?? category.id, emoji: r.emoji ?? category.emoji, distance: Math.round(distanceMeters(near, r)) }))
      .filter((r) => r.distance <= radiusKm * 1000 * 1.05)
      .sort((a, b) => a.distance - b.distance);
  }

  /** תור: בקשה אחת לשנייה ל-Nominatim, כנדרש במדיניות השימוש */
  #nominatimFetch(url) {
    const run = async () => {
      const wait = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - this.nominatimLastAt);
      if (wait > 0) await sleep(wait);
      this.nominatimLastAt = Date.now();
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }, 8000);
      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    };
    const p = this.nominatimQueue.then(run, run);
    this.nominatimQueue = p.catch(() => {});
    return p;
  }

  /** local: חיפוש בתוך אזור של ~30 ק"מ סביב המשתמש – מוצא את "גרג" ביבנה גם כשיש עשרות סניפים בארץ */
  async #photonText(query, near, { local = false } = {}) {
    const bbox = local && near
      ? [near.lng - LOCAL_DLNG, near.lat - LOCAL_DLAT, near.lng + LOCAL_DLNG, near.lat + LOCAL_DLAT].map((v) => v.toFixed(4)).join(',')
      : ISRAEL_BBOX;
    const params = new URLSearchParams({ q: query, limit: '10', bbox });
    if (near) {
      params.set('lat', near.lat.toFixed(4));
      params.set('lon', near.lng.toFixed(4));
      // הטיה חזקה למיקום: "פיצה" מחזיר פיצריות בעיר שלך ולא במרחק 50 ק"מ
      params.set('location_bias_scale', '0.6');
      params.set('zoom', '14');
    }

    const json = await this.#photonFetch(`${PHOTON_SEARCH}?${params}`);
    const results = (json.features ?? []).map((f) => normalizeFeature(f)).filter(Boolean);
    if (near) {
      for (const r of results) r.distance = Math.round(distanceMeters(near, r));
    }
    return results;
  }

  /** בקשה ל-Photon עם ניסיון חוזר אחד כשהשירות עמוס (503/429) */
  async #photonFetch(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      // timeout קצר: אם Photon לא עונה – עדיף לעבור מהר לגיבוי
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }, 3000);
      if (res.ok) return res.json();
      if ((res.status === 503 || res.status === 429) && attempt === 0) {
        await sleep(450);
        continue;
      }
      throw new Error(`Photon HTTP ${res.status}`);
    }
    throw new Error('Photon unavailable');
  }
}
