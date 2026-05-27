/* ============================================================
   COMPARAÇÃO — Comparativo de períodos entre departamentos
   ============================================================ */
import { getDailyStats, getDailyHeatmapStats, QUEUE_HOURS } from '../data/mock.js';
import { CalPicker, calTriggerHtml } from '../components/cal-picker.js';

/* ── Date picker state ───────────────────────── */
let _currFrom = '', _currTo = '', _pastFrom = '', _pastTo = '';
let _currPicker = null, _pastPicker = null;

/* ── Department / metric configuration ──────── */
const DEPARTMENTS = [
  { id: 'exec', label: 'Executivos & Acima',      teams: ['team-1'],                    metrics: ['tme', 'tma', 'tmpr'] },
  { id: 'gest', label: 'Gestores & Abaixo',        teams: ['team-2', 'team-3'],          metrics: ['tme', 'tma'] },
  { id: 'perf', label: 'Performance',              teams: ['team-1', 'team-2', 'team-3'], metrics: ['tma', 'tmr', 'tmpr'] },
];

const METRIC_META = {
  tme:  'TME — Tempo Médio de Espera',
  tma:  'TMA — Tempo Médio de Atendimento',
  tmpr: 'TMPR — Tempo de Primeira Resposta',
  tmr:  'TMR — Tempo Médio de Resposta',
};

const DOW_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/* ── Same green scale as the dashboard heatmaps ─ */
const HM_SCALE = [
  'var(--hm-0)', 'var(--hm-1)', 'var(--hm-2)', 'var(--hm-3)',
  'var(--hm-4)', 'var(--hm-5)', 'var(--hm-6)', 'var(--hm-7)',
];
function hmCellBg(v, minV, maxV) {
  if (v === 0) return 'var(--bg-surface-2)';
  const t     = Math.sqrt((v - minV) / Math.max(maxV - minV, 1));
  const i     = Math.min(HM_SCALE.length - 1, Math.floor(t * HM_SCALE.length));
  const alpha = Math.round(50 + t * 50);
  return `color-mix(in srgb, ${HM_SCALE[i]} ${alpha}%, transparent)`;
}

/* ── Date helpers ───────────────────────────── */
function toISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toISO(d);
}
function dateRange(from, to) {
  const out = [];
  let cur = from;
  while (cur <= to) { out.push(cur); cur = shiftDate(cur, 1); }
  return out;
}
function thisMonday() {
  const d = new Date();
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return toISO(d);
}
function getDefaults() {
  const today    = toISO(new Date());
  const currFrom = thisMonday();
  const currTo   = today;
  const pastTo   = shiftDate(currFrom, -1);
  const pastFrom = shiftDate(pastTo, -13);
  return { currFrom, currTo, pastFrom, pastTo };
}

function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${DOW_PT[d.getDay()]} ${dd}/${mm}`;
}

/* ── Duration formatters ─────────────────────── */
function fmtDur(sec) {
  if (!sec || isNaN(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || !parts.length) parts.push(`${s}s`);
  return parts.join(' ');
}

function fmtVar(sec) {
  if (sec == null || isNaN(sec)) return '—';
  const sign = sec > 0 ? '+' : sec < 0 ? '-' : '';
  const abs  = Math.abs(Math.round(sec));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || !parts.length) parts.push(`${s}s`);
  return sign + parts.join(' ');
}

/* ── ENT/FIN variation ───────────────────────── */
function computeEntFinVariation(currDates, pastDates, teams) {
  const labels = [], entVar = [], finVar = [];
  for (const dateStr of currDates) {
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    labels.push(dayLabel(dateStr));
    const matches = pastDates.filter(d => new Date(d + 'T12:00:00').getDay() === dow);
    if (!matches.length) { entVar.push(null); finVar.push(null); continue; }
    const curr   = getDailyStats(teams, dateStr);
    const avgEnt = matches.reduce((s, d) => s + getDailyStats(teams, d).ent, 0) / matches.length;
    const avgFin = matches.reduce((s, d) => s + getDailyStats(teams, d).fin, 0) / matches.length;
    entVar.push(+(curr.ent - avgEnt).toFixed(1));
    finVar.push(+(curr.fin - avgFin).toFixed(1));
  }
  return { labels, entVar, finVar };
}

/* ── Period average for a metric ────────────── */
function metricPeriodAvg(dates, teams, metric) {
  let sum = 0, count = 0;
  for (const d of dates) {
    for (const v of getDailyHeatmapStats(teams, d)[metric]) {
      if (v > 0) { sum += v; count++; }
    }
  }
  return count > 0 ? Math.round(sum / count) : 0;
}

/* ── Heatmap variation ───────────────────────── */
function computeHeatmapVariation(metric, currDates, pastDates, teams) {
  // Pre-compute all stats to avoid redundant calls
  const currStats = currDates.map(d => getDailyHeatmapStats(teams, d));
  const pastCache = {};
  for (const d of pastDates) pastCache[d] = getDailyHeatmapStats(teams, d);

  return QUEUE_HOURS.map((_, hIdx) =>
    currDates.map((dateStr, dIdx) => {
      const dow     = new Date(dateStr + 'T12:00:00').getDay();
      const matches = pastDates.filter(d => new Date(d + 'T12:00:00').getDay() === dow);
      if (!matches.length) return null;
      const currVal = currStats[dIdx][metric][hIdx];
      const avgPast = matches.reduce((s, d) => s + pastCache[d][metric][hIdx], 0) / matches.length;
      return Math.round(currVal - avgPast);
    })
  );
}

/* ── ENT/FIN line chart ──────────────────────── */
function drawEntFinChart(labels, entVar, finVar) {
  const existing = Chart.getChart('comp-enf-chart');
  if (existing) existing.destroy();
  const canvas = document.getElementById('comp-enf-chart');
  if (!canvas) return;

  const allVals = [...entVar, ...finVar].filter(v => v != null);
  if (!allVals.length) return;
  const bound = Math.ceil(Math.max(...allVals.map(v => Math.abs(v)), 1) * 1.25);

  const zeroLine = {
    id: 'zeroLine',
    afterDraw(chart) {
      const { ctx, scales: { y }, chartArea: { left, right } } = chart;
      const yPos = y.getPixelForValue(0);
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(left, yPos); ctx.lineTo(right, yPos); ctx.stroke();
      ctx.restore();
    },
  };

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Entrantes',    data: entVar, borderColor: '#f59e0b', backgroundColor: 'transparent',
          borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: '#f59e0b', tension: 0.3, spanGaps: false },
        { label: 'Finalizações', data: finVar, borderColor: '#4aba3d', backgroundColor: 'transparent',
          borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: '#4aba3d', tension: 0.3, spanGaps: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { font: { size: 12 }, boxWidth: 14, padding: 16 } },
        tooltip: { callbacks: { label: ctx => {
          const v = ctx.parsed.y; if (v == null) return '';
          return ` ${ctx.dataset.label}: ${v >= 0 ? '+' : ''}${v.toLocaleString('pt-BR')}`;
        }}},
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#9ca3af' } },
        y: { min: -bound, max: bound,
          grid: { color: 'rgba(0,0,0,0.06)' },
          ticks: { font: { size: 11 }, color: '#9ca3af', callback: v => (v > 0 ? '+' : '') + v } },
      },
    },
    plugins: [zeroLine],
  });
}

/* ── Metric heatmap HTML ─────────────────────── */
function renderCompHeatmap(metric, matrix, currDates, currAvg, pastAvg) {
  const flat = matrix.flat().filter(v => v !== null);
  if (!flat.length) return '';
  const minV  = Math.min(...flat);
  const maxV  = Math.max(...flat, 1);
  // minmax: cells grow to fill space with few days, floor at 14px for many days
  const cols  = `grid-template-columns: 26px repeat(${currDates.length}, minmax(14px, 1fr))`;
  const delta = currAvg - pastAvg;
  const deltaCls = delta < 0 ? 'comp-hm-stat__val--better' : delta > 0 ? 'comp-hm-stat__val--worse' : '';

  const dayHeaders = currDates.map(d => {
    const date = new Date(d + 'T12:00:00');
    return `<div class="hm2d-day" title="${dayLabel(d)}">${date.getDate()}</div>`;
  }).join('');

  const rows = QUEUE_HOURS.map((h, hIdx) => {
    const cells = matrix[hIdx].map((v, dIdx) => {
      const bg  = v === null ? 'var(--bg-surface-3)' : hmCellBg(v, minV, maxV);
      const tip = `${String(h).padStart(2, '0')}h – ${dayLabel(currDates[dIdx])}: ${fmtVar(v)}`;
      return `<div class="hm2d-cell" style="background:${bg}" title="${tip}"></div>`;
    }).join('');
    return `<div class="hm2d-hlbl">${String(h).padStart(2, '0')}h</div>${cells}`;
  }).join('');

  return `
    <div class="panel comp-hm-panel">
      <div class="panel__header">
        <div class="panel__title">${METRIC_META[metric]}</div>
      </div>
      <div class="panel__body comp-hm-body">
        <div class="hm2d-wrap">
          <div class="hm2d-grid" style="${cols}">
            <div class="hm2d-corner"></div>${dayHeaders}${rows}
          </div>
        </div>
        <div class="comp-hm-card">
          <div class="comp-hm-stat">
            <span class="comp-hm-stat__label">Atual</span>
            <span class="comp-hm-stat__val">${fmtDur(currAvg)}</span>
          </div>
          <div class="comp-hm-stat">
            <span class="comp-hm-stat__label">Δ</span>
            <span class="comp-hm-stat__val ${deltaCls}">${fmtVar(delta)}</span>
          </div>
        </div>
      </div>
    </div>`;
}

/* ── Info strip ─────────────────────────────── */
function buildInfoHtml(dept, currFrom, currTo, pastFrom, pastTo, nCurr, nPast) {
  const fmt = d => d.split('-').reverse().join('/');
  return `
    <span class="comp-info__dept">${dept.label}</span>
    <span class="comp-info__sep">·</span>
    <span class="comp-info__period">Atual: <strong>${fmt(currFrom)} – ${fmt(currTo)}</strong>
      <span class="comp-info__days">${nCurr} dias</span></span>
    <span class="comp-info__sep">·</span>
    <span class="comp-info__period">Base: <strong>${fmt(pastFrom)} – ${fmt(pastTo)}</strong>
      <span class="comp-info__days">${nPast} dias</span></span>`;
}

/* ── Run comparison ──────────────────────────── */
function run() {
  const deptId   = document.getElementById('comp-dept')?.value ?? 'exec';
  const currFrom = _currFrom;
  const currTo   = _currTo;
  const pastFrom = _pastFrom;
  const pastTo   = _pastTo;
  if (!currFrom || !currTo || !pastFrom || !pastTo) return;
  if (currFrom > currTo || pastFrom > pastTo)       return;

  const dept      = DEPARTMENTS.find(d => d.id === deptId) ?? DEPARTMENTS[0];
  const currDates = dateRange(currFrom, currTo);
  const pastDates = dateRange(pastFrom, pastTo);

  // ── ENT/FIN line chart
  const { labels, entVar, finVar } = computeEntFinVariation(currDates, pastDates, dept.teams);
  drawEntFinChart(labels, entVar, finVar);

  // ── Metric heatmaps
  const heatmapsEl = document.getElementById('comp-heatmaps');
  if (heatmapsEl) {
    heatmapsEl.innerHTML = dept.metrics.map(metric => {
      const matrix  = computeHeatmapVariation(metric, currDates, pastDates, dept.teams);
      const currAvg = metricPeriodAvg(currDates, dept.teams, metric);
      const pastAvg = metricPeriodAvg(pastDates, dept.teams, metric);
      return renderCompHeatmap(metric, matrix, currDates, currAvg, pastAvg);
    }).join('');
  }

  // ── Info strip
  const infoEl = document.getElementById('comp-info');
  if (infoEl) infoEl.innerHTML = buildInfoHtml(dept, currFrom, currTo, pastFrom, pastTo, currDates.length, pastDates.length);
}

/* ── Render & Init ───────────────────────────── */
export function render() {
  const currFrom = _currFrom;
  const currTo   = _currTo;
  const pastFrom = _pastFrom;
  const pastTo   = _pastTo;
  const deptOpts = DEPARTMENTS.map(d => `<option value="${d.id}">${d.label}</option>`).join('');

  return `
    <div class="page-enter">
      <div class="dash-page-header">
        <div class="dash-page-header__info">
          <div class="dash-page-header__title">Comparativo de Períodos</div>
          <div class="dash-page-header__meta">Variação do período atual em relação ao período base</div>
        </div>
      </div>

      <div class="comp-controls panel">
        <div class="comp-controls__row">
          <div class="comp-ctrl-group">
            <label class="comp-ctrl-label">Departamento</label>
            <select class="comp-ctrl-select" id="comp-dept">${deptOpts}</select>
          </div>
          <div class="comp-ctrl-group">
            <label class="comp-ctrl-label">Período Atual</label>
            ${calTriggerHtml('comp-curr-trigger', currFrom, currTo)}
          </div>
          <div class="comp-ctrl-group">
            <label class="comp-ctrl-label">Período Base (comparação)</label>
            ${calTriggerHtml('comp-past-trigger', pastFrom, pastTo)}
          </div>
          <button class="comp-apply-btn" id="comp-apply">Comparar</button>
        </div>
        <div class="comp-info-strip" id="comp-info"></div>
      </div>

      <div class="detail-section">
        <div class="detail-section__title">ENT / FIN — Variação em relação ao Período Base</div>
        <div class="panel">
          <div class="panel__body chart-container comp-chart-body">
            <canvas id="comp-enf-chart"></canvas>
          </div>
        </div>
      </div>

      <div id="comp-heatmaps"></div>
    </div>`;
}

export function init() {
  _currFrom = ''; _currTo = '';
  _pastFrom = ''; _pastTo = '';

  _currPicker?.destroy();
  _currPicker = new CalPicker({
    triggerEl: document.getElementById('comp-curr-trigger'),
    from: _currFrom,
    to:   _currTo,
    onApply: (from, to) => { _currFrom = from; _currTo = to; run(); },
    onClear: ()         => { _currFrom = '';  _currTo = '';  run(); },
  });

  _pastPicker?.destroy();
  _pastPicker = new CalPicker({
    triggerEl: document.getElementById('comp-past-trigger'),
    from: _pastFrom,
    to:   _pastTo,
    onApply: (from, to) => { _pastFrom = from; _pastTo = to; run(); },
    onClear: ()         => { _pastFrom = '';  _pastTo = '';  run(); },
  });

  document.getElementById('comp-apply')?.addEventListener('click', run);
  document.getElementById('comp-dept')?.addEventListener('change', run);
  run();
}
