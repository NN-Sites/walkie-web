// משחקים: נקודות, פרס יומי על רצף כניסות ולוחות מובילים (אוסף gameScores ב-Firestore, מסמך אחד לכל משתמש).
//
// הנקודות נרשמות קודם במכשיר (תור כתיבה ב-localStorage) ונשלחות לשרת בקבוצות קטנות, כי כללי Firestore
// מגבילים כמה נקודות אפשר להוסיף בכתיבה אחת ומוודאים הפרש של כמה שניות בין כתיבות (ראו firestore.rules).
// כך נקודות לא הולכות לאיבוד כשאין קליטה, והמשחק עצמו אף פעם לא מחכה לרשת.

import { isFirebaseConfigured, getFirebase, ensureSignedIn } from '../firebase-config.js?v=1.6.0-mvn1g0s1';
import { accountInfo } from './account.js?v=1.6.0-mvn1g0s1';
import { t } from './i18n.js?v=1.6.0-mvn1g0s1';
import { POINTS, dayKey, dayDiff, weekKeyOf, rewardForStreak, DAILY_REWARDS } from './games-logic.js?v=1.6.0-mvn1g0s1';

const KEY = 'walkie:games';
const MIN_GAP_MS = 4600;     // הכללים דורשים 4 שניות בין כתיבות
const CHUNK_MAX_POINTS = 30; // ... ולא יותר מ-30 נקודות בכתיבה (פרס יומי: עד 100)
const CHUNK_MAX_ENTRIES = 3;
const LB_TTL_MS = 30000;
const NAME_MAX = 14;

const EMPTY = { uid: null, profile: null, pending: [], awarded: [], botDay: '', botPts: 0 };

function load() {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...EMPTY };
  }
}

let local = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(local));
  } catch {
    // ignore
  }
}

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function onGamesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- פרופיל ----------

const fromDoc = (d) => ({
  name: d.name ?? '',
  points: d.points | 0,
  weekKey: d.weekKey ?? '',
  weekPoints: d.weekPoints | 0,
  wins: d.wins | 0,
  played: d.played | 0,
  streak: d.streak | 0,
  bestStreak: d.bestStreak | 0,
  lastClaimMs: d.lastClaimAt?.toMillis?.() ?? 0
});

export const getProfile = () => local.profile;

/** נקודות השבוע של הפרופיל (שבוע חדש = מתחילים מאפס, גם לפני הכתיבה הראשונה בו) */
export const weekPointsOf = (p) => (p && p.weekKey === weekKeyOf() ? p.weekPoints : 0);

function defaultName() {
  const first = String(accountInfo()?.name ?? '').trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 12);
  return clean || `${t('נוסע')}${100 + Math.floor(Math.random() * 900)}`;
}

export const cleanName = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

async function handle() {
  const user = await ensureSignedIn();
  const { firestore, modules } = await getFirebase();
  const m = modules.firestore;
  return { m, firestore, uid: user.uid, ref: m.doc(firestore, 'gameScores', user.uid) };
}

// כתיבות לשרת: אחת בכל פעם, עם מרווח מינימלי ביניהן
let chain = Promise.resolve();
let lastWriteAt = 0;

function queued(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

async function paced() {
  const wait = MIN_GAP_MS - (Date.now() - lastWriteAt);
  if (wait > 0) await sleep(wait);
}

/** כתיבה לפרופיל. נכשלה כי הכתיבה הקודמת הייתה קרובה מדי (או רשת רגעית)? ניסיון נוסף אחד */
async function writeProfile(h, patch) {
  for (let attempt = 0; ; attempt++) {
    await paced();
    try {
      await h.m.updateDoc(h.ref, { ...patch, updatedAt: h.m.serverTimestamp() });
      lastWriteAt = Date.now();
      return;
    } catch (err) {
      lastWriteAt = Date.now();
      if (attempt >= 1 || err?.code !== 'permission-denied') throw err;
      await sleep(MIN_GAP_MS);
    }
  }
}

function zeroProfile(name) {
  return { name, points: 0, weekKey: weekKeyOf(), weekPoints: 0, wins: 0, played: 0, streak: 0, bestStreak: 0 };
}

async function readOrCreate(h) {
  const snap = await h.m.getDoc(h.ref);
  if (snap.exists()) return fromDoc(snap.data());
  const fresh = zeroProfile(defaultName());
  await h.m.setDoc(h.ref, { ...fresh, updatedAt: h.m.serverTimestamp() });
  lastWriteAt = Date.now();
  return { ...fresh, lastClaimMs: 0 };
}

/** מוסיף תוצאת משחק לפרופיל שבזיכרון (לפני שהשרת יודע עליה) */
function applyEntry(p, { pts, win, played }) {
  const wk = weekKeyOf();
  Object.assign(p, {
    points: p.points + pts,
    weekPoints: (p.weekKey === wk ? p.weekPoints : 0) + pts,
    weekKey: wk,
    wins: p.wins + win,
    played: p.played + played
  });
}

function adopt(uid, profile) {
  if (local.uid !== uid) local = { ...EMPTY, uid }; // חשבון אחר במכשיר: לא מערבבים נקודות
  local.profile = { ...profile };
  for (const e of local.pending) applyEntry(local.profile, e); // נקודות שעוד לא נשלחו נשארות מוצגות
  save();
  emit();
}

/** טוען את הפרופיל מהשרת (ויוצר אותו בפעם הראשונה). בלי רשת: ממשיכים עם מה ששמור במכשיר */
export async function loadProfile() {
  if (!isFirebaseConfigured()) return local.profile;
  const h = await handle();
  const profile = await queued(() => readOrCreate(h));
  adopt(h.uid, profile);
  flushPending();
  return local.profile;
}

export async function setNickname(raw) {
  const name = cleanName(raw);
  if (!name) throw Object.assign(new Error('empty'), { code: 'empty' });
  const h = await handle();
  await queued(async () => {
    await readOrCreate(h);
    await writeProfile(h, { name });
  });
  local.profile = { ...(local.profile ?? zeroProfile(name)), name };
  save();
  emit();
}

// ---------- נקודות על משחקים ----------

/**
 * רושם תוצאת משחק. mode: 'human' | 'bot'; result: 'win' | 'draw' | 'loss' | 'forfeitWin' | 'quit'.
 * key מזהה את המשחק, כדי שלא יירשם פעמיים. מחזיר כמה נקודות נוספו.
 */
export function recordResult({ mode, result, key }) {
  if (!key || local.awarded.includes(key)) return 0;
  local.awarded = [...local.awarded.slice(-40), key];

  let pts;
  let win = 0;
  let played = 0;
  if (mode === 'bot') {
    pts = result === 'win' ? POINTS.botWin : result === 'draw' ? POINTS.botDraw : POINTS.botLoss;
    const today = dayKey();
    if (local.botDay !== today) Object.assign(local, { botDay: today, botPts: 0 });
    pts = Math.max(0, Math.min(pts, POINTS.botDailyCap - local.botPts));
    local.botPts += pts;
  } else {
    pts = { win: POINTS.win, draw: POINTS.draw, loss: POINTS.loss, forfeitWin: POINTS.forfeitWin }[result] ?? 0;
    played = 1;
    win = result === 'win' || result === 'forfeitWin' ? 1 : 0;
  }

  if (pts || played) {
    const entry = { pts, win, played };
    local.pending.push(entry);
    if (local.profile) applyEntry(local.profile, entry);
  }
  save();
  emit();
  flushPending();
  return pts;
}

let flushing = false;
let retryTimer = null;

export const hasPending = () => local.pending.length > 0;

/** שולח לשרת את הנקודות שמחכות במכשיר (בקבוצות שהכללים מאפשרים) */
export async function flushPending() {
  if (flushing || !local.pending.length || !isFirebaseConfigured()) return;
  flushing = true;
  try {
    const h = await handle();
    while (local.pending.length) {
      const chunk = [];
      let sum = 0;
      for (const e of local.pending) {
        if (chunk.length >= CHUNK_MAX_ENTRIES || (chunk.length && sum + e.pts > CHUNK_MAX_POINTS)) break;
        chunk.push(e);
        sum += e.pts;
      }
      await queued(async () => {
        const server = await readOrCreate(h);
        const wk = weekKeyOf();
        await writeProfile(h, {
          points: h.m.increment(sum),
          wins: h.m.increment(chunk.reduce((a, e) => a + e.win, 0)),
          played: h.m.increment(chunk.reduce((a, e) => a + e.played, 0)),
          weekKey: wk,
          weekPoints: server.weekKey === wk ? h.m.increment(sum) : sum
        });
      });
      local.pending.splice(0, chunk.length);
      save();
    }
    const fresh = await queued(() => readOrCreate(h));
    adopt(h.uid, fresh);
  } catch (err) {
    if (err?.code !== 'sign-in-required') {
      console.warn('[games] sync failed', err?.code ?? err?.message ?? err);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flushPending, 30000); // אין קליטה / שגיאה רגעית: ננסה שוב בקרוב
    }
  } finally {
    flushing = false;
  }
}

// ---------- פרס יומי ----------

/** מצב הפרס היומי של פרופיל (בלי רשת – לפי התאריך בישראל) */
export function dailyStatusFor(profile, now = Date.now()) {
  const today = dayKey(now);
  const lastKey = profile?.lastClaimMs ? dayKey(profile.lastClaimMs) : null;
  const claimedToday = lastKey === today;
  const alive = claimedToday || (lastKey !== null && dayDiff(lastKey, today) === 1); // הרצף לא נשבר
  const streak = alive ? profile.streak : 0;       // הרצף כפי שהוא עכשיו
  const dayStreak = claimedToday ? streak : streak + 1; // היום ברצף שהמשתמש נמצא בו
  return {
    claimedToday,
    streak,
    dayStreak,
    reward: rewardForStreak(dayStreak),
    nextReward: rewardForStreak(dayStreak + 1),
    // מיקום היום בסרגל 7 הימים, וכמה ימים לפניו כבר הושלמו
    dayIndex: (dayStreak - 1) % DAILY_REWARDS.length
  };
}

export const dailyStatus = () => dailyStatusFor(local.profile);

/** יש פרס יומי שעוד לא נלקח? (מציג נקודה על לשונית המשחקים; בלי רשת) */
export const hasUnclaimedReward = () => isFirebaseConfigured() && !dailyStatus().claimedToday;

/** לוקח את הפרס של היום. מחזיר כמה נקודות התקבלו (0 = כבר נלקח, למשל ממכשיר אחר) */
export async function claimDaily() {
  const h = await handle();
  const earned = await queued(async () => {
    const server = await readOrCreate(h);
    const st = dailyStatusFor(server);
    if (st.claimedToday) {
      adopt(h.uid, server);
      return 0;
    }
    const wk = weekKeyOf();
    await writeProfile(h, {
      points: h.m.increment(st.reward),
      weekKey: wk,
      weekPoints: server.weekKey === wk ? h.m.increment(st.reward) : st.reward,
      streak: st.dayStreak,
      bestStreak: Math.max(server.bestStreak, st.dayStreak),
      lastClaimAt: h.m.serverTimestamp()
    });
    adopt(h.uid, {
      ...server,
      points: server.points + st.reward,
      weekKey: wk,
      weekPoints: (server.weekKey === wk ? server.weekPoints : 0) + st.reward,
      streak: st.dayStreak,
      bestStreak: Math.max(server.bestStreak, st.dayStreak),
      lastClaimMs: Date.now()
    });
    return st.reward;
  });
  flushPending();
  return earned;
}

// ---------- לוחות מובילים ----------

const boards = {};

/** { rows: [{ uid, name, points }], me: { uid, rank, points } } – 'week' (מתאפס בכל יום ראשון) או 'all' */
export async function fetchLeaderboard(kind, { force = false } = {}) {
  const cached = boards[kind];
  if (!force && cached && Date.now() - cached.at < LB_TTL_MS) return cached.data;

  const h = await handle();
  const { m, firestore } = h;
  const col = m.collection(firestore, 'gameScores');
  const wk = weekKeyOf();
  const field = kind === 'week' ? 'weekPoints' : 'points';
  const q = kind === 'week'
    ? m.query(col, m.where('weekKey', '==', wk), m.orderBy('weekPoints', 'desc'), m.limit(20))
    : m.query(col, m.where('points', '>', 0), m.orderBy('points', 'desc'), m.limit(20));
  const snap = await m.getDocs(q);
  const rows = snap.docs
    .map((d) => ({ uid: d.id, name: d.data().name ?? '', points: d.data()[field] | 0 }))
    .filter((r) => r.points > 0);

  const p = local.profile;
  const mine = kind === 'week' ? weekPointsOf(p) : (p?.points ?? 0);
  let rank = rows.findIndex((r) => r.uid === h.uid) + 1;
  if (!rank && mine > 0) {
    const ahead = kind === 'week'
      ? m.query(col, m.where('weekKey', '==', wk), m.where('weekPoints', '>', mine))
      : m.query(col, m.where('points', '>', mine));
    rank = (await m.getCountFromServer(ahead)).data().count + 1;
  }

  const data = { rows, me: { uid: h.uid, rank, points: mine } };
  boards[kind] = { at: Date.now(), data };
  return data;
}

export const invalidateLeaderboards = () => {
  for (const k of Object.keys(boards)) delete boards[k];
};
