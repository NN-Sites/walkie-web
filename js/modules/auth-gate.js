// חובת התחברות עם Google.
// בפתיחה: מסך "ברוכים הבאים" עם התחברות עם Google, והוא חוסם את האפליקציה עד שנכנסים (אין דילוג ואין חיבור אנונימי).

import { accountInfo, onAccountChange, signInWithGoogle, accountErrorMessage } from './account.js?v=1.5.0-mvktlup2';
import { isFirebaseConfigured, ensureSignedIn, getFirebase } from '../firebase-config.js?v=1.5.0-mvktlup2';
import { setFavoritesGuard } from './favorites.js?v=1.5.0-mvktlup2';
import { showToast, escapeHtml } from './ui.js?v=1.5.0-mvktlup2';
import { t } from './i18n.js?v=1.5.0-mvktlup2';
import { track, trackOnce } from './analytics.js?v=1.5.0-mvktlup2';

const FLAG = 'walkie:google';   // מחובר עם Google במכשיר הזה (ידוע מיד בפתיחה, לפני ש-Firebase נטען)

export const GOOGLE_ICON = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

let dialog = null;
let pending = null;   // הפעולה שמחכה להתחברות

function readFlag() {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

function writeFlag(on) {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {
    // ignore
  }
}

/** חובה להתחבר עם Google. היחיד שמכבה את החסימה: Firebase לא מוגדר בכלל (פיתוח) */
function gateOff() {
  return !isFirebaseConfigured();
}

export function isSignedIn() {
  const a = accountInfo();
  if (a?.linked) return true;
  if (a && !a.unavailable) return false;
  return readFlag();
}

/**
 * לפני פעולה: true = אפשר להמשיך עכשיו.
 * false = נפתחה בקשה להתחבר; אחרי התחברות מוצלחת onAllowed() רץ לבד.
 */
export function requireSignIn(action, onAllowed = null) {
  if (gateOff() || isSignedIn()) return true;
  pending = onAllowed;
  open('prompt', action);
  return false;
}

/** מסך הפתיחה – רק למי שלא מחובר */
export async function showWelcomeIfNeeded() {
  if (gateOff()) return;
  // מחכים שמצב ההתחברות האמיתי ייטען מהמכשיר, כדי שמשתמש מחובר לא יראה את מסך הכניסה בפתיחה
  try {
    const { auth } = await getFirebase();
    await auth.authStateReady?.();
    const signedIn = !!auth.currentUser && !auth.currentUser.isAnonymous;
    writeFlag(signedIn);
    if (signedIn) return;
  } catch {
    if (isSignedIn()) return; // אין רשת: סומכים על הדגל השמור
  }
  open('welcome');
}

function open(mode, action = '') {
  close(false);
  // טוענים את Firebase כבר עכשיו – כדי שחלון ההתחברות של Google ייפתח מיד בלחיצה (ולא ייחסם)
  ensureSignedIn().catch(() => {});
  const welcome = mode === 'welcome';
  if (welcome) trackOnce('funnel:welcome', 'funnel.welcome_shown');
  dialog = document.createElement('div');
  dialog.className = `auth-gate is-${mode}`;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.innerHTML = `
    <div class="auth-card">
      ${welcome
        ? `<img class="auth-logo" src="icon.svg" alt="" width="72" height="72">
           <h2 class="auth-title">${t('ברוכים הבאים ל-Walkie')}</h2>
           <p class="auth-text">${t('התחברו עם Google כדי לתכנן מסלולים, לשמור מקומות ותחנות, ולקבל אותם בכל מכשיר.')}</p>`
        : `<div class="auth-icon" aria-hidden="true">🔐</div>
           <h2 class="auth-title">${t('צריך להתחבר')}</h2>
           <p class="auth-text">${escapeHtml(t('כדי {action} צריך להתחבר עם Google. זה לוקח רגע.', { action }))}</p>`}
      <button class="btn-google auth-google" type="button">${GOOGLE_ICON} ${t('התחברות עם Google')}</button>
      ${welcome ? `<p class="auth-fine">${t('ההתחברות חובה כדי להשתמש ב-Walkie.')}</p>` : `<button class="auth-skip" type="button">${t('לא עכשיו')}</button>`}
    </div>`;

  dialog.querySelector('.auth-google').addEventListener('click', (e) => signIn(e.currentTarget));
  dialog.querySelector('.auth-skip')?.addEventListener('click', () => close());
  if (!welcome) {
    // לחיצה מחוץ לכרטיס = "לא עכשיו"
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close();
    });
  }
  document.body.appendChild(dialog);
  requestAnimationFrame(() => dialog?.classList.add('is-open'));
  dialog.querySelector('.auth-google').focus({ preventScroll: true });
}

/** סוגר את החלון. dropPending=false משאיר את הפעולה (למשל כשמחליפים חלון בחלון) */
function close(dropPending = true) {
  if (dropPending) pending = null;
  if (!dialog) return;
  // סגירת מסך הפתיחה (דילוג או התחברות) = המשתמש הגיע למפה
  if (dialog.classList.contains('is-welcome')) trackOnce('funnel:map', 'funnel.map_reached');
  const el = dialog;
  dialog = null;
  el.classList.remove('is-open');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 400);
}

async function signIn(btn) {
  btn.disabled = true;
  track('funnel.signin_tap');
  try {
    const info = await signInWithGoogle();
    if (!info?.linked) return;
    trackOnce('funnel:signed', 'funnel.signed_in');
    writeFlag(true);
    const next = pending;
    close();
    showToast(t('מחובר כ-{name}', { name: info.name || info.email }));
    next?.();
  } catch (err) {
    const msg = accountErrorMessage(err);
    if (msg) showToast(msg);
  } finally {
    btn.disabled = false;
  }
}

/** חלון חזרה מכפתור "אחורה" באנדרואיד: true אם סגרנו חלון */
export function closeAuthDialog() {
  if (!dialog) return false;
  if (!dialog.classList.contains('is-welcome')) close(); // מסך הכניסה לא ניתן לסגירה
  return true;
}

// המצב האמיתי מהשרת מעדכן את הדגל (התנתקות במכשיר אחר, התחברות דרך ההגדרות וכו')
onAccountChange((a) => {
  if (!a || a.unavailable) return;
  writeFlag(!!a.linked);
  if (!a.linked && !gateOff() && !dialog) open('welcome'); // מחוברים? לא. המסך חוסם עד כניסה
  if (a.linked && dialog) {
    const next = pending;
    close();
    next?.();
  }
});

// שמירת מועדפים דורשת חשבון
setFavoritesGuard(() => requireSignIn(t('לשמור מועדפים')));
