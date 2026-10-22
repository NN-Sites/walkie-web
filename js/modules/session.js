// סשן משתמש: התחברות אנונימית ל-Firebase + מסמך users/{uid} ב-Firestore.
// רץ רק אחרי שהמפה כבר מוצגת (requestIdleCallback), כדי לא לעכב את הפתיחה.
//
// מה נשלח: גרסה, פלטפורמה, זמן פעילות אחרון, סטטיסטיקה מצטברת, מצב המנוי ותרומות – בשביל דף הניהול.
// מה לא נשלח: מיקום וחיפושים. מועדפים והגדרות – רק אם המשתמש התחבר עם Google (account.js).
// מה מתקבל: מתנת Premium מהמנהל, מחירים ומגבלות (config/*), והודעה למשתמשים.

import { isFirebaseConfigured, getFirebase, ensureSignedIn } from '../firebase-config.js?v=1.4.1-mvjqgjx7';
import { APP_VERSION } from '../config.js?v=1.4.1-mvjqgjx7';
import { getStats, premiumInfo, setAdminGrant, applyRemoteConfig, onPremiumChange, getDonations } from './premium.js?v=1.4.1-mvjqgjx7';
import { initAccount, markAccountUnavailable } from './account.js?v=1.4.1-mvjqgjx7';

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

function premiumReport() {
  const p = premiumInfo();
  return { active: p.active, source: p.source, since: p.since };
}

export async function initSession({ onAnnouncement } = {}) {
  if (!isFirebaseConfigured()) {
    console.info('[Walkie] Firebase not configured yet – running without account');
    return null;
  }

  try {
    const user = await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    const { doc, getDoc, setDoc, updateDoc, serverTimestamp, increment } = modules.firestore;

    const ref = doc(firestore, 'users', user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      // ה-plan תמיד 'free' ביצירה – כללי Firestore אוכפים את זה. Premium נקבע רק ע"י המנהל או החנות.
      await setDoc(ref, {
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        plan: 'free',
        displayName: null,
        settings: {},
        device: deviceInfo(),
        stats: getStats(),
        premium: premiumReport(),
        donations: getDonations(),
        sessions: 1
      });
    } else {
      const data = snap.data();
      // מתנה מהמנהל
      setAdminGrant(data.plan === 'pro' ? data.premiumUntil ?? 'forever' : null);
      await updateDoc(ref, {
        lastSeenAt: serverTimestamp(),
        device: deviceInfo(),
        stats: getStats(),
        premium: premiumReport(),
        donations: getDonations(),
        sessions: increment(1)
      });
    }

    // חשבון Google (לא חובה): פרטי החשבון וסנכרון מועדפים
    await initAccount({ user, docRef: ref, data: snap.exists() ? snap.data() : null }).catch((err) => console.warn('[Walkie] account init failed', err));

    // כשמצב המנוי משתנה (רכישה / ביטול) – מעדכנים את המנהל
    onPremiumChange(() => {
      updateDoc(ref, { premium: premiumReport(), donations: getDonations(), lastSeenAt: serverTimestamp() }).catch(() => {});
    });

    // הגדרות מהמנהל: מחירים, מגבלות, הודעה
    const [pricing, limits, announcement] = await Promise.all(
      ['pricing', 'limits', 'announcement'].map((id) =>
        getDoc(doc(firestore, 'config', id)).then((d) => (d.exists() ? d.data() : null)).catch(() => null))
    );
    applyRemoteConfig({ pricing, limits });
    if (announcement) onAnnouncement?.(announcement);

    session = { uid: user.uid, isAnonymous: user.isAnonymous, plan: premiumInfo().active ? 'pro' : 'free' };
    return session;
  } catch (err) {
    console.warn('[Walkie] session init failed', err);
    markAccountUnavailable();
    return null;
  }
}

export function initSessionWhenIdle(onReady, options = {}) {
  const run = () => initSession(options).then((s) => s && onReady?.(s));
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
