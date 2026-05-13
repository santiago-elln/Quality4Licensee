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
  /* ── Team-1 (Alpha) – extras ─── */
  {
    id: 'obs-6', monitoriaId: null, colaboradorId: 'collab-3',
    type: 'E', criteria: 'Procedimento Correto',
    text: 'Não seguiu o protocolo de escalonamento para clientes executivos',
    authorId: 'user-anal-1', date: '2026-04-20', attendanceId: '260310534699',
  },
  {
    id: 'obs-7', monitoriaId: null, colaboradorId: 'collab-4',
    type: 'A', criteria: 'Registro e Documentação',
    text: 'Documentação exemplar — histórico completo e tabulação correta',
    authorId: 'user-sup-1', date: '2026-04-18', attendanceId: '260310534700',
  },
  {
    id: 'obs-8', monitoriaId: null, colaboradorId: 'collab-2',
    type: 'O', criteria: 'Comunicação e Linguagem',
    text: 'Pode melhorar a empatia verbal ao lidar com reclamações de executivos',
    authorId: 'user-anal-1', date: '2026-04-22', attendanceId: '260310534701',
  },
  {
    id: 'obs-9', monitoriaId: null, colaboradorId: 'collab-3',
    type: 'E', criteria: 'Conhecimento e Assertividade',
    text: 'Informação sobre prazo de ativação estava incorreta para plano executivo',
    authorId: 'user-anal-1', date: '2026-04-25', attendanceId: '260310534702',
  },
  /* ── Team-2 (Beta) ─── */
  {
    id: 'obs-10', monitoriaId: null, colaboradorId: 'collab-5',
    type: 'E', criteria: 'Eficiência e Tempo',
    text: 'TMA acima de 45 min — não utilizou histórico antes de responder',
    authorId: 'user-anal-1', date: '2026-04-12', attendanceId: '382710934501',
  },
  {
    id: 'obs-11', monitoriaId: null, colaboradorId: 'collab-5',
    type: 'E', criteria: 'Comunicação e Linguagem',
    text: 'Utilizou jargões técnicos sem explicação para o cliente gestor',
    authorId: 'user-anal-1', date: '2026-04-18', attendanceId: '382710934502',
  },
  {
    id: 'obs-12', monitoriaId: null, colaboradorId: 'collab-6',
    type: 'A', criteria: 'Procedimento Correto',
    text: 'Seguiu todos os passos do protocolo — demanda resolvida no primeiro contato',
    authorId: 'user-sup-2', date: '2026-04-10', attendanceId: '382710934503',
  },
  {
    id: 'obs-13', monitoriaId: null, colaboradorId: 'collab-6',
    type: 'O', criteria: 'Eficiência e Tempo',
    text: 'Pode reduzir TMA usando templates de resposta para demandas recorrentes',
    authorId: 'user-anal-1', date: '2026-04-15', attendanceId: '382710934504',
  },
  {
    id: 'obs-14', monitoriaId: null, colaboradorId: 'collab-7',
    type: 'E', criteria: 'Eficiência e Tempo',
    text: 'Encerrou sem aguardar confirmação do cliente — FCR comprometido',
    authorId: 'user-anal-1', date: '2026-04-20', attendanceId: '382710934505',
  },
  {
    id: 'obs-15', monitoriaId: null, colaboradorId: 'collab-7',
    type: 'A', criteria: 'Registro e Documentação',
    text: 'Registro com alto nível de detalhe — histórico facilita recontatos',
    authorId: 'user-sup-2', date: '2026-04-23', attendanceId: '382710934506',
  },
  /* ── Team-3 (Gamma) ─── */
  {
    id: 'obs-16', monitoriaId: null, colaboradorId: 'collab-8',
    type: 'E', criteria: 'Comunicação e Linguagem',
    text: 'Pouca empatia com cliente insatisfeito — contribuiu para CSAT ≤ 3',
    authorId: 'user-anal-1', date: '2026-04-08', attendanceId: '472810934601',
  },
  {
    id: 'obs-17', monitoriaId: null, colaboradorId: 'collab-8',
    type: 'E', criteria: 'Conhecimento e Assertividade',
    text: 'Repassou prazo de ativação incorreto — cliente recontactou na sequência',
    authorId: 'user-anal-1', date: '2026-04-14', attendanceId: '472810934602',
  },
  {
    id: 'obs-18', monitoriaId: null, colaboradorId: 'collab-8',
    type: 'O', criteria: 'Comunicação e Linguagem',
    text: 'Trabalhar escuta ativa e validação do entendimento ao longo do atendimento',
    authorId: 'user-sup-3', date: '2026-04-16', attendanceId: '472810934603',
  },
  {
    id: 'obs-19', monitoriaId: null, colaboradorId: 'collab-9',
    type: 'A', criteria: 'Eficiência e Tempo',
    text: 'FCR excelente — resolveu a demanda em 18 min, abaixo da média da equipe',
    authorId: 'user-anal-1', date: '2026-04-11', attendanceId: '472810934604',
  },
  {
    id: 'obs-20', monitoriaId: null, colaboradorId: 'collab-9',
    type: 'E', criteria: 'Comunicação e Linguagem',
    text: 'Tom inadequado ao lidar com cliente insatisfeito — escalonamento necessário',
    authorId: 'user-sup-3', date: '2026-04-22', attendanceId: '472810934605',
  },
  {
    id: 'obs-21', monitoriaId: null, colaboradorId: 'collab-8',
    type: 'O', criteria: 'Registro e Documentação',
    text: 'Melhorar tabulação — demandas categorizadas incorretamente em 3 atendimentos',
    authorId: 'user-anal-1', date: '2026-04-26', attendanceId: '472810934606',
  },
  /* ── Team-4 (Delta – Performance) ─── */
  {
    id: 'obs-22', monitoriaId: null, colaboradorId: 'collab-10',
    type: 'E', criteria: 'Conversão',
    text: 'Não utilizou argumentos de valor ao apresentar produto a lead de influenciador',
    authorId: 'user-anal-1', date: '2026-04-09', attendanceId: '592810934701',
  },
  {
    id: 'obs-23', monitoriaId: null, colaboradorId: 'collab-10',
    type: 'A', criteria: 'Eficiência de Backlog',
    text: 'Cleared 12 leads atrasados no dia, superando a meta diária individual',
    authorId: 'user-sup-4', date: '2026-04-17', attendanceId: '592810934702',
  },
  {
    id: 'obs-24', monitoriaId: null, colaboradorId: 'collab-11',
    type: 'O', criteria: 'Conversão',
    text: 'Explorar gatilhos de escassez e prova social ao abordar parceiros B2B',
    authorId: 'user-anal-1', date: '2026-04-13', attendanceId: '592810934703',
  },
  {
    id: 'obs-25', monitoriaId: null, colaboradorId: 'collab-11',
    type: 'A', criteria: 'Comunicação e Linguagem',
    text: 'Rapport excelente com parceiro B2B — abordagem consultiva e profissional',
    authorId: 'user-anal-1', date: '2026-04-19', attendanceId: '592810934704',
  },
  {
    id: 'obs-26', monitoriaId: null, colaboradorId: 'collab-11',
    type: 'E', criteria: 'Conversão',
    text: 'Perdeu oportunidade de upsell durante onboarding de novo parceiro',
    authorId: 'user-sup-4', date: '2026-04-25', attendanceId: '592810934705',
  },
  {
    id: 'obs-27', monitoriaId: null, colaboradorId: 'collab-10',
    type: 'O', criteria: 'Eficiência de Backlog',
    text: 'Priorizar leads mais quentes ao abrir o backlog — aumenta conversão marginal',
    authorId: 'user-anal-1', date: '2026-04-28', attendanceId: '592810934706',
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

/* ── Queue stats generator (telephony) ──────── */
function mkSeeded(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let s = h || 1;
  return function () {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

const QUEUE_BASE = {
  'team-1': { ent: 38, tme: 72,  tma: 385, tmpr: 48 },
  'team-2': { ent: 63, tme: 138, tma: 545, tmpr: 90 },
  'team-3': { ent: 55, tme: 118, tma: 510, tmpr: 82 },
};
export const QUEUE_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

export function getQueueStats(teamIds, month) {
  const r = mkSeeded(teamIds.join(',') + '|' + month);
  const [yr, mo] = month.split('-').map(Number);
  const numDays = new Date(yr, mo, 0).getDate();

  const bases = teamIds.map(id => QUEUE_BASE[id] ?? { ent: 40, tme: 100, tma: 450, tmpr: 70 });
  const base = {
    ent:  bases.reduce((s, b) => s + b.ent, 0),
    tme:  Math.round(bases.reduce((s, b) => s + b.tme, 0)  / bases.length),
    tma:  Math.round(bases.reduce((s, b) => s + b.tma, 0)  / bases.length),
    tmpr: Math.round(bases.reduce((s, b) => s + b.tmpr, 0) / bases.length),
  };

  /* Daily series — also record the activity factor per day */
  const daily = Array.from({ length: numDays }, (_, i) => {
    const d = new Date(yr, mo - 1, i + 1);
    const wknd = d.getDay() === 0 || d.getDay() === 6;
    const f = wknd ? 0.12 + r() * 0.10 : 0.80 + r() * 0.34;
    const ent = Math.max(0, Math.round(base.ent * f));
    const fin = Math.round(ent * (0.87 + r() * 0.10));
    return { day: i + 1, ent, fin, f };   /* f = activity factor 0-1 */
  });

  /* ── 2-D matrices [hourIdx][dayIdx] ─────────── */
  const rEnt  = mkSeeded(teamIds.join(',') + '|' + month + '|ent');
  const rTme  = mkSeeded(teamIds.join(',') + '|' + month + '|tme');
  const rTma  = mkSeeded(teamIds.join(',') + '|' + month + '|tma');
  const rTmpr = mkSeeded(teamIds.join(',') + '|' + month + '|tmpr');

  const entMatrix = QUEUE_HOURS.map(h => {
    const pk = (h >= 9 && h <= 11) || (h >= 14 && h <= 16);
    const hf = pk ? 1.6 : 0.55;
    return daily.map(d =>
      d.ent === 0 ? 0
        : Math.max(0, Math.round((d.ent / QUEUE_HOURS.length) * hf * (0.6 + rEnt() * 0.8)))
    );
  });

  const tmeMatrix = QUEUE_HOURS.map(h => {
    const pk = (h >= 9 && h <= 11) || (h >= 14 && h <= 16);
    const hf = pk ? 1.50 : 0.58;
    return daily.map(d =>
      d.ent === 0 ? 0
        : Math.max(5, Math.round(base.tme * hf * (0.72 + d.f * 0.38) + (rTme() - .5) * 38))
    );
  });

  const tmaMatrix = QUEUE_HOURS.map(h => {
    /* TMA slightly higher in morning and after-lunch transitions */
    const hf = (h === 8 || h === 13) ? 1.15 : 1.0;
    return daily.map(d =>
      d.ent === 0 ? 0
        : Math.max(60, Math.round(base.tma * hf * (0.86 + d.f * 0.22) + (rTma() - .5) * 110))
    );
  });

  const tmprMatrix = QUEUE_HOURS.map(h => {
    const pk = (h >= 9 && h <= 11) || (h >= 14 && h <= 16);
    const hf = pk ? 1.38 : 0.70;
    return daily.map(d =>
      d.ent === 0 ? 0
        : Math.max(5, Math.round(base.tmpr * hf * (0.80 + d.f * 0.26) + (rTmpr() - .5) * 22))
    );
  });

  /* 1-D averages (business hours only) for summary cards */
  const avg1D = (matrix) => {
    const vals = matrix.flat().filter(v => v > 0);
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
  };

  const csatN = daily.reduce((s, d) => s + Math.round(d.fin * 0.53), 0);
  const c5 = Math.round(csatN * (0.41 + r() * 0.09));
  const c4 = Math.round(csatN * (0.27 + r() * 0.07));
  const c3 = Math.round(csatN * (0.13 + r() * 0.04));
  const c2 = Math.round(csatN * (0.06 + r() * 0.02));
  const c1 = Math.max(0, csatN - c5 - c4 - c3 - c2);

  const totFin = daily.reduce((s, d) => s + d.fin, 0);
  const rTab   = mkSeeded(teamIds.join(',') + '|' + month + '|tab');
  const tagRows = EXEC_GEST_TAGS.map(t => ({
    tag: t.tag,
    n: Math.max(1, Math.round(t.base * (base.ent / 38) * (0.70 + rTab() * 0.55))),
  })).sort((a, b) => b.n - a.n);
  const tagSum = tagRows.reduce((s, t) => s + t.n, 0);
  tagRows.forEach(t => { t.pct = tagSum > 0 ? Math.round(t.n / tagSum * 100) : 0; });

  return {
    daily, numDays,
    entMatrix, tmeMatrix, tmaMatrix, tmprMatrix,
    csat: [c1, c2, c3, c4, c5], csatTotal: csatN,
    tabulacoes: { total: Math.round(totFin * 0.68), top10: tagRows },
    totals: {
      ent:  daily.reduce((s, d) => s + d.ent, 0),
      fin:  totFin,
      tme:  avg1D(tmeMatrix),
      tma:  avg1D(tmaMatrix),
      tmpr: avg1D(tmprMatrix),
    },
  };
}

/* ── Telephony call-tagging taxonomy ────────── */
const EXEC_GEST_TAGS = [
  { tag: 'Contrato (envio/atualização) - Licenciados', base: 42 },
  { tag: 'Boleto (envio/atualização) - Licenciados',   base: 36 },
  { tag: 'Devolutiva',                                  base: 30 },
  { tag: 'Ativação de cliente: validação em atraso',    base: 25 },
  { tag: 'Correção de contrato',                        base: 20 },
  { tag: 'Cancelamento de cliente',                     base: 16 },
  { tag: 'Repasse - Conexão Expansão',                  base: 14 },
  { tag: 'Bug no app - Licenciados',                    base: 12 },
  { tag: 'Contrato Redigido Instalador - Conexão Placas', base: 10 },
  { tag: 'Débito: informações sobre faturas em aberto', base: 9  },
];

/* ── Performance channel stats generator ────── */
const PERF_TAGS = [
  { tag: 'Onboarding B2B',   base: 45 },
  { tag: 'Conv. Influencer', base: 38 },
  { tag: 'Suporte Técnico',  base: 29 },
  { tag: 'Renovação',        base: 22 },
  { tag: 'Cancelamento',     base: 18 },
];

export function getPerfStats(month) {
  const r = mkSeeded('perf|' + month);
  const [yr, mo] = month.split('-').map(Number);
  const days = new Date(yr, mo, 0).getDate();

  const daily = Array.from({ length: days }, (_, i) => {
    const d = new Date(yr, mo - 1, i + 1);
    const wknd = d.getDay() === 0 || d.getDay() === 6;
    const f = wknd ? 0.28 + r() * 0.18 : 0.75 + r() * 0.42;
    const ent = Math.max(0, Math.round(22 * f));
    const fin = Math.round(ent * (0.85 + r() * 0.12));
    return { day: i + 1, ent, fin };
  });

  const totEnt = daily.reduce((s, d) => s + d.ent, 0);
  const totFin = daily.reduce((s, d) => s + d.fin, 0);

  const csatN = Math.round(totFin * 0.6);
  const c5c = Math.round(csatN * (0.44 + r() * 0.08));
  const c4c = Math.round(csatN * (0.28 + r() * 0.07));
  const c3c = Math.round(csatN * (0.13 + r() * 0.04));
  const c2c = Math.round(csatN * (0.07 + r() * 0.02));
  const c1c = Math.max(0, csatN - c5c - c4c - c3c - c2c);

  const cesN = csatN;
  const e5c = Math.round(cesN * (0.37 + r() * 0.08));
  const e4c = Math.round(cesN * (0.29 + r() * 0.07));
  const e3c = Math.round(cesN * (0.17 + r() * 0.04));
  const e2c = Math.round(cesN * (0.10 + r() * 0.02));
  const e1c = Math.max(0, cesN - e5c - e4c - e3c - e2c);

  const rEntP = mkSeeded('perf|' + month + '|ent');
  const entMatrix = QUEUE_HOURS.map(h => {
    const pk = (h >= 9 && h <= 11) || (h >= 14 && h <= 16);
    const hf = pk ? 1.6 : 0.55;
    return daily.map(d =>
      d.ent === 0 ? 0
        : Math.max(0, Math.round((d.ent / QUEUE_HOURS.length) * hf * (0.6 + rEntP() * 0.8)))
    );
  });

  const atrib = Math.round(totFin * (0.82 + r() * 0.1));
  const taggedTotal = Math.round(totFin * (0.65 + r() * 0.20));
  const top5 = PERF_TAGS.map(t => ({ tag: t.tag, n: Math.round(t.base * (0.78 + r() * 0.44)) }))
    .sort((a, b) => b.n - a.n);

  return {
    daily, numDays: days, entMatrix, totEnt, totFin,
    eficiencia:  Math.round(80 + r() * 14),
    conversao: {
      influencers: Math.round(28 + r() * 10),
      lebes:       Math.round(21 + r() * 10),
    },
    tmpr: Math.round(175 + r() * 85),
    tmr:  Math.round(3400 + r() * 2600),
    csat: [c1c, c2c, c3c, c4c, c5c], csatTotal: csatN,
    ces:  [e1c, e2c, e3c, e4c, e5c],  cesTotal:  cesN,
    backlog:       Math.round(12 + r() * 48),
    oldestWaitSec: Math.round(180 + r() * 2820),
    aguardando:   { cliente: Math.round(38 + r() * 22), suporte: Math.round(22 + r() * 18) },
    atribuicoes:  { atribuido: atrib, livre: Math.max(0, totFin - atrib) },
    tabulacoes:   { total: taggedTotal, top5 },
  };
}

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

/* ── Per-hour metric bases for TMR (Performance reply time) ─ */
const TMR_BASE = { 'team-1': 165, 'team-2': 230, 'team-3': 210 };

/* ── Daily ENT/FIN generator (any date) ─────── */
export function getDailyStats(teamIds, dateStr) {
  // dateStr: 'YYYY-MM-DD' — noon anchor avoids DST edge-cases
  const key = teamIds.slice().sort().join(',') + '|' + dateStr;
  const r = mkSeeded(key);

  const bases = teamIds.map(id => QUEUE_BASE[id] ?? { ent: 40, tme: 100, tma: 450, tmpr: 70 });
  const baseEnt = bases.reduce((s, b) => s + b.ent, 0);

  const date = new Date(dateStr + 'T12:00:00');
  const dow = date.getDay();
  const isWeekend = dow === 0 || dow === 6;

  const f = isWeekend ? 0.12 + r() * 0.10 : 0.80 + r() * 0.34;
  const ent = Math.max(0, Math.round(baseEnt * f));
  const fin = Math.round(ent * (0.87 + r() * 0.10));

  return { ent, fin };
}

/* ── Daily per-hour metric generator (any date) ─ */
export function getDailyHeatmapStats(teamIds, dateStr) {
  const sorted = teamIds.slice().sort().join(',');

  // Separate seeder per metric so values are independent
  const rF    = mkSeeded(sorted + '|' + dateStr + '|f');
  const rTme  = mkSeeded(sorted + '|' + dateStr + '|tme');
  const rTma  = mkSeeded(sorted + '|' + dateStr + '|tma');
  const rTmpr = mkSeeded(sorted + '|' + dateStr + '|tmpr');
  const rTmr  = mkSeeded(sorted + '|' + dateStr + '|tmr');

  const bases = teamIds.map(id => QUEUE_BASE[id] ?? { ent: 40, tme: 100, tma: 450, tmpr: 70 });
  const avg = arr => Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
  const base = {
    tme:  avg(bases.map(b => b.tme)),
    tma:  avg(bases.map(b => b.tma)),
    tmpr: avg(bases.map(b => b.tmpr)),
    tmr:  avg(teamIds.map(id => TMR_BASE[id] ?? 200)),
  };

  const date = new Date(dateStr + 'T12:00:00');
  const dow = date.getDay();
  const isWeekend = dow === 0 || dow === 6;
  const f = isWeekend ? 0.12 + rF() * 0.10 : 0.80 + rF() * 0.34;
  const zero = isWeekend && f < 0.15;

  // Mirror exactly the formulas in getQueueStats for each metric
  const tme = QUEUE_HOURS.map(h => {
    if (zero) return 0;
    const pk = (h >= 9 && h <= 11) || (h >= 14 && h <= 16);
    return Math.max(5, Math.round(base.tme * (pk ? 1.50 : 0.58) * (0.72 + f * 0.38) + (rTme() - 0.5) * 38));
  });

  const tma = QUEUE_HOURS.map(h => {
    if (zero) return 0;
    const hf = (h === 8 || h === 13) ? 1.15 : 1.0;
    return Math.max(60, Math.round(base.tma * hf * (0.86 + f * 0.22) + (rTma() - 0.5) * 110));
  });

  const tmpr = QUEUE_HOURS.map(h => {
    if (zero) return 0;
    const pk = (h >= 9 && h <= 11) || (h >= 14 && h <= 16);
    return Math.max(5, Math.round(base.tmpr * (pk ? 1.38 : 0.70) * (0.80 + f * 0.26) + (rTmpr() - 0.5) * 22));
  });

  const tmr = QUEUE_HOURS.map(h => {
    if (zero) return 0;
    const pk = (h >= 9 && h <= 11) || (h >= 14 && h <= 16);
    return Math.max(5, Math.round(base.tmr * (pk ? 1.35 : 0.65) * (0.78 + f * 0.28) + (rTmr() - 0.5) * 28));
  });

  return { tme, tma, tmpr, tmr };
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
