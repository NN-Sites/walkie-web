// ה-API של Walkie שרץ בתוך האפליקציה עצמה (Capacitor) – בלי שרת.
// אותו קוד של functions/lib (מועתק ל-www/js/server/ ע"י scripts/build-mobile.mjs),
// עם קאש ב-IndexedDB במקום בדיסק. קריאות לשירותים החיצוניים עוברות ב-fetch הנייטיבי
// של Capacitor (CapacitorHttp), כך שאין מגבלות CORS.

import { createApi } from './server/api.js?v=1.4.1-mvjqgjx7';
import { StopsIndex } from './server/stops-index.js?v=1.4.1-mvjqgjx7';
import { ArrivalsService } from './server/arrivals.js?v=1.4.1-mvjqgjx7';
import { WalkRouter } from './server/walk-router.js?v=1.4.1-mvjqgjx7';
import { Geocoder } from './server/geocoder.js?v=1.4.1-mvjqgjx7';
import { TransitPlanner } from './server/transit-planner.js?v=1.4.1-mvjqgjx7';
import { EducationIndex } from './server/education-index.js?v=1.4.1-mvjqgjx7';
import { StationsService } from './server/stations.js?v=1.4.1-mvjqgjx7';
import { LinesService } from './server/lines.js?v=1.4.1-mvjqgjx7';

const DB_NAME = 'walkie-cache';
const STORE = 'kv';

// עותקים שנארזו עם האפליקציה – כדי שהפתיחה הראשונה תעבוד מיד, גם בלי לחכות להורדת כל התחנות
const BUNDLED = { stops: 'data/stops.json', education: 'data/education.json' };

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function createIdbCache(log) {
  const dbPromise = openDb().catch((err) => {
    log.warn(`[cache] IndexedDB unavailable: ${err?.message}`);
    return null;
  });

  const run = async (mode, fn) => {
    const db = await dbPromise;
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  };

  return {
    async read(key) {
      const value = await run('readonly', (s) => s.get(key)).catch(() => null);
      if (value || !BUNDLED[key]) return value;
      try {
        const res = await fetch(BUNDLED[key]);
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    },
    async write(key, value) {
      await run('readwrite', (s) => s.put(value, key)).catch((err) => log.warn(`[cache] write ${key} failed: ${err?.message}`));
    }
  };
}

const log = {
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a)
};

const cache = createIdbCache(log);
const stopsIndex = new StopsIndex({ cache, log });
const arrivalsService = new ArrivalsService({ ttlMs: 20000 });
const walkRouter = new WalkRouter({ log });
const educationIndex = new EducationIndex({ cache, log });
const geocoder = new Geocoder({ stopsIndex, educationIndex, log });
const transitPlanner = new TransitPlanner({ arrivalsService, walkRouter, log });
const stations = new StationsService({ arrivalsService, log });
transitPlanner.stations = stations; // חלופות רכבת בתכנון מסלול
const lines = new LinesService({ stopsIndex, stations, log });
const handleApi = createApi({ stopsIndex, arrivalsService, walkRouter, geocoder, transitPlanner, stations, lines, log });

// טעינת אינדקס התחנות מיד בפתיחה, לפני הבקשה הראשונה
stopsIndex.ensureLoaded().catch((err) => log.warn(`[stops] preload failed: ${err.message}`));

/** path = '/stops/nearby?...' (בלי /api). מחזיר { status, body } כמו השרת */
export async function request(path) {
  const result = await handleApi('GET', `/api${path}`);
  return { status: result.status, body: JSON.parse(result.body) };
}
