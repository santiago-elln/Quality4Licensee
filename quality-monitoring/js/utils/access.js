/* ============================================================
   ACCESS CONTROL — Níveis de acesso e visibilidade de métricas
   ============================================================ */

export const ACCESS_LEVELS = {
  COLABORADOR:  2,
  SUPERVISOR:   3,
  ANALISTA:     4,
  GESTOR:       5,
  COORDENADOR:  5,
  ADMIN:        6,
  SYSOWNER:     9,
};

/* Configuração de visibilidade por métrica.
   min_visible_accessLvl: nível mínimo para ver o dado de OUTROS colaboradores.
   Um colaborador sempre vê os próprios dados independente do nível. */
export const METRICS_CONFIG = {
  pontuacao_total: {
    name: 'Pontuação Total',
    description: 'Nota final da monitoria',
    min_visible_accessLvl: 2,
  },
  pct_aproveitamento: {
    name: 'Aproveitamento (%)',
    description: 'Percentual da pontuação máxima atingida',
    min_visible_accessLvl: 2,
  },
  csat: {
    name: 'Satisfação do Cliente (CSAT)',
    description: 'Avaliação do cliente no atendimento',
    min_visible_accessLvl: 3,
  },
  pts_perdidos: {
    name: 'Pontos Perdidos',
    description: 'Total de pontos não obtidos',
    min_visible_accessLvl: 3,
  },
  tma: {
    name: 'Tempo Médio de Atendimento (TMA)',
    description: 'Duração média dos atendimentos monitorados',
    min_visible_accessLvl: 2,
  },
  tmpr: {
    name: 'Tempo de Primeira Resposta (TMPr)',
    description: 'Tempo até a primeira resposta ao cliente',
    min_visible_accessLvl: 3,
  },
  tmer: {
    name: 'Tempo Máx. de Espera entre Respostas (TMEr)',
    description: 'Maior intervalo sem resposta durante o atendimento',
    min_visible_accessLvl: 3,
  },
  monitorias_zeradas: {
    name: 'Monitorias Zeradas',
    description: 'Quantidade de monitorias com pontuação zero',
    min_visible_accessLvl: 3,
  },
  distribuicao_resultados: {
    name: 'Distribuição de Resultados',
    description: 'Proporção de cada faixa de qualidade',
    min_visible_accessLvl: 3,
  },
  criterios_analiticos: {
    name: 'Critérios Analíticos',
    description: 'Checklist de procedimentos analíticos',
    min_visible_accessLvl: 3,
  },
  observacoes: {
    name: 'Observações Qualitativas',
    description: 'Comentários e anotações do monitor',
    min_visible_accessLvl: 3,
  },
  ranking_equipe: {
    name: 'Ranking da Equipe',
    description: 'Posição relativa dentro da equipe',
    min_visible_accessLvl: 3,
  },
  erros_frequentes: {
    name: 'Erros Mais Frequentes',
    description: 'Padrão de erros recorrentes identificados',
    min_visible_accessLvl: 3,
  },
  ai_insights: {
    name: 'Análise por IA',
    description: 'Insights e desvios identificados pelo Claude',
    min_visible_accessLvl: 4,
  },
  comparativo_equipes: {
    name: 'Comparativo entre Equipes',
    description: 'Performance comparada com outras equipes do departamento',
    min_visible_accessLvl: 5,
  },
};

/**
 * Verifica se o usuário logado pode ver uma métrica para um dado colaborador.
 * @param {Object} viewer  - Usuário que está vendo { accessLevel, id, teamId, deptId }
 * @param {Object} subject - Colaborador alvo { id, teamId, deptId }
 * @param {string} metricKey - Chave de METRICS_CONFIG
 */
export function canViewMetric(viewer, subject, metricKey) {
  if (!viewer || !metricKey) return false;
  const config = METRICS_CONFIG[metricKey];
  if (!config) return true;
  if (viewer.id === subject?.id) return true; // próprio dado
  return viewer.accessLevel >= config.min_visible_accessLvl;
}

/**
 * Verifica se o viewer pode ver dados do colaborador (scope de acesso).
 * Usa filterBy do perfil para determinar o escopo, espelhando a RLS do banco.
 * @param {Object} viewer  - { filterBy, sectorId, sectorGroupId, departmentId, id }
 * @param {Object} subject - { teamId, sectorId, sectorGroupId, departmentId, user_id }
 */
export function canViewSubject(viewer, subject) {
  if (!viewer || !subject) return false;
  if (viewer.id === subject.userId) return true;
  switch (viewer.filterBy) {
    case 'supervisor': return subject.teamSupervisorId === viewer.id;
    case 'sector':     return subject.sectorId === viewer.sectorId;
    case 'group':      return subject.sectorGroupId === viewer.sectorGroupId;
    case 'department': return subject.departmentId === viewer.departmentId;
    default:           return false;
  }
}

/**
 * Retorna os colaboradores visíveis para um viewer a partir de uma lista.
 */
export function filterVisibleSubjects(viewer, allUsers) {
  return allUsers.filter(u => canViewSubject(viewer, u));
}

export function roleName(accessLevel) {
  if (accessLevel >= 9) return 'SysOwner';
  if (accessLevel >= 6) return 'Admin';
  if (accessLevel >= 5) return 'Gestor / Coordenador';
  if (accessLevel >= 4) return 'Analista';
  if (accessLevel >= 3) return 'Supervisor';
  return 'Colaborador';
}

export function roleClass(role) {
  const map = {
    sysowner:     'sysowner',
    admin:        'admin',
    coordenador:  'coordenador',
    coordenadora: 'coordenador',
    gestor:       'gestor',
    gestora:      'gestor',
    analista:     'analista',
    supervisor:   'supervisor',
    supervisora:  'supervisor',
    colaborador:  'colaborador',
    vip:          'vip',
  };
  return (typeof role === 'string' ? map[role.toLowerCase()] : undefined) ?? 'colaborador';
}

