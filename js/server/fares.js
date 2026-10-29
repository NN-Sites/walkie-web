// חישוב מחיר נסיעה ברב-קו / רב-פס (ערך צבור, תעריף מלא) לפי רפורמת "צדק תחבורתי".
//
// מקור: מחירון משרד התחבורה באפליקציית רב-פס –
//   https://s3-eu-west-1.amazonaws.com/static.hopon.co.il/mot/ravPassPrices.html
// נבדק: 2026-10-20. העלאת המחירים שתוכננה לינואר 2026 נדחתה (לא יעלו ב-2026).
// כשהמחירים יתעדכנו – מעדכנים רק את הטבלאות כאן.
//
// כללים (מהעמוד הרשמי):
//  - אוטובוס / רכבת קלה / מטרונית / כרמלית / רכבלית: לפי מרחק בקו אווירי מתחנת העלייה לתחנת הירידה.
//  - רכבת ישראל: לפי המרחק בין התחנות; החלפת רכבת באותה נסיעה – בלי תיקוף נוסף.
//  - רדיוס צהוב (עד 15 ק"מ): מעבר לקו אוטובוס אחר תוך 90 דק' מהתיקוף הראשון – ללא תשלום.
//    מעבר מאוטובוס לרכבת קלה – השלמה למחיר הרכבת הקלה.
//  - מעל 15 ק"מ: מחיר נסיעה בודדת, בלי מעבר חינם. אין הסדר 90 דק' בשילוב רכבת ישראל.

import { distanceMeters } from './geo.js?v=1.10.0-mvu2khrx';

export const FARES_SOURCE = {
  url: 'https://s3-eu-west-1.amazonaws.com/static.hopon.co.il/mot/ravPassPrices.html',
  checkedAt: '2026-10-20'
};

// רדיוסים (ק"מ) ומחירים (₪, כולל מע"מ)
const BANDS = [
  { id: 'yellow', label: 'צהוב', maxKm: 15, bus: 8, lightrail: 8, rail: 11.5, daily: 17.5, dailyRail: 23 },
  { id: 'green', label: 'ירוק', maxKm: 40, bus: 14.5, lightrail: 14.5, rail: 21, daily: 29, dailyRail: 32.5 },
  { id: 'turquoise', label: 'תכלת', maxKm: 75, bus: 19, lightrail: null, rail: 27, daily: 37.5, dailyRail: 42 },
  { id: 'blue', label: 'כחול', maxKm: 120, bus: 19, lightrail: null, rail: 30.5, daily: 37.5, dailyRail: 47 },
  { id: 'purple', label: 'סגול', maxKm: 225, bus: 30.5, lightrail: null, rail: 52.5, daily: 60.5, dailyRail: 80.5 },
  { id: 'grey', label: 'אפור', maxKm: Infinity, bus: 87.32, lightrail: null, rail: null, daily: 79.5, dailyRail: null }
];

const TRANSFER_WINDOW_MS = 90 * 60 * 1000;

export function bandFor(km) {
  return BANDS.find((b) => km <= b.maxKm) ?? BANDS[BANDS.length - 1];
}

/**
 * מחלק את המסלול ל"נסיעות" לתשלום: כל קו אוטובוס/רכבת קלה הוא נסיעה,
 * ורגלי רכבת ישראל רצופות (החלפת רכבת) הן נסיעה אחת.
 */
function toRides(legs) {
  const rides = [];
  for (const leg of legs) {
    if (leg.mode === 'walk') continue;
    const last = rides[rides.length - 1];
    if (leg.mode === 'rail' && last?.mode === 'rail' && last.contiguous) {
      last.to = leg.to;
      last.end = leg.end;
      last.lines.push(leg.trainNumber ?? leg.line);
      continue;
    }
    rides.push({
      mode: leg.mode === 'rail' ? 'rail' : leg.mode === 'lightrail' ? 'lightrail' : 'bus',
      label: leg.mode === 'rail' ? 'רכבת ישראל' : leg.line ? `קו ${leg.line}` : 'נסיעה',
      from: leg.from,
      to: leg.to,
      start: leg.start,
      end: leg.end,
      lines: [leg.trainNumber ?? leg.line],
      contiguous: true
    });
  }
  // רגל הליכה בין רכבות (מעבר רציף) לא שוברת את הנסיעה ברכבת; כל אמצעי אחר באמצע כן
  return rides;
}

/**
 * מחיר מלא (ערך צבור / רב-פס) למסלול.
 * מחזיר { total, currency, rides: [{ label, mode, km, band, price, note }], dailyCap, notes } או null.
 */
export function computeFare(itinerary) {
  const rides = toRides(itinerary.legs ?? []);
  if (rides.length === 0) return null;

  let total = 0;
  let windowStart = null;      // תחילת חלון 90 הדקות (נסיעה ברדיוס צהוב)
  let windowPaid = 0;          // כמה שולם בחלון (להשלמה לרכבת קלה)
  let longestBand = BANDS[0];
  let hasRail = false;
  const out = [];
  const notes = [];

  for (const ride of rides) {
    if (!Number.isFinite(ride.from?.lat) || !Number.isFinite(ride.to?.lat)) return null;
    const km = distanceMeters(ride.from, ride.to) / 1000;
    const band = bandFor(km);
    if (BANDS.indexOf(band) > BANDS.indexOf(longestBand)) longestBand = band;
    const start = Date.parse(ride.start);

    let price;
    let note = null;

    if (ride.mode === 'rail') {
      hasRail = true;
      price = band.rail;
      if (price === null) return null; // אין תעריף רכבת לטווח הזה
      windowStart = null; // אין הסדר 90 דק' בשילוב רכבת ישראל
    } else {
      const full = ride.mode === 'lightrail' ? (band.lightrail ?? band.bus) : band.bus;
      const inWindow = band.id === 'yellow' && windowStart !== null && start - windowStart <= TRANSFER_WINDOW_MS;
      if (inWindow) {
        // מעבר חינם; לרכבת קלה – השלמה להפרש
        price = Math.max(0, full - windowPaid);
        note = price === 0 ? 'מעבר חינם (90 דק\')' : 'השלמה לרכבת קלה';
        windowPaid += price;
      } else {
        price = full;
        if (band.id === 'yellow') {
          windowStart = start;
          windowPaid = price;
        } else {
          windowStart = null;
        }
      }
    }

    total += price;
    out.push({ label: ride.label, mode: ride.mode, km: Math.round(km * 10) / 10, band: band.label, price, note });
  }

  // תקרה יומית: לפי הנסיעה הארוכה ביותר (אם הסכום חורג – משלמים רק את התקרה)
  const dailyCap = hasRail ? longestBand.dailyRail : longestBand.daily;
  if (dailyCap && total > dailyCap) {
    notes.push(`החיוב נעצר בתקרה היומית (חופשי יומי) – ₪${dailyCap}`);
    total = dailyCap;
  }

  return {
    total: Math.round(total * 100) / 100,
    currency: 'ILS',
    rides: out,
    dailyCap,
    notes,
    profileNote: 'מחיר מלא. עם פרופיל הנחה ברב-קו (נוער, סטודנטים, אזרחים ותיקים ועוד) המחיר נמוך יותר.',
    source: FARES_SOURCE
  };
}
