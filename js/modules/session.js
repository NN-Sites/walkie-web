// סשן משתמש: התחברות אנונימית ל-Firebase + מסמך users/{uid} ב-Firestore.
// רץ רק אחרי שהמפה כבר מוצגת (requestIdleCallback), כדי לא לעכב את הפתיחה.
//
// מה נשלח: גרסה, פלטפורמה, זמן פעילות אחרון וסטטיסטיקה מצטברת – בשביל דף הניהול.
// מה לא נשלח: מיקום וחיפושים. מועדפים והגדרות – רק אם המשתמש התחבר עם Google (account.js).
// מה מתקבל: הודעה למשתמשים (config/announcement).

import { isFirebaseConfigured, getFirebase, ensureSignedIn } from '../firebase-config.js?v=1.10.0-mvseambo';
import { APP_VERSION } from '../config.js?v=1.10.0-mvseambo';
import { getStats } from './stats.js?v=1.10.0-mvseambo';
import { initAccount, markAccountUnavailable, markSignedOut, markSessionFailed, onAccountChange } from './account.js?v=1.10.0-mvseambo';
import { showToast } from './ui.js?v=1.10.0-mvseambo';
import { getAttribution, track, trackDeviceSession } from './analytics.js?v=1.10.0-mvseambo';

let session = null;

export function getSession() {
  return session;
}

/** מזהה קצר שהמשתמש יכול למסור לתמיכה (8 התווים הראשונים של ה-uid) */
export function supportId() {
  return session?.uid?.slice(0, 8) ?? null;
}

function deviceInfo() {
  const native = globalThis.Capacitor?.isNativePlatform?.();
  return {
    platform: native ? globalThis.Capacitor.getPlatform() : 'web',
    appVersion: APP_VERSION,
    lang: navigator.language || 'he'
  };
}

/** איך המשתמש נרשם: google | email | anonymous (לדף הניהול) */
function authTypeOf(user) {
  const ids = user?.providerData?.map((p) => p.providerId) ?? [];
  if (ids.includes('google.com')) return 'google';
  if (ids.includes('password')) return 'email';
  return 'anonymous';
}

/** פרטי חשבון Google (שם, אימייל, תמונה) – מוצגים בדף הניהול */
function profileOf(user) {
  const g = user?.providerData?.find((p) => p.providerId === 'google.com');
  return g ? { name: g.displayName ?? user.displayName ?? '', email: g.email ?? user.email ?? '', photo: g.photoURL ?? null } : null;
}

/** מצב הסשן האחרון (מוצג בהגדרות, כדי לאבחן תקלות בטלפון בלי כלי פיתוח) */
export function sessionStatus() {
  try {
    return localStorage.getItem('walkie:sessionStatus') || '';
  } catch {
    return '';
  }
}

function setStatus(text) {
  try {
    localStorage.setItem('walkie:sessionStatus', text);
  } catch {
    // ignore
  }
}

export async function initSession({ onAnnouncement } = {}) {
  let step = 'start';
  if (!isFirebaseConfigured()) {
    console.info('[Walkie] Firebase not configured yet – running without account');
    return null;
  }

  try {
    step = 'sign-in';
    const user = await ensureSignedIn();
    step = 'firebase';
    const { firestore, modules } = await getFirebase();
    const { doc, getDoc, setDoc, updateDoc, serverTimestamp, increment } = modules.firestore;

    const ref = doc(firestore, 'users', user.uid);
    step = 'read-user';
    const snap = await getDoc(ref);
    step = snap.exists() ? 'update-user' : 'create-user';

    if (!snap.exists()) {
      const attribution = getAttribution();
      await setDoc(ref, {
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        plan: 'free',
        displayName: null,
        settings: {},
        device: deviceInfo(),
        stats: getStats(),
        authType: authTypeOf(user),
        profile: profileOf(user),
        attribution: { source: attribution.source, medium: attribution.medium, campaign: attribution.campaign, ref: attribution.ref },
        sessions: 1
      });
      // נספר רק אחרי שהחשבון נוצר בפועל (ניסיון שנכשל יחזור בפתיחה הבאה)
      track(`acq.${attribution.source}`);
      track('funnel.account_created');
    } else {
      await updateDoc(ref, {
        lastSeenAt: serverTimestamp(),
        device: deviceInfo(),
        stats: getStats(),
        authType: authTypeOf(user),
        profile: profileOf(user),
        sessions: increment(1)
      });
    }
    step = 'account';
    setStatus('ok');
    trackDeviceSession(deviceInfo().platform);

    // חשבון Google (לא חובה): פרטי החשבון וסנכרון מועדפים
    await initAccount({ user, docRef: ref, data: snap.exists() ? snap.data() : null }).catch((err) => console.warn('[Walkie] account init failed', err));

    onAccountChange((a) => {
      if (!a?.linked) return;
      updateDoc(ref, { authType: 'google' }).catch(() => {});
      track('auth.google_linked');
    });

    // דופק: lastSeenAt מתעדכן כל כמה דקות כל עוד האפליקציה פתוחה, כדי שהאדמין יראה "מחוברים עכשיו"
    const beat = () => {
      if (document.visibilityState === 'visible') updateDoc(ref, { lastSeenAt: serverTimestamp() }).catch(() => {});
    };
    setInterval(beat, 150000);
    document.addEventListener('visibilitychange', beat);

    // הודעה מהמנהל
    const announcement = await getDoc(doc(firestore, 'config', 'announcement')).then((d) => (d.exists() ? d.data() : null)).catch(() => null);
    if (announcement) onAnnouncement?.(announcement);

    session = { uid: user.uid, isAnonymous: user.isAnonymous, plan: 'free' };
    return session;
  } catch (err) {
    if (err?.code === 'sign-in-required') {
      markSignedOut(); // מסך הכניסה חוסם את האפליקציה עד שנכנסים עם Google
      return null;
    }
    console.warn('[Walkie] session init failed', err);
    setStatus(`${step}: ${err?.code ?? err?.name ?? ''} ${String(err?.message ?? '').slice(0, 120)}`);
    // מחוברים עם Google אבל הסשן נכשל: לא "מתנתקים", מציגים את השגיאה כדי שאפשר יהיה לתקן
    const { auth } = await getFirebase().catch(() => ({}));
    if (auth?.currentUser && !auth.currentUser.isAnonymous) {
      markSessionFailed(auth.currentUser);
      showToast(`${err?.code ?? err?.name ?? 'error'}: ${String(err?.message ?? '').slice(0, 90)}`, 9000);
      return null;
    }
    markAccountUnavailable();
    return null;
  }
}

export function initSessionWhenIdle(onReady, options = {}) {
  const run = () => initSession(options).then((s) => s && onReady?.(s));
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
