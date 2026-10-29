// לשונית "קווים": קווים באזור, חיפוש קו (מספר או יעד), ופרטי קו עם כל התחנות והמסלול על המפה.

import { fetchLinesNearby, fetchLinesSearch, fetchLineDetails } from './api.js?v=1.10.0-mvu2khrx';
import { escapeHtml } from './ui.js?v=1.10.0-mvu2khrx';
import { formatDistance, distanceMeters, walkMinutes } from './geo.js?v=1.10.0-mvu2khrx';
import { fmtTime, minutesUntil, lineBadge, legColor, icon } from './transit-ui.js?v=1.10.0-mvu2khrx';
import { toggleLine, isLineSaved, getFavorites } from './favorites.js?v=1.10.0-mvu2khrx';
import { onLineWatched } from './push.js?v=1.10.0-mvu2khrx';
import { starButton } from './favorites-ui.js?v=1.10.0-mvu2khrx';
import { showToast } from './ui.js?v=1.10.0-mvu2khrx';
import { getSettings } from './settings.js?v=1.10.0-mvu2khrx';
import { t, LANG } from './i18n.js?v=1.10.0-mvu2khrx';
import { lineKeyOf, fetchLineUsers, setPresence, lineUsersHtml, setBusCandidate, fetchBusFixes } from './community.js?v=1.10.0-mvu2khrx';
import { fuseBusFixes } from './bus-inference.js?v=1.10.0-mvu2khrx';
import { openReportSheet } from './community-ui.js?v=1.10.0-mvu2khrx';
import { track, trackName, trackFeature, trackFailedSearch } from './analytics.js?v=1.10.0-mvu2khrx';

const SEARCH_DEBOUNCE_MS = 400;
const CROWD_REFRESH_MS = 10000;    // מיקומי נוסעים על האוטובוס (מדויקים מ-SIRI, מתעדכנים כל כמה שניות)
const DETAIL_REFRESH_MS = 30000;   // פרטי קו פתוחים: זמן אמת + מיקומי האוטובוסים

const MODE_NAMES = { bus: 'אוטובוס', rail: 'רכבת', lightrail: 'רכבת קלה' };
const modeName = (mode) => (MODE_NAMES[mode] ? t(MODE_NAMES[mode]) : '');

/** "זמן אמת · מאחר 3 דק'" לפי העיכוב שהשרת מצא ב-SIRI (הקדמה לא מוצגת – הזמנים כבר מתוקנים) */
function tripLiveChip(live) {
  if (!live) return '';
  const m = live.delayMin;
  const note = m >= 2 ? ` · ${t('מאחר {n} דק\'', { n: m })}` : '';
  return `<span class="chip chip-live"><span class="live-dot"></span>${t('זמן אמת')}${note}</span>`;
}

/** "בעוד 7 דק'" ליד שעת ההגעה לתחנה (רק לתחנות שהאוטובוס עוד לא הגיע אליהן) */
function stopCountdown(time, passed) {
  if (!time || passed) return '';
  const m = minutesUntil(time);
  if (m < 0) return '';
  const text = m === 0 ? t('עכשיו') : m < 60 ? t('בעוד {n} דק\'', { n: m }) : t('בעוד {h}:{mm} ש\'', { h: Math.floor(m / 60), mm: String(m % 60).padStart(2, '0') });
  return `<span class="lstop-in">${text}</span>`;
}

function endName(end) {
  if (!end) return '';
  return end.city && !end.name.includes(end.city) ? `${end.name}, ${end.city}` : end.name;
}

function etaText(eta, live) {
  const m = minutesUntil(eta);
  const when = m <= 0 ? t('עכשיו') : m < 60 ? t('בעוד {n} דק\'', { n: m }) : fmtTime(eta);
  return live
    ? `<span class="live-text"><span class="live-dot"></span>${when}</span>`
    : `<span class="sched-text">${when}</span>`;
}

export class LinesView {
  constructor({ sheet, layer, vehicles = null, map, getNear, getOcclusion, onNavigateTo }) {
    this.sheet = sheet;
    this.layer = layer;
    this.vehicles = vehicles;   // אוטובוסים של הקו בזמן אמת
    this.map = map;
    this.getNear = getNear;
    this.getOcclusion = getOcclusion;
    this.onNavigateTo = onNavigateTo;

    this.active = false;
    this.mode = 'list';      // list | detail
    this.query = '';
    this.nearby = null;
    this.results = null;
    this.detail = null;
    this.controller = null;
    this.timer = null;
    this.refreshTimer = null;
    this.users = null;       // כמה משתמשי Walkie על הקו שנפתח
  }

  activate({ reset = false } = {}) {
    this.active = true;
    if (reset || this.mode === 'list') {
      this.#showList();
    } else {
      this.#renderDetail();
      this.#drawLine();
      this.#startRefresh();
    }
  }

  deactivate() {
    this.active = false;
    this.controller?.abort();
    clearTimeout(this.timer);
    this.#stopRefresh();
    this.layer.clear();
    this.vehicles?.clear();
    setPresence('view', null);
    setBusCandidate('view', null);
    this.crowd = [];
  }

  handleAction(action, data) {
    switch (action) {
      case 'line-open':
        this.open(data.lineRef);
        return true;
      case 'line-back':
        this.#showList();
        return true;
      case 'line-report': {
        const d = this.detail;
        if (d) openReportSheet({ lineKey: this.#lineKey(d), line: d.line, lineLabel: `${d.mode === 'rail' ? t('רכבת') : t('קו {line}', { line: d.line })} ${t('לכיוון {dest}', { dest: endName(d.to) })}` });
        return true;
      }
      case 'line-direction':
        this.open(data.lineRef);
        return true;
      case 'line-stop':
        this.#focusStop(Number(data.index));
        return true;
      case 'line-walk': {
        const s = this.detail?.stops?.[Number(data.index)];
        if (s) this.onNavigateTo({ id: `stop:${s.code ?? s.name}`, kind: 'stop', name: s.name, lat: s.lat, lng: s.lng });
        return true;
      }
      case 'line-fav':
        if (this.detail) {
          const on = toggleLine(this.detail);
          if (on === null) return true;
          if (on) onLineWatched().then(showToast);
          else showToast(t('הקו הוסר מהמועדפים'));
          this.#renderDetail();
        }
        return true;
      case 'lines-retry':
        this.#loadNearby(true);
        return true;
      default:
        return false;
    }
  }

  // ---------- רשימה + חיפוש ----------

  #lineKey(d) {
    return lineKeyOf({ mode: d.mode, line: d.line, agency: d.agency ?? '' });
  }

  /** נוכחות על הקו (כדי שאחרים יראו שיש כאן משתמש) + כמה משתמשי Walkie על הקו עכשיו */
  async #refreshUsers(d = this.detail) {
    if (!d) return;
    const key = this.#lineKey(d);
    setPresence('view', { lineKey: key, line: d.line });
    if (d.mode === 'bus') setBusCandidate('view', { lineKey: key, line: d.line, path: d.geometry });
    this.#refreshCrowd(d);
    const n = await fetchLineUsers(key);
    if (this.detail && this.#lineKey(this.detail) === key && n != null) {
      this.users = n;
      const el = document.querySelector('[data-line-users]');
      if (el) {
        el.classList.remove('is-empty');
        el.replaceWith(Object.assign(document.createElement('div'), { innerHTML: lineUsersHtml(n) }).firstElementChild);
      }
    }
  }

  /** נוסעים של Walkie שנמצאים עכשיו על האוטובוס בקו הזה – לדיוק מיקום האוטובוס על המפה */
  async #refreshCrowd(d = this.detail) {
    if (!d || d.mode !== 'bus') return;
    const key = this.#lineKey(d);
    const fixes = await fetchBusFixes(key);
    if (!this.detail || this.#lineKey(this.detail) !== key) return;
    if (!fixes.length && !this.crowd?.length) return;
    this.crowd = fixes;
    this.#drawVehicles();
  }

  #showList() {
    this.mode = 'list';
    this.detail = null;
    this.users = null;
    setPresence('view', null);
    setBusCandidate('view', null);
    this.crowd = [];
    this.#stopRefresh();
    this.layer.clear();
    this.vehicles?.clear();
    this.sheet.renderCustom(
      `
      <div class="tab-head">
        <h2 class="tab-title">${t('קווים')}</h2>
        <div class="tab-search">
          ${icon('bus', 18)}
          <input id="lines-input" class="tab-search-input" type="search" inputmode="search" autocomplete="off"
                 placeholder="${t('מספר קו או יעד (למשל 26, רכבת נהריה)')}" value="${escapeHtml(this.query)}">
        </div>
      </div>
      <div id="lines-body"></div>`,
      'lines-list'
    );
    this.sheet.setSnap('full');

    const input = this.sheet.content.querySelector('#lines-input');
    input.addEventListener('input', () => {
      this.query = input.value.trim();
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.#search(), SEARCH_DEBOUNCE_MS);
    });

    if (this.query) this.#search();
    else this.#loadNearby();
  }

  #body(html) {
    const body = this.sheet.content.querySelector('#lines-body');
    if (body) body.innerHTML = html;
  }

  async #loadNearby(force = false) {
    if (this.nearby && !force && Date.now() - this.nearby.at < 60000) {
      this.#renderNearby();
      return;
    }
    this.#body(this.#skeleton());
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    try {
      const data = await fetchLinesNearby(this.getNear(), controller.signal);
      this.nearby = { at: Date.now(), results: data.results ?? [] };
      if (this.active && this.mode === 'list' && !this.query) this.#renderNearby();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      this.#body(`<div class="state-box"><span>${t('לא הצלחנו לטעון קווים באזור.')}</span></div>
        <button class="btn-secondary" type="button" data-action="lines-retry" style="margin-top:10px">${t('לנסות שוב')}</button>`);
    }
  }

  #myLines() {
    const saved = getFavorites().lines;
    if (!saved.length) return '';
    return `
      <h3 class="section-title">${t('הקווים שלי')}</h3>
      <ul class="line-list">
        ${saved.map((l) => `
          <li>
            <button class="line-row" type="button" data-action="line-open" data-line-ref="${escapeHtml(l.lineRef)}">
              ${lineBadge(l)}
              <span class="line-row-text">
                <span class="line-row-title">${l.to ? t('לכיוון {dest}', { dest: escapeHtml(l.to) }) : ''}</span>
                <span class="line-row-sub">${escapeHtml(l.agency ?? '')}</span>
              </span>
              <span class="line-row-eta">⭐</span>
            </button>
          </li>`).join('')}
      </ul>`;
  }

  #renderNearby() {
    const list = this.nearby?.results ?? [];
    if (list.length === 0) {
      this.#body(`${this.#myLines()}<div class="empty">${t('אין יציאות קרובות מהתחנות שלידך.')}</div>`);
      return;
    }
    this.#body(`
      ${this.#myLines()}
      <h3 class="section-title">${t('יוצאים בקרוב מהתחנות שלידך')}</h3>
      <ul class="line-list">
        ${list.map((l) => `
          <li>
            <button class="line-row" type="button" data-action="line-open" data-line-ref="${escapeHtml(l.lineRef)}">
              ${lineBadge(l)}
              <span class="line-row-text">
                <span class="line-row-title">${l.headsign ? t('לכיוון {dest}', { dest: escapeHtml(l.headsign) }) : escapeHtml(modeName(l.mode))}</span>
                <span class="line-row-sub">${escapeHtml(l.station.name)} · ${formatDistance(l.station.distance)}${l.agency ? ` · ${escapeHtml(l.agency)}` : ''}</span>
              </span>
              <span class="line-row-eta">${etaText(l.next.eta, !!l.next.live)}</span>
            </button>
          </li>`).join('')}
      </ul>`);
  }

  async #search() {
    if (!this.query) {
      this.results = null;
      this.#loadNearby();
      return;
    }
    if (this.query.length < 1) return;
    this.#body(this.#skeleton());
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    try {
      const data = await fetchLinesSearch(this.query, this.getNear(), controller.signal);
      this.results = data.results ?? [];
      if (!this.active || this.mode !== 'list') return;
      if (this.results.length === 0) {
        trackFailedSearch(this.query, 'line');
        this.#body(`<div class="empty">${t('לא נמצא קו "{q}" היום.', { q: escapeHtml(this.query) })}<br>${t('נסו מספר קו (26) או יעד (רכבת חיפה).')}</div>`);
        return;
      }
      this.#body(`
        <h3 class="section-title">${t('{n} קווים · הקרובים אליך קודם', { n: this.results.length })}</h3>
        <ul class="line-list">
          ${this.results.map((g) => this.#groupRow(g)).join('')}
        </ul>`);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      this.#body(`<div class="state-box"><span>${t('החיפוש לא זמין כרגע. נסו שוב בעוד רגע.')}</span></div>`);
    }
  }

  #groupRow(g) {
    const d = g.directions[0];
    const between = g.directions.length > 1
      ? `${escapeHtml(endName(d.from))} ⇄ ${escapeHtml(endName(d.to))}`
      : `${escapeHtml(endName(d.from))} ${LANG !== 'he' ? '→' : '←'} ${escapeHtml(endName(d.to))}`;
    const dirs = g.directions.map((x) => `
      <button class="dir-chip" type="button" data-action="line-open" data-line-ref="${escapeHtml(x.lineRef)}">
        ${t('לכיוון {dest}', { dest: escapeHtml(x.to?.name ?? '') })}${x.alternative ? ` (${escapeHtml(x.alternative)})` : ''}
      </button>`).join('');
    return `
      <li class="line-group">
        <div class="line-row is-static">
          ${lineBadge(g)}
          <span class="line-row-text">
            <span class="line-row-title">${between}</span>
            <span class="line-row-sub">${escapeHtml(g.agency ?? '')}${g.distance !== null ? ` · ${t('{dist} ממך', { dist: formatDistance(g.distance) })}` : ''}</span>
          </span>
        </div>
        <div class="dir-chips">${dirs}</div>
      </li>`;
  }

  #skeleton() {
    return '<div class="skeleton" style="margin-top:8px"><div class="sk-row"></div><div class="sk-row"></div><div class="sk-row"></div></div>';
  }

  // ---------- פרטי קו ----------

  async open(lineRef) {
    this.mode = 'detail';
    this.detail = null;
    this.#stopRefresh();
    this.vehicles?.clear();
    this.sheet.renderCustom(`
      <button class="btn-secondary btn-back" type="button" data-action="line-back">${icon('back', 16)} ${t('קווים')}</button>
      <div class="skeleton" style="margin-top:12px"><div class="sk-title"></div><div class="sk-card"></div><div class="sk-row"></div><div class="sk-row"></div></div>`,
      `line-loading:${lineRef}`);
    this.sheet.setSnap('half');

    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    try {
      const d = await fetchLineDetails(lineRef, this.getNear(), controller.signal);
      if (controller.signal.aborted || !this.active) return;
      this.detail = d;
      this.users = null;
      this.crowd = [];
      this.#renderDetail();
      this.#drawLine();
      this.#startRefresh();
      trackFeature('line_detail');
      track(`lines.${this.#lineKey(d)}`);
      trackName(this.#lineKey(d), `${d.mode === 'rail' ? t('רכבת') : d.line} · ${d.agency ?? ''}`);
      this.#refreshUsers(d);
      window.dispatchEvent(new CustomEvent('walkie:line-open', { detail: { lineKey: this.#lineKey(d) } }));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      this.sheet.renderCustom(`
        <button class="btn-secondary btn-back" type="button" data-action="line-back">${icon('back', 16)} ${t('קווים')}</button>
        <div class="state-box" style="margin-top:12px"><span>${t('לא הצלחנו לטעון את פרטי הקו. נסו שוב.')}</span></div>`,
        `line-error:${lineRef}`);
    }
  }

  #renderDetail() {
    const d = this.detail;
    if (!d) return;
    const near = this.getNear();

    // התחנה של הקו הכי קרובה למשתמש
    let nearestIdx = -1;
    let nearestDist = Infinity;
    d.stops.forEach((s, i) => {
      if (!Number.isFinite(s.lat) || i === d.stops.length - 1) return;
      const dist = distanceMeters(near, s);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    });

    const deps = d.departures.slice(0, 6).map((x) => `
      <span class="dep-chip${x.live ? ' is-live' : ''}">${fmtTime(x.eta)}${x.trainNumber ? `<small>#${escapeHtml(x.trainNumber)}</small>` : ''}</span>`).join('');

    const nearestBox = nearestIdx >= 0 && nearestDist < 3000
      ? `
        <div class="nearest-stop">
          <div>
            <div class="nearest-label">${t('התחנה הקרובה אליך בקו')}</div>
            <div class="nearest-name">${escapeHtml(d.stops[nearestIdx].name)} · ${formatDistance(nearestDist)} (${t('{n} דק\'', { n: walkMinutes(nearestDist) })})</div>
          </div>
          <button class="btn" type="button" data-action="line-walk" data-index="${nearestIdx}">${t('מסלול')}</button>
        </div>`
      : '';

    const other = d.otherDirections.map((o) => `
      <button class="dir-chip" type="button" data-action="line-direction" data-line-ref="${escapeHtml(o.lineRef)}">
        ${icon('back', 14)} ${t('לכיוון {dest}', { dest: escapeHtml(o.to?.name ?? '') })}${o.alternative ? ` (${escapeHtml(o.alternative)})` : ''}
      </button>`).join('');

    // האוטובוס נמצא בין התחנה האחרונה שעבר לבאה אחריה
    const busAt = d.tripLive?.vehicle ? (d.tripLive.passedIndex ?? -1) + 1 : -1;
    const stops = d.stops.map((s, i) => `
      <li class="lstop${i === nearestIdx ? ' is-nearest' : ''}${i === 0 ? ' is-first' : ''}${i === d.stops.length - 1 ? ' is-last' : ''}${s.passed ? ' is-passed' : ''}${i === busAt ? ' is-bus-next' : ''}" style="--c:${legColor(d)}">
        <button type="button" class="lstop-btn" data-action="line-stop" data-index="${i}">
          <span class="lstop-dot"></span>
          <span class="lstop-name">${escapeHtml(s.name)}</span>
          <span class="lstop-when">
            <span class="lstop-time${d.tripLive && !s.passed ? ' is-live' : ''}">${s.time ? fmtTime(s.time) : ''}</span>
            ${stopCountdown(s.time, s.passed)}
          </span>
        </button>
      </li>`).join('');

    this.sheet.renderCustom(`
      <button class="btn-secondary btn-back" type="button" data-action="line-back">${icon('back', 16)} ${t('קווים')}</button>
      <div class="line-head">
        ${lineBadge(d)}
        <div class="line-head-text">
          <h2 class="stop-title">${t('לכיוון {dest}', { dest: escapeHtml(endName(d.to)) })}</h2>
          <div class="line-row-sub">${t('מ{from}', { from: escapeHtml(endName(d.from)) })}${d.agency ? ` · ${escapeHtml(d.agency)}` : ''}</div>
        </div>
      </div>
      <div class="stop-actions">${starButton({ on: isLineSaved(d.lineRef), action: 'line-fav', label: t('שמירת הקו') })}</div>
      ${lineUsersHtml(this.users)}
      <div class="line-actions">
        <button class="btn-secondary" type="button" data-action="line-report">⚠️ ${t('דיווח על הקו')}</button>
        ${d.mode === 'bus' && getSettings().showBuses ? `<span class="gps-legend"><span class="ok"><i></i>${t('GPS מאומת')}</span><span class="partial"><i></i>${t('חלקי')}</span></span>` : ''}
      </div>
      ${other ? `<div class="dir-chips">${other}</div>` : ''}
      ${nearestBox}
      <h3 class="section-title">${t('יציאות הבאות מתחנת המוצא')}</h3>
      ${deps ? `<div class="dep-chips">${deps}</div>` : `<div class="state-box"><span>${t('אין יציאות בשעות הקרובות.')}</span></div>`}
      ${d.stops.length ? `
        <h3 class="section-title"><span>${t('{n} תחנות', { n: d.stops.length })}${d.tripStart ? ` · ${t('הנסיעה של {time}', { time: fmtTime(d.tripStart) })}` : ''}</span>${tripLiveChip(d.tripLive)}</h3>
        <ol class="lstops">${stops}</ol>` : ''}
      <p class="attribution">${t('לוחות זמנים: משרד התחבורה (GTFS)')}</p>`,
      `line:${d.lineRef}`);
  }

  #drawLine() {
    const d = this.detail;
    if (!d?.stops?.length) {
      this.layer.clear();
      return;
    }
    const first = d.stops[0];
    const last = d.stops[d.stops.length - 1];
    this.layer.show(
      {
        legs: [{
          mode: d.mode,
          line: d.line,
          color: null,
          geometry: d.geometry,
          from: first,
          to: last,
          stops: d.stops.slice(1, -1)
        }]
      },
      (leg) => legColor(leg)
    );
    requestAnimationFrame(() => this.layer.fit(this.getOcclusion()));
    this.#drawVehicles();
  }

  /**
   * האוטובוסים של הקו על המפה: הנסיעה שמוצגת ברשימת התחנות (מודגשת),
   * ועוד אוטובוסים של הקו שבדרך לתחנת המוצא / לתחנה הקרובה (מתוך היציאות הבאות).
   */
  #drawVehicles() {
    const d = this.detail;
    if (!this.vehicles) return;
    if (!d || d.mode !== 'bus' || !getSettings().showBuses) {
      this.vehicles.clear();
      return;
    }
    const color = legColor(d);
    const list = [];
    const seen = new Set();
    const add = (v, extra) => {
      if (!v || !Number.isFinite(v.lat)) return;
      const key = `${v.lat.toFixed(5)},${v.lng.toFixed(5)}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ id: key, lat: v.lat, lng: v.lng, line: d.line, mode: d.mode, color, destination: endName(d.to), ...extra });
    };
    // תנועה לאורך מסלול הקו, במהירות הממוצעת בין כל שתי תחנות (לפי לוח הזמנים).
    // אוטובוס שעומד בתחנת המוצא לא זז לפני שעת היציאה שלו
    const along = (holdIso) => ({ path: d.geometry, stops: d.stops, holdUntil: holdIso ? Date.parse(holdIso) : null });
    if (d.tripLive?.vehicle) add(d.tripLive.vehicle, { id: 'trip', highlight: true, recordedAt: d.tripLive.recordedAt, motion: along(d.stops[0]?.time) });
    for (const x of d.departures ?? []) {
      if (x.live?.vehicle) add(x.live.vehicle, { recordedAt: x.live.recordedAt, etaMin: Math.max(0, minutesUntil(x.eta)), motion: along(x.eta) });
    }
    // נוסעים שזוהו על האוטובוס (תנועה על מסלול הקו במהירות אוטובוס) מדייקים את המיקום של SIRI
    const fused = fuseBusFixes(list, this.crowd, d.geometry, {
      template: { line: d.line, mode: d.mode, color, destination: endName(d.to), motion: along(null) }
    });
    this.vehicles.render(fused);
  }

  #startRefresh() {
    this.#stopRefresh();
    this.refreshTimer = setInterval(() => {
      if (!this.active || this.mode !== 'detail' || !this.detail || document.visibilityState !== 'visible') return;
      this.#reloadDetail(this.detail.lineRef);
    }, DETAIL_REFRESH_MS);
    this.crowdTimer = setInterval(() => {
      if (!this.active || this.mode !== 'detail' || document.visibilityState !== 'visible') return;
      this.#refreshCrowd();
    }, CROWD_REFRESH_MS);
  }

  #stopRefresh() {
    clearInterval(this.refreshTimer);
    clearInterval(this.crowdTimer);
    this.refreshTimer = null;
    this.crowdTimer = null;
  }

  /** רענון שקט של פרטי הקו (זמן אמת + מיקומים), בלי לצייר מחדש את המסלול ובלי להזיז את המפה */
  async #reloadDetail(lineRef) {
    try {
      const d = await fetchLineDetails(lineRef, this.getNear());
      if (!this.active || this.mode !== 'detail' || this.detail?.lineRef !== lineRef) return;
      this.detail = d;
      this.#renderDetail();
      this.#drawVehicles();
      this.#refreshUsers(d);
    } catch {
      // נשארים עם הנתון הקודם
    }
  }

  #focusStop(index) {
    const s = this.detail?.stops?.[index];
    if (!s) return;
    this.sheet.setSnap('half');
    const occ = this.getOcclusion();
    const z = Math.max(this.map.getZoom(), 16);
    const pt = this.map.project([s.lat, s.lng], z).add([occ.right / 2, (occ.bottom - (occ.top ?? 0)) / 2]);
    this.map.flyTo(this.map.unproject(pt, z), z, { duration: 0.5 });
  }
}

