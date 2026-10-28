// התראות מקומיות (Capacitor Local Notifications): טיימר 90 דקות, "צאו עכשיו" ו"רדו בתחנה הבאה" כשהמסך נעול.
// מתזמנים את ההתראה במערכת עצמה, כך שהיא מגיעה גם כשהאפליקציה ברקע. בדפדפן אין התראות מקומיות.

import { t } from './i18n.js?v=1.10.0-mvsf7kai';

const CHANNEL = 'trip-alerts';

// מזהים קבועים, כדי שאפשר יהיה לבטל / להחליף התראה
export const NOTIFY_ID = Object.freeze({
  getOff: 9001,
  transferSoon: 9002,
  transferLast: 9003,
  transferEnd: 9004,
  leaveNow: 9010
});

const plugin = () => globalThis.Capacitor?.Plugins?.LocalNotifications ?? null;
export const notifySupported = () => !!globalThis.Capacitor?.isNativePlatform?.() && !!plugin();

let channelReady = false;

/** מבקש הרשאה (אם צריך) ויוצר את הערוץ. true אם אפשר להציג התראות */
export async function ensureNotifyPermission({ prompt = true } = {}) {
  if (!notifySupported()) return false;
  const P = plugin();
  try {
    let perm = (await P.checkPermissions())?.display;
    if (perm !== 'granted') {
      if (perm === 'denied' || !prompt) return false;
      perm = (await P.requestPermissions())?.display;
      if (perm !== 'granted') return false;
    }
    if (!channelReady) {
      await P.createChannel?.({
        id: CHANNEL,
        name: t('התראות נסיעה'),
        description: t('רדו בתחנה הבאה, צאו עכשיו וטיימר 90 דקות'),
        importance: 5,
        visibility: 1,
        vibration: true
      }).catch(() => {});
      channelReady = true;
    }
    return true;
  } catch {
    return false;
  }
}

/** מתזמן התראה לזמן מסוים (Date או ms). מחליף התראה קודמת עם אותו מזהה */
export async function scheduleNotification(id, at, title, body) {
  if (!(await ensureNotifyPermission({ prompt: false }))) return false;
  const when = new Date(at);
  if (!(when.getTime() > Date.now() + 1000)) return false;
  const P = plugin();
  try {
    await P.cancel({ notifications: [{ id }] }).catch(() => {});
    await P.schedule({
      notifications: [{ id, title, body, channelId: CHANNEL, schedule: { at: when, allowWhileIdle: true } }]
    });
    return true;
  } catch (err) {
    console.warn('[notify] schedule failed', err);
    return false;
  }
}

/** התראה מיידית (למשל "רדו בתחנה הבאה" כשהאפליקציה ברקע) */
export async function notifyNow(id, title, body) {
  if (!(await ensureNotifyPermission({ prompt: false }))) return false;
  try {
    await plugin().schedule({
      notifications: [{ id, title, body, channelId: CHANNEL, schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true } }]
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelNotifications(...ids) {
  if (!notifySupported()) return;
  await plugin().cancel({ notifications: ids.map((id) => ({ id })) }).catch(() => {});
}
