/* ============================================================
   DASHBOARD — Painel principal de métricas (enhanced)
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { getCurrentPeriod } from '../components/header.js';
import {
  getCollabsForViewer, getMonitorias, getMonitoriaStats,
  MOCK_USERS, TEAMS, TEAM_GOALS, AI_INSIGHTS, OBSERVATIONS,
  getTeam, getDept,
} from '../data/mock.js';
import {
  scoreColor, monthOptions, getInitials,
} from '../utils/formatters.js';
import { ACCESS_LEVELS } from '../utils/access.js';
import { navigate } from '../router.js';

export function render() {
  const user   = getCurrentUser();
  const period = getCurrentPeriod() ?? monthOptions(1)[0].key;
  const periodLabel = monthOptions(12).find(m => m.key === period)?.label ?? period;
  const prevPeriod  = prevMonth(period);

  const collabs  = getCollabsForViewer(user).filter(c => c.role === 'colaborador');
  const deptMons = getMonitorias({ month: period, deptId: user.deptId })
    .filter(m => collabs.some(c => c.id === m.colaboradorId));
  const stats  = getMonitoriaStats(deptMons);

  const dept  = getDept(user.deptId);
  const title = user.accessLevel >= ACCESS_LEVELS.ANALISTA
    ? (dept?.name ?? 'Departamento')
    : (getTeam(user.teamId)?.name ?? 'Minha Equipe');

  const goals = user.teamId ? TEAM_GOALS[user.teamId] : { minScore: 36, qualityTarget: 80 };
  const goalsAchieved = deptMons.filter(m => m.pct >= goals.qualityTarget).length;
  const goalsAchievedPct = deptMons.length
    ? Math.round((goalsAchieved / deptMons.length) * 100) : 0;

  return `
    <div class="page-enter">
      <!-- Page header -->
      <div class="dash-page-header">
        <div class="dash-page-header__info">
          <div class="dash-page-header__title">${title} — Painel</div>
          <div class="dash-page-header__meta">${periodLabel} · ${stats.count} monitoria${stats.count !== 1 ? 's' : ''} · Meta: ${goals.minScore} pts</div>
        </div>
        <div class="dash-page-header__actions">
          <button class="btn btn--outline btn--sm" onclick="window.location.hash='#consulta'">
            🔍 Consultar Associados
          </button>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="kpi-grid">
        ${kpiCard('Monitorias', stats.count, '', 'green',
          `<a href="#registros" class="text-brand">ver registros</a>`)}
        ${kpiCard('Aproveitamento Médio', stats.count ? stats.avgPct + '%' : '—', '', 'blue',
          stats.count ? `Pontos: ${Math.round(stats.avgPct)} / 100` : 'sem dados')}
        ${kpiCard('Pts Perdidos / Mon', stats.count ? stats.ptsLost : '—', '', 'red',
          `média por monitoria`)}
        ${kpiCard('Meta de Qualidade', goalsAchievedPct + '%', '', 'orange',
          `Alvo: ${goals.qualityTarget}% · ${goalsAchieved} de ${deptMons.length}`)}
        ${kpiCard('Zeradas', stats.zeroed, '', 'purple',
          stats.zeroed === 0 ? '<span class="text-success">Nenhuma ✓</span>' : '<span class="text-danger">atenção</span>')}
      </div>

      <!-- Supervisor/Sector Quality Table + AI Insights -->
      <div class="content-row cols-2">
        ${supervisorTable(user, period, prevPeriod)}
        ${aiHighlightsPanel(user)}
      </div>

      <!-- Insights: Errors / Strengths / Opportunities -->
      ${insightsBucketsSection(user, period, collabs, deptMons)}

      <!-- Distribution -->
      <div class="dist-section">
        <div class="dist-section-header">
          <span class="dist-section-title">Distribuição de Resultados — ${periodLabel}</span>
        </div>
        <div class="dist-grid">
          ${distCard('Excelente', stats.dist.excellent, stats.count, '≥95%',  'excellent')}
          ${distCard('Bom',       stats.dist.good,      stats.count, '70–94%', 'good')}
          ${distCard('Regular',   stats.dist.regular,   stats.count, '50–69%', 'regular')}
          ${distCard('Crítico',   stats.dist.critical,  stats.count, '1–49%',  'critical')}
          ${distCard('Zerada',    stats.dist.zero,      stats.count, '0%',     'zero')}
        </div>
      </div>

      <!-- Evolution + Ranking + Goals -->
      <div class="content-row cols-2">
        ${evolutionPanel()}
        ${rankingPanel(collabs, deptMons)}
      </div>

      <div class="content-row cols-2">
        ${ptsLostPanel(collabs, deptMons)}
        ${goalsPanel(goals, goalsAchievedPct, stats)}
      </div>
    </div>
  `;
}

/* ── Sub-render helpers ──────────────────── */

function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function kpiCard(label, value, unit, accent, meta) {
  return `
    <div class="kpi-card">
      <div class="kpi-card__accent kpi-card__accent--${accent}"></div>
      <div class="kpi-card__body">
        <div class="kpi-card__label">${label}</div>
        <div class="kpi-card__value">${value}${unit}</div>
        <div class="kpi-card__meta">${meta}</div>
      </div>
    </div>
  `;
}

function distCard(label, count, total, range, cls) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return `
    <div class="dist-card dist-card--${cls}">
      <div class="dist-card__pct">${pct}%</div>
      <div class="dist-card__label">${label}</div>
      <div class="dist-card__range">${range}</div>
      <div class="dist-card__count">${count}</div>
    </div>
  `;
}

function supervisorTable(user, period, prevPeriod) {
  const teams = TEAMS.filter(t => t.deptId === user.deptId);
  const rows = teams.map(team => {
    const collabs = MOCK_USERS.filter(u => u.teamId === team.id && u.role === 'colaborador');
    const ids = new Set(collabs.map(c => c.id));
    const cur  = getMonitorias({ month: period }).filter(m => ids.has(m.colaboradorId));
    const prev = getMonitorias({ month: prevPeriod }).filter(m => ids.has(m.colaboradorId));
    const cs = getMonitoriaStats(cur);
    const ps = getMonitoriaStats(prev);
    const sup = MOCK_USERS.find(u => u.id === team.supervisorId);
    const delta = cs.count && ps.count ? cs.avgPct - ps.avgPct : null;
    const trend = delta === null ? 'same'
      : delta > 2 ? 'up' : delta < -2 ? 'down' : 'same';
    const trendLabel = delta === null ? '—'
      : delta > 0 ? `↑ +${delta}%` : delta < 0 ? `↓ ${delta}%` : '→ estável';
    return { team, sup, cs, trend, trendLabel };
  });

  const tableRows = rows.map(({ team, sup, cs, trend, trendLabel }) => `
    <tr class="supervisor-row" data-team="${team.id}">
      <td>
        <div style="font-weight:600;color:var(--text-primary)">${team.name}</div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <div class="user-avatar" style="width:24px;height:24px;font-size:10px;background:linear-gradient(135deg,var(--brand-green),var(--brand-green-dark))">
            ${getInitials(sup?.name ?? '?')}
          </div>
          <span style="font-size:var(--text-sm)">${sup?.name?.split(' ')[0] ?? '—'}</span>
        </div>
      </td>
      <td class="text-center">${cs.count}</td>
      <td>
        <div class="score-cell">
          <div class="score-bar" style="min-width:50px">
            <div class="score-bar__fill" style="width:${cs.avgPct}%;background:${scoreColor(cs.avgPct)}"></div>
          </div>
          <span class="score-val" style="color:${scoreColor(cs.avgPct)}">${cs.count ? cs.avgPct + '%' : '—'}</span>
        </div>
      </td>
      <td class="text-center" style="color:var(--color-danger);font-weight:600">${cs.count ? cs.ptsLost : '—'}</td>
      <td class="text-center">${cs.zeroed ?? 0}</td>
      <td class="text-center">
        <span class="trend-pill trend-pill--${trend}">${trendLabel}</span>
      </td>
    </tr>
  `).join('');

  return `
    <div class="panel">
      <div class="panel__header">
        <div class="panel__title">Qualidade por Equipe e Supervisor</div>
        <span class="panel__hint">vs. mês anterior</span>
      </div>
      <div class="supervisor-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Equipe</th>
              <th>Supervisor</th>
              <th style="text-align:center">Mons</th>
              <th>Aproveit.</th>
              <th style="text-align:center">Pts Perdidos</th>
              <th style="text-align:center">Zeradas</th>
              <th style="text-align:center">Tendência</th>
            </tr>
          </thead>
          <tbody>${tableRows || '<tr><td colspan="7" style="text-align:center;padding:var(--space-6);color:var(--text-tertiary)">Sem dados para o período</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function aiHighlightsPanel(user) {
  const relevantInsights = AI_INSIGHTS.slice(0, 3);
  const cards = relevantInsights.map(insight => {
    const sev = insight.severity;
    const sevCls = { high: 'warning', medium: 'info', critical: 'danger', low: 'success' }[sev] ?? 'neutral';
    const typeIcon = { deviation: '⚠️', trend: '📈', pattern: '🔍', praise: '🌟' }[insight.type] ?? '📌';
    return `
      <div style="padding:var(--space-3);border-bottom:1px solid var(--border-light);cursor:pointer"
           class="ai-highlight-item" data-insight="${insight.id}">
        <div style="display:flex;align-items:flex-start;gap:var(--space-2)">
          <span style="font-size:.9rem;flex-shrink:0;margin-top:1px">${typeIcon}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);margin-bottom:3px">
              <span style="font-size:var(--text-xs);font-weight:700;color:var(--text-primary)">${insight.title}</span>
              <span class="badge badge--${sevCls}" style="flex-shrink:0">${insight.severity}</span>
            </div>
            <p style="font-size:var(--text-xs);color:var(--text-secondary);line-height:var(--leading-snug);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${insight.summary}</p>
            <div style="font-size:10px;color:var(--text-tertiary);margin-top:3px">Alvo: <strong>${insight.targetName}</strong></div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="panel">
      <div class="panel__header">
        <div class="panel__title">Análise por IA</div>
        <span class="ai-badge">✨ Claude</span>
      </div>
      <div style="font-size:var(--text-xs);color:var(--text-secondary);padding:var(--space-2) var(--space-5) 0;display:flex;align-items:center;gap:var(--space-2)">
        <span>🕐</span> Última análise: hoje · Baseada em ${AI_INSIGHTS.length} insights gerados
      </div>
      ${cards}
      <div class="panel__footer" style="text-align:center">
        <a href="#ai-analise" style="font-size:var(--text-xs);font-weight:600;color:var(--brand-green)">
          Ver análise completa →
        </a>
      </div>
    </div>
  `;
}

function insightsBucketsSection(_user, _period, collabs, _deptMons) {
  const obs = OBSERVATIONS.filter(o => collabs.some(c => c.id === o.colaboradorId));

  /* Errors: group by criteria */
  const errorsByCriteria = {};
  obs.filter(o => o.type === 'E').forEach(o => {
    const key = o.criteria ?? 'Geral';
    if (!errorsByCriteria[key]) errorsByCriteria[key] = { count: 0, names: new Set() };
    errorsByCriteria[key].count++;
    errorsByCriteria[key].names.add(MOCK_USERS.find(u=>u.id===o.colaboradorId)?.name?.split(' ')[0] ?? '?');
  });
  const topErrors = Object.entries(errorsByCriteria)
    .sort((a,b) => b[1].count - a[1].count).slice(0, 5);

  /* Strengths: type A by criteria */
  const strengthsByCriteria = {};
  obs.filter(o => o.type === 'A').forEach(o => {
    const key = o.criteria ?? 'Geral';
    if (!strengthsByCriteria[key]) strengthsByCriteria[key] = { count: 0, names: new Set() };
    strengthsByCriteria[key].count++;
    strengthsByCriteria[key].names.add(MOCK_USERS.find(u=>u.id===o.colaboradorId)?.name?.split(' ')[0] ?? '?');
  });
  const topStrengths = Object.entries(strengthsByCriteria)
    .sort((a,b) => b[1].count - a[1].count).slice(0, 5);

  /* Opportunities: type O */
  const oppsByCriteria = {};
  obs.filter(o => o.type === 'O').forEach(o => {
    const key = o.criteria ?? 'Geral';
    if (!oppsByCriteria[key]) oppsByCriteria[key] = { count: 0, names: new Set() };
    oppsByCriteria[key].count++;
    oppsByCriteria[key].names.add(MOCK_USERS.find(u=>u.id===o.colaboradorId)?.name?.split(' ')[0] ?? '?');
  });
  const topOpps = Object.entries(oppsByCriteria)
    .sort((a,b) => b[1].count - a[1].count).slice(0, 5);

  const errorItems = topErrors.length
    ? topErrors.map(([k, v]) => `
        <div class="insight-bucket-item">
          <div>
            <div class="insight-bucket-item__name">${k}</div>
            <div class="insight-bucket-item__sub">${Array.from(v.names).slice(0,3).join(', ')}</div>
          </div>
          <span class="insight-bucket-item__count badge badge--danger">${v.count}×</span>
        </div>
      `).join('')
    : `<div style="font-size:var(--text-xs);color:var(--text-tertiary);padding:var(--space-3)">Nenhum erro registrado</div>`;

  const strengthItems = topStrengths.length
    ? topStrengths.map(([k, v]) => `
        <div class="insight-bucket-item">
          <div>
            <div class="insight-bucket-item__name">${k}</div>
            <div class="insight-bucket-item__sub">${Array.from(v.names).slice(0,3).join(', ')}</div>
          </div>
          <span class="insight-bucket-item__count badge badge--success">${v.count}×</span>
        </div>
      `).join('')
    : `<div style="font-size:var(--text-xs);color:var(--text-tertiary);padding:var(--space-3)">Sem registros analíticos</div>`;

  const oppItems = topOpps.length
    ? topOpps.map(([k, v]) => `
        <div class="insight-bucket-item">
          <div>
            <div class="insight-bucket-item__name">${k}</div>
            <div class="insight-bucket-item__sub">${Array.from(v.names).slice(0,3).join(', ')}</div>
          </div>
          <span class="insight-bucket-item__count badge badge--info">${v.count}×</span>
        </div>
      `).join('')
    : `<div style="font-size:var(--text-xs);color:var(--text-tertiary);padding:var(--space-3)">Sem oportunidades registradas</div>`;

  return `
    <div class="insights-dashboard" style="margin-bottom:var(--space-5)">
      <div class="insight-bucket insight-bucket--errors">
        <div class="insight-bucket__header">⚠️ Erros Mais Frequentes</div>
        <div class="insight-bucket__body">${errorItems}</div>
      </div>
      <div class="insight-bucket insight-bucket--strengths">
        <div class="insight-bucket__header">💚 Maiores Acertos</div>
        <div class="insight-bucket__body">${strengthItems}</div>
      </div>
      <div class="insight-bucket insight-bucket--opps">
        <div class="insight-bucket__header">📘 Oportunidades Identificadas</div>
        <div class="insight-bucket__body">${oppItems}</div>
      </div>
    </div>
  `;
}

function evolutionPanel() {
  return `
    <div class="panel evolution-panel">
      <div class="panel__header">
        <div class="panel__title">Evolução Mensal — Aproveitamento Médio</div>
        <span class="panel__hint">últimos 6 meses</span>
      </div>
      <div class="panel__body">
        <div class="chart-container chart-h-250">
          <canvas id="chart-evolution"></canvas>
        </div>
      </div>
    </div>
  `;
}

function rankingPanel(collabs, deptMons) {
  const scores = collabs.map(c => {
    const mons = deptMons.filter(m => m.colaboradorId === c.id);
    const avg  = mons.length ? Math.round(mons.reduce((s,m) => s+m.pct,0) / mons.length) : null;
    const loss = mons.length ? Math.round(mons.reduce((s,m) => s+(100-m.pct),0) / mons.length*10)/10 : null;
    return { ...c, avgPct: avg, avgLoss: loss, count: mons.length };
  }).filter(c => c.count > 0).sort((a,b) => (a.avgLoss??999) - (b.avgLoss??999));

  const items = scores.slice(0,8).map((c,i) => {
    const posClass = i===0 ? 'gold' : i===1 ? 'silver' : i===2 ? 'bronze' : '';
    return `
      <div class="ranking-item" data-collab="${c.id}">
        <div class="ranking-item__pos ${posClass}">${i+1}</div>
        <div class="ranking-item__avatar">${getInitials(c.name)}</div>
        <div class="ranking-item__info">
          <div class="ranking-item__name">${c.name}</div>
          <div class="ranking-item__team">${c.count} mon · ${getTeam(c.teamId)?.name ?? '—'}</div>
        </div>
        <div>
          <div class="ranking-item__score" style="color:${scoreColor(c.avgPct ?? 0)}">${c.avgPct}%</div>
          <div class="ranking-item__loss">-${c.avgLoss} pts</div>
        </div>
      </div>
    `;
  }).join('') || `<div class="empty-state"><div class="empty-state__icon">📊</div><div class="empty-state__title">Sem dados</div></div>`;

  return `
    <div class="panel">
      <div class="panel__header">
        <div class="panel__title">Ranking — Menor Perda</div>
        <span class="panel__hint">menor perda = melhor</span>
      </div>
      <div class="panel__body panel__body--compact">
        <div class="ranking-list">${items}</div>
      </div>
    </div>
  `;
}

function ptsLostPanel(collabs, deptMons) {
  const data = collabs.map(c => {
    const mons = deptMons.filter(m => m.colaboradorId === c.id);
    const loss = mons.length ? Math.round(mons.reduce((s,m) => s+(100-m.pct),0)/mons.length*10)/10 : 0;
    return { name: c.name.split(' ')[0], loss, count: mons.length };
  }).filter(d => d.count > 0).sort((a,b) => b.loss - a.loss);

  const maxLoss = data.length ? data[0].loss : 1;

  const items = data.slice(0,7).map(d => `
    <div class="pts-lost-item">
      <div class="pts-lost-item__name">${d.name}</div>
      <div class="pts-lost-item__val">${d.loss}</div>
      <div class="pts-lost-item__bar">
        <div class="pts-lost-item__fill" style="width:${Math.round((d.loss/maxLoss)*100)}%"></div>
      </div>
    </div>
  `).join('') || `<div class="empty-state"><div class="empty-state__title">Sem dados</div></div>`;

  return `
    <div class="panel">
      <div class="panel__header">
        <div class="panel__title">Pontos Perdidos por Operador</div>
        <span class="panel__hint">média / monitoria</span>
      </div>
      <div class="panel__body"><div class="pts-lost-list">${items}</div></div>
    </div>
  `;
}

function goalsPanel(goals, pct, stats) {
  const cls = pct >= goals.qualityTarget ? 'ok' : pct >= 50 ? 'warn' : 'danger';
  return `
    <div class="panel goals-panel">
      <div class="panel__header"><div class="panel__title">Meta vs Realizado</div></div>
      <div class="panel__body">
        <div class="goal-row"><span class="goal-row__label">Pontuação mínima</span><span class="goal-row__value">${goals.minScore} pts</span></div>
        <div class="goal-row"><span class="goal-row__label">Meta de qualidade</span><span class="goal-row__value">${goals.qualityTarget}%</span></div>
        <div class="goal-row"><span class="goal-row__label">Atingiram a meta</span><span class="goal-row__value goal-row__value--${cls}">${pct}%</span></div>
        <div class="goal-row"><span class="goal-row__label">Aproveitamento médio</span><span class="goal-row__value">${stats.avgPct}%</span></div>
        <div class="goal-row"><span class="goal-row__label">Total monitorias</span><span class="goal-row__value">${stats.count}</span></div>
      </div>
      <div class="panel__footer">
        <span style="font-size:var(--text-xs);color:${pct >= goals.qualityTarget ? 'var(--color-success)' : 'var(--color-warning)'}">
          ${pct >= goals.qualityTarget ? '✓ Meta atingida' : '⚠ Meta não atingida'} — ${pct}% da equipe
        </span>
      </div>
    </div>
  `;
}

export function init() {
  const user   = getCurrentUser();
  const collabs = getCollabsForViewer(user).filter(c => c.role === 'colaborador');
  const months  = monthOptions(6).reverse();

  const evolutionData = months.map(m => {
    const mons = getMonitorias({ month: m.key, deptId: user.deptId })
      .filter(x => collabs.some(c => c.id === x.colaboradorId));
    return mons.length ? Math.round(mons.reduce((s,x) => s+x.pct,0) / mons.length) : null;
  });

  import('../components/charts.js').then(({ renderEvolutionChart }) => {
    renderEvolutionChart('chart-evolution', months.map(m => m.label.split(' ')[0]), [{
      label: 'Aproveitamento Médio (%)',
      data: evolutionData,
      borderColor: '#4aba3d',
      backgroundColor: 'rgba(74,186,61,0.1)',
      borderWidth: 2,
      tension: 0.35,
      fill: true,
      pointRadius: 4,
      pointBackgroundColor: '#4aba3d',
      spanGaps: true,
    }]);
  });

  /* Supervisor rows → filter to consulta */
  document.querySelectorAll('.supervisor-row[data-team]').forEach(row => {
    row.addEventListener('click', () => navigate('consulta', { teamId: row.dataset.team }));
  });

  /* Ranking items */
  document.querySelectorAll('.ranking-item[data-collab]').forEach(el => {
    el.addEventListener('click', () => navigate('perfil', { id: el.dataset.collab }));
  });

  /* AI highlights */
  document.querySelectorAll('.ai-highlight-item').forEach(el => {
    el.addEventListener('click', () => navigate('ai-analise'));
  });
}
