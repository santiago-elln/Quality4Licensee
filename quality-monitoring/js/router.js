/* ============================================================
   ROUTER — Roteamento hash-based para SPA
   ============================================================ */
import { isAuthenticated } from './auth.js';

const _routes = new Map();
let _currentRoute = null;
let _defaultRoute = 'login';
let _protectedRoutes = new Set();

export function registerRoute(name, handler) {
  _routes.set(name, handler);
}

export function setDefaultRoute(name) {
  _defaultRoute = name;
}

export function protectRoute(name) {
  _protectedRoutes.add(name);
}

export function navigate(route, params = {}) {
  const hash = params && Object.keys(params).length
    ? `#${route}?${new URLSearchParams(params).toString()}`
    : `#${route}`;
  window.location.hash = hash;
}

export function getRouteParams() {
  const hash = window.location.hash.slice(1);
  const [, query] = hash.split('?');
  if (!query) return {};
  return Object.fromEntries(new URLSearchParams(query));
}

export function getCurrentRoute() {
  return _currentRoute;
}

function parseHash() {
  const hash = window.location.hash.slice(1);
  const [route] = hash.split('?');
  return route || _defaultRoute;
}

async function dispatch() {
  const route = parseHash();

  if (_protectedRoutes.has(route) && !isAuthenticated()) {
    navigate('login');
    return;
  }

  const handler = _routes.get(route);
  if (!handler) {
    navigate(_defaultRoute);
    return;
  }

  _currentRoute = route;
  await handler();
}

export function initRouter() {
  window.addEventListener('hashchange', dispatch);
  dispatch();
}
