// ערים מרכזיות בישראל, להערכת "אזור" גסה בלי לשלוח מיקום לשרת:
// האפליקציה בוחרת במכשיר את העיר הקרובה ביותר, ורק שמה (למשל "haifa") נספר באנליטיקה.
// משותף לאפליקציה ולדף הניהול.

export const CITIES = Object.freeze([
  { id: 'tel_aviv', he: 'תל אביב-יפו', lat: 32.0853, lng: 34.7818 },
  { id: 'jerusalem', he: 'ירושלים', lat: 31.7683, lng: 35.2137 },
  { id: 'haifa', he: 'חיפה', lat: 32.794, lng: 34.9896 },
  { id: 'rishon', he: 'ראשון לציון', lat: 31.973, lng: 34.7925 },
  { id: 'petah_tikva', he: 'פתח תקווה', lat: 32.0878, lng: 34.8878 },
  { id: 'ashdod', he: 'אשדוד', lat: 31.8044, lng: 34.6553 },
  { id: 'netanya', he: 'נתניה', lat: 32.3215, lng: 34.8532 },
  { id: 'beer_sheva', he: 'באר שבע', lat: 31.253, lng: 34.7915 },
  { id: 'bnei_brak', he: 'בני ברק', lat: 32.0809, lng: 34.8338 },
  { id: 'holon', he: 'חולון', lat: 32.0158, lng: 34.7874 },
  { id: 'ramat_gan', he: 'רמת גן', lat: 32.0684, lng: 34.8248 },
  { id: 'ashkelon', he: 'אשקלון', lat: 31.6688, lng: 34.5743 },
  { id: 'rehovot', he: 'רחובות', lat: 31.8928, lng: 34.8113 },
  { id: 'bat_yam', he: 'בת ים', lat: 32.0231, lng: 34.7503 },
  { id: 'herzliya', he: 'הרצליה', lat: 32.1624, lng: 34.8447 },
  { id: 'kfar_saba', he: 'כפר סבא', lat: 32.1751, lng: 34.9066 },
  { id: 'hadera', he: 'חדרה', lat: 32.434, lng: 34.9196 },
  { id: 'modiin', he: 'מודיעין', lat: 31.8969, lng: 35.0104 },
  { id: 'lod', he: 'לוד', lat: 31.9515, lng: 34.8954 },
  { id: 'ramla', he: 'רמלה', lat: 31.9275, lng: 34.8625 },
  { id: 'raanana', he: 'רעננה', lat: 32.1848, lng: 34.8713 },
  { id: 'nazareth', he: 'נצרת', lat: 32.6996, lng: 35.3035 },
  { id: 'acre', he: 'עכו', lat: 32.9281, lng: 35.0818 },
  { id: 'tiberias', he: 'טבריה', lat: 32.7959, lng: 35.5312 },
  { id: 'eilat', he: 'אילת', lat: 29.5577, lng: 34.9519 },
  { id: 'karmiel', he: 'כרמיאל', lat: 32.9141, lng: 35.2961 },
  { id: 'afula', he: 'עפולה', lat: 32.6078, lng: 35.2897 },
  { id: 'kiryat_shmona', he: 'קריית שמונה', lat: 33.2074, lng: 35.5712 },
  { id: 'rosh_haayin', he: 'ראש העין', lat: 32.0956, lng: 34.9566 },
  { id: 'givatayim', he: 'גבעתיים', lat: 32.0714, lng: 34.8125 },
  { id: 'hod_hasharon', he: 'הוד השרון', lat: 32.1506, lng: 34.8888 },
  { id: 'beit_shemesh', he: 'בית שמש', lat: 31.7469, lng: 34.9886 },
  { id: 'kiryat_gat', he: 'קריית גת', lat: 31.61, lng: 34.7642 },
  { id: 'dimona', he: 'דימונה', lat: 31.07, lng: 35.0333 }
]);

export const CITY_LABELS = Object.freeze(Object.fromEntries([...CITIES.map((c) => [c.id, c.he]), ['other', 'אחר']]));

const MAX_KM = 20;

/** מזהה העיר הקרובה ביותר (עד 20 ק"מ), אחרת 'other' */
export function nearestCity(lat, lng) {
  const cos = Math.cos((lat * Math.PI) / 180);
  let best = null;
  let bestKm = Infinity;
  for (const c of CITIES) {
    const dy = (c.lat - lat) * 111.2;
    const dx = (c.lng - lng) * 111.2 * cos;
    const km = Math.hypot(dx, dy);
    if (km < bestKm) {
      bestKm = km;
      best = c;
    }
  }
  return best && bestKm <= MAX_KM ? best.id : 'other';
}
