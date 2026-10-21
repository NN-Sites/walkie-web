// מסך Walkie Premium: מחיר השקה, פיצ'רים, הצטרפות, ומצב המנוי + הסטטיסטיקה למנויים.

import {
  isPremium, premiumInfo, currentPrice, getPricing, getStats, co2SavedKg, freeLimit, onPremiumChange
} from './premium.js';
import { PREMIUM_FEATURES, formatPrice, formatLaunchEnd } from './pricing.js';
import { purchase, restore, manageSubscription, storePriceLabel, billingAvailable } from './billing.js';
import { showToast, escapeHtml } from './ui.js';
import { icon } from './transit-ui.js';
import { celebrate } from './fx.js';

const REASONS = {
  stops: (n) => `בחשבון החינמי אפשר לשמור עד ${n} תחנות.`,
  lines: (n) => `בחשבון החינמי אפשר לשמור עד ${n} קווים.`,
  places: (n) => `בחשבון החינמי אפשר לשמור עד ${n} מקומות.`,
  stats: () => 'הסטטיסטיקה האישית היא חלק מ-Premium.'
};

const SOURCE_LABEL = { play: 'מנוי Google Play', admin: 'מתנה מצוות Walkie', test: 'מצב בדיקה (פיתוח)' };

const LOGO = `<svg viewBox="60 110 400 290" width="34" height="25" aria-hidden="true"><path d="M112 168 L182 352 L256 224 L330 352 L400 168" fill="none" stroke="#fff" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/><circle cx="400" cy="168" r="46" fill="#f97316" stroke="#fff" stroke-width="16"/></svg>`;

export class PremiumScreen {
  constructor({ getSupportId } = {}) {
    this.el = null;
    this.reason = null;
    this.busy = false;
    this.getSupportId = getSupportId;
    onPremiumChange(() => this.el && this.render());
  }

  get isOpen() {
    return !!this.el;
  }

  open(reason = null) {
    this.reason = reason;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'premium-overlay';
      this.el.setAttribute('role', 'dialog');
      this.el.setAttribute('aria-label', 'Walkie Premium');
      this.el.addEventListener('click', (e) => this.#onClick(e));
      document.body.appendChild(this.el);
    }
    this.render();
  }

  close() {
    this.el?.remove();
    this.el = null;
  }

  render() {
    const info = premiumInfo();
    this.el.innerHTML = `
      <div class="pm-bar">
        <button class="icon-btn" type="button" data-pm="close" aria-label="סגירה">${icon('back', 22)}</button>
      </div>
      <div class="pm-body">
        <div class="pm-hero">
          <span class="pm-logo">${LOGO}</span>
          <h1>Walkie <span>Premium</span></h1>
          ${info.active ? '<p class="pm-sub">תודה שאתם איתנו 💚</p>' : '<p class="pm-sub">יותר זמן אמת, יותר מועדפים, ופחות ניחושים.</p>'}
        </div>
        ${info.active ? this.#activeHtml(info) : this.#offerHtml()}
        ${this.#featuresHtml(info.active)}
        ${info.active ? '' : this.#legalHtml()}
      </div>`;
  }

  #offerHtml() {
    const p = currentPrice();
    const pricing = getPricing();
    const reason = this.reason && REASONS[this.reason] ? `<p class="pm-reason">${REASONS[this.reason](freeLimit(this.reason))}</p>` : '';
    const storeLabel = storePriceLabel();
    return `
      ${reason}
      <div class="pm-price-card">
        ${p.isLaunch ? `<span class="pm-badge">מחיר השקה · ${p.discount}% הנחה</span>` : ''}
        <div class="pm-price">
          <strong>${formatPrice(p.price, pricing)}</strong><span>לחודש</span>
          ${p.isLaunch ? `<s>${formatPrice(p.regular, pricing)}</s>` : ''}
        </div>
        ${p.isLaunch ? `<p class="pm-until">המבצע בתוקף עד ${formatLaunchEnd(pricing)} · ${p.daysLeft === 1 ? 'נשאר יום אחד' : `נשארו ${p.daysLeft} ימים`}</p>` : ''}
        ${storeLabel ? `<p class="pm-store">המחיר ב-Google Play: ${escapeHtml(storeLabel)}</p>` : ''}
        <button class="btn pm-cta" type="button" data-pm="buy" ${this.busy ? 'disabled' : ''}>
          ${this.busy ? 'רגע…' : `הצטרפות ב-${formatPrice(p.price, pricing)} לחודש`}
        </button>
        <button class="pm-link" type="button" data-pm="restore">כבר הצטרפתי – שחזור רכישה</button>
      </div>`;
  }

  #activeHtml(info) {
    const s = getStats();
    const km = (s.walkMeters / 1000).toFixed(1);
    const until = info.source === 'admin'
      ? (info.adminUntil === 'forever' ? 'ללא הגבלת זמן' : `עד ${new Date(info.adminUntil).toLocaleDateString('he-IL')}`)
      : '';
    const supportId = this.getSupportId?.();
    return `
      <div class="pm-status">
        <span class="pm-check">${icon('check', 18)}</span>
        <div><strong>Premium פעיל</strong><span>${SOURCE_LABEL[info.source] ?? ''}${until ? ` · ${until}` : ''}</span></div>
      </div>
      <section class="pm-stats" aria-label="הסטטיסטיקה שלי">
        <h2>הסטטיסטיקה שלי</h2>
        <div class="pm-grid">
          <div><strong>${km}</strong><span>ק"מ ברגל</span></div>
          <div><strong>${s.walks}</strong><span>הליכות</span></div>
          <div><strong>${s.trips}</strong><span>נסיעות</span></div>
          <div><strong>${co2SavedKg(s).toFixed(1)}</strong><span>ק"ג CO₂ נחסכו</span></div>
        </div>
        ${s.since ? `<p class="pm-note">מאז ${new Date(s.since).toLocaleDateString('he-IL')}</p>` : '<p class="pm-note">הנתונים יתחילו להצטבר בהליכה ובנסיעה הבאה.</p>'}
      </section>
      ${info.source === 'admin' ? '' : `<button class="btn-secondary pm-manage" type="button" data-pm="manage">${info.source === 'test' ? 'ביטול מצב בדיקה' : 'ניהול המנוי ב-Google Play'}</button>`}
      ${supportId ? `<p class="pm-note">מזהה תמיכה: <bdi>${escapeHtml(supportId)}</bdi></p>` : ''}`;
  }

  #featuresHtml(active) {
    const row = (f) => `
      <li class="${f.live ? '' : 'is-soon'}">
        <span class="pm-ic">${f.icon}</span>
        <span class="pm-ft"><strong>${escapeHtml(f.title)}</strong><small>${escapeHtml(f.desc)}</small></span>
        ${f.live ? (active ? `<span class="pm-on">${icon('check', 16)}</span>` : '') : '<span class="pm-soon">בקרוב</span>'}
      </li>`;
    return `
      <section class="pm-features" aria-label="מה מקבלים">
        <h2>${active ? 'מה פתוח לך' : 'מה מקבלים'}</h2>
        <ul>${PREMIUM_FEATURES.map(row).join('')}</ul>
        <p class="pm-note">ניווט, זמני הגעה ותכנון מסלולים נשארים חינמיים לכולם, ובלי פרסומות.</p>
      </section>`;
  }

  #legalHtml() {
    const pricing = getPricing();
    const p = currentPrice();
    return `
      <p class="pm-legal">
        המנוי מתחדש אוטומטית כל חודש ונגבה דרך Google Play. אפשר לבטל בכל רגע ב-Google Play ← מינויים, והביטול חל מסוף התקופה ששולמה.
        ${p.isLaunch ? `מחיר ההשקה (${formatPrice(pricing.launch, pricing)} לחודש) בתוקף עד ${formatLaunchEnd(pricing)}. מ-${new Date(p.endsAt).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })} המחיר הוא ${formatPrice(pricing.regular, pricing)} לחודש.` : ''}
      </p>`;
  }

  async #onClick(e) {
    const btn = e.target.closest('[data-pm]');
    if (!btn) return;
    const action = btn.dataset.pm;
    if (action === 'close') return this.close();
    if (this.busy) return;

    try {
      this.busy = true;
      if (action === 'buy') {
        this.render();
        if (!billingAvailable()) throw new Error('התשלום זמין רק באפליקציה שהותקנה מ-Google Play');
        if (await purchase()) {
          celebrate(btn, 48);
          showToast('ברוכים הבאים ל-Premium 💚');
        }
      } else if (action === 'restore') {
        const owned = await restore();
        showToast(owned ? 'המנוי שוחזר 💚' : 'לא נמצא מנוי פעיל בחשבון Google הזה');
      } else if (action === 'manage') {
        await manageSubscription();
      }
    } catch (err) {
      showToast(err?.message || 'משהו השתבש, נסו שוב');
    } finally {
      this.busy = false;
      if (this.el) this.render();
    }
  }
}

/** כרטיס Premium בראש מסך ההגדרות */
export function premiumCardHtml() {
  if (isPremium()) {
    return `
      <button class="pm-card is-active" type="button" data-action="open-premium">
        <span class="pm-card-ic">💚</span>
        <span class="pm-card-text"><strong>Walkie Premium פעיל</strong><small>הסטטיסטיקה שלך וניהול המנוי</small></span>
        ${icon('chevron', 20)}
      </button>`;
  }
  const p = currentPrice();
  const pricing = getPricing();
  return `
    <button class="pm-card" type="button" data-action="open-premium">
      <span class="pm-card-ic">⚡</span>
      <span class="pm-card-text">
        <strong><bdi>Walkie Premium</bdi> ${p.isLaunch ? `<em><bdi>${p.discount}% הנחה</bdi></em>` : ''}</strong>
        <small>${p.isLaunch ? `<b>${formatPrice(p.price, pricing)}</b> <s>${formatPrice(p.regular, pricing)}</s> לחודש · עד ${formatLaunchEnd(pricing)}` : `${formatPrice(p.price, pricing)} לחודש`}</small>
      </span>
      ${icon('chevron', 20)}
    </button>`;
}
