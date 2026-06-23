/* ============================================================
   AUTH — Autenticação via Supabase
   ============================================================ */
import { supabase } from './supabase.js';
import { DEFAULT_PERMISSIONS_BY_LEVEL } from './utils/permissions.js';

let _currentUser = null;
let _viewAsUser  = null;
const _listeners = new Set();

function notify() {
  _listeners.forEach(fn => fn(_currentUser));
}

export function onAuthChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Returns the viewed-as user when active, otherwise the real authenticated user. */
export function getCurrentUser() {
  return _viewAsUser ?? _currentUser;
}

/** Always returns the real authenticated user, ignoring view-as. */
export function getRealUser() {
  return _currentUser;
}

export function isViewingAs() {
  return _viewAsUser !== null;
}

export function clearViewAs() {
  _viewAsUser = null;
}

/**
 * Sets the view-as user as a plain employee (no profile, access_level 2).
 * Used by the SysOwner to simulate how a collaborator without admin access sees the app.
 */
export async function setViewAsEmployee(employeeId) {
  const { data: employee } = await supabase
    .from('employees')
    // employees.id = auth.users.id for user-linked records (see buildUser).
    // Pull the org membership so the impersonated collaborator is scoped to
    // their real sector/group/department (pages like escalas filter on these).
    .select('id, name, sector_id, sector_group_id, department_id')
    .eq('id', employeeId)
    .single();

  _viewAsUser = {
    id:                employeeId,
    email:             null,
    name:              employee?.name ?? _currentUser?.name ?? '',
    role:              null,
    accessLevel:       2,
    isClaimed:         true,
    employeeId:        employee?.id              ?? null,
    departmentId:      employee?.department_id   ?? null,
    sectorId:          employee?.sector_id       ?? null,
    sectorGroupId:     employee?.sector_group_id ?? null,
    filterBy:          null,
    shiftsFilterBy:    null,
    supervisedTeamIds: [],
    permissions:       DEFAULT_PERMISSIONS_BY_LEVEL[2] ?? [],
  };
}

/**
 * Builds a user object for the given employee ID and sets it as the view-as user.
 * Uses the same shape as buildUser() so all pages behave identically.
 */
export async function setViewAs(employeeId) {
  const [{ data: profile }, { data: teams }, { data: employee }] = await Promise.all([
    supabase
      .from('profiles')
      .select('name, role, access_level, department_id, filter_by, shifts_filter_by, sector_id, sector_group_id')
      .eq('id', employeeId)
      .single(),
    supabase
      .from('teams')
      .select('id')
      .eq('supervisor_id', employeeId)
      .eq('active', true),
    // employees.id = auth.users.id for user-linked records (see buildUser)
    supabase
      .from('employees')
      .select('id, name')
      .eq('id', employeeId)
      .single(),
  ]);

  const accessLevel = profile?.access_level ?? 2;
  _viewAsUser = {
    id:                employeeId,
    email:             null,
    name:              profile?.name ?? employee?.name ?? '',
    role:              profile?.role             ?? null,
    accessLevel,
    isClaimed:         !!(profile || employee),
    employeeId:        employee?.id              ?? null,
    departmentId:      profile?.department_id    ?? null,
    sectorId:          profile?.sector_id        ?? null,
    sectorGroupId:     profile?.sector_group_id  ?? null,
    filterBy:          profile?.filter_by        ?? null,
    shiftsFilterBy:    profile?.shifts_filter_by ?? null,
    supervisedTeamIds: (teams ?? []).map(t => t.id),
    permissions:       DEFAULT_PERMISSIONS_BY_LEVEL[accessLevel] ?? [],
  };
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
    _viewAsUser  = null; // stale impersonation must not survive a token change
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

export async function loginWithMicrosoft() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes: 'email profile openid',
      redirectTo: window.location.origin + window.location.pathname,
    },
  });
  if (error) throw error;
  // Browser will redirect to Microsoft — no further action here
}

export async function logout() {
  await supabase.auth.signOut();
  _currentUser = null;
  _viewAsUser  = null;
  notify();
}
