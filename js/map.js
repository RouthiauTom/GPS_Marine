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