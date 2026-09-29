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

  function createBoatMarker() {
    const element = document.createElement('div');
    element.className = 'boat';
    element.title = 'Position du bateau';

    return new window.maplibregl.Marker({
      element,
      anchor: 'bottom'
    });
  }

  return {
    updateBoatPosition(position) {
      const coordinates = [position.longitude, position.latitude];

      if (!boatMarker) {
        boatMarker = createBoatMarker();
        boatMarker.setLngLat(coordinates).addTo(map);
      } else {
        boatMarker.setLngLat(coordinates);
      }
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