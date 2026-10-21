// קטגוריות מקומות: מילים בעברית/אנגלית -> תגיות OpenStreetMap.
// phrase – ביטוי חיפוש באנגלית ל-Nominatim (גיבוי כש-Photon לא זמין).
// משמש לזיהוי חיפוש כמו "מסעדה", "בתי ספר", "סופר קרוב", ולתווית קטגוריה בתוצאות.

export const CATEGORIES = [
  { id: 'restaurant', phrase: 'restaurant', label: 'מסעדות', singular: 'מסעדה', emoji: '🍽️', tags: ['amenity:restaurant'], keywords: ['מסעדה', 'מסעדות', 'אוכל', 'restaurant', 'restaurants', 'food'] },
  { id: 'cafe', phrase: 'cafe', label: 'בתי קפה', singular: 'בית קפה', emoji: '☕', tags: ['amenity:cafe'], keywords: ['קפה', 'בית קפה', 'בתי קפה', 'קפה בר', 'cafe', 'coffee'] },
  { id: 'fast_food', phrase: 'fast food', label: 'מזון מהיר', singular: 'מזון מהיר', emoji: '🍔', tags: ['amenity:fast_food'], keywords: ['מזון מהיר', 'פלאפל', 'שווארמה', 'שוארמה', 'המבורגר', 'פיצריה', 'fast food', 'falafel'] },
  { id: 'bar', phrase: 'bar', label: 'ברים ופאבים', singular: 'בר', emoji: '🍺', tags: ['amenity:bar', 'amenity:pub'], keywords: ['בר', 'ברים', 'פאב', 'פאבים', 'bar', 'pub'] },
  { id: 'ice_cream', phrase: 'ice cream', label: 'גלידריות', singular: 'גלידריה', emoji: '🍦', tags: ['amenity:ice_cream'], keywords: ['גלידה', 'גלידריה', 'גלידריות', 'ice cream'] },
  { id: 'supermarket', phrase: 'supermarket', label: 'סופרמרקטים', singular: 'סופרמרקט', emoji: '🛒', tags: ['shop:supermarket', 'shop:convenience'], keywords: ['סופר', 'סופרמרקט', 'סופרמרקטים', 'מכולת', 'מכולות', 'מרכול', 'supermarket', 'grocery'] },
  { id: 'shop', phrase: 'shop', label: 'חנויות', singular: 'חנות', emoji: '🛍️', tags: ['shop'], keywords: ['חנות', 'חנויות', 'shop', 'shops', 'store'] },
  { id: 'mall', phrase: 'shopping mall', label: 'קניונים', singular: 'קניון', emoji: '🏬', tags: ['shop:mall'], keywords: ['קניון', 'קניונים', 'mall'] },
  { id: 'bakery', phrase: 'bakery', label: 'מאפיות', singular: 'מאפייה', emoji: '🥐', tags: ['shop:bakery'], keywords: ['מאפייה', 'מאפיה', 'מאפיות', 'bakery'] },
  { id: 'clothes', phrase: 'clothes shop', label: 'חנויות בגדים', singular: 'חנות בגדים', emoji: '👕', tags: ['shop:clothes', 'shop:shoes'], keywords: ['בגדים', 'חנות בגדים', 'ביגוד', 'נעליים', 'clothes'] },
  { id: 'pharmacy', phrase: 'pharmacy', label: 'בתי מרקחת', singular: 'בית מרקחת', emoji: '💊', tags: ['amenity:pharmacy', 'shop:chemist'], keywords: ['בית מרקחת', 'בתי מרקחת', 'פארם', 'סופר פארם', 'pharmacy'] },
  { id: 'school', phrase: 'school', label: 'בתי ספר', singular: 'בית ספר', emoji: '🏫', tags: ['amenity:school'], keywords: ['בית ספר', 'בתי ספר', 'ביס', 'בי"ס', 'school', 'schools'] },
  { id: 'kindergarten', phrase: 'kindergarten', label: 'גני ילדים', singular: 'גן ילדים', emoji: '🧸', tags: ['amenity:kindergarten', 'amenity:childcare'], keywords: ['גן ילדים', 'גני ילדים', 'גנון', 'מעון', 'kindergarten'] },
  { id: 'university', phrase: 'university', label: 'אוניברסיטאות ומכללות', singular: 'אקדמיה', emoji: '🎓', tags: ['amenity:university', 'amenity:college'], keywords: ['אוניברסיטה', 'אוניברסיטאות', 'מכללה', 'מכללות', 'university', 'college'] },
  { id: 'hospital', phrase: 'hospital', label: 'בתי חולים', singular: 'בית חולים', emoji: '🏥', tags: ['amenity:hospital'], keywords: ['בית חולים', 'בתי חולים', 'hospital'] },
  { id: 'clinic', phrase: 'clinic', label: 'מרפאות', singular: 'מרפאה', emoji: '🩺', tags: ['amenity:clinic', 'amenity:doctors'], keywords: ['מרפאה', 'מרפאות', 'קופת חולים', 'קופ"ח', 'רופא', 'clinic', 'doctor'] },
  { id: 'bank', phrase: 'bank', label: 'בנקים', singular: 'בנק', emoji: '🏦', tags: ['amenity:bank'], keywords: ['בנק', 'בנקים', 'bank'] },
  { id: 'atm', phrase: 'atm', label: 'כספומטים', singular: 'כספומט', emoji: '🏧', tags: ['amenity:atm'], keywords: ['כספומט', 'כספומטים', 'atm'] },
  { id: 'post', phrase: 'post office', label: 'סניפי דואר', singular: 'דואר', emoji: '📮', tags: ['amenity:post_office'], keywords: ['דואר', 'סניף דואר', 'post office'] },
  { id: 'park', phrase: 'park', label: 'פארקים וגינות', singular: 'פארק', emoji: '🌳', tags: ['leisure:park', 'leisure:garden'], keywords: ['פארק', 'פארקים', 'גינה', 'גינות', 'park'] },
  { id: 'playground', phrase: 'playground', label: 'גני שעשועים', singular: 'גן שעשועים', emoji: '🛝', tags: ['leisure:playground'], keywords: ['גן שעשועים', 'גני שעשועים', 'מגלשות', 'playground'] },
  { id: 'gym', phrase: 'gym', label: 'חדרי כושר', singular: 'חדר כושר', emoji: '🏋️', tags: ['leisure:fitness_centre'], keywords: ['חדר כושר', 'חדרי כושר', 'מכון כושר', 'gym'] },
  { id: 'worship', phrase: 'place of worship', label: 'בתי תפילה', singular: 'בית תפילה', emoji: '🕍', tags: ['amenity:place_of_worship'], keywords: ['בית כנסת', 'בתי כנסת', 'כנסת', 'מסגד', 'כנסייה', 'synagogue'] },
  { id: 'library', phrase: 'library', label: 'ספריות', singular: 'ספרייה', emoji: '📚', tags: ['amenity:library'], keywords: ['ספרייה', 'ספריה', 'ספריות', 'library'] },
  { id: 'cinema', phrase: 'cinema', label: 'בתי קולנוע', singular: 'קולנוע', emoji: '🎬', tags: ['amenity:cinema'], keywords: ['קולנוע', 'בית קולנוע', 'סינמה', 'cinema'] },
  { id: 'hotel', phrase: 'hotel', label: 'מלונות', singular: 'מלון', emoji: '🏨', tags: ['tourism:hotel', 'tourism:hostel'], keywords: ['מלון', 'מלונות', 'הוסטל', 'hotel'] },
  { id: 'museum', phrase: 'museum', label: 'מוזיאונים', singular: 'מוזיאון', emoji: '🏛️', tags: ['tourism:museum'], keywords: ['מוזיאון', 'מוזיאונים', 'museum'] },
  { id: 'toilets', phrase: 'toilets', label: 'שירותים ציבוריים', singular: 'שירותים', emoji: '🚻', tags: ['amenity:toilets'], keywords: ['שירותים', 'שירותים ציבוריים', 'toilets', 'wc'] },
  { id: 'police', phrase: 'police', label: 'תחנות משטרה', singular: 'משטרה', emoji: '🚓', tags: ['amenity:police'], keywords: ['משטרה', 'תחנת משטרה', 'police'] },
  { id: 'train', phrase: 'railway station', label: 'תחנות רכבת', singular: 'תחנת רכבת', emoji: '🚆', tags: ['railway:station'], keywords: ['רכבת', 'תחנת רכבת', 'תחנות רכבת', 'train station'] }
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

// מילים שלא משנות את הכוונה: "מסעדה קרובה", "בתי ספר באזור", "סופר הכי קרוב"
const FILLER = new Set(['קרוב', 'קרובה', 'קרובים', 'קרובות', 'הקרוב', 'הקרובה', 'הכי', 'ליד', 'לידי', 'באזור', 'בסביבה', 'בסביבתי', 'פה', 'כאן', 'near', 'nearby', 'me', 'near me', 'closest']);

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[״"']/g, (ch) => (ch === "'" ? '' : '"'))
    .replace(/[?!.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// מילון: מילת מפתח מנורמלת -> קטגוריה
const KEYWORD_INDEX = new Map();
for (const c of CATEGORIES) {
  for (const k of c.keywords) KEYWORD_INDEX.set(normalize(k), c);
}

export function getCategory(id) {
  return BY_ID.get(id) ?? null;
}

/** מזהה אם החיפוש הוא קטגוריה ("מסעדה", "המסעדה הקרובה", "בתי ספר באזור") */
export function matchCategory(query) {
  const tokens = normalize(query).split(' ').filter((t) => t && !FILLER.has(t));
  if (tokens.length === 0 || tokens.length > 3) return null;

  const candidates = [tokens.join(' ')];
  // ה' הידיעה: "המסעדה" -> "מסעדה", "הסופר" -> "סופר"
  if (tokens[0].startsWith('ה') && tokens[0].length > 2) {
    candidates.push([tokens[0].slice(1), ...tokens.slice(1)].join(' '));
  }

  for (const c of candidates) {
    const hit = KEYWORD_INDEX.get(c);
    if (hit) return hit;
  }
  return null;
}

// תווית בעברית לפי תגית OSM (לתת-כותרת בתוצאות)
const TAG_LABEL = new Map();
for (const c of CATEGORIES) {
  for (const t of c.tags) if (t.includes(':')) TAG_LABEL.set(t, { label: c.singular, id: c.id, emoji: c.emoji });
}

const EXTRA_LABELS = {
  'shop:shoes': 'חנות נעליים',
  'shop:convenience': 'מכולת',
  'shop:chemist': 'פארם',
  'shop:florist': 'חנות פרחים',
  'shop:jewelry': 'תכשיטים',
  'shop:bicycle': 'חנות אופניים',
  'shop:books': 'חנות ספרים',
  'shop:electronics': 'אלקטרוניקה',
  'shop:hairdresser': 'מספרה',
  'shop:optician': 'אופטיקה',
  'shop:greengrocer': 'ירקן',
  'shop:butcher': 'קצביה',
  'shop:toys': 'צעצועים',
  'shop:pet': 'חנות חיות',
  'shop:kiosk': 'קיוסק',
  'shop:mobile_phone': 'סלולר',
  'shop:alcohol': 'משקאות',
  'shop:beauty': 'טיפוח',
  'shop:furniture': 'רהיטים',
  'shop:hardware': 'כלי עבודה',
  'amenity:pub': 'פאב',
  'amenity:college': 'מכללה',
  'amenity:doctors': 'רופא',
  'amenity:childcare': 'מעון',
  'tourism:hostel': 'הוסטל',
  'tourism:attraction': 'אטרקציה',
  'leisure:garden': 'גינה',
  'leisure:sports_centre': 'מרכז ספורט',
  'leisure:stadium': 'אצטדיון',
  'leisure:swimming_pool': 'בריכה',
  'amenity:theatre': 'תיאטרון',
  'amenity:community_centre': 'מתנ"ס',
  'amenity:fuel': 'תחנת דלק',
  'amenity:parking': 'חניון',
  'amenity:townhall': 'עירייה'
};

export function labelForTag(key, value) {
  const tag = `${key}:${value}`;
  const known = TAG_LABEL.get(tag);
  if (known) return known;
  if (EXTRA_LABELS[tag]) {
    const parent = key === 'shop' ? BY_ID.get('shop') : null;
    return { label: EXTRA_LABELS[tag], id: parent?.id ?? null, emoji: parent?.emoji ?? null };
  }
  if (key === 'shop') return { label: 'חנות', id: 'shop', emoji: '🛍️' };
  return null;
}
