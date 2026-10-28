// Walkie – נקודת הכניסה. מתזמר מפה, GPS, תחנות, זמני הגעה, חיפוש, ניווט רגלי ותחבורה ציבורית.
/* global L */

import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  USER_ZOOM,
  REFETCH_DISTANCE_M,
  NEARBY_LIST_SIZE,
  SAVE_POSITION_EVERY_MS,
  ETA_TICK_MS,
  NOW_TICK_MS,
  DEMO_RETRY_MS,
  STORAGE_KEYS
} from './config.js?v=1.10.0-mvsdq7td';
import { LocationTracker, distanceMeters } from './modules/geo.js?v=1.10.0-mvsdq7td';
import {
  createMap,
  focusPoint,
  isComfortablyVisible,
  UserLayer,
  StopsLayer,
  RouteLayer,
  TransitLayer,
  VehiclesLayer,
  MapRotator
} from './modules/map.js?v=1.10.0-mvsdq7td';
import { fetchNearbyStops } from './modules/stops.js?v=1.10.0-mvsdq7td';
import { ArrivalsStore, vehiclesFromArrivals, arrivalColor, vehicleSummary } from './modules/arrivals.js?v=1.10.0-mvsdq7td';
import { Sheet, showToast } from './modules/ui.js?v=1.10.0-mvsdq7td';
import { SearchOverlay } from './modules/search.js?v=1.10.0-mvsdq7td';
import { RouteController } from './modules/route-controller.js?v=1.10.0-mvsdq7td';
import { TransitController } from './modules/transit-controller.js?v=1.10.0-mvsdq7td';
import { DirectionsController } from './modules/directions.js?v=1.10.0-mvsdq7td';
import { initSessionWhenIdle } from './modules/session.js?v=1.10.0-mvsdq7td';
import { requireSignIn, showWelcomeIfNeeded, closeAuthDialog } from './modules/auth-gate.js?v=1.10.0-mvsdq7td';
import { TabBar } from './modules/tabs.js?v=1.10.0-mvsdq7td';
import { LinesView } from './modules/lines-view.js?v=1.10.0-mvsdq7td';
import { StationsView } from './modules/stations-view.js?v=1.10.0-mvsdq7td';
import { ThanksView } from './modules/thanks-view.js?v=1.10.0-mvsdq7td';
import { SettingsView } from './modules/settings-view.js?v=1.10.0-mvsdq7td';
import { getSettings, onSettingsChange } from './modules/settings.js?v=1.10.0-mvsdq7td';
import { shareMyLocation, shareTrip } from './modules/share.js?v=1.10.0-mvsdq7td';
import { QuickBar } from './modules/favorites-ui.js?v=1.10.0-mvsdq7td';
import { getFavorites, onFavoritesChange, isStopSaved, toggleStop, setHome, setSecond, secondLabel } from './modules/favorites.js?v=1.10.0-mvsdq7td';
import { loadDepartures } from './modules/arrivals.js?v=1.10.0-mvsdq7td';
import { AdBanner } from './modules/ad-banner.js?v=1.10.0-mvsdq7td';
import { recordWalk, recordTrip } from './modules/stats.js?v=1.10.0-mvsdq7td';
import {
  captureAttribution, trackOnce, trackPerf, trackRegion, trackFeature
} from './modules/analytics.js?v=1.10.0-mvsdq7td';
import { CommunityController } from './modules/community-controller.js?v=1.10.0-mvsdq7td';
import { onBusPosition } from './modules/community.js?v=1.10.0-mvsdq7td';
import { supportId } from './modules/session.js?v=1.10.0-mvsdq7td';
import { escapeHtml } from './modules/ui.js?v=1.10.0-mvsdq7td';
import { t, translateDom } from './modules/i18n.js?v=1.10.0-mvsdq7td';
import { initTheme } from './modules/theme.js?v=1.10.0-mvsdq7td';
import { startPush } from './modules/push.js?v=1.10.0-mvsdq7td';
import { initDeepLinks, closeLiveViewer } from './modules/deep-link.js?v=1.10.0-mvsdq7td';
import { ensureNotifyPermission } from './modules/notify.js?v=1.10.0-mvsdq7td';
import './modules/transfer-timer.js?v=1.10.0-mvsdq7td';
import { serviceStatus, serviceNotice } from './modules/service-calendar.js?v=1.10.0-mvsdq7td';

// טקסטים קבועים ב-index.html (באנגלית) ומצב לילה – לפני שאר הממשק
translateDom();
initTheme();

// מקור הגעה (קישור הזמנה / שיתוף נסיעה) ופתיחה ראשונה בהתקנה – לדף הניהול
captureAttribution();
trackOnce('first', 'funnel.first_open');

// מצב הדמיה לפיתוח: ?sim=1 – הניווט/הנסיעה "מתקדמים" לבד לאורך המסלול
const SIMULATE = new URLSearchParams(location.search).has('sim');

// ---------- State ----------

const state = {
  user: null,             // מיקום GPS אחרון
  stops: [],
  source: null,           // 'gtfs' | 'osm' | 'demo'
  selectedId: null,       // תחנה שהמשתמש בחר ידנית
  focusedId: null,        // התחנה שמוצגת כרגע בלוח
  followUser: true,       // המפה עוקבת אחרי המשתמש
  hasFix: false,
  locationDenied: false,
  loading: false,
  lastFetchCenter: null,
  lastSavedAt: 0
};

let fetchController = null;
let tickTimer = null;
let demoRetryTimer = null;
let gpsWarned = false;
let lastArrivalsRefresh = 0;

// ---------- Persistence ----------

function readLastPosition() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.lastPosition);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) return p;
  } catch {
    // ignore
  }
  return null;
}

function saveLastPosition(p) {
  const now = Date.now();
  if (now - state.lastSavedAt < SAVE_POSITION_EVERY_MS) return;
  state.lastSavedAt = now;
  try {
    localStorage.setItem(STORAGE_KEYS.lastPosition, JSON.stringify({ lat: p.lat, lng: p.lng }));
  } catch {
    // ignore
  }
}

// ---------- Init map instantly (no splash) ----------

const lastKnown = readLastPosition();
const map = createMap(
  'map',
  lastKnown ? [lastKnown.lat, lastKnown.lng] : DEFAULT_CENTER,
  lastKnown ? USER_ZOOM : DEFAULT_ZOOM,
  { onTilesReady: () => trackPerf('map', performance.now()) } // זמן עד שהמפה מוצגת, מתחילת הטעינה
);

const userLayer = new UserLayer(map);
const stopsLayer = new StopsLayer(map, (id) => selectStop(id));
const routeLayer = new RouteLayer(map);
const transitLayer = new TransitLayer(map);
const lineLayer = new TransitLayer(map);                                   // לשונית קווים
const stationsLayer = new StopsLayer(map, (id) => stationsView.selectById(id)); // לשונית תחנות
stationsLayer.setVisible(false);
const rotator = new MapRotator(map);
// סיבוב ידני בשתי אצבעות; כפתור "צפון" מחזיר את המפה ליישור רגיל
const northBtn = document.getElementById('btn-north');
let wasRotated = false;
rotator.enableUserRotate((angle) => {
  northBtn.hidden = !rotator.manual;
  northBtn.querySelector('svg').style.transform = `rotate(${angle}deg)`;
  if (rotator.manual && !wasRotated) trackFeature('map_rotate'); // פעם אחת לכל סיבוב, לא בכל זווית
  wasRotated = rotator.manual;
});
northBtn.addEventListener('click', () => rotator.resetNorth());
// אוטובוסים בזמן אמת: בדרך לתחנה שמוצגת בלוח (מסך הבית)
const vehiclesLayer = new VehiclesLayer(map, { onSelect: (v) => showToast(vehicleSummary(v), 4200) });
const arrivalsStore = new ArrivalsStore(() => render());

// סרגל הניווט התחתון נוצר אחרי הלוח, אבל הלוח צריך לדעת את גובהו
let tabbar = null;

const sheet = new Sheet(document.getElementById('sheet'), {
  onSelectStop: (id) => selectStop(id),
  onRetryLocation: () => {
    state.locationDenied = false;
    gpsWarned = false;
    tracker.restart();
    render();
  },
  onAction: (action, data) => handleSheetAction(action, data),
  getBottomInset: () => tabbar?.height ?? 0
});

const locateBtn = document.getElementById('btn-locate');
const banner = document.getElementById('nav-banner');

/** כמה מהמפה מוסתר: כותרת למעלה, לוח למטה / פאנל צד */
function getOcclusion() {
  const occ = sheet.occlusion();
  const tab = tabbar?.active ?? 'home';
  const top = directions?.isActive
    ? directions.height
    : tab === 'home'
      ? Math.max(document.querySelector('.topbar').getBoundingClientRect().bottom, document.getElementById('quick-places').getBoundingClientRect().bottom)
      : 12;
  return { ...occ, top };
}

const routes = new RouteController({
  map,
  sheet,
  routeLayer,
  rotator,
  userLayer,
  banner,
  compassBtn: document.getElementById('btn-compass'),
  simulate: SIMULATE,
  getOrigin: () => (state.user ? { ...state.user, isUser: true } : { ...visibleCenter(), isUser: false }),
  getOcclusion,
  onSimPosition: (p) => onLocation(p),
  onPlanned: (model) => directions.setTabTime('walk', model.realisticSeconds),
  onModeChange: (mode) => {
    queueMicrotask(syncBackground);
    if (mode === 'navigating') trackFeature('nav_walk');
    if (mode === 'arrived' && !SIMULATE) recordWalk(routes.model?.distance);
    directions.onChildMode('walk', mode);
  }
});

const transit = new TransitController({
  map,
  sheet,
  layer: transitLayer,
  vehicles: new VehiclesLayer(map, { onSelect: (v) => showToast(vehicleSummary(v), 4200) }),
  banner,
  simulate: SIMULATE,
  getOcclusion,
  onSimPosition: (p) => onLocation(p),
  onPlanned: (result) => {
    const best = result.itineraries.find((it) => it.recommended) ?? result.itineraries[0];
    if (best) directions.setTabTime('transit', best.duration);
    if (result.walk) directions.setTabTime('walk', result.walk.seconds);
  },
  onModeChange: (mode) => {
    queueMicrotask(syncBackground);
    if (mode === 'trip') trackFeature('nav_transit');
    if (mode === 'arrived' && !SIMULATE) recordTrip();
    directions.onChildMode('transit', mode);
  }
});

const search = new SearchOverlay(document.getElementById('search'), {
  getNear: () => state.user ?? visibleCenter(),
  onPick: (place) => {
    setFollow(false);
    directions.open(place);
  }
});

const directions = new DirectionsController({
  root: document.getElementById('directions'),
  search,
  walk: routes,
  transit,
  getUserLocation: () => state.user,
  getFallbackPoint: () => visibleCenter(),
  onOpen: () => {
    state.selectedId = null;
    vehiclesLayer.clear(); // האוטובוסים של התחנה – המסלול מציג רק את האוטובוס שלו
    // בזמן מסלול/ניווט – הסרגל התחתון מוסתר (כמו בגוגל מפות)
    tabbar?.setHidden(true);
    sheet.refreshLayout();
  },
  onClose: () => {
    tabbar?.setHidden(false);
    sheet.refreshLayout();
    onDirectionsClosed();
  }
});

// תכנון מסלול (מכל מקום באפליקציה) דורש חשבון Google – אחרי ההתחברות המסלול נפתח לבד
const openDirections = directions.open.bind(directions);
directions.open = (...args) => {
  if (requireSignIn(t('לתכנן מסלול'), () => openDirections(...args), { guestOk: true })) openDirections(...args);
};

const getNear = () => state.user ?? visibleCenter();

// קהילה: חסימות, הודעות וסקרים מהמנהל, נוכחות על הקו, דיווחים ושיתוף נסיעה בלייב
const community = new CommunityController({
  routes,
  transit,
  getUser: () => state.user,
  canInterrupt: () => !directions.isActive && !isGuiding(),
  shareOnce: () => shareCurrentTrip()
});
window.addEventListener('walkie:line-open', (e) => community.onLineOpened(e.detail.lineKey));

const linesView = new LinesView({
  sheet,
  layer: lineLayer,
  vehicles: new VehiclesLayer(map, { onSelect: (v) => showToast(vehicleSummary(v), 4200) }),
  map,
  getNear,
  getOcclusion,
  onNavigateTo: (place) => openDirectionsTo(place, 'walk')
});

const thanksView = new ThanksView(document.getElementById('thanks-page'));

const stationsView = new StationsView({
  sheet,
  layer: stationsLayer,
  vehicles: new VehiclesLayer(map, { onSelect: (v) => showToast(vehicleSummary(v), 4200) }),
  map,
  getNear,
  getOcclusion,
  onNavigateTo: (place) => openDirectionsTo(place, 'walk')
});

/** בחירת מקום דרך מסך החיפוש (כולל "המיקום שלי") – להגדרת בית / עבודה / בית ספר */
function pickPlace(placeholder, onPick, placeName = t('המיקום שלי')) {
  search.open({
    placeholder,
    includeMyLocation: true,
    onPick: (place) => {
      if (place.kind === 'mylocation') {
        if (!state.user) {
          showToast(t('אין מיקום GPS – חפשו כתובת'));
          return;
        }
        onPick({ id: `pt:${state.user.lat.toFixed(5)},${state.user.lng.toFixed(5)}`, kind: 'place', name: placeName, lat: state.user.lat, lng: state.user.lng });
        return;
      }
      onPick(place);
    }
  });
}

const settingsView = new SettingsView(document.getElementById('settings-page'), {
  pickPlace,
  getSupportId: supportId
});

// סרגל גישה מהירה: בית · עבודה/בית ספר · מקומות שמורים
new QuickBar(document.getElementById('quick-places'), {
  onGo: (place) => openDirectionsTo(place),
  onSet: (which) => {
    if (!requireSignIn(t('לשמור מועדפים'), null, { guestOk: true })) return;
    const label = which === 'home' ? t('בית') : t(secondLabel().label);
    pickPlace(which === 'home' ? t('כתובת הבית') : t('כתובת ה{place}', { place: label }), (place) => {
      if (which === 'home') setHome(place);
      else setSecond(place);
      showToast(t('{place} נשמר – לחיצה אחת ויוצאים לדרך', { place: label }));
    }, label);
  }
});

// ---------- תחנות מועדפות (יציאות במסך הבית) ----------

const favBoards = new Map(); // code -> { status, arrivals, at }
let favLoading = false;

async function loadFavBoards(force = false) {
  if (favLoading) return;
  const stops = getFavorites().stops.slice(0, 4);
  const due = stops.filter((s) => force || !favBoards.get(s.code) || Date.now() - favBoards.get(s.code).at > 60000);
  if (due.length === 0) return;
  favLoading = true;
  await Promise.all(due.map(async (s) => {
    try {
      const { arrivals } = await loadDepartures(s);
      favBoards.set(s.code, { status: 'ok', arrivals, at: Date.now() });
    } catch {
      favBoards.set(s.code, { status: 'error', arrivals: favBoards.get(s.code)?.arrivals ?? null, at: Date.now() });
    }
  }));
  favLoading = false;
  render();
}

onFavoritesChange(() => {
  loadFavBoards();
  render();
});

let adBanner = null;
tabbar = new TabBar(document.getElementById('tabbar'), {
  onChange: (tab, prev, opts) => onTabChange(tab, prev, opts),
  getExtraBottom: () => adBanner?.height ?? 0
});
// באנר פרסומת קבוע בתחתית: כשהוא מופיע / משתנה, הסרגל והלוח מתיישבים מחדש מעליו
adBanner = new AdBanner(document.getElementById('ad-banner'), {
  onResize: () => {
    tabbar.refresh();
    sheet.refreshLayout();
  }
});
tabbar.refresh(); // הבאנר כבר קיים עכשיו: מחשבים את הגובה המשותף מחדש
sheet.refreshLayout();

onSettingsChange((s) => {
  render(); // אוטובוסים בזמן אמת הופעלו / כובו
});
stopsLayer.setVisible(false); // אייקוני תחנות מוצגים רק בלשונית "תחנות"

const tracker = new LocationTracker({
  onUpdate: onLocation,
  onError: onLocationError
});

// ---------- Helpers ----------

/** מרכז המפה בחלק הגלוי (מעל הלוח) */
function visibleCenter() {
  const occ = sheet.occlusion();
  const size = map.getSize();
  const pt = L.point((size.x - occ.right) / 2, (size.y - occ.bottom) / 2);
  const ll = map.containerPointToLatLng(pt);
  return { lat: ll.lat, lng: ll.lng };
}

function setFollow(follow) {
  state.followUser = follow;
  locateBtn.classList.toggle('is-active', follow && !!state.user);
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const isGuiding = () => routes.isNavigating || transit.isTripping;

/**
 * ניווט / ליווי נסיעה פעילים: מפעילים שירות מיקום ברקע (עם התראה קבועה), כדי שהליווי וההתראה "רדו בתחנה הבאה"
 * יעבדו גם כשהמסך נעול. כבוי בהמחשה, בדפדפן, ואם המשתמש כיבה "עבודה ברקע" בהגדרות.
 */
function syncBackground() {
  const want = isGuiding() && !SIMULATE && getSettings().backgroundTrip;
  if (want === tracker.backgroundActive || !tracker.backgroundSupported) return;
  if (want) {
    ensureNotifyPermission({ prompt: true }).finally(() => tracker.setBackground(true, {
      title: t('Walkie מלווה אותך'),
      message: routes.isNavigating ? t('ניווט פעיל') : t('ליווי נסיעה פעיל. נתריע לפני הירידה')
    }));
  } else {
    tracker.setBackground(false);
  }
}

// ---------- Rendering ----------

function render() {
  // מיון לפי המשתמש כשעוקבים אחריו, אחרת לפי מרכז החלק הגלוי של המפה
  const sortRef = state.followUser && state.user ? state.user : visibleCenter();
  // מרחק מוצג תמיד מהמשתמש אם יש GPS
  const distRef = state.user ?? sortRef;

  const ranked = state.stops
    .map((s) => ({ ...s, distance: distanceMeters(distRef, s), rank: distanceMeters(sortRef, s) }))
    .sort((a, b) => a.rank - b.rank);

  const nearest = ranked[0] ?? null;
  const focused = ranked.find((s) => s.id === state.selectedId) ?? nearest;

  stopsLayer.render(ranked, nearest?.id, focused?.id);

  // בזמן תכנון מסלול / ניווט, או בלשונית אחרת – הלוח שייך למסך אחר
  // אוטובוסים בזמן אמת לא מוצגים במפת הבית – רק בלשונית "קווים"
  vehiclesLayer.clear();
  if (directions.isActive || tabbar.active !== 'home') return;

  const arrivalsState = focused ? arrivalsStore.get(focused) : null;

  // מעבר לתחנה חדשה -> טעינת זמני הגעה
  if (focused && focused.id !== state.focusedId) {
    state.focusedId = focused.id;
    queueMicrotask(() => refreshArrivals(true));
  } else if (!focused) {
    state.focusedId = null;
  }

  sheet.render({
    focused,
    isNearest: !!focused && focused.id === nearest?.id && !state.selectedId,
    others: ranked.filter((s) => s.id !== focused?.id).slice(0, NEARBY_LIST_SIZE),
    arrivalsState,
    source: state.source,
    // שבת / חג / ערב שבת – לפי המיקום (זמני השקיעה משתנים בין צפון לדרום)
    serviceNotice: serviceNotice(serviceStatus(Date.now(), state.user ?? focused)),
    hasUserLocation: !!state.user && state.followUser,
    locationDenied: state.locationDenied,
    loading: state.loading,
    isFavStop: focused ? isStopSaved(focused) : false,
    favorites: getFavorites().stops
      .filter((s) => s.code !== focused?.code)
      .slice(0, 4)
      .map((stop) => ({ stop, state: favBoards.get(stop.code) ?? null }))
  });
}

function focusedStop() {
  return state.stops.find((s) => s.id === state.focusedId) ?? null;
}

function refreshArrivals(force = false) {
  if (directions.isActive || tabbar.active !== 'home') return;
  const stop = focusedStop();
  if (!stop) return;
  lastArrivalsRefresh = Date.now();
  arrivalsStore.refresh(stop, { force });
}

// ---------- Stops loading ----------

async function loadStops(center) {
  fetchController?.abort();
  fetchController = new AbortController();
  clearTimeout(demoRetryTimer);
  state.lastFetchCenter = { lat: center.lat, lng: center.lng };
  state.loading = true;

  if (state.stops.length === 0) render();

  try {
    const { stops, source } = await fetchNearbyStops(center, fetchController.signal);

    // תחנה שהמשתמש בחר נשארת גם אם היא לא ברשימה החדשה (למשל בקצה האזור)
    const selected = state.selectedId ? state.stops.find((s) => s.id === state.selectedId) : null;
    state.stops = selected && !stops.some((s) => s.id === selected.id) ? [...stops, selected] : stops;
    state.source = source;
    state.loading = false;

    if (source === 'demo') {
      showToast(t('אין חיבור לשרת התחנות – מוצגות תחנות דמה'));
      demoRetryTimer = setTimeout(() => {
        if (document.visibilityState === 'visible' && state.source === 'demo') loadStops(center);
      }, DEMO_RETRY_MS);
    }
    render();
  } catch (err) {
    if (err?.name === 'AbortError') return;
    state.loading = false;
    console.error('[Walkie] loadStops failed', err);
    showToast(t('שגיאה בטעינת תחנות'));
    render();
  }
}

// ---------- Interactions ----------

function selectStop(id) {
  if (directions.isActive) return; // בזמן תכנון מסלול לחיצה על תחנה לא מחליפה מסך
  const stop = state.stops.find((s) => s.id === id);
  if (!stop) return;
  state.selectedId = id;
  setFollow(false);
  sheet.reveal();
  // מחכים פריים אחד כדי שהלוח יתחיל לזוז, ואז ממרכזים מעליו
  requestAnimationFrame(() => {
    focusPoint(map, [stop.lat, stop.lng], {
      zoom: Math.max(map.getZoom(), 16.5),
      occlusion: getOcclusion(),
      fly: map.distance(map.getCenter(), [stop.lat, stop.lng]) > 1500
    });
  });
  render();
}

function handleSheetAction(action, data) {
  if (tabbar.active === 'lines' && linesView.handleAction(action, data)) return;
  if (tabbar.active === 'stations' && stationsView.handleAction(action, data)) return;
  if (transit.handleAction(action, data)) return;
  if (routes.handleAction(action)) return;

  if (action === 'toggle-fav-stop') {
    const stop = state.stops.find((s) => s.id === data.stopId);
    if (stop) {
      const on = toggleStop(stop);
      if (on === null) return;
      showToast(on ? t('התחנה נשמרה – היציאות שלה יופיעו כאן ⭐') : t('התחנה הוסרה מהמועדפים'));
    }
    return;
  }

  if (action === 'fav-stop-walk') {
    const s = getFavorites().stops.find((x) => x.code === data.code);
    if (s) openDirectionsTo({ id: s.id ?? `stop:${s.code}`, kind: 'stop', name: s.name, subtitle: t('תחנה {code}', { code: s.code }), lat: s.lat, lng: s.lng });
    return;
  }

  if (action === 'share-trip') {
    community.openTripShare();
    return;
  }

  if (community.handleAction(action, data)) return;

  if (action === 'open-settings') {
    directions.close();
    tabbar.select('settings');
    return;
  }

  if (action === 'dir-walk') {
    directions.setTab('walk');
    return;
  }

  if (action === 'walk-to-stop') {
    const stop = state.stops.find((s) => s.id === data.stopId);
    if (!stop) return;
    openDirectionsTo(
      {
        id: stop.id,
        kind: 'stop',
        name: stop.name,
        subtitle: stop.code ? t('תחנה {code}', { code: stop.code }) : null,
        lat: stop.lat,
        lng: stop.lng
      },
      'walk'
    );
  }
}

/** פתיחת מסלול מכל לשונית: חוזרים למסך הבית (המפה) ופותחים את כותרת המסלול */
function openDirectionsTo(place, tab = null) {
  if (tabbar.active !== 'home') tabbar.select('home');
  setFollow(false);
  directions.open(place, tab ? { tab } : {});
}

// ---------- Tabs ----------

function onTabChange(tab, prev, { reselect = false } = {}) {
  if (tab === prev && !reselect) return;
  if (tab !== prev) {
    trackFeature(`tab_${tab}`);
    community.onTabSwitch();
  }

  if (tab !== prev) {
    if (prev === 'lines') linesView.deactivate();
    if (prev === 'stations') stationsView.deactivate();
    if (prev === 'settings') settingsView.hide();
    if (prev === 'thanks') thanksView.hide();
  }

  stopsLayer.setVisible(false);
  vehiclesLayer.clear();
  search.close();

  switch (tab) {
    case 'home':
      if (reselect) {
        recenter();
        return;
      }
      sheet.setSnap('half');
      state.focusedId = null; // רענון זמני הגעה
      render();
      break;
    case 'lines':
      linesView.activate({ reset: reselect });
      break;
    case 'stations':
      stationsView.activate({ reset: reselect });
      break;
    case 'settings':
      settingsView.show();
      break;
    case 'thanks':
      thanksView.show();
      break;
    default:
      break;
  }
}

function onDirectionsClosed() {
  // חזרה למצב תחנות
  sheet.setSnap('half');
  if (state.user) {
    setFollow(true);
    focusPoint(map, [state.user.lat, state.user.lng], {
      zoom: Math.max(map.getZoom(), USER_ZOOM),
      occlusion: getOcclusion()
    });
  }
  state.focusedId = null; // יגרום לרענון זמני הגעה
  render();
}

function recenter() {
  if (routes.isNavigating) {
    if (state.user) routes.onPosition(state.user);
    return;
  }
  if (transit.isTripping) {
    if (state.user) transit.onPosition(state.user);
    return;
  }
  if (!directions.isActive) state.selectedId = null;
  if (state.user) {
    setFollow(true);
    focusPoint(map, [state.user.lat, state.user.lng], {
      zoom: Math.max(map.getZoom(), USER_ZOOM),
      occlusion: getOcclusion()
    });
    if (!state.lastFetchCenter || distanceMeters(state.lastFetchCenter, state.user) > REFETCH_DISTANCE_M) {
      loadStops(state.user);
    } else {
      render();
    }
  } else if (state.locationDenied) {
    showToast(globalThis.Capacitor?.isNativePlatform?.()
      ? t('יש לאפשר גישה למיקום: הגדרות הטלפון ← אפליקציות ← Walkie ← הרשאות')
      : t('יש לאפשר גישה למיקום בהגדרות הדפדפן'));
  } else {
    showToast(t('מחפש את המיקום שלך…'));
    tracker.restart();
  }
}

locateBtn.addEventListener('click', recenter);
document.getElementById('btn-search').addEventListener('click', () => {
  trackFeature('search');
  search.open();
});

// שיתוף המיקום הנוכחי בוואטסאפ
document.getElementById('btn-share').addEventListener('click', () => {
  trackFeature('share_location');
  if (!state.user) {
    showToast(state.locationDenied ? t('יש לאפשר גישה למיקום כדי לשתף') : t('מחפש את המיקום שלך…'));
    return;
  }
  if (requireSignIn(t('לשתף'), () => state.user && shareMyLocation(state.user), { guestOk: true })) shareMyLocation(state.user);
});

/** בזמן ניווט/נסיעה: "אני בדרך – אגיע בערך ב-…" */
function shareCurrentTrip() {
  if (routes.isNavigating && routes.session?.state) {
    shareTrip({
      position: state.user,
      destName: routes.dest?.name ?? t('היעד'),
      arrival: Date.now() + routes.session.state.remainingSeconds * 1000,
      mode: 'walk'
    });
    return;
  }
  if (transit.isTripping && transit.trip?.session.state) {
    const st = transit.trip.session.state;
    const line = [st.leg, st.next].find((l) => l && l.mode !== 'walk');
    shareTrip({
      position: state.user,
      destName: transit.request?.dest?.name ?? t('היעד'),
      arrival: st.arrival,
      mode: 'transit',
      lineText: line ? (line.mode === 'rail' ? t('רכבת') : t('קו {line}', { line: line.line })) : null
    });
    return;
  }
  if (state.user) shareMyLocation(state.user);
}

// המשתמש גורר את המפה = מפסיקים לעקוב
map.on('dragstart', () => setFollow(false));

map.on(
  'moveend',
  debounce(() => {
    if (state.followUser || isGuiding()) return;
    const center = visibleCenter();
    if (!state.lastFetchCenter || distanceMeters(state.lastFetchCenter, center) > REFETCH_DISTANCE_M) {
      loadStops(center);
    } else {
      render();
    }
  }, 350)
);

// ---------- GPS ----------

function onLocation(p) {
  syncBackground(); // הניווט נגמר בלי אירוע (יציאה שקטה)? מכבים את שירות הרקע
  if (!p.simulated) onBusPosition(p); // אם זה נראה שאני באוטובוס של הקו הפתוח / של הנסיעה – מדווח מיקום
  // בזמן הדמיה מתעלמים מה-GPS האמיתי
  if ((routes.isSimulating || transit.isSimulating) && !p.simulated) return;

  state.user = p;
  state.locationDenied = false;
  userLayer.update(p);
  if (!p.simulated) saveLastPosition(p);

  // בזמן ניווט/נסיעה – המצלמה והלוח בשליטת הבקר הפעיל
  if (routes.isNavigating) {
    routes.onPosition(p);
    return;
  }
  if (transit.isTripping) {
    transit.onPosition(p);
    return;
  }
  // שומרים מיקום אחרון לתחילת ניווט/נסיעה
  routes.onPosition(p);
  transit.onPosition(p);

  if (!state.hasFix) {
    state.hasFix = true;
    if (!p.simulated) {
      trackPerf('gps', performance.now());
      trackRegion(p.lat, p.lng); // רק שם העיר הקרובה נספר, המיקום עצמו לא יוצא מהמכשיר
    }
    if (state.followUser && !directions.isActive) {
      focusPoint(map, [p.lat, p.lng], {
        zoom: Math.max(map.getZoom(), USER_ZOOM),
        occlusion: getOcclusion()
      });
    }
    setFollow(state.followUser);
  } else if (state.followUser && !directions.isActive && !isComfortablyVisible(map, [p.lat, p.lng], getOcclusion())) {
    // מזיזים את המפה רק כשהמשתמש מתקרב לקצה – חוסך טעינות אריחים
    focusPoint(map, [p.lat, p.lng], { occlusion: getOcclusion() });
  }

  if (state.followUser &&
      (!state.lastFetchCenter || distanceMeters(state.lastFetchCenter, p) > REFETCH_DISTANCE_M)) {
    loadStops(p);
  } else {
    render();
  }
}

function onLocationError(err) {
  if (err.code === 1 || err.code === 'unsupported') {
    state.locationDenied = true;
    setFollow(false);
    render();
    return;
  }
  if (!gpsWarned && !state.user) {
    gpsWarned = true;
    showToast(t('מחפש אות GPS…'));
  }
}

// ---------- Ticker (פעיל רק כשהאפליקציה גלויה) ----------

const REFRESH_MS = 30000; // רענון זמני הגעה בזמן אמת

function tick() {
  if (directions.isActive || tabbar.active !== 'home') return;
  loadFavBoards();
  if (Date.now() - lastArrivalsRefresh >= REFRESH_MS - 1000) refreshArrivals();
  render(); // מעדכן דקות שנותרו גם בלי בקשה חדשה
}

function startTicker() {
  stopTicker();
  tickTimer = setInterval(tick, Math.min(NOW_TICK_MS, ETA_TICK_MS, REFRESH_MS));
}

function stopTicker() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    tick();
    startTicker();
  } else {
    stopTicker();
  }
});

// ---------- כפתור "חזור" של אנדרואיד ----------
// בלי מאזין, Capacitor סוגר את האפליקציה. כאן "חזור" עובר שכבה-שכבה, כמו באפליקציה נייטיבית.

const NativeApp = globalThis.Capacitor?.Plugins?.App;

function handleBack() {
  if (closeLiveViewer()) return;
  if (closeAuthDialog()) return;
  if (search.isOpen) return search.close();
  if (document.querySelector('.cm-modal')) return document.querySelector('.cm-modal').remove();
  if (settingsView.isPrivacyOpen) return settingsView.closePrivacy();
  // בזמן ניווט/נסיעה לא מבטלים בטעות – רק ממזערים, והליווי ממשיך
  if (isGuiding()) return NativeApp?.minimizeApp();
  if (directions.isActive) return directions.close();
  if (tabbar.active === 'lines' && linesView.mode !== 'list') return linesView.handleAction('line-back', {});
  if (tabbar.active === 'stations' && stationsView.mode !== 'list') return stationsView.handleAction('station-back', {});
  if (tabbar.active !== 'home') return tabbar.select('home');
  if (sheet.snap === 'full') return sheet.setSnap('half');
  if (state.selectedId) {
    state.selectedId = null;
    return recenter();
  }
  return NativeApp?.minimizeApp();
}

NativeApp?.addListener('backButton', handleBack);

// גישה לדיבוג מהקונסול – רק במצב הדמיה
if (SIMULATE) window.walkieDebug = { map, routes, transit, directions, state, tabbar, linesView, stationsView, rotator, community };

// ---------- Boot ----------

// מציגים תחנות מיד סביב המיקום האחרון / ברירת המחדל, במקביל לבקשת ה-GPS
loadStops(lastKnown ?? visibleCenter());
loadFavBoards(true);
tracker.start();
startTicker();

// ---------- הודעה מהמנהל (config/announcement) ----------

const ANNOUNCE_SEEN_KEY = 'walkie:announceSeen';

function showAnnouncement(a) {
  const id = String(a.id ?? a.updatedAt?.seconds ?? a.title ?? '');
  const expired = a.until && Date.parse(a.until) < Date.now();
  const audienceOk = a.audience !== 'premium';
  if (!a.active || expired || !audienceOk || !a.text) return;
  try {
    if (localStorage.getItem(ANNOUNCE_SEEN_KEY) === id) return;
  } catch {
    // ignore
  }
  const el = document.createElement('div');
  el.className = `announce${a.level === 'warning' ? ' is-warning' : ''}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <div class="announce-text">${a.title ? `<strong>${escapeHtml(a.title)}</strong>` : ''}${escapeHtml(a.text)}</div>
    <button class="icon-btn" type="button" aria-label="${t('סגירה')}">✕</button>`;
  el.querySelector('button').addEventListener('click', () => {
    el.remove();
    try {
      localStorage.setItem(ANNOUNCE_SEEN_KEY, id);
    } catch {
      // ignore
    }
  });
  document.body.appendChild(el);
}

// מסך "ברוכים הבאים" (התחברות עם Google או דילוג) – אחרי אנימציית הפתיחה
(window.walkieIntroDone ?? Promise.resolve()).then(async () => {
  await showWelcomeIfNeeded();
  if (!document.querySelector('.auth-gate')) trackOnce('funnel:map', 'funnel.map_reached'); // לא היה מסך כניסה – המפה כבר מולו
});

// Firebase נטען רק אחרי שהמפה כבר על המסך
const bootSession = () => initSessionWhenIdle((session) => {
  console.info('[Walkie] signed in', session.uid, session.plan);
  if (!settingsView.root.hidden) settingsView.render(); // מזהה התמיכה
  community.start();
}, { onAnnouncement: showAnnouncement });
bootSession();
startPush();
initDeepLinks();
// כניסה עם Google מתבצעת בלי להפעיל את האפליקציה מחדש: בונים את הסשן עכשיו
window.addEventListener('walkie:signed-in', bootSession);
