// משחקים: חדר משחק בין שני שחקנים (Firestore, בזמן אמת), חיפוש יריב, ורובוט כשאין אף אחד.
//
// לשני סוגי החדרים אותו ממשק, כך שהמסך לא צריך לדעת מול מי משחקים:
//   room.view            -> { id, game, bot, me, names, state, end, over, result, gameNo, rematch, oppLeft, waitingOn, idleMs, gone }
//   room.onChange(fn)    -> מנוי לשינויים (מחזיר פונקציית ביטול)
//   room.submit(move)    -> מהלך (מתבצע מיד אצלי, ומגיע ליריב בזמן אמת)
//   room.rematch()       -> "משחק חוזר" (כשגם היריב מסכים)
//   room.claimTimeout()  -> היריב לא מגיב: ניצחון
//   room.leave()         -> יציאה (באמצע משחק = ויתור)
//
// חדר מקוון: מסמך אחד ב-gameRooms/{id}. כל מהלך הוא טרנזקציה שמריצה את אותם חוקים (games-logic.js)
// על המצב העדכני, ולכן שני שחקנים שלוחצים באותו רגע לא דורסים זה את זה.

import { getFirebase, ensureSignedIn } from '../firebase-config.js?v=1.6.0-mvn1g0s1';
import { GAMES, ONGOING, resultFor } from './games-logic.js?v=1.6.0-mvn1g0s1';
import { t } from './i18n.js?v=1.6.0-mvn1g0s1';

const HEARTBEAT_MS = 15000;  // חדר שממתין ליריב מרענן את עצמו, כדי שאחרים ידעו שהוא חי
const SEARCH_EVERY_MS = 3000;
const FRESH_MS = 45000;      // חדר שלא התרענן כל כך הרבה זמן – כנראה ננטש
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

function makeView(room, { state, end, over, names, gameNo, rematch, oppLeft, idleMs, gone = false }) {
  return {
    id: room.id,
    game: room.game,
    bot: room.bot,
    me: room.me,
    names,
    state,
    end,
    over,
    result: over ? resultFor(state, end, room.me) : null,
    gameNo,
    rematch,
    oppLeft,
    waitingOn: over ? [] : room.logic.waitingOn(state),
    idleMs,
    gone
  };
}

class RoomBase {
  constructor(game) {
    this.game = game;
    this.logic = GAMES[game].logic;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.view);
  }
}

// ---------- מול רובוט ----------

export class BotRoom extends RoomBase {
  constructor(game, myName) {
    super(game);
    this.bot = true;
    this.id = `bot-${Date.now().toString(36)}`;
    this.me = Math.random() < 0.5 ? 0 : 1;
    this.botIdx = 1 - this.me;
    this.names = ['', ''];
    this.names[this.me] = myName;
    this.names[this.botIdx] = t('הרובוט');
    this.gameNo = 1;
    this.state = this.logic.init(Math.random);
    this.timer = null;
    this.closed = false;
    setTimeout(() => this.#think(), 0);
  }

  get view() {
    return makeView(this, {
      state: this.state,
      end: null,
      over: this.state.winner !== ONGOING,
      names: this.names,
      gameNo: this.gameNo,
      rematch: [false, false],
      oppLeft: false,
      idleMs: 0
    });
  }

  async submit(move) {
    if (this.closed) return false;
    const next = this.logic.apply(this.state, move, this.me, Math.random);
    if (!next) return false;
    this.state = next;
    this.emit();
    this.#think();
    return true;
  }

  #think() {
    if (this.closed || this.timer) return;
    const plan = this.logic.botPlan(this.state, this.botIdx, Math.random);
    if (!plan) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.closed) return;
      const next = this.logic.apply(this.state, plan.move, this.botIdx, Math.random);
      if (next) {
        this.state = next;
        this.emit();
      }
      this.#think();
    }, plan.afterMs);
  }

  async rematch() {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.gameNo++;
    this.state = this.logic.init(Math.random);
    this.emit();
    this.#think();
  }

  async claimTimeout() {}

  async leave() {
    this.closed = true;
    clearTimeout(this.timer);
    this.listeners.clear();
  }
}

// ---------- מול אדם ----------

export class OnlineRoom extends RoomBase {
  constructor({ m, firestore, ref, uid, game }) {
    super(game);
    this.bot = false;
    this.m = m;
    this.firestore = firestore;
    this.ref = ref;
    this.id = ref.id;
    this.uid = uid;
    this.me = -1;
    this.data = null;
    this.gone = false;
    this.lastChangeAt = Date.now();
    this.optimistic = null; // המהלך שלי מוצג מיד, עוד לפני שהשרת אישר
    this.resetting = false;
    this.unsub = this.m.onSnapshot(ref, (snap) => this.#onSnap(snap), (err) => {
      console.warn('[games] room listener failed', err?.code ?? err);
      this.gone = true;
      this.emit();
    });
  }

  #onSnap(snap) {
    if (!snap.exists()) {
      this.gone = true;
      this.emit();
      return;
    }
    const d = snap.data();
    if (!this.data || d.seq !== this.data.seq || d.gameNo !== this.data.gameNo) this.lastChangeAt = Date.now();
    this.data = d;
    this.me = d.p.indexOf(this.uid);
    this.emit();
    this.#maybeStartRematch();
  }

  get state() {
    const d = this.data;
    return this.optimistic && this.optimistic.baseSeq === d.seq ? this.optimistic.state : d.state;
  }

  get view() {
    const d = this.data;
    if (!d) return null;
    const state = this.state;
    const other = 1 - this.me;
    return makeView(this, {
      state,
      end: d.end ?? null,
      over: !!d.end || state.winner !== ONGOING,
      names: d.names,
      gameNo: d.gameNo,
      rematch: d.rematch,
      oppLeft: !!d.left?.[other],
      idleMs: Date.now() - this.lastChangeAt,
      gone: this.gone
    });
  }

  #tx(fn) {
    return this.m.runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(this.ref);
      if (!snap.exists()) throw Object.assign(new Error('gone'), { code: 'gone' });
      return fn(tx, snap.data());
    });
  }

  async submit(move) {
    const d = this.data;
    if (!d || d.status !== 'playing' || d.end || this.me < 0) return false;
    const preview = this.logic.apply(this.state, move, this.me, Math.random);
    if (!preview) return false;
    this.optimistic = { baseSeq: d.seq, state: preview };
    this.emit();
    try {
      await this.#tx((tx, cur) => {
        if (cur.status !== 'playing' || cur.end) throw new Error('closed');
        const next = this.logic.apply(cur.state, move, this.me, Math.random);
        if (!next) throw new Error('illegal');
        tx.update(this.ref, { state: next, seq: cur.seq + 1, updatedAt: this.m.serverTimestamp() });
      });
      return true;
    } catch (err) {
      console.warn('[games] move failed', err?.code ?? err?.message);
      this.optimistic = null;
      this.emit();
      return false;
    }
  }

  async rematch() {
    try {
      await this.#tx((tx, cur) => {
        if (cur.end || cur.state.winner === ONGOING || cur.left?.[1 - this.me]) return;
        const rematch = [...cur.rematch];
        rematch[this.me] = true;
        tx.update(this.ref, { rematch, seq: cur.seq + 1, updatedAt: this.m.serverTimestamp() });
      });
    } catch (err) {
      console.warn('[games] rematch failed', err?.code ?? err?.message);
    }
  }

  /** שני השחקנים ביקשו משחק חוזר: שחקן 0 מאפס את הלוח */
  async #maybeStartRematch() {
    const d = this.data;
    if (this.me !== 0 || this.resetting || d.end || d.state.winner === ONGOING || !d.rematch[0] || !d.rematch[1]) return;
    this.resetting = true;
    try {
      await this.#tx((tx, cur) => {
        if (cur.end || cur.state.winner === ONGOING || !cur.rematch[0] || !cur.rematch[1]) return;
        tx.update(this.ref, {
          state: this.logic.init(Math.random),
          rematch: [false, false],
          gameNo: cur.gameNo + 1,
          seq: cur.seq + 1,
          updatedAt: this.m.serverTimestamp()
        });
      });
    } catch (err) {
      console.warn('[games] rematch reset failed', err?.code ?? err?.message);
    } finally {
      this.resetting = false;
    }
  }

  /** היריב לא מגיב: ניצחון (המסך קורא לזה רק אחרי שהמתין מספיק) */
  async claimTimeout() {
    try {
      await this.#tx((tx, cur) => {
        if (cur.end || cur.state.winner !== ONGOING) return;
        tx.update(this.ref, {
          end: { winner: this.me, reason: 'timeout', by: this.me },
          status: 'done',
          seq: cur.seq + 1,
          updatedAt: this.m.serverTimestamp()
        });
      });
    } catch (err) {
      console.warn('[games] timeout claim failed', err?.code ?? err?.message);
    }
  }

  /** יציאה: באמצע משחק – ויתור (היריב מנצח). אחרי משחק – מסמנים שיצאתי, והאחרון שיוצא מוחק את החדר */
  async leave() {
    this.listeners.clear();
    try {
      await this.#tx((tx, cur) => {
        const left = [...(cur.left ?? [false, false])];
        left[this.me] = true;
        const playing = !cur.end && cur.state.winner === ONGOING && cur.status === 'playing' && cur.p[1];
        if (playing) {
          tx.update(this.ref, {
            end: { winner: 1 - this.me, reason: 'left', by: this.me },
            status: 'done',
            left,
            seq: cur.seq + 1,
            updatedAt: this.m.serverTimestamp()
          });
        } else if (left[1 - this.me] || !cur.p[1] || cur.end?.reason === 'left') {
          tx.delete(this.ref); // כולם יצאו
        } else {
          tx.update(this.ref, { left, seq: cur.seq + 1, updatedAt: this.m.serverTimestamp() });
        }
      });
    } catch {
      // אין קליטה / כבר נמחק – לא חשוב
    }
    this.unsub?.();
  }
}

// ---------- חיפוש יריב ----------

/**
 * כל מי שמחפש פותח חדר ממתין, ובודק כל כמה שניות אם יש חדר ממתין אחר שאפשר להצטרף אליו.
 * מצטרפים רק לחדר עם מזהה קטן יותר משלי, כך ששניים שמחפשים באותו רגע תמיד מתיישבים:
 * הקטן ממתין, והגדול מצטרף אליו (בטרנזקציה, שמוחקת גם את החדר שלו).
 */
export class Matchmaker {
  constructor(game, name) {
    this.game = game;
    this.name = name;
    this.closed = false;
    this.busy = false;
    this.serverNow = 0;   // השעה בשרת, לפי הרענון האחרון של החדר שלי (אין לסמוך על שעון המכשיר)
    this.serverNowAt = 0;
  }

  #now() {
    return this.serverNow + (Date.now() - this.serverNowAt);
  }

  /** מחכה עד שנמצא יריב. מחזיר OnlineRoom, או נכשל אם בוטל / אין חיבור */
  async start() {
    const user = await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    const m = modules.firestore;
    Object.assign(this, { m, firestore, uid: user.uid });
    this.col = m.collection(firestore, 'gameRooms');
    this.ref = m.doc(this.col);

    await m.setDoc(this.ref, {
      game: this.game,
      status: 'waiting',
      open: true,
      p: [this.uid, null],
      names: [this.name, ''],
      state: GAMES[this.game].logic.init(Math.random),
      seq: 0,
      gameNo: 1,
      rematch: [false, false],
      left: [false, false],
      end: null,
      createdAt: m.serverTimestamp(),
      hbAt: m.serverTimestamp(),
      updatedAt: m.serverTimestamp(),
      expireAt: m.Timestamp.fromMillis(Date.now() + ROOM_TTL_MS)
    });
    if (this.closed) {
      this.#drop();
      throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    }

    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.unsub = m.onSnapshot(this.ref, (snap) => {
        if (!snap.exists() || this.closed) return;
        const d = snap.data();
        if (d.hbAt) {
          this.serverNow = d.hbAt.toMillis();
          this.serverNowAt = Date.now();
        }
        if (d.status === 'playing' && d.p[1]) this.#matched(this.ref); // מישהו הצטרף אלי
      }, (err) => this.#fail(err));

      this.hb = setInterval(() => {
        m.updateDoc(this.ref, { hbAt: m.serverTimestamp() }).catch(() => {});
      }, HEARTBEAT_MS);
      this.poll = setInterval(() => this.#search(), SEARCH_EVERY_MS);
      this.#search();
    });
  }

  async #search() {
    if (this.busy || this.closed || !this.serverNow) return;
    this.busy = true;
    const { m } = this;
    try {
      const snap = await m.getDocs(m.query(
        this.col,
        m.where('game', '==', this.game),
        m.where('status', '==', 'waiting'),
        m.orderBy('hbAt', 'desc'),
        m.limit(10)
      ));
      const now = this.#now();
      const candidates = snap.docs
        .filter((d) => {
          const x = d.data();
          return d.id < this.ref.id && x.p?.[0] !== this.uid && x.p?.[1] == null && x.hbAt && now - x.hbAt.toMillis() <= FRESH_MS;
        })
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      for (const c of candidates) {
        if (this.closed) return;
        if (await this.#join(c.ref)) return;
      }
    } catch (err) {
      console.warn('[games] search failed', err?.code ?? err?.message);
    } finally {
      this.busy = false;
    }
  }

  async #join(candidate) {
    const { m, firestore } = this;
    try {
      await m.runTransaction(firestore, async (tx) => {
        const mine = await tx.get(this.ref);
        const theirs = await tx.get(candidate);
        const md = mine.data();
        const td = theirs.data();
        if (!md || md.status !== 'waiting' || md.p[1]) throw new Error('mine-taken'); // מישהו הצטרף אלי באותו רגע
        if (!td || td.status !== 'waiting' || td.p[1]) throw new Error('taken');
        tx.update(candidate, {
          p: [td.p[0], this.uid],
          names: [td.names[0], this.name],
          status: 'playing',
          open: false,
          seq: td.seq + 1,
          updatedAt: m.serverTimestamp()
        });
        tx.delete(this.ref);
      });
    } catch {
      return false;
    }
    this.#matched(candidate);
    return true;
  }

  #stop() {
    this.closed = true;
    clearInterval(this.hb);
    clearInterval(this.poll);
    this.unsub?.();
  }

  #matched(ref) {
    if (this.closed) return;
    this.#stop();
    this.resolve(new OnlineRoom({ m: this.m, firestore: this.firestore, ref, uid: this.uid, game: this.game }));
  }

  #fail(err) {
    if (this.closed) return;
    this.#stop();
    this.#drop();
    this.reject(err);
  }

  #drop() {
    this.m?.deleteDoc(this.ref).catch(() => {});
  }

  cancel() {
    if (this.closed) return;
    this.#stop();
    this.#drop();
    this.reject?.(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
  }
}
