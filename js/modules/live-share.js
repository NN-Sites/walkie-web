// שיתוף המסלול בלייב: חבר מקבל קישור, רואה על מפה איפה אני עכשיו ומתי אגיע,
// הקישור מוביל לאתר הרשמי (OPEN_BASE/t/): אם Walkie מותקנת אצל החבר היא נפתחת ומציגה את הנסיעה (deep-link.js + public/live/),
// ואם לא – האתר מציג "Walkie לא מותקנת אצלך" וכפתור להורדה מ-Google Play.
//
// נכתב מסמך liveShares/{מזהה אקראי} שמתעדכן כל כמה שניות מהמיקום האחרון. הקישור הוא ההרשאה לצפות;
// השיתוף נגמר כשהנסיעה נגמרת או כשלוחצים "הפסק שיתוף": המיקום, המסלול והיעד נמחקים מהמסמך והדף מציג "השיתוף הסתיים".
// אם האפליקציה נסגרת בלי לעצור, הדף מציג "השיתוף הסתיים" אחרי 15 דקות בלי עדכון, אבל הנתונים האחרונים נשארים במסמך.

import { OPEN_BASE } from '../config.js?v=1.10.0-mvu2khrx';
import { getFirebase, ensureSignedIn } from '../firebase-config.js?v=1.10.0-mvu2khrx';
import { openWhatsApp } from './share.js?v=1.10.0-mvu2khrx';
import { track } from './analytics.js?v=1.10.0-mvu2khrx';
import { t } from './i18n.js?v=1.10.0-mvu2khrx';

const UPDATE_MS = 8000;
const MAX_PATH_POINTS = 160;

let active = null;

export const isLiveSharing = () => !!active;
export const liveShareUrl = () => active?.url ?? null;

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return Array.from(bytes, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}

/** מקצר את המסלול למספר נקודות סביר (מערך שטוח lat,lng,lat,lng…) */
function flattenPath(geometry) {
  if (!geometry?.length) return [];
  const step = Math.max(1, Math.ceil(geometry.length / MAX_PATH_POINTS));
  const out = [];
  for (let i = 0; i < geometry.length; i += step) out.push(+geometry[i][0].toFixed(5), +geometry[i][1].toFixed(5));
  const last = geometry[geometry.length - 1];
  out.push(+last[0].toFixed(5), +last[1].toFixed(5));
  return out;
}

/**
 * מתחיל שיתוף. getState() מחזיר את המצב העדכני: { pos, arrival }.
 * trip = { destName, dest: {lat,lng}, mode, lineText, geometry }
 * מחזיר { url, stop }.
 */
export async function startLiveShare({ trip, getState }) {
  if (active) return active;
  const user = await ensureSignedIn();
  const { firestore, modules } = await getFirebase();
  const { doc, setDoc, updateDoc } = modules.firestore;
  const id = newId();
  const ref = doc(firestore, 'liveShares', id);
  const url = `${OPEN_BASE}/t/?id=${id}`;

  const snapshot = () => {
    const s = getState() ?? {};
    return {
      pos: s.pos ? { lat: +s.pos.lat.toFixed(6), lng: +s.pos.lng.toFixed(6), acc: Math.round(s.pos.accuracy ?? 0) } : null,
      arrival: s.arrival ? Date.parse(s.arrival) || Number(s.arrival) || null : null,
      updatedAt: Date.now()
    };
  };

  await setDoc(ref, {
    ownerUid: user.uid,
    createdAt: Date.now(),
    active: true,
    destName: String(trip.destName ?? '').slice(0, 80),
    dest: trip.dest ? { lat: +trip.dest.lat.toFixed(6), lng: +trip.dest.lng.toFixed(6) } : null,
    mode: trip.mode ?? 'walk',
    lineText: trip.lineText ?? null,
    path: flattenPath(trip.geometry),
    ...snapshot()
  });

  const timer = setInterval(() => {
    updateDoc(ref, snapshot()).catch(() => {});
  }, UPDATE_MS);

  active = {
    id,
    url,
    async stop() {
      clearInterval(timer);
      active = null;
      track('share.trip_stopped');
      // מוחקים מהשרת את המיקום, המסלול והיעד: דף הצפייה יציג רק "השיתוף הסתיים"
      await updateDoc(ref, {
        active: false, updatedAt: Date.now(),
        pos: null, dest: null, path: [], destName: '', lineText: null, arrival: null
      }).catch(() => {});
    }
  };
  track('share.trip_created');
  return active;
}

export function stopLiveShare() {
  return active?.stop();
}

/** הודעת וואטסאפ עם קישור הצפייה */
export function sendLiveShareLink(url, destName) {
  openWhatsApp([
    `📍 ${t('אפשר לעקוב אחריי בלייב בדרך ל{dest}:', { dest: destName })}`,
    url,
    `${t('רואים איפה אני ומתי אגיע. אם Walkie מותקנת אצלכם הקישור ייפתח בה, ואם לא – יש שם קישור להורדה.')}`
  ].join('\n'));
}
