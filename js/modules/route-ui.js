// תבניות HTML למסלול: תצוגה מקדימה, פאנל ניווט, באנר הוראות, הגעה ליעד.

import { escapeHtml } from './ui.js';
import { WHATSAPP_ICON } from './share.js';

// ---------- פורמטים ----------

export function formatDuration(seconds) {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} דק'`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ש' ${m} דק'` : `${h} ש'`;
}

export function formatClock(secondsFromNow) {
  return new Date(Date.now() + secondsFromNow * 1000).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatNavDistance(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} ק"מ`;
  if (m >= 100) return `${Math.round(m / 10) * 10} מ'`;
  return `${Math.max(5, Math.round(m / 5) * 5)} מ'`;
}

// ---------- אייקוני תמרון ----------

// זווית החץ לפי סוג תמרון (Valhalla). 0 = ישר, חיובי = ימינה
const TURN_ANGLE = {
  2: 90, 3: -90,
  7: 0, 8: 0, 17: 0, 22: 0, 25: 0, 39: 0, 40: 0, 41: 0, 42: 0, 43: 0,
  9: 40, 18: 40, 20: 40, 23: 30, 37: 30,
  10: 90,
  11: 135,
  12: 180, 13: 180,
  14: -135,
  15: -90,
  16: -40, 19: -40, 21: -40, 24: -30, 38: -30
};

const ARROW_PATH = 'M12 3 5 10.5l1.4 1.4L11 7.3V21h2V7.3l4.6 4.6 1.4-1.4L12 3Z';
const PIN_PATH = 'M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z';
const WALK_PATH = 'M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5 0-.8.1L6 8.3V13h2V9.6l1.8-.7';
const ROUNDABOUT_PATH = 'M12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-6-6v3l4-4-4-4v3Z';

export function maneuverIcon(type, size = 22) {
  let path = ARROW_PATH;
  let rotate = TURN_ANGLE[type] ?? 0;
  if (type === 1) {
    path = WALK_PATH;
    rotate = 0;
  } else if (type === 4 || type === 5 || type === 6) {
    path = PIN_PATH;
    rotate = 0;
  } else if (type === 26 || type === 27) {
    path = ROUNDABOUT_PATH;
    rotate = 0;
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" style="transform:rotate(${rotate}deg)"><path fill="currentColor" d="${path}"/></svg>`;
}

// ---------- תצוגה מקדימה ----------

export function routeLoadingHtml(dest) {
  return `
    <p class="eyebrow">מחשב מסלול הליכה…</p>
    <h2 class="stop-title">${escapeHtml(dest.name)}</h2>
    <div class="skeleton" style="margin-top:14px">
      <div class="sk-title"></div>
      <div class="sk-card"></div>
      <div class="sk-row"></div>
    </div>`;
}

const ROUTE_ERRORS = {
  404: 'לא נמצא מסלול הליכה ליעד הזה.',
  422: 'היעד רחוק מדי להליכה (מעל 25 ק"מ), או שכבר נמצאים בו.'
};

export function routeErrorHtml(dest, status) {
  const msg = ROUTE_ERRORS[status] ?? 'לא הצלחנו לחשב מסלול כרגע. בדקו את החיבור ונסו שוב.';
  return `
    <p class="eyebrow">מסלול הליכה</p>
    <h2 class="stop-title">${escapeHtml(dest.name)}</h2>
    <div class="state-box" style="margin-top:14px"><span>${msg}</span></div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn-secondary" type="button" data-action="route-retry">לנסות שוב</button>
      <button class="btn-secondary" type="button" data-action="route-close">סגירה</button>
    </div>`;
}

export function routePreviewHtml(model, dest, { originIsUser }) {
  const c = model.crossings ?? { signalized: 0, marked: 0, waitSeconds: 0 };
  const pills = [
    `<span class="meta-pill"><strong>${formatNavDistance(model.distance)}</strong></span>`,
    c.signalized ? `<span class="meta-pill">🚦 ${c.signalized} רמזורים</span>` : '',
    c.marked ? `<span class="meta-pill">🚸 ${c.marked} מעברי חצייה</span>` : ''
  ].filter(Boolean);

  const waitMin = Math.round(c.waitSeconds / 60);
  const explain = [];
  if (model.analysis === 'full' && c.waitSeconds >= 30) {
    explain.push(`הזמן כולל כ-${waitMin > 0 ? `${waitMin} דק'` : 'חצי דקה'} המתנה צפויה ברמזורים ובמעברי חצייה.`);
  } else if (model.analysis !== 'full') {
    explain.push('זמני ההמתנה בחציות מוערכים (אין כרגע נתוני רמזורים מפורטים).');
  }
  if (model.chosenBecause === 'fewer_waits') {
    explain.push('בחרנו מסלול עם פחות המתנות, גם אם הוא מעט ארוך יותר.');
  }
  if (!originIsUser) {
    explain.push('<strong>אין מיקום GPS</strong> – המסלול מחושב ממרכז המפה.');
  }

  const steps = model.maneuvers
    .map(
      (m) => `
      <li class="step">
        <span class="step-icon">${maneuverIcon(m.type, 20)}</span>
        <span class="step-text">${escapeHtml(m.instruction)}</span>
        ${m.distance > 0 && m.type !== 4 ? `<span class="step-dist">${formatNavDistance(m.distance)}</span>` : ''}
      </li>`
    )
    .join('');

  return `
    <p class="eyebrow">מסלול הליכה ${dest.kind === 'stop' ? '<span class="chip">תחנת אוטובוס</span>' : ''}</p>
    <h2 class="stop-title">${escapeHtml(dest.name)}</h2>
    <div class="route-time">
      <span class="route-time-big">${formatDuration(model.realisticSeconds)}</span>
      <span class="route-time-eta">הגעה ב-${formatClock(model.realisticSeconds)}</span>
    </div>
    <div class="stop-meta">${pills.join('')}</div>
    ${explain.length ? `<p class="route-explain">${explain.join(' ')}</p>` : ''}
    <button class="btn-go" type="button" data-action="route-start">
      ${maneuverIcon(1, 22)} יציאה
    </button>
    <h3 class="section-title">הוראות הליכה</h3>
    <ul class="steps">${steps}</ul>`;
}

// ---------- ניווט ----------

export function bannerHtml(state, { rerouting = false } = {}) {
  if (rerouting) {
    return `
      <div class="nav-icon">${maneuverIcon(1, 30)}</div>
      <div class="nav-text">
        <div class="nav-dist">מחשב מחדש…</div>
        <div class="nav-instr">סטית מהמסלול, מחפשים דרך חדשה</div>
      </div>`;
  }
  const m = state.next;
  const isArrival = m.type === 4 || m.type === 5 || m.type === 6;
  return `
    <div class="nav-icon">${maneuverIcon(m.type, 34)}</div>
    <div class="nav-text">
      <div class="nav-dist">${isArrival ? `${formatNavDistance(state.remaining)} ליעד` : formatNavDistance(state.distToNext)}</div>
      <div class="nav-instr">${escapeHtml(m.instruction)}</div>
    </div>`;
}

export function navPanelHtml(state) {
  return `
    <div class="nav-panel">
      <div class="nav-summary">
        <div class="nav-remaining">${formatDuration(state.remainingSeconds)}</div>
        <div class="nav-sub">${formatNavDistance(state.remaining)} · הגעה ב-${formatClock(state.remainingSeconds)}</div>
      </div>
      <button class="btn-share-trip" type="button" data-action="share-trip" aria-label="שיתוף זמן ההגעה בוואטסאפ">${WHATSAPP_ICON}</button>
      <button class="btn-end" type="button" data-action="route-end">סיום</button>
    </div>`;
}

export function arrivedHtml(dest) {
  return `
    <div class="arrived">
      <div class="arrived-emoji">🎉</div>
      <h2 class="arrived-title">הגעת ליעד</h2>
      <p class="arrived-sub">${escapeHtml(dest.name)}</p>
      <button class="btn-go" type="button" data-action="route-end">סיום</button>
    </div>`;
}
