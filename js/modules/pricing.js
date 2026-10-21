// Walkie Premium – מחירים, מבצע השקה ורשימת הפיצ'רים.
// מקום אחד לכל המספרים: האפליקציה ודף האדמין קוראים מכאן.
// המנהל יכול לדרוס את המחירים מדף האדמין (Firestore: config/pricing).
// המחיר שבפועל נגבה מוגדר ב-Google Play Console – צריך לעדכן גם שם.

export const PRICING = Object.freeze({
  currency: '₪',
  regular: 9.9,                                   // מחיר רגיל לחודש
  launch: 4.9,                                    // מחיר השקה לחודש
  launchEndsAt: '2027-01-01T00:00:00+02:00',      // 1.1.2027 בחצות, שעון ישראל
  productId: 'walkie_premium_monthly'             // מזהה המנוי ב-Google Play
});

// תרומות חד-פעמיות ("טיפ"). Google מחייבת Play Billing גם לתרומות למפתח –
// כל סכום הוא מוצר מתכלה (Consumable) ב-Play Console עם המזהה שכאן.
export const TIPS = Object.freeze([
  { id: 'walkie_tip_small', amount: 5, icon: '☕', label: 'קפה' },
  { id: 'walkie_tip_medium', amount: 15, icon: '🥙', label: 'פלאפל' },
  { id: 'walkie_tip_large', amount: 30, icon: '🚀', label: 'דלק לשרתים' }
]);

// מגבלות לחשבון חינמי (פרימיום = ללא הגבלה)
export const FREE_LIMITS = Object.freeze({ stops: 3, lines: 3, places: 3 });

// רענון זמן אמת (מילישניות)
export const REFRESH_MS = Object.freeze({ free: 30000, premium: 15000 });

export const PREMIUM_FEATURES = Object.freeze([
  { id: 'unlimited', icon: '⭐', title: 'מועדפים ללא הגבלה', desc: `תחנות, קווים ומקומות כמה שרוצים (בחינם: ${FREE_LIMITS.stops} מכל סוג)`, live: true },
  { id: 'fast-live', icon: '⚡', title: 'זמן אמת פי 2 מהר', desc: 'זמני ההגעה מתעדכנים כל 15 שניות במקום 30', live: true },
  { id: 'stats', icon: '📊', title: 'הסטטיסטיקה שלי', desc: 'כמה הלכת, כמה נסעת, וכמה CO₂ חסכת', live: true },
  { id: 'supporter', icon: '💚', title: 'תג תומך', desc: 'עוזרים לשמור את Walkie בלי פרסומות, לכולם', live: true },
  { id: 'bg-alerts', icon: '🔔', title: 'התראת ירידה גם כשהמסך כבוי', desc: 'הטלפון בכיס? נזכיר לרדת בתחנה', live: false },
  { id: 'leave-now', icon: '⏰', title: 'התראת "צאו עכשיו"', desc: 'לפי זמן ההליכה לתחנה וזמן האוטובוס בזמן אמת', live: false },
  { id: 'dark', icon: '🌙', title: 'מצב לילה', desc: 'ממשק ומפה כהים, נוחים לעיניים בערב', live: false },
  { id: 'widget', icon: '📱', title: 'ווידג\'ט למסך הבית', desc: 'האוטובוס הבא מהתחנה שלך, בלי לפתוח את האפליקציה', live: false },
  { id: 'offline', icon: '🗺️', title: 'מפת העיר אופליין', desc: 'ניווט גם בלי קליטה', live: false }
]);

/** מיזוג דריסה מהאדמין עם ברירות המחדל (שדות לא חוקיים נזרקים) */
export function mergePricing(override) {
  const p = { ...PRICING };
  if (!override || typeof override !== 'object') return p;
  if (Number(override.regular) > 0) p.regular = Number(override.regular);
  if (Number(override.launch) > 0) p.launch = Number(override.launch);
  if (override.launchEndsAt && !Number.isNaN(Date.parse(override.launchEndsAt))) p.launchEndsAt = override.launchEndsAt;
  return p;
}

/** אחוז ההנחה, מעוגל כלפי מטה כדי לא להבטיח יותר ממה שיש (9.90 -> 4.90 = 50.5% -> "50%") */
export function discountPercent(p = PRICING) {
  if (!(p.regular > 0) || p.launch >= p.regular) return 0;
  return Math.floor((1 - p.launch / p.regular) * 100);
}

/** המחיר שחל ברגע נתון */
export function priceAt(now = Date.now(), p = PRICING) {
  const ends = Date.parse(p.launchEndsAt);
  const isLaunch = p.launch < p.regular && now < ends;
  return {
    price: isLaunch ? p.launch : p.regular,
    regular: p.regular,
    launch: p.launch,
    isLaunch,
    discount: isLaunch ? discountPercent(p) : 0,
    endsAt: ends,
    daysLeft: isLaunch ? Math.ceil((ends - now) / 86400000) : 0
  };
}

export function formatPrice(n, p = PRICING) {
  return `${Number(n).toFixed(2)} ${p.currency}`;
}

/** "31.12.2026" – היום האחרון של המבצע */
export function formatLaunchEnd(p = PRICING) {
  const last = new Date(Date.parse(p.launchEndsAt) - 1);
  return last.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' });
}
