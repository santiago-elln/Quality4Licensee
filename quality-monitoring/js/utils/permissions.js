/* ============================================================
   PERMISSIONS — Definição e verificação de permissões
   ============================================================ */

/* ── Identificadores de permissão ─────────────────────────── */
export const P = Object.freeze({

  /* Nova Monitoria */
  NEW_MONITORING_ACCESS: 'newMonitoring.canAccess',
  NEW_MONITORING_SAVE:   'newMonitoring.canSave',

  /* Consulta */
  CONSULT_ACCESS:        'Consult.canAccess',
  CONSULT_ACTION_PLAN:   'Consult.canAddActionPlan',

  /* Registros */
  RECORD_ACCESS:         'Record.canAccess',
  RECORD_DETAIL:         'Record.canDetail',
  RECORD_DELETE:         'Record.canDelete',

  /* Perfil */
  PROFILE_VIEW:          'Profile.canView',
  PROFILE_VIEW_OBS:      'Profile.canViewObs',
  // Controla se a seção "Observações Qualitativas" é exibida no perfil.
  // Desabilitado para colaboradores — eles não devem ver registros de observação.

  /* Escalas */
  SHIFTS_ACCESS:         'Shifts.canAccess',
  SHIFTS_EDIT:           'Shifts.canEdit',

  /* Admin */
  ADMIN_VIEW_STRUCT:       'Admin.canViewStruct',
  ADMIN_UPDATE_CRITERIA:   'Admin.canUpdateCriteria',
  ADMIN_GLOBAL_VIEW:       'Admin.hasGlobalView',
  ADMIN_SET_ACCESS_LEVEL:  'Admin.canSetAccessLevel',

  /* Global */
  GLOBAL_VIEW_DEPT:      'Global.canViewDept',

  /* Sidebar — visibilidade de botões na navegação lateral */
  SIDEBAR_NEW_MONITORING: 'Sidebar.newMonitoring',
  SIDEBAR_CONSULT:        'Sidebar.Consult',
  SIDEBAR_RECORDS:        'Sidebar.Records',
  SIDEBAR_PROFILE:        'Sidebar.Profile',
  SIDEBAR_DASHBOARD:      'Sidebar.Dashboard',
  SIDEBAR_COMPARATIVE:    'Sidebar.Comparative',
  SIDEBAR_GOALS:          'Sidebar.Goals',
  SIDEBAR_AI:             'Sidebar.AI',
  SIDEBAR_ADMIN:          'Sidebar.Admin',
});

/* ── Labels legíveis ──────────────────────────────────────── */
export const PERMISSION_LABELS = Object.freeze({
  [P.NEW_MONITORING_ACCESS]:  'Nova Monitoria — Acessar',
  [P.NEW_MONITORING_SAVE]:    'Nova Monitoria — Salvar',
  [P.CONSULT_ACCESS]:         'Consulta — Acessar',
  [P.CONSULT_ACTION_PLAN]:    'Consulta — Planos de Ação',
  [P.RECORD_ACCESS]:          'Registros — Acessar',
  [P.RECORD_DETAIL]:          'Registros — Ver detalhes',
  [P.RECORD_DELETE]:          'Registros — Excluir',
  [P.PROFILE_VIEW]:           'Perfil — Visualizar',
  [P.PROFILE_VIEW_OBS]:       'Perfil — Ver observações qualitativas',
  [P.SHIFTS_ACCESS]:          'Escalas — Acessar',
  [P.SHIFTS_EDIT]:            'Escalas — Editar',
  [P.ADMIN_VIEW_STRUCT]:      'Admin — Ver Organograma e Usuários',
  [P.ADMIN_UPDATE_CRITERIA]:  'Admin — Editar Critérios',
  [P.ADMIN_GLOBAL_VIEW]:       'Admin — Visualizar departamento inteiro',
  [P.ADMIN_SET_ACCESS_LEVEL]:  'Admin — Alterar Nível de Acesso',
  [P.GLOBAL_VIEW_DEPT]:       'Global — Ver todo o departamento',
  [P.SIDEBAR_NEW_MONITORING]: 'Sidebar — Nova Monitoria',
  [P.SIDEBAR_CONSULT]:        'Sidebar — Consulta',
  [P.SIDEBAR_RECORDS]:        'Sidebar — Registros',
  [P.SIDEBAR_PROFILE]:        'Sidebar — Perfil',
  [P.SIDEBAR_DASHBOARD]:      'Sidebar — Dashboard',
  [P.SIDEBAR_COMPARATIVE]:    'Sidebar — Comparação',
  [P.SIDEBAR_GOALS]:          'Sidebar — Metas',
  [P.SIDEBAR_AI]:             'Sidebar — Análise IA',
  [P.SIDEBAR_ADMIN]:          'Sidebar — Administração',
});

/* ── Permissões padrão por nível de acesso ────────────────── */
export const DEFAULT_PERMISSIONS_BY_LEVEL = Object.freeze({

  // Nível 2 — Colaborador
  2: [
    P.NEW_MONITORING_ACCESS,
    P.PROFILE_VIEW,
    P.SHIFTS_ACCESS,
    P.SIDEBAR_PROFILE,
  ],

  // Nível 3 — Supervisor
  3: [
    P.NEW_MONITORING_ACCESS,
    P.CONSULT_ACCESS,
    P.CONSULT_ACTION_PLAN,
    P.PROFILE_VIEW,
    P.PROFILE_VIEW_OBS,
    P.RECORD_ACCESS,
    P.RECORD_DETAIL,
    P.SHIFTS_ACCESS,
    P.SHIFTS_EDIT,
    P.ADMIN_VIEW_STRUCT,
    P.SIDEBAR_NEW_MONITORING,
    P.SIDEBAR_CONSULT,
    P.SIDEBAR_RECORDS,
    P.SIDEBAR_PROFILE,
    P.SIDEBAR_ADMIN,
  ],

  // Nível 4 — Analista
  4: [
    P.NEW_MONITORING_ACCESS,
    P.NEW_MONITORING_SAVE,
    P.CONSULT_ACCESS,
    P.GLOBAL_VIEW_DEPT,
    P.PROFILE_VIEW,
    P.PROFILE_VIEW_OBS,
    P.RECORD_ACCESS,
    P.RECORD_DETAIL,
    P.RECORD_DELETE,
    // P.ADMIN_VIEW_STRUCT,
    P.ADMIN_UPDATE_CRITERIA,
    P.SIDEBAR_NEW_MONITORING,
    P.SIDEBAR_CONSULT,
    P.SIDEBAR_RECORDS,
    P.SIDEBAR_PROFILE,
    // P.SIDEBAR_DASHBOARD,
    // P.SIDEBAR_COMPARATIVE,
    P.SIDEBAR_GOALS,
    // P.SIDEBAR_AI,
    P.SIDEBAR_ADMIN,
  ],

  // Nível 5 — Gestor
  5: [
    P.NEW_MONITORING_ACCESS,
    P.CONSULT_ACCESS,
    P.CONSULT_ACTION_PLAN,
    P.GLOBAL_VIEW_DEPT,
    P.PROFILE_VIEW,
    P.PROFILE_VIEW_OBS,
    P.RECORD_ACCESS,
    P.RECORD_DETAIL,
    P.SHIFTS_ACCESS,
    P.ADMIN_VIEW_STRUCT,
    P.ADMIN_SET_ACCESS_LEVEL,
    P.SIDEBAR_NEW_MONITORING,
    P.SIDEBAR_CONSULT,
    P.SIDEBAR_RECORDS,
    P.SIDEBAR_PROFILE,
    // P.SIDEBAR_DASHBOARD,
    // P.SIDEBAR_COMPARATIVE,
    P.SIDEBAR_GOALS,
    P.SIDEBAR_ADMIN,
  ],

  // Nível 6 — ADMIN (acesso total)
  6: [
    P.NEW_MONITORING_ACCESS,
    P.NEW_MONITORING_SAVE,
    P.CONSULT_ACCESS,
    P.CONSULT_ACTION_PLAN,
    P.GLOBAL_VIEW_DEPT,
    P.PROFILE_VIEW,
    P.PROFILE_VIEW_OBS,
    P.RECORD_ACCESS,
    P.RECORD_DETAIL,
    // P.RECORD_DELETE,
    P.SHIFTS_ACCESS,
    P.SHIFTS_EDIT,
    P.ADMIN_VIEW_STRUCT,
    P.ADMIN_UPDATE_CRITERIA,
    P.ADMIN_GLOBAL_VIEW,
    P.ADMIN_SET_ACCESS_LEVEL,
    P.SIDEBAR_NEW_MONITORING,
    P.SIDEBAR_CONSULT,
    P.SIDEBAR_RECORDS,
    P.SIDEBAR_PROFILE,
    P.SIDEBAR_DASHBOARD,
    P.SIDEBAR_COMPARATIVE,
    P.SIDEBAR_GOALS,
    P.SIDEBAR_AI,
    P.SIDEBAR_ADMIN,
  ],
});

/* ── Helpers de verificação ───────────────────────────────── */

export function can(user, permission) {
  if (!user || !permission) return false;
  const perms = user.permissions;
  if (!Array.isArray(perms)) return false;
  return perms.includes(permission);
}

export function canAll(user, ...permissions) {
  return permissions.every(p => can(user, p));
}

export function canAny(user, ...permissions) {
  return permissions.some(p => can(user, p));
}
