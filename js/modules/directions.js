// כותרת "מסלול": מוצא -> יעד, לשוניות (תחבורה ציבורית / הליכה), זמן יציאה/הגעה, החלפת כיוון.
// מתזמר בין RouteController (הליכה) ל-TransitController (תחבורה ציבורית).

import { distanceMeters } from './geo.js?v=1.5.0-mvks4yx4';
import { showToast } from './ui.js?v=1.5.0-mvks4yx4';
import { togglePlace, isPlaceSaved, onFavoritesChange } from './favorites.js?v=1.5.0-mvks4yx4';
import { STAR_ON, STAR_OFF } from './favorites-ui.js?v=1.5.0-mvks4yx4';
import { t as tr, LOCALE } from './i18n.js?v=1.5.0-mvks4yx4';

export const MY_LOCATION = Object.freeze({ id: 'my-location', kind: 'mylocation', name: tr('המיקום שלי') });

const WALK_DEFAULT_M = 900;   // יעד קרוב מזה – לשונית הליכה כברירת מחדל
const TZ = 'Asia/Jerusalem';

function fmtMinutes(seconds) {
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? tr('{n} דק\'', { n: m }) : tr('{h}:{mm} ש\'', { h: Math.floor(m / 60), mm: String(m % 60).padStart(2, '0') });
}

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export class DirectionsController {
  constructor({ root, search, walk, transit, getUserLocation, getFallbackPoint, onOpen, onClose }) {
    this.root = root;
    this.search = search;
    this.walk = walk;
    this.transit = transit;
    this.getUserLocation = getUserLocation;
    this.getFallbackPoint = getFallbackPoint;
    this.onOpen = onOpen;
    this.onClose = onClose;

    this.active = false;
    this.origin = MY_LOCATION;
    this.dest = null;
    this.tab = 'transit';
    this.when = { type: 'depart', time: null };
    this.times = { transit: null, walk: null };

    this.el = {
      origin: root.querySelector('#dir-origin'),
      dest: root.querySelector('#dir-dest'),
      transitTime: root.querySelector('#dir-transit-time'),
      walkTime: root.querySelector('#dir-walk-time'),
      timeBtn: root.querySelector('#dir-time'),
      timePanel: root.querySelector('#dir-time-panel'),
      timeInput: root.querySelector('#dir-time-input'),
      tabs: [...root.querySelectorAll('[data-tab]')],
      whenBtns: [...root.querySelectorAll('[data-when]')],
      favBtn: root.querySelector('[data-dir="fav"]')
    };
    onFavoritesChange(() => this.#renderFav());
    this.pendingWhenType = 'depart';

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dir], [data-tab], [data-when]');
      if (!btn) return;
      if (btn.dataset.tab) return this.setTab(btn.dataset.tab);
      if (btn.dataset.when) return this.#setPendingWhen(btn.dataset.when);
      switch (btn.dataset.dir) {
        case 'close': return this.close();
        case 'origin': return this.#pick('origin');
        case 'destination': return this.#pick('destination');
        case 'swap': return this.swap();
        case 'fav': return this.#toggleFav();
        case 'time': return this.#toggleTimePanel();
        case 'time-now': return this.#applyTime(null);
        case 'time-apply': return this.#applyTime(this.el.timeInput.value);
        default: return undefined;
      }
    });
  }

  get isActive() {
    return this.active;
  }

  /** גובה הכותרת – כדי שהמפה תמרכז מתחתיה */
  get height() {
    return this.active ? this.root.getBoundingClientRect().bottom : 0;
  }

  open(dest, { tab = null, origin = MY_LOCATION } = {}) {
    this.dest = dest;
    this.origin = origin;
    this.when = { type: 'depart', time: null };
    this.times = { transit: null, walk: null };

    const from = this.#resolve(this.origin);
    const far = from && distanceMeters(from, dest) > WALK_DEFAULT_M;
    this.tab = tab ?? (far ? 'transit' : 'walk');

    if (!this.active) {
      this.active = true;
      this.root.hidden = false;
      document.body.classList.add('has-route');
      this.onOpen?.();
    }
    this.#renderHeader();
    this.run();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.walk.exit({ silent: true });
    this.transit.exit({ silent: true });
    this.root.hidden = true;
    this.el.timePanel.hidden = true;
    document.body.classList.remove('has-route');
    this.onClose?.();
  }

  setTab(tab) {
    if (tab === this.tab) return;
    this.tab = tab;
    this.#renderHeader();
    this.run();
  }

  swap() {
    [this.origin, this.dest] = [this.dest, this.origin];
    this.#renderHeader();
    this.run();
  }

  /** מריץ את החיפוש בלשונית הפעילה */
  run() {
    const origin = this.#resolve(this.origin);
    const dest = this.#resolve(this.dest);
    if (!origin || !dest) {
      showToast(tr('אין מיקום GPS – בחרו נקודת מוצא'));
      return;
    }

    if (this.tab === 'walk') {
      this.transit.exit({ silent: true });
      this.walk.planTo(dest, { origin });
    } else {
      this.walk.exit({ silent: true });
      this.transit.plan({ origin, dest, when: this.when });
    }
  }

  /** זמנים בלשוניות (מגיעים מהבקרים אחרי חישוב) */
  setTabTime(tab, seconds) {
    this.times[tab] = seconds;
    this.#renderHeader();
  }

  /** אירועי מצב מהבקרים. idle שלא שקט (סגירה/סיום ע"י המשתמש) סוגר את כל המסלול */
  onChildMode(kind, mode) {
    if (!this.active) return;
    if (mode === 'idle') this.close();
  }

  // ---------- פנימי ----------

  #resolve(place) {
    if (!place) return null;
    if (place.kind === 'mylocation') {
      const user = this.getUserLocation();
      if (user) return { lat: user.lat, lng: user.lng, name: tr('המיקום שלי'), isUser: true };
      const fb = this.getFallbackPoint();
      return fb ? { ...fb, name: tr('מרכז המפה'), isUser: false } : null;
    }
    return { ...place, isUser: false };
  }

  #pick(which) {
    this.search.open({
      purpose: which,
      includeMyLocation: true,
      placeholder: which === 'origin' ? tr('מאיפה יוצאים?') : tr('לאן הולכים?'),
      onPick: (place) => {
        if (which === 'origin') this.origin = place;
        else this.dest = place;
        this.#renderHeader();
        this.run();
      }
    });
  }

  #toggleTimePanel() {
    const panel = this.el.timePanel;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      this.#setPendingWhen(this.when.type);
      this.el.timeInput.value = toLocalInputValue(this.when.time ?? new Date());
    }
  }

  #setPendingWhen(type) {
    this.pendingWhenType = type;
    for (const b of this.el.whenBtns) b.classList.toggle('is-active', b.dataset.when === type);
  }

  #applyTime(value) {
    this.el.timePanel.hidden = true;
    if (!value) {
      this.when = { type: 'depart', time: null };
    } else {
      const t = new Date(value);
      this.when = Number.isFinite(t.getTime()) ? { type: this.pendingWhenType, time: t } : { type: 'depart', time: null };
    }
    this.#renderHeader();
    if (this.tab === 'transit') this.run();
    else if (this.when.time) {
      // בהליכה הזמן לא משנה את המסלול – עוברים לתחבורה ציבורית שבה הוא כן רלוונטי
      this.setTab('transit');
    }
  }

  #timeLabel() {
    if (!this.when.time) return tr('יציאה עכשיו');
    const t = this.when.time;
    const time = t.toLocaleTimeString(LOCALE, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    const today = new Date().toLocaleDateString('he-IL', { timeZone: TZ });
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('he-IL', { timeZone: TZ });
    const day = t.toLocaleDateString('he-IL', { timeZone: TZ });
    const dayLabel = day === today ? '' : day === tomorrow ? `${tr('מחר')} ` : `${t.toLocaleDateString(LOCALE, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric' })} `;
    return `${this.when.type === 'arrive' ? tr('הגעה עד') : tr('יציאה ב')} ${dayLabel}${time}`;
  }

  #toggleFav() {
    const place = this.dest?.kind === 'mylocation' ? this.origin : this.dest;
    if (!place || place.kind === 'mylocation') return;
    const saved = togglePlace(place);
    if (saved === null) return; // מגבלת החשבון החינמי – נפתח מסך הפרימיום
    showToast(saved ? tr('{name} נשמר במועדפים ⭐', { name: place.name }) : tr('הוסר מהמועדפים'));
  }

  #renderFav() {
    const place = this.dest?.kind === 'mylocation' ? this.origin : this.dest;
    const btn = this.el.favBtn;
    if (!btn) return;
    const can = place && place.kind !== 'mylocation';
    btn.hidden = !can;
    const on = can && isPlaceSaved(place);
    btn.classList.toggle('is-on', !!on);
    btn.setAttribute('aria-pressed', String(!!on));
    btn.innerHTML = on ? STAR_ON : STAR_OFF;
  }

  #renderHeader() {
    this.#renderFav();
    this.el.origin.textContent = this.origin?.name ?? '';
    this.el.dest.textContent = this.dest?.name ?? '';
    this.el.transitTime.textContent = this.times.transit ? fmtMinutes(this.times.transit) : tr('תחבורה ציבורית');
    this.el.walkTime.textContent = this.times.walk ? fmtMinutes(this.times.walk) : tr('הליכה');
    for (const t of this.el.tabs) {
      const on = t.dataset.tab === this.tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    }
    this.el.timeBtn.textContent = this.#timeLabel();
    this.el.timeBtn.classList.toggle('is-set', !!this.when.time);
  }
}
