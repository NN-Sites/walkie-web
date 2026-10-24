// מסכי האנליטיקה והשליטה בדף הניהול:
// רכישת משתמשים, מנויים והכנסות, שיפור המוצר, דמוגרפיה וגיאוגרפיה, וניהול משתמשים (חסימות, הודעות, סקרים, דיווחים).
//
// הנתונים מגיעים ממונים יומיים (analytics/*) ש-public/js/modules/analytics.js שולח מהאפליקציה.
// ctx = { b: backend, state, esc, fmtNum, fmtMoney, fmtDateTime, fmtAgo, toast, barChart, distBars, priceAt, go }

import { CITY_LABELS } from '../js/modules/cities.js';
import { lineKeyOf } from '../js/modules/keys.js';
import { REPORT_TYPES } from '../js/modules/report-types.js';

const DAY = 86400000;
const RANGES = [7, 30, 90];

/* ---------- עזרים ---------- */

const sum = (obj) => Object.values(obj ?? {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
const ranked = (obj) => Object.entries(obj ?? {}).filter(([, v]) => typeof v === 'number').sort((a, b) => b[1] - a[1]);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const pctText = (a, b) => (b > 0 ? `${pct(a, b)}%` : '—');

const dayLabels = (days) => Array.from({ length: days }, (_, i) => {
  const d = new Date(Date.now() - (days - 1 - i) * DAY);
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
});

function dayKeys(days) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' });
  return Array.from({ length: days }, (_, i) => fmt.format(Date.now() - (days - 1 - i) * DAY));
}

const SOURCE_LABELS = {
  organic: 'ישיר / חנות', friend_invite: 'הזמנת חבר (קוד)', trip_share: 'שיתוף נסיעה מחבר', whatsapp: 'וואטסאפ',
  discord: 'דיסקורד', qr: 'סריקת QR', facebook: 'פייסבוק', instagram: 'אינסטגרם', tiktok: 'טיקטוק', twitter: 'טוויטר / X',
  telegram: 'טלגרם', youtube: 'יוטיוב', reddit: 'רדיט'
};
const sourceLabel = (k) => SOURCE_LABELS[k] ?? k.replace(/_/g, ' ');

const PAYWALL_LABELS = {
  stops: 'מועדפים: תחנות (מגבלה)', lines: 'מועדפים: קווים (מגבלה)', places: 'מקומות שמורים (מגבלה)', stats: 'סטטיסטיקה אישית',
  settings: 'כרטיס Premium בהגדרות', unknown: 'לא ידוע'
};
const paywallLabel = (k) => PAYWALL_LABELS[k] ?? k;

const FEATURES = [
  ['tab_lines', 'לשונית קווים'], ['tab_stations', 'לשונית תחנות'], ['tab_settings', 'הגדרות'], ['line_detail', 'פרטי קו'],
  ['station_detail', 'פרטי תחנה'], ['search', 'חיפוש יעד'], ['nav_walk', 'ניווט רגלי'], ['nav_transit', 'ליווי נסיעה'],
  ['share_location', 'שיתוף מיקום'], ['map_rotate', 'סיבוב מפה'], ['invite_open', 'הזמנת חברים'], ['report_open', 'דיווח על אוטובוס']
];

const PLATFORM_LABELS = { android: 'אנדרואיד', ios: 'אייפון', web: 'דפדפן' };

function rangeBar(ctx, current) {
  return `<div class="chips range-chips">${RANGES.map((d) => `<button type="button" data-range="${d}" class="${d === current ? 'is-active' : ''}">${d} ימים</button>`).join('')}</div>`;
}

async function loadAnalytics(ctx) {
  const days = ctx.state.range;
  const key = `${days}`;
  const cache = (ctx.state.analyticsCache ??= {});
  if (!cache[key] || Date.now() - cache[key].at > 60000) cache[key] = { at: Date.now(), data: await ctx.b.getAnalytics(days) };
  return cache[key].data;
}

function dailySeries(an, days, pick) {
  return dayKeys(days).map((k) => pick(an.byDay[k] ?? {}));
}

/** מחבר לחיצות על "N ימים" בראש המסך */
function bindRange(el, ctx, rerender) {
  el.querySelector('.range-chips')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    ctx.state.range = Number(b.dataset.range);
    rerender();
  });
}

function funnelRow(ctx, label, value, base, hint = '') {
  const w = base > 0 ? Math.max(2, Math.min(100, (value / base) * 100)) : 0;
  return `
    <div class="funnel-row">
      <span class="funnel-label">${ctx.esc(label)}${hint ? `<small>${ctx.esc(hint)}</small>` : ''}</span>
      <div class="track"><div class="fill" style="width:${w}%"></div></div>
      <span class="num">${ctx.fmtNum(value)}</span>
      <span class="pct">${pctText(value, base)}</span>
    </div>`;
}

const note = (ctx, text) => `<p class="note">${ctx.esc(text)}</p>`;

/* =========================================================
   1. רכישת משתמשים ומקורות הגעה
   ========================================================= */

export async function renderAcquisition(el, ctx) {
  const days = ctx.state.range;
  const [an, auth, inviters] = await Promise.all([loadAnalytics(ctx), ctx.b.authCounts(), ctx.b.topInviters(10)]);
  const total = ctx.state.counts.total;
  const anonymous = Math.max(0, total - auth.google - auth.email);
  const acq = an.total.acq ?? {};
  const signups = sum(acq);
  const share = an.total.share ?? {};
  const invite = an.total.invite ?? {};
  const shareClicks = (share.cta_play ?? 0) + (share.cta_web ?? 0);

  el.innerHTML = `
    ${rangeBar(ctx, days)}
    <div class="grid kpis">
      <div class="card kpi is-brand"><div class="label">סך משתמשים רשומים</div><div class="value">${ctx.fmtNum(total)}</div><div class="sub">+${ctx.fmtNum(signups)} ב-${days} הימים האחרונים</div></div>
      <div class="card kpi"><div class="label">חשבון Google</div><div class="value">${ctx.fmtNum(auth.google)}</div><div class="sub">${pctText(auth.google, total)} מהמשתמשים</div></div>
      <div class="card kpi"><div class="label">אימייל וסיסמה</div><div class="value">${ctx.fmtNum(auth.email)}</div><div class="sub">${pctText(auth.email, total)}</div></div>
      <div class="card kpi"><div class="label">אורח / אנונימי</div><div class="value">${ctx.fmtNum(anonymous)}</div><div class="sub">${pctText(anonymous, total)} · לא התחברו</div></div>
    </div>

    <div class="card">
      <h2>הרשמות ליום <small>· ${days} ימים אחרונים</small></h2>
      ${ctx.barChart(dayLabels(days), dailySeries(an, days, (d) => sum(d.acq)))}
    </div>

    <div class="grid cols-2">
      <div class="card">
        <h2>מאיפה הגיעו <small>· מקור ההגעה הראשון</small></h2>
        ${ctx.distBars(ranked(acq).map(([k, v]) => [sourceLabel(k), v]), signups)}
        ${note(ctx, 'המקור נקלט מפרמטרים בקישור (ref / utm_source). התקנות מחנות Google Play בלי קישור נספרות כ"ישיר / חנות".')}
      </div>
      <div class="card">
        <h2>אחוז המרה מהמלצות</h2>
        <h3 class="sub-h">שיתוף נסיעה לחבר</h3>
        ${funnelRow(ctx, 'נפתח דף הצפייה', share.views ?? 0, share.views ?? 0)}
        ${funnelRow(ctx, 'לחצו על הורדה / פתיחה', shareClicks, share.views ?? 0)}
        ${funnelRow(ctx, 'נרשמו (מקור: שיתוף נסיעה)', acq.trip_share ?? 0, share.views ?? 0, 'המרה סופית')}
        <h3 class="sub-h">הזמנת חברים בקוד</h3>
        ${funnelRow(ctx, 'הזמנות שנשלחו', invite.shared ?? 0, invite.shared ?? 0)}
        ${funnelRow(ctx, 'קישורי הזמנה שנפתחו', share.link_open_invite ?? 0, invite.shared ?? 0)}
        ${funnelRow(ctx, 'מימשו קוד (נרשמו עם Google)', invite.redeemed ?? 0, invite.shared ?? 0, 'המרה סופית')}
        ${note(ctx, `המרה כוללת: ${pctText(acq.trip_share ?? 0, share.views ?? 0)} משיתוף נסיעה, ${pctText(invite.redeemed ?? 0, invite.shared ?? 0)} מהזמנות.`)}
      </div>
    </div>

    <div class="card">
      <h2>המזמינים המובילים <small>· הזמנת חברים</small></h2>
      ${inviters.length ? `<div class="table-wrap static"><table>
        <thead><tr><th>מזהה</th><th>נרשמים בזכותו</th><th>פרסים שהושגו</th><th>תג</th><th>פעיל לאחרונה</th></tr></thead>
        <tbody>${inviters.map((u) => `<tr data-user="${ctx.esc(u.id)}"><td><bdi class="mono">${ctx.esc(u.id.slice(0, 8))}</bdi></td><td class="num">${ctx.fmtNum(u.referral.count)}</td><td>${ctx.esc((u.referral.awarded ?? []).map((n) => `${n}`).join(', ') || '—')}</td><td>${u.referral.badge ? '🏅 משפיען כיתתי' : '—'}</td><td>${ctx.fmtAgo(u.lastSeenAt)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">עדיין אין מי שהזמין חברים</div>'}
    </div>`;
  bindRange(el, ctx, () => renderAcquisition(el, ctx));
}

/* =========================================================
   2. מנויים, מונטיזציה והכנסות
   ========================================================= */

export async function renderRevenue(el, ctx) {
  const days = ctx.state.range;
  const an = await loadAnalytics(ctx);
  const c = ctx.state.counts;
  const price = ctx.priceAt(Date.now(), ctx.state.pricing);
  const paying = c.paying;
  const mrr = paying * price.price;
  const sub = an.total.sub ?? {};
  const cancels = sub.cancel ?? 0;
  const fresh = sub.new ?? 0;
  // נטישה = ביטולים בתקופה, מתוך מי שהיה מנוי בתחילתה (מנויים היום + ביטולים - חדשים)
  const base = Math.max(1, paying + cancels - fresh);
  const paywall = an.total.paywall ?? {};
  const upgrade = an.total.upgrade ?? {};
  const features = [...new Set([...Object.keys(paywall), ...Object.keys(upgrade)])]
    .map((k) => ({ k, opens: paywall[k] ?? 0, up: upgrade[k] ?? 0 }))
    .sort((a, b) => b.up - a.up || b.opens - a.opens);
  const top = features[0];

  el.innerHTML = `
    ${rangeBar(ctx, days)}
    <div class="grid kpis">
      <div class="card kpi is-brand"><div class="label">מנויים פעילים (משלמים)</div><div class="value">${ctx.fmtNum(paying)}</div><div class="sub">עוד ${ctx.fmtNum(c.gifts)} עם Premium במתנה</div></div>
      <div class="card kpi is-accent"><div class="label">הכנסה חודשית חוזרת (MRR)</div><div class="value">${ctx.fmtMoney(mrr)}</div><div class="sub">${paying} × ${ctx.fmtMoney(price.price)} · לפני עמלת Google</div></div>
      <div class="card kpi"><div class="label">המרה לפרימיום</div><div class="value">${pctText(paying, c.total)}</div><div class="sub">${ctx.fmtNum(paying)} מתוך ${ctx.fmtNum(c.total)} משתמשים</div></div>
      <div class="card kpi"><div class="label">הפיצ'ר הממיר ביותר</div><div class="value value-sm">${top && top.up > 0 ? ctx.esc(paywallLabel(top.k)) : '—'}</div><div class="sub">${top && top.up > 0 ? `${ctx.fmtNum(top.up)} שדרוגים ב-${days} ימים` : 'עוד אין שדרוגים'}</div></div>
      <div class="card kpi"><div class="label">שיעור נטישה</div><div class="value">${pctText(cancels, base)}</div><div class="sub">${ctx.fmtNum(cancels)} ביטולים · ${ctx.fmtNum(fresh)} מנויים חדשים ב-${days} ימים</div></div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <h2>מנויים חדשים וביטולים ליום</h2>
        ${ctx.barChart(dayLabels(days), dailySeries(an, days, (d) => d.sub?.new ?? 0))}
        <div class="legend-row"><span><i class="lg lg-brand"></i>מנויים חדשים</span><span class="muted">ביטולים בתקופה: ${ctx.fmtNum(cancels)}</span></div>
      </div>
      <div class="card">
        <h2>איזה פיצ'ר גרם לשדרוג</h2>
        ${features.length ? `<div class="table-wrap static"><table>
          <thead><tr><th>הפיצ'ר / המסך</th><th>נפתח מסך Premium</th><th>שדרגו</th><th>המרה</th></tr></thead>
          <tbody>${features.map((f) => `<tr><td>${ctx.esc(paywallLabel(f.k))}</td><td class="num">${ctx.fmtNum(f.opens)}</td><td class="num">${ctx.fmtNum(f.up)}</td><td class="num">${pctText(f.up, f.opens)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">עוד לא נאספו נתונים</div>'}
        ${note(ctx, 'שדרוג מיוחס למסך ה-Premium האחרון שנפתח עד 7 ימים לפני הרכישה.')}
      </div>
    </div>
    ${note(ctx, 'ביטולים מדווחים כשהמשתמש פותח את האפליקציה אחרי הביטול, ולכן שיעור הנטישה מעט מאחר. נתוני התשלום האמיתיים נמצאים ב-Google Play Console.')}
    <div class="actions"><button class="btn btn-ghost btn-sm" type="button" data-go="premium">עריכת מחירים ומנויים ←</button></div>`;
  bindRange(el, ctx, () => renderRevenue(el, ctx));
}

/* =========================================================
   3. שיפור המוצר ונקודות נטישה
   ========================================================= */

const LOAD_TARGETS = { map: [2500, 4500], gps: [6000, 12000], arrivals: [1200, 2500] };

function loadCard(ctx, key, label, hint, perf) {
  const n = perf[`${key}_n`] ?? 0;
  const ms = n ? Math.round((perf[`${key}_ms`] ?? 0) / n) : null;
  const [good, ok] = LOAD_TARGETS[key];
  const tone = ms == null ? '' : ms <= good ? 'tone-good' : ms <= ok ? 'tone-ok' : 'tone-bad';
  return `<div class="card kpi ${tone}"><div class="label">${label}</div><div class="value">${ms == null ? '—' : `${(ms / 1000).toFixed(1)} ש'`}</div><div class="sub">${hint} · ${ctx.fmtNum(n)} מדידות</div></div>`;
}

export async function renderProduct(el, ctx) {
  const days = ctx.state.range;
  const [an, failed] = await Promise.all([loadAnalytics(ctx), ctx.b.listFailedSearches(60)]);
  const f = an.total.funnel ?? {};
  const first = f.first_open ?? 0;
  const feat = an.total.feat ?? {};
  const perf = an.total.perf ?? {};
  const usage = FEATURES.map(([k, label]) => ({ k, label, n: feat[k] ?? 0 })).sort((a, b) => b.n - a.n);
  const maxUse = Math.max(1, usage[0]?.n ?? 1);
  const least = new Set(usage.slice(-3).map((u) => u.k));
  const dropped = Math.max(0, first - (f.map_reached ?? 0));

  el.innerHTML = `
    ${rangeBar(ctx, days)}
    <div class="grid kpis">
      ${loadCard(ctx, 'map', 'זמן טעינת מפה', 'עד שהמפה מוצגת', perf)}
      ${loadCard(ctx, 'gps', 'זמן עד GPS ראשון', 'מפתיחה, כולל אישור הרשאה', perf)}
      ${loadCard(ctx, 'arrivals', 'זמן טעינת זמני הגעה', 'בקשת זמן אמת', perf)}
      <div class="card kpi"><div class="label">נטשו לפני המפה</div><div class="value">${pctText(dropped, first)}</div><div class="sub">${ctx.fmtNum(dropped)} מתוך ${ctx.fmtNum(first)} פתיחות ראשונות</div></div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <h2>נטישה בהרשמה <small>· התקנה חדשה עד המפה</small></h2>
        ${funnelRow(ctx, 'פתחו את האפליקציה בפעם הראשונה', first, first)}
        ${funnelRow(ctx, 'ראו את מסך הכניסה', f.welcome_shown ?? 0, first)}
        ${funnelRow(ctx, 'לחצו על התחברות עם Google', f.signin_tap ?? 0, first)}
        ${funnelRow(ctx, 'התחברו בהצלחה', f.signed_in ?? 0, first)}
        ${funnelRow(ctx, 'הגיעו למפה', f.map_reached ?? 0, first)}
        ${note(ctx, 'מי שסגר את האפליקציה במסך הכניסה לא נספר בשלב "הגיעו למפה". הנתונים נאספים רק מהגרסה החדשה של האפליקציה ואילך.')}
      </div>
      <div class="card">
        <h2>מסכים ופיצ'רים <small>· מהנפוץ לפחות בשימוש</small></h2>
        <div class="bars">${usage.map((u) => `
          <div class="row"><span>${ctx.esc(u.label)}${least.has(u.k) ? ' <span class="tag-low">נמוך</span>' : ''}</span><div class="track"><div class="fill${least.has(u.k) ? ' is-low' : ''}" style="width:${(u.n / maxUse) * 100}%"></div></div><span class="num">${ctx.fmtNum(u.n)}</span></div>`).join('')}</div>
        ${usage.some((u) => u.n === 0) ? note(ctx, `אף אחד לא פתח: ${usage.filter((u) => u.n === 0).map((u) => u.label).join(', ')}`) : ''}
      </div>
    </div>

    <div class="card">
      <h2>חיפושים ללא תוצאות <small>· זיהוי נתונים חסרים ובאגים</small></h2>
      ${failed.length ? `<div class="table-wrap static"><table>
        <thead><tr><th>החיפוש</th><th>סוג</th><th>פעמים</th><th>לאחרונה</th></tr></thead>
        <tbody>${failed.map((r) => `<tr><td>${ctx.esc(r.q)}</td><td>${{ line: 'קו', station: 'תחנה', place: 'מקום / כתובת' }[r.kind] ?? ctx.esc(r.kind)}</td><td class="num">${ctx.fmtNum(r.count)}</td><td>${ctx.fmtAgo(r.last)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">אין חיפושים שנכשלו – או שעוד לא נאספו נתונים</div>'}
    </div>`;
  bindRange(el, ctx, () => renderProduct(el, ctx));
}

/* =========================================================
   4. דמוגרפיה ופילוח גיאוגרפי
   ========================================================= */

export async function renderGeo(el, ctx) {
  const days = ctx.state.range;
  const an = await loadAnalytics(ctx);
  const t = an.total;
  const names = t.names ?? {};
  const city = ranked(t.city);
  const cityTotal = sum(t.city);
  const lines = ranked(t.lines).slice(0, 10);
  const stations = ranked(t.stations).slice(0, 10);
  const dev = ranked(t.dev);
  const models = ranked(t.model).slice(0, 10);
  const os = ranked(t.os);
  const prettyModel = (k) => k.replace(/_/g, ' ').toUpperCase();
  const prettyOs = (k) => k.replace(/^(\w+?)_/, '$1 ').replace(/^android/, 'Android').replace(/^ios/, 'iOS').replace(/^web/, 'Web');

  el.innerHTML = `
    ${rangeBar(ctx, days)}
    <div class="grid cols-2">
      <div class="card">
        <h2>פילוח לפי ערים <small>· ${ctx.fmtNum(cityTotal)} פתיחות</small></h2>
        ${ctx.distBars(city.map(([k, v]) => [CITY_LABELS[k] ?? k, v]), cityTotal)}
        ${note(ctx, 'העיר נקבעת במכשיר לפי הקרובה מבין עיקריות הערים (עד 20 ק"מ), ורק שמה נשלח. המיקום עצמו לא נשמר.')}
      </div>
      <div class="card">
        <h2>סוגי מכשירים</h2>
        ${ctx.distBars(dev.map(([k, v]) => [PLATFORM_LABELS[k] ?? k, v]), sum(t.dev))}
        <h3 class="sub-h">דגמים נפוצים</h3>
        ${ctx.distBars(models.map(([k, v]) => [prettyModel(k), v]), sum(t.model))}
        <h3 class="sub-h">גרסאות מערכת</h3>
        ${ctx.distBars(os.map(([k, v]) => [prettyOs(k), v]), sum(t.os))}
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <h2>הקווים הפעילים ביותר <small>· צפיות בפרטי קו</small></h2>
        ${ctx.distBars(lines.map(([k, v]) => [names[k] ?? k.replace(/_/g, ' '), v]), Math.max(1, lines[0]?.[1] ?? 1))}
      </div>
      <div class="card">
        <h2>התחנות הפעילות ביותר <small>· צפיות בפרטי תחנה</small></h2>
        ${ctx.distBars(stations.map(([k, v]) => [names[k] ? `${names[k]} (${k})` : k, v]), Math.max(1, stations[0]?.[1] ?? 1))}
      </div>
    </div>`;
  bindRange(el, ctx, () => renderGeo(el, ctx));
}

/* =========================================================
   5. ניהול משתמשים ובקרה
   ========================================================= */

const CONTROL_TABS = [['bans', '🚫 חסימות'], ['broadcast', '📣 הודעות'], ['surveys', '📝 סקרים'], ['reports', '⚠️ דיווחים']];
const REPORT_LABEL = Object.fromEntries(REPORT_TYPES.map((x) => [x.id, `${x.icon} ${x.label}`]));
const AUDIENCE = { all: 'כולם', free: 'משתמשי חינם', premium: 'מנויי Premium' };

export async function renderControl(el, ctx) {
  const tab = ctx.state.controlTab ?? 'bans';
  const body = { bans: controlBans, broadcast: controlBroadcast, surveys: controlSurveys, reports: controlReports }[tab];
  el.innerHTML = `
    <div class="chips" style="margin-bottom:14px">${CONTROL_TABS.map(([id, label]) => `<button type="button" data-ctab="${id}" class="${id === tab ? 'is-active' : ''}">${label}</button>`).join('')}</div>
    <div id="control-body"></div>`;
  el.querySelector('.chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ctab]');
    if (!b) return;
    ctx.state.controlTab = b.dataset.ctab;
    renderControl(el, ctx);
  });
  await body(el.querySelector('#control-body'), ctx);
}

/* ---------- חסימות ---------- */

async function controlBans(el, ctx) {
  const bans = await ctx.b.listBans();
  el.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h2>חסימה ידנית</h2>
        <div class="form-grid">
          <label class="field"><span>סוג</span><select id="ban-type" class="input"><option value="uid">משתמש (מזהה תמיכה / UID)</option></select></label>
          <label class="field"><span>מזהה או כתובת</span><input id="ban-value" class="input" dir="ltr" placeholder="מזהה תמיכה (8 תווים) או UID מלא"></label>
          <label class="field" style="grid-column:1/-1"><span>סיבה (לא חובה, מוצגת למשתמש)</span><input id="ban-reason" class="input" maxlength="120"></label>
        </div>
        <div class="actions" style="margin-top:14px"><button id="ban-add" class="btn btn-danger" type="button">חסימה לצמיתות</button></div>
        <p class="note warn">החסימה נאכפת בכללי Firestore (אי אפשר לדווח או לשתף) ובאפליקציה (מסך חסימה). היא קשורה לחשבון האנונימי של המכשיר, ולכן מי שמתקין מחדש מקבל חשבון חדש. חסימה לפי IP דורשת שרת ולכן אינה זמינה כרגע.</p>
      </div>
      <div class="card">
        <h2>רשימת החסומים <small>· ${bans.length}</small></h2>
        ${bans.length ? `<div class="table-wrap static"><table>
          <thead><tr><th>סוג</th><th>ערך</th><th>סיבה</th><th>מתי</th><th></th></tr></thead>
          <tbody>${bans.map((x) => `<tr><td>${x.type === 'ip' ? 'IP' : 'משתמש'}</td><td><bdi class="mono">${ctx.esc(x.type === 'ip' ? x.value : String(x.value ?? x.id).slice(0, 8))}</bdi></td><td>${ctx.esc(x.reason ?? '—')}</td><td>${ctx.fmtAgo(x.at)}</td><td><button class="btn btn-ghost btn-sm" type="button" data-unban="${ctx.esc(x.id)}">ביטול חסימה</button></td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">אין חסומים</div>'}
      </div>
    </div>`;

  el.onclick = async (e) => {
    try {
      if (e.target.closest('#ban-add')) {
        const type = el.querySelector('#ban-type').value;
        const raw = el.querySelector('#ban-value').value.trim();
        const reason = el.querySelector('#ban-reason').value.trim();
        if (!raw) return ctx.toast('חסר מזהה או כתובת', true);
        let value = raw;
        if (type === 'uid') {
          value = await ctx.b.resolveUid(raw);
          if (!value) return ctx.toast('לא נמצא משתמש אחד שמתאים למזהה (נסו יותר תווים)', true);
        } else if (!/^[0-9a-fA-F:.]{3,45}$/.test(raw)) {
          return ctx.toast('כתובת IP לא תקינה', true);
        }
        if (!confirm(type === 'ip' ? `לחסום את הכתובת ${value}?` : `לחסום לצמיתות את המשתמש ${value.slice(0, 8)}?`)) return;
        await ctx.b.addBan({ type, value, reason });
        await ctx.b.log('ban', type === 'ip' ? value : value.slice(0, 8), { type, reason });
        ctx.toast('החסימה נשמרה');
        controlBans(el, ctx);
      }
      const un = e.target.closest('[data-unban]');
      if (un && confirm('לבטל את החסימה?')) {
        await ctx.b.removeBan(un.dataset.unban);
        await ctx.b.log('unban', un.dataset.unban.slice(0, 12));
        ctx.toast('החסימה בוטלה');
        controlBans(el, ctx);
      }
    } catch (err) {
      ctx.toast(`הפעולה נכשלה: ${err.message}`, true);
    }
  };
}

/* ---------- הודעות ---------- */

async function controlBroadcast(el, ctx) {
  const list = await ctx.b.listBroadcasts();
  el.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h2>שליחת הודעה למשתמשים</h2>
        <div class="grid" style="gap:12px">
          <div class="form-grid">
            <label class="field"><span>למי</span><select id="bc-audience" class="input"><option value="all">כולם</option><option value="free">משתמשי חינם</option><option value="premium">מנויי Premium</option></select></label>
            <label class="field"><span>סוג</span><select id="bc-level" class="input"><option value="info">מידע</option><option value="warning">אזהרה</option></select></label>
            <label class="field"><span>תוקף</span><select id="bc-ttl" class="input"><option value="6">6 שעות</option><option value="24" selected>יום</option><option value="72">3 ימים</option><option value="168">שבוע</option></select></label>
          </div>
          <fieldset class="line-target">
            <legend>רק למשתמשי קו מסוים (לא חובה)</legend>
            <div class="form-grid">
              <label class="field"><span>סוג</span><select id="bc-mode" class="input"><option value="bus">אוטובוס</option><option value="rail">רכבת</option><option value="lightrail">רכבת קלה</option></select></label>
              <label class="field"><span>מספר קו</span><input id="bc-line" class="input" dir="ltr" placeholder="480"></label>
              <label class="field"><span>חברה כפי שמופיעה באפליקציה</span><input id="bc-agency" class="input" placeholder="אגד"></label>
            </div>
            <small class="muted">מי שמעדיף את הקו, צופה בו או נוסע בו יקבל את ההודעה.</small>
          </fieldset>
          <label class="field"><span>כותרת</span><input id="bc-title" class="input" maxlength="60" placeholder="למשל: שיבוש בקו 480"></label>
          <label class="field"><span>טקסט</span><textarea id="bc-text" class="input" maxlength="240" placeholder="עד 240 תווים"></textarea></label>
        </div>
        <div class="actions" style="margin-top:14px"><button id="bc-send" class="btn btn-primary" type="button">שליחה</button></div>
        <p class="note warn">ההודעה מוצגת כחלון באפליקציה כשהמשתמש פותח אותה או חוזר אליה, פעם אחת לכל משתמש. זו לא התראת Push של מערכת ההפעלה (שמגיעה גם כשהאפליקציה סגורה): היא דורשת הוספת Firebase Cloud Messaging ובניית גרסה חדשה של האפליקציה.</p>
      </div>
      <div class="card">
        <h2>הודעות אחרונות</h2>
        ${list.length ? `<div class="table-wrap static"><table>
          <thead><tr><th>הודעה</th><th>יעד</th><th>עד</th><th></th></tr></thead>
          <tbody>${list.map((b) => `<tr><td style="white-space:normal;min-width:180px"><strong>${ctx.esc(b.title ?? '')}</strong> ${ctx.esc(b.text)}</td><td>${ctx.esc(b.lineLabel ?? AUDIENCE[b.audience] ?? 'כולם')}</td><td>${b.expiresAt ? ctx.fmtDateTime(b.expiresAt) : '—'}</td><td>${b.active ? `<button class="btn btn-ghost btn-sm" type="button" data-bc-off="${ctx.esc(b.id)}">כיבוי</button>` : '<span class="muted">כבויה</span>'}</td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">עדיין לא נשלחו הודעות</div>'}
      </div>
    </div>`;

  el.onclick = async (e) => {
    try {
      if (e.target.closest('#bc-send')) {
        const text = el.querySelector('#bc-text').value.trim();
        if (!text) return ctx.toast('חסר טקסט להודעה', true);
        const line = el.querySelector('#bc-line').value.trim();
        const mode = el.querySelector('#bc-mode').value;
        const agency = el.querySelector('#bc-agency').value.trim();
        const data = {
          title: el.querySelector('#bc-title').value.trim(),
          text,
          audience: el.querySelector('#bc-audience').value,
          level: el.querySelector('#bc-level').value,
          expiresAt: Date.now() + Number(el.querySelector('#bc-ttl').value) * 3600000
        };
        if (line) {
          data.lineKey = lineKeyOf({ mode, line, agency });
          data.lineLabel = `${mode === 'bus' ? 'קו' : mode === 'rail' ? 'רכבת' : 'רק"ל'} ${line}${agency ? ` · ${agency}` : ''}`;
        }
        if (!confirm(`לשלוח את ההודעה${data.lineLabel ? ` לנוסעי ${data.lineLabel}` : ` ל${AUDIENCE[data.audience]}`}?`)) return;
        await ctx.b.saveBroadcast(data);
        await ctx.b.log('broadcast', data.lineKey ?? data.audience, { title: data.title });
        ctx.toast('ההודעה נשלחה 📣');
        controlBroadcast(el, ctx);
      }
      const off = e.target.closest('[data-bc-off]');
      if (off) {
        await ctx.b.setBroadcastActive(off.dataset.bcOff, false);
        await ctx.b.log('broadcast-off', off.dataset.bcOff);
        controlBroadcast(el, ctx);
      }
    } catch (err) {
      ctx.toast(`הפעולה נכשלה: ${err.message}`, true);
    }
  };
}

/* ---------- סקרים ---------- */

async function controlSurveys(el, ctx) {
  const surveys = await ctx.b.listSurveys();
  const results = await Promise.all(surveys.map((s) => ctx.b.surveyResults(s).catch(() => s.options.map(() => 0))));
  el.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h2>סקר חדש</h2>
        <div class="grid" style="gap:12px">
          <label class="field"><span>השאלה</span><input id="sv-q" class="input" maxlength="120" placeholder="למשל: מה הכי חסר ב-Walkie?"></label>
          <label class="field"><span>תשובות (כל תשובה בשורה, 2 עד 5)</span><textarea id="sv-opts" class="input" placeholder="התראות בזמן אמת&#10;מפה אופליין&#10;ווידג'ט"></textarea></label>
          <div class="form-grid">
            <label class="field"><span>למי</span><select id="sv-audience" class="input"><option value="all">כולם</option><option value="free">משתמשי חינם</option><option value="premium">מנויי Premium</option></select></label>
            <label class="field"><span>עד</span><input id="sv-until" class="input" type="date"></label>
          </div>
        </div>
        <div class="actions" style="margin-top:14px"><button id="sv-save" class="btn btn-primary" type="button">פרסום הסקר</button></div>
        <p class="note">הסקר קופץ למשתמש בין לשוניות, אחרי כמה שימוש, לכל היותר פעם ביום. כל משתמש עונה פעם אחת.</p>
      </div>
      <div class="card">
        <h2>הסקרים שלי</h2>
        ${surveys.length ? surveys.map((s, si) => {
          const votes = results[si];
          const totalVotes = votes.reduce((a, b) => a + b, 0);
          return `
            <div class="survey-item">
              <div class="survey-head"><strong>${ctx.esc(s.question)}</strong>
                <button class="btn btn-ghost btn-sm" type="button" data-sv-toggle="${ctx.esc(s.id)}" data-on="${s.active ? 1 : 0}">${s.active ? 'עצירה' : 'הפעלה מחדש'}</button></div>
              <div class="muted" style="font-size:12.5px">${AUDIENCE[s.audience] ?? 'כולם'} · ${ctx.fmtNum(totalVotes)} תשובות · ${ctx.fmtAgo(s.createdAt)}${s.active ? '' : ' · הופסק'}</div>
              ${ctx.distBars(s.options.map((o, i) => [`${o} (${pctText(votes[i], totalVotes)})`, votes[i]]), Math.max(1, totalVotes))}
            </div>`;
        }).join('') : '<div class="empty">עדיין אין סקרים</div>'}
      </div>
    </div>`;

  el.onclick = async (e) => {
    try {
      if (e.target.closest('#sv-save')) {
        const question = el.querySelector('#sv-q').value.trim();
        const options = el.querySelector('#sv-opts').value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 5);
        if (!question) return ctx.toast('חסרה שאלה', true);
        if (options.length < 2) return ctx.toast('צריך לפחות שתי תשובות', true);
        const until = el.querySelector('#sv-until').value;
        await ctx.b.saveSurvey({
          question, options, audience: el.querySelector('#sv-audience').value,
          expiresAt: until ? new Date(`${until}T23:59:59`).getTime() : null
        });
        await ctx.b.log('survey', question.slice(0, 20));
        ctx.toast('הסקר פורסם 📝');
        controlSurveys(el, ctx);
      }
      const tg = e.target.closest('[data-sv-toggle]');
      if (tg) {
        await ctx.b.setSurveyActive(tg.dataset.svToggle, tg.dataset.on !== '1');
        controlSurveys(el, ctx);
      }
    } catch (err) {
      ctx.toast(`הפעולה נכשלה: ${err.message}`, true);
    }
  };
}

/* ---------- דיווחים ---------- */

async function controlReports(el, ctx) {
  const filter = ctx.state.reportFilter ?? 'new';
  const all = await ctx.b.listReports(150);
  const list = all.filter((r) => filter === 'all' || r.status !== 'done');
  const byType = {};
  for (const r of all) byType[r.type] = (byType[r.type] ?? 0) + 1;
  el.innerHTML = `
    <div class="card">
      <h2>דיווחים על אוטובוסים <small>· ${ctx.fmtNum(all.length)} אחרונים</small></h2>
      <div class="toolbar">
        <div class="chips">
          <button type="button" data-rfilter="new" class="${filter === 'new' ? 'is-active' : ''}">חדשים <b>${all.filter((r) => r.status !== 'done').length}</b></button>
          <button type="button" data-rfilter="all" class="${filter === 'all' ? 'is-active' : ''}">הכל <b>${all.length}</b></button>
        </div>
        <span class="muted">${ranked(byType).map(([k, v]) => `${REPORT_LABEL[k] ?? k}: ${v}`).join(' · ')}</span>
      </div>
      ${list.length ? `<div class="table-wrap static"><table>
        <thead><tr><th>מתי</th><th>קו</th><th>סוג</th><th>הערה</th><th>מדווח</th><th></th></tr></thead>
        <tbody>${list.map((r) => `<tr>
          <td>${ctx.fmtAgo(r.ts)}</td><td>${ctx.esc(r.lineLabel || r.line)}</td><td>${ctx.esc(REPORT_LABEL[r.type] ?? r.type)}</td>
          <td style="white-space:normal;min-width:160px">${ctx.esc(r.note ?? '')}</td>
          <td><bdi class="mono">${ctx.esc(String(r.uid).slice(0, 8))}</bdi></td>
          <td class="actions-cell">
            ${r.status === 'done' ? '<span class="badge on">טופל</span>' : `<button class="btn btn-ghost btn-sm" type="button" data-rdone="${ctx.esc(r.id)}">סימון כטופל</button>`}
            <button class="btn btn-danger btn-sm" type="button" data-rban="${ctx.esc(r.uid)}" title="חסימת המדווח, למשל על דיווח שקרי">חסימת מדווח</button>
          </td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">אין דיווחים</div>'}
    </div>`;

  el.onclick = async (e) => {
    try {
      const f = e.target.closest('[data-rfilter]');
      if (f) {
        ctx.state.reportFilter = f.dataset.rfilter;
        return controlReports(el, ctx);
      }
      const done = e.target.closest('[data-rdone]');
      if (done) {
        await ctx.b.updateReport(done.dataset.rdone, { status: 'done' });
        return controlReports(el, ctx);
      }
      const ban = e.target.closest('[data-rban]');
      if (ban && confirm(`לחסום לצמיתות את המדווח ${ban.dataset.rban.slice(0, 8)}? (דיווח שקרי)`)) {
        await ctx.b.addBan({ type: 'uid', value: ban.dataset.rban, reason: 'דיווחים שקריים' });
        await ctx.b.log('ban', ban.dataset.rban.slice(0, 8), { reason: 'false report' });
        ctx.toast('המדווח נחסם');
      }
    } catch (err) {
      ctx.toast(`הפעולה נכשלה: ${err.message}`, true);
    }
  };
}
