// תבניות HTML לתחבורה ציבורית: רשימת מסלולים, פירוט מסלול (ציר זמן), וליווי נסיעה.

import { escapeHtml } from './ui.js?v=1.9.4-mvqskghg';
import { lineColor, operatorColor } from './stops.js?v=1.9.4-mvqskghg';
import { formatNavDistance } from './route-ui.js?v=1.9.4-mvqskghg';
import { WHATSAPP_ICON } from './share.js?v=1.9.4-mvqskghg';
import { t, tn, LOCALE } from './i18n.js?v=1.9.4-mvqskghg';
import { serviceNoticeHtml } from './ui.js?v=1.9.4-mvqskghg';
import { lineKeyOf, lineUsersHtml } from './community.js?v=1.9.4-mvqskghg';
import { isLineSaved } from './favorites.js?v=1.9.4-mvqskghg';

const TZ = 'Asia/Jerusalem';

// ---------- פורמטים ----------

export function fmtTime(iso) {
  if (!iso) return '';
  // עיגול לדקה הקרובה (ולא קיצוץ) – 19:04:50 מוצג 19:05
  const ms = Math.round(Date.parse(iso) / 60000) * 60000;
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString(LOCALE, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

export function minutesUntil(iso, now = Date.now()) {
  return Math.round((Date.parse(iso) - now) / 60000);
}

function fmtMinutes(seconds) {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return t('{n} דק\'', { n: m });
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? t('{h} ש\' {m} דק\'', { h, m: r }) : t('{h} ש\'', { h });
}

/** "1 שע' 3 דק'" – כמו בכרטיס המסלול של Moovit */
function fmtDurationLong(seconds) {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return t('{n} דק\'', { n: m });
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? t('{h} שע\' {m} דק\'', { h, m: r }) : t('{h} שע\'', { h });
}

function transfersText(n) {
  if (n === 0) return t('ללא החלפות');
  if (n === 1) return t('החלפה אחת');
  return t('{n} החלפות', { n });
}

export function fmtPrice(n) {
  if (!Number.isFinite(n)) return '';
  return `₪${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')}`;
}

/** פירוט מחיר ברב-קו במסך פרטי המסלול */
function fareHtml(fare) {
  if (!fare) {
    return `<section class="fare-box"><h3 class="section-title">${t('מחיר ברב-קו')}</h3><p class="fare-note">${t('לא ניתן לחשב מחיר למסלול הזה.')}</p></section>`;
  }
  const rows = fare.rides.map((r) => `
    <li class="fare-row">
      <span class="fare-ride">${escapeHtml(fareLabel(r.label))} <small>${t('{n} ק"מ', { n: r.km })} · ${t('רדיוס {band}', { band: escapeHtml(t(r.band)) })}</small></span>
      <span class="fare-price${r.price === 0 ? ' is-free' : ''}">${r.price === 0 ? t('חינם') : fmtPrice(r.price)}${r.note ? `<small>${escapeHtml(t(r.note))}</small>` : ''}</span>
    </li>`).join('');
  return `
    <section class="fare-box">
      <h3 class="section-title"><span>${t('מחיר ברב-קו')}</span><span class="fare-total">${fmtPrice(fare.total)}</span></h3>
      <ul class="fare-rows">${rows}</ul>
      ${fare.notes.map((n) => `<p class="fare-note">${escapeHtml(fareNote(n))}</p>`).join('')}
      <p class="fare-note">${escapeHtml(t(fare.profileNote))} ${t('תקרה יומית (חופשי יומי) לרדיוס הזה: {price}.', { price: fmtPrice(fare.dailyCap) })}</p>
      <p class="fare-note">${t('מקור:')} <a href="${escapeHtml(fare.source.url)}" target="_blank" rel="noopener">${t('מחירון משרד התחבורה')}</a> (${t('נבדק {date}', { date: escapeHtml(fare.source.checkedAt) })})</p>
    </section>`;
}

// טקסטים שמגיעים מהשרת (fares.js) בעברית
function fareLabel(label) {
  const line = /^קו (.+)$/.exec(label ?? '');
  return line ? t('קו {line}', { line: line[1] }) : t(label ?? '');
}

function fareNote(note) {
  const cap = /^החיוב נעצר בתקרה היומית \(חופשי יומי\) – ₪(.+)$/.exec(note ?? '');
  return cap ? t('החיוב נעצר בתקרה היומית (חופשי יומי) – ₪{n}', { n: cap[1] }) : t(note ?? '');
}

// ---------- צבעים ואייקונים ----------

const MODE_COLORS = { rail: '#1e3a8a', lightrail: '#dc2626', cable: '#7c3aed', ferry: '#0369a1' };
const MODE_NAMES = { bus: 'אוטובוס', rail: 'רכבת', lightrail: 'רכבת קלה', cable: 'רכבל', ferry: 'מעבורת', other: 'תחבורה ציבורית' };

export function legColor(leg) {
  // אוטובוס – צבע המפעיל; רכבת קלה וכו' – הצבע של הקו מה-GTFS (אדום / סגול / ירוק)
  if (leg.mode === 'bus') return operatorColor(leg.agency) ?? leg.color ?? lineColor(leg.line);
  return leg.color ?? MODE_COLORS[leg.mode] ?? lineColor(leg.line, leg.agency);
}

const PATHS = {
  bus: 'M4 16c0 .9.4 1.7 1 2.2V20c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1h8v1c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1.8c.6-.5 1-1.3 1-2.2V6c0-3.5-3.6-4-8-4S4 2.5 4 6v10Zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM18 11H6V6h12v5Z',
  rail: 'M12 2C8 2 4 2.5 4 6v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5v.5h2.2l2-2h3.6l2 2H18v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-3.6-4-8-4ZM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3.5-7H6V6h5v4Zm2 0V6h5v4h-5Zm3.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z',
  lightrail: 'M19 16.9V8a5 5 0 0 0-4.5-5l.8-1.5-1.3-.5L13 3h-2L9.9 1l-1.3.5.8 1.5A5 5 0 0 0 5 8v8.9A3 3 0 0 0 7 22h10a3 3 0 0 0 2-5.1ZM8 19.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm8 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM17 13H7V8h10v5Z',
  walk: 'M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5 0-.8.1L6 8.3V13h2V9.6l1.8-.7',
  flag: 'M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6Z',
  chevron: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z',
  back: 'M4 11h12.2l-5.6-5.6L12 4l8 8-8 8-1.4-1.4 5.6-5.6H4v-2Z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
  bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6v-5c0-3.1-1.6-5.6-4.5-6.3V4c0-.8-.7-1.5-1.5-1.5S10.5 3.2 10.5 4v.7C7.6 5.4 6 7.9 6 11v5l-2 2v1h16v-1l-2-2Z',
  search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5Zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z'
};

export function icon(name, size = 18) {
  const d = PATHS[name] ?? PATHS.bus;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
}

export function modeIcon(mode, size = 18) {
  return icon(mode === 'rail' ? 'rail' : mode === 'lightrail' ? 'lightrail' : mode === 'walk' ? 'walk' : 'bus', size);
}

function lineLabel(leg) {
  return leg.line === 'רכבת' ? t('רכבת') : leg.line || (MODE_NAMES[leg.mode] ? t(MODE_NAMES[leg.mode]) : '');
}

export function lineBadge(leg, { small = false, label: forced = null } = {}) {
  const label = forced ?? lineLabel(leg);
  return `<span class="line-pill${small ? ' is-small' : ''}" style="--c:${legColor(leg)}">${modeIcon(leg.mode, small ? 14 : 16)}<b>${escapeHtml(label)}</b></span>`;
}

// ---------- זמן אמת ----------

/** טקסט זמן אמת / לוח זמנים לרגל נסיעה */
export function departureText(leg, now = Date.now()) {
  const eta = leg.live?.eta ?? leg.start;
  const mins = minutesUntil(eta, now);
  const when = mins <= 0 ? t('עכשיו') : mins < 60 ? t('בעוד {n} דק\'', { n: mins }) : t('ב-{time}', { time: fmtTime(eta) });
  if (!leg.live) return { live: false, text: `${when} · ${t('לפי לוח זמנים')}`, short: when };

  const d = leg.live.delayMin;
  // הקדמה לא מוצגת כהערה – השעה עצמה כבר לפי זמן אמת
  const note = d >= 2 ? ` · ${t('איחור {n} דק\'', { n: d })}` : ` · ${t('בזמן')}`;
  return { live: true, text: `${when}${note}`, short: when };
}

function liveBadge(info) {
  return info.live
    ? `<span class="live-text"><span class="live-dot"></span>${escapeHtml(info.text)}</span>`
    : `<span class="sched-text">${escapeHtml(info.text)}</span>`;
}

// ---------- רצף רגליים (צ'יפים) ----------

const CHEVRON = `<span class="leg-sep">${icon('chevron', 14)}</span>`;

export function legChips(it, activeIndex = -1, variants = null) {
  const parts = [];
  let ride = 0;
  it.legs.forEach((leg, i) => {
    const active = i === activeIndex ? ' is-active' : '';
    if (leg.mode === 'walk') {
      if (leg.duration < 60 && i !== activeIndex) return;
      parts.push(`<span class="leg-walk${active}">${icon('walk', 15)}${Math.max(1, Math.round(leg.duration / 60))}</span>`);
    } else {
      parts.push(`<span class="leg-ride${active}">${lineBadge(leg, { small: true, label: variants?.[ride] || null })}</span>`);
      ride++;
    }
  });
  return `<div class="itin-legs">${parts.join(CHEVRON)}</div>`;
}

// ---------- מסכים ----------

export function loadingHtml() {
  return `
    <p class="eyebrow">${t('מחפש מסלולים…')}</p>
    <div class="skeleton" style="margin-top:10px">
      <div class="sk-row"></div><div class="sk-row"></div><div class="sk-row"></div>
    </div>`;
}

export function errorHtml(status) {
  const msg = status === 422
    ? t('נקודת המוצא והיעד קרובות מדי – עדיף ללכת.')
    : t('לא הצלחנו לחשב מסלולים בתחבורה ציבורית כרגע. בדקו את החיבור ונסו שוב.');
  return `
    <div class="state-box"><span>${msg}</span></div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn-secondary" type="button" data-action="transit-retry">${t('לנסות שוב')}</button>
      <button class="btn-secondary" type="button" data-action="dir-walk">${t('מסלול הליכה')}</button>
    </div>`;
}

function walkCard(walk) {
  return `
    <button class="itin-card is-walk" type="button" data-action="dir-walk">
      <div class="itin-top">
        <span class="itin-duration">${fmtMinutes(walk.seconds)}</span>
        <span class="itin-times">${t('הליכה בלבד')} · ${formatNavDistance(walk.distance)}</span>
      </div>
      <div class="itin-meta">${icon('walk', 15)} ${t('כולל המתנה ברמזורים')}${walk.signalized ? ` (${walk.signalized})` : ''}</div>
    </button>`;
}

// סדר המסלולים ברשימה לפי העדפת המשתמש; "הכי מומלץ" משאיר את הסדר והדירוג של השרת
const ROUTE_SORTS = {
  minWalk: (a, b) => Math.round(a.walkMeters / 100) - Math.round(b.walkMeters / 100) || a.duration - b.duration,
  minTransfers: (a, b) => a.transfers - b.transfers || a.duration - b.duration
};
const ROUTE_BADGES = { minWalk: 'הכי פחות הליכה', minTransfers: 'הכי פחות החלפות' };

/** המסלול שמוצג על המפה וכמומלץ: לפי סוג המסלול שנבחר */
export function pickPrimary(list, routeType = 'best') {
  const cmp = ROUTE_SORTS[routeType];
  if (!cmp) return list.find((it) => it.recommended) ?? list[0];
  return [...list].sort(cmp)[0];
}

const rideLegs = (it) => it.legs.filter((l) => l.mode !== 'walk');

// אותו מסלול (אותן תחנות עלייה וירידה בכל קטע נסיעה), גם אם הקו או השעה שונים
const rideSignature = (it) => rideLegs(it).map((l) => `${l.mode}|${l.from.code ?? l.from.name}|${l.to.code ?? l.to.name}`).join('>');

/** מקבצים מסלולים זהים לכרטיס אחד, כמו ב-Moovit: "5 / 2" וכמה שעות יציאה */
function groupItineraries(visible) {
  const groups = new Map();
  for (const v of visible) {
    const key = rideSignature(v.it);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  return [...groups.values()];
}

/** לכל קטע נסיעה: הקווים שמגיעים באותו מסלול ("5 / 2") */
function rideVariants(it, group) {
  return rideLegs(it).map((_, k) => {
    const labels = [];
    for (const m of group) {
      const leg = rideLegs(m)[k];
      const label = leg && lineLabel(leg);
      if (label && !labels.includes(label)) labels.push(label);
    }
    return labels.slice(0, 3).join(' / ');
  });
}

/** יציאות נוספות באותו מסלול בשעתיים הקרובות (בדקות) */
function nextDepartures(it, group, now) {
  const mins = group
    .filter((m) => m !== it)
    .map((m) => rideLegs(m)[0])
    .filter(Boolean)
    .map((l) => minutesUntil(l.live?.eta ?? l.start, now))
    .filter((n) => n >= 0 && n <= 120);
  return [...new Set(mins)].sort((a, b) => a - b).slice(0, 3);
}

function itineraryCard(it, index, now, badge, group = [it]) {
  const variants = rideVariants(it, group);
  const next = nextDepartures(it, group, now);
  // badge === undefined: ההמלצה של השרת. אחרת: התגית של המסלול הראשון בסדר שנבחר (או בלי תגית)
  const rec = badge === undefined ? it.recommended : !!badge;
  const label = badge ? t(badge) : t('מומלץ');
  const first = it.legs.find((l) => l.mode !== 'walk');
  const dep = first ? departureText(first, now) : null;
  // "יוצא ב-05:42 מהאלון/האשל": שעה מוחלטת, ובזמן אמת גם האיחור
  const lateNote = dep?.live && first.live.delayMin >= 2 ? ` · ${t('איחור {n} דק\'', { n: first.live.delayMin })}` : '';
  const departLine = first
    ? `<div class="itin-depart">${dep.live ? '<span class="live-dot"></span>' : ''}<span>${t('יוצא ב-{time} מ{stop}', { time: fmtTime(first.live?.eta ?? first.start), stop: escapeHtml(first.from.name) })}${lateNote}${next.length ? ` · ${t('הבאים:')} ${next.map(minsLabel).join(', ')}` : ''}</span></div>`
    : '';

  return `
    <button class="itin-card${rec ? ' is-recommended' : ''}" type="button" data-action="transit-select" data-index="${index}">
      <div class="itin-top">
        <span class="itin-duration">${fmtDurationLong(it.duration)}</span>
        <span class="itin-arrive">• ${t('הגעה ב-{time}', { time: fmtTime(it.end) })}</span>
        ${rec ? `<span class="chip chip-rec">${label}</span>` : ''}
        ${it.fare ? `<span class="itin-price">${fmtPrice(it.fare.total)}</span>` : ''}
      </div>
      ${legChips(it, -1, variants)}
      ${departLine}
    </button>`;
}

const ATTRIBUTION = () =>
  `${t('לוחות זמנים: משרד התחבורה (GTFS) · זמן אמת: SIRI · ניתוב:')} <a href="https://transitous.org" target="_blank" rel="noopener">Transitous</a>`;

const hasRail = (it) => it.legs.some((l) => l.mode === 'rail');
const busOnly = (it) => it.legs.every((l) => l.mode === 'walk' || l.mode === 'bus');

export const ITINERARY_FILTERS = {
  all: () => true,
  rail: hasRail,
  bus: busOnly
};

export function listHtml(result, { loadingMore = false, now = Date.now(), restricted = false, filter = 'all', notice = null, routeType = 'best' } = {}) {
  const all = result.itineraries ?? [];
  const parts = [];

  // שבת / חג / ערב שבת – הסבר למה אין (או יש מעט) מסלולים
  if (notice) parts.push(serviceNoticeHtml(notice));

  // מסננים "הכל / עם רכבת / אוטובוס בלבד" – רק כשיש באמת שני הסוגים
  const railCount = all.filter(hasRail).length;
  const busCount = all.filter(busOnly).length;
  if (railCount > 0 && busCount > 0) {
    const chip = (id, label, count, iconName) => `
      <button class="filter-chip${filter === id ? ' is-active' : ''}" type="button" data-action="transit-filter" data-filter="${id}">
        ${iconName ? icon(iconName, 15) : ''}${t(label)} (${count})
      </button>`;
    parts.push(`<div class="filter-chips">${chip('all', 'הכל', all.length)}${chip('rail', 'עם רכבת', railCount, 'rail')}${chip('bus', 'אוטובוס בלבד', busCount, 'bus')}</div>`);
  }

  // אינדקס מקורי נשמר, כדי שבחירה תפתח את המסלול הנכון
  const keep = ITINERARY_FILTERS[filter] ?? ITINERARY_FILTERS.all;
  const visible = all.map((it, index) => ({ it, index })).filter(({ it }) => keep(it));
  const sortFn = ROUTE_SORTS[routeType];
  if (sortFn) visible.sort((x, y) => sortFn(x.it, y.it));
  const its = visible.map((v) => v.it);

  if (its.length === 0) {
    const tips = [];
    if (result.walk) tips.push(t('אפשר להגיע ברגל – ראו את מסלול ההליכה למטה.'));
    if (restricted) tips.push(t('ההגדרות שלך מגבילות את החיפוש (אמצעי תחבורה / הליכה מקסימלית / נגישות).'));
    parts.push(`
      <div class="state-box state-box-col">
        <strong>${t('אין נסיעות בתחבורה ציבורית ליעד הזה בשעות הקרובות.')}</strong>
        <span>${notice?.tone === 'rest' ? escapeHtml(notice.title) : t('ייתכן שאין קו שמגיע לשם בשעה הזו, או שהיעד קרוב מדי לנסיעה.')}</span>
        ${tips.map((tip) => `<span>${tip}</span>`).join('')}
        ${restricted ? `<button class="btn-secondary" type="button" data-action="open-settings">${t('שינוי הגדרות')}</button>` : ''}
      </div>`);
  }

  // הליכה מוצגת כחלופה כשהיא תחרותית
  const fastest = its.reduce((m, it) => Math.min(m, it.duration), Infinity);
  if (result.walk && (its.length === 0 || result.walk.seconds <= fastest * 1.5 + 300)) {
    parts.push(walkCard(result.walk));
  }

  parts.push(groupItineraries(visible).map((g, i) => itineraryCard(g[0].it, g[0].index, now, sortFn ? (i === 0 ? ROUTE_BADGES[routeType] : null) : undefined, g.map((v) => v.it))).join(''));

  if (result.nextCursor) {
    parts.push(`
      <button class="btn-secondary btn-later" type="button" data-action="transit-later" ${loadingMore ? 'disabled' : ''}>
        ${loadingMore ? t('טוען…') : t('מסלולים מאוחרים יותר')}
      </button>`);
  }

  parts.push(`<p class="attribution">${ATTRIBUTION()}</p>`);
  return `<div class="itin-list">${parts.join('')}</div>`;
}

const minsLabel = (m) => (m <= 0 ? t('עכשיו') : t('{n} דק\'', { n: m }));
const sameStop = (a, b) => (a.code && b.code ? a.code === b.code : a.name === b.name);

/** קווים נוספים שמגיעים מאותה תחנה לאותה תחנת ירידה, והיציאות הבאות של אותו קו (מתוך המסלולים שכבר חושבו) */
function altLinesHtml(leg, itineraries, now) {
  const others = new Map();
  const nextSame = new Set();
  for (const it of itineraries) {
    for (const l of it.legs) {
      if (l.mode === 'walk' || l === leg || !sameStop(l.from, leg.from) || !sameStop(l.to, leg.to)) continue;
      if (l.line === leg.line && l.start === leg.start) continue;
      const mins = minutesUntil(l.live?.eta ?? l.start, now);
      if (mins < 0) continue;
      if (l.line === leg.line) {
        nextSame.add(mins);
        continue;
      }
      const key = `${l.mode}|${l.line}`;
      if (!others.has(key) || mins < others.get(key).mins) others.set(key, { leg: l, mins });
    }
  }
  const alts = [...others.values()].sort((a, b) => a.mins - b.mins).slice(0, 4);
  const next = [...nextSame].sort((a, b) => a - b).slice(0, 3);
  if (!alts.length && !next.length) return '';
  return `
        <div class="tl-alts">
          ${next.length ? `<div class="tl-sub">${t('הבאים בקו:')} ${next.map(minsLabel).join(' · ')}</div>` : ''}
          ${alts.length ? `<div class="tl-alt-row"><span class="tl-sub">${t('אפשר גם:')}</span>${alts.map((a) => `<span class="tl-alt">${lineBadge(a.leg, { small: true })}<span>${minsLabel(a.mins)}</span></span>`).join('')}</div>` : ''}
        </div>`;
}

/** "התראות לגבי הקו": שומר את הקו ב"הקווים שלי" */
function watchHtml(leg) {
  if (!leg.routeId) return '';
  const on = isLineSaved(leg.routeId);
  return `<button class="tl-watch${on ? ' is-on' : ''}" type="button" data-action="line-watch" aria-pressed="${on}"
          data-route="${escapeHtml(String(leg.routeId))}" data-line="${escapeHtml(leg.line ?? '')}" data-mode="${escapeHtml(leg.mode)}" data-agency="${escapeHtml(leg.agency ?? '')}" data-to="${escapeHtml(leg.headsign ?? '')}">
          ${icon('bell', 16)}${on ? t('עוקבים אחרי הקו') : t('התראות לגבי הקו')}
        </button>`;
}

/** כרטיס רגל במסלול (כמו ב-Moovit): כותרת אפורה "סוג · משך" וגוף לבן עם התחנה */
function legCard(kind, index, { title, side = '', color = null, body }) {
  return `
    <section class="leg-card is-${kind}" data-action="transit-leg" data-leg="${index}" role="button" tabindex="0"${color ? ` style="--c:${color}"` : ''}>
      <header class="leg-card-head"><span>${title}</span>${side ? `<span class="leg-card-side">${side}</span>` : ''}</header>
      <div class="leg-card-body">${body}</div>
    </section>`;
}

function stopRow(stop, mode, extra = '') {
  const id = stop.code ? t('מס\' תחנה {code}', { code: escapeHtml(String(stop.code)) }) : '';
  return `
    <div class="leg-stop">
      <span class="leg-stop-icon">${icon(mode === 'walk' ? 'flag' : mode, 18)}</span>
      <span class="leg-stop-text"><b>${escapeHtml(stop.name)}</b>${id ? `<small>${id}</small>` : ''}</span>
      ${extra}
    </div>`;
}

/** כרטיסי השלבים של מסלול: [{ leg, kind, html }] – משמש גם את פירוט המסלול וגם את קרוסלת השלבים בנסיעה */
function buildLegCards(it, { destName, itineraries = [], now = Date.now() }) {
  const cards = [];
  const last = it.legs.length - 1;
  const push = (leg, kind, html) => cards.push({ leg, kind, html });

  it.legs.forEach((leg, i) => {
    if (leg.mode === 'walk') {
      if (leg.duration < 30 && leg.distance < 40) return;
      const target = i === last ? { name: destName } : (it.legs[i + 1]?.from ?? { name: destName });
      push(i, 'walk', legCard('walk', i, {
        title: t('הליכה {time} אל', { time: fmtMinutes(leg.duration) }),
        side: formatNavDistance(leg.distance),
        body: stopRow(target, i === last ? 'walk' : 'bus')
      }));
      return;
    }

    const color = legColor(leg);
    const dep = departureText(leg, now);
    const rideStops = (leg.stops?.length ?? 0) + 1;
    const rideTime = Math.max(1, Math.round((Date.parse(leg.end) - Date.parse(leg.start)) / 60000));

    // המתנה לקו בתחנה (אחרי הליכה או החלפה)
    push(i, 'wait', legCard('wait', i, {
      title: t('המתנה ל'),
      side: fmtTime(leg.start),
      color,
      body: `
        <div class="leg-wait">
          ${lineBadge(leg)}
          <span class="leg-wait-head">${leg.headsign ? escapeHtml(leg.headsign) : ''}</span>
          <span class="leg-wait-live">${liveBadge(dep)}</span>
        </div>
        <div class="leg-sub">${escapeHtml(leg.from.name)}${leg.from.code ? ` · ${t('מס\' תחנה {code}', { code: escapeHtml(String(leg.from.code)) })}` : ''}</div>
        ${[leg.agency, leg.trainNumber ? t('רכבת {n}', { n: leg.trainNumber }) : ''].filter(Boolean).length ? `<div class="leg-sub">${[leg.agency, leg.trainNumber ? t('רכבת {n}', { n: leg.trainNumber }) : ''].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
        ${altLinesHtml(leg, itineraries, now)}`
    }));

    // הנסיעה עצמה
    push(i, 'ride', legCard('ride', i, {
      title: t('נסיעה של {stops} עד', { stops: tn(rideStops, 'תחנה אחת', '{n} תחנות') }),
      side: fmtMinutes(rideTime * 60),
      color,
      body: `
        ${stopRow(leg.to, leg.mode)}
        <details class="tl-stops">
          <summary>${t('תחנות בדרך')}</summary>
          <ol>
            <li><span class="tl-stop-time">${fmtTime(leg.start)}</span>${escapeHtml(leg.from.name)}</li>
            ${(leg.stops ?? []).map((s) => `<li><span class="tl-stop-time">${fmtTime(s.departure ?? s.arrival)}</span>${escapeHtml(s.name)}</li>`).join('')}
            <li><span class="tl-stop-time">${fmtTime(leg.end)}</span>${escapeHtml(leg.to.name)}</li>
          </ol>
        </details>
        ${watchHtml(leg)}`
    }));
  });

  push(null, 'arrive', `
    <section class="leg-card is-arrive">
      <header class="leg-card-head"><span>${t('הגעה ב-{time}', { time: fmtTime(it.end) })}</span></header>
      <div class="leg-card-body"><div class="leg-stop"><span class="leg-stop-icon is-dest">${icon('flag', 16)}</span><span class="leg-stop-text"><b>${escapeHtml(destName)}</b></span></div></div>
    </section>`);

  return cards;
}

export function detailHtml(it, { originName, destName, itineraries = [], now = Date.now() }) {
  const cards = buildLegCards(it, { destName, itineraries, now }).map((c) => c.html);

  return `
    <button class="btn-secondary btn-back" type="button" data-action="transit-back">${icon('back', 16)} ${t('כל המסלולים')}</button>
    <div class="route-time">
      <span class="route-time-big">${fmtMinutes(it.duration)}</span>
      <span class="route-time-eta">${fmtTime(it.start)} – ${fmtTime(it.end)}</span>
    </div>
    ${legChips(it)}
    <div class="itin-meta" style="margin-top:6px">${icon('walk', 14)} ${t('{dist} הליכה', { dist: formatNavDistance(it.walkMeters) })} · ${transfersText(it.transfers)}${it.fare ? ` · ${t('<strong>{price}</strong> ברב-קו', { price: fmtPrice(it.fare.total) })}` : ''}</div>
    <button class="btn-go" type="button" data-action="transit-start">${icon('walk', 22)} ${t('יציאה')}</button>
    <div class="leg-cards">${cards.join('')}</div>
    ${fareHtml(it.fare)}
    <p class="attribution">${ATTRIBUTION()}</p>`;
}

// ---------- ליווי נסיעה ----------

/** מחזיר { html, tone } לבאנר העליון */
export function tripBannerHtml(state, { destName, now = Date.now() }) {
  const { phase, leg, next } = state;

  if (phase === 'walking') {
    const toStop = next && next.mode !== 'walk';
    const instr = toStop
      ? `${escapeHtml(next.from.name)} · ${lineBadgeText(next)} ${escapeHtml(departureText(next, now).short)}`
      : escapeHtml(destName);
    return {
      tone: 'walk',
      html: `
        <div class="nav-icon">${icon('walk', 30)}</div>
        <div class="nav-text">
          <div class="nav-dist">${t(toStop ? '{dist} לתחנה' : '{dist} ליעד', { dist: formatNavDistance(state.distToLegEnd) })}</div>
          <div class="nav-instr">${instr}</div>
        </div>`
    };
  }

  if (phase === 'waiting') {
    const b = state.boardLeg ?? leg;
    const dep = departureText(b, now);
    const mins = minutesUntil(b.live?.eta ?? b.start, now);
    const title = mins <= 0 ? t('{line} מגיע עכשיו', { line: lineBadgeText(b) }) : t('{line} בעוד {n} דק\'', { line: lineBadgeText(b), n: mins });
    return {
      tone: dep.live ? 'live' : 'wait',
      html: `
        <div class="nav-icon">${modeIcon(b.mode, 30)}</div>
        <div class="nav-text">
          <div class="nav-dist">${escapeHtml(title)}</div>
          <div class="nav-instr">${b.headsign ? `${t('לכיוון {dest}', { dest: escapeHtml(b.headsign) })} · ` : ''}${escapeHtml(b.from.name)}${dep.live ? ` · <b>${t('בזמן אמת')}</b>` : ` · ${t('לפי לוח זמנים')}`}</div>
        </div>`
    };
  }

  // riding
  const alightNow = (state.stopsLeft ?? 0) <= 1;
  return {
    tone: alightNow ? 'alert' : 'ride',
    html: `
      <div class="nav-icon">${modeIcon(leg.mode, 30)}</div>
      <div class="nav-text">
        <div class="nav-dist">${alightNow ? t('רדו בתחנה הבאה!') : t('עוד {n} תחנות', { n: state.stopsLeft })}</div>
        <div class="nav-instr">${t('רדו ב{stop}', { stop: escapeHtml(leg.to.name) })}${!alightNow && state.nextStop ? ` · ${t('הבאה: {stop}', { stop: escapeHtml(state.nextStop.name) })}` : ''}</div>
      </div>`
  };
}

function lineBadgeText(leg) {
  if (leg.mode === 'rail') return t('הרכבת');
  return t('קו {line}', { line: leg.line });
}

// כמה משתמשי Walkie על הקו שנוסעים בו (נטען ע"י community-controller; מוצג בפאנל)
let tripUsers = null;
export function setTripUsers(n) {
  tripUsers = n;
}

/** באיזו תחנה אני עכשיו, מה הבאה, וכמה מהדרך עברנו (כמו במוביט / גוגל מפות) */
function tripHereHtml(state) {
  if (state.phase === 'waiting') {
    const b = state.boardLeg ?? state.leg;
    return `
      <div class="trip-here">
        <div class="trip-here-now"><span class="trip-here-dot"></span><span>${t('עכשיו בתחנה')} <b>${escapeHtml(b.from?.name ?? '')}</b></span></div>
      </div>`;
  }
  if (state.phase !== 'riding' || !state.currentStop) return '';
  const total = state.stopTotal ?? 0;
  const here = state.stopIndex ?? 0;
  const dots = Array.from({ length: Math.min(total + 1, 24) }, (_, i) => `<i class="${i < here ? 'is-done' : i === here ? 'is-now' : ''}"></i>`).join('');
  const next = state.nextStop && state.nextStop.name !== state.currentStop.name
    ? `<div class="trip-here-next">${t('הבאה: {stop}', { stop: escapeHtml(state.nextStop.name) })}</div>` : '';
  return `
    <div class="trip-here">
      <div class="trip-here-now"><span class="trip-here-dot"></span><span>${t('עכשיו ליד')} <b>${escapeHtml(state.currentStop.name)}</b></span></div>
      ${next}
      <div class="trip-here-prog" aria-hidden="true">${dots}</div>
    </div>`;
}

function tripToolsHtml(state) {
  const ride = [state.leg, state.next].find((l) => l && l.mode !== 'walk');
  if (!ride) return '';
  const key = lineKeyOf({ mode: ride.mode, line: ride.line, agency: ride.agency ?? '' });
  const label = ride.mode === 'rail' ? t('רכבת') : t('קו {line}', { line: ride.line });
  return `
    ${tripUsers ? lineUsersHtml(tripUsers) : ''}
    <div class="trip-tools">
      <button type="button" data-action="report-line" data-line-key="${escapeHtml(key)}" data-line="${escapeHtml(String(ride.line ?? ''))}" data-label="${escapeHtml(label)}">⚠️ ${t('דיווח על האוטובוס')}</button>
    </div>`;
}

export const TRIP_TABS = [
  ['cards', 'שלבים'],
  ['overview', 'סקירה'],
  ['stops', 'תחנות'],
  ['route', 'מסלול']
];

function tripTabsHtml(tab) {
  return `
    <div class="trip-tabs" role="tablist">
      ${TRIP_TABS.map(([id, label]) => `<button type="button" role="tab" class="trip-tab${id === tab ? ' is-active' : ''}" aria-selected="${id === tab}" data-action="trip-tab" data-tab-id="${id}">${t(label)}</button>`).join('')}
    </div>`;
}

/** תחנות הקו הנוכחי (או הבא בתור): עברנו / אתם כאן / בהמשך, עם שעות לפי לוח הזמנים */
function tripStopsHtml(state) {
  const leg = state.phase === 'riding' ? state.leg
    : state.phase === 'waiting' ? (state.boardLeg ?? state.leg)
    : [state.leg, state.next].find((l) => l && l.mode !== 'walk');
  if (!leg || leg.mode === 'walk') return `<p class="trip-empty">${t('אין תחנות להצגה')}</p>`;

  const riding = state.phase === 'riding' && leg === state.leg;
  const here = riding ? state.stopIndex ?? 0 : -1;
  const items = [
    { name: leg.from.name, time: leg.start, tag: t('עלייה') },
    ...(leg.stops ?? []).map((s) => ({ name: s.name, time: s.departure ?? s.arrival })),
    { name: leg.to.name, time: leg.end, tag: t('ירידה') }
  ];
  const lastIdx = items.length - 1;
  const rows = items.map((s, i) => {
    const cls = i < here ? 'is-done' : i === here ? 'is-now' : i === state.stopIndex + 1 && riding ? 'is-next' : '';
    const tag = i === here ? t('אתם כאן') : i === lastIdx ? (riding ? t('רדו כאן') : s.tag) : i === 0 ? s.tag : '';
    return `
      <li class="trip-stop ${cls}${i === lastIdx ? ' is-last' : ''}">
        <span class="trip-stop-time">${escapeHtml(fmtTime(s.time))}</span>
        <span class="trip-stop-dot"></span>
        <span class="trip-stop-name">${escapeHtml(s.name)}${tag ? `<small>${escapeHtml(tag)}</small>` : ''}</span>
      </li>`;
  }).join('');
  return `
    <div class="trip-stops-head" style="--c:${legColor(leg)}">${lineBadge(leg)}<span>${leg.headsign ? t('לכיוון {dest}', { dest: escapeHtml(leg.headsign) }) : ''}</span></div>
    <ol class="trip-stops" style="--c:${legColor(leg)}">${rows}</ol>`;
}

/** כל שלבי המסלול: הליכה / נסיעה, עם סימון מה כבר בוצע ומה עכשיו */
function tripRouteHtml(state, it) {
  const rows = it.legs.map((leg, i) => {
    const cls = i < state.legIndex ? 'is-done' : i === state.legIndex ? 'is-now' : '';
    if (leg.mode === 'walk') {
      const label = t(i === 0 ? 'הליכה לתחנה' : i === it.legs.length - 1 ? 'הליכה ליעד' : 'הליכה להחלפה');
      return `
        <li class="trip-step is-walk ${cls}">
          <span class="trip-step-icon">${icon('walk', 16)}</span>
          <span class="trip-step-text"><b>${label}</b><small>${fmtMinutes(leg.duration)} · ${formatNavDistance(leg.distance)}</small></span>
        </li>`;
    }
    const stops = (leg.stops?.length ?? 0) + 1;
    return `
      <li class="trip-step ${cls}" style="--c:${legColor(leg)}">
        <span class="trip-step-icon">${modeIcon(leg.mode, 16)}</span>
        <span class="trip-step-text">
          <b>${lineBadge(leg, { small: true })} ${escapeHtml(leg.from.name)}</b>
          <small>${fmtTime(leg.start)} · ${tn(stops, 'תחנה אחת', '{n} תחנות')} · ${t('רדו ב{stop}', { stop: escapeHtml(leg.to.name) })}</small>
        </span>
      </li>`;
  }).join('');
  return `<ol class="trip-steps">${rows}</ol>`;
}

/** כרטיסי השלבים בנסיעה (כמו ב-Moovit): הליכה / המתנה / נסיעה / הגעה */
export function tripCardSteps(it, destName, now = Date.now()) {
  return buildLegCards(it, { destName, now });
}

/** איזה כרטיס מתאים עכשיו למצב הנסיעה */
export function currentCardStep(steps, state) {
  const kind = state.phase === 'walking' ? 'walk' : state.phase === 'waiting' ? 'wait' : 'ride';
  const exact = steps.findIndex((c) => c.leg === state.legIndex && c.kind === kind);
  if (exact >= 0) return exact;
  const after = steps.findIndex((c) => c.leg === null || c.leg >= state.legIndex);
  return after >= 0 ? after : steps.length - 1;
}

function tripCardsHtml(steps, index) {
  const dots = steps.map((c, i) => `<button type="button" class="trip-dot${i === index ? ' is-active' : ''}" data-action="trip-card" data-step="${i}" aria-label="${t('שלב {n}', { n: i + 1 })}"></button>`).join('');
  return `
    <div class="trip-cards">
      <div class="trip-cards-nav">
        <button type="button" class="trip-cards-arrow" data-action="trip-card" data-dir="-1" aria-label="${t('השלב הקודם')}">›</button>
        <div class="trip-dots">${dots}</div>
        <button type="button" class="trip-cards-arrow" data-action="trip-card" data-dir="1" aria-label="${t('השלב הבא')}">‹</button>
      </div>
      <div class="trip-cards-strip">${steps.map((c) => `<div class="trip-card-slide">${c.html}</div>`).join('')}</div>
    </div>`;
}

export function tripPanelHtml(state, it, tab = 'cards', { steps = [], cardIndex = 0 } = {}) {
  const transitCount = it.legs.filter((l) => l.mode !== 'walk').length;
  const doneTransit = it.legs.slice(0, state.legIndex).filter((l) => l.mode !== 'walk').length;
  return `
    <div class="nav-panel">
      <div class="nav-summary">
        <div class="nav-remaining">${t('הגעה ב-{time}', { time: fmtTime(state.arrival) })}</div>
        <div class="nav-sub">${t('עוד {time}', { time: fmtMinutes(state.remainingSeconds) })}${transitCount > 1 ? ` · ${t('נסיעה {i} מתוך {n}', { i: Math.min(transitCount, doneTransit + 1), n: transitCount })}` : ''}</div>
      </div>
      <button class="btn-share-trip" type="button" data-action="share-trip" aria-label="${t('שיתוף הנסיעה')}">${WHATSAPP_ICON}</button>
      <button class="btn-end" type="button" data-action="transit-end">${t('סיום')}</button>
    </div>
    ${tripTabsHtml(tab)}
    <div class="trip-tab-body" role="tabpanel">
      ${tab === 'cards' ? tripCardsHtml(steps, cardIndex)
        : tab === 'stops' ? tripStopsHtml(state)
        : tab === 'route' ? tripRouteHtml(state, it)
        : `${tripHereHtml(state)}${tripToolsHtml(state)}${legChips(it, state.legIndex)}`}
    </div>`;
}

export function tripArrivedHtml(destName) {
  return `
    <div class="arrived">
      <div class="arrived-emoji">🎉</div>
      <h2 class="arrived-title">${t('הגעת ליעד')}</h2>
      <p class="arrived-sub">${escapeHtml(destName)}</p>
      <button class="btn-go" type="button" data-action="transit-end">${t('סיום')}</button>
    </div>`;
}
