// שכבת המפה: Leaflet + אריחים (MapTiler אם יש מפתח, אחרת OSM), סמן משתמש ותחנות.
/* global L */

import { MAPTILER_KEY, STOPS_DETAIL_ZOOM } from '../config.js';
import { createMotion } from './vehicle-motion.js';

const BUS_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 16c0 .9.4 1.7 1 2.2V20c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1h8v1c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1.8c.6-.5 1-1.3 1-2.2V6c0-3.5-3.6-4-8-4S4 2.5 4 6v10Zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM18 11H6V6h12v5Z"/></svg>';

const RAIL_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2C8 2 4 2.5 4 6v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5v.5h2.2l2-2h3.6l2 2H18v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-3.6-4-8-4ZM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3.5-7H6V6h5v4Zm2 0V6h5v4h-5Zm3.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/></svg>';
const LIGHTRAIL_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M19 16.9V8a5 5 0 0 0-4.5-5l.8-1.5-1.3-.5L13 3h-2L9.9 1l-1.3.5.8 1.5A5 5 0 0 0 5 8v8.9A3 3 0 0 0 7 22h10a3 3 0 0 0 2-5.1ZM8 19.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm8 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM17 13H7V8h10v5Z"/></svg>';
const MODE_SVG = { bus: BUS_SVG, rail: RAIL_SVG, lightrail: LIGHTRAIL_SVG };

export function createMap(elementId, center, zoom) {
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

  if (MAPTILER_KEY) {
    L.tileLayer(`https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${encodeURIComponent(MAPTILER_KEY)}`, {
      ...common,
      maxZoom: 20,
      attribution:
        '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
  } else {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      ...common,
      maxZoom: 19,
      className: 'tiles-soft',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
  }

  map.attributionControl.setPrefix(false);

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
    for (const v of vehicles ?? []) {
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) continue;
      seen.add(v.id);
      const key = `${v.line}|${v.color}|${v.mode}|${v.highlight ? 1 : 0}`;
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
      html: `<div class="vehicle-pin${v.highlight ? ' is-highlight' : ''}" style="--c:${color}">${MODE_SVG[v.mode] ?? BUS_SVG}<b>${label}</b></div>`,
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
export class MapRotator {
  constructor(map) {
    this.map = map;
    this.el = map.getContainer();
    this.active = false;
    this.angle = 0;    // הזווית המוצגת (מצטברת, כדי שהסיבוב תמיד ילך בדרך הקצרה)
    this.heading = 0;
    this.onResize = () => this.#layout();
  }

  enable() {
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
    window.removeEventListener('resize', this.onResize);
    document.body.classList.remove('map-rotating');
    Object.assign(this.el.style, { width: '', height: '', left: '', top: '', transform: '' });
    this.angle = 0;
    this.heading = 0;
    this.map.invalidateSize({ pan: false });
    this.#setInteractions(true);
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
    Object.assign(this.el.style, {
      width: `${d}px`,
      height: `${d}px`,
      left: `${Math.round((w - d) / 2)}px`,
      top: `${Math.round((h - d) / 2)}px`
    });
    this.map.invalidateSize({ pan: false });
  }

  #setInteractions(on) {
    const m = this.map;
    for (const handler of [m.dragging, m.touchZoom, m.doubleClickZoom, m.scrollWheelZoom, m.boxZoom, m.keyboard]) {
      if (!handler) continue;
      if (on) handler.enable();
      else handler.disable();
    }
  }
}
