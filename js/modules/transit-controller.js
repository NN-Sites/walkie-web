// זרימת תחבורה ציבורית: חיפוש מסלולים -> רשימה -> פירוט -> ליווי נסיעה -> הגעה.
// מצבים: idle | loading | error | list | detail | trip | arrived

import { fetchTransitPlan, fetchTransitLive } from './api.js';
import { RouteSimulator } from './navigation.js';
import { buildTripModel, TripSession } from './transit-trip.js';
import { focusPoint } from './map.js';
import { showToast } from './ui.js';
import { vibrate, transitPrefsParams } from './settings.js';
import * as tpl from './transit-ui.js';

const LIST_REFRESH_MS = 30000;   // רענון "בעוד X דק'" ברשימה/פירוט
const LIVE_REFRESH_MS = 20000;   // רענון זמן אמת בזמן נסיעה
const TRIP_ZOOM = 17;

export class TransitController {
  constructor({ map, sheet, layer, banner, getOcclusion, onModeChange, onSimPosition, onPlanned, simulate = false }) {
    this.map = map;
    this.sheet = sheet;
    this.layer = layer;
    this.banner = banner;
    this.getOcclusion = getOcclusion;
    this.onModeChange = onModeChange;
    this.onSimPosition = onSimPosition;
    this.onPlanned = onPlanned;
    this.simulate = simulate;

    this.mode = 'idle';
    this.request = null;      // { origin, dest, when }
    this.result = null;
    this.selected = null;
    this.trip = null;         // { model, session }
    this.sim = null;
    this.controller = null;
    this.loadingMore = false;
    this.listFilter = 'all';
    this.lastPos = null;
    this.refreshTimer = null;
    this.liveTimer = null;
    this.wakeLock = null;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (this.mode === 'trip') {
          this.#acquireWakeLock();
          this.#refreshLive();
        }
        this.#render();
      }
    });
  }

  get isActive() {
    return this.mode !== 'idle';
  }

  get isTripping() {
    return this.mode === 'trip';
  }

  get isSimulating() {
    return !!this.sim?.timer;
  }

  // ---------- תכנון ----------

  async plan({ origin, dest, when }) {
    this.#stopTrip();
    this.request = { origin, dest, when };
    this.result = null;
    this.listFilter = 'all';
    this.selected = null;
    this.layer.clear();
    this.#setMode('loading');
    this.sheet.renderCustom(tpl.loadingHtml(), 'transit-loading');
    this.sheet.setSnap('half');

    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    try {
      let result = await fetchTransitPlan(origin, dest, when, null, controller.signal);
      // אין יציאות בחלון הראשון (למשל בלילה או בקו נדיר) – טוענים אוטומטית את המאוחרים יותר,
      // במקום להציג "לא נמצאו מסלולים"
      for (let page = 0; page < 2 && result.itineraries.length === 0 && result.nextCursor; page++) {
        const more = await fetchTransitPlan(origin, dest, when, result.nextCursor, controller.signal);
        result = { ...result, itineraries: more.itineraries ?? [], nextCursor: more.nextCursor ?? null };
      }
      if (controller.signal.aborted) return;
      this.result = result;
      this.#setMode('list');
      this.onPlanned?.(result);
      // ההצעה המומלצת מוצגת על המפה כבר ברשימה
      const rec = result.itineraries.find((it) => it.recommended) ?? result.itineraries[0];
      if (rec) this.#showOnMap(rec);
      this.#render(true);
      this.#startListRefresh();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      this.#setMode('error');
      this.sheet.renderCustom(tpl.errorHtml(err?.status), `transit-error:${err?.status}`);
    }
  }

  async later() {
    if (!this.result?.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    this.#render();
    try {
      const { origin, dest, when } = this.request;
      const more = await fetchTransitPlan(origin, dest, when, this.result.nextCursor);
      const known = new Set(this.result.itineraries.map((it) => it.id));
      const added = (more.itineraries ?? [])
        .filter((it) => !known.has(it.id))
        .map((it) => ({ ...it, recommended: false }));
      this.result = {
        ...this.result,
        itineraries: [...this.result.itineraries, ...added],
        nextCursor: more.nextCursor
      };
    } catch {
      showToast('לא הצלחנו לטעון מסלולים נוספים');
    } finally {
      this.loadingMore = false;
      this.#render();
    }
  }

  select(index) {
    const it = this.result?.itineraries?.[index];
    if (!it) return;
    this.selected = it;
    this.#setMode('detail');
    this.#showOnMap(it);
    this.#render(true);
    this.#refreshSelectedLive();
  }

  back() {
    this.selected = null;
    this.#setMode('list');
    const rec = this.result?.itineraries.find((it) => it.recommended) ?? this.result?.itineraries[0];
    if (rec) this.#showOnMap(rec);
    this.#render(true);
  }

  handleAction(action, data) {
    switch (action) {
      case 'transit-select':
        this.select(Number(data.index));
        return true;
      case 'transit-back':
        this.back();
        return true;
      case 'transit-filter': {
        this.listFilter = data.filter;
        // המפה מציגה את המסלול הראשון במסנן שנבחר (למשל את חלופת הרכבת)
        const keep = tpl.ITINERARY_FILTERS[data.filter] ?? tpl.ITINERARY_FILTERS.all;
        const visible = this.result?.itineraries.filter(keep) ?? [];
        const show = visible.find((it) => it.recommended) ?? visible[0];
        if (show) this.#showOnMap(show);
        this.#render();
        return true;
      }
      case 'transit-later':
        this.later();
        return true;
      case 'transit-retry':
        if (this.request) this.plan(this.request);
        return true;
      case 'transit-start':
        this.startTrip();
        return true;
      case 'transit-end':
        this.exit();
        return true;
      default:
        return false;
    }
  }

  // ---------- ליווי נסיעה ----------

  startTrip() {
    const it = this.selected;
    if (!it) return;

    const model = buildTripModel(it);
    const session = new TripSession(model, {
      onArrive: () => this.#arrive(),
      onAlightSoon: (leg) => {
        vibrate([200, 100, 200, 100, 200]);
        showToast(`מתקרבים – רדו ב${leg.to.name}`);
      },
      onLegChange: () => this.#refreshLive(),
      onOffRoute: () => showToast('נראה שסטית מהמסלול. אפשר לחפש מסלול חדש מהמיקום הנוכחי.')
    });
    this.trip = { model, session };

    this.#setMode('trip');
    document.body.classList.add('navigating');
    this.sheet.setSnap('peek');
    this.#acquireWakeLock();
    this.#stopListRefresh();
    this.liveTimer = setInterval(() => this.#refreshLive(), LIVE_REFRESH_MS);
    this.#refreshLive();

    if (this.simulate) {
      this.sim = new RouteSimulator(model, (p) => this.onSimPosition(p), { speedAt: TripSession.speedAt(model) });
      this.sim.start();
      showToast('מצב הדמיה: הנסיעה מתקדמת לבד');
    } else {
      this.onPosition(this.lastPos ?? { ...model.pts[0], accuracy: 10 });
    }
  }

  onPosition(pos) {
    this.lastPos = pos;
    if (this.mode !== 'trip' || !this.trip) return;

    const state = this.trip.session.update(pos);
    if (this.mode !== 'trip') return; // הגעה ליעד בתוך update

    focusPoint(this.map, [pos.lat, pos.lng], { zoom: TRIP_ZOOM, occlusion: this.getOcclusion() });
    this.#renderTrip(state);
  }

  exit({ silent = false } = {}) {
    this.controller?.abort();
    this.controller = null;
    this.#stopTrip();
    this.#stopListRefresh();
    this.layer.clear();
    this.result = null;
    this.selected = null;
    this.request = null;
    this.#setMode('idle', silent);
  }

  // ---------- פנימי ----------

  #setMode(mode, silent = false) {
    this.mode = mode;
    if (!silent) this.onModeChange?.(mode);
  }

  #showOnMap(it) {
    this.layer.show(it, tpl.legColor);
    requestAnimationFrame(() => this.layer.fit(this.getOcclusion()));
  }

  #render(isNew = false) {
    const now = Date.now();
    if (this.mode === 'list' && this.result) {
      this.sheet.renderCustom(
        tpl.listHtml(this.result, {
          loadingMore: this.loadingMore,
          now,
          filter: this.listFilter,
          // האם ההגדרות מצמצמות את החיפוש (להסבר כשאין תוצאות)
          restricted: Object.keys(transitPrefsParams()).length > 0
        }),
        isNew ? `transit-list:${this.result.generatedAt}` : this.sheet.lastFocusKey
      );
    } else if (this.mode === 'detail' && this.selected) {
      this.sheet.renderCustom(
        tpl.detailHtml(this.selected, {
          originName: this.request.origin.name ?? 'נקודת מוצא',
          destName: this.request.dest.name ?? 'יעד',
          now
        }),
        isNew ? `transit-detail:${this.selected.id}` : this.sheet.lastFocusKey
      );
    } else if (this.mode === 'trip' && this.trip?.session.state) {
      this.#renderTrip(this.trip.session.state);
    }
  }

  #renderTrip(state) {
    const { html, tone } = tpl.tripBannerHtml(state, { destName: this.request.dest.name ?? 'יעד' });
    if (this.banner.innerHTML !== html) this.banner.innerHTML = html;
    this.banner.dataset.tone = tone;
    this.banner.hidden = false;
    this.sheet.renderCustom(tpl.tripPanelHtml(state, this.trip.model.itinerary), 'transit-trip');
  }

  #arrive() {
    this.mode = 'arrived';
    vibrate([100, 50, 100, 50, 220]);
    this.sim?.stop();
    this.sim = null;
    clearInterval(this.liveTimer);
    this.liveTimer = null;
    this.#releaseWakeLock();
    this.banner.hidden = true;
    document.body.classList.remove('navigating');
    this.sheet.renderCustom(tpl.tripArrivedHtml(this.request.dest.name ?? 'יעד'), 'transit-arrived');
    this.sheet.setSnap('half');
    this.onModeChange?.('arrived');
  }

  #stopTrip() {
    this.sim?.stop();
    this.sim = null;
    clearInterval(this.liveTimer);
    this.liveTimer = null;
    this.#releaseWakeLock();
    this.trip = null;
    this.banner.hidden = true;
    this.banner.innerHTML = '';
    delete this.banner.dataset.tone;
    document.body.classList.remove('navigating');
  }

  #startListRefresh() {
    this.#stopListRefresh();
    this.refreshTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (this.mode === 'detail') this.#refreshSelectedLive();
      this.#render();
    }, LIST_REFRESH_MS);
  }

  #stopListRefresh() {
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  /** זמן אמת לקו הראשון במסלול שנבחר */
  async #refreshSelectedLive() {
    const leg = this.selected?.legs.find((l) => l.mode === 'bus' && l.from.code);
    if (!leg) return;
    await this.#updateLegLive(leg);
    if (this.mode === 'detail') this.#render();
  }

  /** בזמן נסיעה: זמן אמת לקו שעליו מחכים / הבא בתור */
  async #refreshLive() {
    if (!this.trip || document.visibilityState !== 'visible') return;
    const { legs } = this.trip.model;
    const from = this.trip.session.legIndex;
    const leg = legs.slice(from).find((l, k) => l.mode === 'bus' && l.from.code && !this.trip.session.boarded.has(from + k));
    if (!leg) return;
    await this.#updateLegLive(leg);
    if (this.mode === 'trip' && this.trip.session.state) this.#renderTrip(this.trip.session.state);
  }

  async #updateLegLive(leg) {
    const sched = Date.parse(leg.scheduledStart);
    if (sched - Date.now() > 75 * 60000) return; // רחוק מדי – SIRI עוד לא מכיר את הנסיעה
    try {
      const { live } = await fetchTransitLive(leg);
      // appliedDelayMin – האיחור שכבר נכלל בזמני המסלול בתכנון; נשמר כדי לא לספור אותו פעמיים
      if (live) leg.live = { ...live, appliedDelayMin: leg.live?.appliedDelayMin ?? 0, arrivalEta: leg.live?.arrivalEta ?? null };
    } catch {
      // נשארים עם הנתון הקודם (או לוח הזמנים)
    }
  }

  async #acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener?.('release', () => {
          this.wakeLock = null;
        });
      }
    } catch {
      this.wakeLock = null;
    }
  }

  #releaseWakeLock() {
    this.wakeLock?.release?.().catch(() => {});
    this.wakeLock = null;
  }
}
