// הגדרות גלובליות של Walkie – מקום אחד לכל המספרים הקסומים.

// לעדכן יחד עם versionName ב-android/app/build.gradle
export const APP_VERSION = '1.9.1';

// מרכז ברירת מחדל (תל אביב, עזריאלי) – בשימוש רק אם אין מיקום שמור ואין עדיין GPS
export const DEFAULT_CENTER = [32.0741, 34.7922];
export const DEFAULT_ZOOM = 16;
export const STOPS_DETAIL_ZOOM = 16;      // מתחת לזום הזה תחנות מוצגות כנקודות

export const USER_ZOOM = 17;

// ה-API שלנו (Firebase Hosting מפנה /api ל-Cloud Function; בפיתוח – server/dev-server.js)
// באפליקציה (Capacitor) – כתובת מלאה של השרת מ-runtime-config.js; בדפדפן – אותו דומיין
export const API_BASE = globalThis.WALKIE_CONFIG?.apiBase || '/api';
export const SHARE_BASE = 'https://walkie-4a743.web.app';
export const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.walkie.app';

export const API_NEARBY_TIMEOUT_MS = 15000;   // בקשה ראשונה עשויה לחכות לטעינת האינדקס
export const API_ARRIVALS_TIMEOUT_MS = 10000;

// חיפוש תחנות
export const STOP_SEARCH_RADIUS_M = 900;   // רדיוס סביב מרכז תא הרשת
export const STOP_CELL_DEG = 0.005;        // גודל תא קאש (~550 מ')
export const STOP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const REFETCH_DISTANCE_M = 350;     // טעינה מחדש רק אחרי תזוזה משמעותית
export const NEARBY_LIST_SIZE = 6;
export const MAX_STOPS = 120;
export const DEMO_RETRY_MS = 45000;

// זמני הגעה
export const ARRIVALS_REFRESH_MS = 30000;  // רענון אוטומטי של התחנה המוצגת
export const ARRIVALS_CLIENT_TTL_MS = 20000;
export const ARRIVALS_GROUP_LIMIT = 8;     // כמה קווים להציג
export const ARRIVALS_MAX_AHEAD_MIN = 180; // יציאות רחוקות יותר (מחר בבוקר) לא מוצגות
export const ARRIVAL_GONE_MS = 30000;      // "עכשיו" נעלם חצי דקה אחרי זמן ההגעה
export const NOW_TICK_MS = 10000;          // רענון התצוגה כל 10 שניות – כדי ש"עכשיו" ייעלם בזמן

// GPS וחיסכון בסוללה
export const MIN_MOVE_METERS = 4;          // התעלמות מרעש GPS קטן
export const HEADING_MIN_MOVE_METERS = 8;  // חישוב כיוון עצמאי רק אחרי תזוזה כזו
export const SAVE_POSITION_EVERY_MS = 30000;
export const ETA_TICK_MS = 30000;

// הליכה
export const WALK_SPEED_MPS = 1.3;         // ~4.7 קמ"ש
export const DETOUR_FACTOR = 1.25;         // קו אווירי -> רשת רחובות (הערכה עד שלב הניתוב)

// הלוח התחתון (פיקסלים / חלק מגובה המסך)
export const SHEET_PEEK_PX = 190;
export const SHEET_HALF_RATIO = 0.48;
export const SHEET_FULL_RATIO = 0.88;

// חיפוש
export const SEARCH_DEBOUNCE_MS = 350;
export const SEARCH_MIN_CHARS = 2;
export const RECENT_SEARCHES_MAX = 6;
export const API_SEARCH_TIMEOUT_MS = 9000;
export const API_ROUTE_TIMEOUT_MS = 20000;

// ניווט
export const NAV_ZOOM = 18;
export const NAV_USER_SCREEN_OFFSET = 0.2;   // המשתמש מוצג 20% מתחת למרכז המסך (רואים יותר קדימה)
export const NAV_OFF_ROUTE_M = 30;           // מרחק מהמסלול שנחשב סטייה
export const NAV_OFF_ROUTE_FIXES = 3;        // כמה מדידות רצופות לפני חישוב מחדש
export const NAV_REROUTE_COOLDOWN_MS = 15000;
export const NAV_ARRIVE_M = 20;
export const NAV_APPROACH_M = 30;            // רטט לפני פנייה
export const SIM_SPEEDUP = 4;                // מהירות סימולציה (?sim=1) פי X מהליכה

export const STORAGE_KEYS = {
  lastPosition: 'walkie:lastPosition',
  stopsPrefix: 'walkie:stops:v3:',
  recentSearches: 'walkie:recentSearches'
};
