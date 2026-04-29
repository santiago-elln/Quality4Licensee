/* ============================================================
   AUTH — Estado de autenticação (mock; trocar por Supabase)
   ============================================================ */
import { MOCK_USERS } from './data/mock.js';

const SESSION_KEY = 'igreen_session';

let _currentUser = null;
const _listeners = new Set();

function notify() {
  _listeners.forEach(fn => fn(_currentUser));
}

export function onAuthChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function getCurrentUser() {
  return _currentUser;
}

export function isAuthenticated() {
  return _currentUser !== null;
}

/* Tenta restaurar sessão salva no sessionStorage */
export function restoreSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      _currentUser = JSON.parse(raw);
      return true;
    }
  } catch { /* noop */ }
  return false;
}

export async function login(email, password) {
  const user = MOCK_USERS.find(
    u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
  );
  if (!user) throw new Error('E-mail ou senha incorretos.');
  const { password: _, ...safeUser } = user;
  _currentUser = safeUser;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(safeUser));
  notify();
  return safeUser;
}

export function logout() {
  _currentUser = null;
  sessionStorage.removeItem(SESSION_KEY);
  notify();
}

export function loginAs(userId) {
  const user = MOCK_USERS.find(u => u.id === userId);
  if (!user) return;
  const { password: _, ...safeUser } = user;
  _currentUser = safeUser;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(safeUser));
  notify();
}
