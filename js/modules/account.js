// חשבון Google – נדרש לפעולות (מסלול, שמירה, שיתוף); ראו auth-gate.js.
// המשתמש מתחיל כאנונימי. התחברות עם Google "משדרגת" את אותו משתמש (linkWithCredential),
// כך שה-Premium, הסטטיסטיקה ומזהה התמיכה נשמרים, והמועדפים וההגדרות מסתנכרנים לכל מכשיר.
//
// באנדרואיד Google חוסמת חלון התחברות בתוך WebView, לכן משתמשים בתוסף הנייטיב
// @capacitor-firebase/authentication (skipNativeAuth) ומעבירים את ה-idToken ל-SDK של Firebase.

import { getFirebase, isFirebaseConfigured, ensureSignedIn } from '../firebase-config.js?v=1.10.0-mvu1kw0g';
import { exportFavorites, mergeFavorites, onFavoritesChange } from './favorites.js?v=1.10.0-mvu1kw0g';
import { getSettings, updateSettings, onSettingsChange } from './settings.js?v=1.10.0-mvu1kw0g';
import { t } from './i18n.js?v=1.10.0-mvu1kw0g';
import { disablePushForThisDevice, deletePushData } from './push.js?v=1.10.0-mvu1kw0g';

const listeners = new Set();
let ref = null;          // users/{uid}
let pushTimer = null;
let applyingRemote = false;

// פרטי החשבון האחרונים נשמרים במכשיר, כדי שההגדרות ומצב ההתחברות יופיעו מיד בפתיחה (לפני ש-Firebase נטען)
const CACHE_KEY = 'walkie:account';

function readCachedAccount() {
  try {
    const a = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return a?.linked ? a : null;
  } catch {
    return null;
  }
}

function writeCachedAccount(info) {
  try {
    if (info?.linked) localStorage.setItem(CACHE_KEY, JSON.stringify({ linked: true, name: info.name, email: info.email, photo: info.photo }));
    else if (info && !info.unavailable) localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

let cached = readCachedAccount();

function emit() {
  cached = null;
  writeCachedAccount(current);
  for (const fn of listeners) fn(accountInfo());
}

export function onAccountChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let current = null;

/** { linked, name, email, photo } או null אם Firebase לא מחובר */
export function accountInfo() {
  return current ?? cached;
}

function describe(user) {
  if (!user) return null;
  const google = user.providerData?.find((p) => p.providerId === 'google.com');
  return google
    ? { linked: true, name: google.displayName ?? user.displayName ?? '', email: google.email ?? user.email ?? '', photo: google.photoURL ?? null }
    : { linked: false, name: '', email: '', photo: null };
}

/** המשתמש מחובר, אבל בניית הסשן נכשלה (למשל שגיאת הרשאות בשרת). נשארים מחוברים ומציגים את השגיאה */
export function markSessionFailed(user) {
  current = { ...describe(user), sessionError: true };
  emit();
}

/** לא מחובר (עדיין לא נכנס עם Google) */
export function markSignedOut() {
  current = { linked: false };
  emit();
}

export const accountAvailable = () => isFirebaseConfigured() && !current?.unavailable;

/** השרת לא זמין (למשל Authentication לא הופעל) – מסתירים את אזור החשבון */
export function markAccountUnavailable() {
  current = { linked: false, unavailable: true };
  emit();
}

// ---------- סנכרון ----------

function schedulePush() {
  if (!ref || !current?.linked || applyingRemote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 1500);
}

async function push() {
  if (!ref || !current?.linked) return;
  const { modules } = await getFirebase();
  const { updateDoc, serverTimestamp } = modules.firestore;
  await updateDoc(ref, {
    sync: { favorites: exportFavorites(), settings: getSettings(), updatedAt: serverTimestamp() }
  }).catch((err) => console.warn('[account] sync failed', err));
}

async function pull(snapData) {
  const remote = snapData?.sync;
  if (!remote) return;
  applyingRemote = true;
  try {
    mergeFavorites(remote.favorites);
    // הגדרות: אם במכשיר הזה עוד לא שונה כלום, לוקחים את מה ששמור בחשבון
    if (remote.settings && !localStorage.getItem('walkie:settings')) updateSettings(remote.settings);
  } finally {
    applyingRemote = false;
  }
}

/** נקרא מ-session.js אחרי שהמשתמש מחובר (אנונימי או Google) */
export async function initAccount({ user, docRef, data }) {
  ref = docRef;
  current = describe(user);
  emit();
  if (current.linked) {
    await pull(data);
    await push(); // מעלה את המיזוג (מועדפים חדשים מהמכשיר הזה)
  }
}

onFavoritesChange(schedulePush);
onSettingsChange(schedulePush);

// ---------- התחברות / התנתקות ----------

/** באנדרואיד: חלון בחירת החשבון של Google (נייטיב, בתוך האפליקציה). מחזיר idToken, או null בדפדפן */
async function nativeIdToken() {
  const native = globalThis.Capacitor?.isNativePlatform?.();
  if (!native) return null;
  const FA = globalThis.Capacitor?.Plugins?.FirebaseAuthentication;
  if (!FA) throw new Error(t('התחברות עם Google עוד לא זמינה בגרסה הזו'));
  const res = await FA.signInWithGoogle({ skipNativeAuth: true });
  const idToken = res?.credential?.idToken;
  if (!idToken) throw new Error(t('ההתחברות בוטלה'));
  return idToken;
}

/** כניסה עם Google. באנדרואיד: חלון בחירת החשבון הנייטיב. בדפדפן: חלון קופץ (או מעבר לדף Google ובחזרה) */
export async function signInWithGoogle() {
  // קודם חלון Google (חייב לקרות מיד בלחיצה); רק אחר כך מתחברים ל-Firebase
  const idToken = await nativeIdToken();
  const { auth, modules } = await getFirebase();
  const a = modules.auth;
  await auth.authStateReady?.();
  if (idToken) {
    await a.signInWithCredential(auth, a.GoogleAuthProvider.credential(idToken));
  } else {
    const provider = new a.GoogleAuthProvider();
    try {
      await a.signInWithPopup(auth, provider);
    } catch (err) {
      // אייפון ("הוספה למסך הבית") ודפדפנים שחוסמים חלונות קופצים: מעבר לדף ההתחברות וחזרה
      if (err?.code !== 'auth/popup-blocked' && err?.code !== 'auth/operation-not-supported-in-this-environment') throw err;
      await a.signInWithRedirect(auth, provider);
      return new Promise(() => {}); // הדף עובר לגוגל
    }
  }
  current = describe(auth.currentUser);
  emit();
  // בלי הפעלה מחדש: האפליקציה בונה את הסשן (מסמך המשתמש, מועדפים, Premium) לפי החשבון שנכנס
  window.dispatchEvent(new Event('walkie:signed-in'));
  return current;
}

/** התנתקות: המכשיר חוזר להיות אנונימי. המועדפים נשארים במכשיר. */
export async function signOutGoogle() {
  const { auth, modules } = await getFirebase();
  await disablePushForThisDevice().catch(() => {});
  await globalThis.Capacitor?.Plugins?.FirebaseAuthentication?.signOut?.().catch(() => {});
  await modules.auth.signOut(auth);
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch { /* ignore */ }
  location.reload();
}

/**
 * מחיקת החשבון והנתונים (דרישת Google Play): מסמך המשתמש, הלבבות והנוכחות בשרת, חשבון Firebase,
 * והנתונים שבמכשיר. דורש אימות מחדש עם Google (Firebase מחייב זאת למחיקת חשבון).
 */
export async function deleteAccount() {
  const { auth, firestore, modules } = await getFirebase();
  const a = modules.auth;
  const f = modules.firestore;
  const user = auth.currentUser;
  if (!user) throw new Error(t('לא מחובר'));

  const idToken = await nativeIdToken();
  if (idToken) await a.reauthenticateWithCredential(user, a.GoogleAuthProvider.credential(idToken));
  else await a.reauthenticateWithPopup(user, new a.GoogleAuthProvider());

  const uid = user.uid;
  const quiet = (p) => p.catch(() => {});
  try {
    const thanks = await f.getDocs(f.collection(firestore, 'thanks'));
    await Promise.all(thanks.docs.map((d) => quiet(f.deleteDoc(f.doc(firestore, 'thanksHearts', `${d.id}_${uid}`)))));
  } catch { /* אין לבבות למחוק */ }
  await quiet(f.deleteDoc(f.doc(firestore, 'linePresence', uid)));
  await quiet(deletePushData());
  await f.deleteDoc(f.doc(firestore, 'users', uid));
  await a.deleteUser(user);

  await globalThis.Capacitor?.Plugins?.FirebaseAuthentication?.signOut?.().catch(() => {});
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith('walkie:')) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
  location.reload();
}

/** הודעות שגיאה מובנות */
export function accountErrorMessage(err) {
  const code = err?.code ?? '';
  if (code.includes('popup-closed') || code.includes('cancelled') || /cancel|בוטלה|cancelled/i.test(err?.message ?? '')) return null;
  if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') return t('התחברות עם Google עוד לא הופעלה בשרת');
  if (code === 'auth/network-request-failed') return t('אין חיבור לאינטרנט');
  if (code === 'auth/unauthorized-domain') return t('ההתחברות עוד לא הופעלה באתר הזה');
  return err?.message || t('ההתחברות נכשלה');
}
