// שבת וחגים: מתי אין תחבורה ציבורית בישראל, ומתי היא חוזרת.
//
// "ימי מנוחה" = שבת + ימים טובים (לפי לוח ארץ ישראל): ראש השנה (2 ימים), יום כיפור, סוכות,
// שמחת תורה, פסח, שביעי של פסח, שבועות. השירות נעצר בכניסת היום (שקיעה פחות ~20 דק' ביום שלפני)
// וחוזר בהדרגה אחרי צאתו (השמש 8.5° מתחת לאופק).
//
// התאריך העברי מגיע מ-Intl (לוח "hebrew" של ICU, קיים באנדרואיד ובכל דפדפן מודרני).
// אם הוא לא זמין – מזהים רק שבת.

import { t, LOCALE } from './i18n.js?v=1.5.0-mvks4yx4';

const TZ = 'Asia/Jerusalem';
const DAY_MS = 24 * 3600 * 1000;
const CANDLE_BEFORE_SUNSET_MIN = 20;
const EREV_WARN_FROM_HOUR = 12;       // בערב שבת/חג – אזהרה מ-12:00 (קווים רבים מסיימים אחר הצהריים)
const RESUMING_WINDOW_MIN = 90;       // אחרי צאת השבת – "השירות חוזר בהדרגה"

// [חודש עברי (כפי ש-ICU מחזיר באנגלית), יום] -> שם החג
const YOM_TOV = {
  'Tishri|1': 'ראש השנה',
  'Tishri|2': 'ראש השנה',
  'Tishri|10': 'יום כיפור',
  'Tishri|15': 'סוכות',
  'Tishri|22': 'שמחת תורה',
  'Nisan|15': 'פסח',
  'Nisan|21': 'שביעי של פסח',
  'Sivan|6': 'שבועות'
};

let civilFmt = null;
let hebrewFmt = null;
try {
  civilFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
  hebrewFmt = new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: 'UTC', month: 'long', day: 'numeric' });
  // דפדפן בלי לוח עברי מחזיר חודש לועזי – אז מוותרים על החגים
  const probe = hebrewFmt.formatToParts(new Date(Date.UTC(2025, 8, 23, 12))); // א' תשרי תשפ"ו
  if (probe.find((p) => p.type === 'month')?.value !== 'Tishri') hebrewFmt = null;
} catch {
  hebrewFmt = null;
}

/** התאריך האזרחי בישראל: { y, m, d, hour, weekday } */
function civil(ms) {
  const parts = Object.fromEntries(civilFmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, hour: +parts.hour, weekday: parts.weekday };
}

/** "יום" = חצות UTC של התאריך האזרחי (מספיק לחשבון ימים ולשקיעה) */
function dayKey({ y, m, d }) {
  return Date.UTC(y, m - 1, d);
}

function weekdayOf(day) {
  return new Date(day).getUTCDay(); // 6 = שבת
}

/** שם החג/שבת אם היום הוא יום מנוחה, אחרת null */
function restName(day) {
  if (hebrewFmt) {
    const parts = Object.fromEntries(hebrewFmt.formatToParts(new Date(day + 12 * 3600 * 1000)).map((p) => [p.type, p.value]));
    const name = YOM_TOV[`${parts.month}|${parts.day}`];
    if (name) return name;
  }
  return weekdayOf(day) === 6 ? 'שבת' : null;
}

// ---------- שקיעה / צאת הכוכבים (אלגוריתם Almanac for Computers, דיוק של כדקה) ----------

const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const mod = (a, n) => ((a % n) + n) % n;

/** רגע שבו מרכז השמש בזנית הנתונה, אחר הצהריים (שקיעה=90.833, צאת הכוכבים=98.5) */
function solarEvening(day, lat, lng, zenith) {
  const date = new Date(day);
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const N = Math.round((day - start) / DAY_MS);
  const lngHour = lng / 15;
  const tt = N + (18 - lngHour) / 24;
  const M = 0.9856 * tt - 3.289;
  const L = mod(M + 1.916 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 282.634, 360);
  let RA = mod(deg(Math.atan(0.91764 * Math.tan(rad(L)))), 360);
  RA = (RA + Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90) / 15;
  const sinDec = 0.39782 * Math.sin(rad(L));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(rad(zenith)) - sinDec * Math.sin(rad(lat))) / (cosDec * Math.cos(rad(lat)));
  const H = deg(Math.acos(Math.min(1, Math.max(-1, cosH)))) / 15;
  const T = H + RA - 0.06571 * tt - 6.622;
  const UT = mod(T - lngHour, 24);
  return day + UT * 3600 * 1000;
}

const sunset = (day, p) => solarEvening(day, p.lat, p.lng, 90.833);
const candleLighting = (day, p) => sunset(day, p) - CANDLE_BEFORE_SUNSET_MIN * 60000;
const nightfall = (day, p) => solarEvening(day, p.lat, p.lng, 98.5);

// ---------- מצב השירות ----------

/**
 * מצב התחבורה הציבורית ברגע נתון:
 *   { state: 'normal' }
 *   { state: 'erev', name, startsAt }       – ערב שבת/חג: השירות מסתיים היום
 *   { state: 'rest', name, endsAt }          – שבת/חג: אין שירות עד endsAt (צאת השבת/החג)
 *   { state: 'resuming', name, endedAt }     – השירות חוזר בהדרגה
 * place = { lat, lng } לחישוב השקיעה (ברירת מחדל: מרכז הארץ)
 */
export function serviceStatus(ms = Date.now(), place = null) {
  if (!civilFmt) return { state: 'normal' };
  const p = place && Number.isFinite(place.lat) ? place : { lat: 32.08, lng: 34.78 };
  const c = civil(ms);
  const today = dayKey(c);
  const tomorrow = today + DAY_MS;
  const todayRest = restName(today);
  const tomorrowRest = restName(tomorrow);

  // סוף רצף ימי מנוחה (למשל ראש השנה + שבת)
  const runEnd = (firstDay) => {
    let last = firstDay;
    while (restName(last + DAY_MS) && last - firstDay < 4 * DAY_MS) last += DAY_MS;
    return nightfall(last, p);
  };

  // כבר בתוך יום מנוחה (לפני צאתו), או אחרי כניסת יום מנוחה שמתחיל מחר
  if (todayRest && ms < nightfall(today, p)) {
    return { state: 'rest', name: todayRest, endsAt: runEnd(today) };
  }
  if (tomorrowRest && ms >= candleLighting(today, p)) {
    return { state: 'rest', name: tomorrowRest, endsAt: runEnd(tomorrow) };
  }
  if (todayRest && ms < nightfall(today, p) + RESUMING_WINDOW_MIN * 60000) {
    return { state: 'resuming', name: todayRest, endedAt: nightfall(today, p) };
  }
  if (tomorrowRest && c.hour >= EREV_WARN_FROM_HOUR) {
    return { state: 'erev', name: tomorrowRest, startsAt: candleLighting(today, p) };
  }
  return { state: 'normal' };
}

const fmtClock = (ms) =>
  new Date(Math.round(ms / 60000) * 60000).toLocaleTimeString(LOCALE, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** כותרת + הסבר להצגה בממשק, או null כשהשירות רגיל */
export function serviceNotice(status) {
  const name = status.name ? t(status.name) : '';
  const isShabbat = status.name === 'שבת';
  switch (status.state) {
    case 'rest':
      return {
        tone: 'rest',
        title: isShabbat ? t('שבת – אין תחבורה ציבורית') : t('{name} – אין תחבורה ציבורית', { name }),
        text: t('האוטובוסים והרכבות יחזרו בהדרגה אחרי {time}. מלבד קווים בודדים בכמה ערים, ומוניות שירות בחלק מהערים.', { time: fmtClock(status.endsAt) })
      };
    case 'erev':
      return {
        tone: 'erev',
        title: isShabbat ? t('ערב שבת – השירות מסתיים היום') : t('ערב {name} – השירות מסתיים היום', { name }),
        text: t('רוב הקווים מסיימים אחר הצהריים, והרכבת עוד קודם. כניסה ב-{time}. כדאי לבדוק את הנסיעה האחרונה.', { time: fmtClock(status.startsAt) })
      };
    case 'resuming':
      return {
        tone: 'resuming',
        title: t('השירות חוזר בהדרגה'),
        text: t('אחרי צאת {name} הקווים חוזרים לפעול בהדרגה. ייתכן שחלק מהיציאות עוד לא יופיעו.', { name })
      };
    default:
      return null;
  }
}
