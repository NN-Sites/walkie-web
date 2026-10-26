// התראות פוש לקווים שמורים: איחור (10 דק' ומעלה) וביטול נסיעה.
//
// הלקוח כותב לכל משתמש מסמך pushWatches/{uid} = { tokens, lines, lang }.
// פונקציה מתוזמנת (index.js) קוראת את כל המסמכים, מנטרת כל קו פעם אחת (גם אם כמה משתמשים שמרו אותו),
// ושולחת FCM רק על מה שחדש. מה שכבר נשלח נשמר במסמך (sent), כדי לא לחזור על אותה התראה.
//
// הניטור הוא ביציאה מתחנת המוצא של הקו (שם יש זמן אמת ולוח זמנים מלא), לא בתחנה שבה המשתמש עולה.

export const DELAY_MIN = 10;            // איחור שמצדיק התראה
export const ESCALATE_MIN = 5;          // התראה נוספת על אותה נסיעה רק אם האיחור גדל בעוד כך וכך דקות
export const LOOKAHEAD_MS = 45 * 60 * 1000;
export const LOOKBEHIND_MS = 3 * 60 * 1000;
export const MAX_LINES_PER_RUN = 150;
export const MAX_ALERTS_PER_LINE = 2;
const SENT_TTL_MS = 3 * 60 * 60 * 1000;
const CONCURRENCY = 4;
const QUIET_HOURS = [1, 4];             // 01:00-04:59 בישראל: אין שירות, לא בודקים
const INVALID_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

const TZ = 'Asia/Jerusalem';

export function israelHour(ms) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(ms));
}

function clock(iso, lang) {
  return new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

/**
 * מה צריך להתריע עליו, לפי מצב הקו ומה שכבר נשלח.
 * sent: { [key]: { delay, at } }. מחזיר [{ key, type: 'delay' | 'cancel', trip, delayMin }]
 */
export function decideAlerts(monitor, sent = {}, now = Date.now()) {
  const alerts = [];
  for (const trip of monitor.trips ?? []) {
    const at = Date.parse(trip.scheduled);
    if (!Number.isFinite(at) || at < now - LOOKBEHIND_MS || at > now + LOOKAHEAD_MS) continue;

    if (trip.cancelled) {
      const key = `c|${trip.tripId}|${trip.scheduled}`;
      if (!sent[key]) alerts.push({ key, type: 'cancel', trip, delayMin: null });
      continue;
    }

    if (trip.delayMin == null || trip.delayMin < DELAY_MIN) continue;
    const key = `d|${trip.tripId}|${trip.scheduled}`;
    const before = sent[key]?.delay;
    if (before == null || trip.delayMin >= before + ESCALATE_MIN) alerts.push({ key, type: 'delay', trip, delayMin: trip.delayMin });
  }
  return alerts.slice(0, MAX_ALERTS_PER_LINE);
}

const TEXT = {
  he: {
    lineWord: (m) => (m.mode === 'rail' ? 'הרכבת' : m.mode === 'lightrail' ? 'הרכבת הקלה' : `קו ${m.line}`),
    delayTitle: (m, a) => `${m.lineName} מאחר ${a.delayMin} דק'`,
    delayBody: (m, a, lang) => `היציאה של ${clock(a.trip.scheduled, lang)} מ${m.origin?.name ?? 'תחנת המוצא'} צפויה ב-${clock(a.trip.eta, lang)}`,
    cancelTitle: (m) => `נסיעה בוטלה ב${m.lineName}`,
    cancelBody: (m, a, lang) => `היציאה של ${clock(a.trip.scheduled, lang)} מ${m.origin?.name ?? 'תחנת המוצא'} בוטלה`
  },
  en: {
    lineWord: (m) => (m.mode === 'rail' ? 'Train' : m.mode === 'lightrail' ? 'Light rail' : `Line ${m.line}`),
    delayTitle: (m, a) => `${m.lineName} is ${a.delayMin} min late`,
    delayBody: (m, a, lang) => `The ${clock(a.trip.scheduled, lang)} departure from ${m.origin?.name ?? 'its first stop'} is now expected at ${clock(a.trip.eta, lang)}`,
    cancelTitle: (m) => `${m.lineName}: trip cancelled`,
    cancelBody: (m, a, lang) => `The ${clock(a.trip.scheduled, lang)} departure from ${m.origin?.name ?? 'its first stop'} was cancelled`
  }
};

export function buildMessage(monitor, alert, lang = 'he') {
  const L = TEXT[lang] ?? TEXT.he;
  const m = { ...monitor, lineName: L.lineWord(monitor) };
  return alert.type === 'cancel'
    ? { title: L.cancelTitle(m), body: L.cancelBody(m, alert, lang) }
    : { title: L.delayTitle(m, alert), body: L.delayBody(m, alert, lang) };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export class LineAlertService {
  /** db: Firestore (Admin), messaging: Admin Messaging, lines: LinesService */
  constructor({ lines, db, messaging, log = console, clock: nowFn = () => Date.now() }) {
    this.lines = lines;
    this.db = db;
    this.messaging = messaging;
    this.log = log;
    this.now = nowFn;
  }

  async run() {
    const now = this.now();
    const hour = israelHour(now);
    if (hour >= QUIET_HOURS[0] && hour < QUIET_HOURS[1]) return { skipped: 'quiet-hours' };

    const snap = await this.db.collection('pushWatches').get();
    const watchers = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      const tokens = Array.isArray(d.tokens) ? d.tokens.filter((t) => typeof t === 'string' && t) : [];
      const lines = Array.isArray(d.lines) ? d.lines.filter((l) => l?.lineRef) : [];
      if (tokens.length && lines.length) watchers.push({ ref: doc.ref, tokens, lines, lang: d.lang === 'en' ? 'en' : 'he', sent: d.sent ?? {} });
    }

    const refs = [...new Set(watchers.flatMap((w) => w.lines.map((l) => String(l.lineRef))))].slice(0, MAX_LINES_PER_RUN);
    const monitors = new Map();
    await mapLimit(refs, CONCURRENCY, async (ref) => {
      try {
        monitors.set(ref, await this.lines.monitor(ref));
      } catch (err) {
        this.log.warn?.(`[push] monitor ${ref} failed: ${err.message}`);
      }
    });

    let sentCount = 0;
    for (const w of watchers) {
      try {
        sentCount += await this.#notify(w, monitors, now);
      } catch (err) {
        this.log.warn?.(`[push] notify failed: ${err.message}`);
      }
    }
    return { watchers: watchers.length, lines: monitors.size, sent: sentCount };
  }

  async #notify(w, monitors, now) {
    const sent = Object.fromEntries(Object.entries(w.sent).filter(([, v]) => now - (v?.at ?? 0) < SENT_TTL_MS));
    const messages = [];
    const newSent = { ...sent };

    for (const l of w.lines) {
      const monitor = monitors.get(String(l.lineRef));
      if (!monitor) continue;
      for (const alert of decideAlerts(monitor, sent, now)) {
        const { title, body } = buildMessage(monitor, alert, w.lang);
        messages.push({ title, body, lineRef: String(l.lineRef), type: alert.type });
        newSent[alert.key] = { delay: alert.delayMin ?? 0, at: now };
      }
    }

    const pruned = Object.keys(newSent).length !== Object.keys(w.sent).length;
    if (!messages.length) {
      if (pruned) await w.ref.update({ sent: newSent }).catch(() => {});
      return 0;
    }

    const batch = w.tokens.flatMap((token) => messages.map((m) => ({
      token,
      notification: { title: m.title, body: m.body },
      data: { type: m.type, lineRef: m.lineRef },
      android: { priority: 'high', notification: { channelId: 'line-alerts', tag: `${m.lineRef}|${m.type}` } }
    })));
    const res = await this.messaging.sendEach(batch);

    const dead = new Set();
    res.responses.forEach((r, i) => {
      if (!r.success && INVALID_TOKEN.has(r.error?.code)) dead.add(batch[i].token);
    });
    const delivered = res.responses.some((r) => r.success);

    // אם לא נשלחה אפילו הודעה אחת (למשל תקלה זמנית) – לא מסמנים כנשלח, וננסה שוב בסבב הבא
    const update = {};
    if (delivered) update.sent = newSent;
    if (dead.size) update.tokens = w.tokens.filter((t) => !dead.has(t));
    if (Object.keys(update).length) await w.ref.update(update).catch(() => {});
    return delivered ? messages.length : 0;
  }
}
