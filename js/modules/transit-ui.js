// תבניות HTML לתחבורה ציבורית: רשימת מסלולים, פירוט מסלול (ציר זמן), וליווי נסיעה.

import { escapeHtml } from './ui.js';
import { lineColor, operatorColor } from './stops.js';
import { formatNavDistance } from './route-ui.js';
import { WHATSAPP_ICON } from './share.js';
import { t, tn, LOCALE } from './i18n.js';
import { serviceNoticeHtml } from './ui.js';

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
  search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5Zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z'
};

export function icon(name, size = 18) {
  const d = PATHS[name] ?? PATHS.bus;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
}

export function modeIcon(mode, size = 18) {
  return icon(mode === 'rail' ? 'rail' : mode === 'lightrail' ? 'lightrail' : mode === 'walk' ? 'walk' : 'bus', size);
}

export function lineBadge(leg, { small = false } = {}) {
  const label = leg.line === 'רכבת' ? t('רכבת') : leg.line || (MODE_NAMES[leg.mode] ? t(MODE_NAMES[leg.mode]) : '');
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

export function legChips(it, activeIndex = -1) {
  const parts = [];
  it.legs.forEach((leg, i) => {
    const active = i === activeIndex ? ' is-active' : '';
    if (leg.mode === 'walk') {
      if (leg.duration < 60 && i !== activeIndex) return;
      parts.push(`<span class="leg-walk${active}">${icon('walk', 15)}${Math.max(1, Math.round(leg.duration / 60))}</span>`);
    } else {
      parts.push(`<span class="leg-ride${active}">${lineBadge(leg, { small: true })}</span>`);
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

function itineraryCard(it, index, now) {
  const first = it.legs.find((l) => l.mode !== 'walk');
  const dep = first ? departureText(first, now) : null;
  const departLine = first
    ? `<div class="itin-depart">${lineBadge(first, { small: true })} ${liveBadge(dep)}<span class="itin-stop"> · ${escapeHtml(first.from.name)}</span></div>`
    : '';

  return `
    <button class="itin-card${it.recommended ? ' is-recommended' : ''}" type="button" data-action="transit-select" data-index="${index}">
      <div class="itin-top">
        <span class="itin-duration">${fmtMinutes(it.duration)}</span>
        <span class="itin-times">${fmtTime(it.start)} – ${fmtTime(it.end)}</span>
        ${it.recommended ? `<span class="chip chip-rec">${t('מומלץ')}</span>` : ''}
        ${it.fare ? `<span class="itin-price">${fmtPrice(it.fare.total)}</span>` : ''}
      </div>
      ${legChips(it)}
      ${departLine}
      <div class="itin-meta">${icon('walk', 14)} ${t('{dist} הליכה', { dist: formatNavDistance(it.walkMeters) })} · ${transfersText(it.transfers)}</div>
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

export function listHtml(result, { loadingMore = false, now = Date.now(), restricted = false, filter = 'all', notice = null } = {}) {
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

  parts.push(visible.map(({ it, index }) => itineraryCard(it, index, now)).join(''));

  if (result.nextCursor) {
    parts.push(`
      <button class="btn-secondary btn-later" type="button" data-action="transit-later" ${loadingMore ? 'disabled' : ''}>
        ${loadingMore ? t('טוען…') : t('מסלולים מאוחרים יותר')}
      </button>`);
  }

  parts.push(`<p class="attribution">${ATTRIBUTION()}</p>`);
  return `<div class="itin-list">${parts.join('')}</div>`;
}

export function detailHtml(it, { originName, destName, now = Date.now() }) {
  const rows = [];
  const first = it.legs[0];
  rows.push(point('origin', fmtTime(first.start), originName));

  it.legs.forEach((leg, i) => {
    const isLast = i === it.legs.length - 1;

    if (leg.mode === 'walk') {
      if (leg.duration < 30 && leg.distance < 40) return;
      const label = t(i === 0 ? 'הליכה לתחנה' : isLast ? 'הליכה ליעד' : 'הליכה להחלפה');
      rows.push(`
        <li class="tl-leg is-walk">
          <span class="tl-icon">${icon('walk', 16)}</span>
          <span>${label} · ${fmtMinutes(leg.duration)} · ${formatNavDistance(leg.distance)}</span>
        </li>`);
      return;
    }

    const color = legColor(leg);
    const dep = departureText(leg, now);
    const rideStops = (leg.stops?.length ?? 0) + 1;
    const rideTime = Math.round((Date.parse(leg.end) - Date.parse(leg.start)) / 60000);

    // ציר הזמן לפי לוח הזמנים (עקבי עם תחנות הביניים); זמן האמת מוצג בתג נפרד
    rows.push(point('board', fmtTime(leg.start), leg.from.name, leg.from.code ? t('תחנה {code}', { code: leg.from.code }) : t(MODE_NAMES[leg.mode] ?? ''), color));
    rows.push(`
      <li class="tl-leg is-ride" style="--c:${color}">
        <div class="tl-line">${lineBadge(leg)} <span class="tl-head">${leg.headsign ? t('לכיוון {dest}', { dest: escapeHtml(leg.headsign) }) : ''}</span></div>
        <div class="tl-sub">${[leg.agency, leg.trainNumber ? t('רכבת {n}', { n: leg.trainNumber }) : ''].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        <div class="tl-sub">${liveBadge(dep)}</div>
        <details class="tl-stops">
          <summary>${tn(rideStops, 'תחנה אחת', '{n} תחנות')} · ${t('{n} דק\' נסיעה', { n: Math.max(1, rideTime) })}</summary>
          <ol>
            ${(leg.stops ?? []).map((s) => `<li><span class="tl-stop-time">${fmtTime(s.departure ?? s.arrival)}</span>${escapeHtml(s.name)}</li>`).join('')}
          </ol>
        </details>
      </li>`);
    rows.push(point('alight', fmtTime(leg.end), leg.to.name, t('ירידה'), color));
  });

  rows.push(point('dest', fmtTime(it.end), destName));

  return `
    <button class="btn-secondary btn-back" type="button" data-action="transit-back">${icon('back', 16)} ${t('כל המסלולים')}</button>
    <div class="route-time">
      <span class="route-time-big">${fmtMinutes(it.duration)}</span>
      <span class="route-time-eta">${fmtTime(it.start)} – ${fmtTime(it.end)}</span>
    </div>
    ${legChips(it)}
    <div class="itin-meta" style="margin-top:6px">${icon('walk', 14)} ${t('{dist} הליכה', { dist: formatNavDistance(it.walkMeters) })} · ${transfersText(it.transfers)}${it.fare ? ` · ${t('<strong>{price}</strong> ברב-קו', { price: fmtPrice(it.fare.total) })}` : ''}</div>
    <button class="btn-go" type="button" data-action="transit-start">${icon('walk', 22)} ${t('יציאה')}</button>
    <ol class="timeline">${rows.join('')}</ol>
    ${fareHtml(it.fare)}
    <p class="attribution">${ATTRIBUTION()}</p>`;
}

function point(kind, time, name, sub = '', color = null) {
  return `
    <li class="tl-point is-${kind}"${color ? ` style="--c:${color}"` : ''}>
      <span class="tl-time">${escapeHtml(time)}</span>
      <span class="tl-dot">${kind === 'dest' ? icon('flag', 14) : ''}</span>
      <span class="tl-text"><span class="tl-name">${escapeHtml(name)}</span>${sub ? `<span class="tl-sub">${escapeHtml(sub)}</span>` : ''}</span>
    </li>`;
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

export function tripPanelHtml(state, it) {
  const transitCount = it.legs.filter((l) => l.mode !== 'walk').length;
  const doneTransit = it.legs.slice(0, state.legIndex).filter((l) => l.mode !== 'walk').length;
  return `
    <div class="nav-panel">
      <div class="nav-summary">
        <div class="nav-remaining">${t('הגעה ב-{time}', { time: fmtTime(state.arrival) })}</div>
        <div class="nav-sub">${t('עוד {time}', { time: fmtMinutes(state.remainingSeconds) })}${transitCount > 1 ? ` · ${t('נסיעה {i} מתוך {n}', { i: Math.min(transitCount, doneTransit + 1), n: transitCount })}` : ''}</div>
      </div>
      <button class="btn-share-trip" type="button" data-action="share-trip" aria-label="${t('שיתוף זמן ההגעה בוואטסאפ')}">${WHATSAPP_ICON}</button>
      <button class="btn-end" type="button" data-action="transit-end">${t('סיום')}</button>
    </div>
    ${legChips(it, state.legIndex)}`;
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
