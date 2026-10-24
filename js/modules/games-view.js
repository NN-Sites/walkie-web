// לשונית "משחקים": משחקים קצרים מול מישהו שמחכה לאוטובוס, נקודות, לוח מובילים ופרס יומי על רצף כניסות.
//
// מסכים: hub (ראשי) -> mode (בחירת יריב) -> search (מחפשים יריב) -> match (משחק).
// המשחק עצמו (חוקים, רובוט) ב-games-logic.js, החדר ב-games-room.js, הנקודות ב-games-store.js.

import { t, tn, LOCALE } from './i18n.js?v=1.6.0-mvn1g0s1';
import { escapeHtml, showToast } from './ui.js?v=1.6.0-mvn1g0s1';
import { vibrate } from './settings.js?v=1.6.0-mvn1g0s1';
import { celebrate, stagger } from './fx.js?v=1.6.0-mvn1g0s1';
import { requireSignIn } from './auth-gate.js?v=1.6.0-mvn1g0s1';
import { accountInfo } from './account.js?v=1.6.0-mvn1g0s1';
import { trackFeature } from './analytics.js?v=1.6.0-mvn1g0s1';
import { isFirebaseConfigured } from '../firebase-config.js?v=1.6.0-mvn1g0s1';
import { GAMES, GAME_IDS, POINTS, DAILY_REWARDS, FALSE_START, readyMs, REACT_MISS_MS } from './games-logic.js?v=1.6.0-mvn1g0s1';
import { BotRoom, Matchmaker } from './games-room.js?v=1.6.0-mvn1g0s1';
import { boardHtml, statusText, seriesScore, padContent } from './games-boards.js?v=1.6.0-mvn1g0s1';
import * as store from './games-store.js?v=1.6.0-mvn1g0s1';

const BACK_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M4 11h12.2l-5.6-5.6L12 4l8 8-8 8-1.4-1.4 5.6-5.6H4v-2Z"/></svg>';

const OFFER_BOT_AFTER_S = 8;   // אחרי כמה שניות של חיפוש מציעים רובוט
const IDLE_WARN_S = 20;        // היריב לא זז: מתחילים להזהיר
const IDLE_CLAIM_MS = 45000;   // ... ואחרי כל כך הרבה זמן מקבלים ניצחון
const MY_TURN_WARN_S = 30;     // התור שלי: מזהירים שהזמן אוזל

const num = (n) => Number(n || 0).toLocaleString(LOCALE);
const initialOf = (name) => escapeHtml(String(name || '?').trim().charAt(0).toUpperCase());

export class GamesView {
  /** onBadge(true / false): נקודה על הלשונית – פרס יומי שלא נלקח, או תור שלי במשחק שברקע */
  constructor(root, { onBadge } = {}) {
    this.root = root;
    this.body = root.querySelector('#games-body');
    this.onBadge = onBadge;
    this.screen = 'hub';
    this.game = null;
    this.room = null;
    this.matchmaker = null;
    this.unRoom = null;
    this.board = 'week';
    this.lb = {};
    this.loadState = 'idle';
    this.award = null;
    this.rx = null;
    this.tickTimer = null;
    this.claiming = false;   // פרס יומי בדרך
    this.claimed = false;    // ביקשנו ניצחון על יריב שלא מגיב
    this.claimedAt = 0;
    this.statusBase = '';

    root.addEventListener('click', (e) => this.#onClick(e));
    // "מי מהיר יותר?" נמדד בנגיעה עצמה (לא בשחרור), כדי שלא יתווספו עשרות מילישניות
    root.addEventListener('pointerdown', (e) => {
      const pad = e.target.closest('[data-react]');
      if (pad) {
        e.preventDefault();
        this.#reactTap();
      }
    });

    // נקודות שנשארו במכשיר מהפעם הקודמת (למשל כשלא הייתה קליטה) נשלחות אחרי שהאפליקציה כבר פתוחה
    if (store.hasPending()) setTimeout(() => store.flushPending(), 8000);

    store.onGamesChange(() => {
      if (!this.root.hidden && this.screen === 'hub') this.#renderHub();
      this.#syncBadge();
    });
    this.#syncBadge();
  }

  // ---------- חיי המסך ----------

  show({ reset = false } = {}) {
    this.root.hidden = false;
    if (reset && (this.screen === 'mode' || this.screen === 'search')) this.#toHub();
    this.#render();
    if (this.screen === 'hub') this.#refreshHub();
    this.root.scrollTop = 0;
    this.#syncBadge();
  }

  hide() {
    this.root.hidden = true;
    this.#syncBadge(); // משחק שממשיך ברקע: נקודה כשהתור שלי
  }

  /** "חזור" של אנדרואיד. true = טיפלנו בזה */
  handleBack() {
    const modal = document.querySelector('.gm-modal');
    if (modal) {
      modal.remove();
      return true;
    }
    if (this.screen === 'hub') return false;
    if (this.screen === 'match') this.#onLeave();
    else this.#toHub();
    return true;
  }

  get inMatch() {
    return this.screen === 'match' && !!this.room;
  }

  refreshBadge() {
    this.#syncBadge();
  }

  #syncBadge() {
    const v = this.room?.view;
    const myTurn = !!v && !v.over && v.waitingOn.includes(v.me) && this.root.hidden;
    this.onBadge?.(store.hasUnclaimedReward() || myTurn);
  }

  #toHub() {
    this.matchmaker?.cancel();
    this.matchmaker = null;
    this.#stopTick();
    this.screen = 'hub';
    this.game = null;
    this.#render();
    this.#refreshHub();
  }

  #render() {
    this.root.classList.toggle('is-sub', this.screen !== 'hub');
    switch (this.screen) {
      case 'mode': return this.#renderMode();
      case 'search': return this.#renderSearch();
      case 'match': return this.#renderMatch();
      default: return this.#renderHub();
    }
  }

  // ---------- מסך ראשי ----------

  #refreshHub(force = false) {
    if (!isFirebaseConfigured()) {
      this.loadState = 'offline';
      this.#renderHub();
      return;
    }
    if (this.loadState !== 'ok') this.loadState = 'loading';
    store.loadProfile()
      .then(() => { this.loadState = 'ok'; })
      .catch((err) => { if (this.loadState !== 'ok') this.loadState = err?.code === 'sign-in-required' ? 'signin' : 'error'; })
      .finally(() => {
        if (this.screen === 'hub') this.#renderHub();
      });
    this.#loadBoard(this.board, force);
  }

  #renderHub() {
    const p = store.getProfile();
    this.body.innerHTML = `
      ${this.#heroHtml(p)}
      ${this.#dailyHtml(p)}
      <h2 class="gm-h2">${t('בחרו משחק')}</h2>
      <div class="gm-grid">
        ${GAME_IDS.map((id) => {
          const g = GAMES[id];
          return `<button class="gm-game" type="button" data-game="${id}">
            <span class="gm-game-emoji" aria-hidden="true">${g.emoji}</span>
            <strong>${t(g.name)}</strong>
            <small>${t(g.blurb)}</small>
            <span class="gm-game-time">${t('כ-{n} דק׳', { n: g.minutes })}</span>
          </button>`;
        }).join('')}
      </div>
      <h2 class="gm-h2">${t('טבלת מובילים')}</h2>
      <div class="seg seg-wide gm-seg" role="group" aria-label="${t('טבלת מובילים')}">
        <button type="button" data-board="week" class="${this.board === 'week' ? 'is-active' : ''}">${t('השבוע')}</button>
        <button type="button" data-board="all" class="${this.board === 'all' ? 'is-active' : ''}">${t('כל הזמן')}</button>
      </div>
      <div data-lb>${this.#boardHtml()}</div>
      <p class="set-note">${t('הטבלה השבועית מתאפסת בכל יום ראשון. מול רובוט מקבלים מעט נקודות, מול אדם הרבה יותר.')}</p>`;
    if (!this.staggered) {
      this.staggered = true;
      stagger(this.body, ':scope > *', 40);
    }
  }

  #heroHtml(p) {
    if (!p) {
      const text = {
        offline: t('המשחקים מול אחרים דורשים חיבור לחשבון'),
        signin: t('התחברו עם Google כדי לשחק מול אחרים ולצבור נקודות'),
        error: t('אין חיבור כרגע – אפשר לשחק מול רובוט, והנקודות יישמרו כשיחזור החיבור')
      }[this.loadState];
      return `<section class="gm-card gm-hero">
        <span class="gm-avatar">🎮</span>
        <div class="gm-hero-text"><strong>${t('המשחקים של Walkie')}</strong>
        <small>${text ?? t('טוענים…')}</small></div>
        ${this.loadState === 'error' ? `<button class="btn-secondary btn-sm" type="button" data-action="retry">${t('נסו שוב')}</button>` : ''}
      </section>`;
    }
    const stats = p.played ? t('שיחקתם {n} · ניצחתם {w}', { n: p.played, w: p.wins }) : t('עוד לא שיחקתם – בואו נתחיל');
    return `<section class="gm-card gm-hero">
      <span class="gm-avatar">${initialOf(p.name)}</span>
      <div class="gm-hero-text">
        <strong>${escapeHtml(p.name)}
          <button class="gm-edit" type="button" data-action="rename" aria-label="${t('שינוי כינוי')}">✏️</button></strong>
        <small>${stats}</small>
      </div>
      <div class="gm-points" aria-label="${t('נקודות')}"><span aria-hidden="true">⭐</span> ${num(p.points)}</div>
    </section>`;
  }

  #dailyHtml(p) {
    if (!p) return '';
    const d = store.dailyStatus();
    const days = DAILY_REWARDS.map((r, i) => {
      const done = i < d.dayIndex || (i === d.dayIndex && d.claimedToday);
      const today = i === d.dayIndex;
      const last = i === DAILY_REWARDS.length - 1;
      return `<li class="gm-day${done ? ' is-done' : ''}${today ? ' is-today' : ''}${last ? ' is-big' : ''}">
        <span class="gm-day-icon" aria-hidden="true">${done ? '✓' : last ? '🎁' : '⭐'}</span>
        <b>+${r}</b><small>${t('יום {n}', { n: i + 1 })}</small>
      </li>`;
    }).join('');
    const streak = d.streak > 0
      ? tn(d.streak, '🔥 יום אחד ברצף', '🔥 {n} ימים ברצף')
      : t('התחילו רצף – כל יום שנכנסים מקבלים עוד');
    const action = d.claimedToday
      ? `<p class="gm-claimed">✓ ${t('הפרס של היום נלקח')} · ${t('מחר +{n}', { n: d.nextReward })}</p>`
      : `<button class="btn-go gm-claim" type="button" data-action="claim">${t('קבלו +{n} נקודות', { n: d.reward })}</button>`;
    return `<section class="gm-card gm-daily${d.claimedToday ? ' is-claimed' : ''}">
      <div class="gm-daily-head"><h2 class="gm-h">🎁 ${t('הפרס היומי')}</h2><span class="gm-streak">${streak}</span></div>
      <ol class="gm-days">${days}</ol>
      ${action}
    </section>`;
  }

  async #loadBoard(kind, force = false) {
    if (!isFirebaseConfigured()) return;
    const cur = this.lb[kind];
    if (!cur || force || cur.status === 'error') this.lb[kind] = { status: 'loading', data: cur?.data ?? null };
    this.#paintBoard();
    try {
      const data = await store.fetchLeaderboard(kind, { force });
      this.lb[kind] = { status: 'ok', data };
    } catch (err) {
      console.warn('[games] leaderboard failed', err?.code ?? err?.message);
      this.lb[kind] = { status: 'error', data: this.lb[kind]?.data ?? null };
    }
    this.#paintBoard();
  }

  #paintBoard() {
    const el = this.body.querySelector('[data-lb]');
    if (el) el.innerHTML = this.#boardHtml();
  }

  #boardHtml() {
    const st = this.lb[this.board];
    if (!st || (st.status === 'loading' && !st.data)) return `<p class="gm-empty">${t('טוענים…')}</p>`;
    if (st.status === 'error' && !st.data) {
      return `<p class="gm-empty">${t('לא הצלחנו לטעון את הטבלה')} <button class="btn-secondary btn-sm" type="button" data-action="retry-board">${t('נסו שוב')}</button></p>`;
    }
    const { rows, me } = st.data;
    if (!rows.length) return `<p class="gm-empty">${t('עוד אין מובילים – תהיו הראשונים! 🏆')}</p>`;
    const row = (r, rank, mine) => `<li class="gm-lb-row${mine ? ' is-me' : ''}">
      <span class="gm-rank">${rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}</span>
      <span class="gm-avatar sm">${initialOf(r.name)}</span>
      <span class="gm-lb-name">${escapeHtml(r.name)}${mine ? ` <small>(${t('אתם')})</small>` : ''}</span>
      <b class="gm-lb-pts">${num(r.points)}</b>
    </li>`;
    const list = rows.map((r, i) => row(r, i + 1, r.uid === me.uid)).join('');
    const outside = me.points > 0 && me.rank > rows.length
      ? `<li class="gm-lb-gap" aria-hidden="true">⋯</li>${row({ name: store.getProfile()?.name ?? '', points: me.points }, me.rank, true)}`
      : '';
    return `<ol class="gm-lb">${list}${outside}</ol>`;
  }

  // ---------- לחיצות ----------

  #onClick(e) {
    const el = e.target.closest('[data-game], [data-action], [data-board], [data-cell], [data-col], [data-pick]');
    if (!el) return;
    const d = el.dataset;

    if (d.game) return this.#openMode(d.game);
    if (d.board) {
      this.board = d.board;
      this.#renderHub();
      this.#loadBoard(this.board);
      return;
    }
    if (d.cell !== undefined) return this.#move({ cell: Number(d.cell) });
    if (d.col !== undefined) return this.#move({ col: Number(d.col) });
    if (d.pick) return this.#move({ pick: d.pick });

    switch (d.action) {
      case 'back': return this.#toHub();
      case 'play-human': return this.#startHuman(this.game);
      case 'play-bot': return this.#startBot(this.game);
      case 'cancel-search': return this.#cancelSearch();
      case 'leave': return this.#onLeave();
      case 'rematch': return this.room?.rematch();
      case 'new-opp': return this.#newOpponent();
      case 'claim': return this.#claim(el);
      case 'rename': return this.#askName();
      case 'retry': return this.#refreshHub(true);
      case 'retry-board': return this.#loadBoard(this.board, true);
      default: return undefined;
    }
  }

  async #claim(btn) {
    if (this.claiming) return;
    if (!requireSignIn(t('לקבל פרס יומי'), () => this.#claim(btn))) return;
    this.claiming = true;
    btn.disabled = true;
    try {
      const pts = await store.claimDaily();
      if (pts) {
        celebrate(btn, 40);
        vibrate([20, 40, 20]);
        showToast(t('קיבלתם {n} נקודות! 🎉', { n: pts }), 4200);
        trackFeature('games_daily_claim');
        store.invalidateLeaderboards();
        this.#loadBoard(this.board, true);
      } else {
        showToast(t('הפרס של היום כבר נלקח'));
      }
    } catch (err) {
      console.warn('[games] claim failed', err?.code ?? err?.message);
      showToast(t('לא הצלחנו לקחת את הפרס – בדקו חיבור ונסו שוב'));
      btn.disabled = false;
    } finally {
      this.claiming = false;
      this.#syncBadge();
    }
  }

  #askName() {
    document.querySelector('.gm-modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'gm-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `<form class="gm-modal-card">
      <h2 class="gm-h">${t('איך לקרוא לכם?')}</h2>
      <p class="gm-sub">${t('הכינוי מוצג ליריבים ובטבלת המובילים. בלי שם מלא ובלי פרטים אישיים.')}</p>
      <input class="gm-input" name="name" maxlength="14" autocomplete="off" value="${escapeHtml(store.getProfile()?.name ?? '')}" aria-label="${t('כינוי')}">
      <div class="gm-modal-actions">
        <button class="btn-secondary" type="button" data-close>${t('ביטול')}</button>
        <button class="btn" type="submit">${t('שמירה')}</button>
      </div>
    </form>`;
    const close = () => modal.remove();
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close]')) close();
    });
    modal.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = new FormData(e.target).get('name');
      try {
        await store.setNickname(name);
        showToast(t('הכינוי עודכן'));
        store.invalidateLeaderboards();
        this.#loadBoard(this.board, true);
        close();
      } catch (err) {
        showToast(err?.code === 'empty' ? t('צריך לכתוב כינוי') : t('לא הצלחנו לשמור – נסו שוב'));
      }
    });
    document.body.appendChild(modal);
    const input = modal.querySelector('input');
    input.focus();
    input.select();
  }

  // ---------- בחירת יריב וחיפוש ----------

  #openMode(gameId) {
    this.game = gameId;
    this.screen = 'mode';
    this.#render();
    this.root.scrollTop = 0;
  }

  #renderMode() {
    const g = GAMES[this.game];
    this.body.innerHTML = `
      <div class="gm-top"><button class="icon-btn" type="button" data-action="back" aria-label="${t('חזרה')}">${BACK_SVG}</button>
        <h1 class="gm-top-title">${t(g.name)}</h1></div>
      <section class="gm-card gm-mode">
        <div class="gm-mode-emoji" aria-hidden="true">${g.emoji}</div>
        <p class="gm-rules">${t(g.rules)}</p>
        <ul class="gm-pts">
          <li>${t('ניצחון')} <b>+${POINTS.win}</b></li>
          <li>${t('תיקו')} <b>+${POINTS.draw}</b></li>
          <li>${t('הפסד')} <b>+${POINTS.loss}</b></li>
        </ul>
        <button class="btn-go" type="button" data-action="play-human">🚌 ${t('שחקו מול מישהו שמחכה לאוטובוס')}</button>
        <button class="btn-secondary gm-wide" type="button" data-action="play-bot">🤖 ${t('אימון מול רובוט')} <small>(${t('עד +{n} נקודות', { n: POINTS.botWin })})</small></button>
        <p class="set-note">${t('מי שיוצא באמצע משחק נותן ליריב ניצחון. אם האוטובוס הגיע – סעו, זה בסדר 🚌')}</p>
      </section>`;
  }

  #myName() {
    const first = String(accountInfo()?.name ?? '').trim().split(/\s+/)[0] ?? '';
    return store.getProfile()?.name || store.cleanName(first) || t('נוסע');
  }

  async #startHuman(gameId) {
    if (!gameId || this.matchmaker) return;
    if (!requireSignIn(t('לשחק מול אחרים'), () => this.#startHuman(gameId))) return;
    trackFeature(`game_${gameId}_search`);
    this.game = gameId;
    this.screen = 'search';
    this.searchStart = Date.now();
    this.#render();
    this.#startTick();

    const mm = new Matchmaker(gameId, this.#myName());
    this.matchmaker = mm;
    try {
      const room = await mm.start();
      if (this.matchmaker !== mm) {
        room.leave(); // בינתיים ביטלנו
        return;
      }
      this.matchmaker = null;
      this.#enterMatch(room);
    } catch (err) {
      if (this.matchmaker === mm) this.matchmaker = null;
      if (err?.code === 'cancelled' || this.screen !== 'search') return;
      console.warn('[games] matchmaking failed', err?.code ?? err?.message);
      showToast(err?.code === 'sign-in-required' ? t('צריך להתחבר עם Google כדי לשחק מול אחרים') : t('אין חיבור כרגע – אפשר לשחק מול רובוט'), 4200);
      this.#stopTick();
      this.#openMode(gameId);
    }
  }

  #cancelSearch() {
    this.matchmaker?.cancel();
    this.matchmaker = null;
    this.#stopTick();
    this.#openMode(this.game);
  }

  #renderSearch() {
    const g = GAMES[this.game];
    this.body.innerHTML = `
      <div class="gm-top"><button class="icon-btn" type="button" data-action="cancel-search" aria-label="${t('ביטול')}">${BACK_SVG}</button>
        <h1 class="gm-top-title">${g.emoji} ${t(g.name)}</h1></div>
      <section class="gm-card gm-search">
        <div class="gm-bus" aria-hidden="true">🚌</div>
        <h2 class="gm-h">${t('מחפשים מישהו שמחכה לאוטובוס כמוכם…')}</h2>
        <p class="gm-sub" data-elapsed role="status">${t('{n} שנ׳', { n: 0 })}</p>
        <div class="gm-offer" data-offer hidden>
          <p class="gm-sub">${t('אף אחד עוד לא כאן. לשחק מול רובוט בינתיים?')}</p>
          <button class="btn-go" type="button" data-action="play-bot">🤖 ${t('שחקו מול רובוט')}</button>
        </div>
        <button class="btn-secondary" type="button" data-action="cancel-search">${t('ביטול')}</button>
      </section>`;
  }

  #startBot(gameId) {
    if (!gameId) return;
    this.matchmaker?.cancel();
    this.matchmaker = null;
    this.game = gameId;
    this.#enterMatch(new BotRoom(gameId, this.#myName()));
  }

  #newOpponent() {
    const game = this.room?.game ?? this.game;
    this.#leaveRoom();
    this.#startHuman(game);
  }

  // ---------- משחק ----------

  #enterMatch(room) {
    this.room = room;
    this.game = room.game;
    this.screen = 'match';
    this.award = null;
    this.rx = null;
    trackFeature(`game_${room.game}_${room.bot ? 'bot' : 'human'}`);
    this.unRoom = room.onChange((v) => this.#onRoom(v));
    this.#render();
    this.#startTick();
    vibrate(30);
  }

  #leaveRoom() {
    this.unRoom?.();
    this.unRoom = null;
    const room = this.room;
    this.room = null;
    this.rx = null;
    this.#clearReactTimers();
    this.#stopTick();
    room?.leave();
    store.invalidateLeaderboards();
    this.#syncBadge();
  }

  #onLeave() {
    const v = this.room?.view;
    if (v && !v.over) {
      if (!v.bot && !confirm(t('לצאת מהמשחק? היריב יקבל את הניצחון.'))) return;
      if (!v.bot) store.recordResult({ mode: 'human', result: 'quit', key: `${v.id}#${v.gameNo}` });
    }
    this.#leaveRoom();
    this.screen = 'hub';
    this.game = null;
    this.#render();
    this.#refreshHub(true);
  }

  #renderMatch() {
    const g = GAMES[this.room.game];
    this.body.innerHTML = `
      <div class="gm-top">
        <button class="gm-leave" type="button" data-action="leave">🚌 ${t('האוטובוס הגיע? יציאה')}</button>
        <span class="gm-top-game">${g.emoji} ${t(g.name)}</span>
      </div>
      <div class="gm-players" data-players></div>
      <p class="gm-status" data-status role="status"></p>
      <div class="gm-board" data-board></div>
      <section class="gm-card gm-result" data-result hidden></section>`;
    this.#updateMatch(this.room.view);
  }

  #onRoom(v) {
    if (!v || this.screen !== 'match') return;
    if (v.gone && !v.over) {
      showToast(t('המשחק נסגר'));
      this.#leaveRoom();
      this.screen = 'hub';
      this.#render();
      this.#refreshHub(true);
      return;
    }
    this.#settle(v);
    this.#updateMatch(v);
    this.#syncBadge();
  }

  /** נקודות על משחק שהסתיים (פעם אחת לכל משחק) */
  #settle(v) {
    if (!v.over || !v.result) return;
    const key = `${v.id}#${v.gameNo}`;
    if (this.award?.key === key) return;
    const pts = store.recordResult({ mode: v.bot ? 'bot' : 'human', result: v.result, key });
    this.award = { key, pts };
    if (v.result === 'win' || v.result === 'forfeitWin') {
      celebrate(null, 44);
      vibrate([25, 50, 25]);
    } else {
      vibrate(20);
    }
  }

  #updateMatch(v) {
    const $ = (s) => this.body.querySelector(s);
    const status = $('[data-status]');
    if (!status) return;
    if (!v) {
      status.textContent = t('מתחברים למשחק…');
      return;
    }
    if (v.game === 'react') this.#reactSync(v);

    const sc = seriesScore(v);
    const turnBased = v.game === 'xo' || v.game === 'c4';
    const side = (i, cls) => `<div class="gm-player ${cls}${turnBased && !v.over && v.waitingOn.includes(i) ? ' is-turn' : ''}">
        <span class="gm-avatar p${i}">${initialOf(v.names[i])}</span>
        <span class="gm-pname"><b>${escapeHtml(v.names[i])}</b>${i === v.me ? `<small>${t('אתם')}</small>` : ''}</span>
        ${this.#markHtml(v.game, i)}
      </div>`;
    const players = $('[data-players]');
    players.className = `gm-players is-${v.game}`;
    players.innerHTML = `${side(v.me, 'is-me')}
      <div class="gm-vs">${sc ? `<b>${sc[0]}</b><i>:</i><b>${sc[1]}</b>` : 'VS'}</div>
      ${side(1 - v.me, 'is-opp')}`;

    this.statusBase = statusText(v);
    status.textContent = this.statusBase;
    $('[data-board]').innerHTML = boardHtml(v, this.rx);
    this.#paintResult(v);
  }

  #markHtml(game, i) {
    if (game === 'xo') return `<span class="gm-mark xo p${i}" aria-hidden="true">${i === 0 ? '✕' : '◯'}</span>`;
    if (game === 'c4') return `<span class="gm-mark disc p${i}" aria-hidden="true"></span>`;
    return '';
  }

  #paintResult(v) {
    const el = this.body.querySelector('[data-result]');
    if (!el) return;
    if (!v.over) {
      el.hidden = true;
      return;
    }
    const timeout = v.end?.reason === 'timeout';
    const [emoji, title] = {
      win: ['🏆', t('ניצחון!')],
      loss: ['😅', timeout ? t('לא הגבתם בזמן – היריב ניצח') : t('הפסדתם הפעם')],
      draw: ['🤝', t('תיקו')],
      forfeitWin: timeout
        ? ['⏱️', t('אין תגובה מ-{name} – הניצחון שלכם', { name: v.names[1 - v.me] })]
        : ['🚌', t('{name} כבר לא במשחק (אולי האוטובוס הגיע?) – הניצחון שלכם', { name: v.names[1 - v.me] })]
    }[v.result] ?? ['🏁', t('המשחק הסתיים')];

    const pts = this.award?.pts ?? 0;
    let ptsText = '';
    if (pts > 0) ptsText = `<p class="gm-result-pts"><span class="gm-num">+${pts}</span> ${t('נקודות')}</p>`;
    else if (v.bot && (v.result === 'win' || v.result === 'draw')) ptsText = `<p class="gm-sub">${t('הגעתם לתקרת הנקודות היומית מול רובוט. מול אדם אפשר להמשיך לצבור.')}</p>`;

    let again = '';
    if (!v.end && !v.oppLeft) {
      if (v.rematch[v.me]) again = `<button class="btn-go" type="button" disabled>${escapeHtml(t('ממתינים ל-{name}…', { name: v.names[1 - v.me] }))}</button>`;
      else if (v.rematch[1 - v.me]) again = `<button class="btn-go" type="button" data-action="rematch">${escapeHtml(t('{name} רוצה עוד סיבוב – מתחילים!', { name: v.names[1 - v.me] }))}</button>`;
      else again = `<button class="btn-go" type="button" data-action="rematch">${t('משחק חוזר')}</button>`;
    }
    const note = v.oppLeft && !v.end ? `<p class="gm-sub">${t('{name} כבר לא בחדר', { name: v.names[1 - v.me] })}</p>` : '';

    const first = el.hidden;
    el.hidden = false;
    el.innerHTML = `
      <div class="gm-result-emoji" aria-hidden="true">${emoji}</div>
      <h2 class="gm-h">${escapeHtml(title)}</h2>
      ${ptsText}${note}
      <div class="gm-result-actions">
        ${again}
        <button class="btn-secondary" type="button" data-action="new-opp">${v.bot ? `🚌 ${t('שחקו מול אדם')}` : t('יריב חדש')}</button>
        <button class="btn-secondary" type="button" data-action="leave">${t('חזרה למשחקים')}</button>
      </div>`;
    if (first) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80); // הכפתורים מתחת ללוח
  }

  #move(move) {
    const v = this.room?.view;
    if (!v || v.over) return;
    vibrate(8);
    this.room.submit(move);
  }

  // ---------- "מי מהיר יותר?": ציר הזמן של הסיבוב ----------

  #clearReactTimers() {
    for (const id of this.rx?.timers ?? []) clearTimeout(id);
    if (this.rx) this.rx.timers = [];
  }

  /** מסנכרן את ציר הזמן המקומי (הכנה, המתנה, ירוק) עם המצב: סיבוב חדש = מחזור חדש */
  #reactSync(v) {
    const s = v.state;
    if (!this.rx) this.rx = { round: 0, gameNo: 0, phase: 'ready', mine: null, goAt: 0, timers: [] };
    const rx = this.rx;
    if (v.over) {
      this.#clearReactTimers();
      return;
    }
    if (s.round !== rx.round || v.gameNo !== rx.gameNo) {
      this.#clearReactTimers();
      Object.assign(rx, { round: s.round, gameNo: v.gameNo, phase: 'ready', mine: null });
      rx.timers.push(setTimeout(() => {
        rx.phase = 'wait';
        this.#drawPad();
        rx.timers.push(setTimeout(() => {
          rx.phase = 'go';
          rx.goAt = performance.now();
          this.#drawPad();
          rx.timers.push(setTimeout(() => this.#reactSubmit(REACT_MISS_MS), REACT_MISS_MS));
        }, s.delay));
      }, readyMs(s.round)));
    }
    if (s.t[v.me] !== -1 && rx.phase !== 'sent') {
      this.#clearReactTimers();
      Object.assign(rx, { phase: 'sent', mine: s.t[v.me] });
    }
  }

  #drawPad() {
    const v = this.room?.view;
    const pad = this.body.querySelector('.gm-pad');
    if (!v || !pad) return;
    const { cls, text } = padContent(v, this.rx);
    pad.className = `gm-pad ${cls}`;
    pad.firstElementChild.innerHTML = text;
  }

  #reactTap() {
    const rx = this.rx;
    if (!rx || this.room?.game !== 'react') return;
    if (rx.phase === 'wait') this.#reactSubmit(FALSE_START);
    else if (rx.phase === 'go') this.#reactSubmit(Math.round(performance.now() - rx.goAt));
  }

  #reactSubmit(ms) {
    const rx = this.rx;
    if (!rx || (rx.phase !== 'wait' && rx.phase !== 'go')) return;
    this.#clearReactTimers();
    Object.assign(rx, { phase: 'sent', mine: ms });
    vibrate(ms >= FALSE_START ? [30, 40, 30] : 12);
    this.#drawPad();
    this.room?.submit({ ms });
  }

  // ---------- שעון (חיפוש ויריב שלא מגיב) ----------

  #startTick() {
    this.#stopTick();
    this.tickTimer = setInterval(() => this.#tick(), 1000);
  }

  #stopTick() {
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  #tick() {
    if (this.screen === 'search') {
      const s = Math.floor((Date.now() - this.searchStart) / 1000);
      const el = this.body.querySelector('[data-elapsed]');
      if (el) el.textContent = t('{n} שנ׳', { n: s });
      const offer = this.body.querySelector('[data-offer]');
      if (offer && s >= OFFER_BOT_AFTER_S) offer.hidden = false;
      return;
    }
    const room = this.room;
    const v = room?.view;
    if (!v || v.bot || v.over) return;
    const status = this.body.querySelector('[data-status]');
    if (!status) return;

    const waitingMe = v.waitingOn.includes(v.me);
    const waitingOpp = v.waitingOn.some((i) => i !== v.me);
    const idleS = Math.floor(v.idleMs / 1000);
    const left = Math.max(0, Math.ceil((IDLE_CLAIM_MS - v.idleMs) / 1000));
    if (waitingOpp && !waitingMe) {
      if (idleS >= IDLE_WARN_S) status.textContent = t('אין תגובה מ-{name}… ניצחון בעוד {n} שנ׳', { name: v.names[1 - v.me], n: left });
      if (v.idleMs >= IDLE_CLAIM_MS && (!this.claimed || Date.now() - this.claimedAt > 10000)) {
        this.claimed = true;
        this.claimedAt = Date.now(); // לא הצליח? ננסה שוב בעוד כמה שניות
        room.claimTimeout();
      }
    } else if (waitingMe && idleS >= MY_TURN_WARN_S) {
      status.textContent = t('זזים! עוד {n} שנ׳ לפני שהיריב מנצח', { n: left });
    } else if (status.textContent !== this.statusBase) {
      status.textContent = this.statusBase ?? '';
    }
    if (!waitingOpp || waitingMe) this.claimed = false;
  }
}
