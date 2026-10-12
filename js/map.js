import * as maplibregl from '../vendor/maplibre-gl/maplibre-gl.mjs';
import { getWaypointType, WAYPOINT_TYPES } from './waypoint.js?v=1.0.0';
import { listOfflineMaps, readOfflineTile, offlineMapStyle, containsBounds } from './offline-maps.js';

maplibregl.addProtocol('marine-offline', async request => {
  const [, id, z, x, y] = request.url.match(/^marine-offline:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/) || [];
  if (!id) throw new Error('Adresse de tuile invalide.');
  return { data: await readOfflineTile(id, z, x, y) };
});
maplibregl.addProtocol('marine-glyphs', async (request, controller) => {
  const range = request.url.match(/\/(\d+-\d+)\.pbf$/)?.[1];
  // This compact offline style includes Latin names; unsupported scripts are omitted.
  if (!['0-255', '256-511'].includes(range)) return { data: new ArrayBuffer(0) };
  const response = await fetch(new URL(`../vendor/fonts/Noto Sans Regular/${range}.pbf`, import.meta.url), { signal: controller.signal });
  if (!response.ok) throw new Error('Police hors ligne absente.');
  return { data: await response.arrayBuffer() };
});

const MIN_MARKER_ZOOM = 12;
const ONLINE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const emptyStyle = () => ({
  version: 8,
  sources: {},
  layers: [{ id: 'offline-background', type: 'background', paint: { 'background-color': '#e2e5e4' } }]
});

export function initializeMap(containerId) {
  const map = new maplibregl.Map({
    container: containerId,
    style: emptyStyle(),
    center: [-1.7, 49.35],
    zoom: 9,
    attributionControl: false
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
  map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-left');

  let styleReady = false;
  let onlineStyle = false;
  let styleRequest = null;
  let mapFailed = false;
  let offlineZone = null;
  let manualZone = null;
  let modeGeneration = 0;
  const mapStatus = document.getElementById('map-status');
  const announceMap = message => {
    mapStatus.textContent = message;
    mapStatus.hidden = !message;
  };
  const offlineMessage = 'Hors connexion · sans fond de carte ni balisage. Traces et repères uniquement.';

  const visibleBounds = () => {
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  };
  const announceOffline = () => {
    if (!offlineZone) { announceMap(offlineMessage); return; }
    const coverage = containsBounds(offlineZone.bounds, visibleBounds()) ? '' : ' · vue partiellement ou totalement hors zone';
    announceMap(`Carte locale : ${offlineZone.name} · sans balisage ni profondeurs${coverage}${mapFailed ? ' · données locales incomplètes' : ''}`);
  };
  async function useOfflineMap(preferred = null) {
    const generation = ++modeGeneration;
    styleRequest?.abort();
    styleRequest = null;
    onlineStyle = false;
    mapFailed = false;
    styleReady = false;
    let zones = [];
    try { zones = (await listOfflineMaps()).filter(zone => zone.status === 'ready'); } catch { /* retain local overlays */ }
    if (generation !== modeGeneration) return;
    const center = map.getCenter();
    offlineZone = zones.find(zone => zone.id === preferred?.id) ||
      zones.find(zone => containsBounds(zone.bounds, [center.lng, center.lat, center.lng, center.lat])) || null;
    map.setStyle(offlineZone ? offlineMapStyle(offlineZone) : emptyStyle(), { diff: false });
    announceOffline();
  }

  async function loadOnlineMap() {
    if (manualZone) { useOfflineMap(manualZone); return; }
    if (!navigator.onLine) { useOfflineMap(); return; }
    ++modeGeneration;
    styleRequest?.abort();
    const controller = new AbortController();
    styleRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    announceMap('Chargement du fond de carte…');
    try {
      const response = await fetch(ONLINE_STYLE_URL, { signal: controller.signal });
      if (!response.ok) throw new Error('Style unavailable');
      const style = await response.json();
      if (controller !== styleRequest || !navigator.onLine) return;
      onlineStyle = true;
      offlineZone = null;
      mapFailed = false;
      styleReady = false;
      map.setStyle(style, { diff: false });
    } catch {
      if (controller !== styleRequest) return;
      onlineStyle = false;
      await useOfflineMap();
      if (!offlineZone) announceMap('Fond de carte indisponible · traces et repères uniquement.');
    } finally {
      clearTimeout(timeout);
      if (styleRequest === controller) styleRequest = null;
    }
  }

  window.addEventListener('offline', () => useOfflineMap(manualZone));
  window.addEventListener('online', loadOnlineMap);
  window.addEventListener('offline-maps-changed', async () => {
    if (manualZone) {
      try { if (!(await listOfflineMaps()).some(zone => zone.id === manualZone.id)) manualZone = null; } catch { manualZone = null; }
    }
    if (!onlineStyle || manualZone) loadOnlineMap();
  });
  map.on('moveend', async () => {
    if (offlineZone) announceOffline();
    if (onlineStyle || manualZone) return;
    try {
      const center = map.getCenter();
      const zone = (await listOfflineMaps()).find(zone => zone.status === 'ready' &&
        containsBounds(zone.bounds, [center.lng, center.lat, center.lng, center.lat]));
      if (!onlineStyle && !manualZone && zone && zone.id !== offlineZone?.id) useOfflineMap(zone);
    } catch { /* Map status already explains that the background is unavailable. */ }
  });
  map.on('error', () => {
    if (offlineZone) { mapFailed = true; announceOffline(); return; }
    if (!onlineStyle) return;
    mapFailed = true;
    announceMap('Carte ou balisage incomplet · vérifiez la connexion.');
  });
  map.on('idle', () => {
    if (onlineStyle && !mapFailed) announceMap('');
  });
  let boatMarker = null;
  let trackCoordinates = [];
  const waypointMarkers = new Map();
  const routePointMarkers = new Map();
  let routes = [];
  let activeRoute = null;
  let navigationRoute = null;
  let navigationTargetIndex = 0;

  function updateMarkerZoomVisibility() {
    const visible = map.getZoom() >= MIN_MARKER_ZOOM;
    [...routePointMarkers.values()].forEach(marker => {
      marker.getElement().style.display = visible ? '' : 'none';
    });
  }

  map.on('zoom', updateMarkerZoomVisibility);

  function trackFeatureCollection() {
    const segments = new Map();
    trackCoordinates.forEach(point => {
      const segmentIndex = Number.isInteger(point.segment) ? point.segment : 0;
      if (!segments.has(segmentIndex)) segments.set(segmentIndex, []);
      segments.get(segmentIndex).push([point.longitude, point.latitude]);
    });
    const coordinates = Array.from(segments.values()).filter(segment => segment.length > 1);

    if (coordinates.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }

    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: {
          type: coordinates.length === 1 ? 'LineString' : 'MultiLineString',
          coordinates: coordinates.length === 1 ? coordinates[0] : coordinates
        }
      }]
    };
  }

  function renderTrack() {
    if (!styleReady) return;

    if (!map.getSource('gps-track')) {
      map.addSource('gps-track', {
        type: 'geojson',
        data: trackFeatureCollection()
      });
      map.addLayer({
        id: 'gps-track-line',
        type: 'line',
        source: 'gps-track',
        paint: {
          'line-color': '#24d6a2',
          'line-width': 4,
          'line-opacity': 0.9
        }
      });
      return;
    }

    map.getSource('gps-track').setData(trackFeatureCollection());
  }

  function routeFeatureCollection() {
    const features = routes
      .filter(route => route.visible !== false && route.points.length > 1)
      .map(route => ({
        type: 'Feature',
        properties: { active: false, name: route.name, color: route.color },
        geometry: {
          type: 'LineString',
          coordinates: route.points.map(point => [point.longitude, point.latitude])
        }
      }));

    if (activeRoute?.points.length > 1) {
      features.push({
        type: 'Feature',
        properties: { active: true, name: activeRoute.name, color: activeRoute.color },
        geometry: {
          type: 'LineString',
          coordinates: activeRoute.points.map(point => [point.longitude, point.latitude])
        }
      });
    }

    return { type: 'FeatureCollection', features };
  }

  function renderRoutes() {
    if (!styleReady) return;

    if (!map.getSource('planned-routes')) {
      map.addSource('planned-routes', {
        type: 'geojson',
        data: routeFeatureCollection()
      });
      map.addLayer({
        id: 'saved-route-lines',
        type: 'line',
        source: 'planned-routes',
        filter: ['==', ['get', 'active'], false],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-opacity': 0.9
        }
      });
      map.addLayer({
        id: 'active-route-line',
        type: 'line',
        source: 'planned-routes',
        filter: ['==', ['get', 'active'], true],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4,
          'line-opacity': 1,
          'line-dasharray': [2, 1]
        }
      });
      return;
    }

    map.getSource('planned-routes').setData(routeFeatureCollection());
  }

  function createRoutePointMarker(point, number, isDraft, name, color) {
    const element = document.createElement('div');
    element.className = isDraft ? 'route-point-marker is-draft' : 'route-point-marker';
    element.style.backgroundColor = color;
    element.textContent = isDraft ? String(number) : '';
    element.title = isDraft ? `${name} · point ${number}` : name;

    return new maplibregl.Marker({ element, anchor: 'center' })
      .setLngLat([point.longitude, point.latitude])
      .addTo(map);
  }

  function renderRoutePoints() {
    const points = [];
    routes.filter(route => route.visible !== false).forEach(route => {
      route.points.forEach((point, index) => {
        points.push({
          key: `${route.id}:${index}`,
          point,
          number: index + 1,
          isDraft: false,
          name: route.name,
          color: route.color
        });
      });
    });
    activeRoute?.points.forEach((point, index) => {
      points.push({
        key: `draft:${index}`,
        point,
        number: index + 1,
        isDraft: true,
        name: activeRoute.name,
        color: activeRoute.color
      });
    });

    const pointKeys = new Set(points.map(item => item.key));
    for (const [key, marker] of routePointMarkers) {
      if (!pointKeys.has(key)) {
        marker.remove();
        routePointMarkers.delete(key);
      }
    }

    points.forEach(item => {
      let marker = routePointMarkers.get(item.key);
      if (!marker) {
        marker = createRoutePointMarker(
          item.point,
          item.number,
          item.isDraft,
          item.name,
          item.color
        );
        routePointMarkers.set(item.key, marker);
      }

      marker.setLngLat([item.point.longitude, item.point.latitude]);
      marker.getElement().textContent = item.isDraft ? String(item.number) : '';
      marker.getElement().title = item.isDraft
        ? `${item.name} · point ${item.number}`
        : item.name;
      marker.getElement().classList.toggle('is-draft', item.isDraft);
      marker.getElement().style.backgroundColor = item.color;
    });

    updateMarkerZoomVisibility();
  }

  function renderRoutesAndPoints() {
    renderRoutes();
    renderRoutePoints();
    renderNavigationTarget();
  }

  function renderNavigationTarget() {
    for (const [key, marker] of routePointMarkers) {
      const element = marker.getElement();
      const selected = key === `${navigationRoute?.id}:${navigationTargetIndex}`;
      element.classList.toggle('is-navigation-target', selected);
      if (selected) element.textContent = String(navigationTargetIndex + 1);
      else if (!element.classList.contains('is-draft')) element.textContent = '';
    }
    if (!styleReady) return;
    const target = navigationRoute?.points[navigationTargetIndex];
    const previous = navigationRoute?.points[navigationTargetIndex - 1];
    const features = [];
    if (target) features.push({ type: 'Feature', properties: {},
      geometry: { type: 'Point', coordinates: [target.longitude, target.latitude] } });
    if (previous && target) features.push({ type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[previous.longitude, previous.latitude], [target.longitude, target.latitude]] } });
    const data = { type: 'FeatureCollection', features };
    if (map.getSource('navigation-target')) {
      map.getSource('navigation-target').setData(data);
      return;
    }
    map.addSource('navigation-target', { type: 'geojson', data });
    map.addLayer({ id: 'navigation-leg', type: 'line', source: 'navigation-target',
      filter: ['==', '$type', 'LineString'],
      paint: { 'line-color': '#ffbe24', 'line-width': 6, 'line-opacity': 0.8 } });
    map.addLayer({ id: 'navigation-target-point', type: 'circle', source: 'navigation-target',
      filter: ['==', '$type', 'Point'],
      paint: { 'circle-radius': 11, 'circle-color': '#ffbe24', 'circle-stroke-color': '#152522', 'circle-stroke-width': 3 } });
  }

  function addOpenSeaMapSeamarks() {
    map.addSource('openseamap-seamarks', {
      type: 'raster',
      tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openseamap.org/">OpenSeaMap</a> contributors · <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC BY-SA 2.0</a>'
    });
    map.addLayer({
      id: 'openseamap-seamarks',
      type: 'raster',
      source: 'openseamap-seamarks',
      paint: { 'raster-opacity': 1 }
    });
  }

  map.on('style.load', () => {
    styleReady = true;
    if (onlineStyle) addOpenSeaMapSeamarks();
    renderTrack();
    renderRoutesAndPoints();
  });

  // Start independently of remote tiles so local overlays always work.
  loadOnlineMap();

  function createBoatMarker() {
    const element = document.createElement('div');
    element.className = 'boat';
    element.title = 'Position du bateau';

    return new maplibregl.Marker({
      element,
      anchor: 'bottom',
      rotationAlignment: 'map'
    });
  }

  function createWaypointMarker(waypoint) {
    const type = getWaypointType(waypoint.type);
    const element = document.createElement('div');
    element.className = `waypoint-marker waypoint-marker-${type.id}`;
    const label = document.createElement('span');
    label.textContent = type.marker;
    element.append(label);
    element.title = `${type.label} · ${waypoint.name}`;

    return new maplibregl.Marker({ element, anchor: 'bottom' })
      .setLngLat([waypoint.longitude, waypoint.latitude])
      .addTo(map);
  }

  function updateWaypointMarker(marker, waypoint) {
    const type = getWaypointType(waypoint.type);
    const element = marker.getElement();
    WAYPOINT_TYPES.forEach(item => element.classList.remove(`waypoint-marker-${item.id}`));
    element.classList.add(`waypoint-marker-${type.id}`);
    element.querySelector('span').textContent = type.marker;
    element.title = `${type.label} · ${waypoint.name}`;
    marker.setLngLat([waypoint.longitude, waypoint.latitude]);
  }

  return {
    getVisibleBounds: visibleBounds,
    showOfflineRegion(zone) {
      manualZone = zone;
      map.fitBounds([[zone.bounds[0], zone.bounds[1]], [zone.bounds[2], zone.bounds[3]]], { padding: 35, duration: 0 });
      useOfflineMap(zone);
    },
    useAutomaticMap() { manualZone = null; loadOnlineMap(); },
    updateBoatPosition(position, course = null) {
      const coordinates = [position.longitude, position.latitude];

      if (!boatMarker) {
        boatMarker = createBoatMarker();
        boatMarker.setLngLat(coordinates).addTo(map);
      } else {
        boatMarker.setLngLat(coordinates);
      }

      boatMarker.setRotation(Number.isFinite(course) ? course : 0);
      boatMarker.getElement().classList.toggle('course-unknown', !Number.isFinite(course));
    },

    setGpsStale(stale) {
      boatMarker?.getElement().classList.toggle('gps-stale', stale);
    },

    updateNavigation(route, targetIndex) {
      navigationRoute = route;
      navigationTargetIndex = targetIndex;
      renderNavigationTarget();
    },

    updateTrack(track) {
      trackCoordinates = track.points;
      renderTrack();
    },

    updateWaypoints(waypoints, hidden = false) {
      const visibleWaypoints = hidden ? [] : waypoints;
      const waypointIds = new Set(visibleWaypoints.map(waypoint => waypoint.id));

      for (const [id, marker] of waypointMarkers) {
        if (!waypointIds.has(id)) {
          marker.remove();
          waypointMarkers.delete(id);
        }
      }

      visibleWaypoints.forEach(waypoint => {
        let marker = waypointMarkers.get(waypoint.id);
        if (!marker) {
          marker = createWaypointMarker(waypoint);
          waypointMarkers.set(waypoint.id, marker);
        }

        updateWaypointMarker(marker, waypoint);
      });

      updateMarkerZoomVisibility();
    },

    setWaypointPlacementMode(enabled) {
      map.getCanvas().classList.toggle('waypoint-placement', enabled);
    },

    onMapClick(handler) {
      const listener = event => handler({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng
      });
      map.on('click', listener);
      return () => map.off('click', listener);
    },

    setRouteCreationMode(enabled) {
      map.getCanvas().classList.toggle('route-creation', enabled);
      if (enabled) map.doubleClickZoom.disable();
      else map.doubleClickZoom.enable();
    },

    updateRoutes(savedRoutes, draftRoute = null) {
      routes = savedRoutes;
      activeRoute = draftRoute;
      renderRoutesAndPoints();
    },

    centerOnRoute(route) {
      if (!route.points.length) return false;

      if (route.points.length === 1) {
        map.flyTo({
          center: [route.points[0].longitude, route.points[0].latitude],
          zoom: Math.max(map.getZoom(), 15),
          essential: true
        });
        return true;
      }

      const bounds = new maplibregl.LngLatBounds();
      route.points.forEach(point => bounds.extend([point.longitude, point.latitude]));
      map.fitBounds(bounds, {
        padding: { top: 190, right: 40, bottom: 110, left: 40 },
        maxZoom: 16,
        duration: 800
      });
      return true;
    },

    centerOnWaypoint(waypoint) {
      map.flyTo({
        center: [waypoint.longitude, waypoint.latitude],
        zoom: Math.max(map.getZoom(), 15),
        essential: true
      });
    },

    centerOnBoat(zoom = Math.max(map.getZoom(), 15)) {
      if (!boatMarker) return false;

      map.flyTo({
        center: boatMarker.getLngLat(),
        zoom,
        essential: true
      });

      return true;
    }
  };
}
