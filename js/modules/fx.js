// אנימציות קטנות: קונפטי לרגעי תודה, וכניסה מדורגת של רשימות.
// הכל מכבד את "הפחתת תנועה" של מערכת ההפעלה.

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const COLORS = ['#0d9488', '#14b8a6', '#f97316', '#fbbf24', '#2563eb', '#16a34a'];

/** קונפטי שמתפוצץ מהאלמנט (או ממרכז המסך) */
export function celebrate(from = null, count = 36) {
  if (reduced()) return;
  const r = from?.getBoundingClientRect?.();
  const x = r ? r.left + r.width / 2 : innerWidth / 2;
  const y = r ? r.top + r.height / 2 : innerHeight / 3;

  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  document.body.appendChild(layer);

  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const dist = 70 + Math.random() * 110;
    p.className = 'fx-confetti';
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = COLORS[i % COLORS.length];
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist - 60}px`);
    p.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
    p.style.animationDelay = `${Math.random() * 60}ms`;
    layer.appendChild(p);
  }
  setTimeout(() => layer.remove(), 1400);
}

/** כניסה מדורגת לילדים של container (רשימות, כרטיסים) */
export function stagger(container, selector = ':scope > *', step = 35, max = 12) {
  if (!container || reduced()) return;
  [...container.querySelectorAll(selector)].slice(0, max).forEach((el, i) => {
    el.style.setProperty('--fx-delay', `${i * step}ms`);
    el.classList.remove('fx-in');
    void el.offsetWidth; // מאתחל את האנימציה
    el.classList.add('fx-in');
  });
}
