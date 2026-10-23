// לשונית "תחנות": תחנות אוטובוס, רכבת ישראל ורכבת קלה סביבך, עם לוח יציאות חי לכל תחנה.

import { fetchStationsNearby, fetchDepartures, fetchStationsSearch, fetchStationByCode } from './api.js?v=1.5.0-mvktlup2';
import { escapeHtml } from './ui.js?v=1.5.0-mvktlup2';
import { formatDistance, walkMinutes } from './geo.js?v=1.5.0-mvktlup2';
import { fmtTime, minutesUntil, lineBadge, legColor, icon, modeIcon } from './transit-ui.js?v=1.5.0-mvktlup2';
import { toggleStop, isStopSaved } from './favorites.js?v=1.5.0-mvktlup2';
import { starButton } from './favorites-ui.js?v=1.5.0-mvktlup2';
import { showToast } from './ui.js?v=1.5.0-mvktlup2';
import { vehiclesFromArrivals } from './arrivals.js?v=1.5.0-mvktlup2';
import { getSettings } from './settings.js?v=1.5.0-mvktlup2';
import { t } from './i18n.js?v=1.5.0-mvktlup2';
import { track, trackName, trackFeature, trackFailedSearch, safeKey } from './analytics.js?v=1.5.0-mvktlup2';
import { ARRIVAL_GONE_MS, NOW_TICK_MS } from '../config.js?v=1.5.0-mvktlup2';

const FILTERS = [
  { id: 'all', label: 'הכל' },
  { id: 'bus', label: 'אוטובוס' },
  { id: 'rail', label: 'רכבת' },
  { id: 'lightrail', label: 'רכבת קלה' }
];

const MODE_NAMES = { bus: 'אוטובוס', rail: 'רכבת', lightrail: 'רכבת קלה' };
const modeName = (mode) => (MODE_NAMES[mode] ? t(MODE_NAMES[mode]) : '');
const REFRESH_MS = 30000;
const SEARCH_DEBOUNCE_MS = 350;

export class StationsView {
  constructor({ sheet, layer, vehicles = null, map, getNear, getOcclusion, onNavigateTo }) {
    this.sheet = sheet;
    this.layer = layer;
    this.vehicles = vehicles;   // אוטובוסים בדרך לתחנה הפתוחה
    this.map = map;
    this.getNear = getNear;
    this.getOcclusion = getOcclusion;
    this.onNavigateTo = onNavigateTo;

    this.active = false;
    this.mode = 'list';    // list | detail
    this.filter = 'all';
    this.lists = new Map(); // filter -> { at, results, near }
    this.station = null;
    this.board = null;
    this.controller = null;
    this.timer = null;
    this.query = '';         // חיפוש תחנה (שם / עיר / קוד)
    this.searchResults = null;
    this.searchTimer = null;
  }

  activate({ reset = false } = {}) {
    this.active = true;
    this.layer.setVisible(true);
    if (reset || this.mode === 'list' || !this.station) this.#showList();
    else this.#openStation(this.station, { keepView: true });
  }

  deactivate() {
    this.active = false;
    this.controller?.abort();
    clearInterval(this.timer);
    this.timer = null;
    this.layer.setVisible(false);
    this.vehicles?.clear();
  }

  /** לחיצה על סמן תחנה במפה */
  selectById(id) {
    const s = this.#findListed(id);
    if (s) this.#openStation(s);
  }

  /** תחנה מהרשימה המוצגת כרגע – תוצאות חיפוש או תחנות קרובות */
  #findListed(id) {
    const list = this.query ? this.searchResults : this.#current()?.results;
    return list?.find((x) => x.id === id) ?? null;
  }

  handleAction(action, data) {
    switch (action) {
      case 'station-filter':
        this.filter = data.filter;
        this.#showNearby();
        return true;
      case 'station-open': {
        const s = this.#findListed(data.id);
        if (s) this.#openStation(s);
        return true;
      }
      case 'station-search-clear':
        this.query = '';
        this.searchResults = null;
        this.#showList();
        return true;
      case 'station-back':
        this.#showList();
        return true;
      case 'station-walk':
        if (this.station) {
          this.onNavigateTo({ id: this.station.id, kind: 'stop', name: this.station.name, lat: this.station.lat, lng: this.station.lng });
        }
        return true;
      case 'station-fav':
        if (this.station?.code) {
          const on = toggleStop({ ...this.station, mode: this.station.primaryMode });
          if (on === null) return true;
          showToast(on ? t('התחנה נשמרה – תופיע במסך הבית ⭐') : t('התחנה הוסרה מהמועדפים'));
          this.#renderStation();
        }
        return true;
      case 'station-retry':
        this.lists.delete(this.filter);
        this.#showNearby();
        return true;
      default:
        return false;
    }
  }

  #current() {
    return this.lists.get(this.filter);
  }

  // ---------- רשימה ----------

  #showList() {
    this.mode = 'list';
    this.station = null;
    clearInterval(this.timer);
    this.timer = null;
    this.vehicles?.clear();

    // הכותרת ושדה החיפוש מצוירים פעם אחת – כדי שההקלדה לא תאבד פוקוס כשהתוצאות מתעדכנות
    this.sheet.renderCustom(`
      <div class="tab-head">
        <h2 class="tab-title">${t('תחנות')}</h2>
        <div class="tab-search">
          ${icon('search', 18)}
          <input id="stations-input" class="tab-search-input" type="search" inputmode="search" autocomplete="off"
                 placeholder="${t('שם תחנה, עיר או קוד תחנה')}" value="${escapeHtml(this.query)}">
          ${this.query ? `<button class="tab-search-clear" type="button" data-action="station-search-clear" aria-label="${t('ניקוי החיפוש')}">✕</button>` : ''}
        </div>
      </div>
      <div id="stations-body"></div>`, 'stations-list');

    const input = this.sheet.content.querySelector('#stations-input');
    input.addEventListener('input', () => {
      const had = !!this.query;
      this.query = input.value.trim();
      clearTimeout(this.searchTimer);
      if (!this.query) {
        this.searchResults = null;
        this.#showNearby();
      } else {
        this.searchTimer = setTimeout(() => this.#search(), SEARCH_DEBOUNCE_MS);
      }
      // כפתור הניקוי מופיע/נעלם בלי לצייר מחדש את השדה
      if (had !== !!this.query) this.#toggleClear(!!this.query);
    });

    if (this.query) {
      this.sheet.setSnap('full');
      if (this.searchResults) this.#renderSearch(this.searchResults);
      else this.#search();
    } else {
      this.#showNearby();
    }
  }

  #toggleClear(show) {
    const box = this.sheet.content.querySelector('.tab-search');
    const btn = box?.querySelector('.tab-search-clear');
    if (show && !btn) box?.insertAdjacentHTML('beforeend', `<button class="tab-search-clear" type="button" data-action="station-search-clear" aria-label="${t('ניקוי החיפוש')}">✕</button>`);
    if (!show) btn?.remove();
  }

  #body(html) {
    const body = this.sheet.content.querySelector('#stations-body');
    if (body) body.innerHTML = html;
  }

  // ---------- חיפוש ----------

  async #search() {
    const query = this.query;
    if (query.length < 2) {
      this.#body(`<div class="empty">${t('הקלידו לפחות 2 תווים, או קוד תחנה.')}</div>`);
      return;
    }
    this.sheet.setSnap('full');
    this.#body('<div class="skeleton" style="margin-top:8px"><div class="sk-row"></div><div class="sk-row"></div><div class="sk-row"></div></div>');
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    try {
      const data = await fetchStationsSearch(query, this.getNear(), controller.signal);
      if (!this.active || this.mode !== 'list' || this.query !== query) return;
      this.searchResults = data.results ?? [];
      this.#renderSearch(this.searchResults);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      this.#body(`<div class="state-box"><span>${t('החיפוש לא זמין כרגע. נסו שוב.')}</span></div>`);
    }
  }

  #renderSearch(results) {
    if (!results.length) trackFailedSearch(this.query, 'station');
    this.#body(results.length
      ? `<ul class="nearby">${results.map((s) => this.#row(s)).join('')}</ul>`
      : `<div class="empty">${t('לא נמצאה תחנה בשם "{q}".', { q: escapeHtml(this.query) })}</div>`);
    this.layer.render(results.map((s) => ({ ...s, mode: s.primaryMode })), null, null);
  }

  // ---------- תחנות קרובות ----------

  async #showNearby() {
    const near = this.getNear();
    const cached = this.#current();
    const fresh = cached && Date.now() - cached.at < 120000 && Math.hypot(cached.near.lat - near.lat, cached.near.lng - near.lng) < 0.003;

    this.#renderList(fresh ? cached.results : null);
    this.sheet.setSnap('half');
    if (fresh) return;

    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const filter = this.filter;
    try {
      const data = await fetchStationsNearby(near, filter, controller.signal);
      this.lists.set(filter, { at: Date.now(), near, results: data.results ?? [] });
      if (this.active && this.mode === 'list' && this.filter === filter && !this.query) this.#renderList(data.results ?? []);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (!this.query) this.#renderList([], true);
    }
  }

  #renderList(results, failed = false) {
    const chips = FILTERS.map((f) => `
      <button class="filter-chip${f.id === this.filter ? ' is-active' : ''}" type="button" data-action="station-filter" data-filter="${f.id}">
        ${f.id === 'all' ? '' : modeIcon(f.id, 15)}${t(f.label)}
      </button>`).join('');

    let body;
    if (failed) {
      body = `<div class="state-box"><span>${t('לא הצלחנו לטעון תחנות.')}</span></div>
        <button class="btn-secondary" type="button" data-action="station-retry" style="margin-top:10px">${t('לנסות שוב')}</button>`;
    } else if (!results) {
      body = '<div class="skeleton" style="margin-top:8px"><div class="sk-row"></div><div class="sk-row"></div><div class="sk-row"></div></div>';
    } else if (results.length === 0) {
      body = `<div class="empty">${this.filter === 'all' ? t('לא נמצאו תחנות באזור.') : t('לא נמצאו תחנות {mode} באזור.', { mode: escapeHtml(modeName(this.filter)) })}</div>`;
    } else {
      body = `<ul class="nearby">${results.map((s) => this.#row(s)).join('')}</ul>`;
    }

    this.#body(`
      <div class="filter-chips" role="tablist">${chips}</div>
      ${body}`);

    // סמנים במפה
    this.layer.render(
      (results ?? []).map((s) => ({ ...s, mode: s.primaryMode })),
      null,
      null
    );
  }

  #row(s) {
    const modes = s.modes.map((m) => `<span class="mode-tag mode-${m}">${modeIcon(m, 12)}${modeName(m)}</span>`).join('');
    return `
      <li>
        <button class="nearby-item" type="button" data-action="station-open" data-id="${escapeHtml(s.id)}">
          <span class="nearby-icon mode-${s.primaryMode}">${modeIcon(s.primaryMode, 18)}</span>
          <span class="nearby-text">
            <span class="nearby-name">${escapeHtml(s.name)}</span>
            <span class="nearby-sub">${modes}${s.city ? ` · ${escapeHtml(s.city)}` : ''}${s.code ? ` · ${t('קוד {code}', { code: escapeHtml(s.code) })}` : ''}</span>
          </span>
          ${s.distance == null ? '' : `<span class="nearby-dist">${formatDistance(s.distance)}${s.distance <= 3000 ? `<small>${t('{n} דק\' הליכה', { n: walkMinutes(s.distance) })}</small>` : ''}</span>`}
        </button>
      </li>`;
  }

  // ---------- תחנה ולוח יציאות ----------

  async #openStation(station, { keepView = false } = {}) {
    this.mode = 'detail';
    this.station = station;
    this.board = keepView ? this.board : null;
    if (!keepView) {
      trackFeature('station_detail');
      if (station.code) {
        track(`stations.${safeKey(station.code)}`);
        trackName(station.code, station.name);
      }
    }
    this.#renderStation();
    this.layer.render([{ ...station, mode: station.primaryMode }], null, station.id);
    if (!keepView) this.sheet.setSnap('half');
    {
      // תמיד ממרכזים את המפה על התחנה (גם בחזרה ללשונית)
      requestAnimationFrame(() => {
        const occ = this.getOcclusion();
        const z = Math.max(this.map.getZoom(), 16);
        const pt = this.map.project([station.lat, station.lng], z).add([occ.right / 2, (occ.bottom - (occ.top ?? 0)) / 2]);
        this.map.flyTo(this.map.unproject(pt, z), z, { duration: 0.5 });
      });
    }
    // תוצאת חיפוש: משלימים את סוגי התחבורה והרציפים של התחנה (רכבת קלה, כמה רציפים וכו')
    if (!station.stopIds && station.code) {
      try {
        const { station: full } = await fetchStationByCode(station.code, station);
        if (this.station !== station) return;
        // המרחק מתוצאת החיפוש (חושב ממיקום המשתמש) – המפה כבר עפה לתחנה, כך שמרכז המפה לא רלוונטי
        this.station = { ...full, city: station.city, distance: station.distance };
        this.#renderStation();
        this.layer.render([{ ...this.station, mode: this.station.primaryMode }], null, this.station.id);
      } catch {
        // לוח היציאות ייטען לפי קוד + מיקום
      }
    }
    await this.#loadBoard();
    clearInterval(this.timer);
    let lastLoad = Date.now();
    // כל 10 שניות: מעדכן דקות ו"עכשיו" מקומית; טעינה מהשרת רק כל 30 שניות
    this.timer = setInterval(() => {
      if (document.visibilityState !== 'visible' || !this.active || this.mode !== 'detail') return;
      if (Date.now() - lastLoad >= REFRESH_MS - 1000) {
        lastLoad = Date.now();
        this.#loadBoard();
      } else if (this.board?.departures.length) {
        this.#renderStation();
      }
    }, NOW_TICK_MS);
  }

  async #loadBoard() {
    const station = this.station;
    if (!station) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    try {
      const data = await fetchDepartures(
        station.stopIds?.length ? { stopIds: station.stopIds, code: station.code } : { code: station.code, near: station },
        controller.signal
      );
      if (this.station !== station) return;
      this.board = { at: Date.now(), departures: data.departures ?? [], failed: false };
    } catch (err) {
      if (err?.name === 'AbortError') return;
      this.board = { at: Date.now(), departures: this.board?.departures ?? [], failed: true };
    }
    if (this.active && this.mode === 'detail') this.#renderStation();
  }

  #renderStation() {
    const s = this.station;
    const modes = s.modes.map((m) => `<span class="mode-tag mode-${m}">${modeIcon(m, 12)}${modeName(m)}</span>`).join('');

    let board;
    if (!this.board) {
      board = '<div class="skeleton"><div class="sk-row"></div><div class="sk-row"></div><div class="sk-row"></div></div>';
    } else if (!this.#upcoming().length) {
      board = `<div class="state-box"><span>${this.board.failed ? t('לוח היציאות לא זמין כרגע.') : t('אין יציאות בשעה הקרובה.')}</span></div>`;
    } else {
      board = `<ul class="arrivals">${this.#upcoming().slice(0, 20).map((d) => this.#depRow(d)).join('')}</ul>`;
    }
    const anyLive = this.board?.departures.some((d) => d.live);

    this.sheet.renderCustom(`
      <button class="btn-secondary btn-back" type="button" data-action="station-back">${icon('back', 16)} ${t('תחנות')}</button>
      <div class="stop-head" style="margin-top:10px">
        <div class="stop-head-icon mode-${s.primaryMode}">${modeIcon(s.primaryMode, 22)}</div>
        <div class="stop-head-text">
          <p class="eyebrow">${modes}</p>
          <h2 class="stop-title">${escapeHtml(s.name)}</h2>
        </div>
      </div>
      <div class="stop-meta">
        ${s.distance == null ? '' : s.distance <= 3000
          ? `<span class="meta-pill">${icon('walk', 15)}<strong>${t('{n} דק\'', { n: walkMinutes(s.distance) })}</strong> · ${formatDistance(s.distance)}</span>`
          : `<span class="meta-pill">${t('{dist} ממך', { dist: formatDistance(s.distance) })}</span>`}
        ${s.city ? `<span class="meta-pill">${escapeHtml(s.city)}</span>` : ''}
        ${s.code ? `<span class="meta-pill">${t('קוד {code}', { code: escapeHtml(s.code) })}</span>` : ''}
      </div>
      <div class="stop-actions">
        <button class="btn-secondary btn-walk" type="button" data-action="station-walk">${icon('walk', 15)} ${t('מסלול לתחנה')}</button>
        ${s.code ? starButton({ on: isStopSaved(s), action: 'station-fav', label: t('שמירת התחנה') }) : ''}
      </div>
      <h3 class="section-title"><span>${t('יציאות קרובות')}</span>${anyLive ? `<span class="chip chip-live"><span class="live-dot"></span>${t('זמן אמת')}</span>` : ''}</h3>
      ${board}
      <p class="attribution">${t('לוחות זמנים: משרד התחבורה (GTFS) · זמן אמת לאוטובוסים: SIRI')}</p>`,
      `station:${s.id}`);
    this.#renderVehicles();
  }

  /** אוטובוסים בדרך לתחנה (מלוח היציאות, עם מיקום GPS) */
  #renderVehicles() {
    if (!this.vehicles) return;
    const deps = getSettings().showBuses && this.mode === 'detail' ? this.board?.departures ?? [] : [];
    const arrivals = deps.map((d) => ({ ...d, vehicle: d.live?.vehicle ?? null, recordedAt: d.live?.recordedAt ?? null, destination: d.headsign }));
    this.vehicles.render(vehiclesFromArrivals(arrivals, legColor, { stop: this.station }));
  }

  /** יציאות שעוד לא עברו (יציאה נעלמת חצי דקה אחרי "עכשיו") */
  #upcoming() {
    const cutoff = Date.now() - ARRIVAL_GONE_MS;
    return (this.board?.departures ?? []).filter((d) => !(Date.parse(d.eta) < cutoff));
  }

  #depRow(d) {
    const m = minutesUntil(d.eta);
    const eta = m <= 0
      ? `<div class="arrival-eta is-now"><span class="eta-num">${t('עכשיו')}</span></div>`
      : m < 60
        ? `<div class="arrival-eta${d.live ? ' is-live' : ''}"><span class="eta-num">${m}</span><span class="eta-unit">${t('דק\'')}</span></div>`
        : `<div class="arrival-eta"><span class="eta-num eta-clock">${fmtTime(d.eta)}</span></div>`;
    const sub = [
      d.trainNumber ? t('רכבת {n}', { n: escapeHtml(d.trainNumber) }) : '',
      d.agency ? escapeHtml(d.agency) : '',
      d.live
        ? (d.live.delayMin >= 2 ? t('איחור {n} דק\'', { n: d.live.delayMin }) : t('בזמן'))
        : t('{time} לפי לוח זמנים', { time: fmtTime(d.scheduled) })
    ].filter(Boolean).join(' · ');

    return `
      <li class="arrival">
        ${lineBadge(d)}
        <div class="arrival-body">
          <div class="arrival-dest">${d.headsign ? t('לכיוון {dest}', { dest: escapeHtml(d.headsign) }) : escapeHtml(modeName(d.mode))}</div>
          <div class="arrival-sub">${sub}</div>
        </div>
        ${eta}
      </li>`;
  }
}
