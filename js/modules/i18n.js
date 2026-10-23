// שפת הממשק: עברית (ברירת מחדל) או אנגלית.
//
// הטקסט העברי עצמו הוא המפתח: t('הגדרות') -> "Settings" באנגלית, ו-"הגדרות" בעברית.
// כך הקוד נשאר קריא, ואם חסר תרגום מוצג הטקסט העברי (ולא מפתח ריק).
// משתנים: t('בעוד {n} דק\'', { n: 5 }).
//
// השפה נקבעת עוד לפני טעינת הקוד (סקריפט קטן ב-index.html, עברית, אלא אם נבחרה אנגלית בהגדרות),
// כדי שהכיוון (RTL/LTR) יהיה נכון מהפריים הראשון. החלפת שפה = טעינה מחדש של האפליקציה.

import { EN } from './i18n-en.js?v=1.5.0-mvksl4eo';

export const LANG = document.documentElement.lang === 'en' ? 'en' : 'he';
export const IS_EN = LANG === 'en';

/** לתאריכים ושעות (toLocaleTimeString וכו') */
export const LOCALE = IS_EN ? 'en-GB' : 'he-IL';

const missing = new Set();

export function t(he, vars = null) {
  let s = he;
  if (IS_EN) {
    const en = EN[he];
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
  if (!IS_EN) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    if (text && EN[text] !== undefined) node.nodeValue = node.nodeValue.replace(text, EN[text]);
  }
  for (const el of root.querySelectorAll('[aria-label], [placeholder], [title]')) {
    for (const attr of ['aria-label', 'placeholder', 'title']) {
      const v = el.getAttribute(attr);
      if (v && EN[v] !== undefined) el.setAttribute(attr, EN[v]);
    }
  }
}

/** שמירת שפה חדשה וטעינה מחדש (הכיוון של כל הממשק משתנה) */
export function setLanguage(lang, save) {
  if (lang === LANG) return;
  save(lang);
  location.reload();
}
