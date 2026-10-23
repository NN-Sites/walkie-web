// שיתוף המסלול בלייב: חבר מקבל קישור, רואה על מפה איפה אני עכשיו ומתי אגיע,
// ובדף הצפייה (public/live/) מוצעת לו הורדת האפליקציה (עם קוד ההזמנה שלי).
//
// נכתב מסמך liveShares/{מזהה אקראי} שמתעדכן כל כמה שניות מהמיקום האחרון. הקישור הוא ההרשאה לצפות;
// השיתוף נגמר כשהנסיעה נגמרת, כשלוחצים "הפסק שיתוף", או כשהאפליקציה נסגרת (הדף מציג "השיתוף הסתיים").

import { SHARE_BASE } from '../config.js?v=1.5.0-mvkt9a3e';
import { getFirebase, ensureSignedIn } from '../firebase-config.js?v=1.5.0-mvkt9a3e';
import { getReferral } from './referrals.js?v=1.5.0-mvkt9a3e';
import { openWhatsApp } from './share.js?v=1.5.0-mvkt9a3e';
import { track } from './analytics.js?v=1.5.0-mvkt9a3e';
import { t } from './i18n.js?v=1.5.0-mvkt9a3e';

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
  const code = getReferral().code ?? '';
  const url = `${SHARE_BASE}/t/${id}${code ? `?ref=${code}` : ''}`;

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
    ownerRef: code,
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
      await updateDoc(ref, { active: false, updatedAt: Date.now() }).catch(() => {});
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
    `${t('רואים איפה אני ומתי אגיע. ואם אין לכם עדיין את Walkie – יש שם קישור להורדה.')}`
  ].join('\n'));
}
