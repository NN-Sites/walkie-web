// שכבת הנתונים של דף הניהול.
// FirebaseBackend – נתונים אמיתיים מ-Firestore, כניסה עם Google, הרשאה לפי firestore.rules.
// DemoBackend     – נתונים מומצאים בזיכרון, כדי לראות ולנסות את הדף בלי חיבור (?demo=1).
// לשניהם אותו ממשק, כך שהממשק לא יודע עם מי הוא מדבר.

import { firebaseConfig, isFirebaseConfigured } from '../js/firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
export const OWNER_EMAIL = 'noamn1047@gmail.com';

const DAY = 86400000;

/** תאריך לפי שעון ישראל (YYYY-MM-DD), כמו מזהי מסמכי האנליטיקה */
export const dayKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(ms);

/** מזהה מסמך חסימה לפי IP – אותה נוסחה כמו ב-functions/lib/community.js */
export const ipBanId = (ip) => `ip_${String(ip).trim().replace(/[^0-9a-fA-F]/g, '_')}`;

function sumInto(into, from) {
  for (const [k, v] of Object.entries(from ?? {})) {
    if (k === 'date' || k === 'shard') continue;
    if (v && typeof v === 'object') sumInto((into[k] ??= {}), v);
    else if (typeof v === 'number') into[k] = (into[k] ?? 0) + v;
    else into[k] = v;
  }
  return into;
}

/** מסמכי אנליטיקה (כמה רסיסים ליום) -> { byDay: {תאריך: עץ מונים}, total: עץ מונים } */
export function summarize(docs) {
  const byDay = {};
  const total = {};
  for (const d of docs) {
    sumInto((byDay[d.date] ??= {}), d);
    sumInto(total, d);
  }
  return { byDay, total };
}

/** שדות המשתמש כפי שהממשק מכיר אותם (תאריכים כמספרי ms) */
function normalizeUser(id, d) {
  const ts = (v) => (v?.toMillis ? v.toMillis() : typeof v === 'number' ? v : v ? Date.parse(v) : null);
  return {
    id,
    createdAt: ts(d.createdAt),
    lastSeenAt: ts(d.lastSeenAt),
    plan: d.plan === 'pro' ? 'pro' : 'free',
    premiumUntil: d.premiumUntil ?? null,
    premiumGrantedBy: d.premiumGrantedBy ?? null,
    premium: d.premium ?? { active: false, source: null, since: null },
    device: d.device ?? {},
    stats: d.stats ?? {},
    sessions: d.sessions ?? 0,
    notes: d.notes ?? '',
    refCode: d.refCode ?? null,
    referral: d.referral ?? null,
    authType: d.authType ?? (d.profile?.email ? 'google' : 'anonymous'),
    attribution: d.attribution ?? null,
    profile: d.profile ?? null,
    donations: d.donations ?? { count: 0, total: 0, last: null }
  };
}

/* =========================================================
   Firebase
   ========================================================= */

class FirebaseBackend {
  mode = 'live';

  async init() {
    const [appMod, authMod, fs] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`)
    ]);
    this.fs = fs;
    this.authMod = authMod;
    const app = appMod.initializeApp(firebaseConfig, 'admin');
    this.auth = authMod.getAuth(app);
    this.db = fs.getFirestore(app);
    await this.auth.authStateReady?.();
    return this.currentUser();
  }

  currentUser() {
    const u = this.auth.currentUser;
    return u && !u.isAnonymous ? { email: u.email, name: u.displayName, photo: u.photoURL } : null;
  }

  async signIn() {
    const provider = new this.authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await this.authMod.signInWithPopup(this.auth, provider);
    return this.currentUser();
  }

  async signOut() {
    await this.authMod.signOut(this.auth);
  }

  /** בודק הרשאת מנהל בפועל: קריאה שרק מנהל רשאי לבצע */
  async verifyAdmin() {
    const { doc, getDoc } = this.fs;
    await getDoc(doc(this.db, 'admins', this.auth.currentUser.email));
    return true;
  }

  /** כמה משתמשים פעילים עכשיו: ראינו אותם בדקות האחרונות (האפליקציה מעדכנת lastSeenAt כל כמה דקות כשהיא פתוחה) */
  async countOnline(minutes = 5) {
    const { collection, query, where, getCountFromServer, Timestamp } = this.fs;
    const snap = await getCountFromServer(query(collection(this.db, 'users'), where('lastSeenAt', '>=', Timestamp.fromMillis(Date.now() - minutes * 60000))));
    return snap.data().count;
  }

  async counts() {
    const { collection, query, where, getCountFromServer, Timestamp } = this.fs;
    const users = collection(this.db, 'users');
    const since = (days) => Timestamp.fromMillis(Date.now() - days * DAY);
    const count = async (...c) => (await getCountFromServer(query(users, ...c))).data().count;
    const [total, new7, active1, active7, active30, gifts, paying] = await Promise.all([
      count(),
      count(where('createdAt', '>=', since(7))),
      count(where('lastSeenAt', '>=', since(1))),
      count(where('lastSeenAt', '>=', since(7))),
      count(where('lastSeenAt', '>=', since(30))),
      count(where('plan', '==', 'pro')),
      count(where('premium.source', '==', 'play'))
    ]);
    return { total, new7, active1, active7, active30, gifts, paying };
  }

  async listUsers({ pageSize = 300, after = null } = {}) {
    const { collection, query, orderBy, limit, startAfter, getDocs } = this.fs;
    const c = [orderBy('lastSeenAt', 'desc'), limit(pageSize)];
    if (after) c.push(startAfter(after));
    const snap = await getDocs(query(collection(this.db, 'users'), ...c));
    return {
      users: snap.docs.map((d) => normalizeUser(d.id, d.data())),
      next: snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : null
    };
  }

  async signupsSince(days) {
    const { collection, query, where, getDocs, Timestamp } = this.fs;
    const snap = await getDocs(query(collection(this.db, 'users'), where('createdAt', '>=', Timestamp.fromMillis(Date.now() - days * DAY))));
    return snap.docs.map((d) => normalizeUser(d.id, d.data()));
  }

  /** חיפוש לפי מזהה תמיכה (תחילת ה-uid) */
  async findUsers(prefix) {
    const { collection, query, orderBy, startAt, endAt, limit, getDocs, documentId } = this.fs;
    const snap = await getDocs(query(collection(this.db, 'users'), orderBy(documentId()), startAt(prefix), endAt(`${prefix}`), limit(20)));
    return snap.docs.map((d) => normalizeUser(d.id, d.data()));
  }

  async updateUser(id, patch) {
    const { doc, updateDoc } = this.fs;
    await updateDoc(doc(this.db, 'users', id), patch);
  }

  async deleteUser(id) {
    const { doc, deleteDoc } = this.fs;
    await deleteDoc(doc(this.db, 'users', id));
  }

  async getConfig(id) {
    const { doc, getDoc } = this.fs;
    const d = await getDoc(doc(this.db, 'config', id));
    return d.exists() ? d.data() : null;
  }

  async setConfig(id, data) {
    const { doc, setDoc, serverTimestamp } = this.fs;
    await setDoc(doc(this.db, 'config', id), { ...data, updatedAt: serverTimestamp(), updatedBy: this.auth.currentUser.email });
  }

  async listAdmins() {
    const { collection, getDocs } = this.fs;
    const snap = await getDocs(collection(this.db, 'admins'));
    return snap.docs.map((d) => ({ email: d.id, ...d.data(), addedAt: d.data().addedAt?.toMillis?.() ?? null }));
  }

  async addAdmin(email) {
    const { doc, setDoc, serverTimestamp } = this.fs;
    await setDoc(doc(this.db, 'admins', email), { addedBy: this.auth.currentUser.email, addedAt: serverTimestamp() });
  }

  async removeAdmin(email) {
    const { doc, deleteDoc } = this.fs;
    await deleteDoc(doc(this.db, 'admins', email));
  }

  async log(action, target, details = {}) {
    const { collection, addDoc, serverTimestamp } = this.fs;
    await addDoc(collection(this.db, 'adminLog'), { at: serverTimestamp(), by: this.auth.currentUser.email, action, target, details }).catch(() => {});
  }

  async listLog(max = 100) {
    const { collection, query, orderBy, limit, getDocs } = this.fs;
    const snap = await getDocs(query(collection(this.db, 'adminLog'), orderBy('at', 'desc'), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data(), at: d.data().at?.toMillis?.() ?? null }));
  }

  /** מחזיר ערך שמתאים לשדה premiumUntil / תאריך שרת */
  serverTime() {
    return this.fs.serverTimestamp();
  }

  /* ---------- אנליטיקה ---------- */

  async getAnalytics(days) {
    const { collection, query, where, getDocs } = this.fs;
    const from = dayKey(Date.now() - (days - 1) * DAY);
    const snap = await getDocs(query(collection(this.db, 'analytics'), where('date', '>=', from)));
    return summarize(snap.docs.map((d) => d.data()));
  }

  /** פילוח לפי סוג הרשמה (שאילתות ספירה, בלי לטעון משתמשים) */
  async authCounts() {
    const { collection, query, where, getCountFromServer } = this.fs;
    const users = collection(this.db, 'users');
    const count = async (type) => (await getCountFromServer(query(users, where('authType', '==', type)))).data().count;
    const [google, email] = await Promise.all([count('google'), count('email')]);
    return { google, email };
  }

  async topInviters(max = 10) {
    const { collection, query, orderBy, limit, getDocs } = this.fs;
    // הרישומים האחרונים (עד 1000), מקובצים לפי המזמין
    const snap = await getDocs(query(collection(this.db, 'referralRedemptions'), orderBy('at', 'desc'), limit(1000)));
    const by = new Map();
    for (const d of snap.docs) {
      const { inviterUid, at } = d.data();
      const e = by.get(inviterUid) ?? { count: 0, last: 0 };
      e.count++;
      e.last = Math.max(e.last, at ?? 0);
      by.set(inviterUid, e);
    }
    const tiers = [5, 10, 20];
    return [...by.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, max).map(([id, e]) => ({
      id, lastSeenAt: e.last, referral: { count: e.count, awarded: tiers.filter((n) => n <= e.count), badge: e.count >= 5 }
    }));
  }

  async listFailedSearches(max = 60) {
    const { collection, query, orderBy, limit, getDocs } = this.fs;
    const snap = await getDocs(query(collection(this.db, 'failedSearches'), orderBy('count', 'desc'), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data(), last: d.data().last?.toMillis?.() ?? null }));
  }

  /* ---------- חסימות ---------- */

  async listBans() {
    const { collection, getDocs } = this.fs;
    const snap = await getDocs(collection(this.db, 'bans'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data(), at: d.data().at?.toMillis?.() ?? null }))
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  }

  async addBan({ type, value, reason }) {
    const { doc, setDoc, serverTimestamp } = this.fs;
    const id = type === 'ip' ? ipBanId(value) : value;
    await setDoc(doc(this.db, 'bans', id), { type, value, reason: reason || null, active: true, by: this.auth.currentUser.email, at: serverTimestamp() });
    return id;
  }

  async removeBan(id) {
    const { doc, deleteDoc } = this.fs;
    await deleteDoc(doc(this.db, 'bans', id));
  }

  /** מזהה מלא ממזהה תמיכה (תחילת ה-uid) או מ-uid מלא. null אם לא נמצא או לא חד-משמעי */
  async resolveUid(idOrPrefix) {
    const { doc, getDoc } = this.fs;
    const v = idOrPrefix.trim();
    if (v.length >= 20) return (await getDoc(doc(this.db, 'users', v))).exists() ? v : null;
    const found = await this.findUsers(v);
    return found.length === 1 ? found[0].id : null;
  }

  /* ---------- הודעות, סקרים, דיווחים ---------- */

  async listBroadcasts() {
    const { collection, query, orderBy, limit, getDocs } = this.fs;
    const snap = await getDocs(query(collection(this.db, 'broadcasts'), orderBy('createdAt', 'desc'), limit(30)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async saveBroadcast(data) {
    const { collection, addDoc } = this.fs;
    const ref = await addDoc(collection(this.db, 'broadcasts'), { ...data, active: true, createdAt: Date.now(), by: this.auth.currentUser.email });
    return ref.id;
  }

  async setBroadcastActive(id, active) {
    const { doc, updateDoc } = this.fs;
    await updateDoc(doc(this.db, 'broadcasts', id), { active });
  }

  async listSurveys() {
    const { collection, query, orderBy, limit, getDocs } = this.fs;
    const snap = await getDocs(query(collection(this.db, 'surveys'), orderBy('createdAt', 'desc'), limit(30)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async saveSurvey(data) {
    const { collection, addDoc } = this.fs;
    const ref = await addDoc(collection(this.db, 'surveys'), { ...data, active: true, createdAt: Date.now(), by: this.auth.currentUser.email });
    return ref.id;
  }

  async setSurveyActive(id, active) {
    const { doc, updateDoc } = this.fs;
    await updateDoc(doc(this.db, 'surveys', id), { active });
  }

  /** כמה בחרו בכל אפשרות */
  async surveyResults(survey) {
    const { collection, query, where, getCountFromServer } = this.fs;
    const col = collection(this.db, 'surveyResponses');
    return Promise.all((survey.options ?? []).map(async (_, i) =>
      (await getCountFromServer(query(col, where('surveyId', '==', survey.id), where('choice', '==', i)))).data().count));
  }

  async listReports(max = 100) {
    const { collection, query, orderBy, limit, getDocs } = this.fs;
    const snap = await getDocs(query(collection(this.db, 'reports'), orderBy('ts', 'desc'), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async updateReport(id, patch) {
    const { doc, updateDoc } = this.fs;
    await updateDoc(doc(this.db, 'reports', id), patch);
  }
}

/* =========================================================
   Demo – נתונים מומצאים, דטרמיניסטיים
   ========================================================= */

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoUsers(n = 260) {
  const r = rng(42);
  const now = Date.now();
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const id = () => Array.from({ length: 28 }, () => chars[Math.floor(r() * chars.length)]).join('');
  return Array.from({ length: n }, (_, i) => {
    // יותר הרשמות בשבועות האחרונים
    const createdAt = now - Math.pow(r(), 1.6) * 90 * DAY;
    const lastSeenAt = Math.min(now, createdAt + r() * (now - createdAt) * (r() < 0.6 ? 1 : 0.3));
    const paying = r() < 0.09;
    const gift = !paying && r() < 0.03;
    const walks = Math.floor(r() * 60);
    return normalizeUser(id(), {
      createdAt,
      lastSeenAt,
      plan: gift ? 'pro' : 'free',
      premiumUntil: gift ? (r() < 0.5 ? 'forever' : new Date(now + r() * 120 * DAY).toISOString()) : null,
      premiumGrantedBy: gift ? OWNER_EMAIL : null,
      premium: paying
        ? { active: true, source: 'play', since: new Date(createdAt + r() * (lastSeenAt - createdAt)).toISOString() }
        : gift ? { active: true, source: 'admin', since: new Date(createdAt).toISOString() } : { active: false, source: null, since: null },
      device: { platform: r() < 0.82 ? 'android' : 'web', appVersion: createdAt > now - 2 * DAY || r() < 0.55 ? '1.1.0' : '1.0', lang: r() < 0.9 ? 'he-IL' : 'en-US' },
      stats: { walks, walkMeters: Math.floor(walks * (400 + r() * 1400)), trips: Math.floor(r() * 45) },
      sessions: 1 + Math.floor(r() * 140),
      profile: r() < 0.22 ? { name: ['דנה', 'יוסי', 'מאיה', 'אורי', 'נועה', 'עומר'][i % 6] + ' ' + ['כהן', 'לוי', 'מזרחי', 'פרץ'][i % 4], email: `user${i}@gmail.com`, photo: null } : null,
      donations: r() < 0.06 ? (() => { const c = 1 + Math.floor(r() * 3); return { count: c, total: c * [5, 15, 30][Math.floor(r() * 3)], last: new Date(now - r() * 20 * DAY).toISOString() }; })() : { count: 0, total: 0, last: null },
      notes: i === 3 ? 'ביקש עזרה עם שחזור רכישה – טופל' : ''
    });
  });
}

/** נתוני אנליטיקה מומצאים ל-90 יום (מסמך אחד ליום), לשימוש במצב ההדגמה */
function demoAnalytics(days = 90) {
  const r = rng(7);
  const now = Date.now();
  const pick = (weights) => {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let x = r() * total;
    for (const [k, w] of Object.entries(weights)) if ((x -= w) <= 0) return k;
    return Object.keys(weights)[0];
  };
  const add = (obj, key, n = 1) => { obj[key] = (obj[key] ?? 0) + n; };
  const docs = [];
  for (let i = days - 1; i >= 0; i--) {
    const growth = 1 + (days - i) / days; // צמיחה הדרגתית
    const d = {
      date: dayKey(now - i * DAY), acq: {}, funnel: {}, feat: {}, paywall: {}, upgrade: {}, sub: {}, perf: {}, city: {},
      lines: {}, stations: {}, names: {}, dev: {}, model: {}, os: {}, share: {}, invite: {}, report: {}, push: {}, survey: {}
    };
    const opens = Math.round((4 + r() * 3) * growth);
    d.funnel = {
      first_open: opens,
      welcome_shown: Math.round(opens * 0.93),
      signin_tap: Math.round(opens * 0.55),
      signed_in: Math.round(opens * 0.46),
      map_reached: Math.round(opens * 0.74),
      account_created: opens
    };
    for (let k = 0; k < opens; k++) {
      add(d.acq, pick({ organic: 38, friend_invite: 22, trip_share: 14, whatsapp: 11, qr: 4, facebook: 4, instagram: 3, tiktok: 2, discord: 2 }));
      add(d.dev, pick({ android: 82, web: 12, ios: 6 }));
      add(d.model, pick({ sm_s918b: 9, sm_a546b: 12, pixel_7: 6, sm_g991b: 8, redmi_note_11: 7, iphone: 6, desktop: 8 }));
      add(d.city, pick({ tel_aviv: 22, jerusalem: 16, haifa: 11, rishon: 6, petah_tikva: 6, beer_sheva: 8, netanya: 5, ashdod: 5, holon: 4, ramat_gan: 5, other: 12 }));
    }
    d.os = { android_14: Math.round(opens * 0.4), android_13: Math.round(opens * 0.3), android_12: Math.round(opens * 0.12) };
    const feat = { tab_home: 3.2, tab_lines: 1.6, tab_stations: 1.1, tab_settings: 0.8, line_detail: 1.4, station_detail: 0.9, search: 1.7, nav_walk: 0.7, nav_transit: 0.6, share_location: 0.25, map_rotate: 0.05, invite_open: 0.18, report_open: 0.09, survey_shown: 0.1 };
    for (const [k, v] of Object.entries(feat)) d.feat[k] = Math.round(opens * v * (0.8 + r() * 0.4));
    for (const [k, v] of Object.entries({ stops: 5, lines: 3, places: 2, stats: 2, settings: 4 })) d.paywall[k] = Math.round(v * growth * (0.6 + r()));
    for (const [k, v] of Object.entries({ stops: 1.2, lines: 0.5, places: 0.3, stats: 0.6, settings: 0.8 })) d.upgrade[k] = Math.round(v * growth * r() * 1.6);
    d.sub = { new: Object.values(d.upgrade).reduce((a, b) => a + b, 0) };
    d.sub.cancel = Math.round(d.sub.new * (0.15 + r() * 0.25));
    d.perf = {
      map_ms: Math.round(opens * (1500 + r() * 500)), map_n: opens,
      gps_ms: Math.round(opens * 0.7 * (3200 + r() * 1200)), gps_n: Math.round(opens * 0.7),
      arrivals_ms: Math.round(opens * 4 * (700 + r() * 300)), arrivals_n: opens * 4
    };
    const lines = { 'bus_480_אגד': '480 · אגד', 'bus_5_דן': '5 · דן', 'bus_26_אגד': '26 · אגד', 'bus_18_אקסטרה': '18 · אקסטרה', 'bus_1_דן': '1 · דן', 'rail_רכבת_ישראל': 'רכבת ישראל', 'bus_61_תעבורה': '61 · תעבורה', 'bus_142_מטרופולין': '142 · מטרופולין' };
    const weights = [14, 12, 10, 8, 7, 6, 5, 4];
    Object.entries(lines).forEach(([k, name], idx) => {
      d.lines[k] = Math.round(weights[idx] * growth * (0.6 + r() * 0.8));
      d.names[k] = name;
    });
    const stations = { 21501: 'התחנה המרכזית תל אביב', 38004: 'עזריאלי', 10022: 'ביאליק/ז׳בוטינסקי', 51301: 'מרכז ירושלים', 60410: 'חיפה מרכז השמונה', 12040: 'אלנבי/הרצל' };
    for (const [k, name] of Object.entries(stations)) {
      d.stations[k] = Math.round(8 * growth * (0.5 + r()));
      d.names[k] = name;
    }
    d.share = {
      views: Math.round(opens * 0.55), cta_play: Math.round(opens * 0.17), cta_web: Math.round(opens * 0.08),
      trip_created: Math.round(opens * 0.4), trip_stopped: Math.round(opens * 0.3),
      link_open_trip: Math.round(opens * 0.2), link_open_invite: Math.round(opens * 0.25)
    };
    d.invite = { shared: Math.round(opens * 0.5), link_copied: Math.round(opens * 0.1), redeemed: Math.round(opens * 0.14) };
    for (const [k, v] of Object.entries({ crowded: 4, inspector: 6, delay: 5, breakdown: 1, driver: 1, other: 1 })) d.report[k] = Math.round(v * growth * r() * 1.3);
    d.survey = { answered: Math.round(opens * 0.05) };
    d.push = { shown: Math.round(opens * 0.2) };
    docs.push(d);
  }
  return docs;
}

class DemoBackend {
  mode = 'demo';
  analyticsDocs = demoAnalytics();
  bans = [{ id: 'ip_203_0_113_9', type: 'ip', value: '203.0.113.9', reason: 'דיווחי ספאם', active: true, by: OWNER_EMAIL, at: Date.now() - 6 * DAY }];
  broadcasts = [{ id: 'b1', title: 'שיבוש בקו 480', text: 'הקו מופנה בגלל עבודות בכביש 4 עד סוף השבוע.', audience: 'all', level: 'warning', lineKey: 'bus_480_אגד', lineLabel: 'קו 480 · אגד', createdAt: Date.now() - 2 * DAY, expiresAt: Date.now() + 2 * DAY, active: true }];
  surveys = [{ id: 's1', question: 'מה הכי חסר ב-Walkie?', options: ['התראות בזמן אמת', 'מפת עיר אופליין', 'ווידג׳ט למסך הבית', 'עוד שפות'], audience: 'all', createdAt: Date.now() - 4 * DAY, expiresAt: null, active: true, _votes: [34, 21, 41, 9] }];
  reports = Array.from({ length: 14 }, (_, i) => ({
    id: `r${i}`,
    uid: `demoUser${i}xxxxxxxxxxxxxxxxxxxx`,
    lineKey: 'bus_5_דן',
    line: ['5', '480', '26', '18'][i % 4],
    lineLabel: `קו ${['5', '480', '26', '18'][i % 4]} לכיוון תל אביב`,
    type: ['crowded', 'inspector', 'delay', 'breakdown', 'other'][i % 5],
    note: i % 3 === 0 ? 'עומס מטורף, אי אפשר לעלות' : '',
    ts: Date.now() - i * 37 * 60000,
    status: i < 9 ? 'new' : 'done',
    platform: 'android'
  }));
  users = demoUsers();
  config = {
    pricing: null,
    limits: null,
    announcement: { active: false, level: 'info', audience: 'all', title: '', text: '', until: '' }
  };
  admins = [{ email: OWNER_EMAIL, addedBy: 'owner', addedAt: Date.now() - 30 * DAY }];
  logEntries = [];

  async init() {
    return { email: OWNER_EMAIL, name: 'מצב הדגמה', photo: null };
  }

  currentUser() {
    return { email: OWNER_EMAIL, name: 'מצב הדגמה', photo: null };
  }

  async signIn() { return this.currentUser(); }
  async signOut() {}
  async verifyAdmin() { return true; }

  async countOnline(minutes = 5) {
    return this.users.filter((u) => u.lastSeenAt >= Date.now() - minutes * 60000).length || 3;
  }

  async counts() {
    const now = Date.now();
    const u = this.users;
    return {
      total: u.length,
      new7: u.filter((x) => x.createdAt >= now - 7 * DAY).length,
      active1: u.filter((x) => x.lastSeenAt >= now - DAY).length,
      active7: u.filter((x) => x.lastSeenAt >= now - 7 * DAY).length,
      active30: u.filter((x) => x.lastSeenAt >= now - 30 * DAY).length,
      gifts: u.filter((x) => x.plan === 'pro').length,
      paying: u.filter((x) => x.premium?.source === 'play').length
    };
  }

  async listUsers() {
    return { users: [...this.users].sort((a, b) => b.lastSeenAt - a.lastSeenAt), next: null };
  }

  async signupsSince(days) {
    return this.users.filter((u) => u.createdAt >= Date.now() - days * DAY);
  }

  async findUsers(prefix) {
    return this.users.filter((u) => u.id.startsWith(prefix)).slice(0, 20);
  }

  async updateUser(id, patch) {
    const u = this.users.find((x) => x.id === id);
    if (!u) throw new Error('המשתמש לא נמצא');
    Object.assign(u, patch);
    if ('plan' in patch) {
      u.premium = patch.plan === 'pro'
        ? { active: true, source: 'admin', since: new Date().toISOString() }
        : u.premium?.source === 'play' ? u.premium : { active: false, source: null, since: null };
    }
  }

  async deleteUser(id) {
    this.users = this.users.filter((u) => u.id !== id);
  }

  async getConfig(id) { return this.config[id] ? structuredClone(this.config[id]) : null; }
  async setConfig(id, data) { this.config[id] = { ...data, updatedAt: Date.now(), updatedBy: OWNER_EMAIL }; }
  async listAdmins() { return [...this.admins]; }
  async addAdmin(email) { this.admins.push({ email, addedBy: OWNER_EMAIL, addedAt: Date.now() }); }
  async removeAdmin(email) { this.admins = this.admins.filter((a) => a.email !== email); }

  async log(action, target, details = {}) {
    this.logEntries.unshift({ id: String(Date.now()), at: Date.now(), by: OWNER_EMAIL, action, target, details });
  }

  async listLog() { return [...this.logEntries]; }
  serverTime() { return Date.now(); }

  async getAnalytics(days) {
    const from = dayKey(Date.now() - (days - 1) * DAY);
    return summarize(this.analyticsDocs.filter((d) => d.date >= from));
  }

  async authCounts() {
    return { google: this.users.filter((u) => u.profile?.email).length, email: 0 };
  }

  async topInviters() {
    return this.users.slice(0, 8).map((u, i) => ({ ...u, referral: { count: [23, 14, 11, 8, 6, 5, 3, 2][i], awarded: [5, 10, 20].filter((n) => n <= [23, 14, 11, 8, 6, 5, 3, 2][i]), badge: i < 6 } }));
  }

  async listFailedSearches() {
    const rows = [['קו 999', 'line', 41], ['תחנה מרכזית ירושלים 2', 'place', 27], ['נתב"ג טרמינל 1', 'place', 22], ['קו 66ב', 'line', 18], ['שדרות רוטשילד 400', 'place', 15], ['מסוף קרית שמונה', 'station', 12], ['רכבת אשקלון צפון', 'station', 9]];
    return rows.map(([q, kind, count], i) => ({ id: `f${i}`, q, kind, count, last: Date.now() - i * 5 * 3600000 }));
  }

  async listBans() { return [...this.bans]; }

  async addBan({ type, value, reason }) {
    const id = type === 'ip' ? ipBanId(value) : value;
    this.bans.unshift({ id, type, value, reason: reason || null, active: true, by: OWNER_EMAIL, at: Date.now() });
    return id;
  }

  async removeBan(id) { this.bans = this.bans.filter((b) => b.id !== id); }

  async resolveUid(v) {
    const found = this.users.filter((u) => u.id.startsWith(v.trim()));
    return found.length === 1 ? found[0].id : null;
  }

  async listBroadcasts() { return [...this.broadcasts]; }

  async saveBroadcast(data) {
    const id = `b${Date.now()}`;
    this.broadcasts.unshift({ ...data, id, active: true, createdAt: Date.now() });
    return id;
  }

  async setBroadcastActive(id, active) {
    const b = this.broadcasts.find((x) => x.id === id);
    if (b) b.active = active;
  }

  async listSurveys() { return [...this.surveys]; }

  async saveSurvey(data) {
    const id = `s${Date.now()}`;
    this.surveys.unshift({ ...data, id, active: true, createdAt: Date.now(), _votes: data.options.map(() => 0) });
    return id;
  }

  async setSurveyActive(id, active) {
    const s = this.surveys.find((x) => x.id === id);
    if (s) s.active = active;
  }

  async surveyResults(survey) { return survey._votes ?? survey.options.map(() => 0); }

  async listReports() { return [...this.reports]; }

  async updateReport(id, patch) { Object.assign(this.reports.find((r) => r.id === id) ?? {}, patch); }
}

export function createBackend() {
  const demo = new URLSearchParams(location.search).has('demo') || !isFirebaseConfigured();
  return demo ? new DemoBackend() : new FirebaseBackend();
}

export function createDemoBackend() {
  return new DemoBackend();
}
