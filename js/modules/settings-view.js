// מסך "הגדרות": העדפות מסלול, הליכה, נגישות, תצוגה, ופרטיות.

import { getSettings, updateSettings, clearLocalData, onSettingsChange } from './settings.js?v=1.10.0-mvu1kw0g';
import { t, LANG, setLanguage } from './i18n.js?v=1.10.0-mvu1kw0g';
import { modeIcon, icon } from './transit-ui.js?v=1.10.0-mvu1kw0g';
import { showToast, escapeHtml } from './ui.js?v=1.10.0-mvu1kw0g';
import { APP_VERSION } from '../config.js?v=1.10.0-mvu1kw0g';
import { sessionStatus } from './session.js?v=1.10.0-mvu1kw0g';
import { celebrate, stagger } from './fx.js?v=1.10.0-mvu1kw0g';
import { accountInfo, onAccountChange, signInWithGoogle, signOutGoogle, deleteAccount, accountErrorMessage } from './account.js?v=1.10.0-mvu1kw0g';
import {
  getFavorites, onFavoritesChange, setHome, setSecond, setSecondType, secondLabel,
  removePlace, toggleStop, toggleLine, SECOND_LABELS
} from './favorites.js?v=1.10.0-mvu1kw0g';

const WALK_OPTIONS = [5, 10, 15, 20, 30];
const SPEEDS = [
  { id: 'slow', label: 'איטית', kmh: 3.8 },
  { id: 'normal', label: 'רגילה', kmh: 4.7 },
  { id: 'fast', label: 'מהירה', kmh: 5.6 }
];
const THEMES = [
  { id: 'system', label: 'לפי המכשיר' },
  { id: 'light', label: 'בהיר' },
  { id: 'dark', label: 'כהה' }
];
// שם השפה תמיד בשפה עצמה, כדי שמי שלא קורא את השפה הנוכחית ימצא את שלו
const LANGUAGES = [
  { id: 'he', label: 'עברית' },
  { id: 'en', label: 'English' },
  { id: 'ru', label: 'Русский' },
  { id: 'am', label: 'አማርኛ' }
];

export class SettingsView {
  /** pickPlace(purpose, onPick) – פותח את מסך החיפוש לבחירת מקום (בית / עבודה / בית ספר) */
  constructor(root, { pickPlace, getSupportId } = {}) {
    this.root = root;
    this.pickPlace = pickPlace;
    this.getSupportId = getSupportId;
    this.body = root.querySelector('#settings-body');

    root.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.mode) updateSettings({ modes: { [el.dataset.mode]: el.checked } });
      else if (el.dataset.toggle) updateSettings({ [el.dataset.toggle]: el.checked });
    });

    root.addEventListener('click', (e) => {
      const favBtn = e.target.closest('[data-fav]');
      if (favBtn) return this.#onFav(favBtn.dataset);
      const btn = e.target.closest('[data-set], [data-action]');
      if (!btn) return;
      if (btn.dataset.set === 'maxWalkMin') updateSettings({ maxWalkMin: Number(btn.dataset.value) });
      else if (btn.dataset.set === 'walkSpeed') updateSettings({ walkSpeed: btn.dataset.value });
      else if (btn.dataset.set === 'theme') updateSettings({ theme: btn.dataset.value });
      else if (btn.dataset.set === 'lang') setLanguage(btn.dataset.value, (lang) => updateSettings({ lang }));
      else if (btn.dataset.action === 'clear-data') {
        clearLocalData();
        showToast(t('החיפושים האחרונים והמטמון נמחקו מהמכשיר'));
      } else if (btn.dataset.action === 'open-privacy') {
        this.openPrivacy();
      } else if (btn.dataset.action === 'delete-account') {
        this.#deleteAccount(btn);
      } else if (btn.dataset.action === 'google-signin') {
        this.#signIn(btn);
      } else if (btn.dataset.action === 'google-signout') {
        if (confirm(t('להתנתק מחשבון Google? המועדפים יישארו במכשיר.'))) signOutGoogle();
      }
    });

    onSettingsChange(() => this.render());
    onAccountChange(() => {
      if (!this.root.hidden) this.render();
    });
    onFavoritesChange(() => {
      if (!this.root.hidden) this.render();
    });
  }

  async #deleteAccount(btn) {
    if (!confirm(t('למחוק את החשבון וכל הנתונים שלך? אי אפשר לשחזר. המועדפים וההגדרות יימחקו גם מהמכשיר.'))) return;
    btn.disabled = true;
    try {
      await deleteAccount();
    } catch (err) {
      const msg = accountErrorMessage(err);
      if (msg) showToast(msg);
    } finally {
      btn.disabled = false;
    }
  }

  async #signIn(btn) {
    btn.disabled = true;
    try {
      const info = await signInWithGoogle();
      if (info?.linked) {
        celebrate(btn, 24);
        showToast(t('מחובר כ-{name} – המועדפים יישמרו בחשבון', { name: info.name || info.email }));
      }
    } catch (err) {
      const msg = accountErrorMessage(err);
      if (msg) showToast(msg);
    } finally {
      btn.disabled = false;
    }
  }

  #accountHtml() {
    const a = accountInfo();
    const G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
    if (a?.linked) {
      const initial = escapeHtml((a.name || a.email || '?').trim().charAt(0).toUpperCase());
      return `
        <section class="set-group">
          <h2 class="set-title">${t('החשבון שלי')}</h2>
          <div class="account-row">
            ${a.photo ? `<img src="${escapeHtml(a.photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="account-avatar">${initial}</span>`}
            <span class="account-text"><strong>${escapeHtml(a.name || a.email)}</strong><small>${escapeHtml(a.email)} · ${t('מועדפים והגדרות מסונכרנים')}</small></span>
          </div>
          <button class="set-row set-button" type="button" data-action="google-signout">
            <span class="set-icon">↩️</span>
            <span class="set-text"><span class="set-label">${t('התנתקות')}</span><span class="set-hint">${t('המועדפים יישארו במכשיר')}</span></span>
          </button>
        </section>`;
    }
    return `
      <section class="set-group">
        <h2 class="set-title">${t('החשבון שלי')}</h2>
        <p class="set-note" style="margin-top:8px">${t('התחברות עם Gmail שומרת את המועדפים, ההגדרות בחשבון – ומחזירה אותם בטלפון חדש או אחרי התקנה מחדש.')}</p>
        <button class="btn-google" type="button" data-action="google-signin">${G} ${t('התחברות עם Google')}</button>
      </section>`;
  }

  get isPrivacyOpen() {
    return !!this.privacy;
  }

  /** מדיניות הפרטיות בתוך האפליקציה (אותו קובץ privacy.html שמתפרסם גם באתר) */
  openPrivacy() {
    if (this.privacy) return;
    const el = document.createElement('div');
    el.className = 'doc-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', t('מדיניות פרטיות'));
    el.innerHTML = `
      <div class="doc-bar">
        <button class="icon-btn" type="button" aria-label="${t('סגירה')}">${icon('back', 22)}</button>
        <span>${t('מדיניות פרטיות')}</span>
      </div>
      <iframe src="privacy.html" title="${t('מדיניות פרטיות')}"></iframe>`;
    el.querySelector('button').addEventListener('click', () => this.closePrivacy());
    document.body.appendChild(el);
    this.privacy = el;
  }

  closePrivacy() {
    this.privacy?.remove();
    this.privacy = null;
  }

  #onFav(d) {
    switch (d.fav) {
      case 'set-home':
        this.pickPlace?.(t('כתובת הבית'), (place) => {
          setHome(place);
          showToast(t('הבית נשמר 🏠'));
        }, t('בית'));
        break;
      case 'clear-home':
        setHome(null);
        break;
      case 'set-second':
        this.pickPlace?.(t('כתובת ה{place}', { place: t(secondLabel().label) }), (place) => {
          setSecond(place);
          showToast(t('{place} נשמר', { place: t(secondLabel().label) }) + ` ${secondLabel().emoji}`);
        }, t(secondLabel().label));
        break;
      case 'clear-second':
        setSecond(null);
        break;
      case 'second-type':
        setSecondType(d.value);
        break;
      case 'rm-place':
        removePlace(d.id);
        break;
      case 'rm-stop':
        toggleStop({ code: d.code });
        break;
      case 'rm-line':
        toggleLine({ lineRef: d.ref });
        break;
      default:
        break;
    }
  }

  #favoritesHtml() {
    const fav = getFavorites();
    const second = secondLabel();
    const placeRow = (emoji, title, place, setKey, clearKey) => `
      <div class="set-row">
        <span class="set-icon">${emoji}</span>
        <span class="set-text">
          <span class="set-label">${t(title)}</span>
          <span class="set-hint">${place ? escapeHtml(place.name) : t('לא הוגדר')}</span>
        </span>
        <button class="btn-secondary btn-sm" type="button" data-fav="${setKey}">${place ? t('שינוי') : t('הגדרה')}</button>
        ${place ? `<button class="icon-btn btn-rm" type="button" data-fav="${clearKey}" aria-label="${t('מחיקה')}">✕</button>` : ''}
      </div>`;
    const removable = (label, sub, attrs) => `
      <div class="set-row set-row-sm">
        <span class="set-text"><span class="set-label">${escapeHtml(label)}</span>${sub ? `<span class="set-hint">${escapeHtml(sub)}</span>` : ''}</span>
        <button class="icon-btn btn-rm" type="button" ${attrs} aria-label="${t('הסרה')}">✕</button>
      </div>`;

    return `
      <section class="set-group">
        <h2 class="set-title">${t('מקומות שמורים')}</h2>
        ${placeRow('🏠', 'בית', fav.home, 'set-home', 'clear-home')}
        <div class="set-block">
          <div class="set-label">${t('המקום השני שלי')}</div>
          <div class="seg seg-wide">
            ${Object.entries(SECOND_LABELS).map(([id, v]) => `<button type="button" class="${fav.secondType === id ? 'is-active' : ''}" data-fav="second-type" data-value="${id}">${v.emoji} ${t(v.label)}</button>`).join('')}
          </div>
        </div>
        ${placeRow(second.emoji, second.label, fav.second, 'set-second', 'clear-second')}
        ${fav.places.map((p) => removable(`⭐ ${p.name}`, p.subtitle, `data-fav="rm-place" data-id="${escapeHtml(p.id)}"`)).join('')}
        ${fav.stops.length ? `<h3 class="set-subtitle">${t('תחנות שמורות')}</h3>${fav.stops.map((st) => removable(st.name, st.code ? t('תחנה {code}', { code: st.code }) : '', `data-fav="rm-stop" data-code="${escapeHtml(st.code)}"`)).join('')}` : ''}
        ${fav.lines.length ? `<h3 class="set-subtitle">${t('קווים שמורים')}</h3>${fav.lines.map((l) => removable(`${l.mode === 'rail' ? t('רכבת') : t('קו {line}', { line: l.line })}${l.to ? ` ${t('לכיוון {dest}', { dest: l.to })}` : ''}`, l.agency, `data-fav="rm-line" data-ref="${escapeHtml(l.lineRef)}"`)).join('')}` : ''}
        <p class="set-note">${t('שומרים מקום בכוכב ⭐ בכותרת המסלול, תחנה במסך התחנה, וקו במסך הקו.')}</p>
      </section>`;
  }

  show() {
    this.render();
    this.root.hidden = false;
    this.root.scrollTop = 0;
    stagger(this.body, ':scope > *', 45);
  }

  hide() {
    this.root.hidden = true;
  }

  render() {
    const s = getSettings();
    const modeRow = (id, label, hint) => `
      <label class="set-row">
        <span class="set-icon mode-${id}">${modeIcon(id, 20)}</span>
        <span class="set-text"><span class="set-label">${t(label)}</span><span class="set-hint">${t(hint)}</span></span>
        <input class="switch" type="checkbox" data-mode="${id}" ${s.modes[id] ? 'checked' : ''}>
      </label>`;
    const toggleRow = (key, label, hint, iconHtml) => `
      <label class="set-row">
        <span class="set-icon">${iconHtml}</span>
        <span class="set-text"><span class="set-label">${t(label)}</span><span class="set-hint">${t(hint)}</span></span>
        <input class="switch" type="checkbox" data-toggle="${key}" ${s[key] ? 'checked' : ''}>
      </label>`;

    this.body.innerHTML = `
      ${this.#accountHtml()}
      ${this.#favoritesHtml()}

      <section class="set-group">
        <h2 class="set-title">${t('אמצעי תחבורה במסלולים')}</h2>
        ${modeRow('bus', 'אוטובוסים', 'כל המפעילים')}
        ${modeRow('rail', 'רכבת ישראל', 'רכבות בין-עירוניות ופרבריות')}
        ${modeRow('lightrail', 'רכבת קלה', 'הקו האדום בגוש דן, ירושלים')}
      </section>

      <section class="set-group">
        <h2 class="set-title">${t('הליכה')}</h2>
        <div class="set-block">
          <div class="set-label">${t('הליכה מקסימלית לתחנה')}</div>
          <div class="seg seg-wide">
            ${WALK_OPTIONS.map((m) => `<button type="button" class="${s.maxWalkMin === m ? 'is-active' : ''}" data-set="maxWalkMin" data-value="${m}">${t('{n} דק\'', { n: m })}</button>`).join('')}
          </div>
        </div>
        <div class="set-block">
          <div class="set-label">${t('קצב הליכה')}</div>
          <div class="seg seg-wide">
            ${SPEEDS.map((x) => `<button type="button" class="${s.walkSpeed === x.id ? 'is-active' : ''}" data-set="walkSpeed" data-value="${x.id}">${t(x.label)}<small>${t('{n} קמ"ש', { n: x.kmh })}</small></button>`).join('')}
          </div>
        </div>
      </section>

      <section class="set-group">
        <h2 class="set-title">${t('נגישות')}</h2>
        ${toggleRow('wheelchair', 'מסלולים נגישים', 'בלי מדרגות, עדיפות לקווים נגישים', '♿')}
        ${toggleRow('vibrate', 'רטט בניווט', 'לפני פנייה ולפני ירידה מהאוטובוס', '📳')}
        ${toggleRow('linePush', 'התראות על קווים שמורים', 'איחור של 10 דק\' ומעלה או ביטול נסיעה (באפליקציה)', '🔔')}
        ${toggleRow('backgroundTrip', 'עבודה ברקע', 'ניווט וליווי נסיעה ממשיכים כשהמסך נעול, עם התראה "רדו בתחנה הבאה" (באפליקציה)', '📍')}
      </section>

      <section class="set-group">
        <h2 class="set-title">${t('תצוגה ושפה')}</h2>
        <div class="set-block">
          <div class="set-label">${t('מצב לילה')}</div>
          <div class="seg seg-wide">
            ${THEMES.map((x) => `<button type="button" class="${s.theme === x.id ? 'is-active' : ''}" data-set="theme" data-value="${x.id}">${x.id === 'dark' ? '🌙 ' : x.id === 'light' ? '☀️ ' : ''}${t(x.label)}</button>`).join('')}
          </div>
        </div>
        <div class="set-block">
          <div class="set-label">${LANG === 'he' ? 'שפה · Language' : 'Language · שפה'}</div>
          <div class="seg seg-wide">
            ${LANGUAGES.map((x) => `<button type="button" class="${LANG === x.id ? 'is-active' : ''}" data-set="lang" data-value="${x.id}" lang="${x.id}">${x.label}</button>`).join('')}
          </div>
        </div>
        ${toggleRow('showStops', 'תחנות על המפה', 'סמני תחנות במסך הבית', icon('bus', 20))}
        ${toggleRow('showBuses', 'אוטובוסים בזמן אמת על המפה', 'איפה האוטובוס עכשיו – בתחנה, בקו ובמסלול', '📍')}
      </section>


      <section class="set-group">
        <h2 class="set-title">${t('פרטיות')}</h2>
        <button class="set-row set-button" type="button" data-action="clear-data">
          <span class="set-icon">🗑️</span>
          <span class="set-text"><span class="set-label">${t('מחיקת נתונים מהמכשיר')}</span><span class="set-hint">${t('חיפושים אחרונים ומטמון תחנות')}</span></span>
        </button>
        <button class="set-row set-button" type="button" data-action="delete-account">
          <span class="set-icon">⚠️</span>
          <span class="set-text"><span class="set-label">${t('מחיקת החשבון והנתונים')}</span><span class="set-hint">${t('מוחק את החשבון, המועדפים וכל מה שנשמר עליך')}</span></span>
        </button>
        <button class="set-row set-button" type="button" data-action="open-privacy">
          <span class="set-icon">🔒</span>
          <span class="set-text"><span class="set-label">${t('מדיניות פרטיות')}</span><span class="set-hint">${t('מה נשמר, ולאן נשלח המיקום')}</span></span>
        </button>
        ${toggleRow('shareBusPosition', 'דיוק מיקום האוטובוס', 'כשאני נוסע על מסלול קו, המיקום שלי עוזר לאחרים לראות איפה האוטובוס', '🚌')}
        ${toggleRow('analytics', 'נתוני שימוש אנונימיים', 'מסכים שנפתחו ותקלות, בלי מיקום ובלי מזהה אישי', '📊')}
        <p class="set-note">${t('המיקום שלך משמש רק במכשיר ובבקשות למסלול. מיקום נשמר אצלנו רק בשיתוף בלייב, ובזמן שנראה שאתה נוסע באוטובוס על קו (אם "דיוק מיקום האוטובוס" פעיל), ונמחק בסיום הנסיעה.')}</p>
      </section>

      <section class="set-group">
        <h2 class="set-title">${t('אודות')}</h2>
        <div class="set-about">
          <div class="set-brand"><img src="icon.svg" alt="" width="36" height="36"> Walkie <span class="set-version">${APP_VERSION}</span></div>
          <p>${t('ניווט רגלי ותחבורה ציבורית, חינמי.')}</p>
          <p class="set-note">${t('לוחות זמנים, קווים ותחנות: משרד התחבורה (GTFS), דרך הסדנא לידע ציבורי ו-Transitous. זמן אמת: SIRI של משרד התחבורה. מפות: © OpenStreetMap. בתי ספר: מאגר משרד החינוך (data.gov.il).')}</p>
          ${sessionStatus() ? `<p class="set-note" dir="ltr">sync: ${escapeHtml(sessionStatus())}</p>` : ''}
          ${this.getSupportId?.() ? `<p class="set-note">${t('מזהה תמיכה:')} <bdi>${escapeHtml(this.getSupportId())}</bdi></p>` : ''}
        </div>
      </section>`;
  }
}
