// פרסומת עם תגמול (rewarded): מחזירה true רק אם המשתמש צפה עד הסוף.
// באפליקציה עם תוסף AdMob (Capacitor.Plugins.AdMob) מוצגת מודעה אמיתית; בכל מקום אחר (דפדפן, בנייה בלי התוסף)
// מוצגת פרסומת הדגמה קצרה, כדי שכל זרימת החנות תעבוד כבר עכשיו.

import { REWARDED_AD_UNIT } from '../config.js?v=1.10.0-mvu2228r';
import { t } from './i18n.js?v=1.10.0-mvu2228r';

const DEMO_SECONDS = 5;
let busy = false;

export async function showRewardedAd() {
  if (busy) return false;
  busy = true;
  try {
    const admob = globalThis.Capacitor?.Plugins?.AdMob;
    if (admob && globalThis.Capacitor?.isNativePlatform?.()) {
      await admob.prepareRewardVideoAd({ adId: REWARDED_AD_UNIT });
      return !!(await admob.showRewardVideoAd());
    }
    return await demoAd();
  } catch {
    return false;
  } finally {
    busy = false;
  }
}

function demoAd() {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'rw-ad';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="rw-ad-card">
        <small>${t('פרסומת הדגמה')}</small>
        <div class="rw-ad-art" aria-hidden="true">📺</div>
        <p>${t('הפרסומת תסתיים בעוד {n} שניות', { n: `<b>${DEMO_SECONDS}</b>` })}</p>
        <div class="rw-ad-bar"><span></span></div>
        <button class="btn-secondary" type="button" data-skip>${t('ביטול')}</button>
      </div>`;
    document.body.appendChild(el);
    const bar = el.querySelector('.rw-ad-bar span');
    const count = el.querySelector('p b');
    let left = DEMO_SECONDS;
    const finish = (ok) => {
      clearInterval(timer);
      el.remove();
      resolve(ok);
    };
    const timer = setInterval(() => {
      left -= 1;
      if (count) count.textContent = String(left);
      if (left <= 0) finish(true);
    }, 1000);
    requestAnimationFrame(() => {
      bar.style.transitionDuration = `${DEMO_SECONDS}s`;
      bar.style.width = '100%';
    });
    el.querySelector('[data-skip]').addEventListener('click', () => finish(false));
  });
}
