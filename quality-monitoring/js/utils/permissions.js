/* ============================================================
   PERMISSIONS — Definição e verificação de permissões
   ============================================================
   Uso:
     import { P, can, canAll, canAny } from '../utils/permissions.js';
     if (can(user, P.RECORD_DELETE)) { ... }

   O objeto `user` deve conter um array `permissions: string[]`
   populado via auth.js a partir do banco de dados.
   ============================================================ */

/* ── Identificadores de permissão ─────────────────────────── */
export const P = Object.freeze({

  /* Nova Monitoria */
  NEW_MONITORING_ACCESS: 'newMonitoring.canAccess',
  // Permite acessar a página Nova Monitoria e usar todas as funcionalidades,
  // exceto salvar.

  NEW_MONITORING_SAVE:   'newMonitoring.canSave',
  // Requer NEW_MONITORING_ACCESS.
  // Adiciona a permissão de salvar a monitoria.

  /* Consulta */
  CONSULT_ACCESS:        'Consult.canAccess',
  // Permite acessar a página Consulta.
  // Por padrão: filtra apenas o próprio departamento, o próprio supervisor
  // e os colaboradores da própria equipe.

  CONSULT_ACTION_PLAN:   'Consult.canAddActionPlan',
  // Requer CONSULT_ACCESS.
  // Permite cadastrar Planos de Ação para colaboradores.

  /* Registros */
  RECORD_ACCESS:         'Record.canAccess',
  // Permite acessar a página Registros.
  // Por padrão: filtra apenas o próprio departamento, o próprio supervisor
  // e os colaboradores da própria equipe.

  RECORD_DETAIL:         'Record.canDetail',
  // Permite usar a opção "Ver" para abrir detalhes de uma monitoria.

  RECORD_DELETE:         'Record.canDelete',
  // Permite usar a lixeira para excluir uma monitoria.

  /* Perfil */
  PROFILE_VIEW:          'Profile.canView',
  // Permite acessar as páginas de Perfil dos colaboradores.
  // Por padrão: apenas perfis dos próprios colaboradores.

  /* Escalas */
  SHIFTS_ACCESS:         'Shifts.canAccess',
  // Permite acessar a página Escalas de Trabalho.
  // Por padrão: apenas colaboradores do(s) setor(es) do qual é supervisor.

  SHIFTS_EDIT:           'Shifts.canEdit',
  // Requer SHIFTS_ACCESS.
  // Permite editar escalas e horários de pausa.
  // Por padrão: apenas colaboradores da própria equipe.

  /* Admin */
  ADMIN_ACCESS:          'Admin.canAccess',
  // Permite acessar o painel de administração do sistema.

  ADMIN_VIEW_STRUCT:     'Admin.canViewStruct',
  // Requer ADMIN_ACCESS.
  // Exibe as abas "Organograma" e "Usuários" no painel de administração.

  ADMIN_UPDATE_CRITERIA: 'Admin.canUpdateCriteria',
  // Requer ADMIN_ACCESS.
  // Permite adicionar, editar e desativar itens na aba "Critérios".

  /* Global */
  GLOBAL_VIEW_DEPT:      'Global.canViewDept',
  // Expande qualquer permissão "canAccess" para todo o departamento:
  // filtra qualquer supervisor e qualquer colaborador do mesmo departamento.
  // Acumula com permissões de edição/exclusão — não as substitui.
  // Não concede acesso às páginas por si só; as permissões canAccess
  // de cada página ainda são necessárias.
});

/* ── Dependências ─────────────────────────────────────────── */
// Usadas para validação no painel de admin e para documentação.
// Não são verificadas no runtime — a concessão de permissão já
// deve garantir que as dependências foram atendidas.
export const REQUIRES = Object.freeze({
  [P.NEW_MONITORING_SAVE]:    [P.NEW_MONITORING_ACCESS],
  [P.CONSULT_ACTION_PLAN]:    [P.CONSULT_ACCESS],
  [P.SHIFTS_EDIT]:            [P.SHIFTS_ACCESS],
  [P.ADMIN_VIEW_STRUCT]:      [P.ADMIN_ACCESS],
  [P.ADMIN_UPDATE_CRITERIA]:  [P.ADMIN_ACCESS],
});

/* ── Labels legíveis ──────────────────────────────────────── */
export const PERMISSION_LABELS = Object.freeze({
  [P.NEW_MONITORING_ACCESS]: 'Nova Monitoria — Acessar',
  [P.NEW_MONITORING_SAVE]:   'Nova Monitoria — Salvar',
  [P.CONSULT_ACCESS]:        'Consulta — Acessar',
  [P.CONSULT_ACTION_PLAN]:   'Consulta — Planos de Ação',
  [P.RECORD_ACCESS]:         'Registros — Acessar',
  [P.RECORD_DETAIL]:         'Registros — Ver detalhes',
  [P.RECORD_DELETE]:         'Registros — Excluir',
  [P.PROFILE_VIEW]:          'Perfil — Visualizar',
  [P.SHIFTS_ACCESS]:         'Escalas — Acessar',
  [P.SHIFTS_EDIT]:           'Escalas — Editar',
  [P.ADMIN_ACCESS]:          'Admin — Acessar painel',
  [P.ADMIN_VIEW_STRUCT]:     'Admin — Ver Organograma e Usuários',
  [P.ADMIN_UPDATE_CRITERIA]: 'Admin — Editar Critérios',
  [P.GLOBAL_VIEW_DEPT]:      'Global — Ver todo o departamento',
});

/* ── Permissões padrão por nível de acesso ────────────────── */
// Fonte: tabela ACCESS_LEVEL × PERMISSION aprovada em 2026-05.
// Usada em auth.js para popular user.permissions a partir do
// access_level do perfil, sem necessidade de coluna extra no banco.
export const DEFAULT_PERMISSIONS_BY_LEVEL = Object.freeze({

  // Nível 2 — Colaborador (sem usuários cadastrados ainda)
  2: [
    P.PROFILE_VIEW,
    P.RECORD_ACCESS,
    P.SHIFTS_ACCESS,
  ],

  // Nível 3 — Supervisor
  // Usuários: Anna Clara Ferreira, Marcelle Rabelo, Matheus Moura, Ana Luiza Santos
  3: [
    P.NEW_MONITORING_ACCESS,
    P.CONSULT_ACCESS,
    P.CONSULT_ACTION_PLAN,
    P.PROFILE_VIEW,
    P.RECORD_ACCESS,
    P.RECORD_DETAIL,
    P.SHIFTS_ACCESS,
    P.SHIFTS_EDIT,
    P.ADMIN_ACCESS,
    P.ADMIN_VIEW_STRUCT,
  ],

  // Nível 4 — Analista
  // Usuários: Hebert Júnior
  4: [
    P.NEW_MONITORING_ACCESS,
    P.NEW_MONITORING_SAVE,
    P.CONSULT_ACCESS,
    P.PROFILE_VIEW,
    P.RECORD_ACCESS,
    P.RECORD_DETAIL,
    P.RECORD_DELETE,
    P.SHIFTS_ACCESS,
    P.ADMIN_ACCESS,
    P.ADMIN_VIEW_STRUCT,
    P.ADMIN_UPDATE_CRITERIA,
    P.GLOBAL_VIEW_DEPT,
  ],

  // Nível 5 — Gestor
  // Usuários: Matheus Urias, Nathalia Menezes
  5: [
    P.NEW_MONITORING_ACCESS,
    P.CONSULT_ACCESS,
    P.CONSULT_ACTION_PLAN,
    P.PROFILE_VIEW,
    P.RECORD_ACCESS,
    P.RECORD_DETAIL,
    P.SHIFTS_ACCESS,
    P.ADMIN_ACCESS,
    P.ADMIN_VIEW_STRUCT,
    P.GLOBAL_VIEW_DEPT,
  ],

  // Nível 6 — ADMIN (acesso total)
  // Usuários: Ellian Santiago
  6: [
    P.NEW_MONITORING_ACCESS,
    P.NEW_MONITORING_SAVE,
    P.CONSULT_ACCESS,
    P.CONSULT_ACTION_PLAN,
    P.PROFILE_VIEW,
    P.RECORD_ACCESS,
    P.RECORD_DETAIL,
    P.RECORD_DELETE,
    P.SHIFTS_ACCESS,
    P.SHIFTS_EDIT,
    P.ADMIN_ACCESS,
    P.ADMIN_VIEW_STRUCT,
    P.ADMIN_UPDATE_CRITERIA,
    P.GLOBAL_VIEW_DEPT,
  ],
});

/* ── Helpers de verificação ───────────────────────────────── */

/**
 * Verifica se o usuário possui uma permissão específica.
 * `user.permissions` deve ser um array de strings.
 */
export function can(user, permission) {
  if (!user || !permission) return false;
  const perms = user.permissions;
  if (!Array.isArray(perms)) return false;
  return perms.includes(permission);
}

/**
 * Verifica se o usuário possui TODAS as permissões listadas.
 */
export function canAll(user, ...permissions) {
  return permissions.every(p => can(user, p));
}

/**
 * Verifica se o usuário possui PELO MENOS UMA das permissões listadas.
 */
export function canAny(user, ...permissions) {
  return permissions.some(p => can(user, p));
}
