// ליווי נסיעה בתחבורה ציבורית: באיזו רגל אנחנו, הולכים / מחכים / נוסעים,
// כמה תחנות נשארו, מתי לרדת, והגעה ליעד.
//
// הרעיון: כל רגלי הנסיעה מחוברות לקו גיאומטרי אחד, וכל מיקום GPS "מוצמד" אליו (כמו בניווט הרגלי).
// גבולות הרגליים ומיקומי התחנות מחושבים פעם אחת כמרחק לאורך הקו.

import { buildRouteModel, snapToRoute } from './navigation.js?v=1.8.0-mvoa2j6c';
import { distanceMeters } from './geo.js?v=1.8.0-mvoa2j6c';

const WAIT_RADIUS_M = 40;        // קרוב לתחנה = ממתינים
const LEFT_STOP_M = 70;          // התרחקנו מתחנת העלייה לאורך הקו = עלינו
const STOP_PASS_M = 25;          // עברנו תחנה
const ALIGHT_DONE_M = 35;        // הגענו לתחנת הירידה
const ARRIVE_M = 25;
const OFF_ROUTE_WALK_M = 45;
const OFF_ROUTE_RIDE_M = 90;     // גיאומטריית קווי אוטובוס פחות מדויקת
const OFF_ROUTE_FIXES = 4;

export function buildTripModel(itinerary) {
  const geometry = [];
  const legIdx = [];

  for (const leg of itinerary.legs) {
    const pts = leg.geometry?.length
      ? leg.geometry
      : [[leg.from.lat, leg.from.lng], [leg.to.lat, leg.to.lng]];
    const startIdx = Math.max(0, geometry.length - 1);
    for (const p of pts) {
      const last = geometry[geometry.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      geometry.push(p);
    }
    legIdx.push({ startIdx, endIdx: geometry.length - 1 });
  }

  const model = buildRouteModel({
    geometry,
    realisticSeconds: itinerary.duration,
    maneuvers: []
  });

  const legs = itinerary.legs.map((leg, i) => {
    const { startIdx, endIdx } = legIdx[i];
    const startAlong = model.cum[startIdx];
    const endAlong = model.cum[endIdx];
    let stopAlongs = null;

    if (leg.mode !== 'walk') {
      // מיקום כל תחנה לאורך הקו (מונוטוני, בתוך גבולות הרגל)
      let hint = startIdx;
      let prev = startAlong;
      stopAlongs = [...(leg.stops ?? []), leg.to].map((s) => {
        const snap = snapToRoute(model, s, hint);
        hint = snap.index;
        const along = Math.min(endAlong, Math.max(prev, snap.along));
        prev = along;
        return along;
      });
      stopAlongs[stopAlongs.length - 1] = endAlong; // תחנת הירידה = סוף הרגל
    }

    return { ...leg, startAlong, endAlong, stopAlongs };
  });

  return { ...model, itinerary, legs };
}

export class TripSession {
  constructor(model, { onArrive, onOffRoute, onAlightSoon, onLegChange } = {}) {
    this.model = model;
    this.onArrive = onArrive;
    this.onOffRoute = onOffRoute;
    this.onAlightSoon = onAlightSoon;
    this.onLegChange = onLegChange;

    this.segIndex = 0;
    this.legIndex = 0;
    this.offCount = 0;
    this.alerted = new Set();
    this.arrived = false;
    this.boarded = new Set();
    this.state = null;
  }

  update(pos, now = Date.now()) {
    const { model } = this;
    const snap = snapToRoute(model, pos, this.segIndex);
    this.segIndex = snap.index;
    const along = snap.along;

    // התקדמות בין רגליים – רק קדימה (GPS ליד תחנה "קופץ")
    let legIndex = this.legIndex;
    while (legIndex < model.legs.length - 1 && along > model.legs[legIndex].endAlong + 5) {
      const leg = model.legs[legIndex];
      // מרגל נסיעה עוברים רק אחרי שבאמת הגענו לתחנת הירידה
      if (leg.mode !== 'walk' && along < leg.endAlong - ALIGHT_DONE_M) break;
      legIndex++;
    }
    if (legIndex !== this.legIndex) {
      this.legIndex = legIndex;
      this.onLegChange?.(legIndex);
    }

    const leg = model.legs[legIndex];
    const next = model.legs[legIndex + 1] ?? null;

    // סטייה
    const tolerance = leg.mode === 'walk' ? OFF_ROUTE_WALK_M : OFF_ROUTE_RIDE_M;
    this.offCount = snap.distance > Math.max(tolerance, (pos.accuracy ?? 10) * 0.8) ? this.offCount + 1 : 0;
    if (this.offCount === OFF_ROUTE_FIXES) this.onOffRoute?.(pos);

    let phase;
    let stopsLeft = null;
    let nextStop = null;
    let currentStop = null;   // התחנה האחרונה שעברנו (או תחנת העלייה)
    let stopIndex = null;     // כמה תחנות עברנו מאז שעלינו
    let stopTotal = null;     // כמה תחנות יש עד הירידה

    if (leg.mode === 'walk') {
      const toLegEnd = leg.endAlong - along;
      phase = next && next.mode !== 'walk' && toLegEnd < WAIT_RADIUS_M ? 'waiting' : 'walking';
      if (phase === 'waiting') this.#maybeAdvanceToBoarding(legIndex);
    } else {
      const sinceBoard = along - leg.startAlong;
      const departure = Date.parse(leg.live?.eta ?? leg.start);
      const boarded = this.boarded.has(legIndex) || sinceBoard > LEFT_STOP_M;
      if (boarded) this.boarded.add(legIndex);

      if (!boarded && (now < departure + 90 * 1000 || distanceMeters(pos, leg.from) < WAIT_RADIUS_M * 2)) {
        phase = 'waiting';
      } else {
        phase = 'riding';
        const remaining = leg.stopAlongs.filter((a) => a > along + STOP_PASS_M);
        stopsLeft = remaining.length;
        const idx = leg.stopAlongs.length - remaining.length;
        nextStop = idx < leg.stops.length ? leg.stops[idx] : leg.to;
        currentStop = idx === 0 ? leg.from : (leg.stops[idx - 1] ?? leg.to);
        stopIndex = idx;
        stopTotal = leg.stopAlongs.length;

        if (stopsLeft <= 1 && !this.alerted.has(legIndex)) {
          this.alerted.add(legIndex);
          this.onAlightSoon?.(leg);
        }
      }
    }

    // הגעה ליעד
    const end = model.legs[model.legs.length - 1].to;
    const toEnd = distanceMeters(pos, end);
    if (!this.arrived && legIndex === model.legs.length - 1 && (toEnd <= ARRIVE_M || model.total - along <= ARRIVE_M * 0.6)) {
      this.arrived = true;
      this.onArrive?.();
    }

    // זמן הגעה: זמני המסלול כבר כוללים את זמן האמת מרגע התכנון – מוסיפים רק את השינוי מאז
    // (רענון זמן אמת של הקו הנוכחי/הבא)
    const liveLeg = [leg, next].find((l) => l && l.mode !== 'walk' && l.live);
    const applied = liveLeg?.live.appliedDelayMin;
    const delayMs = !liveLeg ? 0
      : applied != null ? (liveLeg.live.delayMin - applied) * 60000
      : Math.max(0, liveLeg.live.delayMin) * 60000;
    const arrivalMs = Date.parse(model.itinerary.end) + delayMs;

    this.state = {
      legIndex,
      leg,
      next,
      phase,
      // הרגל שעליה ממתינים לעלות (כשמגיעים לתחנה בסוף רגל הליכה – זו הרגל הבאה)
      boardLeg: phase === 'waiting' ? (leg.mode === 'walk' ? next : leg) : null,
      snap,
      along,
      distToLegEnd: Math.max(0, leg.endAlong - along),
      stopsLeft,
      nextStop,
      currentStop,
      stopIndex,
      stopTotal,
      arrival: new Date(arrivalMs).toISOString(),
      remainingSeconds: Math.max(0, Math.round((arrivalMs - now) / 1000)),
      offRoute: this.offCount >= OFF_ROUTE_FIXES
    };
    return this.state;
  }

  // ממתינים בתחנה בסוף רגל הליכה – מעבירים לרגל הנסיעה כדי שהמצב יוצג נכון
  #maybeAdvanceToBoarding(legIndex) {
    if (legIndex + 1 < this.model.legs.length) {
      this.legIndex = legIndex + 1;
      this.onLegChange?.(this.legIndex);
    }
  }

  /** מהירות (מ'/ש') לסימולטור: הליכה ברגלי הליכה, מהירות הרכב לפי לוח הזמנים ברגלי נסיעה */
  static speedAt(model) {
    return (along) => {
      const leg = model.legs.find((l) => along >= l.startAlong && along <= l.endAlong) ?? model.legs[model.legs.length - 1];
      if (leg.mode === 'walk') return 1.35;
      const seconds = Math.max(60, (Date.parse(leg.end) - Date.parse(leg.start)) / 1000);
      return Math.max(2, (leg.endAlong - leg.startAlong) / seconds);
    };
  }
}
