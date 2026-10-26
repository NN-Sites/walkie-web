// תכנון נסיעה בתחבורה ציבורית (אוטובוס / רכבת / רכבת קלה).
//
// מנוע: Transitous (MOTIS 2, קוד פתוח) – מריץ RAPTOR על ה-GTFS הרשמי של משרד התחבורה (il-Israel-MOT),
// כולל הליכה ברשת רחובות OSM לתחנה, בין תחנות בהחלפה, ומהתחנה ליעד.
//
// מה Walkie מוסיף מעל:
//  1. סינון מסלולים "נשלטים" (Pareto): מסלול שמגיע מאוחר יותר עם יותר החלפות – לא מוצג.
//  2. דירוג ריאליסטי: זמן הגעה + קנס להחלפות ולהליכה ארוכה.
//  3. זמן אמת: לכל קו ראשון במסלול – התאמה מדויקת לפי מזהה נסיעה (trip_id) מול SIRI של משרד התחבורה,
//     כולל איחור/הקדמה בדקות ומיקום האוטובוס.
//
// להחלפת מנוע (למשל MOTIS/OTP עצמאי עם אותו GTFS) – מחליפים רק את #fetchPlan.

import { fetchWithTimeout, distanceMeters } from './geo.js?v=1.9.2-mvprzu4a';
import { decodePolyline } from './polyline.js?v=1.9.2-mvprzu4a';
import { computeFare } from './fares.js?v=1.9.2-mvprzu4a';

const TRANSITOUS_BASE = 'https://api.transitous.org/api/v1/plan';
const USER_AGENT = 'Walkie/0.4 (pedestrian & public transport navigation; contact: walkie-app)';
const FEED_PREFIX = 'il-Israel-MOT_';

const CACHE_TTL_MS = 60 * 1000;      // לוחות זמנים + זמן אמת – דקה
const MAX_CACHE = 300;
const MAX_RESULTS = 6;
// קווים מקבילים (אותן תחנות עלייה וירידה, קו אחר): נשארים ברשימה גם כשהם "נשלטים", והלקוח מקבץ אותם ל"10 / 15"
const SIBLING_MAX = 8;
const SIBLING_WINDOW_MS = 30 * 60 * 1000;
const SIBLING_LATE_ARRIVAL_MS = 15 * 60 * 1000;
// התאמה לפי קו+שעה כשאין trip_id זהה: אוטובוס יכול להקדים מעט או לאחר,
// אבל לא "להקדים ב-13 דק'" – זה כבר האוטובוס הקודם באותו קו
const LIVE_MATCH_EARLY_MIN = 2;
const LIVE_MATCH_LATE_MIN = 12;
const LIVE_LOOKAHEAD_MIN = 75;       // זמן אמת רלוונטי רק לנסיעות שיוצאות בשעה הקרובה
const LATE_BUS_WINDOW_MS = 20 * 60 * 1000; // אוטובוס שמאחר עד 20 דק' עדיין נמצא ב"יציאה עכשיו"
// ברירת המחדל של המנוע היא 15 דק' הליכה לתחנה/מתחנה. יעד שרחוק יותר מכל תחנה מקבל "אין מסלול"
// או מסלול לילה מטורף (7 שעות דרך קו שבמקרה עובר ליד) – אז מחפשים שוב עם רדיוס הליכה רחב יותר
const FALLBACK_WALK_MIN = 35;
const WALK_OPTION_MAX_M = 6000;          // הליכה כחלופה (וכרף השוואה) עד 6 ק"מ בקו אווירי
const SLOWER_THAN_WALK_GRACE_MS = 3 * 60 * 1000;

// משפחות אמצעי תחבורה (MOTIS mode -> Walkie)
export const MODE_FAMILY = {
  BUS: 'bus',
  COACH: 'bus',
  TRAM: 'lightrail',
  SUBWAY: 'lightrail',
  METRO: 'lightrail',
  RAIL: 'rail',
  HIGHSPEED_RAIL: 'rail',
  LONG_DISTANCE: 'rail',
  NIGHT_RAIL: 'rail',
  REGIONAL_FAST_RAIL: 'rail',
  REGIONAL_RAIL: 'rail',
  CABLE_CAR: 'cable',
  FUNICULAR: 'cable',
  AREAL_LIFT: 'cable',
  FERRY: 'ferry'
};

// חלופת רכבת: רק בנסיעות ארוכות, מתחנה עד 6 ק"מ (עד 2.3 ק"מ – הליכה, אחרת אוטובוס לתחנה)
const RAIL_MIN_TRIP_M = 8000;
const RAIL_MAX_ACCESS_M = 6000;
const RAIL_WALK_ACCESS_M = 2300;
const RAIL_BUFFER_MS = 3 * 60 * 1000; // זמן להגיע לרציף

// העדפות אמצעי תחבורה (מסך הגדרות) -> מצבי MOTIS
const PREF_MODES = {
  bus: ['BUS', 'COACH'],
  rail: ['RAIL', 'REGIONAL_RAIL', 'REGIONAL_FAST_RAIL', 'LONG_DISTANCE', 'HIGHSPEED_RAIL', 'NIGHT_RAIL'],
  lightrail: ['TRAM', 'SUBWAY', 'METRO']
};

export class TransitError extends Error {
  constructor(message, code = 'upstream') {
    super(message);
    this.code = code;
  }
}

// ---------- עזרי נרמול ----------

export const stripFeed = (id) => (typeof id === 'string' && id.includes(FEED_PREFIX) ? id.split(FEED_PREFIX).pop() : id ?? null);

/** "קרית אונו_מסוף קרית אונו" -> "מסוף קרית אונו"; "בת ים_מרכז הספורט" -> "מרכז הספורט, בת ים" */
export function formatHeadsign(raw) {
  if (!raw) return null;
  const parts = String(raw).split('_').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? null;
  const [city, place] = parts;
  return place.includes(city) ? place : `${place}, ${city}`;
}

function normalizeStop(s) {
  return {
    name: s?.name ?? '',
    code: s?.stopCode ? String(s.stopCode) : null,
    lat: s?.lat,
    lng: s?.lon,
    arrival: s?.arrival ?? null,
    departure: s?.departure ?? null,
    scheduledArrival: s?.scheduledArrival ?? null,
    scheduledDeparture: s?.scheduledDeparture ?? null
  };
}

function normalizeLeg(l) {
  const geometry = l.legGeometry?.points ? decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 7) : [];
  const base = {
    mode: l.mode === 'WALK' ? 'walk' : (MODE_FAMILY[l.mode] ?? 'other'),
    rawMode: l.mode,
    start: l.startTime,
    end: l.endTime,
    scheduledStart: l.scheduledStartTime ?? l.startTime,
    scheduledEnd: l.scheduledEndTime ?? l.endTime,
    duration: Math.round(l.duration ?? (Date.parse(l.endTime) - Date.parse(l.startTime)) / 1000),
    from: normalizeStop(l.from),
    to: normalizeStop(l.to),
    geometry
  };

  if (l.mode === 'WALK') {
    return { ...base, distance: Math.round(l.distance ?? 0) };
  }

  const gtfsTripId = stripFeed(l.tripId);
  const family = base.mode;
  // ברכבת ישראל ה-headsign הוא מספר הרכבת ואין מספר קו – מציגים "רכבת" + תחנה סופית
  const numericHeadsign = /^\d+$/.test(String(l.headsign ?? '').trim());
  const headsign = family === 'rail' || numericHeadsign
    ? l.tripTo?.name ?? formatHeadsign(l.headsign)
    : formatHeadsign(l.headsign) ?? l.tripTo?.name ?? null;
  const line = family === 'rail'
    ? 'רכבת'
    : l.routeShortName || l.displayName || l.tripShortName || '';

  return {
    ...base,
    line,
    trainNumber: family === 'rail' ? (l.tripShortName || (numericHeadsign ? String(l.headsign).trim() : null)) : null,
    longName: l.routeLongName || null,
    headsign,
    agency: l.agencyName || null,
    color: l.routeColor ? `#${l.routeColor}` : null,
    textColor: l.routeTextColor ? `#${l.routeTextColor}` : null,
    tripId: gtfsTripId,
    tripStart: tripStartOf(l.tripId),
    routeId: stripFeed(l.routeId),
    stops: (l.intermediateStops ?? []).map(normalizeStop),
    distance: Math.round(
      geometry.reduce((sum, p, i) => (i ? sum + distanceMeters({ lat: geometry[i - 1][0], lng: geometry[i - 1][1] }, { lat: p[0], lng: p[1] }) : 0), 0)
    ),
    live: null
  };
}

function normalizeItinerary(it) {
  const legs = it.legs.map(normalizeLeg);
  const walkLegs = legs.filter((l) => l.mode === 'walk');
  const transitLegs = legs.filter((l) => l.mode !== 'walk');
  return {
    id: it.id ?? `${it.startTime}|${transitLegs.map((l) => l.tripId).join(',')}`,
    start: it.startTime,
    end: it.endTime,
    duration: Math.round(it.duration),
    transfers: Math.max(0, transitLegs.length - 1),
    walkMeters: walkLegs.reduce((s, l) => s + l.distance, 0),
    walkSeconds: walkLegs.reduce((s, l) => s + l.duration, 0),
    modes: [...new Set(transitLegs.map((l) => l.mode))],
    legs
  };
}

// ---------- סינון ודירוג ----------

/**
 * ציון "כאב" (נמוך = טוב): 4 דק' לכל החלפה + דקה לכל 250 מ' הליכה מעבר ל-600 מ', ועוד:
 *  - "יציאה ב-": זמן ההגעה (מוקדם = טוב)
 *  - "הגעה עד": זמן היציאה בסדר הפוך (יוצאים כמה שיותר מאוחר ועדיין מגיעים בזמן)
 */
function painScore(it, arriveBy = false) {
  const base = arriveBy ? -Date.parse(it.start) / 60000 : Date.parse(it.end) / 60000;
  const extraWalk = Math.max(0, it.walkMeters - 600) / 250;
  return base + it.transfers * 4 + extraWalk;
}

function dominates(a, b) {
  // a שולט ב-b אם הוא יוצא לא מוקדם יותר, מגיע לא מאוחר יותר, עם לא יותר החלפות והליכה דומה,
  // וטוב יותר לפחות באחד מהמדדים
  const aStart = Date.parse(a.start), bStart = Date.parse(b.start);
  const aEnd = Date.parse(a.end), bEnd = Date.parse(b.end);
  const timeOk = aStart >= bStart && aEnd <= bEnd;
  const notWorse = timeOk && a.transfers <= b.transfers && a.walkMeters <= b.walkMeters * 1.3 + 100;
  const better = aStart > bStart || aEnd < bEnd || a.transfers < b.transfers;
  return notWorse && better;
}

/** אותן תחנות עלייה וירידה בכל קטע נסיעה (בלי קשר לקו ולשעה) */
function rideSignature(it) {
  return it.legs
    .filter((l) => l.mode !== 'walk')
    .map((l) => `${l.mode}|${l.from?.code ?? l.from?.name}|${l.to?.code ?? l.to?.name}`)
    .join('>');
}

/**
 * protect(it) – מסלולים שלא מסננים החוצה גם אם הם "נשלטים" (למשל חלופת רכבת שמשתמשים רוצים לראות),
 * כל עוד הם לא גרועים בהרבה (עד 60 דק' מהטוב ביותר).
 */
export function filterItineraries(list, arriveBy = false, { protect = () => false } = {}) {
  // הסרת כפולים: אותן נסיעות (קו + שעה), בלי קשר להבדלים קטנים בקטעי ההליכה
  const seen = new Set();
  const unique = list.filter((it) => {
    const key = it.legs.filter((l) => l.mode !== 'walk').map((l) => `${l.line}@${l.start}`).join('>');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const pareto = unique.filter((b) => protect(b) || !unique.some((a) => a !== b && !protect(a) && dominates(a, b)));

  const score = (it) => painScore(it, arriveBy);
  pareto.sort((a, b) => score(a) - score(b));
  const best = pareto[0] ? score(pareto[0]) : 0;
  // מסלולים גרועים בהרבה מהטוב ביותר – לא מעניינים
  // חלופת רכבת מוצגת גם אם היא איטית יותר עד שעה – כדי שתמיד תהיה אפשרות לבחור ברכבת
  const reasonable = pareto.filter((it) => score(it) <= best + (protect(it) ? 60 : 35));

  // תצוגה: לפי זמן יציאה (כמו Moovit/Google), החלופה המומלצת מסומנת
  reasonable.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || score(a) - score(b));
  const recommendedId = pareto[0]?.id ?? null;
  // תמיד משאירים מקום לחלופות המוגנות (רכבת), גם כשיש הרבה אוטובוסים
  const keep = reasonable.filter(protect).slice(0, 2);
  const rest = reasonable.filter((it) => !keep.includes(it)).slice(0, MAX_RESULTS - keep.length);
  const shown = [...rest, ...keep].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || score(a) - score(b));

  // הסינון למעלה מסיר מסלול שנוסע באותם מקומות כמו מסלול אחר אבל יוצא מוקדם יותר באותה הגעה (למשל קו 10 מול קו 15).
  // מי שרוצה לעלות על קו 10 צריך לראות אותו, ולכן מחזירים אותם כ"אחים" של המסלולים שמוצגים
  const shownSet = new Set(shown);
  const bySignature = new Map();
  for (const it of shown) if (!bySignature.has(rideSignature(it))) bySignature.set(rideSignature(it), it);
  const siblings = unique
    .filter((it) => {
      if (shownSet.has(it) || it.legs.every((l) => l.mode === 'walk')) return false;
      const base = bySignature.get(rideSignature(it));
      return !!base
        && Math.abs(Date.parse(it.start) - Date.parse(base.start)) <= SIBLING_WINDOW_MS
        && Date.parse(it.end) <= Date.parse(base.end) + SIBLING_LATE_ARRIVAL_MS;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, SIBLING_MAX);

  return [...shown, ...siblings]
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || score(a) - score(b))
    .map((it) => ({ ...it, recommended: it.id === recommendedId }));
}

// ---------- זמן אמת ----------

const TRIP_START_TOLERANCE_MIN = 2;
const EXACT_MATCH_EARLY_MIN = 15;
const EXACT_MATCH_LATE_MIN = 90;

/** הפרש בדקות בין שתי שעות "HH:MM" (כולל מעבר חצות), Infinity אם חסר */
function hhmmDiff(a, b) {
  if (!a || !b) return Infinity;
  const m = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  const d = Math.abs(m(a) - m(b));
  return Math.min(d, 1440 - d);
}

/** "20261021_19:20_il-Israel-MOT_585173894_211026" (מזהה נסיעה של MOTIS) -> "19:20" (שעת היציאה מהמוצא) */
export function tripStartOf(motisTripId) {
  return /^\d{8}_(\d{2}:\d{2})_/.exec(String(motisTripId ?? ''))?.[1] ?? null;
}

/**
 * מוצא את האוטובוס הספציפי של הנסיעה ברשימת ההגעות (SIRI) של התחנה.
 * רק אוטובוסים שבאמת במעקב (tracked) – תחזית ישנה בלי מיקום היא לוח זמנים, לא זמן אמת.
 * עדיפות:
 *  1. routeId + שעת יציאה מהמוצא – מזהה את הנסיעה בדיוק (כמו Google/Moovit)
 *  2. trip_id זהה
 *  3. רק אם SIRI לא מסר שעת יציאה: אותו קו, הכי קרוב לזמן המתוכנן
 */
export function matchLiveArrival(arrivals, { tripId, line, scheduled, routeId = null, tripStart = null }) {
  if (!Array.isArray(arrivals) || !scheduled) return null;
  const sched = Date.parse(scheduled);
  const live = arrivals.filter((a) => a.tracked !== false);
  const sameRoute = routeId ? live.filter((a) => a.routeId && String(a.routeId) === String(routeId)) : [];

  let match = null;
  let exact = false;

  if (routeId && tripStart) {
    // לפעמים SIRI ולוח הזמנים נבדלים בדקה בשעת היציאה (18:44 מול 18:45) – לוקחים את הקרוב ביותר עד 2 דק'
    let best = TRIP_START_TOLERANCE_MIN + 1;
    for (const a of sameRoute) {
      // אותה שעה ביום אחר (למשל 19:20 של יום ראשון) היא לא הנסיעה הזו
      const offsetMin = (Date.parse(a.eta) - sched) / 60000;
      if (offsetMin < -EXACT_MATCH_EARLY_MIN || offsetMin > EXACT_MATCH_LATE_MIN) continue;
      const diff = hhmmDiff(a.departed, tripStart);
      if (diff < best) {
        best = diff;
        match = a;
      }
    }
  }
  if (!match && tripId) {
    match = live.find((a) => a.tripId && a.tripId === tripId) ?? null;
  }
  exact = !!match;

  // SIRI מסר שעות יציאה לקו הזה ואף אחת לא שלנו -> האוטובוס שלנו עוד לא במעקב
  const identifiable = routeId && tripStart && sameRoute.some((a) => a.departed);
  if (!match && !identifiable) {
    const pool = sameRoute.length ? sameRoute : live.filter((a) => line && String(a.line) === String(line));
    let bestDiff = Infinity;
    for (const a of pool) {
      const offsetMin = (Date.parse(a.eta) - sched) / 60000;
      if (offsetMin < -LIVE_MATCH_EARLY_MIN || offsetMin > LIVE_MATCH_LATE_MIN) continue;
      if (Math.abs(offsetMin) < bestDiff) {
        bestDiff = Math.abs(offsetMin);
        match = a;
      }
    }
  }

  if (!match) return null;
  const eta = Date.parse(match.eta);
  return {
    routeId: match.routeId ?? null,
    departed: match.departed ?? null,
    eta: match.eta,
    delayMin: Math.round((eta - sched) / 60000),
    exact,
    vehicle: match.vehicle ?? null,
    recordedAt: match.recordedAt ?? null,
    checkedAt: new Date().toISOString()
  };
}

const iso = (ms) => new Date(ms).toISOString();
const MISSED_GRACE_MS = 60 * 1000;     // יציאה שהייתה "לפני דקה" עדיין אפשרית (עיגול דקות)
const MIN_TRANSFER_MS = 60 * 1000;     // החלפה: לפחות דקה בתחנה לפני שהאוטובוס הבא יוצא

/**
 * מעדכן את זמני המסלול לפי זמן אמת – כמו Google/Moovit:
 *  - עלייה: ה-ETA של האוטובוס בתחנת העלייה (SIRI)
 *  - ירידה: ה-ETA של אותו אוטובוס בתחנת הירידה; אם אין – זמן הירידה המתוכנן + האיחור בעלייה
 *  - הליכה לתחנה הראשונה זזה יחד עם האוטובוס ("צאו ב-"), הליכה אחרי ירידה זזה עם זמן הירידה
 * ומסמן מסלול שכבר אי אפשר לתפוס (האוטובוס יוצא לפני שמגיעים לתחנה / החלפה שלא מספיקים).
 * referenceMs – הרגע שממנו אפשר לצאת (עכשיו, או השעה שנבחרה).
 */
export function applyRealtime(it, referenceMs = Date.now()) {
  const legs = it.legs;
  const firstTransit = legs.findIndex((l) => l.mode !== 'walk');
  if (firstTransit < 0) return it;

  let changed = false;
  let missed = false;
  let shiftMs = 0;     // כמה זזה הרגל הקודמת (לשרשור להליכה שאחריה)
  let readyAt = null;  // מתי מגיעים לתחנת העלייה הבאה

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const oldStart = Date.parse(leg.start);
    const oldEnd = Date.parse(leg.end);

    if (leg.mode === 'walk') {
      if (i < firstTransit) continue; // מטופל אחרי שיודעים מתי האוטובוס הראשון יוצא
      leg.start = iso(oldStart + shiftMs);
      leg.end = iso(oldEnd + shiftMs);
      readyAt = Date.parse(leg.end);
      continue;
    }

    let start = oldStart;
    let end = oldEnd;
    if (leg.live?.eta) {
      start = Date.parse(leg.live.eta);
      const alight = leg.live.arrivalEta ? Date.parse(leg.live.arrivalEta) : NaN;
      // ETA בירידה רק אם הגיוני (אחרי העלייה, ולא יותר מפי 3 מזמן הנסיעה המתוכנן)
      const plannedRide = Math.max(60000, oldEnd - oldStart);
      end = Number.isFinite(alight) && alight > start && alight - start <= plannedRide * 3 + 10 * 60000
        ? alight
        : start + plannedRide;
      leg.live.arrivalEstimated = !(Number.isFinite(alight) && end === alight);
      // כמה מהאיחור כבר בתוך זמני המסלול (הלקוח מוסיף רק שינויים מכאן והלאה)
      leg.live.appliedDelayMin = Math.round((start - Date.parse(leg.scheduledStart)) / 60000);
    }

    // החלפה: האוטובוס הבא יוצא לפני שמגיעים לתחנה שלו (נבדק רק כשזמן אמת שינה משהו –
    // לוח הזמנים עצמו כבר מתוכנן עם החלפות אפשריות)
    if (readyAt !== null && (shiftMs !== 0 || start !== oldStart)) {
      const slackBefore = oldStart - (readyAt - shiftMs);
      const need = Math.min(MIN_TRANSFER_MS, Math.max(0, slackBefore));
      if (start < readyAt + need) missed = true;
    }
    if (start !== oldStart || end !== oldEnd) changed = true;
    leg.start = iso(start);
    leg.end = iso(end);
    shiftMs = end - oldEnd;
    readyAt = end;

    if (i === firstTransit) {
      // הליכה לתחנה הראשונה: מסיימים כשהאוטובוס מגיע (בדיוק כמו לפני, רק מוזז)
      const delta = start - oldStart;
      for (let k = 0; k < i; k++) {
        legs[k].start = iso(Date.parse(legs[k].start) + delta);
        legs[k].end = iso(Date.parse(legs[k].end) + delta);
      }
      const leaveAt = Date.parse(legs[0].start);
      if (leaveAt < referenceMs - MISSED_GRACE_MS) missed = true;
    }
  }

  if (changed) {
    it.scheduledStart = it.scheduledStart ?? it.start;
    it.scheduledEnd = it.scheduledEnd ?? it.end;
    it.start = legs[0].start;
    it.end = legs[legs.length - 1].end;
    it.duration = Math.round((Date.parse(it.end) - Date.parse(it.start)) / 1000);
    it.realtime = true;
  }
  if (missed) it.missed = true;
  return it;
}

// ---------- Planner ----------

export class TransitPlanner {
  #cache = new Map();

  constructor({ arrivalsService, walkRouter, stations = null, log = console }) {
    this.arrivalsService = arrivalsService;
    this.walkRouter = walkRouter;
    this.stations = stations;
    this.log = log;
  }

  /** prefs: { modes: ['bus','rail','lightrail'] | null, maxWalkMin: number | null, wheelchair: boolean } */
  async plan({ from, to, time, arriveBy = false, cursor = null, prefs = {} }) {
    const direct = distanceMeters(from, to);
    if (direct < 50) throw new TransitError('Origin equals destination', 'too_close');

    const when = time ? new Date(time) : new Date();
    const key = [
      from.lat.toFixed(4), from.lng.toFixed(4), to.lat.toFixed(4), to.lng.toFixed(4),
      Math.floor(when.getTime() / 60000), arriveBy ? 'A' : 'D', cursor ?? '',
      (prefs.modes ?? []).join('+'), prefs.maxWalkMin ?? '', prefs.wheelchair ? 'W' : ''
    ].join('|');

    const hit = this.#cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

    // "יציאה עכשיו": גם חיפוש מלפני 20 דק' – אוטובוס מאחר שלפי לוח הזמנים כבר יצא לא מופיע
    // בחיפוש הרגיל, אבל בפועל עוד לא הגיע לתחנה (Google/Moovit מציגים אותו לפי זמן אמת)
    const departNow = !arriveBy && !cursor && Math.abs(when.getTime() - Date.now()) < 5 * 60000;
    let [raw, walk, rail, late] = await Promise.all([
      this.#fetchPlan({ from, to, when, arriveBy, cursor, prefs }),
      // הליכה כחלופה – רק כשהיעד במרחק הליכה סביר
      !cursor && direct <= WALK_OPTION_MAX_M ? this.#walkOption(from, to) : Promise.resolve(null),
      // חלופת רכבת מהתחנה הקרובה (המנוע לפעמים מעדיף אוטובוסים ומסתיר אותה)
      !cursor && !arriveBy ? this.#railOptions({ from, to, when, prefs }).catch((err) => {
        this.log.warn?.(`[transit] rail options failed: ${err.message}`);
        return [];
      }) : Promise.resolve([]),
      departNow
        ? this.#fetchPlan({ from, to, when: new Date(when.getTime() - LATE_BUS_WINDOW_MS), arriveBy, cursor, prefs }).catch(() => null)
        : Promise.resolve(null)
    ]);

    const reference = arriveBy ? Date.now() : Math.max(Date.now(), when.getTime());
    // מסלול שמגיע אחרי שכבר היינו מגיעים ברגל – לא באמת חלופה (הליכה מוצגת בנפרד)
    const slowerThanWalk = (it) => {
      if (!walk?.seconds) return false;
      const total = arriveBy ? Date.parse(it.end) - Date.parse(it.start) : Date.parse(it.end) - reference;
      return total > walk.seconds * 1000 + SLOWER_THAN_WALK_GRACE_MS;
    };

    let regular = (raw.itineraries ?? []).map(normalizeItinerary);
    const walkLimit = prefs.maxWalkMin ?? 15;
    if (!cursor && walkLimit < FALLBACK_WALK_MIN && !regular.some((it) => !slowerThanWalk(it))) {
      const wider = await this.#fetchPlan({ from, to, when, arriveBy, cursor, prefs: { ...prefs, maxWalkMin: FALLBACK_WALK_MIN } }).catch(() => null);
      const widerList = (wider?.itineraries ?? []).map(normalizeItinerary);
      if (widerList.length) {
        raw = wider;
        regular = widerList;
      }
    }

    // נסיעות מהחיפוש המוקדם – רק אלה שעוד לא מופיעות בחיפוש הרגיל (אותה נסיעה = אותם trip_id)
    const tripsKey = (it) => it.legs.filter((l) => l.mode !== 'walk').map((l) => l.tripId).join('>');
    const known = new Set(regular.map(tripsKey));
    const lateOnes = (late?.itineraries ?? []).map(normalizeItinerary).filter((it) => !known.has(tripsKey(it)));
    const lateIds = new Set(lateOnes.map((it) => it.id));

    // עותק לכל רגל – זמן אמת משנה זמנים במקום, ומסלולים (חלופות רכבת) יכולים לשתף רגליים
    const all = [...regular, ...lateOnes, ...rail]
      .map((it) => ({ ...it, legs: it.legs.map((l) => ({ ...l })) }));
    // זמן אמת לפני הסינון והדירוג – כדי שהסדר וזמני ההגעה יהיו לפי מה שקורה בפועל בכביש,
    // ומסלולים עם אוטובוס שכבר אי אפשר לתפוס לא יוצגו (כמו Google/Moovit)
    await this.#attachLive(all);
    for (const it of all) {
      applyRealtime(it, reference);
      // מהחיפוש המוקדם: רק אם זיהינו בוודאות את האוטובוס עצמו (לא "האוטובוס הבא באותו קו")
      if (lateIds.has(it.id) && !it.legs.find((l) => l.mode !== 'walk')?.live?.exact) it.missed = true;
      // "הגעה עד": אוטובוס מאחר שכבר לא מביא בזמן – לא מציגים אותו כאפשרות
      if (arriveBy && Date.parse(it.end) > when.getTime() + MISSED_GRACE_MS) it.missed = true;
    }
    const sensible = all.filter((it) => !slowerThanWalk(it));
    const catchable = sensible.filter((it) => !it.missed);
    // מחיר ברב-קו לכל מסלול (מחירון משרד התחבורה)
    const itineraries = filterItineraries(catchable.length ? catchable : sensible, arriveBy, { protect: (it) => it.viaRail === true })
      .map((it) => ({ ...it, fare: computeFare(it) }));

    const data = {
      source: 'transitous',
      feed: 'il-Israel-MOT',
      query: { from, to, time: when.toISOString(), arriveBy },
      generatedAt: new Date().toISOString(),
      itineraries,
      walk,
      nextCursor: raw.nextPageCursor ?? null,
      previousCursor: raw.previousPageCursor ?? null
    };

    this.#cache.set(key, { at: Date.now(), data });
    if (this.#cache.size > MAX_CACHE) this.#cache.delete(this.#cache.keys().next().value);
    return data;
  }

  /** זמן אמת לרגל בודדת (רענון בזמן נסיעה) */
  async live({ stopCode, tripId, line, scheduled, routeId = null, tripStart = null }) {
    const data = await this.arrivalsService.get(stopCode);
    return matchLiveArrival(data.arrivals, { tripId, line, scheduled, routeId, tripStart });
  }

  async #fetchPlan({ from, to, when, arriveBy, cursor, prefs = {} }) {
    const params = new URLSearchParams({
      fromPlace: `${from.lat},${from.lng}`,
      toPlace: `${to.lat},${to.lng}`,
      time: when.toISOString(),
      arriveBy: String(arriveBy),
      numItineraries: '8',
      maxTransfers: '4',
      pedestrianProfile: prefs.wheelchair ? 'WHEELCHAIR' : 'FOOT',
      useRoutedTransfers: 'true',
      detailedTransfers: 'true',
      language: 'he'
    });
    if (cursor) params.set('pageCursor', cursor);
    if (prefs.modes?.length) {
      for (const m of prefs.modes.flatMap((x) => PREF_MODES[x] ?? [])) params.append('transitModes', m);
    }
    if (prefs.maxWalkMin) {
      const seconds = String(Math.round(prefs.maxWalkMin * 60));
      params.set('maxPreTransitTime', seconds);
      params.set('maxPostTransitTime', seconds);
    }

    let res;
    try {
      res = await fetchWithTimeout(
        `${TRANSITOUS_BASE}?${params}`,
        { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
        20000
      );
    } catch (err) {
      throw new TransitError(err.message);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new TransitError(`Transitous HTTP ${res.status} ${body.slice(0, 120)}`);
    }
    return res.json();
  }

  /**
   * חלופת רכבת "כמו במוביט": הגעה לתחנת הרכבת הקרובה (ברגל, או באוטובוס אם רחוק),
   * ומשם חיפוש שבו הנסיעה הראשונה היא ברכבת. שני החלקים מחוברים למסלול אחד.
   */
  async #railOptions({ from, to, when, prefs }) {
    if (!this.stations) return [];
    if (prefs.modes && !prefs.modes.includes('rail')) return [];
    if (distanceMeters(from, to) < RAIL_MIN_TRIP_M) return [];

    const stations = await this.stations.nearby(from, 'rail');
    const station = stations.find((s) => s.distance <= RAIL_MAX_ACCESS_M);
    if (!station) return [];
    // תחנה שנמצאת "אחורה" מעט (כמה ק"מ בכיוון ההפוך ליעד) עדיין משתלמת – רכבת מהירה יותר.
    // מוותרים רק כשהחזרה אחורה ארוכה מהנסיעה עצמה ברובה
    const tripM = distanceMeters(from, to);
    if (distanceMeters(station, to) > tripM + Math.min(4000, tripM * 0.3)) return [];

    const stationPoint = { lat: station.lat, lng: station.lng };

    // חלק 1: הגעה לתחנה – גם ברגל וגם בתחבורה ציבורית, ובוחרים לפי זמן ההגעה לתחנה
    const variants = [];
    if (station.distance <= RAIL_WALK_ACCESS_M) {
      const walk = await this.walkRouter.route(from, stationPoint).catch(() => null);
      const seconds = walk?.realisticSeconds ?? Math.round(station.distance / 1.2);
      variants.push({
        type: 'walk',
        seconds,
        distance: walk?.distance ?? station.distance,
        geometry: walk?.geometry ?? [[from.lat, from.lng], [station.lat, station.lng]],
        readyAt: when.getTime() + seconds * 1000 + RAIL_BUFFER_MS
      });
    }
    if (station.distance > 700) {
      const raw = await this.#fetchPlan({ from, to: stationPoint, when, arriveBy: false, cursor: null, prefs }).catch(() => null);
      const best = (raw?.itineraries ?? []).map(normalizeItinerary).sort((a, b) => Date.parse(a.end) - Date.parse(b.end))[0];
      if (best) variants.push({ type: 'transit', itinerary: best, readyAt: Date.parse(best.end) + RAIL_BUFFER_MS });
    }
    if (variants.length === 0) return [];
    variants.sort((a, b) => a.readyAt - b.readyAt);
    // הליכה ארוכה מאוד (מעל 25 דק') שווה רק אם אין אוטובוס לתחנה
    const usable = variants.filter((v, i) => i === 0 || v.type === 'transit' || v.seconds <= 25 * 60).slice(0, 2);

    // חלק 2: מהתחנה ליעד – רק מסלולים שהנסיעה הראשונה בהם ברכבת
    const combos = [];
    for (const access of usable) {
      const raw = await this.#fetchPlan({ from: stationPoint, to, when: new Date(access.readyAt), arriveBy: false, cursor: null, prefs }).catch(() => null);
      const cores = (raw?.itineraries ?? [])
        .map(normalizeItinerary)
        .filter((it) => {
          const first = it.legs.find((l) => l.mode !== 'walk');
          const preWalk = it.legs[0].mode === 'walk' ? it.legs[0].duration : 0;
          return first?.mode === 'rail' && preWalk <= 8 * 60;
        })
        .slice(0, 1);
      for (const core of cores) combos.push({ access, core });
    }

    const seenCore = new Set();
    const unique = combos.filter(({ core }) => !seenCore.has(core.id) && seenCore.add(core.id));

    // הגעה לתחנה באוטובוס עם המתנה ארוכה לרכבת: מחשבים מחדש "להגיע עד" זמן הרכבת –
    // כדי שהמסלול יגיד "צאו ב-18:50" ולא "צאו ב-18:02 וחכו שעה בתחנה"
    for (const combo of unique) {
      if (combo.access.type !== 'transit') continue;
      const railStart = Date.parse(combo.core.start);
      const wait = railStart - Date.parse(combo.access.itinerary.end);
      if (wait <= 10 * 60000) continue;
      const raw = await this.#fetchPlan({
        from, to: stationPoint, when: new Date(railStart - RAIL_BUFFER_MS), arriveBy: true, cursor: null, prefs
      }).catch(() => null);
      const latest = (raw?.itineraries ?? [])
        .map(normalizeItinerary)
        .filter((it) => Date.parse(it.end) <= railStart - RAIL_BUFFER_MS + 60000)
        .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0];
      if (latest && Date.parse(latest.start) > Date.parse(combo.access.itinerary.start)) {
        combo.access = { ...combo.access, itinerary: latest };
      }
    }

    return unique.map(({ access, core }) => {
      let legs;
      if (access.type === 'walk') {
        const end = core.start;
        const start = new Date(Date.parse(end) - access.seconds * 1000).toISOString();
        legs = [{
          mode: 'walk',
          rawMode: 'WALK',
          start,
          end,
          scheduledStart: start,
          scheduledEnd: end,
          duration: access.seconds,
          distance: access.distance,
          from: { name: 'נקודת המוצא', code: null, lat: from.lat, lng: from.lng },
          to: { name: station.name, code: station.code, lat: station.lat, lng: station.lng },
          geometry: access.geometry
        }, ...core.legs];
      } else {
        legs = [...access.itinerary.legs, ...core.legs];
      }
      const transit = legs.filter((l) => l.mode !== 'walk');
      const walks = legs.filter((l) => l.mode === 'walk');
      const start = legs[0].start;
      const end = legs[legs.length - 1].end;
      return {
        id: `rail:${station.id}:${core.id}`,
        start,
        end,
        duration: Math.round((Date.parse(end) - Date.parse(start)) / 1000),
        transfers: Math.max(0, transit.length - 1),
        walkMeters: walks.reduce((sum, l) => sum + (l.distance ?? 0), 0),
        walkSeconds: walks.reduce((sum, l) => sum + (l.duration ?? 0), 0),
        modes: [...new Set(transit.map((l) => l.mode))],
        legs,
        viaRail: true
      };
    });
  }

  async #walkOption(from, to) {
    try {
      const r = await this.walkRouter.route(from, to);
      return { seconds: r.realisticSeconds, distance: r.distance, signalized: r.crossings?.signalized ?? 0 };
    } catch {
      return null;
    }
  }

  /**
   * זמן אמת לכל רגל אוטובוס במסלול (לא רק הראשונה): ETA בתחנת העלייה, ואז ETA של אותו אוטובוס
   * בתחנת הירידה – זה זמן ההגעה האמיתי (לוח הזמנים לא יודע על פקקים)
   */
  async #attachLive(itineraries) {
    const now = Date.now();
    const seen = new Set();
    const jobs = [];

    for (const it of itineraries) {
      for (const leg of it.legs) {
        if (leg.mode !== 'bus' || !leg.from.code || seen.has(leg)) continue; // SIRI = אוטובוסים
        seen.add(leg); // מסלולי רכבת משתפים רגליים עם מסלולים אחרים
        const sched = Date.parse(leg.scheduledStart);
        if (sched - now > LIVE_LOOKAHEAD_MIN * 60000 || sched < now - 30 * 60000) continue;
        jobs.push(this.#legLive(leg));
      }
    }

    await Promise.all(jobs);
  }

  async #legLive(leg) {
    try {
      const live = await this.live({
        stopCode: leg.from.code, tripId: leg.tripId, line: leg.line, scheduled: leg.scheduledStart, routeId: leg.routeId, tripStart: leg.tripStart
      });
      if (!live) return;
      leg.live = live;
      if (!leg.to.code) return;
      // אותו אוטובוס בתחנת הירידה: מזהים לפי קו + שעת יציאה מהמוצא שמצאנו בעלייה
      const alight = await this.live({
        stopCode: leg.to.code,
        tripId: leg.tripId,
        line: leg.line,
        scheduled: leg.scheduledEnd,
        routeId: live.routeId ?? leg.routeId,
        tripStart: live.departed ?? leg.tripStart
      }).catch(() => null);
      const sameBus = alight && (alight.exact || !live.exact) && Date.parse(alight.eta) > Date.parse(live.eta);
      if (sameBus) {
        leg.live.arrivalEta = alight.eta;
        leg.live.arrivalDelayMin = alight.delayMin;
      }
    } catch (err) {
      this.log.warn?.(`[transit] live failed for ${leg.from.code}: ${err.message}`);
    }
  }
}
