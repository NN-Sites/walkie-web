// מפתחות בטוחים לשדות במסמכי אנליטיקה ולמזהי קווים. משותף לאפליקציה ולדף הניהול,
// כי דף הניהול צריך לחשב את אותו מפתח קו כמו האפליקציה (הודעה לקו מסוים).

const MAX_KEY = 40;

/** אותיות קטנות באנגלית, ספרות, עברית וקו תחתון. כל השאר הופך לקו תחתון */
export function safeKey(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9_\u0590-\u05ff]+/g, '_').replace(/^_+|_+$/g, '').slice(0, MAX_KEY) || 'x';
}

/** מפתח קו, בלי כיוון: אותו קו בשני הכיוונים נספר יחד */
export function lineKeyOf({ mode = 'bus', line, agency = '' }) {
  return safeKey(`${mode}_${line}_${agency}`);
}
