// Walkie Admin – סקירה, משתמשים, הודעות, דף תודות, מנהלים ויומן.

import { createBackend, createDemoBackend, OWNER_EMAIL } from './backend.js';
import { renderAcquisition, renderProduct, renderGeo, renderControl } from './analytics-views.js';

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

const supportIdOf = (u) => u.id.slice(0, 8);

/* ---------- טעינה ---------- */

async function loadAll() {
  $('#view').innerHTML = '<div class="loading">טוען נתונים…</div>';
  const b = state.backend;
  const [counts, page] = await Promise.all([b.counts(), b.listUsers({ pageSize: 300 })]);
  state.counts = counts;
  state.users = page.users;
  state.next = page.next;
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
    b: state.backend, state, esc, fmtNum, fmtMoney, fmtDateTime, fmtAgo, toast, barChart, distBars, go: (v) => go(v)
  };
}

const VIEWS = {
  overview: { title: 'סקירה כללית', render: renderOverview },
  acquisition: { title: 'רכישת משתמשים ומקורות הגעה', render: (el) => renderAcquisition(el, viewCtx()) },
  product: { title: 'שיפור המוצר ונקודות נטישה', render: (el) => renderProduct(el, viewCtx()) },
  geo: { title: 'דמוגרפיה, אזורים ומכשירים', render: (el) => renderGeo(el, viewCtx()) },
  control: { title: 'בקרת משתמשים והודעות', render: (el) => renderControl(el, viewCtx()) },
  users: { title: 'משתמשים', render: renderUsers },
  announce: { title: 'הודעה למשתמשים', render: renderAnnounce },
  collabs: { title: 'שיתופי פעולה', render: renderCollabs },
  thanks: { title: 'דף תודות', render: renderThanks },
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

  const sample = state.users;
  const sum = (k) => sample.reduce((a, u) => a + (u.stats?.[k] ?? 0), 0);
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
      <div class="card kpi"><div class="label">מחוברים עם Google</div><div class="value">${fmtNum(linked)}</div><div class="sub">${sample.length ? Math.round((linked / sample.length) * 100) : 0}% מהמשתמשים</div></div>
    </div>

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
  active: { label: 'פעילים (7 ימים)', fn: (u) => u.lastSeenAt >= Date.now() - 7 * DAY },
  dormant: { label: 'רדומים (30+ ימים)', fn: (u) => u.lastSeenAt < Date.now() - 30 * DAY },
  google: { label: 'מחוברים ל-Google', fn: (u) => !!u.profile?.email || u.authType === 'google' },
  notes: { label: 'עם הערות', fn: (u) => !!u.notes }
};

const COLUMNS = [
  { key: 'id', label: 'מזהה תמיכה', sort: (u) => u.id },
  { key: 'account', label: 'חשבון', sort: (u) => u.profile?.email ?? '' },
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
              <td>${u.profile?.email ? esc(u.profile.email) : u.authType === 'google' ? '<span class="muted">Google</span>' : '<span class="muted">אנונימי</span>'}</td>
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
  const head = ['uid', 'support_id', 'email', 'created', 'last_seen', 'sessions', 'walks', 'walk_km', 'trips', 'platform', 'version', 'notes'];
  const rows = list.map((u) => {
    return [u.id, supportIdOf(u), u.profile?.email ?? '', new Date(u.createdAt).toISOString(), new Date(u.lastSeenAt).toISOString(),
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
  const s = u.stats ?? {};
  $('#drawer-body').innerHTML = `
    <div class="drawer-head">
      <div>
        <h2>משתמש <bdi class="mono">${esc(supportIdOf(u))}</bdi></h2>
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
      <dt>פלטפורמה</dt><dd>${esc(u.device?.platform ?? '—')} · גרסה ${esc(u.device?.appVersion ?? '—')} · ${esc(u.device?.lang ?? '')}</dd>
      <dt>סוג הרשמה</dt><dd>${esc({ google: 'Google', email: 'אימייל', anonymous: 'אורח / אנונימי' }[u.authType] ?? u.authType)}</dd>
      <dt>מקור הגעה</dt><dd>${u.attribution ? esc(`${u.attribution.source} / ${u.attribution.medium}${u.attribution.campaign ? ` / ${u.attribution.campaign}` : ''}`) : '—'}</dd>
    </dl>

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
    if ('ban' in t.dataset) {
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
   דף תודות (לשונית "תודות" באפליקציה)
   ========================================================= */

/** מקטין תמונה ל-JPEG של עד 900px, כדי שתיכנס במסמך ההגדרות (אין צורך ב-Storage) */
function imageToDataUrl(file, max = 900) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('לא ניתן לקרוא את התמונה')); };
    img.src = url;
  });
}

async function renderThanks(el) {
  const items = await state.backend.listThanks();
  await Promise.all(items.map(async (x) => { x.real = await state.backend.heartCount(x.id).catch(() => 0); }));
  const isHttp = (u) => /^https?:\/\//i.test(u);

  el.innerHTML = `
    <div class="card">
      <div class="actions" style="margin-bottom:12px">
        <button id="t-new" class="btn btn-primary" type="button">➕ הוסף תודה חדשה</button>
      </div>
      ${items.length ? `<div class="thanks-list">${items.map((x) => `
        <div class="thanks-row" data-id="${esc(x.id)}">
          ${x.image ? `<img src="${esc(x.image)}" alt="">` : '<span class="thanks-row-ph">💚</span>'}
          <div class="thanks-row-main">
            <strong>${esc(x.title || '(ללא כותרת)')}</strong>
            <small>${x.active ? '🟢 מוצגת' : '⚪ מוסתרת'} · ❤️ ${Math.max(0, (x.heartsBase || 0) + x.real)}</small>
          </div>
          <div class="actions">
            <button class="btn btn-ghost btn-sm" type="button" data-act="edit">עריכה</button>
            <button class="btn btn-ghost btn-sm" type="button" data-act="toggle">${x.active ? 'הסתרה' : 'הצגה'}</button>
            <button class="btn btn-ghost btn-sm" type="button" data-act="delete">מחיקה</button>
          </div>
        </div>`).join('')}</div>` : '<p class="muted">עוד אין תודות. לחצו על "הוסף תודה חדשה".</p>'}
    </div>
    <div id="t-editor"></div>`;

  const openEditor = (item) => {
    const d = { active: true, title: '', message: '', image: '', linkUrl: '', linkLabel: '', heartsBase: 0, real: 0, ...(item ?? {}) };
    let image = d.image || '';
    $('#t-editor').innerHTML = `
      <div class="grid cols-2" style="margin-top:16px">
        <div class="card">
          <h2>${item ? 'עריכת תודה' : 'תודה חדשה'}</h2>
          <div class="grid" style="gap:12px">
            <label class="switch-row"><input id="t-active" type="checkbox" ${d.active ? 'checked' : ''}> מוצגת באפליקציה</label>
            <label class="field"><span>כותרת</span><input id="t-title" class="input" maxlength="80" value="${esc(d.title)}" placeholder="למשל: תודה לכל מי שעוזר לנו"></label>
            <label class="field"><span>הודעה</span><textarea id="t-message" class="input" rows="6" maxlength="1500" placeholder="עד 1500 תווים">${esc(d.message)}</textarea></label>
            <div class="field">
              <span>תמונה</span>
              <input id="t-file" class="input" type="file" accept="image/*">
              <div class="actions" style="margin-top:6px"><button id="t-img-clear" class="btn btn-ghost btn-sm" type="button">הסרת התמונה</button></div>
            </div>
            <label class="field"><span>כמות לבבות מוצגת (כרגע ${d.real} מהמשתמשים)</span><input id="t-hearts" class="input" type="number" min="0" step="1" value="${Math.max(0, (d.heartsBase || 0) + d.real)}"></label>
            <div class="form-grid">
              <label class="field"><span>קישור (לא חובה)</span><input id="t-url" class="input" type="url" dir="ltr" value="${esc(d.linkUrl)}" placeholder="https://"></label>
              <label class="field"><span>טקסט הכפתור</span><input id="t-label" class="input" maxlength="40" value="${esc(d.linkLabel)}" placeholder="לפרטים נוספים"></label>
            </div>
          </div>
          <div class="actions" style="margin-top:14px">
            <button id="t-save" class="btn btn-primary" type="button">שמירה</button>
            <button id="t-cancel" class="btn btn-ghost" type="button">ביטול</button>
          </div>
        </div>
        <div class="card">
          <h2>תצוגה מקדימה</h2>
          <div class="preview-phone"><div id="t-preview"></div></div>
        </div>
      </div>`;

    const preview = () => {
      const title = $('#t-title').value.trim(), msg = $('#t-message').value.trim();
      const url = $('#t-url').value.trim(), label = $('#t-label').value.trim() || 'לפרטים נוספים';
      $('#t-preview').innerHTML = (title || msg || image)
        ? `<div class="thanks-preview">${image ? `<img src="${esc(image)}" alt="">` : ''}<div class="thanks-preview-body">${title ? `<strong>${esc(title)}</strong>` : ''}${msg ? `<p>${esc(msg)}</p>` : ''}<span class="thanks-preview-heart">🤍 ${Math.max(0, Number($('#t-hearts').value) || 0)}</span>${isHttp(url) ? `<span class="thanks-preview-link">${esc(label)}</span>` : ''}</div></div>`
        : '<div class="muted">מלאו כותרת, הודעה או תמונה כדי לראות תצוגה מקדימה</div>';
    };
    preview();
    for (const id of ['#t-title', '#t-message', '#t-url', '#t-label', '#t-hearts']) $(id).addEventListener('input', preview);

    $('#t-file').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        image = await imageToDataUrl(f);
        preview();
      } catch (err) {
        toast(err.message, true);
      }
    });
    $('#t-img-clear').addEventListener('click', () => { image = ''; $('#t-file').value = ''; preview(); });
    $('#t-cancel').addEventListener('click', () => { $('#t-editor').innerHTML = ''; });

    $('#t-save').addEventListener('click', async () => {
      const linkUrl = $('#t-url').value.trim();
      if (linkUrl && !isHttp(linkUrl)) return toast('הקישור חייב להתחיל ב-https://', true);
      const data = {
        active: $('#t-active').checked,
        title: $('#t-title').value.trim(),
        message: $('#t-message').value.trim(),
        image,
        linkUrl,
        linkLabel: $('#t-label').value.trim(),
        // מה שמוצג = בסיס + לבבות אמיתיים, לכן הבסיס הוא היעד פחות האמיתיים
        heartsBase: Math.max(0, Math.floor(Number($('#t-hearts').value) || 0)) - d.real,
        createdAt: item?.createdAt ?? Date.now()
      };
      if (!data.title && !data.message && !data.image) return toast('מלאו כותרת, הודעה או תמונה', true);
      try {
        const id = item?.id ?? String(Date.now());
        await state.backend.saveThanks(id, data);
        await state.backend.log('thanks', `thanks/${id}`, { title: data.title });
        toast('התודה נשמרה 💚');
        renderThanks(el);
      } catch (err) {
        toast(`השמירה נכשלה: ${err.message}`, true);
      }
    });
    $('#t-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  $('#t-new').addEventListener('click', () => openEditor(null));
  $$('.thanks-row', el).forEach((row) => row.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const item = items.find((x) => x.id === row.dataset.id);
    try {
      if (act === 'edit') return openEditor(item);
      if (act === 'toggle') {
        const { real, id, ...rest } = item;
        await state.backend.saveThanks(id, { ...rest, active: !item.active });
        await state.backend.log('thanks', `thanks/${id}`, { title: item.title, active: !item.active });
      } else if (act === 'delete') {
        if (!confirm(`למחוק את התודה "${item.title || 'ללא כותרת'}"?`)) return;
        await state.backend.deleteThanks(item.id);
        await state.backend.log('thanks-delete', `thanks/${item.id}`, { title: item.title });
        toast('התודה נמחקה');
      }
      renderThanks(el);
    } catch (err) {
      toast(`הפעולה נכשלה: ${err.message}`, true);
    }
  }));
}

/* =========================================================
   שיתופי פעולה – מעקב פניות לערוצים
   ========================================================= */

const COLLAB_STATUS = {
  new: { label: 'עוד לא נשלח', color: '#475569', bg: '#e2e8f0' },
  sent: { label: 'נשלח', color: '#1d4ed8', bg: '#dbeafe' },
  unread: { label: 'לא נקרא', color: '#a16207', bg: '#fef9c3' },
  read: { label: 'נקרא ולא התקבלה תשובה', color: '#c2410c', bg: '#ffedd5' },
  replied: { label: 'התקבלה תשובה', color: '#6d28d9', bg: '#ede9fe' },
  agreed: { label: 'הסכימו לשת"פ', color: '#166534', bg: '#dcfce7' },
  declined: { label: 'סירבו', color: '#b91c1c', bg: '#fee2e2' }
};

async function renderCollabs(el) {
  const items = await state.backend.listCollabs();
  const f = state.collabFilter ?? 'all';
  const shown = items.filter((x) => f === 'all' || x.status === f);
  const badgeStyle = (s) => `color:${COLLAB_STATUS[s]?.color};background:${COLLAB_STATUS[s]?.bg}`;
  const options = (cur) => Object.entries(COLLAB_STATUS).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${v.label}</option>`).join('');

  el.innerHTML = `
    <div class="card">
      <h2 id="c-form-title">הוספת ערוץ</h2>
      <form id="c-form" class="grid" style="gap:12px" novalidate>
        <div class="form-grid">
          <label class="field"><span>שם הערוץ</span><input id="c-name" class="input" maxlength="80" required></label>
          <label class="field"><span>קישור לערוץ</span><input id="c-url" class="input" dir="ltr" placeholder="https://" maxlength="300"></label>
          <label class="field"><span>סטטוס</span><select id="c-status" class="input">${options('new')}</select></label>
        </div>
        <label class="field"><span>הערות</span><textarea id="c-notes" class="input" maxlength="1000" rows="2"></textarea></label>
        <div class="actions">
          <button id="c-save" class="btn btn-primary" type="submit">➕ הוסף ערוץ</button>
          <button id="c-cancel" class="btn btn-ghost" type="button" hidden>ביטול עריכה</button>
        </div>
      </form>
    </div>
    <div class="card">
      <div class="chips" style="margin-bottom:12px">
        <button type="button" data-cfilter="all" class="${f === 'all' ? 'is-active' : ''}">הכל<b>${items.length}</b></button>
        ${Object.entries(COLLAB_STATUS).map(([k, v]) => `<button type="button" data-cfilter="${k}" class="${f === k ? 'is-active' : ''}">${v.label}<b>${items.filter((x) => x.status === k).length}</b></button>`).join('')}
      </div>
      ${shown.length ? `<div class="table-wrap"><table class="collab-table">
        <thead><tr><th>ערוץ</th><th>סטטוס</th><th>הערות</th><th>עודכן</th><th></th></tr></thead>
        <tbody>${shown.map((x) => `<tr data-id="${esc(x.id)}" style="cursor:default">
          <td><strong>${esc(x.name)}</strong>${x.url ? `<br><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" dir="ltr" class="collab-link">${esc(x.url)}</a>` : ''}</td>
          <td><select class="input collab-status" data-status="${esc(x.id)}" style="${badgeStyle(x.status)}">${options(x.status)}</select></td>
          <td class="collab-notes">${esc(x.notes || '—')}</td>
          <td>${fmtDateTime(x.updatedAt)}</td>
          <td><div class="actions-cell"><button class="btn btn-ghost btn-sm" data-cact="edit" type="button">✏️ עריכה</button><button class="btn btn-danger btn-sm" data-cact="delete" type="button">🗑️ מחיקה</button></div></td>
        </tr>`).join('')}</tbody></table></div>` : `<div class="empty">${items.length ? 'אין ערוצים בסטטוס הזה' : 'עדיין לא נוספו ערוצים'}</div>`}
    </div>`;

  let editing = null;
  const form = $('#c-form', el);
  const reset = () => {
    editing = null;
    form.reset();
    $('#c-form-title', el).textContent = 'הוספת ערוץ';
    $('#c-save', el).textContent = '➕ הוסף ערוץ';
    $('#c-cancel', el).hidden = true;
  };
  $('#c-cancel', el).addEventListener('click', reset);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#c-name', el).value.trim();
    let url = $('#c-url', el).value.trim();
    if (!name) return toast('חסר שם ערוץ', true);
    if (url) {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
      let ok = false;
      try { const u = new URL(url); ok = /^https?:$/.test(u.protocol) && u.hostname.includes('.'); } catch { /* לא תקין */ }
      if (!ok) return toast('הקישור לא תקין (למשל https://youtube.com/@channel)', true);
    }
    const data = { name, url, status: $('#c-status', el).value, notes: $('#c-notes', el).value.trim() };
    try {
      const id = await state.backend.saveCollab(editing, data);
      await state.backend.log('collab', `collabs/${id}`, { name, status: data.status });
      toast(editing ? 'הערוץ עודכן' : 'הערוץ נוסף 🤝');
      renderCollabs(el);
    } catch (err) {
      toast(`השמירה נכשלה: ${err.message}`, true);
    }
  });

  $$('[data-cfilter]', el).forEach((b) => b.addEventListener('click', () => {
    state.collabFilter = b.dataset.cfilter;
    renderCollabs(el);
  }));

  $$('[data-status]', el).forEach((s) => s.addEventListener('change', async () => {
    const x = items.find((i) => i.id === s.dataset.status);
    try {
      await state.backend.saveCollab(x.id, { status: s.value });
      await state.backend.log('collab', `collabs/${x.id}`, { name: x.name, status: s.value });
      toast('הסטטוס עודכן');
      renderCollabs(el);
    } catch (err) {
      toast(`העדכון נכשל: ${err.message}`, true);
    }
  }));

  $$('[data-cact]', el).forEach((b) => b.addEventListener('click', async () => {
    const x = items.find((i) => i.id === b.closest('tr').dataset.id);
    if (b.dataset.cact === 'edit') {
      editing = x.id;
      $('#c-name', el).value = x.name ?? '';
      $('#c-url', el).value = x.url ?? '';
      $('#c-status', el).value = x.status;
      $('#c-notes', el).value = x.notes ?? '';
      $('#c-form-title', el).textContent = `עריכת ערוץ: ${x.name}`;
      $('#c-save', el).textContent = '💾 שמור שינויים';
      $('#c-cancel', el).hidden = false;
      $('#c-name', el).focus();
      return form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (!confirm(`למחוק את הערוץ "${x.name}"?`)) return;
    try {
      await state.backend.deleteCollab(x.id);
      await state.backend.log('collab-delete', `collabs/${x.id}`, { name: x.name });
      toast('הערוץ נמחק');
      renderCollabs(el);
    } catch (err) {
      toast(`המחיקה נכשלה: ${err.message}`, true);
    }
  }));
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
  thanks: 'עדכון תודה',
  'thanks-delete': 'מחיקת תודה',
  collab: 'עדכון ערוץ שת"פ',
  'collab-delete': 'מחיקת ערוץ שת"פ',
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
