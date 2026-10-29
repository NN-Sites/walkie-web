// חנות ההטבות: צפייה בפרסומת (rewarded) פותחת הטבה לזמן קצוב. ראו rewards.js.
// נפתחת מההגדרות, מהבאנר, ומהודעת "הגעת למכסת המועדפים".

import { t, LOCALE } from './i18n.js?v=1.10.0-mvu2228r';
import { escapeHtml, showToast } from './ui.js?v=1.10.0-mvu2228r';
import { icon } from './transit-ui.js?v=1.10.0-mvu2228r';
import { celebrate } from './fx.js?v=1.10.0-mvu2228r';
import { showRewardedAd } from './rewarded-ads.js?v=1.10.0-mvu2228r';
import {
  PERKS, DOT_COLORS, MAP_TINTS, FREE_FAVS, PERK_FAVS,
  perkActive, perkLeftMs, leftText, grantPerk, getPrefs, setPrefs, onPerksChange
} from './rewards.js?v=1.10.0-mvu2228r';
import { APP_ICONS, appIconSupported, currentAppIcon, setAppIcon, appIconLabel } from './app-icon.js?v=1.10.0-mvu2228r';
import { accountInfo } from './account.js?v=1.10.0-mvu2228r';
import { requireSignIn } from './auth-gate.js?v=1.10.0-mvu2228r';
import { getFavorites } from './favorites.js?v=1.10.0-mvu2228r';
import { getHistory, clearHistory, getStats, co2SavedKg } from './stats.js?v=1.10.0-mvu2228r';
import { getFirebase, isFirebaseConfigured, ensureSignedIn } from '../firebase-config.js?v=1.10.0-mvu2228r';
import { track } from './analytics.js?v=1.10.0-mvu2228r';

const ORDER = ['noAds', 'colors', 'favs', 'history', 'badge', 'thanks', 'logo'];
const NAME_MAX = 24;

const leftLabel = (id) => {
  const lt = leftText(perkLeftMs(id));
  return lt ? t('נותרו {left}', { left: t(lt.key, { n: lt.n }) }) : t('פעיל לתמיד');
};

const firstName = () => String(accountInfo()?.name || '').trim().split(/\s+/)[0].slice(0, NAME_MAX);

/** מפרסם את השם ברשימת התומכים של היום (supporters/{uid}); נמחק מהתצוגה אחרי שהזמן שבמסמך עובר */
async function publishSupporter(name) {
  if (!isFirebaseConfigured()) return false;
  try {
    const user = await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    const { doc, setDoc } = modules.firestore;
    await setDoc(doc(firestore, 'supporters', user.uid), { name, until: Date.now() + PERKS.thanks.ms });
    return true;
  } catch {
    return false;
  }
}

export class StoreView {
  constructor() {
    this.el = null;
    this.historyEl = null;
    onPerksChange(() => this.render());
  }

  get isOpen() {
    return !!this.el;
  }

  open({ focus = null } = {}) {
    if (this.el) return;
    track('feat.store_open');
    const el = document.createElement('div');
    el.className = 'doc-overlay store-page';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', t('חנות הטבות'));
    el.innerHTML = `
      <div class="doc-bar">
        <button class="icon-btn" type="button" data-store="close" aria-label="${t('סגירה')}">${icon('back', 22)}</button>
        <span>${t('חנות הטבות')}</span>
      </div>
      <div class="store-body"></div>`;
    el.addEventListener('click', (e) => this.#onClick(e));
    el.addEventListener('input', (e) => {
      if (e.target.id === 'store-name') this.nameDraft = e.target.value;
    });
    document.body.appendChild(el);
    this.el = el;
    this.nameDraft = undefined;
    this.render();
    if (focus) el.querySelector(`[data-perk-card="${focus}"]`)?.scrollIntoView({ block: 'center' });
  }

  close() {
    this.closeHistory();
    this.el?.remove();
    this.el = null;
  }

  /** כפתור "חזור" של אנדרואיד: true אם סגרנו משהו */
  back() {
    if (this.historyEl) {
      this.closeHistory();
      return true;
    }
    if (this.el) {
      this.close();
      return true;
    }
    return false;
  }

  render() {
    const body = this.el?.querySelector('.store-body');
    if (!body) return;
    const top = body.scrollTop;
    body.innerHTML = `
      <div class="store-hero">
        <span class="store-hero-ic" aria-hidden="true">🎁</span>
        <h1>${t('חנות הטבות')}</h1>
        <p>${t('צפו בפרסומת קצרה וקבלו הטבה. בלי תשלום, בלי התחייבות.')}</p>
      </div>
      ${ORDER.map((id) => this.#cardHtml(id)).join('')}
      <p class="set-note store-foot">${t('ההטבות נשמרות במכשיר הזה. הפרסומות מממנות את Walkie וחוסכות לנו לגבות תשלום 💚')}</p>`;
    body.scrollTop = top;
  }

  #cardHtml(id) {
    const perk = PERKS[id];
    const active = perkActive(id);
    const permanent = perk.ms === Number.MAX_SAFE_INTEGER;
    const logoNative = id !== 'logo' || appIconSupported();
    const watch = permanent && active ? '' : `
      <button class="btn store-watch" type="button" data-store="watch" data-perk="${id}"${logoNative ? '' : ' disabled'}>
        ▶ ${active ? t('הארכה בפרסומת') : t('צפייה בפרסומת')} · ${t(perk.duration)}
      </button>`;
    return `
      <section class="store-card${active ? ' is-active' : ''}" data-perk-card="${id}">
        <div class="store-card-head">
          <span class="store-ic" aria-hidden="true">${perk.icon}</span>
          <span class="store-text"><strong>${t(perk.title)}</strong><small>${t(perk.desc)}</small></span>
        </div>
        ${active ? `<div class="store-status">✓ ${t('פעיל')} · ${leftLabel(id)}</div>${this.#configHtml(id)}` : ''}
        ${id === 'logo' && !logoNative ? `<p class="set-note">${t('החלפת הלוגו זמינה באפליקציית האנדרואיד')}</p>` : ''}
        ${watch}
      </section>`;
  }

  #configHtml(id) {
    const prefs = getPrefs();
    if (id === 'colors') {
      return `
        <div class="store-row"><span>${t('צבע הנקודה שלי')}</span>
          <span class="store-swatches">${DOT_COLORS.map((c) => `<button type="button" class="store-swatch${prefs.dot === c ? ' is-on' : ''}" style="background:${c}" data-store="dot" data-value="${c}" aria-label="${c}"></button>`).join('')}</span>
        </div>
        <div class="store-row"><span>${t('צבע המפה')}</span>
          <span class="store-swatches">${MAP_TINTS.map((m) => `<button type="button" class="store-swatch${prefs.map === m.id ? ' is-on' : ''}" style="background:${m.swatch}" data-store="map" data-value="${m.id}" aria-label="${t(m.label)}" title="${t(m.label)}"></button>`).join('')}</span>
        </div>`;
    }
    if (id === 'badge') {
      return `<div class="store-row"><span class="supporter-badge">💚 ${t('תומך Walkie')}</span></div>`;
    }
    if (id === 'favs') {
      const f = getFavorites();
      return `<p class="store-meta">${t('בשימוש: {a} מקומות · {b} תחנות · {c} קווים (עד {n} מכל סוג)', { a: f.places.length, b: f.stops.length, c: f.lines.length, n: PERK_FAVS })}</p>`;
    }
    if (id === 'history') {
      return `<button class="btn-secondary" type="button" data-store="history">${t('פתיחת ההיסטוריה')}</button>`;
    }
    if (id === 'thanks') {
      const value = this.nameDraft ?? (prefs.name || firstName());
      return `
        <div class="store-name">
          <input id="store-name" maxlength="${NAME_MAX}" value="${escapeHtml(value)}" placeholder="${t('השם שיוצג')}" autocomplete="off">
          <button class="btn-secondary" type="button" data-store="rename">${t('עדכון')}</button>
        </div>`;
    }
    if (id === 'logo') {
      if (!appIconSupported()) return '';
      return `<div class="store-icons">${APP_ICONS.map((x) => `
        <button type="button" class="store-icon${currentAppIcon() === x.id ? ' is-on' : ''}" data-store="icon" data-value="${x.id}" aria-label="${appIconLabel(x.id)}">
          <img src="icons/app/${x.id}.png" alt="" width="56" height="56" loading="lazy"><small>${appIconLabel(x.id)}</small>
        </button>`).join('')}</div>`;
    }
    return '';
  }

  async #onClick(e) {
    const btn = e.target.closest('[data-store]');
    if (!btn) return;
    const { store, perk, value } = btn.dataset;
    if (store === 'close') return this.close();
    if (store === 'watch') return this.unlock(perk, btn);
    if (store === 'dot') return setPrefs({ dot: value });
    if (store === 'map') return setPrefs({ map: value });
    if (store === 'history') return this.openHistory();
    if (store === 'rename') return this.#publishName();
    if (store === 'icon') {
      try {
        await setAppIcon(value);
        showToast(t('הלוגו הוחלף. ייתכן שיידרשו כמה שניות עד שהמסך הראשי יתעדכן'));
      } catch {
        showToast(t('לא הצלחנו להחליף את הלוגו'));
      }
    }
  }

  async unlock(id, btn = null) {
    if (id === 'logo' && !appIconSupported()) return;
    // השם בתודות דורש חשבון Google: מבקשים התחברות לפני שמבזבזים צפייה בפרסומת
    if (id === 'thanks' && !requireSignIn(t('להופיע בתודות'), () => this.unlock(id))) return;
    if (btn) btn.disabled = true;
    const ok = await showRewardedAd();
    if (btn) btn.disabled = false;
    if (!ok) {
      showToast(t('הפרסומת לא הושלמה, ההטבה לא נפתחה'));
      return;
    }
    grantPerk(id);
    track(`feat.store_${id}`);
    celebrate(btn, 30);
    showToast(`${PERKS[id].icon} ${t('ההטבה נפתחה: {title}', { title: t(PERKS[id].title) })}`);
    if (id === 'thanks') await this.#publishName(true);
  }

  async #publishName(silent = false) {
    const name = String(this.nameDraft ?? (getPrefs().name || firstName())).trim().slice(0, NAME_MAX);
    if (!name) {
      showToast(t('כתבו שם להצגה'));
      return;
    }
    setPrefs({ name });
    this.nameDraft = undefined;
    const ok = await publishSupporter(name);
    if (ok) {
      if (!silent) showToast(t('השם עודכן ברשימת התודות'));
    } else {
      showToast(t('לא הצלחנו לפרסם את השם כרגע. נסו שוב מאוחר יותר'));
    }
  }

  // ---------- היסטוריית נסיעות ----------

  openHistory() {
    if (this.historyEl) return;
    const el = document.createElement('div');
    el.className = 'doc-overlay store-page history-page';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', t('היסטוריית נסיעות'));
    el.innerHTML = `
      <div class="doc-bar">
        <button class="icon-btn" type="button" data-hist="close" aria-label="${t('סגירה')}">${icon('back', 22)}</button>
        <span>${t('היסטוריית נסיעות')}</span>
      </div>
      <div class="store-body">${this.#historyHtml()}</div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-hist]');
      if (!b) return;
      if (b.dataset.hist === 'close') this.closeHistory();
      else if (b.dataset.hist === 'clear' && confirm(t('למחוק את כל ההיסטוריה מהמכשיר?'))) {
        clearHistory();
        el.querySelector('.store-body').innerHTML = this.#historyHtml();
      }
    });
    document.body.appendChild(el);
    this.historyEl = el;
  }

  closeHistory() {
    this.historyEl?.remove();
    this.historyEl = null;
  }

  #historyHtml() {
    const items = getHistory();
    const stats = getStats();
    const km = (stats.walkMeters / 1000).toFixed(1);
    const summary = `
      <div class="hist-summary">
        <div><b>${stats.walks}</b><small>${t('הליכות')}</small></div>
        <div><b>${stats.trips}</b><small>${t('נסיעות')}</small></div>
        <div><b>${km}</b><small>${t('ק"מ בהליכה')}</small></div>
        <div><b>${co2SavedKg(stats).toFixed(1)}</b><small>${t('ק"ג CO₂ נחסכו')}</small></div>
      </div>`;
    if (!items.length) {
      return `${summary}<div class="thanks-empty"><span class="thanks-empty-ic">🕘</span><p>${t('עוד אין נסיעות. אחרי שתגיעו ליעד הראשון הוא יופיע כאן.')}</p></div>`;
    }
    const rows = items.map((x) => {
      const when = new Date(x.at).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const meta = x.kind === 'walk' && x.meters ? ` · ${x.meters >= 1000 ? `${(x.meters / 1000).toFixed(1)} ${t('ק"מ')}` : `${x.meters} ${t('מ\'')}`}` : '';
      return `<li><span class="hist-ic">${x.kind === 'walk' ? '🚶' : '🚌'}</span><span class="hist-text"><strong>${escapeHtml(x.dest || t('יעד'))}</strong><small>${escapeHtml(when)}${meta}</small></span></li>`;
    }).join('');
    return `${summary}<ul class="hist-list">${rows}</ul><button class="btn-secondary hist-clear" type="button" data-hist="clear">${t('מחיקת ההיסטוריה')}</button>`;
  }
}
