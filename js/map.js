export function initializeMap(containerId) {
  const map = new window.maplibregl.Map({
    container: containerId,
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [-1.7, 49.35],
    zoom: 9,
    attributionControl: true
  });

  map.addControl(new window.maplibregl.NavigationControl(), 'bottom-right');

  let boatMarker = null;
  let trackCoordinates = [];
  const waypointMarkers = new Map();
  const routePointMarkers = new Map();
  let routes = [];
  let activeRoute = null;

  function trackFeatureCollection() {
    if (trackCoordinates.length < 2) {
      return { type: 'FeatureCollection', features: [] };
    }

    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: trackCoordinates
        }
      }]
    };
  }

  function renderTrack() {
    if (!map.isStyleLoaded()) return;

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
    if (!map.isStyleLoaded()) return;

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
    element.textContent = String(number);
    element.title = `${name} · point ${number}`;

    return new window.maplibregl.Marker({ element, anchor: 'center' })
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
      marker.getElement().textContent = String(item.number);
      marker.getElement().title = `${item.name} · point ${item.number}`;
      marker.getElement().classList.toggle('is-draft', item.isDraft);
      marker.getElement().style.backgroundColor = item.color;
    });
  }

  function renderRoutesAndPoints() {
    renderRoutes();
    renderRoutePoints();
  }

  map.on('load', () => {
    renderTrack();
    renderRoutesAndPoints();
  });

  function createBoatMarker() {
    const element = document.createElement('div');
    element.className = 'boat';
    element.title = 'Position du bateau';

    return new window.maplibregl.Marker({
      element,
      anchor: 'bottom',
      rotationAlignment: 'map'
    });
  }

  function createWaypointMarker(waypoint, index) {
    const element = document.createElement('div');
    element.className = 'waypoint-marker';
    const label = document.createElement('span');
    label.textContent = String(index + 1);
    element.append(label);
    element.title = waypoint.name;

    return new window.maplibregl.Marker({ element, anchor: 'bottom' })
      .setLngLat([waypoint.longitude, waypoint.latitude])
      .addTo(map);
  }

  return {
    updateBoatPosition(position, course = null) {
      const coordinates = [position.longitude, position.latitude];

      if (!boatMarker) {
        boatMarker = createBoatMarker();
        boatMarker.setLngLat(coordinates).addTo(map);
      } else {
        boatMarker.setLngLat(coordinates);
      }

      boatMarker.setRotation(Number.isFinite(course) ? course : 0);
    },

    updateTrack(track) {
      trackCoordinates = track.points.map(point => [point.longitude, point.latitude]);
      renderTrack();
    },

    updateWaypoints(waypoints) {
      const waypointIds = new Set(waypoints.map(waypoint => waypoint.id));

      for (const [id, marker] of waypointMarkers) {
        if (!waypointIds.has(id)) {
          marker.remove();
          waypointMarkers.delete(id);
        }
      }

      waypoints.forEach((waypoint, index) => {
        let marker = waypointMarkers.get(waypoint.id);
        if (!marker) {
          marker = createWaypointMarker(waypoint, index);
          waypointMarkers.set(waypoint.id, marker);
        }

        marker.getElement().querySelector('span').textContent = String(index + 1);
        marker.getElement().title = waypoint.name;
        marker.setLngLat([waypoint.longitude, waypoint.latitude]);
      });
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

      const bounds = new window.maplibregl.LngLatBounds();
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