/* ============================================================
   CONFIG — Configuração estática de critérios de avaliação
   ============================================================ */

export const EVAL_CATEGORIES = [
  {
    id: 'procedimento_correto',
    name: 'Procedimento Correto',
    totalPts: 12,
    items: [
      { id: 'leitura_ativa',    name: 'Leitura ativa',                                pts: 4, description: 'Leu e analisou todas as informações disponíveis no Sol antes de iniciar, e se atentou às mensagens que ele mandou posteriormente, não deixando dúvidas sem respostas.' },
      { id: 'politicas',        name: 'Cumpriu políticas internas e de conformidade',  pts: 4, description: 'Seguiu padrões exigidos pela gestão, respeitando prazos (SLA) e regras já alinhadas' },
      { id: 'encaminhamento',   name: 'Encaminhamento de demandas',                    pts: 4, description: 'Direcionamento correto das demandas que não conseguimos tratar diretamente em atendimento' },
    ],
  },
  {
    id: 'comunicacao_linguagem',
    name: 'Comunicação e Linguagem',
    totalPts: 22,
    items: [
      { id: 'empatia',          name: 'Empatia',                              pts: 4, description: 'Reconheceu e validou as preocupações do licenciado' },
      { id: 'sem_jargoes',      name: 'Evitou jargões ou termos confusos',    pts: 4, description: 'Usou vocabulário simples e exemplos claros que o licenciado entenda' },
      { id: 'explicacao_clara', name: 'Explicação clara',                     pts: 5, description: 'Confirmou que o licenciado entendeu o que foi dito' },
      { id: 'foco_assunto',     name: 'Foco no assunto',                      pts: 5, description: 'Evitou desviar da demanda solicitada pelo licenciado para não haver confusão' },
      { id: 'dominio_conversa', name: 'Domínio da conversa e linguagens',     pts: 4, description: 'Evitou repetições desnecessárias e explicou sem rodeios o que foi perguntado pelo licenciado' },
    ],
  },
  {
    id: 'eficiencia_tempo',
    name: 'Eficiência e Tempo',
    totalPts: 21,
    items: [
      { id: 'objetivo',         name: 'Atendimento objetivo',                 pts: 7, description: 'Atendimento direto ao ponto, focado em tratar efetivamente a demanda do licenciado, sem desvios desnecessários.' },
      { id: 'historico',        name: 'Verificando histórico e demanda',       pts: 5, description: 'Verificou o que foi encaminhado na sol no início do atendimento e aproveitou para resolver questões relacionadas à demanda encaminhada no atendimento' },
      { id: 'fcr',              name: 'Resolução em primeiro contato',         pts: 5, description: 'Buscou os melhores possíveis para solucionar a demanda já no primeiro contato do licenciado' },
      { id: 'encerramento',     name: 'Tempo de encerramento adequado',        pts: 4, description: 'Se atentou para não encerrar o atendimento antes do tempo estabelecido.' },
    ],
  },
  {
    id: 'conhecimento_assertividade',
    name: 'Conhecimento e Assertividade',
    totalPts: 32,
    items: [
      { id: 'seguranca_info',   name: 'Segurança nas informações',             pts: 10, description: 'Passou segurança nas informações repassadas ao licenciado' },
      { id: 'info_completas',   name: 'Informações completas',                 pts: 4, description: 'Informou a respeito da demanda dele, passando o motivo, causa e efeito da solicitação. (O que ele pediu, o que podemos fazer, e o que isso fará acontecer)' },
      { id: 'consistencia',     name: 'Mantém consistência nas respostas',     pts: 8, description: 'Evitou contradições em relação ao já informado no atendimento' },
      { id: 'info_corretas',    name: 'Informações corretas',                  pts: 10, description: 'Repassou tudo corretamente a licenciado e internamente, garantindo assertividade nos processos' },
    ],
  },
  {
    id: 'registro_documentacao',
    name: 'Registro e Documentação',
    totalPts: 13,
    items: [
      { id: 'tabulacao',        name: 'Tabulação correta da demanda',          pts: 3, description: 'Tabulação de acordo com a principal demanda do licenciado' },
      { id: 'registro_claro',   name: 'Registro de informações clara e completa', pts: 5, description: 'Realizou todos os registros necessários, sempre que alterando algo no cadastro, anotando em atendimento(O que fez, porque fez, e o que foi verificado para fazer)' },
      { id: 'obs_relevantes',   name: 'Incluiu observações relevantes',        pts: 5, description: 'Inseriu anotação interna no atendimento em caso de chamados abertos, com o link do chamado' },
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
