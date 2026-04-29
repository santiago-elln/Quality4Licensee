/* ============================================================
   PERFIL — Perfil individual do colaborador
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { getRouteParams, navigate } from '../router.js';
import {
  MOCK_USERS, EVAL_CATEGORIES, TOTAL_MAX_PTS, OBSERVATIONS,
  getMonitorias, getMonitoriaStats, getTeam,
} from '../data/mock.js';
import {
  formatDate, formatHHMMSS, resultBand, scoreColor, getInitials, monthOptions,
} from '../utils/formatters.js';
import { canViewMetric, METRICS_CONFIG } from '../utils/access.js';
import { renderRadarChart, renderCombinedChart, destroyAll } from '../components/charts.js';
import { getCurrentPeriod } from '../components/header.js';

export function render() {
  const user    = getCurrentUser();
  const { id }  = getRouteParams();
  const subject = MOCK_USERS.find(u => u.id === id) ?? user;
  const period  = getCurrentPeriod() ?? monthOptions(1)[0].key;

  if (!subject) return `<div class="empty-state"><div class="empty-state__title">Colaborador não encontrado</div></div>`;

  const team   = subject.teamId ? getTeam(subject.teamId) : null;
  const mons   = getMonitorias({ colaboradorId: subject.id });
  const perMon = getMonitorias({ colaboradorId: subject.id, month: period });
  const stats  = getMonitoriaStats(mons);
  const obs    = OBSERVATIONS.filter(o => o.colaboradorId === subject.id);

  const lastMon = mons[0];
  const initials = getInitials(subject.name);

  /* Category avg */
  const catScores = EVAL_CATEGORIES.map(cat => {
    const catTotal = cat.totalPts;
    const earned = mons.length
      ? mons.reduce((s, m) => {
          const catEarned = cat.items.reduce((cs, item) =>
            cs + (m.checkedItems?.[item.id] ? item.pts : 0), 0);
          return s + catEarned;
        }, 0) / mons.length
      : 0;
    return { name: cat.name, pct: Math.round((earned / catTotal) * 100) };
  });

  /* History segments (last 20) */
  const histSegs = mons.slice(0, 20).reverse().map(m => {
    const b = resultBand(m.pct);
    return `<div class="result-history-seg result-history-seg--${b.cls}" title="${formatDate(m.date)}: ${m.pct}%"></div>`;
  }).join('');

  /* Insights */
  const errorObs  = obs.filter(o => o.type === 'E');
  const strengthObs = obs.filter(o => o.type === 'A');
  const oppObs    = obs.filter(o => o.type === 'O');

  const obsLog = obs.slice(0, 15).map(o => `
    <div class="obs-log-item obs-log-item--${o.type}">
      <div class="obs-log-item__badge obs-log-item__badge--${o.type}">${o.type}</div>
      <div class="obs-log-item__body">
        ${o.criteria ? `<div class="obs-log-item__criteria">${o.criteria}</div>` : ''}
        <div class="obs-log-item__text">${o.text}</div>
        <div class="obs-log-item__meta">${formatDate(o.date)} · Prot. ${o.attendanceId}</div>
      </div>
    </div>
  `).join('') || `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state__title">Sem observações</div></div>`;

  const locked = (key) => !canViewMetric(user, subject, key)
    ? `<span class="metric-locked"><span class="lock-icon">🔒</span> nível insuficiente</span>`
    : null;

  return `
    <div class="profile-page page-enter">
      <!-- Hero -->
      <div class="profile-hero">
        <div class="profile-hero__top">
          <div class="profile-hero__avatar">${initials}</div>
          <div class="profile-hero__info">
            <div class="profile-hero__name">${subject.name}</div>
            <div class="profile-hero__meta">${subject.title ?? subject.role} · ${team?.name ?? '—'}</div>
            <div class="profile-hero__badges">
              <span class="role-badge role-badge--${subject.role}">${subject.role}</span>
              ${lastMon ? `<span class="badge badge--neutral">Última monitoria: ${formatDate(lastMon.date)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="profile-hero__stats">
          <div class="profile-stat">
            <div class="profile-stat__val">${mons.length}</div>
            <div class="profile-stat__lbl">Monitorias</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat__val" style="color:${scoreColor(stats.avgPct??0)}">${stats.count ? stats.avgPct + '%' : '—'}</div>
            <div class="profile-stat__lbl">Aproveit. médio</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat__val">${locked('pts_perdidos') ?? stats.ptsLost}</div>
            <div class="profile-stat__lbl">Pts perdidos/mon</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat__val">${locked('csat') ?? (perMon.length ? Math.round(perMon.reduce((s,m) => s+m.csat,0)/perMon.length*10)/10 : '—')}</div>
            <div class="profile-stat__lbl">CSAT médio</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat__val" style="color:${stats.zeroed>0?'var(--color-danger)':'inherit'}">${stats.zeroed}</div>
            <div class="profile-stat__lbl">Zeradas</div>
          </div>
        </div>
      </div>

      <!-- Charts row -->
      <div class="profile-charts">
        <!-- Radar -->
        <div class="radar-panel panel">
          <div class="panel__header"><div class="panel__title">Radar de Categorias</div></div>
          <div class="panel__body">
            <div class="radar-chart-wrapper" style="max-width:240px">
              <canvas id="chart-radar"></canvas>
            </div>
            <div class="category-breakdown">
              ${catScores.map(c => `
                <div>
                  <div class="cat-row">
                    <div class="cat-row__name">${c.name.split(' ')[0]}</div>
                    <div class="cat-row__val" style="color:${scoreColor(c.pct)}">${c.pct}%</div>
                  </div>
                  <div class="cat-row__bar-wrap">
                    <div class="cat-row__bar-fill" style="width:${c.pct}%;background:${scoreColor(c.pct)}"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- History chart -->
        <div class="history-panel panel">
          <div class="panel__header"><div class="panel__title">Histórico de Resultados</div></div>
          <div class="panel__body">
            ${mons.length ? `<div class="result-history-bar">${histSegs}</div>` : ''}
            <div class="chart-container chart-h-250">
              <canvas id="chart-history"></canvas>
            </div>
          </div>
        </div>
      </div>

      <!-- Insights -->
      <div class="panel insights-section">
        <div class="panel__header"><div class="panel__title">Insights</div></div>
        <div class="panel__body">
          <div class="insights-grid">
            <div class="insights-col">
              <div class="insights-col__title insights-col__title--error">⚠️ Erros mais frequentes</div>
              <div class="insights-col__list">
                ${errorObs.length ? errorObs.slice(0,3).map(o => `
                  <div class="insight-tag insight-tag--error">${o.text}</div>
                `).join('') : `<span style="font-size:var(--text-sm);color:var(--text-tertiary)">Nenhum</span>`}
              </div>
            </div>
            <div class="insights-col">
              <div class="insights-col__title insights-col__title--strength">💚 Tem acertado em</div>
              <div class="insights-col__list">
                ${strengthObs.length ? strengthObs.slice(0,3).map(o => `
                  <div class="insight-tag insight-tag--strength">${o.criteria ?? o.text}</div>
                `).join('') : `<span style="font-size:var(--text-sm);color:var(--text-tertiary)">Sem dados</span>`}
              </div>
            </div>
            <div class="insights-col">
              <div class="insights-col__title insights-col__title--opportunity">📘 Possui oportunidades em</div>
              <div class="insights-col__list">
                ${oppObs.length ? oppObs.slice(0,3).map(o => `
                  <div class="insight-tag insight-tag--opportunity">${o.criteria ?? o.text}</div>
                `).join('') : `<span style="font-size:var(--text-sm);color:var(--text-tertiary)">Sem dados</span>`}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Observations log -->
      <div class="panel">
        <div class="panel__header">
          <div class="panel__title">Observações Qualitativas</div>
          <span class="badge badge--neutral">${obs.length}</span>
        </div>
        <div class="panel__body panel__body--compact">
          <div class="obs-log">${obsLog}</div>
        </div>
      </div>
    </div>
  `;
}

export function init() {
  const { id } = getRouteParams();
  const subject = MOCK_USERS.find(u => u.id === id);
  if (!subject) return;

  const mons = getMonitorias({ colaboradorId: subject.id });
  const catScores = EVAL_CATEGORIES.map(cat => {
    const earned = mons.length
      ? mons.reduce((s, m) => {
          return s + cat.items.reduce((cs, item) =>
            cs + (m.checkedItems?.[item.id] ? item.pts : 0), 0);
        }, 0) / mons.length
      : 0;
    return Math.round((earned / cat.totalPts) * 100);
  });

  renderRadarChart('chart-radar',
    EVAL_CATEGORIES.map(c => c.name.split(' ').slice(0, 2).join(' ')),
    [{ label: subject.name.split(' ')[0], data: catScores }]
  );

  /* History combined chart */
  const months = monthOptions(6).reverse();
  const labels = months.map(m => m.label.split(' ')[0]);
  const barData = months.map(m => {
    const ms = getMonitorias({ colaboradorId: subject.id, month: m.key });
    return ms.length ? Math.round(ms.reduce((s, x) => s + x.pct, 0) / ms.length) : null;
  });
  const lineData = months.map(m => {
    const ms = getMonitorias({ colaboradorId: subject.id, month: m.key });
    return ms.length ? Math.round(ms.reduce((s, x) => s + (100 - x.pct), 0) / ms.length * 10) / 10 : null;
  });

  renderCombinedChart('chart-history', labels, barData, lineData, 'Aproveit. %', 'Pts perdidos');
}
