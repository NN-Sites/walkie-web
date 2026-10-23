// שיתוף מיקום בוואטסאפ: המיקום הנוכחי, או "אני בדרך – אגיע בערך ב-…" בזמן ניווט/נסיעה.
// שיתוף חד-פעמי (קישור למיקום ברגע השליחה) – לא מעקב רציף, ורק אחרי לחיצה של המשתמש.

import { t, LOCALE } from './i18n.js?v=1.5.0-mvkr2mw5';

const TZ = 'Asia/Jerusalem';

export const WHATSAPP_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.7 2.6 4.1 3.6 1.5.7 2.1.7 2.9.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.4-.2Z"/></svg>';

/** קישור למיקום שנפתח בכל טלפון (באפליקציית המפות של המקבל) */
export function mapLink({ lat, lng }) {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function clock(date) {
  return new Date(date).toLocaleTimeString(LOCALE, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

/** פותח וואטסאפ עם הודעה מוכנה (המשתמש בוחר למי לשלוח) */
export function openWhatsApp(text) {
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const win = window.open(url, '_blank', 'noopener');
  if (!win) window.location.href = url; // חסימת חלונות קופצים
}

export function shareMyLocation(position) {
  openWhatsApp(`📍 ${t('המיקום שלי עכשיו:')}\n${mapLink(position)}`);
}

/**
 * בזמן ניווט / נסיעה: "אני בדרך ל-X, אגיע בערך ב-HH:MM" + המיקום הנוכחי.
 * mode: 'walk' | 'transit'
 */
export function shareTrip({ position, destName, arrival, mode = 'walk', lineText = null }) {
  const how = mode === 'walk' ? `🚶 ${t('בהליכה')}` : `🚌 ${t('בתחבורה ציבורית')}${lineText ? ` (${lineText})` : ''}`;
  const lines = [
    `${t('אני בדרך ל{dest}', { dest: destName })} ${how}`,
    arrival ? `⏱️ ${t('אגיע בערך ב-{time}', { time: clock(arrival) })}` : null,
    position ? `📍 ${t('איפה אני עכשיו:')} ${mapLink(position)}` : null
  ].filter(Boolean);
  openWhatsApp(lines.join('\n'));
}
