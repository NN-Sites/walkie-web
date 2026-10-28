// הזמנת חברים: קוד אישי + קישור, ספירת החברים שנרשמו, ופרס על כל 10 חברים.
// הכול דרך Firestore בלי שרת (ראו firestore.rules, "הזמנת חברים"): הרישום נוצר פעם אחת בלבד לכל חשבון ולכל אימייל.

import { getFirebase, ensureSignedIn } from '../firebase-config.js?v=1.10.0-mvseambo';
import { SHARE_BASE } from '../config.js?v=1.10.0-mvseambo';
import { accountInfo, onAccountChange } from './account.js?v=1.10.0-mvseambo';
import { getAttribution, track } from './analytics.js?v=1.10.0-mvseambo';

export const INVITES_PER_PRIZE = 10;

const CODE_KEY = 'walkie:refCode';
const DONE_KEY = 'walkie:refRedeemed';
const COUNT_KEY = 'walkie:refCount';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // בלי תווים מבלבלים (O/0, I/1)

const listeners = new Set();

export const onReferralChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = () => listeners.forEach((fn) => fn());

const read = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
};

/** כמה חברים נרשמו (מהמטמון המקומי, מתעדכן מהשרת ב-refreshReferrals) */
export const referralCount = () => Number(read(COUNT_KEY)) || 0;

/**
 * סולם הפרסים: פרס אחד על כל 10 חברים. auto = נפתח באפליקציה מיד; manual = אנחנו שולחים / מטפלים (המנהל רואה את הספירה בדף הניהול).
 */
export const PRIZES = [
  { icon: '🚫', title: 'בלי פרסומות', kind: 'auto' },
  { icon: '🎨', title: 'צבע מותג לבחירה', kind: 'auto' },
  { icon: '🏅', title: 'תג שגריר ליד השם', kind: 'auto' },
  { icon: '📍', title: 'צבע נקודת המיקום שלי', kind: 'auto' },
  { icon: '💚', title: 'השם שלך בלשונית "תודות"', kind: 'manual' },
  { icon: '✨', title: 'מדבקות Walkie בדואר', kind: 'manual' },
  { icon: '🧪', title: 'גישה מוקדמת לגרסאות חדשות', kind: 'manual' },
  { icon: '👕', title: 'חולצת Walkie', kind: 'manual' },
  { icon: '💡', title: 'הרעיון שלך מקבל עדיפות בפיתוח', kind: 'manual' },
  { icon: '🏆', title: 'ערכת שגריר מלאה', kind: 'manual' }
];

/** כמה פרסים הרווחת, ועד כמה חסר לפרס הבא */
export function referralProgress(count = referralCount()) {
  const prizes = Math.floor(count / INVITES_PER_PRIZE);
  return { count, prizes, inGoal: count % INVITES_PER_PRIZE, toNext: INVITES_PER_PRIZE - (count % INVITES_PER_PRIZE) };
}

/** הפרס הראשון (10 חברים): בלי באנר פרסומת, לתמיד */
export const adFreeUnlocked = () => referralCount() >= INVITES_PER_PRIZE;
export const prizeUnlocked = (index) => referralCount() >= (index + 1) * INVITES_PER_PRIZE;

// ---------- הטבות אוטומטיות: צבעים ותג ----------

export const BRAND_COLORS = [
  { id: 'teal', main: '#0d9488', dark: '#0f766e', darker: '#115e59', soft: '#f0fdfa', softer: '#ccfbf1' },
  { id: 'violet', main: '#7c3aed', dark: '#6d28d9', darker: '#5b21b6', soft: '#f5f3ff', softer: '#ede9fe' },
  { id: 'rose', main: '#e11d48', dark: '#be123c', darker: '#9f1239', soft: '#fff1f2', softer: '#ffe4e6' },
  { id: 'amber', main: '#d97706', dark: '#b45309', darker: '#92400e', soft: '#fffbeb', softer: '#fef3c7' }
];
export const DOT_COLORS = ['#2563eb', '#16a34a', '#e11d48', '#9333ea', '#f97316'];

const BRAND_KEY = 'walkie:refBrand';
const DOT_KEY = 'walkie:refDot';

export const hasAmbassadorBadge = () => prizeUnlocked(2);
export const chosenBrand = () => read(BRAND_KEY) || 'teal';
export const chosenDot = () => read(DOT_KEY) || DOT_COLORS[0];

/** מחיל את הצבעים שנבחרו (ורק אם הפרס נפתח); בלי פרס – חוזרים לברירת המחדל */
export function applyPerks() {
  const style = document.documentElement.style;
  const brand = prizeUnlocked(1) ? BRAND_COLORS.find((c) => c.id === chosenBrand()) : null;
  const vars = { '--brand': brand?.main, '--brand-600': brand?.dark, '--brand-700': brand?.darker, '--brand-50': brand?.soft, '--brand-100': brand?.softer };
  for (const [name, value] of Object.entries(vars)) {
    if (brand && brand.id !== 'teal') style.setProperty(name, value);
    else style.removeProperty(name);
  }
  if (prizeUnlocked(3) && chosenDot() !== DOT_COLORS[0]) style.setProperty('--user', chosenDot());
  else style.removeProperty('--user');
}

export function chooseBrand(id) {
  write(BRAND_KEY, id);
  applyPerks();
  emit();
}

export function chooseDot(color) {
  write(DOT_KEY, color);
  applyPerks();
  emit();
}


export const myReferralCode = () => read(CODE_KEY);

export const inviteLink = (code) => `${SHARE_BASE}/?ref=${code}`;

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** הקוד האישי: נוצר פעם אחת ונשמר ב-refCodes/{קוד} (create בלבד) וגם בפרופיל */
export async function ensureMyCode() {
  const cached = read(CODE_KEY);
  if (cached) return cached;
  const user = await ensureSignedIn();
  const { firestore, modules } = await getFirebase();
  const { doc, getDoc, setDoc, updateDoc } = modules.firestore;

  const userRef = doc(firestore, 'users', user.uid);
  const existing = (await getDoc(userRef)).data()?.refCode;
  if (existing) {
    write(CODE_KEY, existing);
    return existing;
  }
  for (let i = 0; i < 5; i += 1) {
    const code = randomCode();
    try {
      await setDoc(doc(firestore, 'refCodes', code), { uid: user.uid }); // קוד תפוס = נדחה, מנסים אחר
    } catch {
      continue;
    }
    await updateDoc(userRef, { refCode: code }).catch(() => {});
    write(CODE_KEY, code);
    return code;
  }
  throw new Error('code-failed');
}

/** סופר מהשרת את הרישומים שהוזמנו על ידי */
export async function refreshReferrals() {
  try {
    const user = await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    const { collection, query, where, getCountFromServer } = modules.firestore;
    const q = query(collection(firestore, 'referralRedemptions'), where('inviterUid', '==', user.uid));
    const snap = await getCountFromServer(q);
    const n = snap.data().count;
    if (n !== referralCount()) {
      write(COUNT_KEY, String(n));
      applyPerks();
      emit();
    }
    return n;
  } catch {
    return referralCount();
  }
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * מימוש קוד של חבר. מחזיר 'ok' | 'invalid' | 'self' | 'already' | 'unverified'.
 * דורש חשבון Google עם אימייל מאומת (כך אי אפשר להרוויח מחשבונות מזויפים).
 */
export async function redeemCode(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return 'invalid';
  if (read(DONE_KEY)) return 'already';

  const user = await ensureSignedIn();
  if (!user.emailVerified || !user.email) return 'unverified';

  const { firestore, modules } = await getFirebase();
  const { doc, getDoc, setDoc, serverTimestamp } = modules.firestore;

  const codeSnap = await getDoc(doc(firestore, 'refCodes', code)).catch(() => null);
  const inviterUid = codeSnap?.exists() ? codeSnap.data().uid : null;
  if (!inviterUid) return 'invalid';
  if (inviterUid === user.uid) return 'self';

  const already = await getDoc(doc(firestore, 'referralRedemptions', user.uid)).catch(() => null);
  if (already?.exists()) {
    write(DONE_KEY, '1');
    return 'already';
  }
  try {
    // אותו אימייל לא יכול לממש פעמיים (גם אחרי מחיקת חשבון): המסמך נוצר פעם אחת בלבד
    const hash = await sha256Hex(user.email.trim().toLowerCase());
    await setDoc(doc(firestore, 'referralEmails', hash), { uid: user.uid, at: serverTimestamp() });
    await setDoc(doc(firestore, 'referralRedemptions', user.uid), { inviterUid, code, at: serverTimestamp() });
  } catch {
    write(DONE_KEY, '1');
    return 'already';
  }
  write(DONE_KEY, '1');
  track('invite.redeemed');
  return 'ok';
}

/** קוד שהגיע מקישור הזמנה (נשמר בפתיחה הראשונה): מנסים לממש ברגע שיש חשבון Google מאומת */
async function redeemPending() {
  const pending = getAttribution()?.ref;
  if (!pending || read(DONE_KEY) || !accountInfo()?.linked) return;
  await redeemCode(pending).catch(() => {});
}

onAccountChange((info) => {
  if (!info?.linked) return;
  redeemPending();
  refreshReferrals();
});

applyPerks();
