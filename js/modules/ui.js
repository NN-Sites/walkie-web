// רכיבי ממשק: לוח תחתון נגרר (Bottom Sheet) עם נקודות עצירה, ו-Toast.

import { SHEET_PEEK_PX, SHEET_HALF_RATIO, SHEET_FULL_RATIO } from '../config.js?v=1.5.0-mvktfm7l';
import { formatDistance, walkMinutes } from './geo.js?v=1.5.0-mvktfm7l';
import { lineColor } from './stops.js?v=1.5.0-mvktfm7l';
import { groupArrivals } from './arrivals.js?v=1.5.0-mvktfm7l';
import { starButton } from './favorites-ui.js?v=1.5.0-mvktfm7l';
import { t } from './i18n.js?v=1.5.0-mvktfm7l';

const ICONS = {
  bus: (s = 18) =>
    `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path fill="currentColor" d="M4 16c0 .9.4 1.7 1 2.2V20c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1h8v1c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1.8c.6-.5 1-1.3 1-2.2V6c0-3.5-3.6-4-8-4S4 2.5 4 6v10Zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM18 11H6V6h12v5Z"/></svg>`,
  walk:
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5 0-.8.1L6 8.3V13h2V9.6l1.8-.7"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7Z"/></svg>',
  cloudOff:
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M19.4 10A7.5 7.5 0 0 0 6.6 6.9L8 8.4A5.5 5.5 0 0 1 17.5 12v.5H19a2.5 2.5 0 0 1 1.3 4.6l1.4 1.5A4.5 4.5 0 0 0 19.4 10ZM3 5.3l2.8 2.7A6 6 0 0 0 6 20h11.7l2 2 1.3-1.3L4.3 4 3 5.3ZM7.7 10l8 8H6a4 4 0 0 1 0-8h1.7Z"/></svg>',
  pin:
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/></svg>'
};

const MODE_ICON_SM = {
  rail: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2C8 2 4 2.5 4 6v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5v.5h2.2l2-2h3.6l2 2H18v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-3.6-4-8-4ZM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3.5-7H6V6h5v4Zm2 0V6h5v4h-5Zm3.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/></svg>'
};

const SOURCE_CHIPS = {
  osm: () => '<span class="chip">OpenStreetMap</span>',
  demo: () => `<span class="chip chip-warn">${t('תחנות דמה')}</span>`
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * הודעת שבת / חג / ערב שבת (service-calendar.js -> serviceNotice).
 * notice = { tone: 'rest' | 'erev' | 'resuming', title, text }
 */
export function serviceNoticeHtml(notice) {
  if (!notice) return '';
  const emoji = notice.tone === 'rest' ? '🕯️' : notice.tone === 'erev' ? '⏳' : '🚌';
  return `
    <div class="service-notice is-${notice.tone}" role="status">
      <span class="service-notice-icon" aria-hidden="true">${emoji}</span>
      <div class="service-notice-text"><strong>${escapeHtml(notice.title)}</strong><span>${escapeHtml(notice.text)}</span></div>
    </div>`;
}

// ---------- Toast ----------

let toastTimer = null;

export function showToast(message, durationMs = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), durationMs);
}

// ---------- Bottom sheet ----------

const SNAP_ORDER = ['peek', 'half', 'full'];

export class Sheet {
  constructor(root, { onSelectStop, onRetryLocation, onSnapChange, onAction, getBottomInset = () => 0 }) {
    this.root = root;
    this.content = root.querySelector('#sheet-content');
    this.handle = root.querySelector('.sheet-handle');
    this.onSelectStop = onSelectStop;
    this.onRetryLocation = onRetryLocation;
    this.onSnapChange = onSnapChange;
    this.onAction = onAction;
    // מקום שתופס סרגל הניווט התחתון (הלוח יושב מעליו)
    this.getBottomInset = getBottomInset;

    this.desktopQuery = window.matchMedia('(min-width: 768px)');
    this.snap = 'half';
    this.visible = 0;
    this.snaps = { peek: 0, half: 0, full: 0 };
    this.drag = null;
    this.suppressClick = false;
    this.rafId = 0;
    this.lastHtml = '';
    this.lastFocusKey = null;

    this.#computeSnaps();
    this.setSnap('half', { animate: false });

    window.addEventListener('resize', this.#onResize, { passive: true });
    this.desktopQuery.addEventListener('change', this.#onResize);

    this.handle.addEventListener('click', () => {
      if (this.suppressClick) return;
      const next = this.snap === 'full' ? 'half' : SNAP_ORDER[SNAP_ORDER.indexOf(this.snap) + 1];
      this.setSnap(next);
    });

    // pointerdown על הלוח; move/up על window – כדי שגרירה בעכבר תמשיך גם כשהסמן יוצא מהלוח
    root.addEventListener('pointerdown', this.#onPointerDown);

    // אחרי גרירה – לא להפעיל לחיצה בטעות על כפתור שמתחת לאצבע
    root.addEventListener(
      'click',
      (e) => {
        if (this.suppressClick) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true
    );

    this.content.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'select-stop') this.onSelectStop(target.dataset.stopId);
      else if (action === 'retry-location') this.onRetryLocation();
      else this.onAction?.(action, target.dataset);
    });
  }

  get isDesktop() {
    return this.desktopQuery.matches;
  }

  /** כמה פיקסלים של המפה מוסתרים ע"י הלוח */
  occlusion() {
    if (this.isDesktop) {
      const rect = this.root.getBoundingClientRect();
      return { bottom: 0, right: rect.width + 16 };
    }
    return { bottom: this.visible + this.getBottomInset(), right: 0 };
  }

  /** לחישוב מחדש כשסרגל הניווט מופיע/נעלם */
  refreshLayout() {
    this.#onResize();
  }

  setSnap(name, { animate = true } = {}) {
    if (!this.snaps[name]) return;
    this.snap = name;
    this.root.dataset.snap = name;

    if (!animate) this.root.classList.add('is-dragging');
    this.#applyVisible(this.snaps[name]);
    if (!animate) {
      requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.remove('is-dragging')));
    }

    if (name !== 'full') this.content.scrollTop = 0;
    this.handle.setAttribute('aria-expanded', String(name === 'full'));
    this.onSnapChange?.(name);
  }

  /** אם הלוח מכווץ לגמרי – פותחים לחצי כדי שהתוכן החדש ייראה */
  reveal() {
    if (!this.isDesktop && this.snap === 'peek') this.setSnap('half');
  }

  #computeSnaps() {
    const h = window.innerHeight - this.getBottomInset();
    this.snaps = {
      peek: SHEET_PEEK_PX,
      half: Math.round(h * SHEET_HALF_RATIO),
      full: Math.round(h * SHEET_FULL_RATIO)
    };
    document.documentElement.style.setProperty('--sheet-max', `${this.snaps.full}px`);
  }

  #applyVisible(px) {
    this.visible = px;
    const rootStyle = document.documentElement.style;
    if (this.isDesktop) rootStyle.removeProperty('--sheet-visible');
    else rootStyle.setProperty('--sheet-visible', `${Math.round(px)}px`);
    document.body.classList.toggle('sheet-full', !this.isDesktop && px > (window.innerHeight - this.getBottomInset()) * 0.7);
  }

  #onResize = () => {
    this.#computeSnaps();
    this.setSnap(this.snap, { animate: false });
  };

  // ----- גרירה -----

  #onPointerDown = (e) => {
    if (this.isDesktop || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const inGrab = !!e.target.closest('.sheet-grab');
    if (this.snap === 'full' && !inGrab && this.content.scrollTop > 0) return;

    this.drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startVisible: this.visible,
      current: this.visible,
      active: false,
      inGrab,
      samples: [{ y: e.clientY, t: e.timeStamp }]
    };
    this.#listenWindow(true);
  };

  #listenWindow(on) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('pointermove', this.#onPointerMove, { passive: false });
    window[method]('pointerup', this.#onPointerUp);
    window[method]('pointercancel', this.#onPointerUp);
  }

  #onPointerMove = (e) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;

    const dy = e.clientY - d.startY;
    const dx = e.clientX - d.startX;

    if (!d.active) {
      if (Math.abs(dy) < 6 || Math.abs(dy) < Math.abs(dx)) return;
      // במצב מלא התוכן נגלל – גוררים רק מהידית או כלפי מטה מראש התוכן
      if (this.snap === 'full' && !d.inGrab && (dy < 0 || this.content.scrollTop > 0)) {
        this.drag = null;
        this.#listenWindow(false);
        return;
      }
      d.active = true;
      try {
        this.root.setPointerCapture(e.pointerId);
      } catch {
        // מצביע שכבר שוחרר – ממשיכים בלי capture
      }
      this.root.classList.add('is-dragging');
      document.body.classList.add('sheet-dragging');
    }

    e.preventDefault();

    let next = d.startVisible - dy;
    const { peek, full } = this.snaps;
    if (next > full) next = full + (next - full) * 0.2;              // אפקט גומי למעלה
    if (next < peek) next = peek - (peek - next) * 0.35;             // ולמטה

    d.current = next;
    d.samples.push({ y: e.clientY, t: e.timeStamp });
    if (d.samples.length > 6) d.samples.shift();

    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        if (!this.drag) return;
        const offset = this.snaps.full - this.drag.current;
        this.root.style.transform = `translate3d(0, ${offset}px, 0)`;
      });
    }
  };

  #onPointerUp = (e) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    this.#listenWindow(false);
    if (!d.active) return;

    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    try {
      if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    // מהירות (פיקסלים/מ"ש, חיובי = למעלה) והקרנה קדימה לבחירת נקודת עצירה טבעית
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const dt = Math.max(1, last.t - first.t);
    const velocity = (first.y - last.y) / dt;
    const projected = d.current + velocity * 200;

    let best = 'half';
    let bestDist = Infinity;
    for (const name of SNAP_ORDER) {
      const dist = Math.abs(this.snaps[name] - projected);
      if (dist < bestDist) {
        bestDist = dist;
        best = name;
      }
    }

    this.root.style.transform = '';
    this.root.classList.remove('is-dragging');
    document.body.classList.remove('sheet-dragging');
    this.setSnap(best);

    this.suppressClick = true;
    setTimeout(() => {
      this.suppressClick = false;
    }, 0);
  };

  // ----- רינדור תוכן -----

  /** תוכן חופשי (מסך מסלול/ניווט). key משמש לזיהוי מעבר מסך לצורך אנימציה */
  renderCustom(html, key) {
    this.#commit(html, key);
  }

  renderLoading() {
    this.#commit(
      `<div class="skeleton">
        <div class="sk-line sk-short"></div>
        <div class="sk-line sk-title"></div>
        <div class="sk-card"></div>
        <div class="sk-card"></div>
      </div>`,
      'loading'
    );
  }

  render(model) {
    const { focused, loading, locationDenied } = model;
    const parts = [];

    // שבת / חג: ההודעה הכי חשובה במסך – מעל הכל
    if (model.serviceNotice) parts.push(serviceNoticeHtml(model.serviceNotice));

    if (locationDenied) {
      parts.push(`
        <div class="notice">
          <div class="notice-text"><strong>${t('המיקום כבוי.')}</strong> ${t('מציגים תחנות סביב מרכז המפה.')}</div>
          <button class="btn" type="button" data-action="retry-location">${t('הפעלת מיקום')}</button>
        </div>`);
    }

    if (!focused && loading) {
      parts.push(`
        <div class="skeleton">
          <div class="sk-line sk-short"></div>
          <div class="sk-line sk-title"></div>
          <div class="sk-card"></div>
          <div class="sk-card"></div>
        </div>`);
      this.#commit(parts.join(''), 'loading');
      return;
    }

    if (!focused) {
      parts.push(`<div class="empty">${t('לא נמצאו תחנות באזור הזה.')}<br>${t('אפשר להזיז את המפה כדי לחפש.')}</div>`);
      this.#commit(parts.join(''), 'empty');
      return;
    }

    parts.push(this.#header(model));
    parts.push(this.#arrivalsSection(model.arrivalsState));

    if (model.favorites?.length) parts.push(this.#favoritesSection(model.favorites));

    if (model.others.length > 0) {
      parts.push(`
        <h3 class="section-title">${t('תחנות נוספות בסביבה')}</h3>
        <ul class="nearby">${model.others.map((s) => this.#nearbyRow(s)).join('')}</ul>
      `);
    }

    this.#commit(parts.join(''), focused.id);
  }

  // מחליף DOM רק אם משהו השתנה, ומנפיש כניסה רק כשעוברים לתחנה אחרת
  #commit(html, focusKey) {
    if (html === this.lastHtml) return;
    this.lastHtml = html;

    const isNewFocus = focusKey !== this.lastFocusKey;
    this.lastFocusKey = focusKey;

    this.content.innerHTML = isNewFocus ? `<div class="content-enter">${html}</div>` : `<div>${html}</div>`;
    if (isNewFocus) this.content.scrollTop = 0;
  }

  #header({ focused, isNearest, hasUserLocation, source, isFavStop }) {
    const eyebrow = isNearest
      ? hasUserLocation ? t('התחנה הקרובה אליך') : t('התחנה הקרובה למרכז המפה')
      : t('תחנה נבחרת');

    const meta = [
      `<span class="meta-pill">${ICONS.walk}<strong>${t('{n} דק\'', { n: walkMinutes(focused.distance) })}</strong> · ${formatDistance(focused.distance)}</span>`,
      focused.code ? `<span class="meta-pill">${t('קוד {code}', { code: escapeHtml(focused.code) })}</span>` : '',
      focused.city ? `<span class="meta-pill">${escapeHtml(focused.city)}</span>` : ''
    ].filter(Boolean);

    return `
      <div class="stop-head">
        <div class="stop-head-icon${isNearest ? '' : ' is-focused'}">${focused.mode === 'rail' ? MODE_ICON_SM.rail : ICONS.bus(22)}</div>
        <div class="stop-head-text">
          <p class="eyebrow">${eyebrow} ${SOURCE_CHIPS[source]?.() ?? ''}</p>
          <h2 class="stop-title">${escapeHtml(focused.name)}</h2>
        </div>
      </div>
      <div class="stop-meta">${meta.join('')}</div>
      <div class="stop-actions">
        <button class="btn-secondary btn-walk" type="button" data-action="walk-to-stop" data-stop-id="${escapeHtml(focused.id)}">
          ${ICONS.walk} ${t('ניווט רגלי לתחנה')}
        </button>
        ${focused.code ? starButton({ on: !!isFavStop, action: 'toggle-fav-stop', data: { 'stop-id': focused.id }, label: t('שמירת התחנה') }) : ''}
      </div>
    `;
  }

  #arrivalsSection(state) {
    let chip = '';
    if (state?.demo) chip = `<span class="chip chip-warn">${t('זמנים לדוגמה')}</span>`;
    else if (state?.live && state.arrivals) chip = `<span class="chip chip-live"><span class="live-dot"></span>${t('זמן אמת')}</span>`;

    const title = `<h3 class="section-title"><span>${t('הגעות קרובות')}</span>${chip}</h3>`;

    if (!state || state.status === 'unsupported') {
      return `${title}${this.#stateBox(ICONS.pin, t('לתחנה הזו אין קוד של משרד התחבורה, ולכן אין לה זמני הגעה.'))}`;
    }

    if (!state.arrivals) {
      if (state.status === 'error') {
        return `${title}${this.#stateBox(ICONS.cloudOff, t('זמני ההגעה לא זמינים כרגע. ננסה שוב בעוד רגע.'))}`;
      }
      return `${title}<div class="skeleton"><div class="sk-row"></div><div class="sk-row"></div><div class="sk-row"></div></div>`;
    }

    const groups = groupArrivals(state.arrivals);
    if (groups.length === 0) {
      return `${title}${this.#stateBox(ICONS.clock, t('אין כרגע אוטובוסים בדרך לתחנה הזו.'))}`;
    }

    return `${title}<ul class="arrivals">${groups.map((g) => this.#arrivalRow(g, state.live)).join('')}</ul>`;
  }

  /** "התחנות שלי": תחנות מועדפות עם היציאות הבאות */
  #favoritesSection(favorites) {
    const rows = favorites.map(({ stop, state }) => {
      let body;
      if (!state || (!state.arrivals && state.status !== 'error')) {
        body = `<span class="fav-dep-muted">${t('טוען…')}</span>`;
      } else if (!state.arrivals?.length) {
        body = `<span class="fav-dep-muted">${state.status === 'error' ? t('לא זמין כרגע') : t('אין יציאות קרובות')}</span>`;
      } else {
        body = groupArrivals(state.arrivals).slice(0, 3).map((g) => {
          const m = g.minutes[0];
          const color = g.mode === 'rail' ? '#1e3a8a' : g.mode === 'lightrail' ? '#dc2626' : lineColor(g.line, g.agency);
          return `<span class="fav-dep"><b style="background:${color}">${g.mode === 'rail' ? t('רכבת') : escapeHtml(g.line)}</b>${m === 0 ? t('עכשיו') : t('{n} דק\'', { n: m })}${g.live ? '<i class="live-dot"></i>' : ''}</span>`;
        }).join('');
      }
      return `
        <li class="fav-stop">
          <button class="fav-stop-main" type="button" data-action="fav-stop-walk" data-code="${escapeHtml(stop.code)}">
            <span class="fav-stop-name">⭐ ${escapeHtml(stop.name)}</span>
            <span class="fav-deps">${body}</span>
          </button>
        </li>`;
    }).join('');
    return `<h3 class="section-title">${t('התחנות שלי')}</h3><ul class="fav-stops">${rows}</ul>`;
  }

  #stateBox(icon, text) {
    return `<div class="state-box">${icon}<span>${text}</span></div>`;
  }

  #arrivalRow(g, sectionLive) {
    const [first, ...rest] = g.minutes;
    const live = g.live ?? sectionLive;
    const isRail = g.mode === 'rail';
    const dest = g.destination ? t('לכיוון {dest}', { dest: escapeHtml(g.destination) }) : t('קו {line}', { line: escapeHtml(g.line) });
    const subParts = [];
    if (rest.length) subParts.push(t('גם בעוד {list} דק\'', { list: rest.join(', ') }));
    if (isRail && g.trainNumber) subParts.push(t('רכבת {n}', { n: escapeHtml(g.trainNumber) }));
    if (g.agency) subParts.push(escapeHtml(g.agency));
    if (!live) subParts.push(t('לפי לוח זמנים'));

    const eta =
      first === 0
        ? `<div class="arrival-eta is-now"><span class="eta-num">${t('עכשיו')}</span></div>`
        : `<div class="arrival-eta${live ? ' is-live' : ''}"><span class="eta-num">${first}</span><span class="eta-unit">${t('דק\'')}</span></div>`;

    const badgeColor = isRail ? '#1e3a8a' : g.mode === 'lightrail' ? '#dc2626' : lineColor(g.line, g.agency);
    const badgeText = isRail ? `${MODE_ICON_SM.rail}` : escapeHtml(g.line);

    return `
      <li class="arrival">
        <span class="line-badge${isRail ? ' is-rail' : ''}" style="background:${badgeColor}">${badgeText}</span>
        <div class="arrival-body">
          <div class="arrival-dest">${dest}</div>
          ${subParts.length ? `<div class="arrival-sub">${subParts.join(' · ')}</div>` : ''}
        </div>
        ${eta}
      </li>`;
  }

  #nearbyRow(s) {
    const sub = s.routes?.length
      ? t('קווים: {list}', { list: escapeHtml(s.routes.slice(0, 6).join(', ')) })
      : [s.code ? t('קוד {code}', { code: escapeHtml(s.code) }) : '', s.city ? escapeHtml(s.city) : ''].filter(Boolean).join(' · ');

    return `
      <li>
        <button class="nearby-item" type="button" data-action="select-stop" data-stop-id="${escapeHtml(s.id)}">
          <span class="nearby-icon">${ICONS.bus(18)}</span>
          <span class="nearby-text">
            <span class="nearby-name">${escapeHtml(s.name)}</span>
            ${sub ? `<span class="nearby-sub">${sub}</span>` : ''}
          </span>
          <span class="nearby-dist">${formatDistance(s.distance)}<small>${t('{n} דק\' הליכה', { n: walkMinutes(s.distance) })}</small></span>
        </button>
      </li>`;
  }
}
