// קהילה: כמה משתמשי Walkie על כל קו, דיווחים על אוטובוסים, חסימות, הודעות מהמנהל וסקרים.
// כל הפונקציות שקטות: אם השרת לא זמין האפליקציה ממשיכה לעבוד כרגיל.

import { isFirebaseConfigured, getFirebase, ensureSignedIn } from '../firebase-config.js?v=1.5.0-mvktq49d';
import { track, safeKey } from './analytics.js?v=1.5.0-mvktq49d';
import { isPremium } from './premium.js?v=1.5.0-mvktq49d';
import { t } from './i18n.js?v=1.5.0-mvktq49d';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const PRESENCE_MS = 60000;      // דופק: מסמך הנוכחות מתחדש כל דקה
const PRESENCE_TTL_MS = 3 * 60000; // מי שלא התחדש 3 דקות כבר לא "על הקו"

const platformName = () => (globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.getPlatform() : 'web');

// ---------- נוכחות על קו ----------

/** "יש כרגע X משתמשי Walkie על הקו הזה" (המשתמש הבודק נספר, ולכן תמיד לפחות אחד) */
export function lineUsersText(n) {
  return n === 1 ? t('יש כרגע משתמש Walkie אחד על הקו הזה') : t('יש כרגע {n} משתמשי Walkie על הקו הזה', { n });
}

export function lineUsersHtml(n) {
  return `<div class="line-users${n == null ? ' is-empty' : ''}" data-line-users><span class="line-users-ic" aria-hidden="true">👥</span><span>${n == null ? '' : esc(lineUsersText(n))}</span></div>`;
}


export { lineKeyOf } from './keys.js?v=1.5.0-mvktq49d';

const presenceSources = { view: null, trip: null };
let presenceTimer = null;
let lastWritten = null;

function currentPresence() {
  return presenceSources.trip ?? presenceSources.view;
}

async function writePresence() {
  const p = currentPresence();
  if (!p || !isFirebaseConfigured() || document.hidden) return;
  try {
    const user = await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    const { doc, setDoc } = modules.firestore;
    await setDoc(doc(firestore, 'linePresence', user.uid), {
      lineKey: p.lineKey, line: String(p.line).slice(0, 12), kind: presenceSources.trip ? 'ride' : 'view', ts: Date.now()
    });
    lastWritten = p.lineKey;
  } catch {
    // לא חשוב
  }
}

/** source: 'view' (צופה בפרטי קו) | 'trip' (בנסיעה). info = { lineKey, line } או null להפסקה */
export function setPresence(source, info) {
  const before = currentPresence()?.lineKey;
  presenceSources[source] = info;
  const now = currentPresence();
  if (now && now.lineKey !== before) writePresence();
  if (now && !presenceTimer) presenceTimer = setInterval(writePresence, PRESENCE_MS);
  if (!now && presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
    clearPresenceDoc();
  }
}

async function clearPresenceDoc() {
  if (!lastWritten || !isFirebaseConfigured()) return;
  lastWritten = null;
  try {
    const user = await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    await modules.firestore.deleteDoc(modules.firestore.doc(firestore, 'linePresence', user.uid));
  } catch {
    // ignore
  }
}

/**
 * כמה משתמשי Walkie על הקו עכשיו. תמיד לפחות 1: המשתמש שבודק נספר בעצמו,
 * גם אם המסמך שלו עוד לא נכתב. מחזיר null רק אם השרת לא זמין.
 */
export async function fetchLineUsers(lineKey) {
  if (!isFirebaseConfigured()) return null;
  try {
    await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    const { collection, query, where, getCountFromServer } = modules.firestore;
    const snap = await getCountFromServer(query(
      collection(firestore, 'linePresence'),
      where('lineKey', '==', lineKey),
      where('ts', '>=', Date.now() - PRESENCE_TTL_MS)
    ));
    const n = snap.data().count;
    // המסמך שלי נכלל בספירה רק אם כבר נכתב ועדיין בתוקף
    const mine = lastWritten === lineKey ? 0 : 1;
    return Math.max(1, n + mine);
  } catch {
    return null;
  }
}

// ---------- דיווחים ----------

export { REPORT_TYPES } from './report-types.js?v=1.5.0-mvktq49d';

const REPORT_COOLDOWN_MS = 60000;
let lastReportAt = 0;

export async function submitReport({ lineKey, line, lineLabel, type, note }) {
  if (Date.now() - lastReportAt < REPORT_COOLDOWN_MS) throw Object.assign(new Error('cooldown'), { code: 'cooldown' });
  const user = await ensureSignedIn();
  const { firestore, modules } = await getFirebase();
  const { collection, addDoc } = modules.firestore;
  const data = {
    uid: user.uid,
    lineKey: lineKey ?? 'unknown',
    line: String(line ?? '').slice(0, 12),
    lineLabel: String(lineLabel ?? '').slice(0, 80),
    type,
    ts: Date.now(),
    status: 'new',
    platform: platformName()
  };
  const text = String(note ?? '').trim().slice(0, 200);
  if (text) data.note = text;
  try {
    await addDoc(collection(firestore, 'reports'), data);
  } catch (err) {
    if (err?.code === 'permission-denied') throw Object.assign(new Error('banned'), { code: 'banned' });
    throw err;
  }
  lastReportAt = Date.now();
  track(`report.${safeKey(type)}`);
}

// ---------- חסימה (באן) ----------

/** { banned, reason } לפי מסמך bans/{uid} */
export async function checkBan() {
  if (!isFirebaseConfigured()) return { banned: false };
  try {
    const user = await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    const { doc, getDoc } = modules.firestore;
    const own = await getDoc(doc(firestore, 'bans', user.uid)).catch(() => null);
    if (own?.exists() && own.data().active !== false) return { banned: true, reason: own.data().reason ?? null };
  } catch {
    // לא חוסמים בגלל תקלת רשת
  }
  return { banned: false };
}

// ---------- הודעות מהמנהל ----------

const SEEN_KEY = 'walkie:broadcasts:seen';

function readSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export function markBroadcastSeen(id) {
  const seen = readSeen();
  seen.add(id);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-60)));
  } catch {
    // ignore
  }
}

/** הודעות פעילות שהמשתמש עוד לא ראה. lineKeys = קווים שהמשתמש מתעניין בהם (מועדפים / קו פתוח / נסיעה) */
export async function fetchBroadcasts({ lineKeys = [] } = {}) {
  if (!isFirebaseConfigured()) return [];
  try {
    await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    const { collection, query, orderBy, limit, getDocs } = modules.firestore;
    const snap = await getDocs(query(collection(firestore, 'broadcasts'), orderBy('createdAt', 'desc'), limit(8)));
    const seen = readSeen();
    const now = Date.now();
    const premium = isPremium();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((b) => b.active !== false && !seen.has(b.id) && (!b.expiresAt || b.expiresAt > now))
      .filter((b) => b.audience === 'all' || !b.audience || (b.audience === 'premium' ? premium : !premium))
      .filter((b) => !b.lineKey || lineKeys.includes(b.lineKey));
  } catch {
    return [];
  }
}

// ---------- סקרים ----------

const SURVEY_KEY = 'walkie:surveys:done';

function readDone() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SURVEY_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export function markSurveyDone(id) {
  const done = readDone();
  done.add(id);
  try {
    localStorage.setItem(SURVEY_KEY, JSON.stringify([...done].slice(-60)));
  } catch {
    // ignore
  }
}

/** הסקר הפעיל הראשון שהמשתמש עוד לא ענה עליו / סגר */
export async function fetchActiveSurvey() {
  if (!isFirebaseConfigured()) return null;
  try {
    await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    const { collection, query, orderBy, limit, getDocs } = modules.firestore;
    const snap = await getDocs(query(collection(firestore, 'surveys'), orderBy('createdAt', 'desc'), limit(6)));
    const done = readDone();
    const now = Date.now();
    const premium = isPremium();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .find((s) => s.active !== false && !done.has(s.id) && (!s.expiresAt || s.expiresAt > now)
        && (s.audience === 'all' || !s.audience || (s.audience === 'premium' ? premium : !premium))) ?? null;
  } catch {
    return null;
  }
}

export async function answerSurvey(survey, choice) {
  markSurveyDone(survey.id);
  try {
    const user = await ensureSignedIn();
    const { firestore, modules } = await getFirebase();
    const { doc, setDoc } = modules.firestore;
    await setDoc(doc(firestore, 'surveyResponses', `${survey.id}_${user.uid}`), {
      surveyId: survey.id, uid: user.uid, choice, ts: Date.now()
    });
    track('survey.answered');
  } catch {
    // התשובה לא נשמרה (למשל כבר ענה) – לא מציגים שוב
  }
}
