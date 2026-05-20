/* ============================================================
   AUTH — Autenticação via Supabase
   ============================================================ */
import { supabase } from './supabase.js';
import { DEFAULT_PERMISSIONS_BY_LEVEL } from './utils/permissions.js';

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

/* Busca perfil do banco e compõe o objeto de usuário da aplicação */
async function buildUser(authUser) {
  if (!authUser) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, role, access_level, department_id, employee_id')
    .eq('id', authUser.id)
    .single();

  const accessLevel = profile?.access_level ?? 2;

  return {
    id:           authUser.id,
    email:        authUser.email,
    name:         profile?.name          ?? authUser.email,
    role:         profile?.role          ?? 'supervisor',
    accessLevel,
    departmentId: profile?.department_id ?? null,
    employeeId:   profile?.employee_id   ?? null,
    permissions:  DEFAULT_PERMISSIONS_BY_LEVEL[accessLevel] ?? [],
  };
}

/*
  Restaura a sessão persistida no localStorage pelo Supabase e registra
  o listener de mudanças de estado (login, logout, refresh de token).
  Deve ser aguardado no bootstrap antes de inicializar o roteador.
*/
export async function restoreSession() {
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.user) {
    _currentUser = await buildUser(session.user);
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    _currentUser = session?.user ? await buildUser(session.user) : null;
    notify();
  });

  return _currentUser !== null;
}

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error('E-mail ou senha incorretos.');
  _currentUser = await buildUser(data.user);
  notify();
  return _currentUser;
}

export async function logout() {
  await supabase.auth.signOut();
  _currentUser = null;
  notify();
}
