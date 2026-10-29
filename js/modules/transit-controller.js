// זרימת תחבורה ציבורית: חיפוש מסלולים -> רשימה -> פירוט -> ליווי נסיעה -> הגעה.
// מצבים: idle | loading | error | list | detail | trip | arrived

import { fetchTransitPlan, fetchTransitLive } from './api.js?v=1.10.0-mvu1kw0g';
import { RouteSimulator } from './navigation.js?v=1.10.0-mvu1kw0g';
import { buildTripModel, TripSession } from './transit-trip.js?v=1.10.0-mvu1kw0g';
import { focusPoint } from './map.js?v=1.10.0-mvu1kw0g';
import { showToast } from './ui.js?v=1.10.0-mvu1kw0g';
import { vibrate, transitPrefsParams, getSettings } from './settings.js?v=1.10.0-mvu1kw0g';
import { toggleLine } from './favorites.js?v=1.10.0-mvu1kw0g';
import { onLineWatched } from './push.js?v=1.10.0-mvu1kw0g';
import * as tpl from './transit-ui.js?v=1.10.0-mvu1kw0g';
import { t } from './i18n.js?v=1.10.0-mvu1kw0g';
import { serviceStatus, serviceNotice } from './service-calendar.js?v=1.10.0-mvu1kw0g';
import { toggleLeaveReminder, hasLeaveReminder, refreshLeaveReminder, clearLeaveReminder } from './leave-now.js?v=1.10.0-mvu1kw0g';
import { notifyNow, NOTIFY_ID, cancelNotifications } from './notify.js?v=1.10.0-mvu1kw0g';

const LIST_REFRESH_MS = 30000;   // רענון "בעוד X דק'" ברשימה/פירוט
const LIVE_REFRESH_MS = 20000;   // רענון זמן אמת בזמן נסיעה
const TRIP_ZOOM = 17;

export class TransitController {
  constructor({ map, sheet, layer, vehicles = null, banner, getOcclusion, onModeChange, onSimPosition, onPlanned, simulate = false }) {
    this.map = map;
    this.sheet = sheet;
    this.layer = layer;
    this.vehicles = vehicles;   // האוטובוס שמחכים לו, בזמן אמת על המפה
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
    this.tripTab = 'cards';     // כרטיסייה פעילה בזמן נסיעה: cards | overview | stops | route
    this.cardPick = null;     // כרטיס שבחרו ידנית בקרוסלה: { step, key } (key = השלב בנסיעה שבו נבחר)
    this.stripBusy = false;   // גוללים את הקרוסלה עכשיו – לא מרנדרים מחדש מתחתם
    this.stripTimer = null;
    this.lastPos = null;
    this.refreshTimer = null;
    this.liveTimer = null;
    this.wakeLock = null;

    // החלקה בקרוסלת השלבים: הכרטיס שנעצר עליו הופך לנבחר והמפה מתמקדת בו
    document.addEventListener('scroll', (e) => {
      if (this.mode !== 'trip' || !e.target.classList?.contains('trip-cards-strip')) return;
      this.stripBusy = true;
      clearTimeout(this.stripTimer);
      this.stripTimer = setTimeout(() => this.#onStripSettled(e.target), 140);
    }, true);

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
    this.vehicles?.clear();
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
      const rec = tpl.pickPrimary(result.itineraries, getSettings().routeType);
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
      showToast(t('לא הצלחנו לטעון מסלולים נוספים'));
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

  /** המסלול שמשתפים: הנבחר, או הראשון ברשימה לפי סוג המסלול */
  get shareItinerary() {
    if (this.selected) return this.selected;
    return this.result ? tpl.pickPrimary(this.result.itineraries ?? [], getSettings().routeType) ?? null : null;
  }

  /** סוג המסלול (הכי מומלץ / הליכה מינימלית / החלפות מינימליות) השתנה: סידור מחדש של הרשימה */
  setRouteType() {
    if (this.mode !== 'list' || !this.result) return;
    const keep = tpl.ITINERARY_FILTERS[this.listFilter] ?? tpl.ITINERARY_FILTERS.all;
    const show = tpl.pickPrimary(this.result.itineraries.filter(keep), getSettings().routeType);
    if (show) this.#showOnMap(show);
    this.#render(true);
  }

  back() {
    this.selected = null;
    this.#setMode('list');
    const rec = tpl.pickPrimary(this.result?.itineraries ?? [], getSettings().routeType);
    if (rec) this.#showOnMap(rec);
    this.#render(true);
  }

  handleAction(action, data) {
    switch (action) {
      case 'transit-select':
        this.select(Number(data.index));
        return true;
      case 'transit-leg':
        if (this.mode === 'detail') this.layer.fitLeg(Number(data.leg), this.getOcclusion());
        return true;
      case 'transit-back':
        this.back();
        return true;
      case 'transit-filter': {
        this.listFilter = data.filter;
        // המפה מציגה את המסלול הראשון במסנן שנבחר (למשל את חלופת הרכבת)
        const keep = tpl.ITINERARY_FILTERS[data.filter] ?? tpl.ITINERARY_FILTERS.all;
        const visible = this.result?.itineraries.filter(keep) ?? [];
        const show = tpl.pickPrimary(visible, getSettings().routeType);
        if (show) this.#showOnMap(show);
        this.#render();
        return true;
      }
      case 'line-watch': {
        if (!data.route) return true;
        const on = toggleLine({ lineRef: data.route, line: data.line, mode: data.mode, agency: data.agency || null, headsign: data.to || null });
        if (on === null) return true;
        if (on) onLineWatched().then(showToast);
        else showToast(t('הקו הוסר מ"הקווים שלי"'));
        this.#render();
        return true;
      }
      case 'transit-later':
        this.later();
        return true;
      case 'leave-remind':
        toggleLeaveReminder(this.selected).then(() => this.#render());
        return true;
      case 'pay-trip':
        showToast(t('כרגע לא זמין, יהיה זמין בקרוב.'), 4500);
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
      case 'trip-card': {
        if (this.mode !== 'trip' || !this.trip?.session.state) return false;
        const steps = this.#cardSteps();
        const cur = this.#cardIndex(this.trip.session.state, steps);
        const to = data.dir !== undefined ? cur + Number(data.dir) : Number(data.step);
        this.#pickCard(Math.max(0, Math.min(steps.length - 1, to)), steps);
        this.#syncStrip(true);
        return true;
      }
      case 'trip-tab':
        if (this.mode !== 'trip') return false;
        this.tripTab = data.tabId;
        if (this.trip?.session.state) this.#renderTrip(this.trip.session.state);
        return true;
      default:
        return false;
    }
  }

  // ---------- ליווי נסיעה ----------

  startTrip() {
    const it = this.selected;
    if (!it) return;

    clearLeaveReminder(); // כבר יצאנו
    const model = buildTripModel(it);
    const session = new TripSession(model, {
      onArrive: () => this.#arrive(),
      onAlightSoon: (leg) => {
        vibrate([200, 100, 200, 100, 200]);
        showToast(t('מתקרבים – רדו ב{stop}', { stop: leg.to.name }));
        // המסך נעול / האפליקציה ברקע: התראה שמרעידה את הטלפון
        if (document.visibilityState !== 'visible') notifyNow(NOTIFY_ID.getOff, t('רדו בתחנה הבאה'), t('מתקרבים – רדו ב{stop}', { stop: leg.to.name }));
      },
      onLegChange: () => this.#refreshLive(),
      onOffRoute: () => showToast(t('נראה שסטית מהמסלול. אפשר לחפש מסלול חדש מהמיקום הנוכחי.'))
    });
    this.trip = { model, session };
    this.tripTab = 'cards';
    this.cardPick = null;

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
      showToast(t('מצב הדמיה: הנסיעה מתקדמת לבד'));
    } else {
      this.onPosition(this.lastPos ?? { ...model.pts[0], accuracy: 10 });
    }
  }

  onPosition(pos) {
    this.lastPos = pos;
    if (this.mode !== 'trip' || !this.trip) return;

    const state = this.trip.session.update(pos);
    if (this.mode !== 'trip') return; // הגעה ליעד בתוך update

    // כשבוחרים כרטיס אחר מהשלב הנוכחי – המפה נשארת על השלב שבחרו
    if (!this.#cardPicked(state)) focusPoint(this.map, [pos.lat, pos.lng], { zoom: TRIP_ZOOM, occlusion: this.getOcclusion() });
    this.#renderTrip(state);
  }

  exit({ silent = false } = {}) {
    this.controller?.abort();
    this.controller = null;
    this.#stopTrip();
    this.#stopListRefresh();
    this.layer.clear();
    this.vehicles?.clear();
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
    this.#renderVehicle();
    if (this.mode === 'list' && this.result) {
      this.sheet.renderCustom(
        tpl.listHtml(this.result, {
          loadingMore: this.loadingMore,
          now,
          filter: this.listFilter,
          routeType: getSettings().routeType,
          // האם ההגדרות מצמצמות את החיפוש (להסבר כשאין תוצאות)
          restricted: Object.keys(transitPrefsParams()).length > 0,
          // שבת / חג בזמן המבוקש (יציאה עכשיו או בשעה שנבחרה)
          notice: serviceNotice(serviceStatus(this.request.when?.time?.getTime?.() ?? now, this.request.origin))
        }),
        isNew ? `transit-list:${this.result.generatedAt}` : this.sheet.lastFocusKey
      );
    } else if (this.mode === 'detail' && this.selected) {
      this.sheet.renderCustom(
        tpl.detailHtml(this.selected, {
          reminderOn: hasLeaveReminder(this.selected),
          originName: this.request.origin.name ?? t('נקודת מוצא'),
          destName: this.request.dest.name ?? t('יעד'),
          itineraries: this.result?.itineraries ?? [],
          now
        }),
        isNew ? `transit-detail:${this.selected.id}` : this.sheet.lastFocusKey
      );
    } else if (this.mode === 'trip' && this.trip?.session.state) {
      this.#renderTrip(this.trip.session.state);
    }
  }

  #renderTrip(state) {
    this.#renderVehicle();
    const { html, tone } = tpl.tripBannerHtml(state, { destName: this.request.dest.name ?? t('יעד') });
    if (this.banner.innerHTML !== html) this.banner.innerHTML = html;
    this.banner.dataset.tone = tone;
    this.banner.hidden = false;
    const cards = this.tripTab === 'cards';
    if (cards && this.stripBusy) return;
    const steps = cards ? this.#cardSteps() : [];
    this.sheet.renderCustom(
      tpl.tripPanelHtml(state, this.trip.model.itinerary, this.tripTab, { steps, cardIndex: cards ? this.#cardIndex(state, steps) : 0 }),
      'transit-trip'
    );
    if (cards) this.#syncStrip(false);
  }

  // ---------- קרוסלת שלבים ----------

  #cardSteps() {
    return tpl.tripCardSteps(this.trip.model.itinerary, this.request.dest.name ?? t('יעד'));
  }

  #cardKey(state) {
    return `${state.legIndex}:${state.phase}`;
  }

  /** האם המשתמש בחר ידנית כרטיס שאינו הנוכחי (הבחירה פגה כשהנסיעה עוברת לשלב אחר) */
  #cardPicked(state) {
    return this.tripTab === 'cards' && !!this.cardPick && this.cardPick.key === this.#cardKey(state);
  }

  #cardIndex(state, steps) {
    return this.#cardPicked(state) ? Math.min(this.cardPick.step, steps.length - 1) : tpl.currentCardStep(steps, state);
  }

  #pickCard(step, steps) {
    const state = this.trip.session.state;
    this.cardPick = { step, key: this.#cardKey(state) };
    const leg = steps[step]?.leg;
    if (leg != null) this.layer.fitLeg(leg, this.getOcclusion());
    else this.layer.fit(this.getOcclusion());
    document.querySelectorAll('.trip-dot').forEach((d, i) => d.classList.toggle('is-active', i === step));
  }

  /** מיישר את הפס לכרטיס הנבחר (אחרי רינדור או לחיצה על חץ / נקודה) */
  #syncStrip(smooth) {
    const strip = document.querySelector('.trip-cards-strip');
    if (!strip || !this.trip?.session.state) return;
    const index = this.#cardIndex(this.trip.session.state, this.#cardSteps());
    const dir = getComputedStyle(strip).direction === 'rtl' ? -1 : 1;
    strip.scrollTo({ left: dir * index * strip.clientWidth, behavior: smooth ? 'smooth' : 'instant' });
  }

  #onStripSettled(strip) {
    this.stripBusy = false;
    if (this.mode !== 'trip' || !this.trip?.session.state || !strip.isConnected || !strip.clientWidth) return;
    const step = Math.round(Math.abs(strip.scrollLeft) / strip.clientWidth);
    const steps = this.#cardSteps();
    if (step === this.#cardIndex(this.trip.session.state, steps)) return;
    this.#pickCard(Math.min(step, steps.length - 1), steps);
  }

  #arrive() {
    this.mode = 'arrived';
    cancelNotifications(NOTIFY_ID.getOff);
    this.vehicles?.clear();
    vibrate([100, 50, 100, 50, 220]);
    this.sim?.stop();
    this.sim = null;
    clearInterval(this.liveTimer);
    this.liveTimer = null;
    this.#releaseWakeLock();
    this.banner.hidden = true;
    document.body.classList.remove('navigating');
    this.sheet.renderCustom(tpl.tripArrivedHtml(this.request.dest.name ?? t('יעד')), 'transit-arrived');
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

  /**
   * האוטובוס הרלוונטי על המפה: בפירוט מסלול – הקו הראשון; בליווי נסיעה – הקו שעליו מחכים / הבא בתור
   * (בזמן הנסיעה עצמה אנחנו באוטובוס, אז לא מציגים אותו).
   */
  #renderVehicle() {
    if (!this.vehicles) return;
    let leg = null;
    if (this.mode === 'detail') {
      leg = this.selected?.legs.find((l) => l.mode !== 'walk');
    } else if (this.mode === 'trip' && this.trip?.session.state) {
      const st = this.trip.session.state;
      leg = st.phase === 'waiting' ? st.boardLeg : st.phase === 'walking' && st.next?.mode !== 'walk' ? st.next : null;
    }
    const v = leg?.live?.vehicle;
    if (!v || (leg.live.recordedAt && Date.now() - Date.parse(leg.live.recordedAt) > 5 * 60000)) {
      this.vehicles.clear();
      return;
    }
    this.vehicles.render([{
      id: 'trip-bus',
      lat: v.lat,
      lng: v.lng,
      line: leg.line,
      mode: leg.mode,
      color: tpl.legColor(leg),
      highlight: true,
      etaMin: Math.max(0, Math.round((Date.parse(leg.live.eta) - Date.now()) / 60000)),
      destination: leg.headsign ?? null,
      recordedAt: leg.live.recordedAt ?? null,
      // בין עדכונים – מתקדם לכיוון תחנת העלייה לפי זמן ההגעה בזמן אמת
      motion: { target: { lat: leg.from.lat, lng: leg.from.lng, at: Date.parse(leg.live.eta) } }
    }]);
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
    refreshLeaveReminder(this.selected);
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
