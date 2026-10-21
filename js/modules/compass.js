// מצפן דינמי: כיוון המכשיר ביחס לצפון.
// Android/Chrome: deviceorientationabsolute (alpha). iOS/Safari: webkitCompassHeading (דורש אישור מהמשתמש).
// כולל החלקה (Low-pass מעגלי) ועדכון פעם בפריים לכל היותר – חסכוני ולא "רועד".

const SMOOTHING = 0.22;      // 0 = קפוא, 1 = בלי החלקה
const LIVE_WINDOW_MS = 2500;

function normalize(deg) {
  return ((deg % 360) + 360) % 360;
}

function screenAngle() {
  const a = screen.orientation?.angle ?? window.orientation ?? 0;
  return Number.isFinite(a) ? a : 0;
}

export class HeadingSource {
  constructor(onHeading) {
    this.onHeading = onHeading;
    this.value = null;
    this.lastEventAt = 0;
    this.listening = false;
    this.rafId = 0;
    this.eventName = null;
  }

  /** האם יש קריאות מצפן טריות */
  get isLive() {
    return this.value !== null && Date.now() - this.lastEventAt < LIVE_WINDOW_MS;
  }

  /**
   * חייב להיקרא מתוך לחיצה של המשתמש (iOS דורש אישור).
   * מחזיר true אם המצפן הופעל.
   */
  async start() {
    if (this.listening) return true;
    if (typeof window.DeviceOrientationEvent === 'undefined') return false;

    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        if (result !== 'granted') return false;
      } catch {
        return false;
      }
    }

    this.eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(this.eventName, this.#onEvent);
    this.listening = true;
    return true;
  }

  stop() {
    if (this.listening && this.eventName) window.removeEventListener(this.eventName, this.#onEvent);
    this.listening = false;
    this.value = null;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  #onEvent = (e) => {
    let raw = null;
    if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
      raw = e.webkitCompassHeading; // iOS: כבר ביחס לצפון, עם כיוון השעון
    } else if (e.absolute === true || this.eventName === 'deviceorientationabsolute') {
      if (e.alpha === null || e.alpha === undefined) return;
      raw = 360 - e.alpha; // alpha נגד כיוון השעון -> heading עם כיוון השעון
    } else {
      return; // alpha יחסי (לא מצפן אמיתי) – לא שמיש
    }

    const heading = normalize(raw + screenAngle());

    if (this.value === null) {
      this.value = heading;
    } else {
      const delta = ((heading - this.value + 540) % 360) - 180; // הדרך הקצרה סביב 0/360
      this.value = normalize(this.value + delta * SMOOTHING);
    }
    this.lastEventAt = Date.now();

    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        if (this.value !== null) this.onHeading(this.value);
      });
    }
  };
}
