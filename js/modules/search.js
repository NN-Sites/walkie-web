// מסך חיפוש יעד: השלמה אוטומטית, חיפושים אחרונים, ותמיכה בכפתור "חזור" של הטלפון.

import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_CHARS,
  RECENT_SEARCHES_MAX,
  STORAGE_KEYS
} from '../config.js?v=1.9.0-mvpredcv';
import { fetchSearch } from './api.js?v=1.9.0-mvpredcv';
import { formatDistance } from './geo.js?v=1.9.0-mvpredcv';
import { escapeHtml } from './ui.js?v=1.9.0-mvpredcv';
import { t, IS_EN } from './i18n.js?v=1.9.0-mvpredcv';
import { trackFailedSearch } from './analytics.js?v=1.9.0-mvpredcv';

/** כותרת משנה מהשרת ("תחנה 1234 · תל אביב", "מסעדה · חיפה") – מתרגמים את מה שאפשר, שמות נשארים */
function localizeSubtitle(sub) {
  if (!IS_EN) return sub;
  return String(sub).split(' · ').map((part) => {
    const stop = /^תחנה (\d+)$/.exec(part);
    if (stop) return t('תחנה {code}', { code: stop[1] });
    const school = /^בית ספר (.+)$/.exec(part);
    if (school) return t('בית ספר {stage}', { stage: t(school[1]) });
    return t(part);
  }).join(' · ');
}

const KIND_ICONS = {
  stop: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4 16c0 .9.4 1.7 1 2.2V20c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1h8v1c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1.8c.6-.5 1-1.3 1-2.2V6c0-3.5-3.6-4-8-4S4 2.5 4 6v10Zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM18 11H6V6h12v5Z"/></svg>',
  poi: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="m12 17.3 6.2 3.7-1.6-7 5.4-4.7-7.2-.6L12 2 9.2 8.7 2 9.3l5.4 4.7-1.6 7z"/></svg>',
  street: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M11 4h2v3h-2V4Zm0 6.5h2v3h-2v-3Zm0 6.5h2v3h-2v-3ZM4 4h2v16H4V4Zm14 0h2v16h-2V4Z"/></svg>',
  area: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M15 11V5l-3-3-3 3v2H3v14h18V11h-6Zm-8 8H5v-2h2v2Zm0-4H5v-2h2v2Zm0-4H5V9h2v2Zm6 8h-2v-2h2v2Zm0-4h-2v-2h2v2Zm0-4h-2V9h2v2Zm0-4h-2V5h2v2Zm6 12h-2v-2h2v2Zm0-4h-2v-2h2v2Z"/></svg>',
  mylocation: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.9 3A9 9 0 0 0 13 3.1V1h-2v2.1A9 9 0 0 0 3.1 11H1v2h2.1a9 9 0 0 0 7.9 7.9V23h2v-2.1a9 9 0 0 0 7.9-7.9H23v-2h-2.1ZM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"/></svg>',
  recent: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M13 3a9 9 0 0 0-9 9H1l3.9 3.9.1.1L9 12H6a7 7 0 1 1 2.1 5l-1.4 1.4A9 9 0 1 0 13 3Zm-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8H12Z"/></svg>',
  place: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/></svg>'
};

function readRecents() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEYS.recentSearches) || '[]');
    return Array.isArray(list) ? list.filter((r) => Number.isFinite(r?.lat) && Number.isFinite(r?.lng)) : [];
  } catch {
    return [];
  }
}

function saveRecent(place) {
  try {
    const slim = { id: place.id, kind: place.kind, name: place.name, subtitle: place.subtitle ?? null, lat: place.lat, lng: place.lng };
    const list = [slim, ...readRecents().filter((r) => r.id !== place.id)].slice(0, RECENT_SEARCHES_MAX);
    localStorage.setItem(STORAGE_KEYS.recentSearches, JSON.stringify(list));
  } catch {
    // ignore
  }
}

/** מחיקת חיפוש אחרון אחד */
export function removeRecent(id) {
  try {
    const list = readRecents().filter((r) => r.id !== id);
    localStorage.setItem(STORAGE_KEYS.recentSearches, JSON.stringify(list));
  } catch {
    // ignore
  }
}

/** מחיקת כל החיפושים האחרונים */
export function clearRecents() {
  try {
    localStorage.removeItem(STORAGE_KEYS.recentSearches);
  } catch {
    // ignore
  }
}

export class SearchOverlay {
  constructor(root, { onPick, getNear }) {
    this.root = root;
    this.input = root.querySelector('#search-input');
    this.results = root.querySelector('#search-results');
    this.clearBtn = root.querySelector('[data-action="clear"]');
    this.onPick = onPick;
    this.getNear = getNear;

    this.isOpen = false;
    this.items = [];
    this.timer = null;
    this.controller = null;
    this.pushedState = false;

    this.input.addEventListener('input', () => this.#onInput());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.items.length > 0) this.#pick(0);
      if (e.key === 'Escape') this.close();
    });

    root.addEventListener('click', (e) => {
      // מחיקת חיפוש אחרון (✕ בשורה) – לפני כל פעולה אחרת
      const rm = e.target.closest('[data-remove-id]');
      if (rm) {
        removeRecent(rm.dataset.removeId);
        this.#renderRecents();
        return;
      }
      const btn = e.target.closest('[data-action], [data-index]');
      if (!btn) return;
      if (btn.dataset.action === 'close') this.close();
      else if (btn.dataset.action === 'clear-recents') {
        clearRecents();
        this.#renderRecents();
      }
      else if (btn.dataset.action === 'clear') {
        this.input.value = '';
        this.#onInput();
        this.input.focus();
      } else if (btn.dataset.index !== undefined) {
        this.#pick(Number(btn.dataset.index));
      }
    });

    // כפתור "חזור" במכשיר סוגר את החיפוש במקום לצאת מהאפליקציה
    window.addEventListener('popstate', () => {
      if (this.isOpen) {
        this.pushedState = false;
        this.close();
      }
    });
  }

  /**
   * options: { onPick, includeMyLocation, placeholder }
   * בלי options – חיפוש יעד רגיל (onPick מהבנאי).
   */
  open(options = {}) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.pickHandler = options.onPick ?? this.onPick;
    this.includeMyLocation = !!options.includeMyLocation;
    this.input.placeholder = options.placeholder ?? t('כתובת, מקום או תחנה');
    this.root.hidden = false;
    document.body.classList.add('searching');
    try {
      history.pushState({ walkieSearch: true }, '');
      this.pushedState = true;
    } catch {
      this.pushedState = false;
    }
    this.input.value = '';
    this.#renderRecents();
    this.clearBtn.hidden = true;
    // פוקוס אחרי הפריים, כדי שהמקלדת תיפתח גם במובייל
    requestAnimationFrame(() => this.input.focus());
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.root.hidden = true;
    document.body.classList.remove('searching');
    this.input.blur();
    if (this.pushedState) {
      this.pushedState = false;
      history.back();
    }
  }

  #onInput() {
    const q = this.input.value.trim();
    this.clearBtn.hidden = q.length === 0;
    clearTimeout(this.timer);

    if (q.length < SEARCH_MIN_CHARS) {
      this.controller?.abort();
      this.#renderRecents();
      return;
    }
    this.timer = setTimeout(() => this.#search(q), SEARCH_DEBOUNCE_MS);
  }

  async #search(q) {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    if (this.items.length === 0) {
      this.results.innerHTML = `<div class="search-hint">${t('מחפש…')}</div>`;
    }

    try {
      const json = await fetchSearch(q, this.getNear(), controller.signal);
      if (controller.signal.aborted) return;
      this.items = json.results ?? [];

      const isCategory = json.mode === 'category' && json.category;
      if (this.items.length === 0) {
        if (!isCategory) trackFailedSearch(q, 'place');
        this.results.innerHTML = isCategory
          ? `<div class="search-hint">${t('לא מצאנו {what} באזור.', { what: escapeHtml(t(json.category.label)) })}</div>`
          : `<div class="search-hint">${t('לא נמצאו תוצאות עבור "{q}".', { q: escapeHtml(q) })}<br>${t('נסו כתובת, שם מקום או מספר תחנה.')}</div>`;
        return;
      }

      const heading = isCategory
        ? `<h3 class="search-heading">${escapeHtml(json.category.emoji ?? '')} ${t('{what} בסביבה · לפי מרחק', { what: escapeHtml(t(json.category.label)) })}</h3>`
        : '';
      this.results.innerHTML = heading + this.items.map((r, i) => this.#row(r, i)).join('');
    } catch (err) {
      if (err?.name === 'AbortError') return;
      this.items = [];
      this.results.innerHTML = `<div class="search-hint">${t('החיפוש לא זמין כרגע. בדקו את החיבור ונסו שוב.')}</div>`;
    }
  }

  #renderRecents() {
    this.items = readRecents();
    if (this.includeMyLocation) {
      this.items.unshift({ id: 'my-location', kind: 'mylocation', name: t('המיקום שלי'), subtitle: t('לפי GPS') });
      this.results.innerHTML = this.items.map((r, i) => this.#row(r, i, i > 0)).join('');
      return;
    }
    if (this.items.length === 0) {
      this.results.innerHTML =
        `<div class="search-hint">${t('חפשו כתובת, שם של מקום או עסק,')}<br>${t('או שם/מספר של תחנה.')}</div>`;
      return;
    }
    this.results.innerHTML = `
      <div class="search-heading-row">
        <h3 class="search-heading">${t('חיפושים אחרונים')}</h3>
        <button class="link-btn" type="button" data-action="clear-recents">${t('ניקוי הכל')}</button>
      </div>` + this.items.map((r, i) => this.#row(r, i, true)).join('');
  }

  #row(r, index, isRecent = false) {
    const kind = isRecent ? 'recent' : r.kind;
    const icon = !isRecent && r.emoji
      ? `<span class="result-emoji" aria-hidden="true">${r.emoji}</span>`
      : KIND_ICONS[kind] ?? KIND_ICONS.place;
    const dist = !isRecent && Number.isFinite(r.distance) ? `<span class="result-dist">${formatDistance(r.distance)}</span>` : '';
    const button = `
      <button class="result" type="button" data-index="${index}">
        <span class="result-icon kind-${escapeHtml(kind)}">${icon}</span>
        <span class="result-text">
          <span class="result-name">${escapeHtml(r.name)}</span>
          ${r.subtitle ? `<span class="result-sub">${escapeHtml(localizeSubtitle(r.subtitle))}</span>` : ''}
        </span>
        ${dist}
      </button>`;
    if (!isRecent) return button;
    // חיפוש אחרון: כפתור ✕ למחיקה
    return `
      <div class="result-row">
        ${button}
        <button class="result-remove" type="button" data-remove-id="${escapeHtml(r.id)}" aria-label="${t('מחיקת {name} מהחיפושים האחרונים', { name: escapeHtml(r.name) })}">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4Z"/></svg>
        </button>
      </div>`;
  }

  #pick(index) {
    const place = this.items[index];
    if (!place) return;
    if (place.kind !== 'mylocation') saveRecent(place);
    const handler = this.pickHandler ?? this.onPick;
    this.close();
    handler(place);
  }
}
