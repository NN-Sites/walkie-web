// סרגל גישה מהירה במסך הבית: 🏠 בית · 💼 עבודה / 🎒 בית ספר · ⭐ מקומות שמורים

import { getFavorites, onFavoritesChange, secondLabel } from './favorites.js?v=1.5.0-mvkudy41';
import { escapeHtml } from './ui.js?v=1.5.0-mvkudy41';
import { t } from './i18n.js?v=1.5.0-mvkudy41';

export const STAR_ON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="m12 17.3 6.2 3.7-1.6-7 5.4-4.7-7.2-.6L12 2 9.2 8.7 2 9.3l5.4 4.7-1.6 7z"/></svg>';
export const STAR_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="m22 9.2-7.2-.6L12 2 9.2 8.6 2 9.2l5.5 4.7L5.8 21 12 17.3l6.2 3.7-1.6-7.1L22 9.2ZM12 15.4l-3.8 2.3 1-4.3-3.3-2.9 4.4-.4L12 6.1l1.7 4 4.4.4-3.3 2.9 1 4.3-3.8-2.3Z"/></svg>';

export function starButton({ on, action, data = {}, label = t('שמירה') }) {
  const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${escapeHtml(v)}"`).join('');
  return `
    <button class="star-btn${on ? ' is-on' : ''}" type="button" data-action="${action}"${attrs}
            aria-pressed="${on}" aria-label="${on ? t('הסרה מהמועדפים') : label}">
      ${on ? STAR_ON : STAR_OFF}<span>${on ? t('שמור') : t('שמירה')}</span>
    </button>`;
}

export class QuickBar {
  /** onGo(place) – יציאה למקום; onSet('home' | 'second') – הגדרת בית/מקום שני */
  constructor(root, { onGo, onSet }) {
    this.root = root;
    this.onGo = onGo;
    this.onSet = onSet;

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quick]');
      if (!btn) return;
      const fav = getFavorites();
      const kind = btn.dataset.quick;
      if (kind === 'home') return fav.home ? this.onGo(fav.home) : this.onSet('home');
      if (kind === 'second') return fav.second ? this.onGo(fav.second) : this.onSet('second');
      const place = fav.places.find((p) => p.id === btn.dataset.id);
      if (place) this.onGo(place);
      return undefined;
    });

    onFavoritesChange(() => this.render());
    this.render();
  }

  render() {
    const fav = getFavorites();
    const second = secondLabel();
    const chip = (quick, emoji, label, sub, extra = '') => `
      <button class="quick-chip${sub ? '' : ' is-empty'}" type="button" data-quick="${quick}"${extra}>
        <span class="quick-emoji" aria-hidden="true">${emoji}</span>
        <span class="quick-text">${escapeHtml(label)}${sub ? '' : `<small>${t('הגדרה')}</small>`}</span>
      </button>`;

    this.root.innerHTML =
      chip('home', '🏠', t('בית'), fav.home) +
      chip('second', second.emoji, t(second.label), fav.second) +
      fav.places
        .slice(0, 8)
        .map((p) => chip('place', '⭐', p.name, true, ` data-id="${escapeHtml(p.id)}"`))
        .join('');
  }
}
