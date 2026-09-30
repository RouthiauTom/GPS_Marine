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

  map.on('load', renderTrack);

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