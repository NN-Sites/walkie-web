// התראות פוש על איחור / ביטול בקווים שמורים (FCM, באפליקציית אנדרואיד).
//
// הזרימה: המשתמש שומר קו -> מבקשים הרשאה -> התוסף הנייטיב מחזיר טוקן FCM -> כותבים ל-pushWatches/{uid}
// { tokens, lines, lang }. השרת (functions/lib/push-alerts.js) מנטר את הקווים ושולח הודעה כשיש איחור של 10 דק' ומעלה או ביטול.
// בדפדפן אין פוש: הקו נשמר ב"הקווים שלי" בלבד.

import { getFirebase, ensureSignedIn } from '../firebase-config.js?v=1.10.0-mvu1kw0g';
import { getFavorites, onFavoritesChange } from './favorites.js?v=1.10.0-mvu1kw0g';
import { getSettings, onSettingsChange } from './settings.js?v=1.10.0-mvu1kw0g';
import { showToast } from './ui.js?v=1.10.0-mvu1kw0g';
import { t, LANG } from './i18n.js?v=1.10.0-mvu1kw0g';
import { isGuest } from './auth-gate.js?v=1.10.0-mvu1kw0g';

const CHANNEL = 'line-alerts';
const TOKEN_KEY = 'walkie:pushToken';
const MAX_TOKENS = 5;
const MAX_LINES = 20;

const plugin = () => globalThis.Capacitor?.Plugins?.PushNotifications ?? null;
export const pushSupported = () => !!globalThis.Capacitor?.isNativePlatform?.() && !!plugin();

let token = null;
try {
  token = localStorage.getItem(TOKEN_KEY);
} catch { /* ignore */ }
let listening = false;
let syncTimer = null;

const watchedLines = () => (getFavorites().lines ?? []).slice(0, MAX_LINES).map((l) => ({
  lineRef: String(l.lineRef),
  line: l.line ?? '',
  mode: l.mode ?? 'bus',
  to: l.to ?? null
}));

const wantsPush = () => getSettings().linePush && watchedLines().length > 0;

async function watchRef() {
  const user = await ensureSignedIn().catch(() => null);
  if (!user) return null;
  const { firestore, modules } = await getFirebase();
  return { f: modules.firestore, ref: modules.firestore.doc(firestore, 'pushWatches', user.uid) };
}

/** מעדכן את מסמך ההתראות של המשתמש: הטוקן של המכשיר הזה והקווים השמורים */
async function sync() {
  if (!token) return;
  const target = await watchRef();
  if (!target) return;
  const { f, ref } = target;
  const snap = await f.getDoc(ref).catch(() => null);
  const known = snap?.exists() && Array.isArray(snap.data().tokens) ? snap.data().tokens : [];
  const tokens = [token, ...known.filter((x) => x !== token)].slice(0, MAX_TOKENS);
  await f.setDoc(ref, {
    tokens,
    lines: getSettings().linePush ? watchedLines() : [],
    lang: LANG === 'he' ? 'he' : 'en',
    updatedAt: f.serverTimestamp()
  }, { merge: true });
}

function scheduleSync(delay = 1500) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync().catch((err) => console.warn('[push] sync failed', err)), delay);
}

function listen(P) {
  if (listening) return;
  listening = true;
  P.addListener('registration', (ev) => {
    token = ev?.value ?? null;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
    } catch { /* ignore */ }
    scheduleSync(0);
  });
  P.addListener('registrationError', (err) => console.warn('[push] registration failed', err));
  // האפליקציה פתוחה: ההודעה לא מוצגת בשורת ההתראות, לכן מציגים אותה כהודעה בתוך האפליקציה
  P.addListener('pushNotificationReceived', (n) => {
    const text = [n?.title, n?.body].filter(Boolean).join(' · ');
    if (text) showToast(text);
  });
}

/**
 * מפעיל פוש במכשיר: הרשאה (אם prompt), ערוץ התראות ורישום ל-FCM.
 * מחזיר 'granted' | 'denied' | 'prompt' | 'unsupported'
 */
export async function enablePush({ prompt = true } = {}) {
  if (!pushSupported()) return 'unsupported';
  const P = plugin();
  try {
    let perm = (await P.checkPermissions())?.receive;
    if (perm !== 'granted') {
      if (perm === 'denied') return 'denied';
      if (!prompt) return 'prompt';
      perm = (await P.requestPermissions())?.receive;
      if (perm !== 'granted') return 'denied';
    }
    listen(P);
    await P.createChannel?.({
      id: CHANNEL,
      name: t('התראות על קווים'),
      description: t('איחור או ביטול בקווים ששמרתם'),
      importance: 4,
      visibility: 1,
      vibration: true
    }).catch(() => {});
    await P.register();
    return 'granted';
  } catch (err) {
    console.warn('[push] enable failed', err);
    return 'denied';
  }
}

/** אחרי שהמשתמש שמר קו: מפעילים פוש (עם בקשת הרשאה) ומחזירים הודעה מתאימה */
export async function onLineWatched() {
  if (isGuest()) return t('הקו נוסף ל"הקווים שלי". התראות על איחור וביטול דורשות התחברות עם Google (בהגדרות)');
  if (!getSettings().linePush) return t('הקו נוסף ל"הקווים שלי". ההתראות כבויות בהגדרות');
  const status = await enablePush({ prompt: true });
  if (status === 'granted') {
    scheduleSync(0);
    return t('הקו נשמר. נתריע על איחור של 10 דק\' ומעלה או על ביטול');
  }
  if (status === 'denied') return t('הקו נוסף ל"הקווים שלי". ההתראות חסומות – אפשר להפעיל אותן בהגדרות המכשיר');
  return t('הקו נוסף ל"הקווים שלי". התראות פוש זמינות באפליקציית אנדרואיד');
}

/** התנתקות: מסירים את המכשיר הזה מהמסמך, כדי שמשתמש אחר שייכנס כאן לא יקבל את ההתראות */
export async function disablePushForThisDevice() {
  if (!token) return;
  const target = await watchRef();
  if (!target) return;
  const { f, ref } = target;
  const snap = await f.getDoc(ref).catch(() => null);
  if (!snap?.exists()) return;
  const tokens = (snap.data().tokens ?? []).filter((x) => x !== token);
  await f.setDoc(ref, { tokens, updatedAt: f.serverTimestamp() }, { merge: true }).catch(() => {});
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
  token = null;
}

/** מחיקת חשבון: מוחקים את מסמך ההתראות */
export async function deletePushData() {
  const target = await watchRef();
  if (target) await target.f.deleteDoc(target.ref).catch(() => {});
}

/** בפתיחת האפליקציה: מרעננים את הטוקן בלי לבקש הרשאה */
export function startPush() {
  if (!pushSupported()) return;
  if (wantsPush()) enablePush({ prompt: false }).then(() => scheduleSync(3000));
  onFavoritesChange(() => token && scheduleSync());
  onSettingsChange(() => {
    if (wantsPush()) enablePush({ prompt: false });
    if (token) scheduleSync();
  });
}
