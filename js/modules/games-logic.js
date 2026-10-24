// משחקי ההמתנה לאוטובוס: חוקי המשחקים, ניקוד ותאריכים. פונקציות טהורות – בלי DOM ובלי רשת.
//
// אותו קוד רץ אצל שני השחקנים ואצל הרובוט, ולכן כולם תמיד מגיעים לאותה תוצאה מאותו מצב.
// מצב משחק (state) נשמר ב-Firestore, ולכן הוא שטוח: מספרים, מחרוזות ומערכים פשוטים (בלי מערך בתוך מערך).
//
// כל משחק מגדיר:
//   init(rng)                 -> מצב התחלתי
//   apply(state, move, pi, rng) -> מצב חדש, או null אם המהלך לא חוקי (לא התור שלך, תא תפוס...)
//   waitingOn(state)          -> אילו שחקנים (0 / 1) צריכים לפעול עכשיו
//   botPlan(state, pi, rng)   -> { move, afterMs } של הרובוט, או null אם אין לו מה לעשות

export const ONGOING = -1;   // state.winner: המשחק נמשך
export const DRAW = 2;       // state.winner: תיקו (אחרת 0 / 1 = אינדקס המנצח)

export const FALSE_START = 9999;  // "מי מהיר יותר": לחץ לפני הזמן
export const REACT_MISS_MS = 2500; // "מי מהיר יותר": לא לחץ בזמן
export const readyMs = (round) => (round === 1 ? 1500 : 2300); // הכנה לפני כל סיבוב (בסיבוב הבא רואים קודם את התוצאה)

/** נקודות על משחק. מול אדם: ניצחון / תיקו / הפסד; יריב שעזב או נעלם: ניצחון קטן; מול רובוט: מעט, ועם תקרה יומית */
export const POINTS = { win: 10, draw: 4, loss: 2, forfeitWin: 6, botWin: 3, botDraw: 1, botLoss: 0, botDailyCap: 12 };

/** פרס יומי לפי היום ברצף (מחזור של 7 ימים; היום השביעי הוא הפרס הגדול) */
export const DAILY_REWARDS = [10, 15, 20, 25, 30, 40, 75];

export const rewardForStreak = (streak) => DAILY_REWARDS[(Math.max(1, streak) - 1) % DAILY_REWARDS.length];

// ---------- תאריכים (לפי שעון ישראל, כדי שה"יום" יתחלף בחצות המקומית) ----------

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });

/** '2026-10-25' */
export const dayKey = (ms = Date.now()) => dayFmt.format(ms);

const dayNumber = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

/** כמה ימים עברו בין שני תאריכים (b אחרי a = חיובי) */
export const dayDiff = (a, b) => Math.round(dayNumber(b) - dayNumber(a));

/** תחילת השבוע (יום ראשון) של התאריך – מזהה את לוח המובילים השבועי */
export function weekKeyOf(ms = Date.now()) {
  const n = dayNumber(dayKey(ms));
  const sunday = n - new Date(n * 86400000).getUTCDay();
  return new Date(sunday * 86400000).toISOString().slice(0, 10);
}

// ---------- איקס עיגול ----------

const XO_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

function xoResult(board) {
  for (const [a, b, c] of XO_LINES) {
    if (board[a] !== '-' && board[a] === board[b] && board[b] === board[c]) return board[a];
  }
  return board.includes('-') ? '' : 'd';
}

function xoScore(board, mark, bot) {
  const r = xoResult(board);
  if (r === bot) return 1;
  if (r === 'd') return 0;
  if (r) return -1;
  const next = mark === 'x' ? 'o' : 'x';
  const scores = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] === '-') scores.push(xoScore(board.slice(0, i) + mark + board.slice(i + 1), next, bot));
  }
  return mark === bot ? Math.max(...scores) : Math.min(...scores);
}

const xo = {
  init: (rng) => ({ board: '---------', turn: rng() < 0.5 ? 0 : 1, winner: ONGOING, line: [] }),

  apply(s, m, pi) {
    const cell = m?.cell;
    if (s.winner !== ONGOING || s.turn !== pi || !Number.isInteger(cell) || cell < 0 || cell > 8 || s.board[cell] !== '-') return null;
    const mark = pi === 0 ? 'x' : 'o';
    const board = s.board.slice(0, cell) + mark + s.board.slice(cell + 1);
    const r = xoResult(board);
    if (r === 'd') return { board, turn: 1 - pi, winner: DRAW, line: [] };
    if (r) return { board, turn: 1 - pi, winner: pi, line: XO_LINES.find((l) => l.every((i) => board[i] === mark)) };
    return { board, turn: 1 - pi, winner: ONGOING, line: [] };
  },

  waitingOn: (s) => (s.winner === ONGOING ? [s.turn] : []),

  botPlan(s, pi, rng) {
    if (s.winner !== ONGOING || s.turn !== pi) return null;
    const empty = [...s.board].map((c, i) => (c === '-' ? i : -1)).filter((i) => i >= 0);
    let cell;
    if (empty.length === 9) {
      cell = [0, 2, 4, 6, 8][Math.floor(rng() * 5)];
    } else if (rng() < 0.22) {
      cell = empty[Math.floor(rng() * empty.length)]; // טעות מכוונת: אפשר לנצח
    } else {
      const mark = pi === 0 ? 'x' : 'o';
      const next = mark === 'x' ? 'o' : 'x';
      const scored = empty.map((i) => ({ i, v: xoScore(s.board.slice(0, i) + mark + s.board.slice(i + 1), next, mark) }));
      const best = Math.max(...scored.map((x) => x.v));
      const top = scored.filter((x) => x.v === best);
      cell = top[Math.floor(rng() * top.length)].i;
    }
    return { move: { cell }, afterMs: 600 + rng() * 800 };
  }
};

// ---------- ארבע בשורה ----------

export const C4_COLS = 7;
export const C4_ROWS = 6;

function c4Drop(board, col, mark) {
  for (let r = C4_ROWS - 1; r >= 0; r--) {
    const idx = r * C4_COLS + col;
    if (board[idx] === '-') return { board: board.slice(0, idx) + mark + board.slice(idx + 1), idx };
  }
  return null;
}

/** ארבעת התאים של הרביעייה שנסגרה בתא idx, או null */
function c4Line(board, idx, mark) {
  const r0 = Math.floor(idx / C4_COLS);
  const c0 = idx % C4_COLS;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [idx];
    for (const dir of [1, -1]) {
      for (let k = 1; k < 4; k++) {
        const r = r0 + dr * dir * k;
        const c = c0 + dc * dir * k;
        if (r < 0 || r >= C4_ROWS || c < 0 || c >= C4_COLS || board[r * C4_COLS + c] !== mark) break;
        cells.push(r * C4_COLS + c);
      }
    }
    if (cells.length >= 4) return cells.slice(0, 4).sort((a, b) => a - b);
  }
  return null;
}

const c4 = {
  init: (rng) => ({ board: '-'.repeat(C4_ROWS * C4_COLS), turn: rng() < 0.5 ? 0 : 1, winner: ONGOING, line: [], last: -1 }),

  apply(s, m, pi) {
    const col = m?.col;
    if (s.winner !== ONGOING || s.turn !== pi || !Number.isInteger(col) || col < 0 || col >= C4_COLS) return null;
    const mark = pi === 0 ? 'x' : 'o';
    const drop = c4Drop(s.board, col, mark);
    if (!drop) return null;
    const line = c4Line(drop.board, drop.idx, mark);
    if (line) return { board: drop.board, turn: 1 - pi, winner: pi, line, last: drop.idx };
    if (!drop.board.includes('-')) return { board: drop.board, turn: 1 - pi, winner: DRAW, line: [], last: drop.idx };
    return { board: drop.board, turn: 1 - pi, winner: ONGOING, line: [], last: drop.idx };
  },

  waitingOn: (s) => (s.winner === ONGOING ? [s.turn] : []),

  botPlan(s, pi, rng) {
    if (s.winner !== ONGOING || s.turn !== pi) return null;
    const mark = pi === 0 ? 'x' : 'o';
    const opp = mark === 'x' ? 'o' : 'x';
    const cols = [...Array(C4_COLS).keys()].filter((c) => s.board[c] === '-');
    const wins = (c, who) => {
      const d = c4Drop(s.board, c, who);
      return d && c4Line(d.board, d.idx, who);
    };
    let pick = null;
    const careless = rng() < 0.12; // לפעמים מפספס ניצחון / חסימה
    if (!careless) pick = cols.find((c) => wins(c, mark)) ?? cols.find((c) => wins(c, opp)) ?? null;
    if (pick === null) {
      // לא להניח דיסק שנותן ליריב ניצחון מיד מעליו
      const safe = cols.filter((c) => {
        const mine = c4Drop(s.board, c, mark);
        if (!mine) return false;
        const above = c4Drop(mine.board, c, opp);
        return !(above && c4Line(above.board, above.idx, opp));
      });
      const pool = safe.length ? safe : cols;
      const weights = pool.map((c) => ([1, 2, 3, 4, 3, 2, 1][c]) ** 2 * (0.6 + rng() * 0.8));
      let r = rng() * weights.reduce((a, b) => a + b, 0);
      pick = pool[pool.length - 1];
      for (let i = 0; i < pool.length; i++) {
        r -= weights[i];
        if (r <= 0) { pick = pool[i]; break; }
      }
    }
    return { move: { col: pick }, afterMs: 700 + rng() * 900 };
  }
};

// ---------- אבן נייר ומספריים ----------

const RPS_BEATS = { r: 's', s: 'p', p: 'r' };
const RPS_MAX_ROUNDS = 5;

/** ניצחון בסדרה: ראשון ל-2, או ניקוד גבוה אחרי 5 סיבובים */
function seriesWinner(score, rounds) {
  if (score[0] >= 2) return 0;
  if (score[1] >= 2) return 1;
  if (rounds >= RPS_MAX_ROUNDS) return score[0] === score[1] ? DRAW : score[0] > score[1] ? 0 : 1;
  return ONGOING;
}

const rps = {
  init: () => ({ round: 1, score: [0, 0], picks: ['', ''], hist: [], winner: ONGOING }),

  apply(s, m, pi) {
    const pick = m?.pick;
    if (s.winner !== ONGOING || !(pick in RPS_BEATS) || s.picks[pi] !== '') return null;
    const picks = [...s.picks];
    picks[pi] = pick;
    if (!picks[0] || !picks[1]) return { ...s, picks };
    // שני השחקנים בחרו: מכריעים את הסיבוב
    const score = [...s.score];
    if (RPS_BEATS[picks[0]] === picks[1]) score[0]++;
    else if (RPS_BEATS[picks[1]] === picks[0]) score[1]++;
    const hist = [...s.hist, picks[0] + picks[1]];
    return { round: s.round + 1, score, picks: ['', ''], hist, winner: seriesWinner(score, hist.length) };
  },

  waitingOn: (s) => (s.winner === ONGOING ? [0, 1].filter((i) => s.picks[i] === '') : []),

  botPlan(s, pi, rng) {
    if (s.winner !== ONGOING || s.picks[pi] !== '') return null;
    return { move: { pick: 'rps'[Math.floor(rng() * 3)] }, afterMs: 800 + rng() * 1200 };
  }
};

// ---------- מי מהיר יותר? ----------

const randomDelay = (rng) => Math.round(1500 + rng() * 3000);

const react = {
  init: (rng) => ({ round: 1, score: [0, 0], t: [-1, -1], delay: randomDelay(rng), hist: [], winner: ONGOING }),

  apply(s, m, pi, rng = Math.random) {
    const ms = Math.round(m?.ms);
    if (s.winner !== ONGOING || !(ms >= 0 && ms <= FALSE_START) || s.t[pi] !== -1) return null;
    const t = [...s.t];
    t[pi] = ms;
    if (t[0] === -1 || t[1] === -1) return { ...s, t };
    // שניהם דיווחו: הנמוך מנצח. שוויון (למשל שני לחיצות מוקדמות) = סיבוב חוזר בלי ניקוד
    const score = [...s.score];
    if (t[0] < t[1]) score[0]++;
    else if (t[1] < t[0]) score[1]++;
    const hist = [...s.hist, `${t[0]}:${t[1]}`];
    return { round: s.round + 1, score, t: [-1, -1], delay: randomDelay(rng), hist, winner: seriesWinner(score, hist.length) };
  },

  waitingOn: (s) => (s.winner === ONGOING ? [0, 1].filter((i) => s.t[i] === -1) : []),

  botPlan(s, pi, rng) {
    if (s.winner !== ONGOING || s.t[pi] !== -1) return null;
    const ms = rng() < 0.06 ? FALSE_START : Math.round(260 + rng() * 260);
    // כמו השחקן: הכנה, המתנה, ואז זמן התגובה (לחיצה מוקדמת = מיד בתחילת ההמתנה)
    const wait = ms === FALSE_START ? s.delay * rng() : s.delay + ms;
    return { move: { ms }, afterMs: readyMs(s.round) + wait };
  }
};

/** פרטי המשחקים להצגה. הסדר = הסדר ברשימה */
export const GAMES = {
  xo: {
    id: 'xo', emoji: '⭕', logic: xo,
    name: 'איקס עיגול', blurb: 'שלוש בשורה לפני היריב', rules: 'מניחים בתורות X או O. הראשון שמשלים שלוש בשורה – מנצח.', minutes: 1
  },
  c4: {
    id: 'c4', emoji: '🔴', logic: c4,
    name: 'ארבע בשורה', blurb: 'מפילים דיסקיות, מחברים ארבע', rules: 'בתורות מפילים דיסקית לעמודה. הראשון שמחבר ארבע בשורה – מנצח.', minutes: 3
  },
  rps: {
    id: 'rps', emoji: '✌️', logic: rps,
    name: 'אבן נייר ומספריים', blurb: 'הראשון לשני ניצחונות', rules: 'שניכם בוחרים באותו זמן. הראשון שמנצח בשני סיבובים – מנצח.', minutes: 1
  },
  react: {
    id: 'react', emoji: '⚡', logic: react,
    name: 'מי מהיר יותר?', blurb: 'לוחצים ברגע שהמסך הופך לירוק', rules: 'מחכים שהמסך יהפוך לירוק ולוחצים הכי מהר. לחיצה מוקדמת = הפסד בסיבוב. הראשון לשני סיבובים – מנצח.', minutes: 1
  }
};

export const GAME_IDS = Object.keys(GAMES);

// ---------- תוצאה ----------

/**
 * התוצאה מנקודת המבט של שחקן me (0 / 1):
 * 'win' | 'loss' | 'draw' | 'forfeitWin' (היריב עזב / לא הגיב) | 'quit' (אני עזבתי) | null (המשחק נמשך)
 * end = { winner, reason: 'left' | 'timeout', by } – סיום מחוץ לכללי המשחק
 */
export function resultFor(state, end, me) {
  if (end) {
    if (end.reason === 'left' && end.by === me) return 'quit';
    return end.winner === me ? 'forfeitWin' : 'loss';
  }
  if (!state || state.winner === ONGOING) return null;
  if (state.winner === DRAW) return 'draw';
  return state.winner === me ? 'win' : 'loss';
}
