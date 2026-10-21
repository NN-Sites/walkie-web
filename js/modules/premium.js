// Walkie Premium – מי פרימיום, ממה, ומה מותר בחינם.
//
// מקורות לפרימיום:
//   play  – מנוי פעיל ב-Google Play (billing.js)
//   admin – מתנה מהמנהל (Firestore: users/{uid}.premiumUntil)
//   test  – מצב בדיקה בדפדפן בפיתוח בלבד (localhost)
// המצב נשמר במכשיר, כדי שהפרימיום יעבוד גם בלי רשת.

import { PRICING, FREE_LIMITS, REFRESH_MS, mergePricing, priceAt } from './pricing.js';

const KEY = 'walkie:premium';
const STATS_KEY = 'walkie:stats';

const listeners = new Set();
let state = load();
let pricing = PRICING;
let limits = { ...FREE_LIMITS };
let openPaywall = null;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { play: !!s.play, adminUntil: s.adminUntil ?? null, test: !!s.test, since: s.since ?? null };
  } catch {
    return { play: false, adminUntil: null, test: false, since: null };
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
  for (const fn of listeners) fn(isPremium());
}

function adminActive() {
  if (!state.adminUntil) return false;
  return state.adminUntil === 'forever' || Date.parse(state.adminUntil) > Date.now();
}

export function isPremium() {
  return state.play || state.test || adminActive();
}

/** 'play' | 'admin' | 'test' | null */
export function premiumSource() {
  if (state.play) return 'play';
  if (adminActive()) return 'admin';
  if (state.test) return 'test';
  return null;
}

export function premiumInfo() {
  return { active: isPremium(), source: premiumSource(), adminUntil: state.adminUntil, since: state.since };
}

export function onPremiumChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function update(patch) {
  const was = isPremium();
  state = { ...state, ...patch };
  if (!was && isPremium() && !state.since) state.since = new Date().toISOString();
  if (!isPremium()) state.since = null;
  save();
}

export function setPlayActive(active) {
  if (state.play !== !!active) update({ play: !!active });
}

/** מתנה מהמנהל: תאריך ISO, 'forever', או null לביטול */
export function setAdminGrant(until) {
  if (state.adminUntil !== (until ?? null)) update({ adminUntil: until ?? null });
}

export const canUseTestPurchase = () =>
  !globalThis.Capacitor?.isNativePlatform?.() && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

export function setTestPremium(on) {
  if (canUseTestPurchase()) update({ test: !!on });
}

// ---------- מחירים ומגבלות (ניתנים לדריסה מהאדמין) ----------

export function getPricing() {
  return pricing;
}

export function currentPrice(now = Date.now()) {
  return priceAt(now, pricing);
}

/** config/pricing ו-config/limits מ-Firestore */
export function applyRemoteConfig({ pricing: p, limits: l } = {}) {
  if (p) pricing = mergePricing(p);
  if (l) {
    for (const k of Object.keys(FREE_LIMITS)) {
      if (Number.isInteger(l[k]) && l[k] >= 0) limits[k] = l[k];
    }
  }
  for (const fn of listeners) fn(isPremium());
}

export function freeLimit(kind) {
  return isPremium() ? Infinity : limits[kind] ?? Infinity;
}

export function refreshInterval() {
  return isPremium() ? REFRESH_MS.premium : REFRESH_MS.free;
}

// ---------- שער: הוספת מועדף מעבר למגבלה פותחת את מסך הפרימיום ----------

export function setPaywallOpener(fn) {
  openPaywall = fn;
}

export function showPaywall(reason) {
  openPaywall?.(reason);
}

/** true אם מותר להוסיף פריט נוסף מסוג kind, אחרת פותח את מסך הפרימיום */
export function allowAdd(kind, count) {
  if (count < freeLimit(kind)) return true;
  showPaywall(kind);
  return false;
}

// ---------- תרומות ----------

const DONATIONS_KEY = 'walkie:donations';

export function getDonations() {
  try {
    return { count: 0, total: 0, last: null, ...JSON.parse(localStorage.getItem(DONATIONS_KEY) || '{}') };
  } catch {
    return { count: 0, total: 0, last: null };
  }
}

export function recordDonation(amount) {
  const d = getDonations();
  const next = { count: d.count + 1, total: Math.round((d.total + amount) * 100) / 100, last: new Date().toISOString() };
  try {
    localStorage.setItem(DONATIONS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  for (const fn of listeners) fn(isPremium());
  return next;
}

/** מי שתרם פעם מקבל את תג התומך גם בלי מנוי */
export function isSupporter() {
  return isPremium() || getDonations().count > 0;
}

// ---------- סטטיסטיקה אישית (נאספת לכולם, מוצגת בפרימיום) ----------

const EMPTY_STATS = { walks: 0, walkMeters: 0, trips: 0, since: null };

export function getStats() {
  try {
    return { ...EMPTY_STATS, ...JSON.parse(localStorage.getItem(STATS_KEY) || '{}') };
  } catch {
    return { ...EMPTY_STATS };
  }
}

function saveStats(s) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function recordWalk(meters) {
  const s = getStats();
  saveStats({ ...s, walks: s.walks + 1, walkMeters: s.walkMeters + Math.max(0, Math.round(meters || 0)), since: s.since ?? new Date().toISOString() });
}

export function recordTrip() {
  const s = getStats();
  saveStats({ ...s, trips: s.trips + 1, since: s.since ?? new Date().toISOString() });
}

/** CO₂ שנחסך לעומת נסיעה ברכב פרטי (~170 גרם לק"מ) – הערכה גסה להליכה בלבד */
export function co2SavedKg(stats = getStats()) {
  return (stats.walkMeters / 1000) * 0.17;
}
