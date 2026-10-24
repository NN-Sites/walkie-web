// באנר פרסומת קבוע בתחתית האפליקציה, מתחת לסרגל הלשוניות.
//
// כרגע מוצגת מודעה פנימית (קידום Premium / הזמנת חברים). כדי להציג מודעות מרשת פרסום (AdMob וכו'),
// מחליפים את render() בטעינת המודעה אל this.slot. שאר הלוגיקה (מיקום, גובה, הזזת הסרגל והלוח) כבר מוכנה.

import { t } from './i18n.js?v=1.6.0-mvn1g0s1';
import { isPremium, onPremiumChange } from './premium.js?v=1.6.0-mvn1g0s1';

// true = מנויי Premium לא רואים את הבאנר
const HIDE_FOR_PREMIUM = false;

export class AdBanner {
  constructor(root, { openPremium, openInvite, onResize }) {
    this.root = root;
    this.openPremium = openPremium;
    this.openInvite = openInvite;
    this.onResize = onResize;

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ad]');
      if (!btn) return;
      if (btn.dataset.ad === 'premium') this.openPremium?.();
      else this.openInvite?.();
    });

    // גובה הבאנר משתנה עם הסתרה / הצגה – הסרגל והלוח צריכים לחשב מחדש
    new ResizeObserver(() => this.onResize?.()).observe(root);
    onPremiumChange(() => this.render());
    this.render();
  }

  /** גובה הבאנר בפיקסלים (0 כשהוא מוסתר) */
  get height() {
    return this.root.hidden ? 0 : Math.round(this.root.getBoundingClientRect().height);
  }

  render() {
    const premium = isPremium();
    const hidden = HIDE_FOR_PREMIUM && premium;
    this.root.hidden = hidden;
    document.body.classList.toggle('has-ad', !hidden);
    if (hidden) return;

    const [kind, title, sub] = premium
      ? ['invite', t('הזמינו חברים ל-Walkie'), t('כל חבר שמצטרף = יום Premium חינם')]
      : ['premium', t('Walkie Premium'), t('מועדפים ללא הגבלה וזמן אמת מהיר יותר')];

    this.root.innerHTML = `
      <button class="ad-card" type="button" data-ad="${kind}">
        <span class="ad-tag">${t('פרסומת')}</span>
        <span class="ad-text"><b>${title}</b><span>${sub}</span></span>
        <span class="ad-cta">${t('לפרטים')}</span>
      </button>`;
  }
}
