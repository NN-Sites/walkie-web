// באנר פרסומת קבוע בתחתית האפליקציה, מתחת לסרגל הלשוניות (באנר בלבד – אין פרסומות קופצות).
//
// כדי להציג מודעה מרשת פרסום, טוענים אותה אל this.root ב-show(). שאר הלוגיקה (מיקום, גובה,
// הזזת הסרגל והלוח) כבר מוכנה. עד שיחובר ספק פרסום מוצג כאן טקסט זמני.

import { t } from './i18n.js?v=1.10.0-mvsf7kai';
import { adFreeUnlocked, onReferralChange } from './referrals.js?v=1.10.0-mvsf7kai';

export class AdBanner {
  constructor(root, { onResize }) {
    this.root = root;
    this.onResize = onResize;
    // גובה הבאנר משתנה עם הסתרה / הצגה – הסרגל והלוח צריכים לחשב מחדש
    new ResizeObserver(() => this.onResize?.()).observe(root);
    this.render();
    onReferralChange(() => this.render());
    // הפרס פג אחרי שבוע: בודקים מדי דקה אם הבאנר צריך לחזור
    setInterval(() => {
      if (adFreeUnlocked() === this.root.hidden) return;
      this.render();
    }, 60000);
  }

  /** גובה הבאנר בפיקסלים (0 כשהוא מוסתר) */
  get height() {
    return this.root.hidden ? 0 : Math.round(this.root.getBoundingClientRect().height);
  }

  render() {
    // פרס הזמנת חברים: 10 חברים = בלי באנר
    if (adFreeUnlocked()) {
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
        <span class="ad-text"><b>${t('Walkie חינמית 💚')}</b><span>${t('תודה שאתם איתנו')}</span></span>
      </div>`;
  }
}
