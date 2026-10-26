// זיהוי "אני באוטובוס של קו X" לפי התנועה שלי על מסלול הקו, ושימוש במשתמשים כאלה לדיוק מיקום האוטובוס.
//
// שני חלקים (פונקציות טהורות, בלי רשת ובלי DOM):
//  - BusRideDetector: מקבל דגימות GPS של המשתמש ומסלול של קו. אם הוא צמוד למסלול, מתקדם בכיוון הקו
//    ובמהירות של אוטובוס (לא הליכה ולא רכיבה איטית) – הוא כנראה באוטובוס הזה, ומוחזר מיקום לדיווח.
//  - fuseBusFixes: מקבל את אוטובוסי SIRI של הקו ודיווחים של נוסעים, ומחליף את המיקום של האוטובוס
//    במיקום הטרי של הנוסע שנמצא עליו (או מוסיף אוטובוס ש-SIRI לא מדווח עליו).

import { pathIndex, snap, pointAt } from './vehicle-motion.js?v=1.9.0-mvpredcv';

const WINDOW_MS = 45000;          // כמה זמן תנועה רצופה על המסלול נדרש לפני שמכריזים "באוטובוס"
const MIN_SAMPLES = 3;
const MIN_BUS_SPEED = 4;          // מ'/ש' (~14 קמ"ש): מעל הליכה וריצה
const MAX_BUS_SPEED = 30;         // ~108 קמ"ש
const KEEP_MIN_SPEED = 1.5;       // אחרי זיהוי: עצירה בתחנה / ברמזור לא מבטלת
const STOP_GRACE_MS = 60000;      // ...אבל לא יותר מזה בלי תנועה (אחרת נוסע שירד בתחנה יישאר "אוטובוס")
const RECENT_MS = 15000;          // חלון קצר לבדיקה האם הוא זז ממש עכשיו
const MAX_ACCURACY_M = 50;
const ON_ROUTE_M = 35;            // סטייה מותרת מהמסלול (מתרחבת עם חוסר הדיוק של ה-GPS)
const MAX_GAP_MS = 20000;         // פער ארוך בין דגימות = מתחילים מחדש
const BACKWARD_M = 25;            // נסיעה נגד כיוון הקו (או קו הפוך באותו רחוב) לא נחשבת

const rad = (d) => (d * Math.PI) / 180;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
};

/** כיוון המסלול (מעלות, 0 = צפון) בנקודה along */
export function pathBearing(path, along) {
  const idx = pathIndex(path);
  const [lat1, lng1] = pointAt(idx, along - 15);
  const [lat2, lng2] = pointAt(idx, along + 15);
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

export class BusRideDetector {
  #path = null;
  #sig = null;
  #samples = [];
  #riding = false;
  #lastMoving = 0;
  #lastReport = null;

  /**
   * path = [[lat, lng], …] של הקו; null מאפס. sig מזהה את הקו+כיוון: אם הוא לא השתנה
   * (למשל רענון פרטי הקו שמחזיר מערך חדש) – המעקב ממשיך ברצף.
   */
  setPath(path, sig = path) {
    this.#path = path?.length > 1 ? path : null;
    if (sig === this.#sig) return;
    this.#sig = sig;
    this.reset();
  }

  get riding() {
    return this.#riding;
  }

  reset() {
    this.#samples = [];
    this.#riding = false;
    this.#lastMoving = 0;
    this.#lastReport = null;
  }

  /**
   * p = { lat, lng, accuracy, speed, ts }. מחזיר דיווח { lat, lng, speed, heading, along, ts } כשהמשתמש
   * מזוהה כנוסע באוטובוס של הקו, אחרת null.
   */
  update(p) {
    if (!this.#path || !Number.isFinite(p?.lat)) return null;
    if ((p.accuracy ?? 0) > MAX_ACCURACY_M) return null;
    const ts = p.ts ?? Date.now();
    const idx = pathIndex(this.#path);
    const s = snap(idx, p.lat, p.lng);
    const tolerance = ON_ROUTE_M + Math.min(25, (p.accuracy ?? 0) * 0.5);
    const prev = this.#samples[this.#samples.length - 1];
    const offRoute = s.dist > tolerance;
    if (offRoute || (prev && ts - prev.ts > MAX_GAP_MS) || (prev && s.along < prev.along - BACKWARD_M)) {
      this.reset();
      if (offRoute) return null;
    }
    this.#samples.push({ ts, along: s.along, speed: Number.isFinite(p.speed) ? p.speed : null });
    while (this.#samples.length > 2 && ts - this.#samples[1].ts >= WINDOW_MS) this.#samples.shift();

    const speed = this.#speed();
    if (speed == null) return null;
    if (speed > MAX_BUS_SPEED) {
      this.reset();
      return null;
    }
    if (!this.#riding && speed >= MIN_BUS_SPEED && this.#span() >= WINDOW_MS * 0.6) {
      this.#riding = true;
      this.#lastMoving = ts;
    }
    if (!this.#riding) return null;
    if (this.#recentSpeed() >= KEEP_MIN_SPEED) this.#lastMoving = ts;
    else if (ts - this.#lastMoving > STOP_GRACE_MS) {
      this.reset();
      return null;
    }
    this.#lastReport = {
      lat: p.lat, lng: p.lng, speed: +speed.toFixed(1), along: s.along, ts,
      heading: Math.round(pathBearing(this.#path, s.along))
    };
    return this.#lastReport;
  }

  /** מהירות בחלון הקצר האחרון (0 אם אין מספיק דגימות: נחשב עומד) */
  #recentSpeed() {
    const a = this.#samples;
    const last = a[a.length - 1];
    const from = a.find((x) => last.ts - x.ts <= RECENT_MS);
    const dt = (last.ts - from.ts) / 1000;
    return dt >= 6 ? Math.max(0, last.along - from.along) / dt : KEEP_MIN_SPEED;
  }

  #span() {
    const a = this.#samples;
    return a.length ? a[a.length - 1].ts - a[0].ts : 0;
  }

  /** מהירות לאורך המסלול (מ'/ש'): התקדמות בפועל על המסלול, ואם המכשיר מדווח מהירות – היא חייבת להסכים */
  #speed() {
    const a = this.#samples;
    if (a.length < MIN_SAMPLES) return null;
    const dt = (a[a.length - 1].ts - a[0].ts) / 1000;
    if (dt < 8) return null;
    const along = (a[a.length - 1].along - a[0].along) / dt;
    const reported = a.map((x) => x.speed).filter((x) => x != null);
    if (reported.length >= MIN_SAMPLES) return Math.min(along, Math.max(median(reported), 0));
    return along;
  }
}

// ---------- איחוד עם SIRI ----------

const FIX_MAX_AGE_MS = 45000;     // דיווח ישן מזה לא מוצג
const CLUSTER_M = 80;             // כמה נוסעים באותו אוטובוס = אותו דיווח
const MATCH_M = 900;              // מרחק מקסימלי לאורך הקו בין SIRI לנוסע כדי להיחשב אותו אוטובוס
const HEADING_TOL = 60;

/** מאחד דיווחים של כמה נוסעים באותו אוטובוס לדיווח אחד (הטרי ביותר) */
function cluster(fixes) {
  const sorted = [...fixes].sort((a, b) => a.along - b.along);
  const groups = [];
  for (const f of sorted) {
    const g = groups[groups.length - 1];
    if (g && f.along - g[g.length - 1].along <= CLUSTER_M) g.push(f);
    else groups.push([f]);
  }
  return groups.map((g) => g.reduce((best, f) => (f.ts > best.ts ? f : best)));
}

/**
 * vehicles = אוטובוסי SIRI כפי שנשלחים ל-VehiclesLayer.render: { id, lat, lng, recordedAt, … }
 * fixes = דיווחי נוסעים { lat, lng, ts, heading, speed, uid }
 * path = מסלול הקו המוצג. מחזיר רשימה חדשה (לא משנה את הקלט).
 * ownUid – הדיווח של המשתמש עצמו לא נספר (הוא באוטובוס, לא מחכה לו)
 */
export function fuseBusFixes(vehicles, fixes, path, { now = Date.now(), ownUid = null, template = {} } = {}) {
  if (!path?.length || !fixes?.length) return vehicles;
  const idx = pathIndex(path);
  const fresh = [];
  for (const f of fixes) {
    if (f.uid && f.uid === ownUid) continue;
    if (!Number.isFinite(f.lat) || now - f.ts > FIX_MAX_AGE_MS || f.ts > now + 10000) continue;
    const s = snap(idx, f.lat, f.lng);
    if (s.dist > ON_ROUTE_M * 2) continue;
    if (Number.isFinite(f.heading) && angleDiff(f.heading, pathBearing(path, s.along)) > HEADING_TOL) continue;
    fresh.push({ ...f, along: s.along });
  }
  const crowd = cluster(fresh);
  if (!crowd.length) return vehicles;

  const out = vehicles.map((v) => ({ ...v, _along: snap(idx, v.lat, v.lng).along }));
  const usedCrowd = new Set();
  const usedVehicle = new Set();
  const pairs = [];
  out.forEach((v, i) => crowd.forEach((c, j) => pairs.push({ i, j, d: Math.abs(v._along - c.along) })));
  pairs.sort((a, b) => a.d - b.d); // הזוגות הקרובים ביותר קודם
  for (const { i, j, d } of pairs) {
    if (d > MATCH_M || usedVehicle.has(i) || usedCrowd.has(j)) continue;
    usedVehicle.add(i);
    usedCrowd.add(j);
    const v = out[i];
    const c = crowd[j];
    const sirAt = v.recordedAt ? Date.parse(v.recordedAt) : 0;
    if (!(c.ts > sirAt)) continue; // SIRI טרי יותר מהנוסע – נשאר כמו שהוא
    v.lat = c.lat;
    v.lng = c.lng;
    v.recordedAt = new Date(c.ts).toISOString();
    v.crowd = true;
  }
  crowd.forEach((c, j) => {
    if (usedCrowd.has(j)) return;
    // נוסע על אוטובוס ש-SIRI לא מדווח עליו: מוסיפים אותו
    out.push({
      ...template, id: `crowd-${Math.round(c.along / CLUSTER_M)}`, lat: c.lat, lng: c.lng,
      recordedAt: new Date(c.ts).toISOString(), crowd: true, _along: c.along
    });
  });
  return out.map(({ _along, ...v }) => v);
}
