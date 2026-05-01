/* ============================================================
   DASHBOARD — Painel operacional por segmento
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { getCurrentPeriod, setPeriod } from '../components/header.js';
import { MOCK_USERS, getQueueStats, getPerfStats, QUEUE_HOURS } from '../data/mock.js';
import { monthOptions, getInitials } from '../utils/formatters.js';
import {
  destroyAll, renderCountChart, renderBarChart, renderDoughnutChart,
} from '../components/charts.js';

let _period = null;

/* ── Utils ───────────────────────────────────── */
function reloadDashboard() {
  destroyAll();
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = render();
  init();
}

function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmt(sec) {
  if (!sec && sec !== 0) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtH(sec) { /* e.g. 3725 → "1h 02m" */
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(sec % 60).padStart(2, '0')}s`;
}

function csatPct(csat, total) {
  return total > 0 ? Math.round((csat[3] + csat[4]) / total * 100) : 0;
}

const CSAT_COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e'];
const SHOW_DAYS   = new Set([1, 5, 10, 15, 20, 25, 30]);

/* ── Period nav ──────────────────────────────── */
function renderPeriodNav() {
  const months = monthOptions(12);
  const opts = months.map(m =>
    `<option value="${m.key}" ${m.key === _period ? 'selected' : ''}>${m.label}</option>`
  ).join('');
  return `
    <div class="dash-period-nav">
      <button class="dash-period-nav__btn" id="dash-period-prev">&#8249;</button>
      <select class="dash-period-nav__select" id="dash-period-select">${opts}</select>
      <button class="dash-period-nav__btn" id="dash-period-next">&#8250;</button>
    </div>`;
}

/* ── Summary card row (top KPI strip) ─────────── */
function summaryCardRow(segKey, label, tag, stats) {
  const pct   = csatPct(stats.csat, stats.csatTotal);
  const angle = (pct / 100 * 360).toFixed(1);
  const hue   = pct >= 75 ? 120 : pct >= 55 ? 60 : 0;
  const col   = `hsl(${hue},65%,42%)`;
  const good  = stats.csat[3] + stats.csat[4];

  const card = (lbl, val, sub = '') => `
    <div class="sum-card">
      <div class="sum-card__label">${lbl}</div>
      <div class="sum-card__value">${val}</div>
      ${sub ? `<div class="sum-card__sub">${sub}</div>` : ''}
    </div>`;

  const csatCard = `
    <div class="sum-card sum-card--csat">
      <div class="sum-card__label">CSAT</div>
      <div class="sum-card__csat-inner">
        <div class="mini-donut" style="background:conic-gradient(${col} 0deg ${angle}deg,var(--bg-surface-3) ${angle}deg 360deg)">
          <span class="mini-donut__val">${pct}%</span>
        </div>
        <div class="sum-card__csat-meta">${good.toLocaleString('pt-BR')} de ${stats.csatTotal.toLocaleString('pt-BR')}<br>avaliações 4+5</div>
      </div>
    </div>`;

  const sup = MOCK_USERS.find(u => u.id === (segKey === 'exec' ? 'user-sup-1' : null));

  return `
    <div class="sum-section">
      <div class="sum-section__header">
        <span class="sum-section__tag">${tag}</span>
      </div>
      <div class="sum-cards-row">
        ${card('Entrantes',    stats.totals.ent.toLocaleString('pt-BR'))}
        ${card('Finalizações', stats.totals.fin.toLocaleString('pt-BR'), `${Math.round(stats.totals.fin / stats.totals.ent * 100)}% do volume`)}
        ${card('TME',  fmt(stats.totals.tme),  'espera na fila')}
        ${card('TMA',  fmt(stats.totals.tma),  'tempo de atendimento')}
        ${csatCard}
      </div>
    </div>`;
}

/* ── 2-D heatmap (hour × day grid) ──────────── */
function renderHeatmap2D(title, matrix, numDays, stretch = false) {
  const flat = matrix.flat().filter(v => v > 0);
  const maxV = Math.max(...flat, 1);

  /* Red intensity: 0 activity → transparent; high value → deep red */
  const cellBg = v =>
    v === 0
      ? 'var(--bg-surface-2)'
      : `rgba(30,200,30,${(0.06 + (v / maxV) * 0.86).toFixed(2)})`;

  const corner   = '<div class="hm2d-corner"></div>';
  const dayLbls  = Array.from({ length: numDays }, (_, i) =>
    `<div class="hm2d-day">${SHOW_DAYS.has(i + 1) ? i + 1 : ''}</div>`
  ).join('');

  const rows = QUEUE_HOURS.map((h, hi) =>
    `<div class="hm2d-hlbl">${String(h).padStart(2, '0')}h</div>` +
    matrix[hi].slice(0, numDays).map(v =>
      `<div class="hm2d-cell" style="background:${cellBg(v)}" title="${String(h).padStart(2,'0')}h: ${fmt(v)}"></div>`
    ).join('')
  ).join('');

  const cols = `grid-template-columns:26px repeat(${numDays},1fr)`;
  const panelCls = `panel${stretch ? ' panel--stretch' : ''}`;

  return `<div class="${panelCls}">
    <div class="panel__header"><div class="panel__title">${title}</div></div>
    <div class="hm2d-wrap${stretch ? ' hm2d-wrap--fill' : ''}">
      <div class="hm2d-grid${stretch ? ' hm2d-grid--fill' : ''}" style="${cols}">
        ${corner}${dayLbls}${rows}
      </div>
    </div>
  </div>`;
}

/* ── CSAT / CES individual panels ────────────── */
function csatBarPanel(barId, csat, total, label = 'CSAT', fillHeight = false) {
  const bodyCls = fillHeight ? 'chart-container' : 'chart-container chart-h-160';
  return `<div class="panel">
    <div class="panel__header">
      <div class="panel__title">${label} — Distribuição de Notas</div>
      <span class="panel__hint">${total.toLocaleString('pt-BR')} avaliações</span>
    </div>
    <div class="panel__body ${bodyCls}">
      <canvas id="${barId}"></canvas>
    </div>
  </div>`;
}

function csatDntPanel(dntId, csat, total, label = 'CSAT') {
  const pct = csatPct(csat, total);
  return `<div class="panel">
    <div class="panel__header">
      <div class="panel__title">${label} — Satisfação</div>
      <span class="panel__hint" style="color:${pct >= 75 ? 'var(--color-success)' : 'var(--color-danger)'}">
        ${pct}% satisfeitos
      </span>
    </div>
    <div class="panel__body chart-container chart-h-160">
      <canvas id="${dntId}"></canvas>
    </div>
  </div>`;
}

/* ── Telephony tabulações panel ──────────────── */
/* Row-2 height ≈ TMPR (4 cols, 13px cells) = 267px.
   Body available: 267 − 44 (header) − 20 (padding) = 203px.
   Each tabu-row: 22px min-height + 5px gap = 27px → max 7 rows fit. */
const TABU_MAX_ROWS = 7;

function renderTabuPanel(tabu) {
  const visible = tabu.top10.slice(0, TABU_MAX_ROWS);
  const rows = visible.map(t => {
    const label = t.tag.length > 38 ? t.tag.slice(0, 36) + '…' : t.tag;
    return `<div class="tabu-row">
      <span class="tabu-row__tag" title="${t.tag}">${label}</span>
      <div class="tabu-row__track">
        <div class="tabu-row__fill" style="width:${t.pct}%"></div>
      </div>
      <span class="tabu-row__pct">${t.pct}%</span>
      <span class="tabu-row__n">${t.n.toLocaleString('pt-BR')}</span>
    </div>`;
  }).join('');
  return `<div class="panel">
    <div class="panel__header">
      <div class="panel__title">Tabulações — Top Motivos</div>
      <span class="panel__hint">${tabu.total.toLocaleString('pt-BR')} tabuladas</span>
    </div>
    <div class="panel__body tabu-list">${rows}</div>
  </div>`;
}

/* ── Stat card (simple KPI box) ──────────────── */
function statCard(title, value, sub = '', accent = '') {
  return `<div class="panel stat-card ${accent ? 'stat-card--' + accent : ''}">
    <div class="panel__header"><div class="panel__title">${title}</div></div>
    <div class="stat-card__val">${value}</div>
    ${sub ? `<div class="stat-card__sub">${sub}</div>` : ''}
  </div>`;
}

/* ── Executivos detailed grid ─────────────────── */
function renderExecDetail(stats) {
  return `
    <div class="detail-section">
      <div class="detail-section__title">★ Executivos &amp; Acima — Detalhamento</div>
      <div class="exec-grid">

        <!-- ENT/FIN: cols 1-5, row 1 — stretches to fill height set by TME+TMA wrapper -->
        <div class="eg-enf panel panel--stretch">
          <div class="panel__header">
            <div class="panel__title">Entrantes vs Finalizações</div>
            <span class="panel__hint">ao longo do período</span>
          </div>
          <div class="panel__body">
            <div class="chart-container">
              <canvas id="cht-exec-enf"></canvas>
            </div>
          </div>
        </div>

        <!-- TME + TMA wrapper: cols 6-9, row 1 — natural height drives the row -->
        <div class="eg-tme-tma">
          ${renderHeatmap2D('TME — hora × dia', stats.tmeMatrix, stats.numDays)}
          ${renderHeatmap2D('TMA — hora × dia', stats.tmaMatrix, stats.numDays)}
        </div>

        <!-- Row 2: donut (left) | CSAT bar (centre) | TMPR (right) -->
        <div class="eg-csatdnt">${csatDntPanel('cht-exec-csatdnt', stats.csat, stats.csatTotal)}</div>
        <div class="eg-csatbar">${csatBarPanel('cht-exec-csatbar', stats.csat, stats.csatTotal, 'CSAT', true)}</div>
        <div class="eg-tmpr">${renderHeatmap2D('TMPR — hora × dia', stats.tmprMatrix, stats.numDays)}</div>

      </div>
    </div>`;
}

/* ── Gestores detailed grid ──────────────────── */
function renderGestDetail(stats) {
  return `
    <div class="detail-section">
      <div class="detail-section__title">⚡ Gestores &amp; Abaixo — Detalhamento</div>
      <div class="gest-grid">

        <!-- ENT/FIN: cols 1-5, row 1 — stretches to fill height set by TME+TMA wrapper -->
        <div class="gg-enf panel panel--stretch">
          <div class="panel__header">
            <div class="panel__title">Entrantes vs Finalizações</div>
            <span class="panel__hint">ao longo do período</span>
          </div>
          <div class="panel__body">
            <div class=chart-container>
              <canvas id="cht-gest-enf"></canvas>
            </div>
          </div>
        </div>

        <!-- TME + TMA wrapper: cols 6-9, row 1 — natural height drives the row -->
        <div class="gg-tme-tma">
          ${renderHeatmap2D('TME — hora × dia', stats.tmeMatrix, stats.numDays)}
          ${renderHeatmap2D('TMA — hora × dia', stats.tmaMatrix, stats.numDays)}
        </div>

        <!-- Row 2: donut (left) | CSAT bar (centre) | Tabulations (right) -->
        <div class="gg-csatdnt">${csatDntPanel('cht-gest-csatdnt', stats.csat, stats.csatTotal)}</div>
        <div class="gg-csatbar">${csatBarPanel('cht-gest-csatbar', stats.csat, stats.csatTotal, 'CSAT', true)}</div>
        <div class="gg-tabul">${renderTabuPanel(stats.tabulacoes)}</div>

      </div>
    </div>`;
}

/* ── Performance detailed section ────────────── */
function renderPerfDetail(ps) {
  const convTotal = Math.round((ps.conversao.influencers + ps.conversao.lebes) / 2);
  const top5Html = ps.tabulacoes.top5.map(t => `
    <div class="tab-tag-row">
      <span class="tab-tag-row__tag">${t.tag}</span>
      <span class="tab-tag-row__n">${t.n}</span>
    </div>`).join('');

  const aguaPct = ps.aguardando.cliente + ps.aguardando.suporte;
  const atribTotal = ps.atribuicoes.atribuido + ps.atribuicoes.livre;

  return `
    <div class="detail-section">
      <div class="detail-section__title">🚀 Performance — Detalhamento</div>
      <div class="perf-grid">

        <!-- ENT/FIN -->
        <div class="pg-enf panel">
          <div class="panel__header">
            <div class="panel__title">Entrantes vs Finalizações</div>
            <span class="panel__hint">ao longo do período</span>
          </div>
          <div class="panel__body chart-container chart-h-260">
            <canvas id="cht-perf-enf"></canvas>
          </div>
        </div>

        <!-- EFICIÊNCIA -->
        ${statCard('Eficiência de Backlog',
          `<span style="color:${ps.eficiencia >= 90 ? 'var(--color-success)' : 'var(--color-warning)'}; font-size:var(--text-4xl);font-weight:900">${ps.eficiencia}%</span>`,
          'leads fechados / leads entrados', ps.eficiencia >= 90 ? 'ok' : 'warn'
        )}

        <!-- CONVERSÃO -->
        <div class="panel">
          <div class="panel__header"><div class="panel__title">Conversão</div></div>
          <div class="panel__body">
            <div class="conv-total">${convTotal}% <span>total</span></div>
            <div class="conv-split">
              <div class="conv-row">
                <span class="conv-row__label">Influencers</span>
                <div class="conv-bar-track">
                  <div class="conv-bar-fill" style="width:${Math.min(100, ps.conversao.influencers * 2)}%"></div>
                </div>
                <span class="conv-row__val">${ps.conversao.influencers}%</span>
              </div>
              <div class="conv-row">
                <span class="conv-row__label">Lebes</span>
                <div class="conv-bar-track">
                  <div class="conv-bar-fill conv-bar-fill--alt" style="width:${Math.min(100, ps.conversao.lebes * 2)}%"></div>
                </div>
                <span class="conv-row__val">${ps.conversao.lebes}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- TMPR -->
        ${statCard('TMPR', fmt(ps.tmpr), 'tempo médio de primeira resposta')}

        <!-- TMR -->
        ${statCard('TMR', fmtH(ps.tmr), 'tempo médio entre mensagens')}

        <!-- CSAT bar -->
        <div class="pg-csat-bar">${csatBarPanel('cht-perf-csatbar', ps.csat, ps.csatTotal)}</div>
        <!-- CSAT donut -->
        <div class="pg-csat-dnt">${csatDntPanel('cht-perf-csatdnt', ps.csat, ps.csatTotal)}</div>

        <!-- CES bar -->
        <div class="pg-ces-bar">${csatBarPanel('cht-perf-cesbar', ps.ces, ps.cesTotal, 'CES — Esforço do Cliente')}</div>
        <!-- CES donut -->
        <div class="pg-ces-dnt">${csatDntPanel('cht-perf-cesdnt', ps.ces, ps.cesTotal, 'CES')}</div>

        <!-- AGUARDANDO MENSAGEM -->
        <div class="pg-agua panel">
          <div class="panel__header">
            <div class="panel__title">Aguardando Mensagem</div>
            <span class="panel__hint">${aguaPct} conversas</span>
          </div>
          <div class="panel__body chart-container chart-h-180">
            <canvas id="cht-perf-agua"></canvas>
          </div>
        </div>

        <!-- ATRIBUIÇÕES -->
        <div class="pg-atrib panel">
          <div class="panel__header">
            <div class="panel__title">Atribuições</div>
            <span class="panel__hint">${atribTotal.toLocaleString('pt-BR')} conversas</span>
          </div>
          <div class="panel__body chart-container chart-h-180">
            <canvas id="cht-perf-atrib"></canvas>
          </div>
        </div>

        <!-- TABULAÇÕES -->
        <div class="pg-tabul panel">
          <div class="panel__header">
            <div class="panel__title">Tabulações</div>
            <span class="panel__hint">${ps.tabulacoes.total.toLocaleString('pt-BR')} conversas etiquetadas</span>
          </div>
          <div class="panel__body tabul-body">
            <div class="tabul-total">${ps.tabulacoes.total.toLocaleString('pt-BR')}</div>
            <div class="tabul-tags">${top5Html}</div>
          </div>
        </div>

      </div>
    </div>`;
}

/* ── Main render ──────────────────────────────── */
export function render() {
  if (!_period) _period = getCurrentPeriod() ?? monthOptions(1)[0].key;

  const periodLabel = monthOptions(12).find(m => m.key === _period)?.label ?? _period;

  const execStats = getQueueStats(['team-1'], _period);
  const gestStats = getQueueStats(['team-2', 'team-3'], _period);
  const perfStats = getPerfStats(_period);

  return `
    <div class="page-enter">
      <div class="dash-page-header">
        <div class="dash-page-header__info">
          <div class="dash-page-header__title">Suporte ao Licenciado — Painel Operacional</div>
          <div class="dash-page-header__meta">${periodLabel}</div>
        </div>
        ${renderPeriodNav()}
      </div>

      ${summaryCardRow('exec', 'Executivos & Acima', '★', execStats)}
      ${summaryCardRow('gest', 'Gestores & Abaixo',  '⚡', gestStats)}

      ${renderExecDetail(execStats)}
      ${renderGestDetail(gestStats)}
      ${renderPerfDetail(perfStats)}
    </div>`;
}

/* ── Init ─────────────────────────────────────── */
export function init() {
  if (!_period) _period = getCurrentPeriod() ?? monthOptions(1)[0].key;

  /* Period nav */
  const months = monthOptions(12);
  document.getElementById('dash-period-select')?.addEventListener('change', e => {
    _period = e.target.value; setPeriod(_period); reloadDashboard();
  });
  document.getElementById('dash-period-prev')?.addEventListener('click', () => {
    const i = months.findIndex(m => m.key === _period);
    if (i < months.length - 1) { _period = months[i + 1].key; setPeriod(_period); reloadDashboard(); }
  });
  document.getElementById('dash-period-next')?.addEventListener('click', () => {
    const i = months.findIndex(m => m.key === _period);
    if (i > 0) { _period = months[i - 1].key; setPeriod(_period); reloadDashboard(); }
  });

  const exec = getQueueStats(['team-1'], _period);
  const gest = getQueueStats(['team-2', 'team-3'], _period);
  const perf = getPerfStats(_period);

  const dayLabels = (stats) => stats.daily.map(d => String(d.day));

  /* Executivos charts */
  renderCountChart('cht-exec-enf', dayLabels(exec), [
    { label: 'Finalizações', data: exec.daily.map(d => d.fin),
      borderColor: '#4aba3d', backgroundColor: 'rgba(74,186,61,0.18)',
      fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2, spanGaps: true },
    { label: 'Entrantes', data: exec.daily.map(d => d.ent),
      borderColor: '#f59e0b', backgroundColor: 'transparent',
      fill: false, tension: 0.3, pointRadius: 2, borderWidth: 2, borderDash: [4, 3], spanGaps: true },
  ]);
  renderBarChart('cht-exec-csatbar', ['1★', '2★', '3★', '4★', '5★'], exec.csat, CSAT_COLORS);
  renderDoughnutChart('cht-exec-csatdnt',
    ['Satisfeitos (4+5)', 'Outros (1–3)'],
    [exec.csat[3] + exec.csat[4], exec.csat[0] + exec.csat[1] + exec.csat[2]],
    ['#22c55e', '#e5e7eb'], 'top'
  );

  /* Gestores charts */
  renderCountChart('cht-gest-enf', dayLabels(gest), [
    { label: 'Finalizações', data: gest.daily.map(d => d.fin),
      borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.15)',
      fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2, spanGaps: true },
    { label: 'Entrantes', data: gest.daily.map(d => d.ent),
      borderColor: '#f59e0b', backgroundColor: 'transparent',
      fill: false, tension: 0.3, pointRadius: 2, borderWidth: 2, borderDash: [4, 3], spanGaps: true },
  ]);
  renderBarChart('cht-gest-csatbar', ['1★', '2★', '3★', '4★', '5★'], gest.csat, CSAT_COLORS);
  renderDoughnutChart('cht-gest-csatdnt',
    ['Satisfeitos (4+5)', 'Outros (1–3)'],
    [gest.csat[3] + gest.csat[4], gest.csat[0] + gest.csat[1] + gest.csat[2]],
    ['#22c55e', '#e5e7eb'], 'top'
  );

  /* Performance charts */
  renderCountChart('cht-perf-enf', dayLabels(perf), [
    { label: 'Finalizações', data: perf.daily.map(d => d.fin),
      borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.15)',
      fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2, spanGaps: true },
    { label: 'Entrantes', data: perf.daily.map(d => d.ent),
      borderColor: '#f59e0b', backgroundColor: 'transparent',
      fill: false, tension: 0.3, pointRadius: 2, borderWidth: 2, borderDash: [4, 3], spanGaps: true },
  ]);
  renderBarChart('cht-perf-csatbar', ['1★', '2★', '3★', '4★', '5★'], perf.csat, CSAT_COLORS);
  renderDoughnutChart('cht-perf-csatdnt',
    ['Satisfeitos (4+5)', 'Outros (1–3)'],
    [perf.csat[3] + perf.csat[4], perf.csat[0] + perf.csat[1] + perf.csat[2]],
    ['#22c55e', '#e5e7eb']
  );
  renderBarChart('cht-perf-cesbar', ['1★', '2★', '3★', '4★', '5★'], perf.ces, CSAT_COLORS);
  renderDoughnutChart('cht-perf-cesdnt',
    ['Fácil (4+5)', 'Difícil (1–3)'],
    [perf.ces[3] + perf.ces[4], perf.ces[0] + perf.ces[1] + perf.ces[2]],
    ['#06b6d4', '#e5e7eb']
  );
  renderDoughnutChart('cht-perf-agua',
    ['Aguardando cliente', 'Aguardando suporte'],
    [perf.aguardando.cliente, perf.aguardando.suporte],
    ['#3b82f6', '#f59e0b']
  );
  renderDoughnutChart('cht-perf-atrib',
    ['Atribuído', 'Sem fila'],
    [perf.atribuicoes.atribuido, perf.atribuicoes.livre],
    ['#4aba3d', '#e5e7eb']
  );
}
