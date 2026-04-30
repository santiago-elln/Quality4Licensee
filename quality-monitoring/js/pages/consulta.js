/* ============================================================
   CONSULTA POR ASSOCIADO — Painel de análise por colaborador
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { getRouteParams, navigate } from '../router.js';
import {
  MOCK_USERS, TEAMS, DEPARTMENTS, EVAL_CATEGORIES, OBSERVATIONS,
  getMonitorias, getMonitoriaStats, getTeam,
} from '../data/mock.js';
import {
  formatDate, formatHHMMSS, resultBand, scoreColor,
  getInitials, monthOptions,
} from '../utils/formatters.js';
import { canViewMetric, ACCESS_LEVELS } from '../utils/access.js';
import { renderRadarChart, destroyAll } from '../components/charts.js';

/* ── Active filter state ──────────────────── */
let _filters = {
  deptId:    'dept-1',
  gestorId:  '',
  supId:     '',
  collabId:  '',
  dateFrom:  '',
  dateTo:    '',
};
let _actionPlans = {};   /* collabId → [{ text, done, deadline }] */

export function render() {
  const user   = getCurrentUser();
  const params = getRouteParams();

  /* Pre-apply teamId if coming from dashboard supervisor row */
  if (params.teamId && !_filters.supId) {
    const team = getTeam(params.teamId);
    if (team) _filters.supId = team.supervisorId;
  }

  /* Default date range: current month */
  if (!_filters.dateFrom) {
    const now = new Date();
    _filters.dateFrom = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    _filters.dateTo = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${lastDay}`;
  }

  const depts  = DEPARTMENTS;
  const gestores = MOCK_USERS.filter(u =>
    u.deptId === _filters.deptId && u.accessLevel >= ACCESS_LEVELS.GESTOR
  );
  const supervisores = MOCK_USERS.filter(u =>
    u.deptId === _filters.deptId && u.role === 'supervisor' &&
    (!_filters.gestorId || true)
  );
  const collabsAll = MOCK_USERS.filter(u =>
    u.role === 'colaborador' && u.deptId === _filters.deptId &&
    (!_filters.supId || u.teamId === TEAMS.find(t => t.supervisorId === _filters.supId)?.id) &&
    (!_filters.collabId || u.id === _filters.collabId)
  );

  /* Access-scoped filter */
  const viewer = user;
  const visibleCollabs = collabsAll.filter(c => {
    if (viewer.accessLevel >= ACCESS_LEVELS.ANALISTA) return c.deptId === viewer.deptId;
    if (viewer.accessLevel === ACCESS_LEVELS.SUPERVISOR) return c.teamId === viewer.teamId;
    return c.id === viewer.id;
  });

  /* Get monitorias within date range */
  const collabIds = new Set(visibleCollabs.map(c => c.id));
  const rangeMonitorias = getMonitorias({ deptId: _filters.deptId }).filter(m => {
    if (!collabIds.has(m.colaboradorId)) return false;
    if (_filters.dateFrom && m.date < _filters.dateFrom) return false;
    if (_filters.dateTo   && m.date > _filters.dateTo)   return false;
    return true;
  });

  /* Summary stats */
  const totalMons = rangeMonitorias.length;
  const avgPct = totalMons
    ? Math.round(rangeMonitorias.reduce((s,m) => s+m.pct,0) / totalMons) : 0;
  const zeroed = rangeMonitorias.filter(m => m.pct === 0).length;
  const daysDiff = _filters.dateFrom && _filters.dateTo
    ? Math.round((new Date(_filters.dateTo) - new Date(_filters.dateFrom)) / 86400000) + 1
    : 0;

  const cards = visibleCollabs.map(c => renderCard(c, rangeMonitorias, viewer)).join('');

  return `
    <div class="page-enter">
      <!-- Header -->
      <div class="page-header">
        <div class="page-title">Consulta por Associado</div>
        <div class="page-subtitle">Análise detalhada de desempenho individual por período</div>
      </div>

      <!-- Filters -->
      <div class="consulta-filters">
        <div class="consulta-filters__grid">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Departamento</label>
            <select class="form-select" id="f-dept">
              ${depts.map(d => `<option value="${d.id}" ${d.id===_filters.deptId?'selected':''}>${d.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Gestor / Coordenador</label>
            <select class="form-select" id="f-gestor">
              <option value="">Todos</option>
              ${gestores.map(g => `<option value="${g.id}" ${g.id===_filters.gestorId?'selected':''}>${g.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Supervisor</label>
            <select class="form-select" id="f-sup">
              <option value="">Todos</option>
              ${supervisores.map(s => `<option value="${s.id}" ${s.id===_filters.supId?'selected':''}>${s.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Colaborador</label>
            <select class="form-select" id="f-collab">
              <option value="">Todos</option>
              ${visibleCollabs.map(c => `<option value="${c.id}" ${c.id===_filters.collabId?'selected':''}>${c.name}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn--primary" id="btn-apply-filters">Aplicar</button>
        </div>

        <div class="consulta-filters__date-row">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Data inicial</label>
            <input class="form-input" type="date" id="f-date-from" value="${_filters.dateFrom}">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Data final</label>
            <input class="form-input" type="date" id="f-date-to" value="${_filters.dateTo}">
          </div>
          <div class="date-range-info">
            <span id="date-range-days">
              ${daysDiff ? `<strong>${daysDiff}</strong> dias selecionados` : '—'}
            </span>
            ${daysDiff > 90 ? `<span class="warn">⚠ Máximo: 90 dias</span>` : ''}
          </div>
          <button class="btn btn--ghost btn--sm" id="btn-clear-filters">Limpar filtros</button>
        </div>
      </div>

      <!-- Summary bar -->
      <div class="consulta-summary-bar">
        <div class="consulta-summary-bar__stat">
          <span>👥 Colaboradores:</span><strong>${visibleCollabs.length}</strong>
        </div>
        <div class="consulta-summary-bar__stat">
          <span>📋 Monitorias no período:</span><strong>${totalMons}</strong>
        </div>
        <div class="consulta-summary-bar__stat">
          <span>📊 Aproveit. médio:</span>
          <strong style="color:${scoreColor(avgPct)}">${totalMons ? avgPct + '%' : '—'}</strong>
        </div>
        <div class="consulta-summary-bar__stat">
          <span>⚠ Zeradas:</span>
          <strong style="color:${zeroed > 0 ? 'var(--color-danger)' : 'inherit'}">${zeroed}</strong>
        </div>
        <div style="margin-left:auto">
          <span style="font-size:var(--text-xs);color:var(--text-tertiary)">
            ${_filters.dateFrom} → ${_filters.dateTo}
          </span>
        </div>
      </div>

      <!-- Cards grid -->
      <div class="consulta-grid" id="consulta-grid">
        ${cards || `
          <div class="empty-state" style="grid-column:1/-1;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border)">
            <div class="empty-state__icon">👥</div>
            <div class="empty-state__title">Nenhum colaborador encontrado</div>
            <div class="empty-state__desc">Ajuste os filtros e tente novamente.</div>
          </div>
        `}
      </div>
    </div>
  `;
}

/* ── Card render ─────────────────────────── */
function renderCard(collab, allMons, viewer) {
  const mons   = allMons.filter(m => m.colaboradorId === collab.id);
  const stats  = getMonitoriaStats(mons);
  const team   = collab.teamId ? getTeam(collab.teamId) : null;
  const sup    = MOCK_USERS.find(u => u.id === team?.supervisorId);
  const obs    = OBSERVATIONS.filter(o => o.colaboradorId === collab.id);
  const plan   = _actionPlans[collab.id] ?? [];

  const lastMon = mons[0];
  const band    = resultBand(stats.avgPct ?? 0);
  const color   = scoreColor(stats.avgPct ?? 0);

  /* Last monitoring date description */
  const lastMonDesc = lastMon
    ? `Última monitoria: ${formatDate(lastMon.date)} · ${band.label}`
    : 'Sem monitorias no período';

  /* Time metrics from last monitoring */
  const tma  = lastMon ? formatHHMMSS(lastMon.tma)  : '—';
  const tmer = lastMon ? formatHHMMSS(lastMon.tmer) : '—';
  const tmpr = lastMon ? formatHHMMSS(lastMon.tmpr) : '—';
  const csatAvg = mons.length
    ? (mons.reduce((s,m) => s + (m.csat ?? 0), 0) / mons.length).toFixed(1)
    : '—';
  const csatPct = mons.length
    ? Math.round((mons.reduce((s,m) => s + (m.csat ?? 0), 0) / mons.length) / 5 * 100) + '%'
    : '—';

  /* Category scores */
  const catScores = EVAL_CATEGORIES.map(cat => {
    const earned = mons.length
      ? mons.reduce((s, m) => s + cat.items.reduce((cs, item) =>
          cs + (m.checkedItems?.[item.id] ? item.pts : 0), 0), 0) / mons.length
      : 0;
    const pct = Math.round((earned / cat.totalPts) * 100);
    return { name: cat.name, short: cat.name.split(' ')[0], pct };
  });

  /* Insights from observations */
  const errorObs    = obs.filter(o => o.type === 'E').slice(0, 3);
  const strengthObs = obs.filter(o => o.type === 'A').slice(0, 3);
  const oppObs      = obs.filter(o => o.type === 'O').slice(0, 3);

  /* Weakest / strongest category */
  const sorted = [...catScores].sort((a,b) => a.pct - b.pct);
  const weakCats = sorted.slice(0, 2);
  const strongCats = [...catScores].sort((a,b) => b.pct - a.pct).slice(0, 2);

  /* History segments */
  const histSegs = mons.slice(0, 16).reverse().map(m => {
    const b = resultBand(m.pct);
    return `<div class="cc-history-seg" title="${formatDate(m.date)}: ${m.pct}%"
         style="background:${scoreColor(m.pct)}"></div>`;
  }).join('') || '<div style="font-size:10px;color:rgba(255,255,255,.3);padding:6px">Sem histórico</div>';

  /* Recent obs */
  const recentObsHtml = obs.slice(0, 2).map(o => `
    <div class="cc-obs-item">
      <span class="obs-type-tag obs-type-tag--${o.type}">${o.type}</span>
      <span class="cc-obs-item__proto">#${o.attendanceId}</span>
      <span>${o.text}</span>
    </div>
  `).join('');

  /* Category mini bars */
  const catBarsHtml = catScores.map(c => `
    <div class="cc-cat-bar-row">
      <span class="cc-cat-bar-row__name">${c.short}</span>
      <div class="cc-cat-bar-track">
        <div class="cc-cat-bar-fill" style="width:${c.pct}%;background:${scoreColor(c.pct)}"></div>
      </div>
      <span class="cc-cat-bar-row__val">${c.pct}%</span>
    </div>
  `).join('');

  /* Action plan */
  const planItems = plan.map((item, i) => `
    <div class="cc-action-item">
      <input type="checkbox" class="cc-action-item__check ap-check"
             data-collab="${collab.id}" data-idx="${i}" ${item.done ? 'checked' : ''}>
      <span class="cc-action-item__text" style="${item.done ? 'text-decoration:line-through;opacity:.5' : ''}">${item.text}</span>
      ${item.deadline ? `<span class="cc-action-item__deadline">${item.deadline}</span>` : ''}
      <button class="cc-action-item__del ap-del" data-collab="${collab.id}" data-idx="${i}">🗑</button>
    </div>
  `).join('');

  /* Trend vs previous */
  const allMonsCollab = getMonitorias({ colaboradorId: collab.id });
  const prevMons = allMonsCollab.filter(m => !mons.includes(m)).slice(0, mons.length || 3);
  const prevStats = getMonitoriaStats(prevMons);
  const trendDelta = stats.count && prevStats.count
    ? stats.avgPct - prevStats.avgPct : null;
  const trendHtml = trendDelta !== null
    ? `<span style="font-size:10px;font-weight:700;color:${trendDelta >= 0 ? 'var(--brand-green-bright)' : '#ff6b6b'}">
         ${trendDelta >= 0 ? '↑' : '↓'} ${Math.abs(trendDelta)}% vs. ant.
       </span>`
    : '';

  return `
    <div class="cc-card" data-collab="${collab.id}">

      <!-- Header -->
      <div class="cc-card__header">
        <div class="cc-card__avatar">${getInitials(collab.name)}</div>
        <div class="cc-card__info">
          <div class="cc-card__name">${collab.name}</div>
          <div class="cc-card__last-mon">${lastMonDesc}</div>
          <div class="cc-card__badges">
            <span class="cc-badge">${team?.name ?? '—'}</span>
            <span class="cc-badge">${sup?.name?.split(' ')[0] ?? '—'}</span>
            ${trendHtml}
          </div>
        </div>
        <div class="cc-card__score">
          <div class="cc-card__score-val" style="color:${color}">
            ${stats.count ? stats.avgPct + '%' : '—'}
          </div>
          <div class="cc-card__score-label">${mons.length} mon.</div>
          <span class="badge badge--${band.cls}" style="margin-top:4px;font-size:9px">${band.label}</span>
        </div>
      </div>

      <!-- Body: metrics + radar -->
      <div class="cc-card__body">
        <div class="cc-metrics">
          <div class="cc-metric-row">
            <span class="cc-metric-row__label">Qtd. Atendimentos</span>
            <span class="cc-metric-row__val">${mons.length}</span>
          </div>
          <div class="cc-metric-row">
            <span class="cc-metric-row__label">TMA</span>
            <span class="cc-metric-row__val">${tma}</span>
          </div>
          <div class="cc-metric-row">
            <span class="cc-metric-row__label">TMEr</span>
            <span class="cc-metric-row__val">${tmer}</span>
          </div>
          <div class="cc-metric-row">
            <span class="cc-metric-row__label">TMPr</span>
            <span class="cc-metric-row__val">${tmpr}</span>
          </div>
          <div class="cc-metric-row">
            <span class="cc-metric-row__label">CSAT</span>
            <span class="cc-metric-row__val cc-metric-row__val--green">${csatPct} (${csatAvg}/5)</span>
          </div>
          <div class="cc-metric-row">
            <span class="cc-metric-row__label">Pts perdidos/mon</span>
            <span class="cc-metric-row__val cc-metric-row__val--${stats.ptsLost > 20 ? 'red' : stats.ptsLost > 10 ? 'yellow' : ''}">${stats.count ? stats.ptsLost : '—'}</span>
          </div>
          <div class="cc-cat-bars">${catBarsHtml}</div>
        </div>
        <div class="cc-radar-wrap">
          <canvas id="radar-cc-${collab.id}" width="180" height="180"></canvas>
        </div>
      </div>

      <!-- History bar -->
      <div class="cc-history">
        <div class="cc-history__label">Histórico de Resultados</div>
        <div class="cc-history-bar">${histSegs}</div>
      </div>

      <!-- Insights three columns -->
      <div class="cc-insights">
        <div class="cc-insight-col cc-insight-col--error">
          <div class="cc-insight-col__title cc-insight-col__title--error">⚠ Erros frequentes</div>
          ${errorObs.length
            ? errorObs.map(o => `<div class="cc-insight-item">${o.criteria ?? o.text}</div>`).join('')
            : weakCats.map(c => `<div class="cc-insight-item">${c.name} (${c.pct}%)</div>`).join('')
          }
        </div>
        <div class="cc-insight-col cc-insight-col--good">
          <div class="cc-insight-col__title cc-insight-col__title--good">✔ Tem acertado em</div>
          ${strengthObs.length
            ? strengthObs.map(o => `<div class="cc-insight-item">${o.criteria ?? o.text}</div>`).join('')
            : strongCats.map(c => `<div class="cc-insight-item">${c.name} (${c.pct}%)</div>`).join('')
          }
        </div>
        <div class="cc-insight-col cc-insight-col--opp">
          <div class="cc-insight-col__title cc-insight-col__title--opp">📘 Oportunidades</div>
          ${oppObs.length
            ? oppObs.map(o => `<div class="cc-insight-item">${o.criteria ?? o.text}</div>`).join('')
            : weakCats.map(c => `<div class="cc-insight-item">Reforçar ${c.name}</div>`).join('')
          }
        </div>
      </div>

      <!-- Observations -->
      ${recentObsHtml ? `
        <div class="cc-obs">
          <div class="cc-obs__label">Observações recentes</div>
          ${recentObsHtml}
        </div>
      ` : ''}

      <!-- Action Plan -->
      <div class="cc-action-plan" id="ap-${collab.id}">
        <button class="cc-action-plan__toggle ap-toggle" data-collab="${collab.id}">
          <span>📋 Plano de Ação ${plan.length ? `(${plan.filter(i=>!i.done).length} pendentes)` : ''}</span>
          <span class="cc-action-plan__toggle-icon">›</span>
        </button>
        <div class="cc-action-plan__body">
          <div class="cc-action-items" id="ap-items-${collab.id}">
            ${planItems || `<div style="font-size:var(--text-xs);color:rgba(255,255,255,.3);padding:var(--space-2) 0">Nenhuma ação cadastrada</div>`}
          </div>
          <div class="cc-action-add">
            <input class="form-input ap-input" id="ap-input-${collab.id}"
                   placeholder="Nova ação de melhoria…" data-collab="${collab.id}">
            <input class="form-input" type="date" id="ap-date-${collab.id}"
                   style="background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12);color:#fff;font-size:var(--text-xs);height:28px;padding:0 8px">
            <button class="btn btn--primary ap-add-btn" data-collab="${collab.id}">+</button>
          </div>
          <div style="margin-top:var(--space-3);display:flex;justify-content:flex-end">
            <button class="btn btn--ghost btn--sm" style="color:rgba(255,255,255,.4);font-size:var(--text-xs)"
                    data-collab="${collab.id}" onclick="window.location.hash='#perfil?id=${collab.id}'">
              Ver perfil completo →
            </button>
          </div>
        </div>
      </div>

    </div>
  `;
}

/* ── Charts initialization ─────────────────── */
function initCharts(visibleCollabs, allMons) {
  visibleCollabs.forEach(collab => {
    const mons = allMons.filter(m => m.colaboradorId === collab.id);
    const catPcts = EVAL_CATEGORIES.map(cat => {
      const earned = mons.length
        ? mons.reduce((s, m) => s + cat.items.reduce((cs, item) =>
            cs + (m.checkedItems?.[item.id] ? item.pts : 0), 0), 0) / mons.length
        : 0;
      return Math.round((earned / cat.totalPts) * 100);
    });

    renderRadarChart(
      `radar-cc-${collab.id}`,
      EVAL_CATEGORIES.map(c => c.name.split(' ').slice(0, 2).join(' ')),
      [{ label: collab.name.split(' ')[0], data: catPcts }]
    );
  });
}

/* ── Page reload helper ────────────────────── */
function reloadPage() {
  destroyAll();
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = render();
  init();
}

/* ── Date range validation ─────────────────── */
function enforceDateRange() {
  const fromEl = document.getElementById('f-date-from');
  const toEl   = document.getElementById('f-date-to');
  const infoEl = document.getElementById('date-range-days');
  if (!fromEl || !toEl || !infoEl) return;

  const from = new Date(fromEl.value);
  const to   = new Date(toEl.value);
  if (!fromEl.value || !toEl.value) return;

  const days = Math.round((to - from) / 86400000) + 1;
  if (days > 90) {
    const capped = new Date(from);
    capped.setDate(capped.getDate() + 89);
    toEl.value = capped.toISOString().split('T')[0];
    infoEl.innerHTML = `<strong>90</strong> dias (máx. atingido)`;
  } else if (days > 0) {
    infoEl.innerHTML = `<strong>${days}</strong> dias selecionados`;
  }
}

/* ── Plan persistence in memory ────────────── */
function savePlan(collabId) {
  const items = _actionPlans[collabId] ?? [];
  const container = document.getElementById(`ap-items-${collabId}`);
  if (!container) return;
  container.innerHTML = items.length
    ? items.map((item, i) => `
        <div class="cc-action-item">
          <input type="checkbox" class="cc-action-item__check ap-check"
                 data-collab="${collabId}" data-idx="${i}" ${item.done ? 'checked' : ''}>
          <span class="cc-action-item__text" style="${item.done ? 'text-decoration:line-through;opacity:.5' : ''}">${item.text}</span>
          ${item.deadline ? `<span class="cc-action-item__deadline">${item.deadline}</span>` : ''}
          <button class="cc-action-item__del ap-del" data-collab="${collabId}" data-idx="${i}">🗑</button>
        </div>
      `).join('')
    : `<div style="font-size:var(--text-xs);color:rgba(255,255,255,.3);padding:var(--space-2) 0">Nenhuma ação cadastrada</div>`;

  /* Rebind events after re-render */
  container.querySelectorAll('.ap-check').forEach(chk => bindCheckEvent(chk));
  container.querySelectorAll('.ap-del').forEach(btn => bindDelEvent(btn));

  /* Update toggle label */
  const toggle = document.querySelector(`.ap-toggle[data-collab="${collabId}"] span:first-child`);
  if (toggle) {
    const pending = items.filter(i => !i.done).length;
    toggle.textContent = `📋 Plano de Ação ${items.length ? `(${pending} pendentes)` : ''}`;
  }
}

function bindCheckEvent(chk) {
  chk.addEventListener('change', () => {
    const { collab, idx } = chk.dataset;
    if (_actionPlans[collab]?.[idx]) {
      _actionPlans[collab][idx].done = chk.checked;
      savePlan(collab);
    }
  });
}
function bindDelEvent(btn) {
  btn.addEventListener('click', () => {
    const { collab, idx } = btn.dataset;
    _actionPlans[collab]?.splice(Number(idx), 1);
    savePlan(collab);
  });
}

export function init() {
  const user    = getCurrentUser();
  const params  = getRouteParams();
  if (params.teamId) {
    const team = getTeam(params.teamId);
    if (team) _filters.supId = team.supervisorId;
  }

  /* Build visible collabs + mons matching current filters */
  const visibleCollabs = MOCK_USERS.filter(u => {
    if (u.role !== 'colaborador') return false;
    if (u.deptId !== _filters.deptId) return false;
    if (_filters.supId) {
      const supTeam = TEAMS.find(t => t.supervisorId === _filters.supId);
      if (supTeam && u.teamId !== supTeam.id) return false;
    }
    if (_filters.collabId && u.id !== _filters.collabId) return false;
    if (user.accessLevel >= ACCESS_LEVELS.ANALISTA) return u.deptId === user.deptId;
    if (user.accessLevel === ACCESS_LEVELS.SUPERVISOR) return u.teamId === user.teamId;
    return u.id === user.id;
  });

  const allMons = getMonitorias({ deptId: _filters.deptId }).filter(m => {
    if (!visibleCollabs.some(c => c.id === m.colaboradorId)) return false;
    if (_filters.dateFrom && m.date < _filters.dateFrom) return false;
    if (_filters.dateTo   && m.date > _filters.dateTo)   return false;
    return true;
  });

  /* Init radar charts */
  initCharts(visibleCollabs, allMons);

  /* Date range enforcement */
  document.getElementById('f-date-from')?.addEventListener('change', enforceDateRange);
  document.getElementById('f-date-to')?.addEventListener('change',   enforceDateRange);

  /* Apply filters button */
  document.getElementById('btn-apply-filters')?.addEventListener('click', () => {
    _filters.deptId   = document.getElementById('f-dept')?.value    ?? _filters.deptId;
    _filters.gestorId = document.getElementById('f-gestor')?.value  ?? '';
    _filters.supId    = document.getElementById('f-sup')?.value     ?? '';
    _filters.collabId = document.getElementById('f-collab')?.value  ?? '';
    _filters.dateFrom = document.getElementById('f-date-from')?.value ?? _filters.dateFrom;
    _filters.dateTo   = document.getElementById('f-date-to')?.value   ?? _filters.dateTo;
    reloadPage();
  });

  /* Clear filters */
  document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
    _filters = { deptId: 'dept-1', gestorId: '', supId: '', collabId: '', dateFrom: '', dateTo: '' };
    reloadPage();
  });

  /* Action plan toggles */
  document.querySelectorAll('.ap-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(`ap-${btn.dataset.collab}`)?.classList.toggle('open');
    });
  });

  /* Action plan add */
  document.querySelectorAll('.ap-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const collabId = btn.dataset.collab;
      const input    = document.getElementById(`ap-input-${collabId}`);
      const dateEl   = document.getElementById(`ap-date-${collabId}`);
      const text     = input?.value.trim();
      if (!text) return;
      if (!_actionPlans[collabId]) _actionPlans[collabId] = [];
      _actionPlans[collabId].push({ text, done: false, deadline: dateEl?.value ?? '' });
      if (input) input.value = '';
      if (dateEl) dateEl.value = '';
      savePlan(collabId);
    });
  });

  /* Allow Enter key on plan inputs */
  document.querySelectorAll('.ap-input').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        document.querySelector(`.ap-add-btn[data-collab="${inp.dataset.collab}"]`)?.click();
      }
    });
  });

  /* Bind existing plan item events */
  document.querySelectorAll('.ap-check').forEach(bindCheckEvent);
  document.querySelectorAll('.ap-del').forEach(bindDelEvent);

  /* Filter supervisor cascade */
  document.getElementById('f-sup')?.addEventListener('change', () => {
    const supId  = document.getElementById('f-sup')?.value ?? '';
    const collabSel = document.getElementById('f-collab');
    if (!collabSel) return;
    const supTeam = TEAMS.find(t => t.supervisorId === supId);
    const members = MOCK_USERS.filter(u =>
      u.role === 'colaborador' &&
      (!supId || u.teamId === supTeam?.id)
    );
    collabSel.innerHTML = `<option value="">Todos</option>` +
      members.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  });
}
