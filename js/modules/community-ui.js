// מסכים של הקהילה: דיווח על אוטובוס, שיתוף נסיעה בלייב, סקרים, הודעות מהמנהל ומסך חסימה.

import { t, tn } from './i18n.js?v=1.10.0-mvu2khrx';
import { escapeHtml, showToast } from './ui.js?v=1.10.0-mvu2khrx';
import { icon } from './transit-ui.js?v=1.10.0-mvu2khrx';
import { celebrate } from './fx.js?v=1.10.0-mvu2khrx';
import { track } from './analytics.js?v=1.10.0-mvu2khrx';
import { REPORT_TYPES } from './report-types.js?v=1.10.0-mvu2khrx';
import { submitReport, markBroadcastSeen, answerSurvey, markSurveyDone } from './community.js?v=1.10.0-mvu2khrx';

export { lineUsersText, lineUsersHtml } from './community.js?v=1.10.0-mvu2khrx';
import { requireSignIn } from './auth-gate.js?v=1.10.0-mvu2khrx';

// ---------- עזרים ----------

function modal(className, html) {
  const el = document.createElement('div');
  el.className = `cm-modal ${className}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = html;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-open'));
  const close = () => {
    el.classList.remove('is-open');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 350);
  };
  return { el, close };
}

// ---------- דיווח על אוטובוס ----------

/** ctx = { lineKey, line, lineLabel } */
export function openReportSheet(ctx) {
  if (!requireSignIn(t('לדווח'), () => openReportSheet(ctx))) return;
  track('feat.report_open');
  let picked = null;
  const m = modal('cm-sheet', `
    <div class="cm-card">
      <button class="cm-x" type="button" data-cm="close" aria-label="${t('סגירה')}">✕</button>
      <h2>${t('דיווח על האוטובוס')}</h2>
      <p class="cm-sub">${escapeHtml(ctx.lineLabel || t('קו {line}', { line: ctx.line }))}</p>
      <div class="rep-types">
        ${REPORT_TYPES.map((x) => `<button type="button" class="rep-type" data-type="${x.id}"><span aria-hidden="true">${x.icon}</span>${escapeHtml(t(x.label))}</button>`).join('')}
      </div>
      <textarea class="cm-note" maxlength="200" rows="2" placeholder="${t('פרטים נוספים (לא חובה)')}"></textarea>
      <button class="btn cm-send" type="button" data-cm="send" disabled>${t('המשך לשליחה')}</button>
    </div>`);

  const send = m.el.querySelector('.cm-send');
  m.el.addEventListener('click', (e) => {
    if (e.target === m.el || e.target.closest('[data-cm="close"]')) return m.close();
    const typeBtn = e.target.closest('.rep-type');
    if (typeBtn) {
      picked = typeBtn.dataset.type;
      for (const b of m.el.querySelectorAll('.rep-type')) b.classList.toggle('is-picked', b === typeBtn);
      send.disabled = false;
      return;
    }
    if (e.target.closest('[data-cm="send"]') && picked) confirmReport(ctx, picked, m.el.querySelector('.cm-note').value, m.close);
  });
}

/** האזהרה לפני שליחה: דיווח שקרי עלול להוביל לחסימה לצמיתות */
function confirmReport(ctx, type, note, closeSheet) {
  const w = modal('cm-center', `
    <div class="cm-card cm-warn">
      <div class="cm-warn-ic" aria-hidden="true">⚠️</div>
      <h2>${t('לפני שליחת הדיווח')}</h2>
      <p>${t('דיווח שיקרי עלול להוביל לבאן (חסימה) שלך לצמיתות מ-Walkie')}</p>
      <div class="cm-row">
        <button class="btn-secondary" type="button" data-cm="back">${t('ביטול')}</button>
        <button class="btn" type="button" data-cm="ok">${t('הבנתי, שליחת דיווח')}</button>
      </div>
    </div>`);
  w.el.addEventListener('click', async (e) => {
    if (e.target === w.el || e.target.closest('[data-cm="back"]')) return w.close();
    const ok = e.target.closest('[data-cm="ok"]');
    if (!ok) return;
    ok.disabled = true;
    try {
      await submitReport({ ...ctx, type, note });
      w.close();
      closeSheet();
      showToast(t('הדיווח נשלח. תודה שעוזרים לכולם 💚'));
    } catch (err) {
      ok.disabled = false;
      w.close();
      if (err.code === 'cooldown') showToast(t('כבר שלחת דיווח לפני רגע. נסו שוב בעוד דקה.'));
      else if (err.code === 'banned') showToast(t('אין אפשרות לשלוח דיווחים מהחשבון הזה'));
      else showToast(t('הדיווח לא נשלח. בדקו את החיבור ונסו שוב.'));
    }
  });
}

// ---------- שיתוף נסיעה ----------

/** בחירה בין שיתוף חד-פעמי (הודעה) לשיתוף בלייב. live = { url } אם שיתוף כבר פעיל */
export function openShareChooser({ live = null, onOnce, onLive, onStop, onCopy }) {
  const m = modal('cm-sheet', `
    <div class="cm-card">
      <button class="cm-x" type="button" data-cm="close" aria-label="${t('סגירה')}">✕</button>
      <h2>${t('שיתוף הנסיעה')}</h2>
      ${live ? `
        <p class="cm-sub">${t('השיתוף בלייב פעיל. החברים רואים את המיקום שלך ואת זמן ההגעה.')}</p>
        <button class="btn" type="button" data-cm="resend">${t('שליחת הקישור שוב')}</button>
        <button class="btn-secondary" type="button" data-cm="copy">${t('העתקת קישור')}</button>
        <button class="btn-danger-soft" type="button" data-cm="stop">${t('הפסק שיתוף')}</button>`
      : `
        <p class="cm-sub">${t('מי שמקבל את הקישור רואה את המיקום שלך על המפה, ויכול להוריד את Walkie מאותו דף.')}</p>
        <button class="btn" type="button" data-cm="live"><span aria-hidden="true">📡</span> ${t('שיתוף בלייב')}</button>
        <button class="btn-secondary" type="button" data-cm="once"><span aria-hidden="true">💬</span> ${t('רק זמן הגעה (הודעה חד-פעמית)')}</button>
        <p class="cm-fine">${t('השיתוף בלייב נגמר כשהנסיעה נגמרת או כשתפסיק אותו.')}</p>`}
    </div>`);
  m.el.addEventListener('click', async (e) => {
    if (e.target === m.el || e.target.closest('[data-cm="close"]')) return m.close();
    const b = e.target.closest('[data-cm]');
    if (!b) return;
    const a = b.dataset.cm;
    if (a === 'live') {
      b.disabled = true;
      try {
        await onLive();
        m.close();
      } catch (err) {
        b.disabled = false;
        showToast(err?.message === 'banned' ? t('אין אפשרות לשתף מהחשבון הזה') : t('לא הצלחנו להתחיל שיתוף. בדקו את החיבור.'));
      }
    } else if (a === 'once') {
      m.close();
      onOnce();
    } else if (a === 'resend') {
      m.close();
      onLive();
    } else if (a === 'copy') {
      onCopy?.();
    } else if (a === 'stop') {
      m.close();
      onStop();
      showToast(t('השיתוף הופסק'));
    }
  });
}

// ---------- סקר ----------

export function showSurvey(survey) {
  track('feat.survey_shown');
  const m = modal('cm-sheet', `
    <div class="cm-card">
      <button class="cm-x" type="button" data-cm="close" aria-label="${t('סגירה')}">✕</button>
      <span class="cm-kicker">${t('שאלה קצרה')}</span>
      <h2>${escapeHtml(survey.question)}</h2>
      <div class="sv-options">
        ${(survey.options ?? []).map((o, i) => `<button type="button" class="sv-opt" data-i="${i}">${escapeHtml(o)}</button>`).join('')}
      </div>
      <button class="cm-skip" type="button" data-cm="close">${t('לא עכשיו')}</button>
    </div>`);
  m.el.addEventListener('click', async (e) => {
    if (e.target === m.el || e.target.closest('[data-cm="close"]')) {
      markSurveyDone(survey.id); // סגר בלי לענות – לא מציקים שוב
      return m.close();
    }
    const o = e.target.closest('.sv-opt');
    if (!o) return;
    m.close();
    showToast(t('תודה על התשובה 💚'));
    await answerSurvey(survey, Number(o.dataset.i));
  });
}

// ---------- הודעה מהמנהל ----------

export function showBroadcast(b) {
  markBroadcastSeen(b.id);
  track('push.shown');
  const m = modal('cm-center', `
    <div class="cm-card cm-broadcast${b.level === 'warning' ? ' is-warning' : ''}">
      <div class="cm-warn-ic" aria-hidden="true">${b.level === 'warning' ? '⚠️' : '📣'}</div>
      ${b.title ? `<h2>${escapeHtml(b.title)}</h2>` : ''}
      <p>${escapeHtml(b.text)}</p>
      <button class="btn" type="button" data-cm="close">${t('הבנתי')}</button>
    </div>`);
  m.el.addEventListener('click', (e) => {
    if (e.target === m.el || e.target.closest('[data-cm="close"]')) m.close();
  });
}

// ---------- חסימה ----------

export function showBanScreen(reason) {
  if (document.querySelector('.ban-screen')) return;
  const el = document.createElement('div');
  el.className = 'ban-screen';
  el.setAttribute('role', 'alertdialog');
  el.innerHTML = `
    <div class="ban-card">
      <div class="ban-ic" aria-hidden="true">🚫</div>
      <h1>${t('החשבון נחסם')}</h1>
      <p>${t('החשבון הזה נחסם לצמיתות מ-Walkie.')}</p>
      ${reason ? `<p class="ban-reason">${escapeHtml(reason)}</p>` : ''}
      <p class="ban-fine">${t('אם לדעתך זו טעות, אפשר לפנות לתמיכה ולציין את מזהה התמיכה שלך בהגדרות.')}</p>
    </div>`;
  document.body.appendChild(el);
  document.documentElement.classList.add('is-banned');
}

