let routes = [];
let activeRoute = null;

const ROUTE_COLORS = [
  '#fa6a5d',
  '#43a9f5',
  '#e5bd38',
  '#b17af2',
  '#28b99a',
  '#e87caf',
  '#8ecb4f',
  '#f18b3c'
];

export function setRoutes(savedRoutes) {
  routes = [...savedRoutes].sort((first, second) => first.createdAt - second.createdAt);
  const usedColors = new Set(routes.map(route => route.color).filter(Boolean));

  routes = routes.map((route, index) => {
    const color = route.color ?? nextRouteColor(usedColors, index);
    usedColors.add(color);
    return { ...route, color, visible: route.visible !== false };
  });

  return getRoutes();
}

export function startRoute(name) {
  if (activeRoute) return activeRoute;

  activeRoute = {
    id: createRouteId(),
    name: name.trim(),
    createdAt: Date.now(),
    color: nextRouteColor(new Set(routes.map(route => route.color)), routes.length),
    visible: true,
    points: []
  };

  return activeRoute;
}

export function addRoutePoint(position) {
  if (!activeRoute) return null;

  activeRoute.points.push({
    latitude: position.latitude,
    longitude: position.longitude
  });

  return activeRoute;
}

export function undoRoutePoint() {
  if (!activeRoute) return null;

  activeRoute.points.pop();
  return activeRoute;
}

export function saveActiveRoute(name) {
  if (!activeRoute || activeRoute.points.length < 2) return null;

  activeRoute.name = name.trim();
  routes.push(activeRoute);
  const savedRoute = activeRoute;
  activeRoute = null;
  return savedRoute;
}

export function cancelActiveRoute() {
  const route = activeRoute;
  activeRoute = null;
  return route;
}

export function getActiveRoute() {
  return activeRoute;
}

export function getRoutes() {
  return [...routes];
}

export function removeRoute(routeId) {
  const route = routes.find(item => item.id === routeId);
  routes = routes.filter(item => item.id !== routeId);
  return route ?? null;
}

export function toggleRouteVisibility(routeId) {
  const route = routes.find(item => item.id === routeId);
  if (!route) return null;

  route.visible = !route.visible;
  return route;
}

function nextRouteColor(usedColors, fallbackIndex) {
  return ROUTE_COLORS.find(color => !usedColors.has(color)) ??
    ROUTE_COLORS[fallbackIndex % ROUTE_COLORS.length];
}

function createRouteId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `route-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}