// סרגל ניווט תחתון: בית | קווים | תחנות | תודות | הגדרות

import { vibrate } from './settings.js?v=1.9.1-mvprvblb';

export class TabBar {
  constructor(root, { onChange, getExtraBottom = () => 0 }) {
    this.root = root;
    this.onChange = onChange;
    this.getExtraBottom = getExtraBottom;
    this.buttons = [...root.querySelectorAll('[data-tab]')];
    this.active = 'home';
    this.hidden = false;

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      // לחיצה חוזרת על הלשונית הפעילה – "חזרה להתחלה" שלה (כמו באפליקציות מפות)
      vibrate(8); // משוב מגע עדין, כמו באפליקציות נייטיב
      this.select(btn.dataset.tab, { reselect: btn.dataset.tab === this.active });
    });

    this.#syncHeight();
    window.addEventListener('resize', () => this.#syncHeight(), { passive: true });
  }

  /** גובה כל מה שיושב בתחתית: הסרגל (0 כשהוא מוסתר, למשל בזמן ניווט) + באנר הפרסומת שמתחתיו */
  get height() {
    const bar = this.hidden || window.matchMedia('(min-width: 768px)').matches ? 0 : this.root.getBoundingClientRect().height;
    return bar + this.getExtraBottom();
  }

  select(tab, { silent = false, reselect = false } = {}) {
    const prev = this.active;
    this.active = tab;
    for (const b of this.buttons) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    }
    document.body.dataset.tab = tab;
    if (!silent) this.onChange?.(tab, prev, { reselect });
  }

  setHidden(hidden) {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    this.root.hidden = hidden;
    this.#syncHeight();
  }

  /** נקודה על לשונית (למשל פרס יומי במשחקים שעוד לא נלקח) */
  setBadge(tab, on) {
    this.buttons.find((b) => b.dataset.tab === tab)?.classList.toggle('has-badge', on);
  }

  /** חישוב מחדש של הגובה (למשל כשהבאנר מופיע או נעלם) */
  refresh() {
    this.#syncHeight();
  }

  #syncHeight() {
    document.documentElement.style.setProperty('--tabbar-h', `${Math.round(this.height)}px`);
  }
}
