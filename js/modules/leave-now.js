// "צאו עכשיו": תזכורת שמחשבת מתי צריך לצאת מהמקום כדי להספיק לקו הראשון במסלול.
//
// זמן היציאה = זמן היציאה של הקו (בזמן אמת אם יש) פחות זמן ההליכה לתחנה ופחות דקה של מרווח.
// ההתראה מתוזמנת במערכת (notify.js), ולכן מגיעה גם כשהאפליקציה סגורה או המסך נעול.
// כשהאפליקציה פתוחה והזמן אמת משתנה (איחור / האצה) – מתזמנים מחדש.

import { t } from './i18n.js?v=1.10.0-mvseambo';
import { showToast } from './ui.js?v=1.10.0-mvseambo';
import { vibrate } from './settings.js?v=1.10.0-mvseambo';
import { fmtTime } from './transit-ui.js?v=1.10.0-mvseambo';
import { trackFeature } from './analytics.js?v=1.10.0-mvseambo';
import { NOTIFY_ID, ensureNotifyPermission, scheduleNotification, cancelNotifications, notifySupported } from './notify.js?v=1.10.0-mvseambo';

const BUFFER_MS = 60 * 1000;
const RESCHEDULE_DIFF_MS = 30 * 1000;

let current = null;   // { key, leaveAt }

/** { key, leaveAt, dep, walkMin, line, stop } או null אם במסלול אין קו תחבורה ציבורית */
export function planLeave(it) {
  const idx = it.legs.findIndex((l) => l.mode !== 'walk');
  if (idx < 0) return null;
  const first = it.legs[idx];
  const dep = Date.parse(first.live?.eta ?? first.start);
  const walkMs = it.legs.slice(0, idx).reduce((sum, l) => sum + Math.max(0, Date.parse(l.end) - Date.parse(l.start)), 0);
  return {
    key: `${first.line}|${first.start}`,
    leaveAt: dep - walkMs - BUFFER_MS,
    dep,
    walkMin: Math.max(1, Math.round(walkMs / 60000)),
    line: first.line,
    stop: first.from?.name ?? ''
  };
}

export const hasLeaveReminder = (it) => {
  const p = it ? planLeave(it) : null;
  return !!p && current?.key === p.key;
};

function message(p) {
  return {
    title: t('צאו עכשיו 🚶'),
    body: t('קו {line} מ{stop} יוצא ב-{time}. ההליכה לתחנה לוקחת {n} דק\'.', { line: p.line, stop: p.stop, time: fmtTime(new Date(p.dep).toISOString()), n: p.walkMin })
  };
}

/** מפעיל / מבטל תזכורת למסלול. מחזיר true אם התזכורת פעילה אחרי הקריאה */
export async function toggleLeaveReminder(it) {
  const p = it ? planLeave(it) : null;
  if (!p) {
    showToast(t('אין במסלול הזה קו לתחנה, אז אין מה להזכיר.'));
    return false;
  }
  if (current?.key === p.key) {
    await clearLeaveReminder();
    showToast(t('התזכורת בוטלה'));
    return false;
  }
  if (p.dep < Date.now()) {
    showToast(t('הקו כבר יצא. אפשר לבחור מסלול אחר.'));
    return false;
  }
  if (p.leaveAt <= Date.now()) {
    vibrate([200, 100, 200]);
    showToast(t('צאו עכשיו! קו {line} יוצא ב-{time}', { line: p.line, time: fmtTime(new Date(p.dep).toISOString()) }), 6000);
    return false;
  }
  if (!notifySupported()) {
    showToast(t('תזכורות זמינות באפליקציית אנדרואיד'));
    return false;
  }
  const allowed = await ensureNotifyPermission({ prompt: true });
  if (!allowed) {
    showToast(t('כדי לקבל תזכורת צריך לאפשר התראות בהגדרות המכשיר'));
    return false;
  }
  const { title, body } = message(p);
  const ok = await scheduleNotification(NOTIFY_ID.leaveNow, p.leaveAt, title, body);
  if (!ok) return false;
  current = { key: p.key, leaveAt: p.leaveAt };
  trackFeature('leave_now');
  const inMin = Math.max(1, Math.round((p.leaveAt - Date.now()) / 60000));
  showToast(t('נתריע בעוד {n} דק\' – צריך לצאת ב-{time}', { n: inMin, time: fmtTime(new Date(p.leaveAt).toISOString()) }), 4500);
  return true;
}

/** זמן אמת התעדכן: אם הזמן זז מעל חצי דקה – מתזמנים מחדש */
export async function refreshLeaveReminder(it) {
  const p = it ? planLeave(it) : null;
  if (!p || current?.key !== p.key || Math.abs(p.leaveAt - current.leaveAt) < RESCHEDULE_DIFF_MS) return;
  if (p.leaveAt <= Date.now()) return;
  const { title, body } = message(p);
  if (await scheduleNotification(NOTIFY_ID.leaveNow, p.leaveAt, title, body)) current.leaveAt = p.leaveAt;
}

export async function clearLeaveReminder() {
  current = null;
  await cancelNotifications(NOTIFY_ID.leaveNow);
}
