// מנהל את זרימת המסלול: חישוב -> תצוגה מקדימה -> ניווט חי -> הגעה.
// מצבים: idle | loading | error | preview | navigating | arrived

import { NAV_ZOOM, NAV_USER_SCREEN_OFFSET } from '../config.js?v=1.5.0-mvkscoi4';
import { fetchWalkRoute } from './api.js?v=1.5.0-mvkscoi4';
import { buildRouteModel, NavigationSession, RouteSimulator } from './navigation.js?v=1.5.0-mvkscoi4';
import { HeadingSource } from './compass.js?v=1.5.0-mvkscoi4';
import { focusPoint } from './map.js?v=1.5.0-mvkscoi4';
import { showToast } from './ui.js?v=1.5.0-mvkscoi4';
import { t } from './i18n.js?v=1.5.0-mvkscoi4';
import { vibrate } from './settings.js?v=1.5.0-mvkscoi4';
import * as tpl from './route-ui.js?v=1.5.0-mvkscoi4';

export class RouteController {
  constructor({ map, sheet, routeLayer, rotator, userLayer, banner, compassBtn, getOrigin, getOcclusion, onModeChange, onSimPosition, onPlanned, simulate = false }) {
    this.map = map;
    this.sheet = sheet;
    this.routeLayer = routeLayer;
    this.rotator = rotator;
    this.userLayer = userLayer;
    this.banner = banner;
    this.compassBtn = compassBtn;
    this.getOrigin = getOrigin;
    this.getOcclusion = getOcclusion ?? (() => sheet.occlusion());
    this.onPlanned = onPlanned;
    this.onModeChange = onModeChange;
    this.onSimPosition = onSimPosition;
    this.simulate = simulate;

    this.mode = 'idle';
    this.dest = null;
    this.model = null;
    this.session = null;
    this.lastPos = null;
    this.headingUp = true;
    this.rerouting = false;
    this.controller = null;
    this.sim = null;
    this.wakeLock = null;

    this.heading = new HeadingSource((h) => this.#onCompass(h));

    compassBtn.addEventListener('click', () => this.toggleCompass());

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.mode === 'navigating') this.#acquireWakeLock();
    });
  }

  get isActive() {
    return this.mode !== 'idle';
  }

  get isNavigating() {
    return this.mode === 'navigating';
  }

  get isSimulating() {
    return !!this.sim?.timer;
  }

  // ---------- תכנון ----------

  /** dest – יעד; options.origin – נקודת מוצא מפורשת (ברירת מחדל: המיקום הנוכחי) */
  async planTo(dest, { origin: explicitOrigin = null } = {}) {
    if (this.mode === 'navigating' || this.mode === 'arrived') this.exit({ silent: true });

    this.dest = dest;
    this.model = null;
    this.#setMode('loading');
    this.routeLayer.clear();
    this.sheet.renderCustom(tpl.routeLoadingHtml(dest), `route-loading:${dest.id ?? dest.name}`);
    this.sheet.setSnap('half');

    const origin = explicitOrigin ?? this.getOrigin();
    this.originIsUser = origin.isUser;

    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    try {
      const route = await fetchWalkRoute(origin, dest, controller.signal);
      if (controller.signal.aborted || this.dest !== dest) return;
      this.model = buildRouteModel(route);
      this.routeLayer.show(this.model);
      this.#setMode('preview');
      this.#renderPreview();
      this.onPlanned?.(this.model);
      requestAnimationFrame(() => this.routeLayer.fit(this.getOcclusion()));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      this.#setMode('error');
      this.sheet.renderCustom(tpl.routeErrorHtml(dest, err?.status), `route-error:${err?.status}`);
    }
  }

  /** פעולות מתוך הלוח. מחזיר true אם טופלה */
  handleAction(action) {
    switch (action) {
      case 'route-start':
        this.start();
        return true;
      case 'route-end':
      case 'route-close':
        this.exit();
        return true;
      case 'route-retry':
        if (this.dest) this.planTo(this.dest);
        return true;
      default:
        return false;
    }
  }

  // ---------- ניווט ----------

  start() {
    if (!this.model) return;

    // חייב לקרות ישר מתוך הלחיצה – iOS מבקש אישור למצפן רק בתוך gesture
    const compassReady = this.heading.start();

    this.#setMode('navigating');
    document.body.classList.add('navigating');
    this.session = this.#newSession(this.model);
    this.headingUp = true;
    this.rotator.enable();
    this.compassBtn.hidden = false;
    this.#updateCompassBtn();
    this.sheet.setSnap('peek');
    this.#acquireWakeLock();

    compassReady.then((ok) => {
      if (!ok) console.info('[Walkie] compass unavailable – using GPS/route heading');
    });

    if (this.simulate) {
      this.sim = new RouteSimulator(this.model, (p) => this.onSimPosition(p));
      this.sim.start();
      showToast(t('מצב הדמיה: הולכים לאורך המסלול'));
    } else {
      const first = this.lastPos ?? { ...this.model.pts[0], accuracy: 10, heading: null, speed: null };
      this.onPosition(first);
    }
  }

  onPosition(pos) {
    this.lastPos = pos;
    if (this.mode !== 'navigating' || !this.session) return;

    const state = this.session.update(pos);
    if (this.mode !== 'navigating') return; // onArrive עשוי לשנות מצב בתוך update

    this.routeLayer.setProgress(state.snap);

    const heading = this.#bestHeading(pos, state);
    if (Number.isFinite(heading)) {
      if (this.headingUp) this.rotator.setHeading(heading);
      if (!this.heading.isLive) this.#rotateCompassIcon(heading);
    }

    this.#follow(pos);
    this.#renderNav(state);
  }

  toggleCompass() {
    if (this.mode !== 'navigating') return;
    this.headingUp = !this.headingUp;
    if (this.headingUp) {
      this.heading.start();
      this.rotator.enable();
      const h = this.heading.isLive ? this.heading.value : this.session?.state?.snap?.bearing;
      if (Number.isFinite(h)) this.rotator.setHeading(h);
    } else {
      this.rotator.disable();
    }
    this.#updateCompassBtn();
    if (this.lastPos) this.#follow(this.lastPos);
  }

  exit({ silent = false } = {}) {
    this.controller?.abort();
    this.controller = null;
    this.sim?.stop();
    this.sim = null;
    this.heading.stop();
    this.rotator.disable();
    this.#releaseWakeLock();
    this.routeLayer.clear();
    this.userLayer.lockHeading(false);
    this.banner.hidden = true;
    this.banner.innerHTML = '';
    this.compassBtn.hidden = true;
    document.body.classList.remove('navigating');
    this.session = null;
    this.model = null;
    this.dest = null;
    this.rerouting = false;
    this.#setMode('idle', silent);
  }

  // ---------- פנימי ----------

  #setMode(mode, silent = false) {
    this.mode = mode;
    if (!silent) this.onModeChange(mode, this.dest);
  }

  #newSession(model) {
    return new NavigationSession(model, {
      onOffRoute: (pos) => this.#reroute(pos),
      onArrive: () => this.#arrive(),
      onApproach: () => vibrate([60, 40, 60])
    });
  }

  async #reroute(pos) {
    if (this.rerouting || !this.dest || this.isSimulating) return;
    this.rerouting = true;
    if (this.session?.state) this.#renderNav(this.session.state);

    try {
      const route = await fetchWalkRoute(pos, this.dest);
      if (this.mode !== 'navigating') return;
      this.model = buildRouteModel(route);
      this.session = this.#newSession(this.model);
      this.routeLayer.show(this.model);
    } catch {
      showToast(t('לא הצלחנו לחשב מסלול חדש – ממשיכים במסלול הקודם'));
    } finally {
      this.rerouting = false;
      if (this.mode === 'navigating' && this.lastPos) this.onPosition(this.lastPos);
    }
  }

  #arrive() {
    this.mode = 'arrived';
    vibrate([100, 50, 100, 50, 220]);
    this.sim?.stop();
    this.heading.stop();
    this.rotator.disable();
    this.userLayer.lockHeading(false);
    this.#releaseWakeLock();
    this.banner.hidden = true;
    this.compassBtn.hidden = true;
    document.body.classList.remove('navigating');
    this.sheet.renderCustom(tpl.arrivedHtml(this.dest), 'arrived');
    this.sheet.setSnap('half');
    this.onModeChange('arrived', this.dest);
  }

  #bestHeading(pos, state) {
    if (this.heading.isLive) return this.heading.value;
    if (Number.isFinite(pos.heading) && (pos.speed ?? 0) > 0.6) return pos.heading;
    return state.snap?.bearing;
  }

  #onCompass(h) {
    if (this.mode !== 'navigating') return;
    this.userLayer.lockHeading(true);
    this.userLayer.setHeading(h);
    if (this.headingUp) this.rotator.setHeading(h);
    this.#rotateCompassIcon(h);
  }

  #rotateCompassIcon(heading) {
    const svg = this.compassBtn.querySelector('svg');
    if (svg) svg.style.transform = this.headingUp ? `rotate(${-heading}deg)` : '';
  }

  #updateCompassBtn() {
    this.compassBtn.classList.toggle('is-active', this.headingUp);
    this.compassBtn.setAttribute('aria-pressed', String(this.headingUp));
    this.compassBtn.setAttribute('aria-label', this.headingUp ? t('מפה לפי כיוון ההליכה (לחצו לצפון למעלה)') : t('צפון למעלה (לחצו למצב מצפן)'));
    if (!this.headingUp) this.#rotateCompassIcon(0);
  }

  #follow(pos) {
    const latLng = [pos.lat, pos.lng];
    if (this.headingUp && this.rotator.active) {
      this.rotator.follow(latLng, NAV_ZOOM, window.innerHeight * NAV_USER_SCREEN_OFFSET);
    } else {
      focusPoint(this.map, latLng, { zoom: NAV_ZOOM, occlusion: this.getOcclusion() });
    }
  }

  #renderPreview() {
    this.sheet.renderCustom(
      tpl.routePreviewHtml(this.model, this.dest, { originIsUser: this.originIsUser }),
      `route-preview:${this.dest.id ?? this.dest.name}`
    );
  }

  #renderNav(state) {
    const html = tpl.bannerHtml(state, { rerouting: this.rerouting });
    if (this.banner.innerHTML !== html) this.banner.innerHTML = html;
    this.banner.hidden = false;
    this.sheet.renderCustom(tpl.navPanelHtml(state), 'nav');
  }

  async #acquireWakeLock() {
    // המסך נשאר דולק בזמן ניווט (כמו בכל אפליקציית ניווט) – משוחרר מיד בסיום
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
