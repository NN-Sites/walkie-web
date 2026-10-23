// סרגל ניווט תחתון: בית | קווים | תחנות | הגדרות

import { vibrate } from './settings.js?v=1.5.0-mvkuvyst';

export class TabBar {
  constructor(root, { onChange }) {
    this.root = root;
    this.onChange = onChange;
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

  /** גובה הסרגל (0 כשהוא מוסתר, למשל בזמן ניווט) */
  get height() {
    if (this.hidden || window.matchMedia('(min-width: 768px)').matches) return 0;
    return this.root.getBoundingClientRect().height;
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

  #syncHeight() {
    document.documentElement.style.setProperty('--tabbar-h', `${Math.round(this.height)}px`);
  }
}
