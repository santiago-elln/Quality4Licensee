/* ============================================================
   DASHBOARD — Painel principal de métricas
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { getCurrentPeriod } from '../components/header.js';
import {
  getCollabsForViewer, getMonitorias, getMonitoriaStats,
  MOCK_USERS, TEAMS, TEAM_GOALS, getTeam, getDept,
} from '../data/mock.js';
import {
  formatPct, formatHHMMSS, resultBand, scoreColor, monthOptions,
} from '../utils/formatters.js';
import { ACCESS_LEVELS, canViewMetric } from '../utils/access.js';
import {
  renderEvolutionChart, renderCombinedChart, destroyAll,
} from '../components/charts.js';
import { navigate } from '../router.js';

let _period = null;

export function render() {
  const user = getCurrentUser();
  _period = getCurrentPeriod() ?? monthOptions(1)[0].key;
  const collabs = getCollabsForViewer(user);
  const monitorias = getMonitorias({ month: _period, deptId: user.deptId });
  const visMonitorias = monitorias.filter(m =>
    collabs.some(c => c.id === m.colaboradorId)
  );
  const stats = getMonitoriaStats(visMonitorias);

  const team = user.teamId ? getTeam(user.teamId) : null;
  const dept = getDept(user.deptId);
  const title = user.accessLevel >= ACCESS_LEVELS.ANALISTA
    ? (dept?.name ?? 'Departamento')
    : (team?.name ?? 'Minha Equipe');

  const periodLabel = monthOptions(12).find(m => m.key === _period)?.label ?? _period;
  const goals = team ? TEAM_GOALS[team.id] : { minScore: 36, qualityTarget: 80 };
  const goalsAchieved = visMonitorias.filter(m => m.pct >= goals.qualityTarget).length;
  const goalsAchievedPct = visMonitorias.length
    ? Math.round((goalsAchieved / visMonitorias.length) * 100) : 0;

  return `
    <div class="page-enter">
      <!-- Page header -->
      <div class="dash-page-header">
        <div class="dash-page-header__info">
          <div class="dash-page-header__title">${title} — Painel</div>
          <div class="dash-page-header__meta">${periodLabel} · ${stats.count} monitoria${stats.count !== 1 ? 's' : ''} · Meta: ${goals.minScore} pts</div>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="kpi-grid">
        ${kpiCard('Monitorias', stats.count, '', 'monitorias', 'green',
          `<a href="#registros" class="text-brand">monitorias</a>`)}
        ${kpiCard('Pontuação Média', stats.count ? stats.avgPct + '%' : '0%', '', 'avg-pct', 'blue', `média`)}
        ${kpiCard('Total Pts Perdidos', stats.count ? stats.ptsLost : '0', '', 'pts-lost', 'red', `média <strong>${stats.ptsLost}</strong>`)}
        ${kpiCard('Média de Qualidade', stats.count ? stats.avgPct + '%' : '0%', '', 'quality', 'orange', `Meta: ${goals.qualityTarget}%`)}
        ${kpiCard('Zeradas', stats.zeroed, '', 'zeroed', 'purple', stats.zeroed === 0 ? 'Nenhuma ✓' : `crítico`)}
      </div>

      <!-- Ranking + Evolution -->
      <div class="content-row cols-1-2">
        ${rankingPanel(collabs, visMonitorias)}
        ${evolutionPanel(_period)}
      </div>

      <!-- Distribution -->
      <div class="dist-section">
        <div class="dist-section-header">
          <span class="dist-section-title">Distribuição de Resultados</span>
        </div>
        <div class="dist-grid">
          ${distCard('Excelente', stats.dist.excellent, stats.count, '>95%', 'excellent')}
          ${distCard('Bom',       stats.dist.good,      stats.count, '70–94%', 'good')}
          ${distCard('Regular',  stats.dist.regular,   stats.count, '50–69%', 'regular')}
          ${distCard('Crítico',  stats.dist.critical,  stats.count, '1–49%',  'critical')}
          ${distCard('Zerada',   stats.dist.zero,      stats.count, '0%',     'zero')}
        </div>
      </div>

      <!-- Pts per collab + Goals -->
      <div class="content-row cols-2-1">
        ${ptsLostPanel(collabs, visMonitorias)}
        ${goalsPanel(goals, goalsAchievedPct, stats)}
      </div>
    </div>
  `;
}

function kpiCard(label, value, unit, id, accent, meta) {
  return `
    <div class="kpi-card">
      <div class="kpi-card__accent kpi-card__accent--${accent}"></div>
      <div class="kpi-card__body">
        <div class="kpi-card__label">${label}</div>
        <div class="kpi-card__value" id="kpi-${id}">${value}${unit}</div>
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

function rankingPanel(collabs, monitorias) {
  const scores = collabs.map(c => {
    const mons = monitorias.filter(m => m.colaboradorId === c.id);
    const avg = mons.length ? Math.round(mons.reduce((s, m) => s + m.pct, 0) / mons.length) : null;
    const loss = mons.length ? Math.round(mons.reduce((s, m) => s + (100 - m.pct), 0) / mons.length * 10) / 10 : null;
    return { ...c, avgPct: avg, avgLoss: loss, count: mons.length };
  }).filter(c => c.count > 0).sort((a, b) => (a.avgLoss ?? 999) - (b.avgLoss ?? 999));

  const items = scores.length
    ? scores.slice(0, 8).map((c, i) => {
        const band = resultBand(c.avgPct ?? 0);
        const posClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        const initials = c.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
        return `
          <div class="ranking-item" data-collab="${c.id}">
            <div class="ranking-item__pos ${posClass}">${i+1}</div>
            <div class="ranking-item__avatar">${initials}</div>
            <div class="ranking-item__info">
              <div class="ranking-item__name">${c.name}</div>
              <div class="ranking-item__team">${c.count} monitoria${c.count>1?'s':''}</div>
            </div>
            <div>
              <div class="ranking-item__score">${c.avgPct}%</div>
              <div class="ranking-item__loss">-${c.avgLoss} pts/mon</div>
            </div>
          </div>
        `;
      }).join('')
    : `<div class="empty-state"><div class="empty-state__icon">📊</div><div class="empty-state__title">Sem dados</div></div>`;

  return `
    <div class="panel">
      <div class="panel__header">
        <div>
          <div class="panel__title">Ranking por Menor Perda</div>
        </div>
        <span class="panel__hint">menor perda = melhor</span>
      </div>
      <div class="panel__body panel__body--compact">
        <div class="ranking-list" id="ranking-list">${items}</div>
      </div>
    </div>
  `;
}

function evolutionPanel(currentPeriod) {
  const months = monthOptions(6).reverse();
  const labels = months.map(m => m.label.split(' ')[0]);

  return `
    <div class="panel evolution-panel">
      <div class="panel__header">
        <div class="panel__title">Evolução Mensal — Aproveitamento Médio</div>
      </div>
      <div class="panel__body">
        <div class="chart-container chart-h-250">
          <canvas id="chart-evolution"></canvas>
        </div>
      </div>
    </div>
  `;
}

function ptsLostPanel(collabs, monitorias) {
  const data = collabs.map(c => {
    const mons = monitorias.filter(m => m.colaboradorId === c.id);
    const loss = mons.length ? Math.round(mons.reduce((s, m) => s + (100 - m.pct), 0) / mons.length * 10) / 10 : 0;
    return { name: c.name.split(' ')[0], loss, count: mons.length };
  }).filter(d => d.count > 0).sort((a, b) => b.loss - a.loss);

  const maxLoss = data.length ? data[0].loss : 1;

  const items = data.slice(0, 7).map(d => `
    <div class="pts-lost-item">
      <div class="pts-lost-item__name">${d.name}</div>
      <div class="pts-lost-item__val">${d.loss} pts</div>
      <div class="pts-lost-item__bar">
        <div class="pts-lost-item__fill" style="width:${Math.round((d.loss/maxLoss)*100)}%"></div>
      </div>
    </div>
  `).join('') || `<div class="empty-state"><div class="empty-state__title">Sem dados</div></div>`;

  return `
    <div class="panel">
      <div class="panel__header">
        <div class="panel__title">Pontos Perdidos por Operador</div>
        <span class="panel__hint">média por monitoria</span>
      </div>
      <div class="panel__body">
        <div class="pts-lost-list">${items}</div>
      </div>
    </div>
  `;
}

function goalsPanel(goals, goalsAchievedPct, stats) {
  const pctClass = goalsAchievedPct >= goals.qualityTarget ? 'ok'
    : goalsAchievedPct >= 50 ? 'warn' : 'danger';
  return `
    <div class="panel goals-panel">
      <div class="panel__header">
        <div class="panel__title">Meta da Equipe vs Realizado</div>
      </div>
      <div class="panel__body">
        <div class="goal-row">
          <span class="goal-row__label">Meta mínima</span>
          <span class="goal-row__value">${goals.minScore} pts</span>
        </div>
        <div class="goal-row">
          <span class="goal-row__label">Meta de Qualidade</span>
          <span class="goal-row__value">${goals.qualityTarget}%</span>
        </div>
        <div class="goal-row">
          <span class="goal-row__label">Atingiram a meta</span>
          <span class="goal-row__value goal-row__value--${pctClass}">${goalsAchievedPct}%</span>
        </div>
        <div class="goal-row">
          <span class="goal-row__label">Média atual</span>
          <span class="goal-row__value">${stats.avgPct}%</span>
        </div>
        <div class="goal-row">
          <span class="goal-row__label">Total monitorias</span>
          <span class="goal-row__value">${stats.count}</span>
        </div>
      </div>
      <div class="panel__footer">
        <span style="font-size:var(--text-xs);color:var(--text-secondary)">
          ${goalsAchievedPct}% da equipe atingiu a meta
        </span>
      </div>
    </div>
  `;
}

export function init() {
  const user = getCurrentUser();
  _period = getCurrentPeriod() ?? monthOptions(1)[0].key;
  const collabs = getCollabsForViewer(user);
  const months = monthOptions(6).reverse();

  /* Build evolution data per month */
  const evolutionData = months.map(m => {
    const mons = getMonitorias({ month: m.key, deptId: user.deptId })
      .filter(x => collabs.some(c => c.id === x.colaboradorId));
    return mons.length ? Math.round(mons.reduce((s, x) => s + x.pct, 0) / mons.length) : null;
  });

  const labels = months.map(m => m.label.split(' ')[0]);

  renderEvolutionChart('chart-evolution', labels, [{
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

  /* Ranking click → profile */
  document.querySelectorAll('.ranking-item[data-collab]').forEach(el => {
    el.addEventListener('click', () => navigate('perfil', { id: el.dataset.collab }));
  });
}
