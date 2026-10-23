// מסך Walkie Premium: מחיר השקה, פיצ'רים, הצטרפות, ומצב המנוי + הסטטיסטיקה למנויים.

import {
  isPremium, premiumInfo, currentPrice, getPricing, getStats, co2SavedKg, freeLimit, onPremiumChange
} from './premium.js?v=1.5.0-mvkwm5k0';
import { PREMIUM_FEATURES, FREE_LIMITS, formatPrice, formatLaunchEnd } from './pricing.js?v=1.5.0-mvkwm5k0';
import { purchase, restore, manageSubscription, storePriceLabel, billingAvailable } from './billing.js?v=1.5.0-mvkwm5k0';
import { showToast, escapeHtml } from './ui.js?v=1.5.0-mvkwm5k0';
import { icon } from './transit-ui.js?v=1.5.0-mvkwm5k0';
import { celebrate } from './fx.js?v=1.5.0-mvkwm5k0';
import { t, LOCALE } from './i18n.js?v=1.5.0-mvkwm5k0';

const REASONS = {
  stops: (n) => t('בחשבון החינמי אפשר לשמור עד {n} תחנות.', { n }),
  lines: (n) => t('בחשבון החינמי אפשר לשמור עד {n} קווים.', { n }),
  places: (n) => t('בחשבון החינמי אפשר לשמור עד {n} מקומות.', { n }),
  stats: () => t('הסטטיסטיקה האישית היא חלק מ-Premium.')
};

const SOURCE_LABEL = { play: 'מנוי Google Play', admin: 'מתנה מצוות Walkie', referral: 'הזמנת חברים', test: 'מצב בדיקה (פיתוח)' };

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
        <button class="icon-btn" type="button" data-pm="close" aria-label="${t('סגירה')}">${icon('back', 22)}</button>
      </div>
      <div class="pm-body">
        <div class="pm-hero">
          <span class="pm-logo">${LOGO}</span>
          <h1>Walkie <span>Premium</span></h1>
          ${info.active ? `<p class="pm-sub">${t('תודה שאתם איתנו 💚')}</p>` : `<p class="pm-sub">${t('יותר זמן אמת, יותר מועדפים, ופחות ניחושים.')}</p>`}
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
        ${p.isLaunch ? `<span class="pm-badge">${t('מחיר השקה')}</span>` : ''}
        <div class="pm-price">
          <strong>${formatPrice(p.price, pricing)}</strong><span>${t('לחודש')}</span>
          ${p.isLaunch ? `<s>${formatPrice(p.regular, pricing)}</s>` : ''}
        </div>
        ${p.isLaunch ? `<p class="pm-until">${t('המבצע בתוקף עד {date}', { date: formatLaunchEnd(pricing) })} · ${p.daysLeft === 1 ? t('נשאר יום אחד') : t('נשארו {n} ימים', { n: p.daysLeft })}</p>` : ''}
        ${storeLabel ? `<p class="pm-store">${t('המחיר ב-Google Play:')} ${escapeHtml(storeLabel)}</p>` : ''}
        <button class="btn pm-cta" type="button" data-pm="buy" ${this.busy ? 'disabled' : ''}>
          ${this.busy ? t('רגע…') : t('הצטרפות ב-{price} לחודש', { price: formatPrice(p.price, pricing) })}
        </button>
        <button class="pm-link" type="button" data-pm="restore">${t('כבר הצטרפתי – שחזור רכישה')}</button>
      </div>`;
  }

  #activeHtml(info) {
    const s = getStats();
    const km = (s.walkMeters / 1000).toFixed(1);
    const until = info.source === 'admin'
      ? (info.adminUntil === 'forever' ? t('ללא הגבלת זמן') : t('עד {date}', { date: new Date(info.adminUntil).toLocaleDateString(LOCALE) }))
      : info.source === 'referral' ? t('עד {date}', { date: new Date(info.refUntil).toLocaleDateString(LOCALE) }) : '';
    const supportId = this.getSupportId?.();
    return `
      <div class="pm-status">
        <span class="pm-check">${icon('check', 18)}</span>
        <div><strong>${t('Premium פעיל')}</strong><span>${SOURCE_LABEL[info.source] ? t(SOURCE_LABEL[info.source]) : ''}${until ? ` · ${until}` : ''}</span></div>
      </div>
      <section class="pm-stats" aria-label="${t('הסטטיסטיקה שלי')}">
        <h2>${t('הסטטיסטיקה שלי')}</h2>
        <div class="pm-grid">
          <div><strong>${km}</strong><span>${t('ק"מ ברגל')}</span></div>
          <div><strong>${s.walks}</strong><span>${t('הליכות')}</span></div>
          <div><strong>${s.trips}</strong><span>${t('נסיעות')}</span></div>
          <div><strong>${co2SavedKg(s).toFixed(1)}</strong><span>${t('ק"ג CO₂ נחסכו')}</span></div>
        </div>
        ${s.since ? `<p class="pm-note">${t('מאז {date}', { date: new Date(s.since).toLocaleDateString(LOCALE) })}</p>` : `<p class="pm-note">${t('הנתונים יתחילו להצטבר בהליכה ובנסיעה הבאה.')}</p>`}
      </section>
      ${info.source === 'admin' || info.source === 'referral' ? '' : `<button class="btn-secondary pm-manage" type="button" data-pm="manage">${info.source === 'test' ? t('ביטול מצב בדיקה') : t('ניהול המנוי ב-Google Play')}</button>`}
      ${supportId ? `<p class="pm-note">${t('מזהה תמיכה:')} <bdi>${escapeHtml(supportId)}</bdi></p>` : ''}`;
  }

  #featuresHtml(active) {
    const row = (f) => `
      <li class="${f.live ? '' : 'is-soon'}">
        <span class="pm-ic">${f.icon}</span>
        <span class="pm-ft"><strong>${escapeHtml(t(f.title))}</strong><small>${escapeHtml(f.id === 'unlimited' ? t('תחנות, קווים ומקומות כמה שרוצים (בחינם: {n} מכל סוג)', { n: FREE_LIMITS.stops }) : t(f.desc))}</small></span>
        ${f.live ? (active ? `<span class="pm-on">${icon('check', 16)}</span>` : '') : `<span class="pm-soon">${t('בקרוב')}</span>`}
      </li>`;
    return `
      <section class="pm-features" aria-label="${t('מה מקבלים')}">
        <h2>${active ? t('מה פתוח לך') : t('מה מקבלים')}</h2>
        <ul>${PREMIUM_FEATURES.map(row).join('')}</ul>
        <p class="pm-note">${t('ניווט, זמני הגעה ותכנון מסלולים נשארים חינמיים לכולם, ובלי פרסומות.')}</p>
      </section>`;
  }

  #legalHtml() {
    const pricing = getPricing();
    const p = currentPrice();
    return `
      <p class="pm-legal">
        ${t('המנוי מתחדש אוטומטית כל חודש ונגבה דרך Google Play. אפשר לבטל בכל רגע ב-Google Play ← מינויים, והביטול חל מסוף התקופה ששולמה.')}
        ${p.isLaunch ? t('מחיר ההשקה ({launch} לחודש) בתוקף עד {end}. מ-{from} המחיר הוא {regular} לחודש.', { launch: formatPrice(pricing.launch, pricing), end: formatLaunchEnd(pricing), from: new Date(p.endsAt).toLocaleDateString(LOCALE, { timeZone: 'Asia/Jerusalem' }), regular: formatPrice(pricing.regular, pricing) }) : ''}
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
        if (!billingAvailable()) throw new Error(t('התשלום זמין רק באפליקציה שהותקנה מ-Google Play'));
        if (await purchase()) {
          celebrate(btn, 48);
          showToast(t('ברוכים הבאים ל-Premium 💚'));
        }
      } else if (action === 'restore') {
        const owned = await restore();
        showToast(owned ? t('המנוי שוחזר 💚') : t('לא נמצא מנוי פעיל בחשבון Google הזה'));
      } else if (action === 'manage') {
        await manageSubscription();
      }
    } catch (err) {
      showToast(err?.message || t('משהו השתבש, נסו שוב'));
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
        <span class="pm-card-text"><strong>${t('Walkie Premium פעיל')}</strong><small>${t('הסטטיסטיקה שלך וניהול המנוי')}</small></span>
        ${icon('chevron', 20)}
      </button>`;
  }
  const p = currentPrice();
  const pricing = getPricing();
  return `
    <button class="pm-card" type="button" data-action="open-premium">
      <span class="pm-card-ic">⚡</span>
      <span class="pm-card-text">
        <strong><bdi>Walkie Premium</bdi></strong>
        <small>${p.isLaunch ? `<b>${formatPrice(p.price, pricing)}</b> <s>${formatPrice(p.regular, pricing)}</s> ${t('לחודש')} · ${t('עד {date}', { date: formatLaunchEnd(pricing) })}` : `${formatPrice(p.price, pricing)} ${t('לחודש')}`}</small>
      </span>
      ${icon('chevron', 20)}
    </button>`;
}
