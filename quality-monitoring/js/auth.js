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

  const [{ data: profile }, { data: teams }, { data: employee }] = await Promise.all([
    supabase
      .from('profiles')
      .select('name, role, access_level, department_id, filter_by, shifts_filter_by, sector_id, sector_group_id')
      .eq('id', authUser.id)
      .single(),
    supabase
      .from('teams')
      .select('id')
      .eq('supervisor_id', authUser.id)
      .eq('active', true),
    // employees.id = auth.users.id for user-linked employee records
    supabase
      .from('employees')
      .select('id, name')
      .eq('id', authUser.id)
      .single(),
  ]);

  const accessLevel = profile?.access_level ?? 2;

  return {
    id:                authUser.id,
    email:             authUser.email,
    name:              profile?.name ?? employee?.name ?? authUser.email,
    role:              profile?.role            ?? null,
    accessLevel,
    // isClaimed: true if the user has an employee record OR a profile.
    // False means they authenticated via SSO but haven't been onboarded yet.
    isClaimed:         !!(profile || employee),
    employeeId:        employee?.id             ?? null,
    departmentId:      profile?.department_id   ?? null,
    sectorId:          profile?.sector_id       ?? null,
    sectorGroupId:     profile?.sector_group_id ?? null,
    filterBy:          profile?.filter_by       ?? null,
    shiftsFilterBy:    profile?.shifts_filter_by ?? null,
    supervisedTeamIds: (teams ?? []).map(t => t.id),
    permissions:       DEFAULT_PERMISSIONS_BY_LEVEL[accessLevel] ?? [],
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
