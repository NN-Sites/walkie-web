// גיאומטריה + מעקב GPS חסכוני בסוללה.

import {
  MIN_MOVE_METERS,
  HEADING_MIN_MOVE_METERS,
  WALK_SPEED_MPS,
  DETOUR_FACTOR
} from '../config.js?v=1.5.0-mvkr2mw5';
import { t } from './i18n.js?v=1.5.0-mvkr2mw5';

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

export function distanceMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function bearingDeg(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function offsetMeters(origin, northM, eastM) {
  return {
    lat: origin.lat + northM / 111320,
    lng: origin.lng + eastM / (111320 * Math.cos(toRad(origin.lat)))
  };
}

// הערכת זמן הליכה עד שיהיה ניתוב אמיתי (שלב 3)
export function walkMinutes(straightLineMeters) {
  const seconds = (straightLineMeters * DETOUR_FACTOR) / WALK_SPEED_MPS;
  return Math.max(1, Math.round(seconds / 60));
}

export function formatDistance(meters) {
  if (meters < 1000) return t('{n} מ\'', { n: Math.round(meters / 10) * 10 });
  return t('{n} ק"מ', { n: (meters / 1000).toFixed(1) });
}

/**
 * עוטף את navigator.geolocation.watchPosition:
 *  - עוצר את ה-GPS כשהאפליקציה ברקע (visibilitychange) וחוזר כשחוזרים אליה
 *  - מסנן רעש של תזוזות זעירות כדי לחסוך רינדורים
 *  - משלים כיוון הליכה (heading) מחישוב בין נקודות כשהמכשיר לא מספק אותו
 */
export class LocationTracker {
  #watchId = null;
  #last = null;
  #lastForHeading = null;
  #running = false;

  constructor({ onUpdate, onError }) {
    this.onUpdate = onUpdate;
    this.onError = onError;
  }

  start() {
    if (!('geolocation' in navigator)) {
      this.onError?.({ code: 'unsupported', message: 'Geolocation not supported' });
      return;
    }
    if (this.#running) return;
    this.#running = true;
    document.addEventListener('visibilitychange', this.#onVisibility);
    if (document.visibilityState === 'visible') this.#watch();
  }

  stop() {
    this.#running = false;
    document.removeEventListener('visibilitychange', this.#onVisibility);
    this.#clear();
  }

  restart() {
    this.stop();
    this.start();
  }

  get lastPosition() {
    return this.#last;
  }

  #watch() {
    if (this.#watchId !== null) return;
    this.#watchId = navigator.geolocation.watchPosition(this.#onPosition, this.#onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000
    });
  }

  #clear() {
    if (this.#watchId !== null) {
      navigator.geolocation.clearWatch(this.#watchId);
      this.#watchId = null;
    }
  }

  #onVisibility = () => {
    if (!this.#running) return;
    if (document.visibilityState === 'visible') this.#watch();
    else this.#clear();
  };

  #onPosition = (pos) => {
    const { latitude, longitude, accuracy, heading, speed } = pos.coords;
    const next = {
      lat: latitude,
      lng: longitude,
      accuracy: accuracy ?? 50,
      speed: Number.isFinite(speed) ? speed : null,
      heading: Number.isFinite(heading) ? heading : null,
      ts: pos.timestamp
    };

    // כיוון מחושב מתזוזה, אם המכשיר לא נותן כזה
    if (next.heading === null) {
      if (!this.#lastForHeading) {
        this.#lastForHeading = next;
      } else if (distanceMeters(this.#lastForHeading, next) >= HEADING_MIN_MOVE_METERS) {
        next.heading = bearingDeg(this.#lastForHeading, next);
        this.#lastForHeading = next;
      } else if (this.#last) {
        next.heading = this.#last.heading;
      }
    } else {
      this.#lastForHeading = next;
    }

    // סינון רעש: תזוזה קטנה שלא שיפרה דיוק – לא מעדכנים
    if (this.#last) {
      const moved = distanceMeters(this.#last, next);
      const betterAccuracy = next.accuracy < this.#last.accuracy * 0.7;
      if (moved < MIN_MOVE_METERS && !betterAccuracy) return;
    }

    this.#last = next;
    this.onUpdate?.(next);
  };

  #onPositionError = (err) => {
    // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
    if (err.code === 1) this.#clear();
    this.onError?.({ code: err.code, message: err.message });
  };
}
