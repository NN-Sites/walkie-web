// טיימר 90 דקות: מעבר חינם בין קווים (רפורמת "דרך שווה").
//
// המשתמש מפעיל אותו אחרי התיקוף הראשון ברב-קו (או מהצעה כשהוא עולה לקו בליווי נסיעה).
// מראה בכל מסך כמה זמן נשאר, ומתזמן התראות מקומיות: 15 דקות לפני הסוף, 5 דקות לפני הסוף, ובסיום.
// התנאים לפי הכללים ב-fares.js: ברדיוס של עד 15 ק"מ, ולא בשילוב רכבת ישראל.

import { t } from './i18n.js?v=1.10.0-mvsdq7td';
import { showToast } from './ui.js?v=1.10.0-mvsdq7td';
import { trackFeature } from './analytics.js?v=1.10.0-mvsdq7td';
import { NOTIFY_ID, ensureNotifyPermission, scheduleNotification, cancelNotifications, notifySupported } from './notify.js?v=1.10.0-mvsdq7td';

const KEY = 'walkie:transfer';
export const TRANSFER_WINDOW_MS = 90 * 60 * 1000;

const listeners = new Set();
let startedAt = load();
let chip = null;
let tickTimer = null;

function load() {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v && v + TRANSFER_WINDOW_MS > Date.now() ? v : null;
  } catch {
    return null;
  }
}

function save() {
  try {
    if (startedAt) localStorage.setItem(KEY, String(startedAt));
    else localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export const transferActive = () => !!startedAt && startedAt + TRANSFER_WINDOW_MS > Date.now();
export const transferRemainingMs = () => (transferActive() ? startedAt + TRANSFER_WINDOW_MS - Date.now() : 0);
export const onTransferChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function scheduleAlerts() {
  const end = startedAt + TRANSFER_WINDOW_MS;
  await cancelNotifications(NOTIFY_ID.transferSoon, NOTIFY_ID.transferLast, NOTIFY_ID.transferEnd);
  if (!notifySupported()) return;
  await scheduleNotification(NOTIFY_ID.transferSoon, end - 15 * 60000, t('טיימר 90 דקות'), t('נשארו 15 דקות למעבר חינם. כדאי לעלות לקו הבא.'));
  await scheduleNotification(NOTIFY_ID.transferLast, end - 5 * 60000, t('טיימר 90 דקות'), t('נשארו 5 דקות למעבר חינם.'));
  await scheduleNotification(NOTIFY_ID.transferEnd, end, t('טיימר 90 דקות'), t('חלון 90 הדקות הסתיים. עלייה לקו נוסף תחויב בנסיעה חדשה.'));
}

/** מפעיל (או מאפס) את הטיימר מרגע התיקוף */
export async function startTransferTimer(at = Date.now()) {
  startedAt = at;
  save();
  trackFeature('transfer_timer');
  renderChip();
  emit();
  // הרשאת התראות רק כאן – כשהמשתמש ביקש טיימר
  const allowed = await ensureNotifyPermission({ prompt: true });
  if (allowed) await scheduleAlerts();
  showToast(allowed || !notifySupported() ? t('הטיימר הופעל: 90 דקות למעבר חינם') : t('הטיימר הופעל. כדי לקבל התראות צריך לאפשר התראות בהגדרות המכשיר'));
}

export function stopTransferTimer() {
  startedAt = null;
  save();
  cancelNotifications(NOTIFY_ID.transferSoon, NOTIFY_ID.transferLast, NOTIFY_ID.transferEnd);
  renderChip();
  emit();
}

function emit() {
  for (const fn of listeners) fn(transferActive());
}

// ---------- תצוגה ----------

function renderChip() {
  if (!transferActive()) {
    clearInterval(tickTimer);
    tickTimer = null;
    chip?.remove();
    chip = null;
    if (startedAt) {
      startedAt = null; // הזמן עבר
      save();
      emit();
    }
    return;
  }
  if (!chip) {
    chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'transfer-chip';
    chip.addEventListener('click', openDetails);
    document.body.appendChild(chip);
  }
  const left = transferRemainingMs();
  chip.dataset.tone = left < 5 * 60000 ? 'urgent' : left < 15 * 60000 ? 'soon' : 'ok';
  chip.innerHTML = `<span aria-hidden="true">🎟️</span> <span>${t('מעבר חינם')}</span> <strong>${clock(left)}</strong>`;
  chip.setAttribute('aria-label', t('טיימר 90 דקות: נשארו {time}', { time: clock(left) }));
  if (!tickTimer) tickTimer = setInterval(renderChip, 1000);
}

function openDetails() {
  document.querySelector('.cm-modal.transfer-modal')?.remove();
  const el = document.createElement('div');
  el.className = 'cm-modal cm-center transfer-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="cm-card">
      <h2>${t('טיימר 90 דקות')}</h2>
      <p>${t('בתוך 90 דקות מהתיקוף הראשון אפשר לעבור בין קווים בלי לשלם שוב. התנאים: ברדיוס של עד 15 ק"מ, ולא בשילוב רכבת ישראל.')}</p>
      <p><strong>${t('נשארו {time}', { time: clock(transferRemainingMs()) })}</strong></p>
      <button type="button" class="btn-secondary" data-act="restart">${t('תיקפתי שוב (איפוס)')}</button>
      <button type="button" class="btn-secondary" data-act="stop">${t('הפסקת הטיימר')}</button>
      <button type="button" class="btn-go" data-act="close">${t('סגירה')}</button>
    </div>`;
  el.addEventListener('click', (e) => {
    const act = e.target.closest?.('[data-act]')?.dataset.act;
    if (e.target === el || act === 'close') return el.remove();
    if (act === 'restart') startTransferTimer().then(() => el.remove());
    if (act === 'stop') {
      stopTransferTimer();
      el.remove();
    }
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-open'));
}

/** הצעה בעת עלייה לקו בליווי נסיעה: "עליתם? הפעילו טיימר 90 דקות" */
export function offerTransferTimer() {
  if (transferActive()) return;
  document.querySelector('.transfer-offer')?.remove();
  const el = document.createElement('div');
  el.className = 'transfer-offer';
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <span>${t('תיקפתם ברב-קו? אפשר להפעיל טיימר 90 דקות למעבר חינם.')}</span>
    <button type="button" data-act="start">${t('הפעלה')}</button>
    <button type="button" data-act="no" aria-label="${t('סגירה')}">✕</button>`;
  el.addEventListener('click', (e) => {
    const act = e.target.closest?.('[data-act]')?.dataset.act;
    if (act === 'start') startTransferTimer();
    if (act) el.remove();
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 15000);
}

/** שורה בהגדרות: פעיל / לא פעיל */
export function toggleTransferTimer() {
  if (transferActive()) stopTransferTimer();
  else startTransferTimer();
}

const style = document.createElement('style');
style.textContent = `
.transfer-chip { position: fixed; z-index: 590; inset-inline-start: 12px; top: calc(env(safe-area-inset-top, 0px) + 150px);
  display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border: 0; border-radius: 999px; font: inherit; font-size: 13px;
  background: #0d9488; color: #fff; box-shadow: 0 4px 14px rgba(11,19,36,.28); }
.transfer-chip strong { font-variant-numeric: tabular-nums; }
.transfer-chip[data-tone="soon"] { background: #d97706; }
.transfer-chip[data-tone="urgent"] { background: #dc2626; }
.transfer-offer { position: fixed; z-index: 1300; inset-inline: 12px; bottom: calc(env(safe-area-inset-bottom, 0px) + 150px);
  display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 16px; background: #115e59; color: #fff; font-size: 14px;
  box-shadow: 0 8px 24px rgba(11,19,36,.3); }
.transfer-offer span { flex: 1; }
.transfer-offer button { border: 0; border-radius: 10px; padding: 8px 12px; font: inherit; font-weight: 700; background: #fff; color: #115e59; }
.transfer-offer button[data-act="no"] { background: transparent; color: #fff; padding: 8px; }
`;
document.head.appendChild(style);

onTransferChange(() => {});
renderChip();
// אם האפליקציה חזרה מהרקע, הטיימר ממשיך מאותו זמן התחלה
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderChip();
});
