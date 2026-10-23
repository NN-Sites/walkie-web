// תשלומים דרך Google Play Billing (cordova-plugin-purchase): מנוי Premium ותרומות.
//
// Google מחייבת Play Billing למנויים ולתרומות למפתח באפליקציות מהחנות.
// המוצרים מוגדרים ב-Play Console עם המזהים שב-pricing.js. ההגדרות מפורטות ב-docs/PREMIUM.md.
// בדפדפן ב-localhost אין Play: "רכישה" מפעילה מצב בדיקה (premium.js).

import { TIPS } from './pricing.js?v=1.5.0-mvkt9a3e';
import { t } from './i18n.js?v=1.5.0-mvkt9a3e';
import { getPricing, setPlayActive, setTestPremium, canUseTestPurchase, recordDonation } from './premium.js?v=1.5.0-mvkt9a3e';

let store = null;
let platform = null;
let product = null;
const tipProducts = new Map();
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn();
}

export function onBillingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const tipById = (id) => TIPS.find((t) => t.id === id);

function setup() {
  const C = globalThis.CdvPurchase;
  if (!C || store) return;
  store = C.store;
  platform = C.Platform.GOOGLE_PLAY;
  const id = getPricing().productId;

  store.register([
    { id, type: C.ProductType.PAID_SUBSCRIPTION, platform },
    ...TIPS.map((t) => ({ id: t.id, type: C.ProductType.CONSUMABLE, platform }))
  ]);
  store.when()
    .productUpdated((p) => {
      if (p.id === id) product = p;
      else if (tipById(p.id)) tipProducts.set(p.id, p);
      emit();
    })
    .approved((t) => t.verify())
    .verified((receipt) => receipt.finish())
    .finished((t) => {
      // תרומה: מוצר מתכלה – נרשם פעם אחת כשהעסקה נסגרת
      for (const p of t.products ?? []) {
        const tip = tipById(p.id);
        if (tip) recordDonation(tip.amount);
      }
    })
    .receiptUpdated(() => {
      setPlayActive(store.owned(id));
      emit();
    });

  store.initialize([platform]).then(() => {
    setPlayActive(store.owned(id));
    emit();
  }).catch((err) => console.warn('[billing] init failed', err));
}

/** נקרא פעם אחת בפתיחה. התוסף נטען רק אחרי deviceready של Cordova. */
export function initBilling() {
  if (globalThis.CdvPurchase) setup();
  else document.addEventListener('deviceready', setup, { once: true });
}

/** המחיר כפי ש-Google Play מציג (כולל מבצעים שהוגדרו שם). null אם עוד לא נטען. */
export function storePriceLabel() {
  return product?.pricing?.price ?? null;
}

export function billingAvailable() {
  return !!(store && product?.canPurchase) || canUseTestPurchase();
}

async function order(p) {
  const offer = p.getOffer();
  if (!offer) throw new Error(t('המוצר לא זמין כרגע ב-Google Play'));
  const err = await offer.order();
  if (err && err.code !== globalThis.CdvPurchase?.ErrorCode?.PAYMENT_CANCELLED) throw new Error(err.message);
  return !err;
}

export async function purchase() {
  if (store && product) return order(product);
  if (canUseTestPurchase()) {
    setTestPremium(true);
    return true;
  }
  throw new Error(t('התשלום זמין רק באפליקציה שהותקנה מ-Google Play'));
}

/** תרומה חד-פעמית. מחזיר true אם התשלום נשלח (התודה נרשמת כשהעסקה נסגרת). */
export async function donate(tipId) {
  const tip = tipById(tipId);
  if (!tip) throw new Error(t('סכום לא מוכר'));
  const p = tipProducts.get(tipId);
  if (store && p) return order(p);
  if (canUseTestPurchase()) {
    recordDonation(tip.amount); // בדיקה בדפדפן
    return true;
  }
  throw new Error(t('תרומה זמינה רק באפליקציה שהותקנה מ-Google Play'));
}

/** מחיר התרומה כפי ש-Play מציג, או הסכום מהקוד */
export function tipPriceLabel(tipId) {
  return tipProducts.get(tipId)?.pricing?.price ?? `${tipById(tipId)?.amount} ₪`;
}

export async function restore() {
  if (!store) {
    if (canUseTestPurchase()) return false;
    throw new Error(t('שחזור רכישות זמין רק באפליקציה'));
  }
  await store.restorePurchases();
  const owned = store.owned(getPricing().productId);
  setPlayActive(owned);
  return owned;
}

export async function manageSubscription() {
  if (store) return store.manageSubscriptions(platform);
  if (canUseTestPurchase()) setTestPremium(false); // בדיקה: ביטול המנוי המדומה
  return undefined;
}
