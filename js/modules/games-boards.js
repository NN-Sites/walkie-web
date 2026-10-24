// משחקים: ציור הלוחות (HTML). פונקציות טהורות מ-view (ראו games-room.js) למחרוזת.
// המסך (games-view.js) מחבר את הלחיצות לפי data-cell / data-col / data-pick / data-react.

import { C4_COLS, C4_ROWS, FALSE_START, REACT_MISS_MS } from './games-logic.js?v=1.6.0-mvn1g0s1';
import { escapeHtml } from './ui.js?v=1.6.0-mvn1g0s1';
import { t } from './i18n.js?v=1.6.0-mvn1g0s1';

const HAND = { r: '✊', p: '✋', s: '✌️' };
const HAND_NAME = { r: 'אבן', p: 'נייר', s: 'מספריים' };
const BEATS = { r: 's', s: 'p', p: 'r' };

const canMove = (v) => !v.over && v.waitingOn.includes(v.me);

/** טקסט המצב מעל הלוח (טקסט רגיל, בלי HTML) */
export function statusText(v) {
  if (v.over) return '';
  const opp = v.names[1 - v.me];
  const mine = v.waitingOn.includes(v.me);
  if (v.game === 'xo' || v.game === 'c4') return mine ? t('התור שלך') : t('התור של {name}…', { name: opp });
  if (v.game === 'rps') return mine ? t('בחרו!') : t('ממתינים ל-{name}…', { name: opp });
  return '';
}

// ---------- איקס עיגול ----------

export function xoHtml(v) {
  const s = v.state;
  const can = canMove(v);
  const cells = [...s.board].map((c, i) => {
    const win = s.line.includes(i) ? ' is-win' : '';
    const mark = c === 'x' ? '✕' : c === 'o' ? '◯' : '';
    const free = c === '-' && can;
    return `<button class="gm-cell${c === '-' ? '' : ` is-${c}`}${win}" type="button" data-cell="${i}" ${free ? '' : 'disabled'} aria-label="${t('משבצת {n}', { n: i + 1 })}">${mark}</button>`;
  });
  return `<div class="gm-xo" role="grid">${cells.join('')}</div>`;
}

// ---------- ארבע בשורה ----------

export function c4Html(v) {
  const s = v.state;
  const can = canMove(v);
  const cols = [];
  for (let c = 0; c < C4_COLS; c++) {
    const discs = [];
    for (let r = 0; r < C4_ROWS; r++) {
      const idx = r * C4_COLS + c;
      const ch = s.board[idx];
      const cls = ch === 'x' ? ' p0' : ch === 'o' ? ' p1' : '';
      discs.push(`<span class="gm-disc${cls}${idx === s.last ? ' is-last' : ''}${s.line.includes(idx) ? ' is-win' : ''}"></span>`);
    }
    const open = can && s.board[c] === '-';
    cols.push(`<button class="gm-col" type="button" data-col="${c}" ${open ? '' : 'disabled'} aria-label="${t('עמודה {n}', { n: c + 1 })}">${discs.join('')}</button>`);
  }
  return `<div class="gm-c4">${cols.join('')}</div>`;
}

// ---------- אבן נייר ומספריים ----------

function rpsOutcome(round, me) {
  const mine = round[me];
  const theirs = round[1 - me];
  if (mine === theirs) return t('תיקו');
  return BEATS[mine] === theirs ? t('ניצחתם בסיבוב') : t('הפסדתם בסיבוב');
}

export function rpsHtml(v) {
  const s = v.state;
  const me = v.me;
  const picked = s.picks[me];
  const can = !v.over && picked === '';
  const last = s.hist.at(-1);
  const reveal = last
    ? `<div class="gm-reveal" aria-live="polite">
         <span class="gm-hand">${HAND[last[me]]}</span>
         <span class="gm-reveal-text">${escapeHtml(rpsOutcome(last, me))}</span>
         <span class="gm-hand">${HAND[last[1 - me]]}</span>
       </div>`
    : `<div class="gm-reveal"><span class="gm-reveal-text">${t('הראשון לשני ניצחונות')}</span></div>`;
  const picks = Object.keys(HAND).map((k) => `
    <button class="gm-pick${picked === k ? ' is-picked' : ''}" type="button" data-pick="${k}" ${can ? '' : 'disabled'}>
      <span>${HAND[k]}</span><small>${t(HAND_NAME[k])}</small>
    </button>`).join('');
  return `${reveal}<div class="gm-rps">${picks}</div>`;
}

// ---------- מי מהיר יותר? ----------

const ms = (n) => (n >= FALSE_START ? t('מוקדם מדי') : n >= REACT_MISS_MS ? t('איחרתם') : `${n} ms`);

/** מה הלוח כותב לכל שלב. rx = { phase: 'ready' | 'wait' | 'go' | 'sent', mine } */
export function padContent(v, rx) {
  const s = v.state;
  if (v.over) return { cls: 'is-done', text: '' };
  switch (rx?.phase) {
    case 'wait': return { cls: 'is-wait', text: t('חכו…') };
    case 'go': return { cls: 'is-go', text: t('לחצו!') };
    case 'sent': return { cls: 'is-sent', text: escapeHtml(`${ms(rx.mine ?? 0)} · ${t('ממתינים ל-{name}…', { name: v.names[1 - v.me] })}`) };
    default: {
      const last = s.hist.at(-1);
      let prev = '';
      if (last) {
        const [a, b] = last.split(':').map(Number);
        const [mine, theirs] = v.me === 0 ? [a, b] : [b, a];
        const verdict = mine === theirs ? t('סיבוב בטל') : mine < theirs ? t('ניצחתם בסיבוב') : t('הפסדתם בסיבוב');
        prev = `${verdict}<br><small>${t('אתם')} ${ms(mine)} · ${escapeHtml(v.names[1 - v.me])} ${ms(theirs)}</small>`;
      }
      return { cls: 'is-ready', text: prev ? `${prev}<br>${t('היו מוכנים…')}` : t('היו מוכנים…') };
    }
  }
}

export function reactHtml(v, rx) {
  const { cls, text } = padContent(v, rx);
  return `<button class="gm-pad ${cls}" type="button" data-react ${v.over ? 'disabled' : ''}><span>${text}</span></button>
          <p class="gm-hint">${t('לוחצים רק כשהמסך ירוק – לחיצה מוקדמת מפסידה את הסיבוב')}</p>`;
}

export function boardHtml(v, rx) {
  switch (v.game) {
    case 'xo': return xoHtml(v);
    case 'c4': return c4Html(v);
    case 'rps': return rpsHtml(v);
    default: return reactHtml(v, rx);
  }
}

/** תוצאת הסדרה במשחקים של כמה סיבובים: "1 : 0" מנקודת המבט שלי. null במשחקים של סיבוב אחד */
export function seriesScore(v) {
  const s = v.state;
  return Array.isArray(s.score) ? [s.score[v.me], s.score[1 - v.me]] : null;
}
