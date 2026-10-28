// שפת הממשק: עברית (ברירת מחדל), אנגלית, רוסית או אמהרית.
//
// הטקסט העברי עצמו הוא המפתח: t('הגדרות') -> "Settings" באנגלית, ו-"הגדרות" בעברית.
// כך הקוד נשאר קריא. אם חסר תרגום לרוסית / אמהרית – מוצג האנגלי, ואם גם הוא חסר – העברי (ולא מפתח ריק).
// משתנים: t('בעוד {n} דק\'', { n: 5 }).
//
// השפה נקבעת עוד לפני טעינת הקוד (סקריפט קטן ב-index.html, עברית, אלא אם נבחרה שפה אחרת בהגדרות),
// כדי שהכיוון (RTL/LTR) יהיה נכון מהפריים הראשון. החלפת שפה = טעינה מחדש של האפליקציה.

import { EN } from './i18n-en.js?v=1.10.0-mvseambo';
import { RU } from './i18n-ru.js?v=1.10.0-mvseambo';
import { AM } from './i18n-am.js?v=1.10.0-mvseambo';

export const SUPPORTED_LANGS = ['he', 'en', 'ru', 'am'];
export const LANG = SUPPORTED_LANGS.includes(document.documentElement.lang) ? document.documentElement.lang : 'he';
export const IS_EN = LANG === 'en';
/** כל שפה שאינה עברית (הטקסט העברי בקוד מתורגם) */
export const IS_FOREIGN = LANG !== 'he';

const LOCALES = { he: 'he-IL', en: 'en-GB', ru: 'ru-RU', am: 'am-ET' };
const DICT = LANG === 'ru' ? RU : LANG === 'am' ? AM : EN;

/** לתאריכים ושעות (toLocaleTimeString וכו') */
export const LOCALE = LOCALES[LANG];

/** מחזיר תרגום או undefined: שפה נוכחית, ואז אנגלית */
function lookup(he) {
  return DICT[he] ?? EN[he];
}

const missing = new Set();

export function t(he, vars = null) {
  let s = he;
  if (IS_FOREIGN) {
    const en = lookup(he);
    if (en !== undefined) s = en;
    else if (!missing.has(he)) {
      missing.add(he);
      console.debug('[i18n] missing:', he);
    }
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}

/** יחיד / רבים: tn(n, 'תחנה אחת', '{n} תחנות') */
export function tn(n, one, many, vars = {}) {
  return t(n === 1 ? one : many, { n, ...vars });
}

/** "דק'" -> "min" וכו': טקסט קצר של דקות */
export function minText(n) {
  return t('{n} דק\'', { n });
}

/**
 * תרגום הטקסטים הקבועים ב-HTML (index.html): צמתי טקסט ותכונות נגישות.
 * רץ פעם אחת בעלייה. טקסט שאין לו תרגום נשאר כמו שהוא.
 */
export function translateDom(root = document.body) {
  if (!IS_FOREIGN) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    if (text && lookup(text) !== undefined) node.nodeValue = node.nodeValue.replace(text, lookup(text));
  }
  for (const el of root.querySelectorAll('[aria-label], [placeholder], [title]')) {
    for (const attr of ['aria-label', 'placeholder', 'title']) {
      const v = el.getAttribute(attr);
      if (v && lookup(v) !== undefined) el.setAttribute(attr, lookup(v));
    }
  }
}

/** שמירת שפה חדשה וטעינה מחדש (הכיוון של כל הממשק משתנה) */
export function setLanguage(lang, save) {
  if (lang === LANG) return;
  save(lang);
  location.reload();
}
