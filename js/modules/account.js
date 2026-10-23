// חשבון Google – נדרש לפעולות (מסלול, שמירה, שיתוף); ראו auth-gate.js.
// המשתמש מתחיל כאנונימי. התחברות עם Google "משדרגת" את אותו משתמש (linkWithCredential),
// כך שה-Premium, הסטטיסטיקה ומזהה התמיכה נשמרים, והמועדפים וההגדרות מסתנכרנים לכל מכשיר.
//
// באנדרואיד Google חוסמת חלון התחברות בתוך WebView, לכן משתמשים בתוסף הנייטיב
// @capacitor-firebase/authentication (skipNativeAuth) ומעבירים את ה-idToken ל-SDK של Firebase.

import { getFirebase, isFirebaseConfigured, ensureSignedIn } from '../firebase-config.js?v=1.5.0-mvkrt633';
import { exportFavorites, mergeFavorites, onFavoritesChange } from './favorites.js?v=1.5.0-mvkrt633';
import { getSettings, updateSettings, onSettingsChange } from './settings.js?v=1.5.0-mvkrt633';
import { t } from './i18n.js?v=1.5.0-mvkrt633';

const listeners = new Set();
let ref = null;          // users/{uid}
let pushTimer = null;
let applyingRemote = false;

function emit() {
  for (const fn of listeners) fn(accountInfo());
}

export function onAccountChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let current = null;

/** { linked, name, email, photo } או null אם Firebase לא מחובר */
export function accountInfo() {
  return current;
}

function describe(user) {
  if (!user) return null;
  const google = user.providerData?.find((p) => p.providerId === 'google.com');
  return google
    ? { linked: true, name: google.displayName ?? user.displayName ?? '', email: google.email ?? user.email ?? '', photo: google.photoURL ?? null }
    : { linked: false, name: '', email: '', photo: null };
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

async function googleCredential(authMod) {
  const native = globalThis.Capacitor?.isNativePlatform?.();
  const FA = globalThis.Capacitor?.Plugins?.FirebaseAuthentication;
  if (native) {
    if (!FA) throw new Error(t('התחברות עם Google עוד לא זמינה בגרסה הזו'));
    const res = await FA.signInWithGoogle({ skipNativeAuth: true });
    const idToken = res?.credential?.idToken;
    if (!idToken) throw new Error(t('ההתחברות בוטלה'));
    return authMod.GoogleAuthProvider.credential(idToken);
  }
  return null; // בדפדפן: חלון קופץ
}

/** מחבר את המשתמש הנוכחי לחשבון Google. אם החשבון כבר שייך למשתמש אחר – עוברים אליו. */
export async function signInWithGoogle() {
  const { auth, modules } = await getFirebase();
  const a = modules.auth;
  const user = await ensureSignedIn().catch(() => null);
  if (!user) throw new Error(t('אין חיבור לשרת כרגע, נסו שוב בעוד רגע'));
  if (describe(user)?.linked) {
    current = describe(user);
    emit();
    return current;
  }

  const cred = await googleCredential(a);
  try {
    if (cred) await a.linkWithCredential(user, cred);
    else {
      try {
        await a.linkWithPopup(user, new a.GoogleAuthProvider());
      } catch (err) {
        // אייפון ("הוספה למסך הבית") ודפדפנים שחוסמים חלונות קופצים: מעבר לדף ההתחברות וחזרה
        if (err?.code !== 'auth/popup-blocked' && err?.code !== 'auth/operation-not-supported-in-this-environment') throw err;
        await a.linkWithRedirect(user, new a.GoogleAuthProvider());
        return new Promise(() => {}); // הדף עובר לגוגל
      }
    }
  } catch (err) {
    if (err?.code !== 'auth/credential-already-in-use' && err?.code !== 'auth/email-already-in-use') throw err;
    // החשבון כבר מחובר למשתמש קיים (למשל מטלפון קודם): נכנסים אליו.
    // המועדפים שבמכשיר נשארים, ויתמזגו לחשבון אחרי הטעינה מחדש.
    const existing = cred ?? a.GoogleAuthProvider.credentialFromError(err);
    if (!existing) throw err;
    await a.signInWithCredential(auth, existing);
    location.reload();
    return accountInfo();
  }
  await auth.currentUser.reload();
  current = describe(auth.currentUser);
  if (ref) {
    const { updateDoc } = modules.firestore;
    await updateDoc(ref, { profile: { name: current.name, email: current.email, photo: current.photo } }).catch(() => {});
  }
  await push();
  emit();
  return current;
}

/** התנתקות: המכשיר חוזר להיות אנונימי. המועדפים נשארים במכשיר. */
export async function signOutGoogle() {
  const { auth, modules } = await getFirebase();
  await globalThis.Capacitor?.Plugins?.FirebaseAuthentication?.signOut?.().catch(() => {});
  await modules.auth.signOut(auth);
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
