// Walkie Admin – סקירה, משתמשים, Premium ומחירים, מגבלות, הודעות, מנהלים ויומן.

import { createBackend, createDemoBackend, OWNER_EMAIL } from './backend.js';
import { renderAcquisition, renderRevenue, renderProduct, renderGeo, renderControl } from './analytics-views.js';
import {
  PRICING, FREE_LIMITS, PREMIUM_FEATURES, mergePricing, priceAt, discountPercent, formatPrice, formatLaunchEnd
} from '../js/modules/pricing.js';

const DAY = 86400000;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  backend: createBackend(),
  me: null,
  view: 'overview',
  users: [],
  next: null,
  counts: null,
  pricing: PRICING,
  filter: 'all',
  query: '',
  sort: { key: 'lastSeenAt', dir: -1 },
  page: 0,
  loadedAt: 0,
  range: 30,             // תקופת האנליטיקה בימים
  analyticsCache: {},
  controlTab: 'bans',
  reportFilter: 'new'
};

const PAGE = 50;

/* ---------- עזרים ---------- */

function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = 'toast'), 2600);
}

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('he-IL') : '—');
const fmtDateTime = (ms) => (ms ? new Date(ms).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const fmtNum = (n) => Number(n ?? 0).toLocaleString('he-IL');
const fmtMoney = (n) => `${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;

function fmtAgo(ms) {
  if (!ms) return '—';
  const d = Date.now() - ms;
  if (d < 60000) return 'עכשיו';
  if (d < 3600000) return `לפני ${Math.round(d / 60000)} דק'`;
  if (d < DAY) return `לפני ${Math.round(d / 3600000)} שע'`;
  if (d < 30 * DAY) return `לפני ${Math.round(d / DAY)} ימים`;
  return fmtDate(ms);
}

/** מצב ה-Premium של משתמש מנקודת המבט של המנהל */
function premiumOf(u) {
  const giftActive = u.plan === 'pro' && (u.premiumUntil === 'forever' || !u.premiumUntil || Date.parse(u.premiumUntil) > Date.now());
  if (giftActive) {
    return { kind: 'gift', label: u.premiumGrantedBy === 'referral' ? 'הזמנות' : 'מתנה', until: u.premiumUntil === 'forever' || !u.premiumUntil ? 'ללא הגבלה' : fmtDate(Date.parse(u.premiumUntil)) };
  }
  if (u.premium?.active && u.premium.source === 'play') return { kind: 'play', label: 'משלם', until: null };
  return { kind: 'free', label: 'חינם', until: null };
}

const badge = (p) => `<span class="badge ${p.kind}">${p.kind === 'play' ? '💳' : p.kind === 'gift' ? '🎁' : ''} ${p.label}</span>`;
const supportIdOf = (u) => u.id.slice(0, 8);

// datetime-local <-> ISO בשעון ישראל
function israelOffset(date) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+2';
  const m = part.match(/GMT([+-])(\d+)/);
  const h = m ? Number(m[2]) : 2;
  return `${m?.[1] ?? '+'}${String(h).padStart(2, '0')}:00`;
}

function localToIso(value) {
  if (!value) return null;
  const guess = new Date(`${value}:00Z`);
  return `${value}:00${israelOffset(guess)}`;
}

function isoToLocal(iso) {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/* ---------- טעינה ---------- */

async function loadAll() {
  $('#view').innerHTML = '<div class="loading">טוען נתונים…</div>';
  const b = state.backend;
  const [counts, page, pricing] = await Promise.all([
    b.counts(),
    b.listUsers({ pageSize: 300 }),
    b.getConfig('pricing')
  ]);
  state.counts = counts;
  state.users = page.users;
  state.next = page.next;
  state.pricing = mergePricing(pricing);
  state.analyticsCache = {};
  state.loadedAt = Date.now();
  $('#updated').textContent = `עודכן ${new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
}

async function loadMoreUsers() {
  if (!state.next) return;
  const page = await state.backend.listUsers({ pageSize: 300, after: state.next });
  state.users.push(...page.users);
  state.next = page.next;
}

/* ---------- ניווט בין מסכים ---------- */

/** מה שמסכי האנליטיקה (analytics-views.js) צריכים מהדף */
function viewCtx() {
  return {
    b: state.backend, state, esc, fmtNum, fmtMoney, fmtDateTime, fmtAgo, toast, barChart, distBars, priceAt, go: (v) => go(v)
  };
}

const VIEWS = {
  overview: { title: 'סקירה כללית', render: renderOverview },
  acquisition: { title: 'רכישת משתמשים ומקורות הגעה', render: (el) => renderAcquisition(el, viewCtx()) },
  revenue: { title: 'מנויים, מונטיזציה והכנסות', render: (el) => renderRevenue(el, viewCtx()) },
  product: { title: 'שיפור המוצר ונקודות נטישה', render: (el) => renderProduct(el, viewCtx()) },
  geo: { title: 'דמוגרפיה, אזורים ומכשירים', render: (el) => renderGeo(el, viewCtx()) },
  control: { title: 'בקרת משתמשים והודעות', render: (el) => renderControl(el, viewCtx()) },
  users: { title: 'משתמשים', render: renderUsers },
  premium: { title: 'Premium ומחירים', render: renderPremium },
  limits: { title: "מגבלות ופיצ'רים", render: renderLimits },
  announce: { title: 'הודעה למשתמשים', render: renderAnnounce },
  admins: { title: 'מנהלים ויומן', render: renderAdmins }
};

async function go(view) {
  clearInterval(state.onlineTimer);
  state.view = view;
  for (const b of $$('.side-nav button')) b.classList.toggle('is-active', b.dataset.view === view);
  $('#view-title').textContent = VIEWS[view].title;
  try {
    await VIEWS[view].render($('#view'));
  } catch (err) {
    console.error(err);
    $('#view').innerHTML = `<div class="card empty">שגיאה בטעינה: ${esc(err.message)}</div>`;
  }
}

/* =========================================================
   סקירה כללית
   ========================================================= */

function barChart(days, values) {
  const w = 720, h = 180, pad = 22;
  const max = Math.max(1, ...values);
  const bw = (w - pad) / values.length;
  const bars = values.map((v, i) => {
    const bh = (v / max) * (h - pad - 10);
    return `<rect class="bar" x="${pad + i * bw + 1.5}" y="${h - pad - bh}" width="${Math.max(2, bw - 3)}" height="${bh}" rx="3"><title>${days[i]}: ${v}</title></rect>`;
  }).join('');
  const labels = days.map((d, i) => (i % 5 === 0 || i === days.length - 1)
    ? `<text class="axis" x="${pad + i * bw + bw / 2}" y="${h - 6}" text-anchor="middle">${d}</text>` : '').join('');
  const grid = [0.5, 1].map((f) => `<line class="grid-line" x1="${pad}" x2="${w}" y1="${h - pad - f * (h - pad - 10)}" y2="${h - pad - f * (h - pad - 10)}"/><text class="axis" x="0" y="${h - pad - f * (h - pad - 10) + 4}">${Math.round(max * f)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="הרשמות לפי יום">${grid}${bars}${labels}</svg>`;
}

function distBars(entries, total) {
  if (!entries.length) return '<div class="empty">אין נתונים</div>';
  return `<div class="bars">${entries.map(([k, v]) => `
    <div class="row"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(v / Math.max(1, total)) * 100}%"></div></div><span class="num">${fmtNum(v)}</span></div>`).join('')}</div>`;
}

function countBy(list, fn) {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

async function renderOverview(el) {
  const c = state.counts;
  const p = priceAt(Date.now(), state.pricing);
  const signups = await state.backend.signupsSince(30);

  const days = [];
  const values = [];
  for (let i = 29; i >= 0; i--) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const from = start.getTime() - i * DAY;
    days.push(new Date(from).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }));
    values.push(signups.filter((u) => u.createdAt >= from && u.createdAt < from + DAY).length);
  }

  const premiumTotal = c.paying + c.gifts;
  const conversion = c.total ? ((c.paying / c.total) * 100).toFixed(1) : '0.0';
  const mrrNow = c.paying * p.price;
  const mrrRegular = c.paying * state.pricing.regular;
  const sample = state.users;
  const sum = (k) => sample.reduce((a, u) => a + (u.stats?.[k] ?? 0), 0);
  const donors = sample.filter((u) => u.donations?.count > 0);
  const donated = donors.reduce((a, u) => a + (u.donations?.total ?? 0), 0);
  const linked = sample.filter((u) => u.profile?.email).length;

  el.innerHTML = `
    <div class="card online-card">
      <span class="online-dot"></span>
      <div><div class="label">מחוברים עכשיו באפליקציה</div><div class="sub">פעילים ב-5 הדקות האחרונות · מתעדכן כל 30 שניות</div></div>
      <div class="online-num" id="online-now">…</div>
      <div class="online-sub muted" id="online-15"></div>
    </div>
    <div class="grid kpis">
      <div class="card kpi is-brand"><div class="label">משתמשים</div><div class="value">${fmtNum(c.total)}</div><div class="sub">+${fmtNum(c.new7)} ב-7 הימים האחרונים</div></div>
      <div class="card kpi"><div class="label">פעילים היום</div><div class="value">${fmtNum(c.active1)}</div><div class="sub">${fmtNum(c.active7)} בשבוע · ${fmtNum(c.active30)} בחודש</div></div>
      <div class="card kpi"><div class="label">מנויי Premium</div><div class="value">${fmtNum(premiumTotal)}</div><div class="sub">💳 ${fmtNum(c.paying)} משלמים · 🎁 ${fmtNum(c.gifts)} מתנות</div></div>
      <div class="card kpi"><div class="label">המרה לתשלום</div><div class="value">${conversion}%</div><div class="sub">מתוך כל המשתמשים</div></div>
      <div class="card kpi is-accent"><div class="label">הכנסה חודשית (MRR)</div><div class="value">${fmtMoney(mrrNow)}</div><div class="sub">לפי ${formatPrice(p.price, state.pricing)} למנוי, לפני עמלת Google</div></div>
      <div class="card kpi"><div class="label">תרומות 💚</div><div class="value">${fmtMoney(donated)}</div><div class="sub">${fmtNum(donors.length)} תורמים · ${fmtNum(sample.length)} האחרונים</div></div>
      <div class="card kpi"><div class="label">מחוברים עם Google</div><div class="value">${fmtNum(linked)}</div><div class="sub">${sample.length ? Math.round((linked / sample.length) * 100) : 0}% מהמשתמשים</div></div>
      <div class="card kpi"><div class="label">MRR במחיר מלא</div><div class="value">${fmtMoney(mrrRegular)}</div><div class="sub">אותם מנויים ב-${formatPrice(state.pricing.regular, state.pricing)}</div></div>
    </div>

    ${p.isLaunch ? `
      <div class="promo" style="margin-top:14px">
        <span class="big">${p.daysLeft}</span>
        <div><strong>ימים נשארו למבצע ההשקה</strong><div class="muted">${formatPrice(p.launch, state.pricing)} במקום ${formatPrice(p.regular, state.pricing)} (${p.discount}% הנחה) · עד ${formatLaunchEnd(state.pricing)}</div></div>
        <button class="btn btn-ghost btn-sm" type="button" data-go="premium" style="margin-inline-start:auto">עריכת מחירים</button>
      </div>` : ''}

    <div class="card">
      <h2>הרשמות ב-30 הימים האחרונים <small>· סה"כ ${fmtNum(signups.length)}</small></h2>
      ${barChart(days, values)}
    </div>

    <div class="grid cols-2">
      <div class="card"><h2>פלטפורמה <small>· ${fmtNum(sample.length)} האחרונים</small></h2>
        ${distBars(countBy(sample, (u) => ({ android: 'אנדרואיד', ios: 'אייפון', web: 'דפדפן' }[u.device?.platform] ?? 'לא ידוע')), sample.length)}</div>
      <div class="card"><h2>גרסת אפליקציה <small>· ${fmtNum(sample.length)} האחרונים</small></h2>
        ${distBars(countBy(sample, (u) => u.device?.appVersion ?? 'לא ידוע'), sample.length)}</div>
    </div>

    <div class="grid kpis">
      <div class="card kpi"><div class="label">הליכות שהושלמו</div><div class="value">${fmtNum(sum('walks'))}</div><div class="sub">${fmtNum(Math.round(sum('walkMeters') / 1000))} ק"מ ברגל</div></div>
      <div class="card kpi"><div class="label">נסיעות שהושלמו</div><div class="value">${fmtNum(sum('trips'))}</div><div class="sub">עם ליווי נסיעה</div></div>
      <div class="card kpi"><div class="label">CO₂ שנחסך</div><div class="value">${fmtNum(Math.round((sum('walkMeters') / 1000) * 0.17))}</div><div class="sub">ק"ג, לעומת רכב פרטי</div></div>
      <div class="card kpi"><div class="label">פתיחות לאפליקציה</div><div class="value">${fmtNum(sample.reduce((a, u) => a + (u.sessions ?? 0), 0))}</div><div class="sub">ממוצע ${(sample.reduce((a, u) => a + (u.sessions ?? 0), 0) / Math.max(1, sample.length)).toFixed(1)} למשתמש</div></div>
    </div>`;

  // "מחוברים עכשיו": ספירה חיה, מתרעננת כל 30 שניות כל עוד המסך פתוח
  const refreshOnline = async () => {
    if (state.view !== 'overview' || !document.getElementById('online-now')) return clearInterval(state.onlineTimer);
    try {
      const [now5, now15] = await Promise.all([state.backend.countOnline(5), state.backend.countOnline(15)]);
      $('#online-now').textContent = fmtNum(now5);
      $('#online-15').textContent = `${fmtNum(now15)} ב-15 הדקות האחרונות`;
    } catch (err) {
      $('#online-now').textContent = '—';
    }
  };
  refreshOnline();
  state.onlineTimer = setInterval(refreshOnline, 30000);
}

/* =========================================================
   משתמשים
   ========================================================= */

const FILTERS = {
  all: { label: 'כולם', fn: () => true },
  premium: { label: 'Premium', fn: (u) => premiumOf(u).kind !== 'free' },
  play: { label: 'משלמים', fn: (u) => premiumOf(u).kind === 'play' },
  gift: { label: 'מתנות', fn: (u) => premiumOf(u).kind === 'gift' },
  free: { label: 'חינם', fn: (u) => premiumOf(u).kind === 'free' },
  active: { label: 'פעילים (7 ימים)', fn: (u) => u.lastSeenAt >= Date.now() - 7 * DAY },
  dormant: { label: 'רדומים (30+ ימים)', fn: (u) => u.lastSeenAt < Date.now() - 30 * DAY },
  google: { label: 'מחוברים ל-Google', fn: (u) => !!u.profile?.email || u.authType === 'google' },
  donors: { label: 'תורמים', fn: (u) => u.donations?.count > 0 },
  notes: { label: 'עם הערות', fn: (u) => !!u.notes }
};

const COLUMNS = [
  { key: 'id', label: 'מזהה תמיכה', sort: (u) => u.id },
  { key: 'premium', label: 'מצב', sort: (u) => ['free', 'gift', 'play'].indexOf(premiumOf(u).kind) },
  { key: 'account', label: 'חשבון', sort: (u) => u.profile?.email ?? '' },
  { key: 'donations', label: 'תרומות', sort: (u) => u.donations?.total ?? 0 },
  { key: 'createdAt', label: 'הצטרף', sort: (u) => u.createdAt ?? 0 },
  { key: 'lastSeenAt', label: 'פעיל לאחרונה', sort: (u) => u.lastSeenAt ?? 0 },
  { key: 'sessions', label: 'פתיחות', sort: (u) => u.sessions ?? 0 },
  { key: 'walks', label: 'הליכות', sort: (u) => u.stats?.walks ?? 0 },
  { key: 'trips', label: 'נסיעות', sort: (u) => u.stats?.trips ?? 0 },
  { key: 'platform', label: 'פלטפורמה', sort: (u) => u.device?.platform ?? '' },
  { key: 'version', label: 'גרסה', sort: (u) => u.device?.appVersion ?? '' }
];

function visibleUsers() {
  const q = state.query.trim();
  const col = COLUMNS.find((c) => c.key === state.sort.key) ?? COLUMNS[3];
  return state.users
    .filter(FILTERS[state.filter].fn)
    .filter((u) => !q || u.id.startsWith(q) || u.id.toLowerCase().includes(q.toLowerCase()) || u.notes?.includes(q)
      || u.profile?.email?.toLowerCase().includes(q.toLowerCase()) || u.profile?.name?.includes(q))
    .sort((a, b) => {
      const x = col.sort(a), y = col.sort(b);
      return (x > y ? 1 : x < y ? -1 : 0) * state.sort.dir;
    });
}

function renderUsers(el) {
  const list = visibleUsers();
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  state.page = Math.min(state.page, pages - 1);
  const rows = list.slice(state.page * PAGE, (state.page + 1) * PAGE);
  const arrow = (k) => (state.sort.key === k ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : '');

  el.innerHTML = `
    <div class="toolbar">
      <input id="q" class="input" type="search" placeholder="חיפוש לפי מזהה תמיכה, אימייל, שם או הערה" value="${esc(state.query)}">
      <button id="btn-find" class="btn btn-ghost btn-sm" type="button" title="חיפוש בכל המשתמשים בשרת">חיפוש בשרת</button>
      <button id="btn-csv" class="btn btn-ghost btn-sm" type="button">⬇ ייצוא CSV</button>
      ${state.next ? '<button id="btn-more" class="btn btn-ghost btn-sm" type="button">טעינת 300 נוספים</button>' : ''}
    </div>
    <div class="chips" style="margin-bottom:12px">
      ${Object.entries(FILTERS).map(([k, f]) => `<button type="button" data-filter="${k}" class="${state.filter === k ? 'is-active' : ''}">${f.label} <b>${fmtNum(state.users.filter(f.fn).length)}</b></button>`).join('')}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>${COLUMNS.map((c) => `<th data-sort="${c.key}">${c.label}${arrow(c.key)}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map((u) => {
            const active = u.lastSeenAt >= Date.now() - DAY;
            return `<tr data-user="${esc(u.id)}">
              <td><span class="dot ${active ? 'on' : ''}"></span> <bdi class="mono">${esc(supportIdOf(u))}</bdi>${u.notes ? ' 📝' : ''}</td>
              <td>${badge(premiumOf(u))}</td>
              <td>${u.profile?.email ? esc(u.profile.email) : u.authType === 'google' ? '<span class="muted">Google</span>' : '<span class="muted">אנונימי</span>'}</td>
              <td class="num">${u.donations?.total ? fmtMoney(u.donations.total) : '—'}</td>
              <td>${fmtDate(u.createdAt)}</td>
              <td>${fmtAgo(u.lastSeenAt)}</td>
              <td class="num">${fmtNum(u.sessions)}</td>
              <td class="num">${fmtNum(u.stats?.walks)}</td>
              <td class="num">${fmtNum(u.stats?.trips)}</td>
              <td>${esc(u.device?.platform ?? '—')}</td>
              <td>${esc(u.device?.appVersion ?? '—')}</td>
            </tr>`;
          }).join('') || `<tr><td colspan="${COLUMNS.length}" class="empty">אין משתמשים שמתאימים לסינון</td></tr>`}
        </tbody>
      </table>
    </div>
    <div class="pager">
      <span class="muted">${fmtNum(list.length)} משתמשים · עמוד ${state.page + 1} מתוך ${pages}</span>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" type="button" data-page="-1" ${state.page === 0 ? 'disabled' : ''}>הקודם</button>
        <button class="btn btn-ghost btn-sm" type="button" data-page="1" ${state.page >= pages - 1 ? 'disabled' : ''}>הבא</button>
      </div>
    </div>`;

  const q = $('#q', el);
  q.addEventListener('input', () => {
    state.query = q.value;
    state.page = 0;
    renderUsers(el);
    const again = $('#q', el);
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  });
}

async function findOnServer() {
  const q = state.query.trim();
  if (q.length < 4) return toast('הקלידו לפחות 4 תווים ממזהה התמיכה', true);
  const found = await state.backend.findUsers(q);
  for (const u of found) if (!state.users.some((x) => x.id === u.id)) state.users.push(u);
  toast(found.length ? `נמצאו ${found.length}` : 'לא נמצא משתמש עם המזהה הזה');
  renderUsers($('#view'));
}

function exportCsv() {
  const list = visibleUsers();
  const head = ['uid', 'support_id', 'email', 'donated', 'status', 'premium_until', 'created', 'last_seen', 'sessions', 'walks', 'walk_km', 'trips', 'platform', 'version', 'notes'];
  const rows = list.map((u) => {
    const p = premiumOf(u);
    return [u.id, supportIdOf(u), u.profile?.email ?? '', u.donations?.total ?? 0, p.kind, p.until ?? '', new Date(u.createdAt).toISOString(), new Date(u.lastSeenAt).toISOString(),
      u.sessions, u.stats?.walks ?? 0, ((u.stats?.walkMeters ?? 0) / 1000).toFixed(2), u.stats?.trips ?? 0,
      u.device?.platform ?? '', u.device?.appVersion ?? '', u.notes ?? ''];
  });
  const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  a.download = `walkie-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- פרטי משתמש ---------- */

function openUser(id) {
  const u = state.users.find((x) => x.id === id);
  if (!u) return;
  const p = premiumOf(u);
  const s = u.stats ?? {};
  $('#drawer-body').innerHTML = `
    <div class="drawer-head">
      <div>
        <h2>משתמש <bdi class="mono">${esc(supportIdOf(u))}</bdi></h2>
        <div style="margin-top:6px">${badge(p)} ${p.until ? `<span class="muted">עד ${esc(p.until)}</span>` : ''}</div>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" data-close>✕</button>
    </div>

    <h3>פעילות</h3>
    <div class="stat-row">
      <div><strong>${fmtNum(u.sessions)}</strong><span>פתיחות</span></div>
      <div><strong>${fmtNum(s.walks)}</strong><span>הליכות · ${((s.walkMeters ?? 0) / 1000).toFixed(1)} ק"מ</span></div>
      <div><strong>${fmtNum(s.trips)}</strong><span>נסיעות</span></div>
    </div>

    <h3>פרטים</h3>
    <dl class="kv">
      <dt>UID</dt><dd><bdi class="mono">${esc(u.id)}</bdi></dd>
      <dt>הצטרף</dt><dd>${fmtDateTime(u.createdAt)}</dd>
      <dt>פעיל לאחרונה</dt><dd>${fmtDateTime(u.lastSeenAt)} (${fmtAgo(u.lastSeenAt)})</dd>
      <dt>חשבון Google</dt><dd>${u.profile?.email ? `${esc(u.profile.name ?? '')} · <a href="mailto:${esc(u.profile.email)}">${esc(u.profile.email)}</a>` : u.authType === 'google' ? 'Google · האימייל יישמר כשהמשתמש יפתח את הגרסה העדכנית של האפליקציה' : 'לא מחובר'}</dd>
      <dt>תרומות</dt><dd>${u.donations?.count ? `${fmtMoney(u.donations.total)} ב-${u.donations.count} תרומות · אחרונה ${fmtDate(Date.parse(u.donations.last))}` : 'אין'}</dd>
      <dt>פלטפורמה</dt><dd>${esc(u.device?.platform ?? '—')} · גרסה ${esc(u.device?.appVersion ?? '—')} · ${esc(u.device?.lang ?? '')}</dd>
      <dt>סוג הרשמה</dt><dd>${esc({ google: 'Google', email: 'אימייל', anonymous: 'אורח / אנונימי' }[u.authType] ?? u.authType)}</dd>
      <dt>מקור הגעה</dt><dd>${u.attribution ? esc(`${u.attribution.source} / ${u.attribution.medium}${u.attribution.campaign ? ` / ${u.attribution.campaign}` : ''}`) : '—'}</dd>
      <dt>קוד הזמנה</dt><dd>${u.refCode ? `<bdi class="mono">${esc(u.refCode)}</bdi>` : '—'}${u.referral?.count ? ` · הזמין ${u.referral.count} חברים${u.referral.badge ? ' 🏅' : ''}` : ''}${u.referral?.referredBy ? ` · נרשם בהזמנה` : ''}</dd>
      <dt>Premium (מהמכשיר)</dt><dd>${u.premium?.active ? `${esc(u.premium.source)} מאז ${fmtDate(Date.parse(u.premium.since))}` : 'לא פעיל'}</dd>
      ${u.premiumGrantedBy ? `<dt>מתנה מאת</dt><dd>${esc(u.premiumGrantedBy)}</dd>` : ''}
    </dl>

    <h3>מתנת Premium</h3>
    <div class="actions">
      <button class="btn btn-ghost btn-sm" type="button" data-grant="7">7 ימים</button>
      <button class="btn btn-ghost btn-sm" type="button" data-grant="30">חודש</button>
      <button class="btn btn-ghost btn-sm" type="button" data-grant="365">שנה</button>
      <button class="btn btn-ghost btn-sm" type="button" data-grant="forever">ללא הגבלה</button>
      <input id="grant-date" class="input" type="date" style="width:auto;min-height:32px">
      <button class="btn btn-ghost btn-sm" type="button" data-grant="date">עד התאריך</button>
      ${u.plan === 'pro' ? '<button class="btn btn-danger btn-sm" type="button" data-revoke>ביטול המתנה</button>' : ''}
    </div>
    <p class="note">מנוי שנקנה ב-Google Play מבוטל רק ב-Play Console (הזמנות ← החזר / ביטול).</p>

    <h3>הערות פנימיות</h3>
    <textarea id="notes" class="input" placeholder="למשל: פנה לתמיכה בנושא…">${esc(u.notes)}</textarea>
    <div class="actions" style="margin-top:8px">
      <button class="btn btn-primary btn-sm" type="button" data-save-notes>שמירת הערה</button>
    </div>

    <h3>נתונים גולמיים</h3>
    <pre class="raw">${esc(JSON.stringify(u, null, 2))}</pre>

    <h3>אזור מסוכן</h3>
    <div class="actions" style="margin-bottom:8px"><button class="btn btn-danger btn-sm" type="button" data-ban>חסימת המשתמש לצמיתות</button></div>
    <button class="btn btn-danger btn-sm" type="button" data-delete>מחיקת נתוני המשתמש מהשרת</button>
    <p class="note">מוחק את המסמך בשרת (בקשת מחיקה לפי חוק). הנתונים שבמכשיר עצמו לא נמחקים.</p>`;
  $('#drawer').hidden = false;
  $('#drawer').dataset.user = id;
}

function closeDrawer() {
  $('#drawer').hidden = true;
}

async function userAction(e) {
  const id = $('#drawer').dataset.user;
  const u = state.users.find((x) => x.id === id);
  if (!u) return;
  const b = state.backend;
  const t = e.target.closest('button');
  if (!t) return;

  try {
    if (t.dataset.grant) {
      let until;
      if (t.dataset.grant === 'forever') until = 'forever';
      else if (t.dataset.grant === 'date') {
        const v = $('#grant-date').value;
        if (!v) return toast('בחרו תאריך', true);
        until = new Date(`${v}T23:59:59`).toISOString();
      } else until = new Date(Date.now() + Number(t.dataset.grant) * DAY).toISOString();
      const patch = { plan: 'pro', premiumUntil: until, premiumGrantedBy: state.me.email };
      await b.updateUser(id, patch);
      Object.assign(u, patch);
      await b.log('grant-premium', id, { until });
      toast('Premium הוענק 🎁 (יופעל בפתיחה הבאה של האפליקציה)');
    } else if ('revoke' in t.dataset) {
      if (!confirm('לבטל את מתנת ה-Premium?')) return;
      const patch = { plan: 'free', premiumUntil: null, premiumGrantedBy: null };
      await b.updateUser(id, patch);
      Object.assign(u, patch);
      await b.log('revoke-premium', id);
      toast('המתנה בוטלה');
    } else if ('ban' in t.dataset) {
      if (!confirm(`לחסום לצמיתות את ${supportIdOf(u)}?`)) return;
      await b.addBan({ type: 'uid', value: id, reason: null });
      await b.log('ban', supportIdOf(u));
      toast('המשתמש נחסם');
    } else if ('saveNotes' in t.dataset) {
      const notes = $('#notes').value.trim();
      await b.updateUser(id, { notes });
      u.notes = notes;
      await b.log('notes', id);
      toast('ההערה נשמרה');
    } else if ('delete' in t.dataset) {
      if (prompt(`למחיקה סופית, הקלידו את מזהה התמיכה: ${supportIdOf(u)}`) !== supportIdOf(u)) return;
      await b.deleteUser(id);
      state.users = state.users.filter((x) => x.id !== id);
      await b.log('delete-user', id);
      closeDrawer();
      toast('נתוני המשתמש נמחקו');
      return go(state.view);
    } else return;
    openUser(id);
    if (state.view === 'users') renderUsers($('#view'));
  } catch (err) {
    toast(`הפעולה נכשלה: ${err.message}`, true);
  }
}

/* =========================================================
   Premium ומחירים
   ========================================================= */

async function renderPremium(el) {
  const saved = await state.backend.getConfig('pricing');
  const pr = mergePricing(saved);
  const subs = state.users.filter((u) => premiumOf(u).kind !== 'free')
    .sort((a, b) => (Date.parse(b.premium?.since) || 0) - (Date.parse(a.premium?.since) || 0));

  el.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h2>מחירים</h2>
        <div class="form-grid">
          <label class="field"><span>מחיר רגיל לחודש (₪)</span><input id="p-regular" class="input" type="number" step="0.01" min="0.5" value="${pr.regular}"></label>
          <label class="field"><span>מחיר השקה לחודש (₪)</span><input id="p-launch" class="input" type="number" step="0.01" min="0.5" value="${pr.launch}"></label>
          <label class="field" style="grid-column:1/-1"><span>מבצע ההשקה מסתיים ב- (שעון ישראל)</span>
            <input id="p-ends" class="input" type="datetime-local" value="${isoToLocal(pr.launchEndsAt)}">
            <small>ברירת המחדל: 1.1.2027 בחצות – מאז המחיר חוזר למחיר הרגיל.</small></label>
        </div>
        <div class="actions" style="margin-top:14px">
          <button id="p-save" class="btn btn-primary" type="button">שמירת מחירים</button>
          <button id="p-reset" class="btn btn-ghost" type="button">חזרה לברירת המחדל</button>
        </div>
        <p class="note warn">
          המחיר שבאמת נגבה נקבע ב-Google Play Console (מנוי <bdi class="mono">${esc(PRICING.productId)}</bdi>).
          אחרי שינוי כאן, צריך לעדכן גם שם – אחרת המשתמשים יראו מחיר אחד וישלמו אחר. ההוראות ב-docs/PREMIUM.md.
        </p>
      </div>
      <div class="card">
        <h2>תצוגה מקדימה <small>· כמו שהמשתמשים רואים עכשיו</small></h2>
        <div id="p-preview"></div>
      </div>
    </div>

    <div class="card">
      <h2>מנויים פעילים <small>· ${fmtNum(subs.length)}</small></h2>
      ${subs.length ? `<div class="table-wrap"><table>
        <thead><tr><th>מזהה</th><th>סוג</th><th>מאז</th><th>עד</th><th>פעיל לאחרונה</th></tr></thead>
        <tbody>${subs.slice(0, 200).map((u) => {
          const p = premiumOf(u);
          return `<tr data-user="${esc(u.id)}"><td><bdi class="mono">${esc(supportIdOf(u))}</bdi></td><td>${badge(p)}</td><td>${fmtDate(Date.parse(u.premium?.since))}</td><td>${esc(p.until ?? 'מתחדש אוטומטית')}</td><td>${fmtAgo(u.lastSeenAt)}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">עדיין אין מנויים</div>'}
    </div>`;

  const preview = () => {
    const draft = mergePricing({ regular: $('#p-regular').value, launch: $('#p-launch').value, launchEndsAt: localToIso($('#p-ends').value) });
    const p = priceAt(Date.now(), draft);
    $('#p-preview').innerHTML = `
      <div class="price-preview">
        ${p.isLaunch ? `<span class="badge">מחיר השקה · ${p.discount}% הנחה</span>` : ''}
        <div class="p">${formatPrice(p.price, draft)} <small class="muted" style="font-size:15px">לחודש</small> ${p.isLaunch ? `<s>${formatPrice(p.regular, draft)}</s>` : ''}</div>
        ${p.isLaunch ? `<div class="muted">המבצע עד ${formatLaunchEnd(draft)} · נשארו ${p.daysLeft} ימים</div>` : '<div class="muted">אין מבצע פעיל – המחיר הרגיל חל</div>'}
      </div>
      <dl class="kv" style="margin-top:14px">
        <dt>אחוז הנחה</dt><dd><strong>${discountPercent(draft)}%</strong> (${((1 - draft.launch / draft.regular) * 100).toFixed(1)}% מדויק, מעוגל למטה)</dd>
        <dt>חיסכון לחודש</dt><dd>${formatPrice(Math.max(0, draft.regular - draft.launch), draft)}</dd>
        <dt>אחרי המבצע</dt><dd>${formatPrice(draft.regular, draft)} לחודש</dd>
        <dt>נטו אחרי עמלת Google (15%)</dt><dd>${formatPrice(p.price * 0.85, draft)} עכשיו · ${formatPrice(draft.regular * 0.85, draft)} אחרי המבצע</dd>
      </dl>`;
  };
  preview();
  for (const id of ['#p-regular', '#p-launch', '#p-ends']) $(id).addEventListener('input', preview);

  $('#p-save').addEventListener('click', async () => {
    const regular = Number($('#p-regular').value), launch = Number($('#p-launch').value);
    if (!(regular > 0) || !(launch > 0)) return toast('מחיר לא תקין', true);
    if (launch > regular) return toast('מחיר ההשקה גבוה מהמחיר הרגיל', true);
    const data = { regular, launch, launchEndsAt: localToIso($('#p-ends').value) };
    try {
      await state.backend.setConfig('pricing', data);
      await state.backend.log('pricing', 'config/pricing', data);
      state.pricing = mergePricing(data);
      toast('המחירים נשמרו. זכרו לעדכן גם ב-Google Play');
    } catch (err) {
      toast(`השמירה נכשלה: ${err.message}`, true);
    }
  });

  $('#p-reset').addEventListener('click', () => {
    $('#p-regular').value = PRICING.regular;
    $('#p-launch').value = PRICING.launch;
    $('#p-ends').value = isoToLocal(PRICING.launchEndsAt);
    preview();
  });
}

/* =========================================================
   מגבלות ופיצ'רים
   ========================================================= */

async function renderLimits(el) {
  const saved = (await state.backend.getConfig('limits')) ?? {};
  const lim = { ...FREE_LIMITS, ...saved };
  el.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h2>מגבלות לחשבון חינמי</h2>
        <div class="form-grid">
          <label class="field"><span>תחנות שמורות</span><input id="l-stops" class="input" type="number" min="0" max="50" value="${lim.stops}"></label>
          <label class="field"><span>קווים שמורים</span><input id="l-lines" class="input" type="number" min="0" max="50" value="${lim.lines}"></label>
          <label class="field"><span>מקומות שמורים</span><input id="l-places" class="input" type="number" min="0" max="50" value="${lim.places}"></label>
        </div>
        <div class="actions" style="margin-top:14px"><button id="l-save" class="btn btn-primary" type="button">שמירה</button></div>
        <p class="note">ב-Premium אין מגבלה. בית ועבודה/בית ספר תמיד חינמיים. מי שכבר שמר יותר מהמגבלה לא מאבד כלום – רק לא יכול להוסיף.</p>
      </div>
      <div class="card">
        <h2>פיצ'רים ב-Premium</h2>
        <ul class="feature-list">
          ${PREMIUM_FEATURES.map((f) => `<li><span>${f.icon}</span><div><strong>${esc(f.title)}</strong><small>${esc(f.desc)}</small></div>${f.live ? '<span class="badge on">פעיל</span>' : '<span class="badge">בקרוב</span>'}</li>`).join('')}
        </ul>
        <p class="note">הרשימה מוגדרת בקוד (public/js/modules/pricing.js). פיצ'ר "בקרוב" מוצג למשתמשים, אבל לא מובטח כחלק מהמנוי.</p>
      </div>
    </div>`;

  $('#l-save').addEventListener('click', async () => {
    const data = { stops: +$('#l-stops').value, lines: +$('#l-lines').value, places: +$('#l-places').value };
    if (Object.values(data).some((v) => !Number.isInteger(v) || v < 0)) return toast('ערכים לא תקינים', true);
    try {
      await state.backend.setConfig('limits', data);
      await state.backend.log('limits', 'config/limits', data);
      toast('המגבלות נשמרו');
    } catch (err) {
      toast(`השמירה נכשלה: ${err.message}`, true);
    }
  });
}

/* =========================================================
   הודעה למשתמשים
   ========================================================= */

async function renderAnnounce(el) {
  const a = { active: false, level: 'info', audience: 'all', title: '', text: '', until: '', ...((await state.backend.getConfig('announcement')) ?? {}) };
  el.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h2>הודעה במסך הבית</h2>
        <div class="grid" style="gap:12px">
          <label class="switch-row"><input id="a-active" type="checkbox" ${a.active ? 'checked' : ''}> ההודעה פעילה</label>
          <div class="form-grid">
            <label class="field"><span>סוג</span><select id="a-level" class="input"><option value="info">מידע</option><option value="warning">אזהרה</option></select></label>
            <label class="field"><span>למי</span><select id="a-audience" class="input"><option value="all">כולם</option><option value="free">משתמשי חינם</option><option value="premium">מנויי Premium</option></select></label>
            <label class="field"><span>להציג עד (לא חובה)</span><input id="a-until" class="input" type="date" value="${esc((a.until || '').slice(0, 10))}"></label>
          </div>
          <label class="field"><span>כותרת</span><input id="a-title" class="input" maxlength="60" value="${esc(a.title)}" placeholder="למשל: שיבושים בקו 5"></label>
          <label class="field"><span>טקסט</span><textarea id="a-text" class="input" maxlength="240" placeholder="עד 240 תווים">${esc(a.text)}</textarea></label>
        </div>
        <div class="actions" style="margin-top:14px">
          <button id="a-save" class="btn btn-primary" type="button">פרסום</button>
          <button id="a-off" class="btn btn-ghost" type="button">כיבוי ההודעה</button>
        </div>
        <p class="note">כל משתמש רואה את ההודעה פעם אחת (עד שהוא סוגר אותה), בפתיחה הבאה של האפליקציה. פרסום מחדש מציג אותה שוב לכולם.</p>
      </div>
      <div class="card">
        <h2>תצוגה מקדימה</h2>
        <div class="preview-phone"><div id="a-preview"></div></div>
      </div>
    </div>`;
  $('#a-level').value = a.level;
  $('#a-audience').value = a.audience;

  const preview = () => {
    const title = $('#a-title').value.trim(), text = $('#a-text').value.trim();
    $('#a-preview').innerHTML = text
      ? `<div class="announce-preview${$('#a-level').value === 'warning' ? ' is-warning' : ''}"><div style="flex:1">${title ? `<strong>${esc(title)}</strong>` : ''}${esc(text)}</div><span class="muted">✕</span></div>`
      : '<div class="muted">כתבו טקסט כדי לראות תצוגה מקדימה</div>';
  };
  preview();
  for (const id of ['#a-title', '#a-text', '#a-level']) $(id).addEventListener('input', preview);

  const save = async (active) => {
    const data = {
      id: String(Date.now()),
      active,
      level: $('#a-level').value,
      audience: $('#a-audience').value,
      title: $('#a-title').value.trim(),
      text: $('#a-text').value.trim(),
      until: $('#a-until').value ? new Date(`${$('#a-until').value}T23:59:59`).toISOString() : ''
    };
    if (active && !data.text) return toast('חסר טקסט להודעה', true);
    try {
      await state.backend.setConfig('announcement', data);
      await state.backend.log(active ? 'announce' : 'announce-off', 'config/announcement', { title: data.title });
      $('#a-active').checked = active;
      toast(active ? 'ההודעה פורסמה 📣' : 'ההודעה כובתה');
    } catch (err) {
      toast(`השמירה נכשלה: ${err.message}`, true);
    }
  };
  $('#a-save').addEventListener('click', () => save(true));
  $('#a-off').addEventListener('click', () => save(false));
}

/* =========================================================
   מנהלים ויומן
   ========================================================= */

const ACTIONS = {
  'grant-premium': 'הענקת Premium',
  'revoke-premium': 'ביטול Premium',
  notes: 'עדכון הערה',
  'delete-user': 'מחיקת משתמש',
  pricing: 'עדכון מחירים',
  limits: 'עדכון מגבלות',
  announce: 'פרסום הודעה',
  'announce-off': 'כיבוי הודעה',
  ban: 'חסימה',
  unban: 'ביטול חסימה',
  broadcast: 'שליחת הודעה',
  'broadcast-off': 'כיבוי הודעה',
  survey: 'פרסום סקר',
  'add-admin': 'הוספת מנהל',
  'remove-admin': 'הסרת מנהל'
};

async function renderAdmins(el) {
  const [admins, log] = await Promise.all([state.backend.listAdmins(), state.backend.listLog(100)]);
  const all = [{ email: OWNER_EMAIL, owner: true }, ...admins.filter((a) => a.email !== OWNER_EMAIL)];
  el.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h2>מנהלים</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>אימייל</th><th>נוסף</th><th></th></tr></thead>
          <tbody>${all.map((a) => `<tr style="cursor:default"><td>${esc(a.email)}</td><td>${a.owner ? '<span class="badge on">בעלים</span>' : `${fmtDate(a.addedAt)} · ${esc(a.addedBy ?? '')}`}</td>
            <td>${a.owner ? '' : `<button class="btn btn-danger btn-sm" type="button" data-remove-admin="${esc(a.email)}">הסרה</button>`}</td></tr>`).join('')}</tbody>
        </table></div>
        <div class="toolbar" style="margin-top:12px">
          <input id="new-admin" class="input" type="email" placeholder="email@gmail.com">
          <button id="btn-add-admin" class="btn btn-primary btn-sm" type="button">הוספת מנהל</button>
        </div>
        <p class="note">מנהל נכנס עם חשבון Google באימייל הזה, ומקבל גישה מלאה לדף. הבעלים מוגדר ב-firestore.rules ואי אפשר להסיר אותו מכאן.</p>
      </div>
      <div class="card">
        <h2>יומן פעולות <small>· 100 האחרונות</small></h2>
        ${log.length ? `<div class="table-wrap"><table>
          <thead><tr><th>מתי</th><th>מי</th><th>פעולה</th><th>על</th></tr></thead>
          <tbody>${log.map((l) => `<tr style="cursor:default"><td>${fmtDateTime(l.at)}</td><td>${esc(l.by)}</td><td>${esc(ACTIONS[l.action] ?? l.action)}</td><td><bdi class="mono">${esc(String(l.target ?? '').slice(0, 24))}</bdi></td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">עדיין אין פעולות ביומן</div>'}
      </div>
    </div>`;

  $('#btn-add-admin').addEventListener('click', async () => {
    const email = $('#new-admin').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('אימייל לא תקין', true);
    try {
      await state.backend.addAdmin(email);
      await state.backend.log('add-admin', email);
      toast('המנהל נוסף');
      renderAdmins(el);
    } catch (err) {
      toast(`ההוספה נכשלה: ${err.message}`, true);
    }
  });
}

/* =========================================================
   הפעלה
   ========================================================= */

function showLogin(error = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-error').hidden = !error;
  $('#login-error').textContent = error;
}

async function enter() {
  const b = state.backend;
  try {
    await b.verifyAdmin();
  } catch {
    await b.signOut();
    return showLogin(`לחשבון ${state.me.email} אין הרשאת מנהל.`);
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#demo-banner').hidden = b.mode !== 'demo';
  $('#me').innerHTML = `${state.me.photo ? `<img src="${esc(state.me.photo)}" alt="">` : '👤'}<span>${esc(state.me.email)}</span>`;
  await loadAll();
  go(state.view);
}

async function boot() {
  try {
    state.me = await state.backend.init();
  } catch (err) {
    console.error(err);
    state.backend = createDemoBackend();
    state.me = await state.backend.init();
    toast('אין חיבור ל-Firebase – מוצג מצב הדגמה', true);
  }
  if (state.me) enter();
  else showLogin();
}

$('#btn-login').addEventListener('click', async () => {
  try {
    state.me = await state.backend.signIn();
    if (state.me) enter();
  } catch (err) {
    const msg = err.code === 'auth/configuration-not-found' || err.code === 'auth/operation-not-allowed'
      ? 'הכניסה עם Google עוד לא הופעלה ב-Firebase (Authentication ← Sign-in method).'
      : err.code === 'auth/unauthorized-domain'
        ? `הדומיין ${location.hostname} לא מורשה ב-Firebase (Authentication ← Settings ← Authorized domains).`
        : `הכניסה נכשלה: ${err.message}`;
    showLogin(msg);
  }
});

$('#btn-logout').addEventListener('click', async () => {
  await state.backend.signOut();
  location.href = './';
});

$('#btn-refresh').addEventListener('click', async () => {
  await loadAll();
  go(state.view);
});

document.querySelector('.side-nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) go(b.dataset.view);
});

$('#view').addEventListener('click', (e) => {
  const t = e.target;
  const row = t.closest('[data-user]');
  if (row) return openUser(row.dataset.user);
  const goBtn = t.closest('[data-go]');
  if (goBtn) return go(goBtn.dataset.go);
  const f = t.closest('[data-filter]');
  if (f) {
    state.filter = f.dataset.filter;
    state.page = 0;
    return renderUsers($('#view'));
  }
  const th = t.closest('th[data-sort]');
  if (th) {
    state.sort = { key: th.dataset.sort, dir: state.sort.key === th.dataset.sort ? -state.sort.dir : -1 };
    return renderUsers($('#view'));
  }
  const pg = t.closest('[data-page]');
  if (pg) {
    state.page += Number(pg.dataset.page);
    return renderUsers($('#view'));
  }
  if (t.closest('#btn-csv')) return exportCsv();
  if (t.closest('#btn-find')) return findOnServer();
  if (t.closest('#btn-more')) return loadMoreUsers().then(() => renderUsers($('#view')));
  const rm = t.closest('[data-remove-admin]');
  if (rm && confirm(`להסיר את ${rm.dataset.removeAdmin} מהמנהלים?`)) {
    state.backend.removeAdmin(rm.dataset.removeAdmin)
      .then(() => state.backend.log('remove-admin', rm.dataset.removeAdmin))
      .then(() => renderAdmins($('#view')))
      .catch((err) => toast(`ההסרה נכשלה: ${err.message}`, true));
  }
});

$('#drawer').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) return closeDrawer();
  userAction(e);
});

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer();
});

boot();
