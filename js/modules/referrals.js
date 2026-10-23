// הזמנת חברים: קוד הזמנה אישי, קישור שיתוף, מימוש קוד, ופרסים לפי מספר הנרשמים.
//
// הפרסים מוענקים בשרת (functions/lib/community.js), כי הלקוח לא יכול להעניק לעצמו Premium.
// כאן: מצב מקומי (מה הושג), יצירת הקישור, ושליחת קוד שנקלט להפעלה.
// "נרשם" = התחבר עם Google. כל חבר נספר פעם אחת בלבד.

import { SHARE_BASE, PLAY_URL, COMMUNITY_API } from '../config.js?v=1.5.0-mvkr2mw5';
import { t } from './i18n.js?v=1.5.0-mvkr2mw5';
import { getFirebase, ensureSignedIn } from '../firebase-config.js?v=1.5.0-mvkr2mw5';
import { setAdminGrant } from './premium.js?v=1.5.0-mvkr2mw5';
import { openWhatsApp } from './share.js?v=1.5.0-mvkr2mw5';
import { track } from './analytics.js?v=1.5.0-mvkr2mw5';

// משוכפל ב-functions/lib/community.js – לעדכן בשני המקומות יחד
export const INVITEE_DAYS = 1;
export const REFERRAL_TIERS = Object.freeze([
  { n: 5, days: 3, badge: true, title: '3 ימי Premium + תג "משפיען כיתתי"' },
  { n: 10, days: 7, title: 'שבוע Premium חינם' },
  { n: 20, days: 30, title: 'חודש Premium חינם' }
]);

const KEY = 'walkie:referral';
const PENDING = 'walkie:pendingRef';
const DONE = 'walkie:referral:done';
const CODE_RE = /^[A-Z0-9]{6}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // בלי O/0/I/1 שמתבלבלים

const listeners = new Set();
let state = load();

function load() {
  try {
    return { code: null, count: 0, awarded: [], badge: false, referredBy: null, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { code: null, count: 0, awarded: [], badge: false, referredBy: null };
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
  for (const fn of listeners) fn(state);
}

export const onReferralChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getReferral = () => state;
export const isInfluencer = () => !!state.badge;

/** קוד הזמנה חדש (6 תווים). הייחודיות נבדקת בשרת בעת המימוש */
export function newRefCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** קורא את מסמך המשתמש מהשרת: ספירת הנרשמים, הפרסים והתג, וימי ה-Premium שהוענקו */
export async function refreshReferral() {
  const user = await ensureSignedIn();
  const { firestore, modules } = await getFirebase();
  const { doc, getDoc } = modules.firestore;
  const snap = await getDoc(doc(firestore, 'users', user.uid));
  if (!snap.exists()) return;
  const data = snap.data();
  applyUserDoc(data);
  setAdminGrant(data.plan === 'pro' ? data.premiumUntil ?? 'forever' : null);
}

/** מסמך המשתמש שנקרא מהשרת (session.js / רענון בדף ההזמנות) */
export function applyUserDoc(data) {
  if (!data) return;
  const r = data.referral ?? {};
  state = {
    ...state,
    code: data.refCode ?? state.code,
    count: r.count ?? 0,
    awarded: r.awarded ?? [],
    badge: !!r.badge,
    referredBy: r.referredBy ?? null
  };
  save();
}

export function setCode(code) {
  if (code && code !== state.code) {
    state = { ...state, code };
    save();
  }
}

export function nextTier(count = state.count) {
  return REFERRAL_TIERS.find((x) => count < x.n) ?? null;
}

export function inviteLink(source = 'friend_invite') {
  const code = state.code ?? '';
  return `${SHARE_BASE}/?ref=${code}&utm_source=${source}`;
}

export function inviteText() {
  return [
    `🚌 ${t('הוזמנת ל-Walkie: ניווט ותחבורה ציבורית בזמן אמת, בלי פרסומות.')}`,
    `🎁 ${t('נרשמים עם הקוד שלי ומקבלים יום Premium חינם. הקוד:')} ${state.code ?? ''}`,
    inviteLink(),
    `Android: ${PLAY_URL}`
  ].join('\n');
}

/** פותח וואטסאפ (או חלון השיתוף של הטלפון) עם הזמנה מוכנה */
export async function shareInvite() {
  track('invite.shared');
  const text = inviteText();
  if (navigator.share && globalThis.Capacitor?.isNativePlatform?.()) {
    try {
      await navigator.share({ text });
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return false;
    }
  }
  openWhatsApp(text);
  return true;
}

export function pendingCode() {
  try {
    const c = localStorage.getItem(PENDING);
    return c && CODE_RE.test(c) ? c : null;
  } catch {
    return null;
  }
}

export function setPendingCode(code) {
  try {
    localStorage.setItem(PENDING, code);
  } catch {
    // ignore
  }
}

const ERRORS = {
  invalid_code: 'הקוד לא נמצא. בדקו שהעתקתם אותו נכון.',
  self: 'אי אפשר להשתמש בקוד של עצמך.',
  already: 'כבר השתמשת בקוד הזמנה (או שהחשבון הזה כבר נרשם דרך הזמנה).',
  not_registered: 'כדי לממש קוד צריך להתחבר עם Google.',
  unauthenticated: 'אין חיבור לחשבון. נסו שוב בעוד רגע.'
};

export class ReferralError extends Error {
  constructor(code) {
    super(t(ERRORS[code] ?? 'לא הצלחנו לממש את הקוד. נסו שוב מאוחר יותר.'));
    this.code = code;
  }
}

/** מממש קוד הזמנה של חבר: הנרשם מקבל יום Premium, והמזמין מתקדם לפרס הבא */
export async function redeemCode(raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new ReferralError('invalid_code');
  const user = await ensureSignedIn();
  const { auth } = await getFirebase();
  const token = await (auth.currentUser ?? user).getIdToken(true);
  let res;
  try {
    res = await fetch(`${COMMUNITY_API}/referral/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code })
    });
  } catch {
    throw new ReferralError('network');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body.error === 'already') localStorage.setItem(DONE, '1');
    throw new ReferralError(body.error ?? 'server');
  }
  try {
    localStorage.setItem(DONE, '1');
    localStorage.removeItem(PENDING);
  } catch {
    // ignore
  }
  state = { ...state, referredBy: code };
  save();
  if (body.premiumUntil) setAdminGrant(body.premiumUntil);
  track('invite.redeemed');
  return body;
}

/** אחרי התחברות עם Google: אם נקלט קוד מקישור – מממשים אותו בשקט. מחזיר את התשובה או null */
export async function redeemPendingIfAny(isRegistered) {
  const code = pendingCode();
  if (!code || !isRegistered || state.referredBy) return null;
  try {
    return await redeemCode(code);
  } catch (err) {
    // קוד לא תקין / כבר מומש: אין טעם לנסות שוב בכל פתיחה
    if (['invalid_code', 'self', 'already'].includes(err.code)) {
      try {
        localStorage.removeItem(PENDING);
      } catch {
        // ignore
      }
    }
    return null;
  }
}
