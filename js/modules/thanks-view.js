// לשונית "תודות": רשימת תודות (כותרת, הודעה, תמונה, קישור ולב) שהמנהל מנהל בדף הניהול (אוסף thanks).

import { t } from './i18n.js?v=1.9.2-mvprzu4a';
import { escapeHtml, showToast } from './ui.js?v=1.9.2-mvprzu4a';
import { isFirebaseConfigured, getFirebase } from '../firebase-config.js?v=1.9.2-mvprzu4a';

const CACHE_KEY = 'walkie:thanks-list';

const readCache = () => {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** רק קישורי http(s) – כדי שלא יהיה אפשר להכניס javascript: וכדומה */
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? '').trim()) ? String(u).trim() : '');
const safeImage = (u) => (/^(data:image\/(jpeg|png|webp);base64,|https:\/\/)/i.test(String(u ?? '')) ? String(u) : '');

export class ThanksView {
  constructor(root) {
    this.root = root;
    this.body = root.querySelector('#thanks-body');
    this.items = readCache();
    this.hearts = {}; // id → { count, mine }
    this.busy = new Set();
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-heart]');
      if (btn) this.#toggleHeart(btn.dataset.heart);
    });
  }

  show() {
    this.render();
    this.root.hidden = false;
    this.root.scrollTop = 0;
    this.#load();
  }

  hide() {
    this.root.hidden = true;
  }

  async #load() {
    if (!isFirebaseConfigured()) return;
    try {
      const { auth, firestore, modules } = await getFirebase();
      const { collection, getDocs, query, orderBy, doc, getDoc, where, getCountFromServer } = modules.firestore;
      const snap = await getDocs(query(collection(firestore, 'thanks'), orderBy('createdAt', 'desc')));
      this.items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.active !== false);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(this.items));
      } catch { /* אחסון מלא / חסום */ }
      if (!this.root.hidden) this.render();

      const uid = auth.currentUser?.uid;
      await Promise.all(this.items.map(async (x) => {
        const [total, mine] = await Promise.all([
          getCountFromServer(query(collection(firestore, 'thanksHearts'), where('t', '==', x.id))),
          uid ? getDoc(doc(firestore, 'thanksHearts', `${x.id}_${uid}`)) : null
        ]);
        this.hearts[x.id] = { count: total.data().count, mine: !!mine?.exists() };
      }));
      if (!this.root.hidden) this.render();
    } catch {
      /* אין רשת: נשארים עם מה שנשמר */
    }
  }

  async #toggleHeart(id) {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    const cur = this.hearts[id] ?? { count: 0, mine: false };
    const on = !cur.mine;
    const set = (mine, delta) => {
      const h = this.hearts[id] ?? { count: 0, mine: false };
      this.hearts[id] = { mine, count: Math.max(0, h.count + delta) };
      this.render();
    };
    set(on, on ? 1 : -1);
    try {
      const { auth, firestore, modules } = await getFirebase();
      const { doc, setDoc, deleteDoc, serverTimestamp } = modules.firestore;
      const ref = doc(firestore, 'thanksHearts', `${id}_${auth.currentUser.uid}`);
      if (on) await setDoc(ref, { t: id, at: serverTimestamp() });
      else await deleteDoc(ref);
    } catch {
      set(!on, on ? -1 : 1);
      showToast(t('לא הצלחנו לשמור את הלב, נסו שוב'));
    } finally {
      this.busy.delete(id);
    }
  }

  render() {
    if (!this.items.length) {
      this.body.innerHTML = `
        <div class="thanks-empty">
          <span class="thanks-empty-ic">💚</span>
          <p>${t('עוד אין כאן תודות. חזרו לכאן בקרוב!')}</p>
        </div>`;
      return;
    }
    this.body.innerHTML = this.items.map((d) => this.#cardHtml(d)).join('');
  }

  #cardHtml(d) {
    const image = safeImage(d.image);
    const link = safeUrl(d.linkUrl);
    const h = this.hearts[d.id] ?? { count: 0, mine: false };
    const shown = Math.max(0, (d.heartsBase || 0) + h.count);
    return `
      <article class="thanks-card">
        ${image ? `<img class="thanks-img" src="${escapeHtml(image)}" alt="" loading="lazy">` : ''}
        <div class="thanks-text">
          ${d.title ? `<h2 class="thanks-title">${escapeHtml(d.title)}</h2>` : ''}
          ${d.message ? `<p class="thanks-msg">${escapeHtml(d.message)}</p>` : ''}
          <button class="thanks-heart${h.mine ? ' is-on' : ''}" type="button" data-heart="${escapeHtml(d.id)}" aria-pressed="${h.mine}" aria-label="${t('לב')}">
            <span class="thanks-heart-ic">${h.mine ? '❤️' : '🤍'}</span>
            <strong>${shown}</strong>
          </button>
          ${link ? `<a class="btn thanks-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.linkLabel || t('לפרטים נוספים'))}</a>` : ''}
        </div>
      </article>`;
  }
}
