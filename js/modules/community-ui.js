// מסכים של הקהילה: הזמנת חברים, דיווח על אוטובוס, שיתוף נסיעה בלייב, סקרים, הודעות מהמנהל ומסך חסימה.

import { t, tn } from './i18n.js?v=1.5.0-mvkrt633';
import { escapeHtml, showToast } from './ui.js?v=1.5.0-mvkrt633';
import { icon } from './transit-ui.js?v=1.5.0-mvkrt633';
import { celebrate } from './fx.js?v=1.5.0-mvkrt633';
import { track } from './analytics.js?v=1.5.0-mvkrt633';
import {
  getReferral, REFERRAL_TIERS, INVITEE_DAYS, nextTier, inviteLink, shareInvite, redeemCode, onReferralChange,
  refreshReferral, isInfluencer
} from './referrals.js?v=1.5.0-mvkrt633';
import { REPORT_TYPES } from './report-types.js?v=1.5.0-mvkrt633';
import { submitReport, markBroadcastSeen, answerSurvey, markSurveyDone } from './community.js?v=1.5.0-mvkrt633';

export { lineUsersText, lineUsersHtml } from './community.js?v=1.5.0-mvkrt633';
import { requireSignIn } from './auth-gate.js?v=1.5.0-mvkrt633';

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

// ---------- הזמנת חברים ----------

let inviteEl = null;

export function isInviteOpen() {
  return !!inviteEl;
}

export function closeInvite() {
  inviteEl?.remove();
  inviteEl = null;
}

function tierRows(count) {
  return REFERRAL_TIERS.map((tier) => {
    const done = count >= tier.n;
    const pct = Math.min(100, Math.round((count / tier.n) * 100));
    return `
      <li class="inv-tier${done ? ' is-done' : ''}">
        <span class="inv-tier-n">${done ? icon('check', 18) : tier.n}</span>
        <span class="inv-tier-text">
          <strong>${tn(tier.n, 'נרשם אחד', '{n} נרשמים')}</strong>
          <small>${escapeHtml(t(tier.title))}</small>
          ${done ? '' : `<span class="inv-bar"><i style="width:${pct}%"></i></span>`}
        </span>
        <span class="inv-tier-ic">${done ? '✅' : tier.badge ? '🏅' : '🎁'}</span>
      </li>`;
  }).join('');
}

function inviteHtml() {
  const r = getReferral();
  const next = nextTier(r.count);
  const left = next ? next.n - r.count : 0;
  return `
    <div class="pm-bar">
      <button class="icon-btn" type="button" data-inv="close" aria-label="${t('סגירה')}">${icon('back', 22)}</button>
    </div>
    <div class="pm-body inv-body">
      <div class="pm-hero">
        <span class="inv-emoji" aria-hidden="true">🎁</span>
        <h1>${t('הזמן חברים')}</h1>
        <p class="pm-sub">${t('מי שנרשם עם הקוד שלך מקבל יום Premium חינם, ואתם מתקדמים לפרסים.')}</p>
      </div>

      ${isInfluencer() ? `<div class="inv-badge-card"><span aria-hidden="true">🏅</span><div><strong>${t('משפיען כיתתי')}</strong><small>${t('התג מופיע בפרופיל שלך')}</small></div></div>` : ''}

      <section class="inv-code-card">
        <span class="inv-label">${t('קוד ההזמנה שלך')}</span>
        <button class="inv-code" type="button" data-inv="copy-code" aria-label="${t('העתקת הקוד')}"><bdi>${escapeHtml(r.code ?? '——')}</bdi></button>
        <div class="inv-actions">
          <button class="btn" type="button" data-inv="share" ${r.code ? '' : 'disabled'}>${t('שליחה בוואטסאפ')}</button>
          <button class="btn-secondary" type="button" data-inv="copy-link" ${r.code ? '' : 'disabled'}>${t('העתקת קישור')}</button>
        </div>
        ${r.code ? '' : `<p class="inv-fine inv-center">${t('הקוד נוצר כשהאפליקציה מתחברת לשרת. נסו שוב בעוד רגע.')}</p>`}
        <p class="inv-fine">${t('מי שנרשם עם הקוד מקבל {n} Premium חינם (התחברות עם Google).', { n: tn(INVITEE_DAYS, 'יום', '{n} ימים') })}</p>
      </section>

      <section class="inv-progress">
        <div class="inv-count"><strong>${r.count}</strong><span>${tn(r.count, 'חבר נרשם בזכותך', 'חברים נרשמו בזכותך')}</span></div>
        ${next ? `<p class="inv-next">${tn(left, 'עוד חבר אחד ל', 'עוד {n} חברים ל', { n: left })}${escapeHtml(t(next.title))}</p>` : `<p class="inv-next">${t('הגעת לכל הפרסים. תודה ענקית! 💚')}</p>`}
        <ul class="inv-tiers">${tierRows(r.count)}</ul>
      </section>

      ${r.referredBy ? `<p class="inv-fine inv-center">${t('נרשמת דרך הזמנה של חבר ✓')}</p>` : `
      <section class="inv-redeem">
        <h2>${t('יש לך קוד מחבר?')}</h2>
        <div class="inv-redeem-row">
          <input id="inv-input" class="inv-input" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABC123" aria-label="${t('קוד הזמנה')}">
          <button class="btn" type="button" data-inv="redeem">${t('מימוש')}</button>
        </div>
        <p class="inv-fine">${t('צריך להיות מחובר עם Google. מקבלים {n} Premium חינם.', { n: tn(INVITEE_DAYS, 'יום', '{n} ימים') })}</p>
      </section>`}

      <p class="pm-legal">${t('נרשם = משתמש חדש שהתחבר עם Google. כל חבר נספר פעם אחת, ואי אפשר להזמין את עצמך. ימי Premium מתווספים לתקופה שכבר יש לך.')}</p>
    </div>`;
}

export function openInvitePage() {
  if (inviteEl) return;
  track('feat.invite_open');
  const el = document.createElement('div');
  el.className = 'premium-overlay invite-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('הזמן חברים'));
  document.body.appendChild(el);
  inviteEl = el;

  const render = () => {
    if (!inviteEl) return;
    const input = el.querySelector('#inv-input')?.value ?? '';
    el.innerHTML = inviteHtml();
    const next = el.querySelector('#inv-input');
    if (next && input) next.value = input;
  };
  render();
  const off = onReferralChange(render);
  refreshReferral().catch(() => {});

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-inv]');
    if (!btn) return;
    const r = getReferral();
    switch (btn.dataset.inv) {
      case 'close':
        off();
        closeInvite();
        break;
      case 'share':
        shareInvite();
        break;
      case 'copy-code':
        copy(r.code, t('הקוד הועתק'));
        break;
      case 'copy-link':
        copy(inviteLink(), t('הקישור הועתק'));
        track('invite.link_copied');
        break;
      case 'redeem': {
        const code = el.querySelector('#inv-input').value;
        if (!requireSignIn(t('לממש קוד הזמנה'))) return;
        btn.disabled = true;
        try {
          await redeemCode(code);
          celebrate(btn, 36);
          showToast(t('הקוד מומש! קיבלת יום Premium 🎉'));
          await refreshReferral().catch(() => {});
        } catch (err) {
          showToast(err.message);
        } finally {
          btn.disabled = false;
        }
        break;
      }
      default:
    }
  });
}

async function copy(text, message) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch {
    showToast(text);
  }
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

