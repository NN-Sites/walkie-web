// אנליטיקה מצטברת ואנונימית, לדף הניהול.
//
// לא נשמרים אירועים בודדים אלא מונים יומיים (מסמך analytics/{תאריך}_{רסיס}): "כמה פעמים נפתח מסך X היום".
// אין בהם מזהה משתמש, מיקום או טקסט חיפוש (חיפושים שנכשלו נשמרים בנפרד, בלי מזהה, ראו trackFailedSearch).
// המונים נצברים בזיכרון ונשלחים בקבוצה, ואם האפליקציה נסגרת לפני השליחה הם נשמרים במכשיר לפתיחה הבאה.
// אפשר לכבות בהגדרות ← פרטיות.

import { isFirebaseConfigured, getFirebase, ensureSignedIn } from '../firebase-config.js?v=1.5.0-mvksl4eo';
import { getSettings } from './settings.js?v=1.5.0-mvksl4eo';
import { nearestCity } from './cities.js?v=1.5.0-mvksl4eo';
import { safeKey } from './keys.js?v=1.5.0-mvksl4eo';

const QUEUE_KEY = 'walkie:analytics:q';
const ATTR_KEY = 'walkie:attr';
const FLUSH_MS = 25000;
const SHARDS = 10;

let pending = {};
let flushTimer = null;
let flushing = false;
let cityDone = false;

const enabled = () => isFirebaseConfigured() && getSettings().analytics !== false;

export { safeKey };

function bump(tree, path, n) {
  const parts = path.split('.');
  let node = tree;
  for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] ??= {};
  const last = parts[parts.length - 1];
  node[last] = typeof n === 'number' ? (node[last] ?? 0) + n : n;
}

function mergeTrees(into, from) {
  for (const [k, v] of Object.entries(from ?? {})) {
    if (v && typeof v === 'object') mergeTrees((into[k] ??= {}), v);
    else if (typeof v === 'number') into[k] = (into[k] ?? 0) + v;
    else into[k] = v;
  }
  return into;
}

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeQueue(tree) {
  try {
    if (Object.keys(tree).length) localStorage.setItem(QUEUE_KEY, JSON.stringify(tree));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    // ignore
  }
}

/** מוסיף n למונה, למשל track('feat.invite_open') */
export function track(path, n = 1) {
  if (!enabled()) return;
  bump(pending, path, n);
  schedule();
}

/** שם קריא ליד מונה (למשל שם תחנה ליד קוד התחנה): names.<key> */
export function trackName(key, name) {
  if (!enabled() || !name) return;
  bump(pending, `names.${safeKey(key)}`, String(name).slice(0, 60));
  schedule();
}

/** פעם אחת לכל התקנה (למשל פתיחה ראשונה) */
export function trackOnce(flag, path) {
  const key = `walkie:once:${flag}`;
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
  } catch {
    return false;
  }
  track(path);
  return true;
}

export const trackFeature = (name) => track(`feat.${safeKey(name)}`);

/** זמן טעינה: perf.<kind>_ms ו-perf.<kind>_n (הממוצע מחושב בדף הניהול) */
export function trackPerf(kind, ms) {
  if (!Number.isFinite(ms) || ms < 0 || ms > 120000) return;
  track(`perf.${kind}_ms`, Math.round(ms));
  track(`perf.${kind}_n`);
}

function schedule() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_MS);
}

function toFirestoreTree(tree, inc) {
  const out = {};
  for (const [k, v] of Object.entries(tree)) {
    out[k] = v && typeof v === 'object' ? toFirestoreTree(v, inc) : typeof v === 'number' ? inc(v) : v;
  }
  return out;
}

const dayKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);

export async function flush() {
  if (flushing || !enabled()) return;
  const batch = mergeTrees(readQueue(), pending);
  pending = {};
  if (!Object.keys(batch).length) return;
  flushing = true;
  try {
    const { firestore, modules } = await getFirebase(); // מונים אנונימיים: לא דורשים כניסה (גם מסך הכניסה נספר)
    const { doc, setDoc, increment } = modules.firestore;
    const date = dayKey();
    const shard = Math.floor(Math.random() * SHARDS);
    await setDoc(doc(firestore, 'analytics', `${date}_${shard}`), { date, shard, ...toFirestoreTree(batch, increment) }, { merge: true });
    writeQueue({});
  } catch (err) {
    writeQueue(batch); // בפעם הבאה
    console.debug('[analytics] flush failed', err?.message);
  } finally {
    flushing = false;
  }
}

// שמירה במכשיר לפני שהדף נסגר; מה שלא הספיק להישלח יישלח בפתיחה הבאה
function persistPending() {
  if (!Object.keys(pending).length) return;
  writeQueue(mergeTrees(readQueue(), pending));
  pending = {};
}
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    persistPending();
    flush();
  }
});
addEventListener('pagehide', persistPending);

// ---------- חיפושים שלא החזירו תוצאות ----------

const failedThisSession = new Set();

function hashQuery(q) {
  let h = 5381;
  for (let i = 0; i < q.length; i++) h = ((h << 5) + h + q.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** kind: 'place' | 'line' | 'station'. נשמר הטקסט המנורמל (עד 60 תווים), בלי מזהה משתמש */
export async function trackFailedSearch(q, kind = 'place') {
  const text = String(q ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
  if (!enabled() || text.length < 2 || failedThisSession.has(`${kind}|${text}`)) return;
  failedThisSession.add(`${kind}|${text}`);
  try {
    await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    const { doc, setDoc, increment, serverTimestamp } = modules.firestore;
    await setDoc(doc(firestore, 'failedSearches', `${kind}_${hashQuery(text)}`), {
      q: text, kind, count: increment(1), last: serverTimestamp()
    }, { merge: true });
  } catch {
    // לא חשוב
  }
}

// ---------- מקור הגעה (Attribution) ----------

function classify(params) {
  const raw = (params.get('utm_source') || params.get('src') || '').toLowerCase();
  const ref = (params.get('ref') || '').trim().toUpperCase();
  let source = raw || (ref ? 'friend_invite' : 'organic');
  if (source === 'wa') source = 'whatsapp';
  if (source === 'invite') source = 'friend_invite';
  return {
    source: safeKey(source),
    medium: safeKey(params.get('utm_medium') || (ref ? 'referral' : raw ? 'link' : 'none')),
    campaign: params.get('utm_campaign') ? safeKey(params.get('utm_campaign')) : null,
    ref: /^[A-Z0-9]{6}$/.test(ref) ? ref : null
  };
}

/** נקרא פעם אחת בעלייה: שומר את מקור ההגעה הראשון (First touch) ואת קוד ההזמנה הממתין */
export function captureAttribution() {
  try {
    const params = new URLSearchParams(location.search);
    const found = classify(params);
    const hasSignal = params.has('utm_source') || params.has('src') || params.has('ref');
    if (hasSignal && !localStorage.getItem(ATTR_KEY)) {
      localStorage.setItem(ATTR_KEY, JSON.stringify({ ...found, at: Date.now() }));
    }
    if (found.ref && !localStorage.getItem('walkie:pendingRef') && !localStorage.getItem('walkie:referral:done')) {
      localStorage.setItem('walkie:pendingRef', found.ref);
    }
    if (hasSignal && history.replaceState) {
      for (const k of ['ref', 'utm_source', 'utm_medium', 'utm_campaign', 'src']) params.delete(k);
      const qs = params.toString();
      history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
    }
    if (hasSignal) track(`share.link_open_${found.source === 'trip_share' ? 'trip' : found.ref ? 'invite' : 'other'}`);
  } catch {
    // ignore
  }
}

export function getAttribution() {
  try {
    const a = JSON.parse(localStorage.getItem(ATTR_KEY) || 'null');
    if (a) return { source: a.source, medium: a.medium, campaign: a.campaign ?? null, ref: a.ref ?? null };
  } catch {
    // ignore
  }
  return { source: 'organic', medium: 'none', campaign: null, ref: null };
}

// ---------- מכשיר ואזור ----------

async function deviceModel() {
  try {
    const uad = navigator.userAgentData;
    if (uad?.getHighEntropyValues) {
      const v = await uad.getHighEntropyValues(['model', 'platformVersion']);
      if (v.model) return { model: v.model, os: String(v.platformVersion || '').split('.')[0] };
    }
  } catch {
    // ignore
  }
  const ua = navigator.userAgent || '';
  const android = /Android\s([\d.]+)[^)]*?;\s*([^;)]+?)\s*(?:Build|\))/.exec(ua);
  if (android) return { model: android[2], os: android[1].split('.')[0] };
  if (/iPhone/.test(ua)) return { model: 'iPhone', os: (/OS (\d+)/.exec(ua) || [])[1] ?? '' };
  if (/iPad/.test(ua)) return { model: 'iPad', os: (/OS (\d+)/.exec(ua) || [])[1] ?? '' };
  return { model: 'desktop', os: '' };
}

/** פעם בפתיחה: פלטפורמה, דגם מכשיר, גרסת מערכת */
export async function trackDeviceSession(platform) {
  track(`dev.${safeKey(platform)}`);
  const { model, os } = await deviceModel();
  if (model) track(`model.${safeKey(model)}`);
  if (os) track(`os.${safeKey(`${platform}_${os}`)}`);
}

/** פעם בפתיחה, אחרי ה-GPS הראשון: מזהה העיר הקרובה (המיקום עצמו לא יוצא מהמכשיר). מחזיר את מזהה העיר */
export function trackRegion(lat, lng) {
  if (cityDone) return null;
  cityDone = true;
  const city = nearestCity(lat, lng);
  track(`city.${city}`);
  return city;
}

// ---------- מנויים: איזה פיצ'ר גרם לשדרוג ----------

const PAYWALL_KEY = 'walkie:lastPaywall';
const WAS_PLAY_KEY = 'walkie:wasPlay';

/** נקרא כשנפתח מסך ה-Premium. reason = הפיצ'ר/המגבלה שהובילו לשם (stops, lines, places, stats, settings) */
export function notePaywall(reason) {
  const r = safeKey(reason || 'settings');
  track(`paywall.${r}`);
  try {
    localStorage.setItem(PAYWALL_KEY, JSON.stringify({ reason: r, at: Date.now() }));
  } catch {
    // ignore
  }
}

/**
 * נקרא כשמצב המנוי ב-Google Play משתנה. מנוי חדש מיוחס למסך ה-Premium האחרון שנפתח (עד 7 ימים אחורה);
 * ביטול נספר כנטישה. הנטישה מדווחת כשהמשתמש פותח את האפליקציה, ולכן היא קצת מאוחרת מהביטול עצמו.
 */
export function noteSubscriptionState(isPlay) {
  let was = false;
  try {
    was = localStorage.getItem(WAS_PLAY_KEY) === '1';
    localStorage.setItem(WAS_PLAY_KEY, isPlay ? '1' : '0');
  } catch {
    return;
  }
  if (isPlay && !was) {
    track('sub.new');
    try {
      const last = JSON.parse(localStorage.getItem(PAYWALL_KEY) || 'null');
      track(`upgrade.${last && Date.now() - last.at < 7 * 86400000 ? last.reason : 'unknown'}`);
      localStorage.removeItem(PAYWALL_KEY);
    } catch {
      track('upgrade.unknown');
    }
  } else if (!isPlay && was) {
    track('sub.cancel');
  }
}
