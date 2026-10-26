// שכבת המפה: Leaflet + מפה וקטורית חינמית של OpenFreeMap (בלי מפתח), עם אריחי OSM כגיבוי. סמן משתמש ותחנות.
/* global L */

import { STOPS_DETAIL_ZOOM } from '../config.js?v=1.9.1-mvprvblb';
import { createMotion } from './vehicle-motion.js?v=1.9.1-mvprvblb';

const BUS_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 16c0 .9.4 1.7 1 2.2V20c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1h8v1c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1.8c.6-.5 1-1.3 1-2.2V6c0-3.5-3.6-4-8-4S4 2.5 4 6v10Zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM18 11H6V6h12v5Z"/></svg>';

const RAIL_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2C8 2 4 2.5 4 6v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5v.5h2.2l2-2h3.6l2 2H18v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-3.6-4-8-4ZM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3.5-7H6V6h5v4Zm2 0V6h5v4h-5Zm3.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/></svg>';
const LIGHTRAIL_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M19 16.9V8a5 5 0 0 0-4.5-5l.8-1.5-1.3-.5L13 3h-2L9.9 1l-1.3.5.8 1.5A5 5 0 0 0 5 8v8.9A3 3 0 0 0 7 22h10a3 3 0 0 0 2-5.1ZM8 19.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm8 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM17 13H7V8h10v5Z"/></svg>';
const MODE_SVG = { bus: BUS_SVG, rail: RAIL_SVG, lightrail: LIGHTRAIL_SVG };

const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const VECTOR_LOAD_TIMEOUT_MS = 9000;

function canUseVectorMap() {
  try {
    const c = document.createElement('canvas');
    return !!(globalThis.maplibregl && L.maplibreGL && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

/** סגנון OpenFreeMap עם שמות בעברית כשיש (ואחרת השם המקומי) */
async function loadStyle() {
  const res = await fetch(OPENFREEMAP_STYLE);
  if (!res.ok) throw new Error(`style HTTP ${res.status}`);
  const style = await res.json();
  for (const layer of style.layers ?? []) {
    if (layer.layout?.['text-field']) layer.layout['text-field'] = ['coalesce', ['get', 'name:he'], ['get', 'name']];
  }
  return style;
}

/** מוסיף את המפה הוקטורית; נכשל (reject) אם היא לא נטענת בזמן, כדי לעבור לגיבוי */
async function addVectorMap(map, onReady) {
  // עברית ברכיב המפה הוקטורית: בלי התוסף הזה האותיות מצוירות הפוך (כתב מראה)
  try {
    globalThis.maplibregl.setRTLTextPlugin(new URL('vendor/maplibre/mapbox-gl-rtl-text.js', document.baseURI).href, false)?.catch?.(() => {});
  } catch {
    // כבר נטען
  }
  const style = await loadStyle();
  const layer = L.maplibreGL({
    style,
    attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    interactive: false
  }).addTo(map);
  await new Promise((resolve, reject) => {
    const gl = layer.getMaplibreMap();
    const timer = setTimeout(() => reject(new Error('vector map timeout')), VECTOR_LOAD_TIMEOUT_MS);
    gl.once('load', () => {
      clearTimeout(timer);
      onReady();
      resolve();
    });
  }).catch((err) => {
    map.removeLayer(layer);
    throw err;
  });
}

export function createMap(elementId, center, zoom, { onTilesReady = null } = {}) {
  const map = L.map(elementId, {
    zoomControl: false,
    preferCanvas: true,        // וקטורים (עיגול דיוק) על Canvas – זול יותר
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 90,   // זום חלק יותר בגלגלת
    inertia: true,
    inertiaDeceleration: 2600,
    easeLinearity: 0.2,
    fadeAnimation: true,
    zoomAnimation: true,
    markerZoomAnimation: true
  }).setView(center, zoom);

  const common = {
    minZoom: 3,
    // טעינת אריחים גם בזמן גרירה (בלי "חורים" אפורים עד שהאצבע נעצרת), במרווח של 150 מ"ש
    updateWhenIdle: false,
    updateInterval: 150,
    keepBuffer: 4
  };

  let ready = false;
  const markReady = () => {
    if (ready) return;
    ready = true;
    onTilesReady?.();
  };

  // גיבוי: אריחי OSM רגילים (אם אין WebGL, אין רשת לסגנון, או שהמפה הוקטורית לא עולה)
  const addRaster = () => {
    const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      ...common,
      maxZoom: 19,
      className: 'tiles-soft',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    layer.once('load', markReady);
  };

  if (canUseVectorMap()) addVectorMap(map, markReady).catch(addRaster);
  else addRaster();

  map.attributionControl.setPrefix(false);
  // זכויות היוצרים מחוץ למכולת המפה: כשהמפה מסתובבת הטקסט נשאר ישר ובמקומו
  const attribution = map.attributionControl.getContainer().parentElement;
  attribution.classList.add('attribution-fixed');
  document.body.appendChild(attribution);

  // בזום רחוק – תחנות כנקודות קטנות (CSS בלבד, בלי לבנות סמנים מחדש)
  const updateZoomClass = () => {
    map.getContainer().classList.toggle('is-zoomed-out', map.getZoom() < STOPS_DETAIL_ZOOM);
  };
  map.on('zoomend', updateZoomClass);
  updateZoomClass();

  return map;
}

/**
 * מרכז נקודה בחלק הגלוי של המפה (לא מתחת ללוח התחתון / פאנל הצד / כותרת המסלול).
 * occlusion = { top, bottom, right } בפיקסלים.
 */
export function focusPoint(map, latLng, { zoom, occlusion = { bottom: 0, right: 0 }, fly = false } = {}) {
  const z = zoom ?? map.getZoom();
  const top = occlusion.top ?? 0;
  const point = map.project(latLng, z).add([occlusion.right / 2, (occlusion.bottom - top) / 2]);
  const target = map.unproject(point, z);
  if (fly) map.flyTo(target, z, { duration: 0.65, easeLinearity: 0.2 });
  else map.setView(target, z, { animate: true, duration: 0.45 });
}

/** האם הנקודה נמצאת באזור הנוח לצפייה (לא מוסתרת ולא צמודה לקצה) */
export function isComfortablyVisible(map, latLng, occlusion = { bottom: 0, right: 0 }) {
  const p = map.latLngToContainerPoint(latLng);
  const size = map.getSize();
  return (
    p.x > 40 &&
    p.x < size.x - occlusion.right - 40 &&
    p.y > (occlusion.top ?? 80) + 20 &&
    p.y < size.y - occlusion.bottom - 40
  );
}

export class UserLayer {
  constructor(map) {
    this.map = map;
    this.marker = null;
    this.circle = null;
    this.dotEl = null;
  }

  update(pos) {
    const latLng = [pos.lat, pos.lng];
    const radius = Math.min(pos.accuracy, 500);

    if (!this.marker) {
      this.circle = L.circle(latLng, {
        radius,
        interactive: false,
        weight: 1,
        color: '#2563eb',
        opacity: 0.35,
        fillColor: '#3b82f6',
        fillOpacity: 0.1
      }).addTo(this.map);

      this.marker = L.marker(latLng, {
        icon: L.divIcon({
          className: 'user-marker',
          html:
            '<div class="user-dot"><span class="user-heading"></span><span class="user-pulse"></span><span class="user-core"></span></div>',
          iconSize: [48, 48],
          iconAnchor: [24, 24]
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000
      }).addTo(this.map);

      this.dotEl = this.marker.getElement()?.querySelector('.user-dot') ?? null;
    } else {
      this.marker.setLatLng(latLng);
      this.circle.setLatLng(latLng);
      this.circle.setRadius(radius);
    }

    // כשהמצפן פעיל הוא קובע את כיוון החץ, לא ה-GPS
    if (!this.headingLocked) this.setHeading(pos.heading);
  }

  setHeading(deg) {
    if (!this.dotEl) return;
    if (Number.isFinite(deg)) {
      this.dotEl.style.setProperty('--heading', `${deg}deg`);
      this.dotEl.classList.add('has-heading');
    } else {
      this.dotEl.classList.remove('has-heading');
    }
  }

  /** נעילת כיוון החץ למקור חיצוני (מצפן) */
  lockHeading(locked) {
    this.headingLocked = locked;
  }
}

const zIndexOf = (variant) => (variant === 'focused' ? 600 : variant === 'nearest' ? 300 : 0);

export class StopsLayer {
  constructor(map, onSelect) {
    this.map = map;
    this.onSelect = onSelect;
    this.group = L.layerGroup().addTo(map);
    this.markers = new Map(); // id -> { marker, variant, mode, name }
    this.icons = {};
    this.labelledId = null;
  }

  #icon(variant, mode = 'bus') {
    const key = `${variant}|${mode}`;
    if (!this.icons[key]) {
      const cls = (variant === 'focused' ? ' is-focused' : variant === 'nearest' ? ' is-nearest' : '') + (mode !== 'bus' ? ` mode-${mode}` : '');
      this.icons[key] = L.divIcon({
        className: 'stop-marker',
        html: `<div class="stop-pin${cls}">${MODE_SVG[mode] ?? BUS_SVG}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
    }
    return this.icons[key];
  }

  // עדכון דיפרנציאלי – רק סמנים שהשתנו נוגעים ב-DOM
  render(stops, nearestId, focusedId) {
    const seen = new Set();

    for (const stop of stops) {
      seen.add(stop.id);
      const variant =
        stop.id === focusedId ? 'focused' : stop.id === nearestId ? 'nearest' : 'default';

      let entry = this.markers.get(stop.id);
      if (!entry) {
        const marker = L.marker([stop.lat, stop.lng], {
          icon: this.#icon(variant, stop.mode),
          title: stop.name,
          alt: stop.name,
          riseOnHover: true
        });
        marker.on('click', () => this.onSelect(stop.id));
        marker.setZIndexOffset(zIndexOf(variant));
        marker.addTo(this.group);
        entry = { marker, variant, mode: stop.mode, name: stop.name };
        this.markers.set(stop.id, entry);
      } else if (entry.variant !== variant) {
        // רק סמן שהשתנה נוגע ב-DOM (לא 120 סמנים בכל רינדור)
        entry.marker.setIcon(this.#icon(variant, entry.mode));
        entry.marker.setZIndexOffset(zIndexOf(variant));
        entry.variant = variant;
      }
    }

    for (const [id, entry] of this.markers) {
      if (!seen.has(id)) {
        this.group.removeLayer(entry.marker);
        this.markers.delete(id);
      }
    }

    this.#updateLabel(focusedId);
  }

  /** הצגה/הסתרה של כל השכבה (למשל בלשונית אחרת) */
  setVisible(visible) {
    if (visible && !this.map.hasLayer(this.group)) this.group.addTo(this.map);
    if (!visible && this.map.hasLayer(this.group)) this.map.removeLayer(this.group);
  }

  clear() {
    this.group.clearLayers();
    this.markers.clear();
    this.labelledId = null;
  }

  // תווית שם קבועה מעל התחנה המוצגת
  #updateLabel(focusedId) {
    if (this.labelledId === focusedId && this.markers.get(focusedId)?.marker.getTooltip()) return;

    const prev = this.markers.get(this.labelledId);
    prev?.marker.unbindTooltip();
    this.labelledId = null;

    const entry = this.markers.get(focusedId);
    if (!entry) return;

    const label = document.createElement('span');
    label.textContent = entry.name; // textContent – בטוח מ-XSS
    entry.marker
      .bindTooltip(label, {
        permanent: true,
        direction: 'top',
        offset: [0, -20],
        className: 'stop-label',
        interactive: false
      })
      .openTooltip();
    this.labelledId = focusedId;
  }
}

/** fitBounds לחלק הגלוי של המסך */
export function fitVisible(map, bounds, occlusion = { bottom: 0, right: 0 }) {
  if (!bounds) return;
  map.fitBounds(bounds, {
    paddingTopLeft: [28, (occlusion.top ?? 80) + 16],
    paddingBottomRight: [28 + (occlusion.right ?? 0), 36 + (occlusion.bottom ?? 0)],
    maxZoom: 18,
    animate: true
  });
}

// ---------- מסלול הליכה על המפה ----------

const FLAG_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6Z"/></svg>';

export class RouteLayer {
  constructor(map) {
    this.map = map;
    this.group = L.layerGroup().addTo(map);
    this.latLngs = [];
  }

  show(model) {
    this.clear();
    this.latLngs = model.pts.map((p) => [p.lat, p.lng]);

    const lineOpts = { interactive: false, lineCap: 'round', lineJoin: 'round' };
    this.casing = L.polyline(this.latLngs, { ...lineOpts, color: '#ffffff', weight: 11, opacity: 1 }).addTo(this.group);
    this.walked = L.polyline([], { ...lineOpts, color: '#94a3b8', weight: 6, opacity: 0.9 }).addTo(this.group);
    this.line = L.polyline(this.latLngs, { ...lineOpts, color: '#2563eb', weight: 6, opacity: 1 }).addTo(this.group);

    // רמזורים לאורך המסלול
    const signalIcon = L.divIcon({
      className: 'crossing-marker',
      html: '<div class="crossing-dot"><i></i><i></i><i></i></div>',
      iconSize: [12, 22],
      iconAnchor: [6, 11]
    });
    for (const c of model.crossings?.list ?? []) {
      if (!c.signal) continue;
      L.marker([c.lat, c.lng], { icon: signalIcon, interactive: false, keyboard: false }).addTo(this.group);
    }

    const start = this.latLngs[0];
    const end = this.latLngs[this.latLngs.length - 1];
    L.circleMarker(start, {
      radius: 7,
      color: '#ffffff',
      weight: 3,
      fillColor: '#2563eb',
      fillOpacity: 1,
      interactive: false
    }).addTo(this.group);

    L.marker(end, {
      icon: L.divIcon({
        className: 'route-dest',
        html: `<div class="route-dest-pin">${FLAG_SVG}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 40]
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 900
    }).addTo(this.group);
  }

  /** צובע באפור את מה שכבר נהלך */
  setProgress(snap) {
    if (!this.line || !snap?.point) return;
    const cut = snap.index + 1;
    const p = [snap.point.lat, snap.point.lng];
    this.walked.setLatLngs([...this.latLngs.slice(0, cut), p]);
    this.line.setLatLngs([p, ...this.latLngs.slice(cut)]);
  }

  bounds() {
    return this.latLngs.length ? L.latLngBounds(this.latLngs) : null;
  }

  /** מציג את כל המסלול בחלק הגלוי של המסך */
  fit(occlusion = { bottom: 0, right: 0 }) {
    fitVisible(this.map, this.bounds(), occlusion);
  }

  clear() {
    this.group.clearLayers();
    this.latLngs = [];
    this.line = null;
    this.walked = null;
    this.casing = null;
  }
}

// ---------- מסלול תחבורה ציבורית על המפה ----------

/**
 * מציג מסלול רב-אמצעי: קטעי הליכה מנוקדים, קווי אוטובוס/רכבת בצבע הקו,
 * תחנות עלייה/ירידה בולטות ותחנות ביניים קטנות.
 * colorOf(leg) – צבע לכל רגל (מגיע מ-transit-ui כדי לשמור על צבעים אחידים בכל האפליקציה).
 */
export class TransitLayer {
  constructor(map) {
    this.map = map;
    this.group = L.layerGroup().addTo(map);
    this.latLngs = [];
  }

  show(itinerary, colorOf) {
    this.clear();
    const lineOpts = { interactive: false, lineCap: 'round', lineJoin: 'round' };

    for (const leg of itinerary.legs) {
      const pts = leg.geometry?.length
        ? leg.geometry
        : [[leg.from.lat, leg.from.lng], [leg.to.lat, leg.to.lng]];
      this.latLngs.push(...pts);

      if (leg.mode === 'walk') {
        L.polyline(pts, { ...lineOpts, color: '#ffffff', weight: 8, opacity: 0.9 }).addTo(this.group);
        L.polyline(pts, { ...lineOpts, color: '#475569', weight: 4.5, dashArray: '1 9' }).addTo(this.group);
        continue;
      }

      const color = colorOf(leg);
      L.polyline(pts, { ...lineOpts, color: '#ffffff', weight: 11 }).addTo(this.group);
      L.polyline(pts, { ...lineOpts, color, weight: 6.5 }).addTo(this.group);

      for (const s of leg.stops ?? []) {
        if (!Number.isFinite(s.lat)) continue;
        L.circleMarker([s.lat, s.lng], {
          radius: 3.5, color, weight: 2, fillColor: '#ffffff', fillOpacity: 1, interactive: false
        }).addTo(this.group);
      }
      for (const s of [leg.from, leg.to]) {
        if (!Number.isFinite(s.lat)) continue;
        L.circleMarker([s.lat, s.lng], {
          radius: 7, color, weight: 3.5, fillColor: '#ffffff', fillOpacity: 1, interactive: false
        }).addTo(this.group);
      }
    }

    const first = itinerary.legs[0];
    const last = itinerary.legs[itinerary.legs.length - 1];
    L.circleMarker([first.from.lat, first.from.lng], {
      radius: 7, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1, interactive: false
    }).addTo(this.group);

    L.marker([last.to.lat, last.to.lng], {
      icon: L.divIcon({
        className: 'route-dest',
        html: `<div class="route-dest-pin">${FLAG_SVG}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 40]
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 900
    }).addTo(this.group);
  }

  bounds() {
    return this.latLngs.length ? L.latLngBounds(this.latLngs) : null;
  }

  fit(occlusion) {
    fitVisible(this.map, this.bounds(), occlusion);
  }

  clear() {
    this.group.clearLayers();
    this.latLngs = [];
  }
}

// ---------- אוטובוסים בזמן אמת ----------

const VEHICLE_TICK_MS = 250;        // עדכון מיקום על המסך (4 פעמים בשנייה – חלק, וחסכוני בסוללה)
const VEHICLE_CORRECT_MS = 2500;    // מיקום אמיתי חדש: מחליקים אליו במשך הזמן הזה
const VEHICLE_JUMP_M = 1500;        // פער גדול מזה (אוטובוס אחר / נתון ישן) – קופצים בלי החלקה

/**
 * אוטובוסים בדרך (מיקום GPS מ-SIRI) כתגית בצבע הקו עם מספר הקו.
 * בין עדכון לעדכון האוטובוס ממשיך לנסוע לפי המודל ב-vehicle-motion.js (מהירות ממוצעת בין תחנות),
 * וכשמגיע מיקום אמיתי – הפער מתוקן בהדרגה, בלי קפיצה.
 * vehicles = [{ id, lat, lng, recordedAt, line, color, mode, highlight,
 *               motion: { path, stops, holdUntil } | { target: { lat, lng, at } } }]
 */
// מיקום GPS מאומת = דגימה עדכנית מ-SIRI. ישן יותר (או בלי חותמת זמן) = חלקי: האוטובוס מוערך לפי לוח הזמנים
const GPS_VERIFIED_MS = 90 * 1000;

export function gpsStatus(v, now = Date.now()) {
  const at = v.recordedAt ? Date.parse(v.recordedAt) : NaN;
  return Number.isFinite(at) && now - at <= GPS_VERIFIED_MS ? 'ok' : 'partial';
}

export class VehiclesLayer {
  constructor(map, { onSelect = null } = {}) {
    this.map = map;
    this.onSelect = onSelect;
    this.group = L.layerGroup().addTo(map);
    this.markers = new Map(); // id -> { marker, key, data, model, offset, offsetAt }
    this.timer = null;
  }

  render(vehicles) {
    const now = Date.now();
    const seen = new Set();
    for (const raw of vehicles ?? []) {
      if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) continue;
      const v = { ...raw, gps: gpsStatus(raw, now) };
      seen.add(v.id);
      const key = `${v.line}|${v.color}|${v.mode}|${v.highlight ? 1 : 0}|${v.gps}`;
      const fixAt = v.recordedAt ? Date.parse(v.recordedAt) : now;
      const model = createMotion({ fix: { lat: v.lat, lng: v.lng, at: fixAt }, ...(v.motion ?? {}) });
      const [lat, lng] = model.positionAt(now);
      let entry = this.markers.get(v.id);
      if (!entry) {
        const marker = L.marker([lat, lng], {
          icon: this.#icon(v),
          keyboard: false,
          zIndexOffset: v.highlight ? 800 : 500,
          title: v.title ?? ''
        });
        entry = { marker, key, data: v, model, offset: [0, 0], offsetAt: now };
        if (this.onSelect) marker.on('click', () => this.onSelect(entry.data));
        marker.addTo(this.group);
        this.markers.set(v.id, entry);
      } else {
        if (entry.key !== key) {
          entry.marker.setIcon(this.#icon(v));
          entry.marker.setZIndexOffset(v.highlight ? 800 : 500);
          entry.key = key;
        }
        // הפער בין איפה שהאוטובוס מוצג עכשיו לבין המודל החדש – נסגר בהדרגה
        const shown = entry.marker.getLatLng();
        const far = this.map.distance(shown, [lat, lng]) > VEHICLE_JUMP_M || document.hidden;
        entry.offset = far ? [0, 0] : [shown.lat - lat, shown.lng - lng];
        entry.offsetAt = now;
        entry.data = v;
        entry.model = model;
        if (far) entry.marker.setLatLng([lat, lng]);
      }
    }
    for (const [id, entry] of this.markers) {
      if (seen.has(id)) continue;
      this.group.removeLayer(entry.marker);
      this.markers.delete(id);
    }
    this.#schedule();
  }

  clear() {
    this.render([]);
  }

  setVisible(visible) {
    if (visible && !this.map.hasLayer(this.group)) this.group.addTo(this.map);
    if (!visible && this.map.hasLayer(this.group)) this.map.removeLayer(this.group);
    this.#schedule();
  }

  /** הטיימר רץ רק כשיש אוטובוסים שזזים (או שעוד מתקנים אליהם) והשכבה על המפה */
  #schedule() {
    const active = this.map.hasLayer(this.group) &&
      [...this.markers.values()].some((e) => e.model.moving || e.offset[0] || e.offset[1]);
    if (active && !this.timer) this.timer = setInterval(() => this.#tick(), VEHICLE_TICK_MS);
    if (!active && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  #tick() {
    // בזמן אנימציית זום Leaflet מזיז את הסמנים בעצמו; ברקע אין טעם לצייר
    if (document.hidden || this.map._animatingZoom) return;
    const now = Date.now();
    let settling = false;
    for (const e of this.markers.values()) {
      const hasOffset = !!(e.offset[0] || e.offset[1]);
      if (!e.model.moving && !hasOffset) continue;
      const [lat, lng] = e.model.positionAt(now);
      let [dLat, dLng] = [0, 0];
      if (hasOffset) {
        const p = Math.min(1, (now - e.offsetAt) / VEHICLE_CORRECT_MS);
        const k = 1 - p * p * (3 - 2 * p); // smoothstep: מתחיל ומסיים בעדינות
        [dLat, dLng] = [e.offset[0] * k, e.offset[1] * k];
        if (p >= 1) e.offset = [0, 0];
        else settling = true;
      }
      e.marker.setLatLng([lat + dLat, lng + dLng]);
    }
    if (!settling) this.#schedule();
  }

  #icon(v) {
    const label = String(v.line ?? '').slice(0, 5).replace(/[<>&"']/g, '');
    const color = /^#[0-9a-f]{3,8}$/i.test(v.color ?? '') ? v.color : '#0d9488';
    // iconSize: null – הגודל לפי התוכן; המרכוז ב-CSS (translate -50%)
    return L.divIcon({
      className: 'vehicle-marker',
      html: `<div class="vehicle-pin${v.highlight ? ' is-highlight' : ''} gps-${v.gps}" style="--c:${color}">${MODE_SVG[v.mode] ?? BUS_SVG}<b>${label}</b></div>`,
      iconSize: null,
      iconAnchor: [0, 0]
    });
  }
}


// ---------- סיבוב המפה לפי כיוון ההליכה (Heading-up) ----------

/**
 * Leaflet לא תומך בסיבוב מובנה. במקום תוסף כבד:
 * מגדילים את מכולת המפה לריבוע באורך האלכסון של המסך, וממרכזים אותה,
 * ואז מסובבים אותה ב-CSS (על ה-GPU, זול בסוללה). כך הפינות לעולם לא נחשפות.
 * במצב הזה גרירה וזום בתנועות מושבתים – המפה עוקבת אחרי המשתמש.
 */
const USER_ROTATE_START_DEG = 14;   // כמה צריך לסובב באצבעות לפני שהמפה עוברת למצב מסובב

export class MapRotator {
  constructor(map) {
    this.map = map;
    this.el = map.getContainer();
    this.active = false;
    this.angle = 0;    // הזווית המוצגת (מצטברת, כדי שהסיבוב תמיד ילך בדרך הקצרה)
    this.heading = 0;
    this.manual = false; // true = המשתמש סובב ידנית (ולא כיוון ההליכה)
    this.onUserRotate = null;
    this.onResize = () => this.#layout();
  }

  enable() {
    if (this.active && this.manual) {
      // ניווט התחיל בזמן שהמשתמש סובב ידנית: הסיבוב עובר לכיוון ההליכה
      this.manual = false;
      this.#setInteractions(false);
      this.onUserRotate?.(this.angle);
      return;
    }
    if (this.active) return;
    this.active = true;
    document.body.classList.add('map-rotating');
    this.#layout();
    this.#setInteractions(false);
    window.addEventListener('resize', this.onResize);
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    this.manual = false;
    window.removeEventListener('resize', this.onResize);
    document.body.classList.remove('map-rotating');
    this.#keepCenter(() => {
      Object.assign(this.el.style, { width: '', height: '', left: '', top: '', transform: '' });
      this.angle = 0;
      this.heading = 0;
    });
    this.#setInteractions(true);
    this.onUserRotate?.(0);
  }

  // ---------- סיבוב ידני (שתי אצבעות) ----------

  /**
   * המשתמש מסובב את המפה באצבעות. כל עוד לא סובבו – Leaflet מטפל בגרירה ובזום כרגיל.
   * ברגע שהסיבוב עובר סף קטן עוברים למצב מסובב: המפה מוגדלת לאלכסון המסך (כמו בניווט),
   * ואת הגרירה והזום עושה הקוד כאן, כי Leaflet לא מכיר מכולה מסובבת.
   */
  enableUserRotate(onChange) {
    this.onUserRotate = onChange;
    const el = this.el;
    const g = { pts: new Map(), last: null, start: null, pinching: false, dragging: false };

    const pt = (t) => ({ x: t.clientX, y: t.clientY });
    const pair = () => {
      const [a, b] = [...g.pts.values()];
      return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(b.x - a.x, b.y - a.y), ang: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
    };
    const norm = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

    // וקטור מסך -> וקטור במכולה המסובבת
    const toLocal = (dx, dy) => {
      const r = (this.angle * Math.PI) / 180;
      return [dx * Math.cos(r) + dy * Math.sin(r), -dx * Math.sin(r) + dy * Math.cos(r)];
    };

    // נקודת המסך (cx, cy) -> נקודה במכולת המפה (מתחשב בסיבוב ובגודל המכולה)
    const containerPoint = (cx, cy) => {
      const size = this.map.getSize();
      const [lx, ly] = toLocal(cx - window.innerWidth / 2, cy - window.innerHeight / 2);
      return L.point(size.x / 2 + lx, size.y / 2 + ly);
    };

    const panScreen = (dx, dy) => {
      const [x, y] = toLocal(dx, dy);
      this.map.panBy([x, y], { animate: false });
    };

    /** מציב את הנקודה הגיאוגרפית ll מתחת לנקודת המסך (cx, cy) בזום ובסיבוב הנוכחיים – כך הסיבוב והזום נעשים סביב האצבעות */
    const placeUnder = (ll, zoom, cx, cy) => {
      const map = this.map;
      const size = map.getSize();
      const p = containerPoint(cx, cy);
      const centerPx = map.project(ll, zoom).subtract(p.subtract(size.divideBy(2)));
      map._move(map.unproject(centerPx, zoom), zoom, { pinch: true });
    };

    const begin = () => {
      g.last = g.pts.size === 2 ? pair() : null;
      g.start = g.last ? { ...g.last } : null;
      if (g.start) {
        g.start.zoom = this.map.getZoom();
        g.start.ll = this.map.containerPointToLatLng(containerPoint(g.start.cx, g.start.cy));
      }
      g.pinching = false;
    };

    // שתי אצבעות: הזום והסיבוב שלנו (לא של Leaflet), כדי שלא יתנגשו באמצע תנועה.
    // אצבע אחת: Leaflet גורר כרגיל, ובמצב מסובב – אנחנו.
    this.map.touchZoom.disable();

    el.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) g.pts.set(t.identifier, pt(t));
      if (g.pts.size > 2) for (const k of [...g.pts.keys()].slice(2)) g.pts.delete(k);
      begin();
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      const prev = new Map(g.pts);
      for (const t of e.changedTouches) if (g.pts.has(t.identifier)) g.pts.set(t.identifier, pt(t));
      if (this.active && !this.manual) return; // ניווט: המפה עוקבת אחרי המשתמש

      if (g.pts.size === 2 && g.last) {
        const now = pair();
        e.preventDefault();
        let dAng = norm(now.ang - g.last.ang);
        if (!g.pinching) {
          g.pinching = true;
          this.map.fire('dragstart'); // נוגעים במפה = מפסיקים לעקוב אחרי המיקום
          this.map._moveStart(true, false);
        }
        if (!this.active && Math.abs(norm(now.ang - g.start.ang)) > USER_ROTATE_START_DEG) {
          this.#startManual();
          dAng = norm(now.ang - g.start.ang); // כל מה שסובב עד עכשיו, בלי "לאבד" את הסף
        }
        if (this.active && this.manual) {
          document.body.classList.add('map-gesture');
          this.setAngle(this.angle + dAng); // האצבעות מסתובבות עם כיוון השעון -> המפה מסתובבת איתן
        }
        const zoom = g.start.dist > 10 && now.dist > 10
          ? Math.max(this.map.getMinZoom(), Math.min(this.map.getMaxZoom(), g.start.zoom + Math.log2(now.dist / g.start.dist)))
          : this.map.getZoom();
        placeUnder(g.start.ll, zoom, now.cx, now.cy);
        g.last = now;
      } else if (g.pts.size === 1 && this.active && this.manual) {
        const [id, p] = [...g.pts.entries()][0];
        const before = prev.get(id);
        if (before) {
          e.preventDefault();
          document.body.classList.add('map-gesture');
          if (!g.dragging) {
            g.dragging = true;
            this.map.fire('dragstart');
          }
          panScreen(before.x - p.x, before.y - p.y);
        }
      }
    }, { passive: false });

    const end = (e) => {
      const wasPinching = g.pinching;
      for (const t of e.changedTouches) g.pts.delete(t.identifier);
      begin();
      if (g.pts.size === 0) {
        document.body.classList.remove('map-gesture');
        g.dragging = false;
      }
      // סיום זום באצבעות: מצמידים לצעד הזום של המפה (מונפש כשלא מסובבים)
      if (wasPinching && g.pts.size < 2 && !(this.active && !this.manual)) {
        this.map.setZoom(this.map.getZoom(), { animate: !this.manual });
      }
    };
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });

    // מחשב / עכבר: Shift + גרירה מסובב. בגרירה רגילה במצב מסובב – הזזה
    let mouse = null;
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.shiftKey && !this.active) this.#startManual();
      if (this.active && this.manual) {
        document.body.classList.add('map-gesture');
        this.map.fire('dragstart');
        mouse = { x: e.clientX, y: e.clientY, rotate: e.shiftKey, cx: window.innerWidth / 2, cy: window.innerHeight / 2 };
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    window.addEventListener('mousemove', (e) => {
      if (!mouse) return;
      if (mouse.rotate) {
        const a0 = Math.atan2(mouse.y - mouse.cy, mouse.x - mouse.cx);
        const a1 = Math.atan2(e.clientY - mouse.cy, e.clientX - mouse.cx);
        this.setAngle(this.angle + norm(((a1 - a0) * 180) / Math.PI));
      } else {
        panScreen(mouse.x - e.clientX, mouse.y - e.clientY);
      }
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    });
    window.addEventListener('mouseup', () => {
      mouse = null;
      document.body.classList.remove('map-gesture');
    });
    el.addEventListener('wheel', (e) => {
      if (!(this.active && this.manual)) return;
      e.preventDefault();
      this.map.setZoom(this.map.getZoom() - Math.sign(e.deltaY) * 0.5);
    }, { passive: false });
  }

  #startManual() {
    if (this.active) return;
    this.active = true;
    this.manual = true;
    document.body.classList.add('map-rotating');
    this.#layout();
    this.#setInteractions(false);
    window.addEventListener('resize', this.onResize);
  }

  /** זווית סיבוב המפה בפועל (מעלות, בכיוון השעון). 0 = צפון למעלה */
  setAngle(deg) {
    this.angle = deg;
    this.heading = -deg;
    this.el.style.transform = `rotate(${deg}deg)`;
    this.onUserRotate?.(deg);
  }

  /** חזרה לצפון למעלה (כפתור המצפן). הסיבוב מונפש והמפה חוזרת למצב רגיל */
  resetNorth() {
    if (!this.active || !this.manual) return;
    document.body.classList.remove('map-gesture');
    // מנרמלים ל-(-180,180] בלי אנימציה, כדי שהחזרה תהיה בדרך הקצרה ולא "סיבוב מלא"
    const short = ((((this.angle + 180) % 360) + 360) % 360) - 180;
    this.el.style.transition = 'none';
    this.angle = short;
    this.el.style.transform = `rotate(${short}deg)`;
    void this.el.offsetWidth;
    this.el.style.transition = '';
    this.setAngle(0);
    setTimeout(() => {
      if (this.manual && this.angle === 0) this.disable();
    }, 400);
  }

  setHeading(deg) {
    if (!this.active || !Number.isFinite(deg)) return;
    this.heading = deg;
    const target = -deg;
    const delta = ((((target - this.angle) % 360) + 540) % 360) - 180;
    if (Math.abs(delta) < 1.5) return;
    this.angle += delta;
    this.el.style.transform = `rotate(${this.angle}deg)`;
  }

  /** מציב נקודה במרכז המסך + offsetY פיקסלים כלפי מטה (בציר המסך, אחרי הסיבוב) */
  follow(latLng, zoom, offsetY = 0) {
    const z = zoom ?? this.map.getZoom();
    const h = this.active ? (this.heading * Math.PI) / 180 : 0;
    // וקטור בציר המכולה שמתאים ל-(0, offsetY) בציר המסך: R(heading)·(0, k)
    const v = L.point(-offsetY * Math.sin(h), offsetY * Math.cos(h));
    const center = this.map.unproject(this.map.project(latLng, z).subtract(v), z);
    this.map.setView(center, z, { animate: true, duration: 0.5, easeLinearity: 0.5 });
  }

  #layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const d = Math.ceil(Math.hypot(w, h));
    this.#keepCenter(() => {
      Object.assign(this.el.style, {
        width: `${d}px`,
        height: `${d}px`,
        left: `${Math.round((w - d) / 2)}px`,
        top: `${Math.round((h - d) / 2)}px`
      });
    });
  }

  /** שינוי גודל המכולה בלי שהתוכן "יקפוץ": invalidateSize({pan:false}) משאיר את הפינה, ולא את המרכז */
  #keepCenter(change) {
    const map = this.map;
    const center = map.getCenter();
    const zoom = map.getZoom();
    change();
    map.invalidateSize({ pan: false });
    map._resetView(center, zoom);
  }

  #setInteractions(on) {
    const m = this.map;
    for (const handler of [m.dragging, m.doubleClickZoom, m.scrollWheelZoom, m.boxZoom, m.keyboard]) {
      if (!handler) continue;
      if (on) handler.enable();
      else handler.disable();
    }
  }
}
