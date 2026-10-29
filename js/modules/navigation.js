// מנוע הניווט: הצמדה למסלול, התקדמות, זיהוי סטייה, הגעה ליעד, וסימולטור לבדיקות.

import {
  NAV_OFF_ROUTE_M,
  NAV_OFF_ROUTE_FIXES,
  NAV_REROUTE_COOLDOWN_MS,
  NAV_ARRIVE_M,
  NAV_APPROACH_M,
  SIM_SPEEDUP
} from '../config.js?v=1.10.0-mvu2khrx';
import { distanceMeters, bearingDeg } from './geo.js?v=1.10.0-mvu2khrx';

const M_PER_DEG = 111320;

/** מכין את המסלול לניווט: נקודות + מרחק מצטבר לכל נקודה */
export function buildRouteModel(route) {
  const pts = route.geometry.map(([lat, lng]) => ({ lat, lng }));
  const cum = new Array(pts.length).fill(0);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + distanceMeters(pts[i - 1], pts[i]);
  const total = cum[cum.length - 1] || 1;
  return {
    ...route,
    pts,
    cum,
    total,
    // שניות למטר לפי המודל הריאליסטי (כולל המתנות), לחישוב זמן נותר
    secPerMeter: route.realisticSeconds / total
  };
}

/** הטלה של נקודה על קטע AB במטרים (קירוב מקומי שטוח – מדויק מספיק לעשרות מטרים) */
function projectOnSegment(p, a, b) {
  const kx = Math.cos((p.lat * Math.PI) / 180) * M_PER_DEG;
  const ax = (a.lng - p.lng) * kx;
  const ay = (a.lat - p.lat) * M_PER_DEG;
  const bx = (b.lng - p.lng) * kx;
  const by = (b.lat - p.lat) * M_PER_DEG;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return { t, dist: Math.hypot(px, py) };
}

/** הנקודה הקרובה ביותר במסלול. hint = אינדקס הקטע הקודם (חיפוש מקומי קודם – מהיר) */
export function snapToRoute(model, pos, hint = 0) {
  const n = model.pts.length;
  if (n < 2) return { index: 0, t: 0, along: 0, distance: distanceMeters(pos, model.pts[0] ?? pos), point: model.pts[0] };

  const scan = (from, to) => {
    let best = null;
    for (let i = from; i < to; i++) {
      const r = projectOnSegment(pos, model.pts[i], model.pts[i + 1]);
      if (!best || r.dist < best.dist) best = { index: i, t: r.t, dist: r.dist };
    }
    return best;
  };

  let best = scan(Math.max(0, hint - 3), Math.min(n - 1, hint + 40));
  if (!best || best.dist > 40) {
    const global = scan(0, n - 1);
    if (global && (!best || global.dist < best.dist)) best = global;
  }

  const a = model.pts[best.index];
  const b = model.pts[best.index + 1];
  const segLen = model.cum[best.index + 1] - model.cum[best.index];
  return {
    index: best.index,
    t: best.t,
    distance: best.dist,
    along: model.cum[best.index] + best.t * segLen,
    point: { lat: a.lat + (b.lat - a.lat) * best.t, lng: a.lng + (b.lng - a.lng) * best.t },
    bearing: bearingDeg(a, b)
  };
}

/** נקודה במרחק along לאורך המסלול */
export function pointAt(model, along) {
  const d = Math.max(0, Math.min(model.total, along));
  let i = 0;
  while (i < model.cum.length - 2 && model.cum[i + 1] < d) i++;
  const a = model.pts[i];
  const b = model.pts[i + 1] ?? a;
  const segLen = model.cum[i + 1] - model.cum[i] || 1;
  const t = (d - model.cum[i]) / segLen;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    bearing: bearingDeg(a, b)
  };
}

export class NavigationSession {
  constructor(model, { onOffRoute, onArrive, onApproach }) {
    this.model = model;
    this.onOffRoute = onOffRoute;
    this.onArrive = onArrive;
    this.onApproach = onApproach;

    this.segIndex = 0;
    this.offCount = 0;
    this.lastRerouteAt = 0;
    this.arrived = false;
    this.announced = new Set();
    this.state = null;
  }

  /** הקצה הבא: התמרון הראשון שמתחיל אחרי המיקום הנוכחי */
  #nextManeuverIndex(snapIndex) {
    const list = this.model.maneuvers;
    for (let k = 1; k < list.length; k++) {
      if (list[k].beginIndex > snapIndex) return k;
    }
    return list.length - 1;
  }

  update(pos) {
    const model = this.model;
    const snap = snapToRoute(model, pos, this.segIndex);
    this.segIndex = snap.index;

    // סטייה מהמסלול – רק אחרי כמה מדידות רצופות (GPS בעיר "קופץ")
    const tolerance = Math.max(NAV_OFF_ROUTE_M, Math.min(60, (pos.accuracy ?? 10) * 0.8));
    if (snap.distance > tolerance) this.offCount++;
    else this.offCount = 0;

    if (
      this.offCount >= NAV_OFF_ROUTE_FIXES &&
      Date.now() - this.lastRerouteAt > NAV_REROUTE_COOLDOWN_MS &&
      !this.arrived
    ) {
      this.lastRerouteAt = Date.now();
      this.offCount = 0;
      this.onOffRoute?.(pos);
    }

    const remaining = Math.max(0, model.total - snap.along);
    const end = model.pts[model.pts.length - 1];
    const toEnd = distanceMeters(pos, end);

    const nextIdx = this.#nextManeuverIndex(snap.index);
    const next = model.maneuvers[nextIdx];
    const distToNext = Math.max(0, model.cum[Math.min(next.beginIndex, model.cum.length - 1)] - snap.along);

    if (!this.announced.has(nextIdx) && distToNext <= NAV_APPROACH_M && nextIdx < model.maneuvers.length - 1) {
      this.announced.add(nextIdx);
      this.onApproach?.(next);
    }

    if (!this.arrived && (toEnd <= NAV_ARRIVE_M || remaining <= NAV_ARRIVE_M * 0.5)) {
      this.arrived = true;
      this.onArrive?.();
    }

    this.state = {
      snap,
      remaining,
      remainingSeconds: Math.round(remaining * model.secPerMeter),
      next,
      nextIndex: nextIdx,
      distToNext,
      offRoute: snap.distance > tolerance
    };
    return this.state;
  }
}

/**
 * סימולטור הליכה לאורך המסלול – לפיתוח ולהדגמות (?sim=1).
 * מייצר מיקומים באותו פורמט כמו LocationTracker.
 */
export class RouteSimulator {
  /**
   * speedAt(along) – מהירות (מ'/ש') לפי המיקום במסלול. ברירת מחדל: הליכה.
   * בנסיעה בתחבורה ציבורית: הליכה ברגלי הליכה, מהירות האוטובוס לפי לוח הזמנים ברגלי נסיעה.
   */
  constructor(model, onPosition, { speedMps = 1.35, speedAt = null, speedup = SIM_SPEEDUP, intervalMs = 1000 } = {}) {
    this.model = model;
    this.onPosition = onPosition;
    this.speedAt = speedAt ?? (() => speedMps);
    this.speedup = speedup;
    this.intervalMs = intervalMs;
    this.along = 0;
    this.timer = null;
  }

  get speed() {
    return this.speedAt(this.along) * this.speedup;
  }

  start() {
    this.stop();
    this.#emit();
    this.timer = setInterval(() => {
      this.along += this.speed * (this.intervalMs / 1000);
      this.#emit();
      if (this.along >= this.model.total) this.stop();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setModel(model) {
    this.model = model;
    this.along = 0;
  }

  #emit() {
    const p = pointAt(this.model, this.along);
    this.onPosition({
      lat: p.lat,
      lng: p.lng,
      accuracy: 5,
      heading: p.bearing,
      speed: this.speed,
      ts: Date.now(),
      simulated: true
    });
  }
}
