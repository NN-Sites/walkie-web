// באנר פרסומת קבוע בתחתית האפליקציה, מתחת לסרגל הלשוניות (באנר בלבד – אין פרסומות קופצות).
//
// כדי להציג מודעה מרשת פרסום, טוענים אותה אל this.root ב-show(). שאר הלוגיקה (מיקום, גובה,
// הזזת הסרגל והלוח) כבר מוכנה. עד שיחובר ספק פרסום מוצג כאן טקסט זמני.

import { t } from './i18n.js?v=1.9.3-mvps6z6v';

export class AdBanner {
  constructor(root, { onResize }) {
    this.root = root;
    this.onResize = onResize;
    // גובה הבאנר משתנה עם הסתרה / הצגה – הסרגל והלוח צריכים לחשב מחדש
    new ResizeObserver(() => this.onResize?.()).observe(root);
    this.render();
  }

  /** גובה הבאנר בפיקסלים (0 כשהוא מוסתר) */
  get height() {
    return this.root.hidden ? 0 : Math.round(this.root.getBoundingClientRect().height);
  }

  render() {
    this.root.hidden = false;
    document.body.classList.add('has-ad');
    // מקום זמני עד שמחברים מודעת AdMob: מחליפים את התוכן הזה בטעינת המודעה
    this.root.innerHTML = `
      <div class="ad-card">
        <span class="ad-text"><b>${t('Walkie חינמית 💚')}</b><span>${t('תודה שאתם איתנו')}</span></span>
      </div>`;
  }
}
