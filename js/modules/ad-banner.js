// באנר פרסומת קבוע בתחתית האפליקציה, מתחת לסרגל הלשוניות (באנר בלבד – אין פרסומות קופצות).
//
// כדי להציג מודעה מרשת פרסום, טוענים אותה אל this.root ב-render(). שאר הלוגיקה (מיקום, גובה,
// הזזת הסרגל והלוח) כבר מוכנה. עד שיחובר ספק פרסום מוצג כאן טקסט זמני.

import { t } from './i18n.js?v=1.10.0-mvu2khrx';
import { perkActive, onPerksChange } from './rewards.js?v=1.10.0-mvu2khrx';

export class AdBanner {
  constructor(root, { onResize }) {
    this.root = root;
    this.onResize = onResize;
    // גובה הבאנר משתנה עם הסתרה / הצגה – הסרגל והלוח צריכים לחשב מחדש
    new ResizeObserver(() => this.onResize?.()).observe(root);
    this.render();
    root.addEventListener('click', () => window.dispatchEvent(new CustomEvent('walkie:open-store')));
    onPerksChange(() => this.render());
    // ההטבה "בלי באנרים" פגה אחרי 12 שעות: בודקים מדי דקה אם הבאנר צריך לחזור
    setInterval(() => {
      if (perkActive('noAds') === this.root.hidden) return;
      this.render();
    }, 60000);
  }

  /** גובה הבאנר בפיקסלים (0 כשהוא מוסתר) */
  get height() {
    return this.root.hidden ? 0 : Math.round(this.root.getBoundingClientRect().height);
  }

  render() {
    if (perkActive('noAds')) {
      this.root.hidden = true;
      this.root.innerHTML = '';
      document.body.classList.remove('has-ad');
      return;
    }
    this.root.hidden = false;
    document.body.classList.add('has-ad');
    // מקום זמני עד שמחברים מודעת AdMob: מחליפים את התוכן הזה בטעינת המודעה
    this.root.innerHTML = `
      <div class="ad-card">
        <span class="ad-text"><b>${t('Walkie חינמית 💚')}</b><span>${t('בלי באנרים ל-12 שעות: לחצו וצפו בפרסומת')}</span></span>
      </div>`;
  }
}
