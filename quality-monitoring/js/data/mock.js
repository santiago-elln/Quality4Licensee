/* ============================================================
   MOCK DATA — Dados de demonstração
   ============================================================ */

/* ── Departamentos ─────────────────────────── */
export const DEPARTMENTS = [
  { id: 'dept-1', name: 'Suporte ao Licenciado', code: 'SUP' },
  { id: 'dept-2', name: 'Comercial',              code: 'COM' },
];

/* ── Núcleos / Equipes ─────────────────────── */
export const TEAMS = [
  { id: 'team-1', deptId: 'dept-1', name: 'Equipe Alpha',  supervisorId: 'user-sup-1' },
  { id: 'team-2', deptId: 'dept-1', name: 'Equipe Beta',   supervisorId: 'user-sup-2' },
  { id: 'team-3', deptId: 'dept-1', name: 'Equipe Gamma',  supervisorId: 'user-sup-3' },
  { id: 'team-4', deptId: 'dept-1', name: 'Equipe Delta',  supervisorId: 'user-sup-4' },
];

/* ── Usuários (inclui colaboradores) ──────── */
export const MOCK_USERS = [
  /* Coordenação */
  {
    id: 'user-coord-1', email: 'nathalia@igreen.com', password: 'demo123',
    name: 'Nathalia Menezes', role: 'coordenador', accessLevel: 5,
    deptId: 'dept-1', teamId: null,
    title: 'Coordenadora', dept: 'Suporte ao Licenciado',
  },
  /* Gestor */
  {
    id: 'user-gest-1', email: 'matheus@igreen.com', password: 'demo123',
    name: 'Matheus Urias', role: 'gestor', accessLevel: 5,
    deptId: 'dept-1', teamId: null,
    title: 'Gestor', dept: 'Suporte ao Licenciado',
  },
  /* Analista */
  {
    id: 'user-anal-1', email: 'ellian.santiago@igreenenergy.com.br', password: '123456',
    name: 'Ellian Santiago', role: 'analista', accessLevel: 4,
    deptId: 'dept-1', teamId: null,
    title: 'Analista de Qualidade', dept: 'Suporte ao Licenciado',
  },
  /* Supervisores */
  {
    id: 'user-sup-1', email: 'annacara@igreen.com', password: 'demo123',
    name: 'Anna Clara Ferreira', role: 'supervisor', accessLevel: 3,
    deptId: 'dept-1', teamId: 'team-1',
    title: 'Supervisora', dept: 'Suporte ao Licenciado',
  },
  {
    id: 'user-sup-2', email: 'matheus.moura@igreen.com', password: 'demo123',
    name: 'Matheus de Jesus', role: 'supervisor', accessLevel: 3,
    deptId: 'dept-1', teamId: 'team-2',
    title: 'Supervisor', dept: 'Suporte ao Licenciado',
  },
  {
    id: 'user-sup-3', email: 'marcelle@igreen.com', password: 'demo123',
    name: 'Marcelle Rabello', role: 'supervisor', accessLevel: 3,
    deptId: 'dept-1', teamId: 'team-3',
    title: 'Supervisora', dept: 'Suporte ao Licenciado',
  },
  {
    id: 'user-sup-4', email: 'analuiza@igreen.com', password: 'demo123',
    name: 'Ana Luiza Santos', role: 'supervisor', accessLevel: 3,
    deptId: 'dept-1', teamId: 'team-4',
    title: 'Supervisora', dept: 'Suporte ao Licenciado',
  },
  /* Colaboradores — Equipe Alpha (Anna Clara) */
  {
    id: 'collab-1', email: 'colaborador1@igreen.com', password: 'demo123',
    name: 'Maria Eduarda Souza', role: 'colaborador', accessLevel: 2,
    deptId: 'dept-1', teamId: 'team-1',
    title: 'Atendente', dept: 'Suporte ao Licenciado',
  },
  {
    id: 'collab-2', email: 'colaborador2@igreen.com', password: 'demo123',
    name: 'Lucas Mendes', role: 'colaborador', accessLevel: 2,
    deptId: 'dept-1', teamId: 'team-1',
    title: 'Atendente', dept: 'Suporte ao Licenciado',
  },
  {
    id: 'collab-3', email: 'colaborador3@igreen.com', password: 'demo123',
    name: 'Camila Ribeiro', role: 'colaborador', accessLevel: 2,
    deptId: 'dept-1', teamId: 'team-1',
    title: 'Atendente', dept: 'Suporte ao Licenciado',
  },
  {
    id: 'collab-4', email: 'colaborador4@igreen.com', password: 'demo123',
    name: 'Ana Júlia Ferreira', role: 'colaborador', accessLevel: 2,
    deptId: 'dept-1', teamId: 'team-1',
    title: 'Atendente', dept: 'Suporte ao Licenciado',
  },
  /* Colaboradores — Equipe Beta (Matheus Moura) */
  {
    id: 'collab-5', email: 'colaborador5@igreen.com', password: 'demo123',
    name: 'Rafael Alves', role: 'colaborador', accessLevel: 2,
    deptId: 'dept-1', teamId: 'team-2',
    title: 'Atendente', dept: 'Suporte ao Licenciado',
  },
  {
    id: 'collab-6', email: 'colaborador6@igreen.com', password: 'demo123',
    name: 'Isabela Torres', role: 'colaborador', accessLevel: 2,
    deptId: 'dept-1', teamId: 'team-2',
    title: 'Atendente', dept: 'Suporte ao Licenciado',
  },
  {
    id: 'collab-7', email: 'colaborador7@igreen.com', password: 'demo123',
    name: 'Pedro Henrique Lima', role: 'colaborador', accessLevel: 2,
    deptId: 'dept-1', teamId: 'team-2',
    title: 'Atendente', dept: 'Suporte ao Licenciado',
  },
  /* Colaboradores — Equipe Gamma (Marcelle) */
  {
    id: 'collab-8', email: 'colaborador8@igreen.com', password: 'demo123',
    name: 'Beatriz Cardoso', role: 'colaborador', accessLevel: 2,
    deptId: 'dept-1', teamId: 'team-3',
    title: 'Atendente', dept: 'Suporte ao Licenciado',
  },
  {
    id: 'collab-9', email: 'colaborador9@igreen.com', password: 'demo123',
    name: 'Thiago Monteiro', role: 'colaborador', accessLevel: 2,
    deptId: 'dept-1', teamId: 'team-3',
    title: 'Atendente', dept: 'Suporte ao Licenciado',
  },
  /* Colaboradores — Equipe Delta (Ana Luiza) */
  {
    id: 'collab-10', email: 'colaborador10@igreen.com', password: 'demo123',
    name: 'Fernanda Rocha', role: 'colaborador', accessLevel: 2,
    deptId: 'dept-1', teamId: 'team-4',
    title: 'Atendente', dept: 'Suporte ao Licenciado',
  },
  {
    id: 'collab-11', email: 'colaborador11@igreen.com', password: 'demo123',
    name: 'Vinicius Dias', role: 'colaborador', accessLevel: 2,
    deptId: 'dept-1', teamId: 'team-4',
    title: 'Atendente', dept: 'Suporte ao Licenciado',
  },
];

/* ── Critérios de avaliação ────────────────── */
export const EVAL_CATEGORIES = [
  {
    id: 'procedimento_correto',
    name: 'Procedimento Correto',
    totalPts: 12,
    items: [
      { id: 'leitura_ativa',    name: 'Leitura ativa',                                pts: 4 },
      { id: 'politicas',        name: 'Cumpriu políticas internas e de conformidade',  pts: 4 },
      { id: 'encaminhamento',   name: 'Encaminhamento de demandas',                    pts: 4 },
    ],
  },
  {
    id: 'comunicacao_linguagem',
    name: 'Comunicação e Linguagem',
    totalPts: 22,
    items: [
      { id: 'empatia',          name: 'Empatia',                              pts: 4 },
      { id: 'sem_jargoes',      name: 'Evitou jargões ou termos confusos',    pts: 4 },
      { id: 'explicacao_clara', name: 'Explicação clara',                     pts: 5 },
      { id: 'foco_assunto',     name: 'Foco no assunto',                      pts: 5 },
      { id: 'dominio_conversa', name: 'Domínio da conversa e linguagens',     pts: 4 },
    ],
  },
  {
    id: 'eficiencia_tempo',
    name: 'Eficiência e Tempo',
    totalPts: 21,
    items: [
      { id: 'objetivo',         name: 'Atendimento objetivo',                 pts: 7 },
      { id: 'historico',        name: 'Verificando histórico e demanda',       pts: 5 },
      { id: 'fcr',              name: 'Resolução em primeiro contato',         pts: 5 },
      { id: 'encerramento',     name: 'Tempo de encerramento adequado',        pts: 4 },
    ],
  },
  {
    id: 'conhecimento_assertividade',
    name: 'Conhecimento e Assertividade',
    totalPts: 32,
    items: [
      { id: 'seguranca_info',   name: 'Segurança nas informações',             pts: 10 },
      { id: 'info_completas',   name: 'Informações completas',                 pts: 4  },
      { id: 'consistencia',     name: 'Mantém consistência nas respostas',     pts: 8  },
      { id: 'info_corretas',    name: 'Informações corretas',                  pts: 10 },
    ],
  },
  {
    id: 'registro_documentacao',
    name: 'Registro e Documentação',
    totalPts: 13,
    items: [
      { id: 'tabulacao',        name: 'Tabulação correta da demanda',          pts: 3 },
      { id: 'registro_claro',   name: 'Registro de informações clara e completa', pts: 5 },
      { id: 'obs_relevantes',   name: 'Incluiu observações relevantes',        pts: 5 },
    ],
  },
];

export const TOTAL_MAX_PTS = EVAL_CATEGORIES.reduce((s, c) => s + c.totalPts, 0); // 100

export const ANALYTICAL_CRITERIA = [
  { id: 'compreendeu_demanda', name: 'Compreendeu a demanda?' },
  { id: 'demanda_externa',     name: 'Demanda externa correta?' },
  { id: 'anotacao_interna',    name: 'Anotação interna correta?' },
  { id: 'finalizacao_correta', name: 'Finalização correta?' },
];

/* ── Geradores de monitorias mock ─────────── */
function randBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateMonitoriaItems(quality) {
  const items = {};
  EVAL_CATEGORIES.forEach(cat => {
    cat.items.forEach(item => {
      const miss = quality === 'excelente' ? 0.05
        : quality === 'bom' ? 0.15
        : quality === 'regular' ? 0.35
        : quality === 'critico' ? 0.6 : 1;
      items[item.id] = Math.random() > miss;
    });
  });
  return items;
}

function calcScore(checkedItems) {
  let total = 0;
  EVAL_CATEGORIES.forEach(cat => {
    cat.items.forEach(item => {
      if (checkedItems[item.id]) total += item.pts;
    });
  });
  return total;
}

function generateMonitoria(id, collabId, date, quality) {
  const checkedItems = generateMonitoriaItems(quality);
  const score = calcScore(checkedItems);
  return {
    id,
    colaboradorId: collabId,
    date,
    attendanceId: String(randBetween(100000, 999999)),
    tmpr: randBetween(30, 180),
    tmer: randBetween(60, 600),
    tma:  randBetween(600, 7200),
    csat: randBetween(3, 5),
    checkedItems,
    analyticalCriteria: {
      compreendeu_demanda: Math.random() > 0.1,
      demanda_externa:     Math.random() > 0.12,
      anotacao_interna:    Math.random() > 0.15,
      finalizacao_correta: Math.random() > 0.08,
    },
    score,
    pct: Math.round((score / TOTAL_MAX_PTS) * 100),
    monitorId: randFrom(['user-anal-1', 'user-coord-1', 'user-gest-1']),
  };
}

/* Gera monitorias para os últimos 4 meses */
function buildMonitorias() {
  const list = [];
  const collabs = MOCK_USERS.filter(u => u.role === 'colaborador');
  const qualities = ['excelente','bom','bom','regular','critico'];
  let idCount = 1;
  const now = new Date();

  for (let month = 0; month < 4; month++) {
    const d = new Date(now.getFullYear(), now.getMonth() - month, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    collabs.forEach(collab => {
      const count = randBetween(2, 6);
      for (let i = 0; i < count; i++) {
        const day = randBetween(1, 28);
        const dateStr = `${ym}-${String(day).padStart(2,'0')}`;
        const quality = randFrom(qualities);
        list.push(generateMonitoria(`mon-${idCount++}`, collab.id, dateStr, quality));
      }
    });
  }
  return list;
}

export const MONITORIAS = buildMonitorias();

/* ── Observações mock ─────────────────────── */
export const OBSERVATIONS = [
  {
    id: 'obs-1', monitoriaId: null, colaboradorId: 'collab-1',
    type: 'E', criteria: 'Procedimento Correto',
    text: 'Finalizou sem aguardar o período entre respostas',
    authorId: 'user-anal-1', date: '2026-04-10', attendanceId: '260310534698',
  },
  {
    id: 'obs-2', monitoriaId: null, colaboradorId: 'collab-1',
    type: 'A', criteria: 'Registro e Documentação',
    text: 'Ótimo trabalho identificando o problema X e registrando corretamente',
    authorId: 'user-anal-1', date: '2026-04-10', attendanceId: '260310534698',
  },
  {
    id: 'obs-3', monitoriaId: null, colaboradorId: 'collab-1',
    type: 'O', criteria: 'Comunicação e Linguagem',
    text: 'Atendente não teve empatia com o licenciado durante o escalonamento',
    authorId: 'user-anal-1', date: '2026-03-22', attendanceId: '260310534698',
  },
  {
    id: 'obs-4', monitoriaId: null, colaboradorId: 'collab-2',
    type: 'G', criteria: 'Eficiência e Tempo',
    text: 'Atenção ao período de 10 minutos para análise antes de encerrar',
    authorId: 'user-sup-1', date: '2026-04-05', attendanceId: '382901245711',
  },
  {
    id: 'obs-5', monitoriaId: null, colaboradorId: 'collab-1',
    type: 'E', criteria: 'Conhecimento e Assertividade',
    text: 'Informou nome de outro licenciado durante o atendimento — Crítico',
    authorId: 'user-anal-1', date: '2026-03-15', attendanceId: '260310534698',
  },
];

/* ── AI Insights mock ─────────────────────── */
export const AI_INSIGHTS = [
  {
    id: 'ai-1', type: 'deviation', severity: 'high',
    title: 'Queda consistente em Conhecimento e Assertividade',
    target: 'collab-1', targetName: 'Maria Eduarda Souza',
    generatedAt: '2026-04-28T10:00:00',
    summary: 'Nas últimas 3 monitorias, Maria Eduarda perdeu em média 18 pontos na categoria Conhecimento e Assertividade — 42% acima da média da equipe. O padrão indica possível lacuna de conhecimento nos procedimentos de escalação.',
    evidence: [
      'Monitoria 12/04: 14/32 pts em Conhecimento (43.75%)',
      'Monitoria 20/04: 16/32 pts em Conhecimento (50%)',
      'Monitoria 25/04: 12/32 pts em Conhecimento (37.5%)',
    ],
    recommendations: [
      'Agendar sessão de alinhamento sobre políticas de escalação',
      'Revisar base de conhecimento com supervisora Anna Clara',
    ],
  },
  {
    id: 'ai-2', type: 'pattern', severity: 'medium',
    title: 'Tendência de melhora em Eficiência e Tempo — Equipe Beta',
    target: 'team-2', targetName: 'Equipe Beta',
    generatedAt: '2026-04-28T10:00:00',
    summary: 'A Equipe Beta melhorou seu TMA médio em 23% nos últimos 2 meses, passando de 47min para 36min. O padrão é consistente entre todos os colaboradores, sugerindo impacto positivo das ações do supervisor Matheus Moura.',
    evidence: [
      'TMA médio Fevereiro: 47min 20s',
      'TMA médio Março: 41min 05s',
      'TMA médio Abril: 36min 12s',
    ],
    recommendations: [
      'Compartilhar boas práticas da Equipe Beta com as demais equipes',
      'Documentar as ações implementadas pelo supervisor',
    ],
  },
  {
    id: 'ai-3', type: 'deviation', severity: 'critical',
    title: 'Alta frequência de monitorias com CSAT ≤ 3 — Equipe Gamma',
    target: 'team-3', targetName: 'Equipe Gamma',
    generatedAt: '2026-04-28T10:00:00',
    summary: '38% das monitorias da Equipe Gamma no mês de Abril apresentaram CSAT ≤ 3, contra 14% das demais equipes. O desvio é estatisticamente significativo e requer ação imediata.',
    evidence: [
      'Equipe Gamma: 38% das monitorias com CSAT ≤ 3',
      'Demais equipes: média de 14% com CSAT ≤ 3',
      'Desvio padrão: +24pp acima da média departamental',
    ],
    recommendations: [
      'Investigar causas raiz com supervisora Marcelle',
      'Realizar escuta de atendimentos com CSAT ≤ 3',
      'Considerar treinamento focado em Empatia e Comunicação',
    ],
  },
];

/* ── Metas da equipe ─────────────────────── */
export const TEAM_GOALS = {
  'team-1': { minScore: 36, qualityTarget: 80 },
  'team-2': { minScore: 36, qualityTarget: 80 },
  'team-3': { minScore: 36, qualityTarget: 80 },
  'team-4': { minScore: 36, qualityTarget: 80 },
};

/* ── Helpers ─────────────────────────────── */
export function getUser(id) { return MOCK_USERS.find(u => u.id === id); }
export function getTeam(id) { return TEAMS.find(t => t.id === id); }
export function getDept(id) { return DEPARTMENTS.find(d => d.id === id); }

export function getCollabsForViewer(viewer) {
  if (!viewer) return [];
  if (viewer.accessLevel >= 4) {
    return MOCK_USERS.filter(u => u.role === 'colaborador' && u.deptId === viewer.deptId);
  }
  if (viewer.accessLevel === 3) {
    return MOCK_USERS.filter(u => u.role === 'colaborador' && u.teamId === viewer.teamId);
  }
  return MOCK_USERS.filter(u => u.id === viewer.id);
}

export function getMonitorias(filters = {}) {
  let list = [...MONITORIAS];
  if (filters.colaboradorId) list = list.filter(m => m.colaboradorId === filters.colaboradorId);
  if (filters.teamId) {
    const ids = new Set(MOCK_USERS.filter(u => u.teamId === filters.teamId).map(u => u.id));
    list = list.filter(m => ids.has(m.colaboradorId));
  }
  if (filters.deptId) {
    const ids = new Set(MOCK_USERS.filter(u => u.deptId === filters.deptId).map(u => u.id));
    list = list.filter(m => ids.has(m.colaboradorId));
  }
  if (filters.month) {
    list = list.filter(m => m.date.startsWith(filters.month));
  }
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export function getMonitoriaStats(monitorias) {
  if (!monitorias.length) return { count: 0, avgScore: 0, avgPct: 0, ptsLost: 0, zeroed: 0, dist: {} };
  const count  = monitorias.length;
  const avgPct = Math.round(monitorias.reduce((s, m) => s + m.pct, 0) / count);
  const ptsLost = Math.round(monitorias.reduce((s, m) => s + (TOTAL_MAX_PTS - m.score), 0) / count * 10) / 10;
  const zeroed  = monitorias.filter(m => m.pct === 0).length;

  const dist = { excellent: 0, good: 0, regular: 0, critical: 0, zero: 0 };
  monitorias.forEach(m => {
    if (m.pct >= 95) dist.excellent++;
    else if (m.pct >= 70) dist.good++;
    else if (m.pct >= 50) dist.regular++;
    else if (m.pct > 0)   dist.critical++;
    else dist.zero++;
  });

  return { count, avgPct, ptsLost, zeroed, dist };
}
