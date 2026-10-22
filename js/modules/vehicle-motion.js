// תנועת אוטובוס בין עדכוני GPS: איפה הוא "כנראה" עכשיו.
//
// SIRI מוסר מיקום פעם בכחצי דקה עד דקה. בין עדכון לעדכון מקדמים את האוטובוס לפי המהירות הממוצעת
// בקטע שבו הוא נמצא, וכשמגיע מיקום אמיתי חדש – מתקנים אליו בהחלקה (vehicles layer ב-map.js).
//
// שני מצבים:
//  - path:   יש מסלול הקו (פרטי קו). מצמידים את המיקום האמיתי למסלול, ומקדמים לאורכו.
//            המהירות בכל קטע = המרחק בין שתי תחנות / הזמן ביניהן בלוח הזמנים (כולל עצירות).
//  - target: אין מסלול, רק התחנה שהאוטובוס בדרך אליה וזמן ההגעה (מסך הבית, תחנה, מסלול נסיעה).
//            מקדמים בקו ישר לכיוון התחנה, במהירות שנגזרת מזמן ההגעה, ולא עד התחנה עצמה.

const R = 6371000;
const DEFAULT_SPEED = 6.5;          // מ'/ש' (~23 קמ"ש) כשאין זמנים בלוח
const MIN_SPEED = 1.5;
const MAX_SPEED = 22;               // ~80 קמ"ש – קווים בין-עירוניים
const MAX_EXTRAPOLATE_S = 120;      // לא "מנחשים" יותר משתי דקות קדימה בלי עדכון אמיתי
const MAX_OFF_PATH_M = 150;         // רחוק יותר מהמסלול = אוטובוס בדרך אחרת (למשל בכיוון ההפוך)
const TERMINAL_M = 200;             // ליד תחנת המוצא, לפני שעת היציאה – עומד במקום
const TARGET_MAX_FRACTION = 0.85;   // בלי מסלול לא "מגיעים" לתחנה לפני המיקום האמיתי
const TARGET_MAX_EXTRAPOLATE_S = 90;

const rad = (d) => (d * Math.PI) / 180;

/** הקרנה מקומית (מטרים) – מדויקת מספיק לטווח של עיר */
function projector(lat0) {
  const kx = R * Math.cos(rad(lat0));
  return {
    to: (lat, lng) => [rad(lng) * kx, rad(lat) * R],
    from: (x, y) => [(y / R) * (180 / Math.PI), (x / kx) * (180 / Math.PI)]
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- מסלול: אינדקס למרחקים לאורך הקו ----------

const pathCache = new WeakMap();

function pathIndex(path) {
  let idx = pathCache.get(path);
  if (idx) return idx;
  const proj = projector(path[0][0]);
  const xy = path.map(([lat, lng]) => proj.to(lat, lng));
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  idx = { proj, xy, cum, length: cum[cum.length - 1] };
  pathCache.set(path, idx);
  return idx;
}

/** הנקודה הקרובה ביותר על המסלול: { along, dist, index } (from = אינדקס התחלה לחיפוש קדימה) */
function snap(idx, lat, lng, from = 0) {
  const [px, py] = idx.proj.to(lat, lng);
  let best = { along: 0, dist: Infinity, index: 0 };
  for (let i = Math.max(0, from); i < idx.xy.length - 1; i++) {
    const [ax, ay] = idx.xy[i];
    const [bx, by] = idx.xy[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const k = len2 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
    const d = Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
    if (d < best.dist) best = { along: idx.cum[i] + k * Math.sqrt(len2), dist: d, index: i };
  }
  return best;
}

function pointAt(idx, along) {
  const s = clamp(along, 0, idx.length);
  let lo = 0;
  let hi = idx.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (idx.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = idx.cum[hi] - idx.cum[lo] || 1;
  const k = (s - idx.cum[lo]) / seg;
  const [ax, ay] = idx.xy[lo];
  const [bx, by] = idx.xy[hi];
  return idx.proj.from(ax + (bx - ax) * k, ay + (by - ay) * k);
}

/**
 * פרופיל מהירות לאורך המסלול לפי התחנות ושעותיהן: [{ along, speed }] – מהירות הקטע שמתחיל בתחנה.
 * stops = [{ lat, lng, time }] (time = ISO, מלוח הזמנים)
 */
const profileCache = new WeakMap();

function speedProfile(idx, stops) {
  if (!stops?.length) return [{ along: 0, speed: DEFAULT_SPEED }];
  let profile = profileCache.get(stops);
  if (profile) return profile;
  const points = [];
  let hint = 0;
  let prev = 0;
  for (const s of stops) {
    if (!Number.isFinite(s.lat)) continue;
    const p = snap(idx, s.lat, s.lng, hint);
    hint = p.index;
    prev = Math.max(prev, p.along);
    points.push({ along: prev, t: s.time ? Date.parse(s.time) : NaN });
  }
  profile = points.map((p, i) => {
    const next = points[i + 1];
    const dt = next ? (next.t - p.t) / 1000 : NaN;
    const speed = next && dt > 0 ? clamp((next.along - p.along) / dt, MIN_SPEED, MAX_SPEED) : null;
    return { along: p.along, speed };
  });
  // קטע בלי זמנים תקינים – המהירות של הקטע הקודם (או ברירת מחדל)
  let last = DEFAULT_SPEED;
  for (const p of profile) {
    if (p.speed == null) p.speed = last;
    last = p.speed;
  }
  if (profile.length === 0 || profile[0].along > 0) profile.unshift({ along: 0, speed: profile[0]?.speed ?? DEFAULT_SPEED });
  profileCache.set(stops, profile);
  return profile;
}

/** מתקדמים seconds שניות מ-along, קטע אחרי קטע (כל קטע במהירות שלו) */
function advance(profile, along, seconds, end) {
  let s = along;
  let left = seconds;
  let i = profile.length - 1;
  while (i > 0 && profile[i].along > s) i--;
  while (left > 0 && s < end) {
    const { speed } = profile[i];
    const boundary = i + 1 < profile.length ? profile[i + 1].along : end;
    const need = (boundary - s) / speed;
    if (need >= left || i + 1 >= profile.length) {
      s += speed * left;
      break;
    }
    s = boundary;
    left -= need;
    i++;
  }
  return Math.min(s, end);
}

// ---------- המודל ----------

/**
 * spec:
 *   fix:    { lat, lng, at }        – המיקום האמיתי האחרון ומתי נמדד (ms)
 *   path:   [[lat, lng], ...]       – מסלול הקו (אופציונלי)
 *   stops:  [{ lat, lng, time }]    – תחנות המסלול עם השעות (למהירויות)
 *   holdUntil: ms                   – לא זזים לפני הזמן הזה אם עומדים בתחנת המוצא
 *   target: { lat, lng, at }        – בלי מסלול: התחנה שהאוטובוס בדרך אליה, ומתי יגיע (ms)
 * מחזיר { moving, positionAt(now) -> [lat, lng] }
 */
export function createMotion(spec) {
  const { fix } = spec;
  const still = { moving: false, positionAt: () => [fix.lat, fix.lng] };
  if (!fix || !Number.isFinite(fix.lat)) return still;
  const fixAt = Number.isFinite(fix.at) ? fix.at : Date.now();

  if (spec.path?.length > 1) {
    const idx = pathIndex(spec.path);
    const p = snap(idx, fix.lat, fix.lng);
    if (p.dist > MAX_OFF_PATH_M) return still;
    const profile = speedProfile(idx, spec.stops);
    const startAt = spec.holdUntil && p.along < TERMINAL_M ? Math.max(fixAt, spec.holdUntil) : fixAt;
    return {
      moving: true,
      positionAt(now) {
        const dt = clamp((now - startAt) / 1000, 0, MAX_EXTRAPOLATE_S);
        return pointAt(idx, advance(profile, p.along, dt, idx.length));
      }
    };
  }

  const tg = spec.target;
  if (tg && Number.isFinite(tg.lat)) {
    const proj = projector(fix.lat);
    const [x0, y0] = proj.to(fix.lat, fix.lng);
    const [x1, y1] = proj.to(tg.lat, tg.lng);
    const dist = Math.hypot(x1 - x0, y1 - y0);
    if (dist < 30) return still;
    const seconds = Math.max(30, ((Number.isFinite(tg.at) ? tg.at : fixAt + 300000) - fixAt) / 1000);
    const speed = clamp(dist / seconds, MIN_SPEED, 15);
    return {
      moving: true,
      positionAt(now) {
        const dt = clamp((now - fixAt) / 1000, 0, TARGET_MAX_EXTRAPOLATE_S);
        const k = Math.min(speed * dt, dist * TARGET_MAX_FRACTION) / dist;
        return proj.from(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
      }
    };
  }

  return still;
}
