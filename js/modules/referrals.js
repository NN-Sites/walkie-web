// הזמנת חברים: קוד הזמנה אישי, קישור שיתוף, מימוש קוד, ופרסים לפי מספר הנרשמים.
//
// הכול רץ על Firestore ו-Hosting (בלי שרת / Cloud Functions, כדי להישאר בתוכנית החינמית):
//   refCodes/{קוד}                  קוד -> uid של המזמין (נוצר פעם אחת, אי אפשר לשנות)
//   referralRedemptions/{uidנרשם}   מי הזמין אותי (נוצר פעם אחת ע"י הנרשם, אחרי התחברות עם Google)
//   referralEmails/{hash}           מונע לממש פעמיים עם אותו אימייל
// המזמין סופר את הרישומים שלו בעצמו, והפרס (ימי Premium + תג) מחושב במכשיר מזמני הרישום.
// זה לא חסין מפני משתמש טכני שמזייף את המכשיר שלו, אבל Premium אמיתי (Google Play) נשאר מוגן.
// "נרשם" = התחבר עם Google. כל חבר נספר פעם אחת בלבד.

import { SHARE_BASE, PLAY_URL } from '../config.js?v=1.5.0-mvks4yx4';
import { t } from './i18n.js?v=1.5.0-mvks4yx4';
import { getFirebase, ensureSignedIn } from '../firebase-config.js?v=1.5.0-mvks4yx4';
import { setReferralGrant } from './premium.js?v=1.5.0-mvks4yx4';
import { openWhatsApp } from './share.js?v=1.5.0-mvks4yx4';
import { track } from './analytics.js?v=1.5.0-mvks4yx4';

export const INVITEE_DAYS = 1;
export const REFERRAL_TIERS = Object.freeze([
  { n: 5, days: 3, badge: true, title: '3 ימי Premium + תג "משפיען כיתתי"' },
  { n: 10, days: 7, title: 'שבוע Premium חינם' },
  { n: 20, days: 30, title: 'חודש Premium חינם' }
]);

const DAY = 86400000;
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

/** קוד הזמנה חדש (6 תווים) */
export function newRefCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** שומר את הקוד של המשתמש (מסמך users) */
export function setCode(code) {
  if (code && code !== state.code) {
    state = { ...state, code };
    save();
  }
}

/** רושם קוד -> uid כדי שחברים יוכלו למצוא את המזמין. נכתב פעם אחת, ואחר כך כללי Firestore חוסמים שינוי */
export async function registerCode(code) {
  if (!code) return;
  try {
    const user = await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    const { doc, getDoc, setDoc } = modules.firestore;
    const ref = doc(firestore, 'refCodes', code);
    if (!(await getDoc(ref)).exists()) await setDoc(ref, { uid: user.uid });
  } catch {
    // ננסה שוב בפתיחה הבאה
  }
}

/** מצטבר ימי Premium לפי אירועים בזמנים שונים: כל פרס מתחיל כשהקודם נגמר */
function grantUntil(events) {
  let cursor = 0;
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    cursor = Math.max(e.t, cursor) + e.days * DAY;
  }
  return cursor || null;
}

/** קורא מהשרת מי נרשם דרכי ומי הזמין אותי, ומחשב ספירה, תג וימי Premium */
export async function refreshReferral() {
  const user = await ensureSignedIn();
  const { firestore, modules } = await getFirebase();
  const { collection, query, where, getDocs, doc, getDoc } = modules.firestore;
  const [mine, theirs] = await Promise.all([
    getDoc(doc(firestore, 'referralRedemptions', user.uid)),
    getDocs(query(collection(firestore, 'referralRedemptions'), where('inviterUid', '==', user.uid)))
  ]);
  const times = theirs.docs.map((d) => d.data().at ?? 0).sort((a, b) => a - b);
  const count = times.length;
  const reached = REFERRAL_TIERS.filter((x) => count >= x.n);
  const events = reached.map((x) => ({ t: times[x.n - 1], days: x.days }));
  if (mine.exists()) events.push({ t: mine.data().at ?? 0, days: INVITEE_DAYS });
  const until = grantUntil(events);
  setReferralGrant(until && until > Date.now() ? until : null);
  state = {
    ...state,
    count,
    awarded: reached.map((x) => x.n),
    badge: reached.some((x) => x.badge),
    referredBy: mine.exists() ? mine.data().code : null
  };
  if (mine.exists()) {
    try {
      localStorage.setItem(DONE, '1');
    } catch {
      // ignore
    }
  }
  save();
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

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

/** מממש קוד הזמנה של חבר: הנרשם מקבל יום Premium, והמזמין מתקדם לפרס הבא */
export async function redeemCode(raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new ReferralError('invalid_code');
  const user = await ensureSignedIn();
  const { firestore, modules, auth } = await getFirebase();
  const { doc, getDoc, setDoc } = modules.firestore;
  const current = auth.currentUser ?? user;
  if (!current.providerData?.some((p) => p.providerId === 'google.com') || !current.email) throw new ReferralError('not_registered');
  await current.getIdToken(true); // כדי שהאימייל המאומת יופיע בטוקן אחרי ההתחברות

  let inviterUid;
  try {
    const snap = await getDoc(doc(firestore, 'refCodes', code));
    if (!snap.exists()) throw new ReferralError('invalid_code');
    inviterUid = snap.data().uid;
  } catch (err) {
    throw err instanceof ReferralError ? err : new ReferralError('network');
  }
  if (inviterUid === user.uid) throw new ReferralError('self');

  try {
    await setDoc(doc(firestore, 'referralEmails', await sha256(current.email.toLowerCase())), { uid: user.uid, at: Date.now() });
    await setDoc(doc(firestore, 'referralRedemptions', user.uid), { inviterUid, code, at: Date.now() });
  } catch (err) {
    throw new ReferralError(err?.code === 'permission-denied' ? 'already' : 'network');
  }
  try {
    localStorage.removeItem(PENDING);
    localStorage.setItem(DONE, '1');
  } catch {
    // ignore
  }
  track('invite.redeemed');
  await refreshReferral().catch(() => {});
  return { ok: true };
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
