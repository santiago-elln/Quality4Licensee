/* ============================================================
   CHARTS — Wrappers para Chart.js
   ============================================================ */

const _instances = new Map();

function destroy(id) {
  if (_instances.has(id)) {
    _instances.get(id).destroy();
    _instances.delete(id);
  }
}

function create(id, config) {
  destroy(id);
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  const chart = new Chart(canvas, config);
  _instances.set(id, chart);
  return chart;
}

export function destroyAll() {
  _instances.forEach(c => c.destroy());
  _instances.clear();
}

/* ── Evolution Line/Area Chart ────────────── */
export function renderEvolutionChart(canvasId, labels, datasets) {
  return create(canvasId, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { font: { size: 11 }, boxWidth: 12 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, color: '#9ca3af' },
        },
        y: {
          min: 0, max: 100,
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: {
            font: { size: 10 }, color: '#9ca3af',
            callback: v => v + '%',
          },
        },
      },
    },
  });
}

/* ── Combined Bar + Line Chart ────────────── */
export function renderCombinedChart(canvasId, labels, barData, lineData, barLabel, lineLabel) {
  return create(canvasId, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: barLabel,
          data: barData,
          backgroundColor: 'rgba(74,186,61,0.4)',
          borderColor: 'rgba(74,186,61,0.8)',
          borderWidth: 1,
          borderRadius: 3,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: lineLabel,
          data: lineData,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.1)',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.35,
          yAxisID: 'y2',
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { font: { size: 11 }, boxWidth: 12 } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#9ca3af' } },
        y: {
          position: 'left',
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { font: { size: 10 }, color: '#9ca3af' },
          title: { display: true, text: barLabel, font: { size: 10 }, color: '#9ca3af' },
        },
        y2: {
          position: 'right',
          min: 0, max: 100,
          grid: { drawOnChartArea: false },
          ticks: { font: { size: 10 }, color: '#9ca3af', callback: v => v + '%' },
        },
      },
    },
  });
}

/* ── Radar Chart ──────────────────────────── */
export function renderRadarChart(canvasId, labels, datasets) {
  const colors = ['rgba(74,186,61,0.4)', 'rgba(59,130,246,0.3)', 'rgba(245,158,11,0.3)'];
  const borders = ['#4aba3d', '#3b82f6', '#f59e0b'];

  return create(canvasId, {
    type: 'radar',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        label: d.label,
        data: d.data,
        backgroundColor: colors[i] ?? colors[0],
        borderColor: borders[i] ?? borders[0],
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: borders[i] ?? borders[0],
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { font: { size: 10 }, boxWidth: 10 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.r.toFixed(1)}%`,
          },
        },
      },
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { display: false },
          grid: { color: 'rgba(0,0,0,0.07)' },
          pointLabels: {
            font: { size: 10 },
            color: '#6b7280',
          },
          angleLines: { color: 'rgba(0,0,0,0.07)' },
        },
      },
    },
  });
}

/* ── Doughnut / Pie Chart ─────────────────── */
export function renderDoughnutChart(canvasId, labels, data, colors, legendPosition = 'right') {
  return create(canvasId, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '60%',
      plugins: {
        legend: {
          position: legendPosition,
          labels: { font: { size: 11 }, boxWidth: 12, padding: 12 },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

/* ── Vertical Bar Chart (CSAT / CES grades) ── */
export function renderBarChart(canvasId, labels, data, colors) {
  return create(canvasId, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderRadius: 5,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 13, weight: '700' }, color: '#374151' },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.06)' },
          ticks: { font: { size: 10 }, color: '#9ca3af' },
        },
      },
    },
  });
}

/* ── Count Line/Area Chart (ENT vs FIN) ──── */
export function renderCountChart(canvasId, labels, datasets) {
  return create(canvasId, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, labels: { font: { size: 11 }, boxWidth: 12 } },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 10 }, color: '#9ca3af', maxRotation: 0,
            callback: (_, i) => (i % 4 === 0 ? labels[i] : ''),
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { font: { size: 10 }, color: '#9ca3af' },
        },
      },
    },
  });
}

/* ── Horizontal Bar Chart ─────────────────── */
export function renderHBarChart(canvasId, labels, data, color = '#4aba3d') {
  return create(canvasId, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: color,
        borderRadius: 3,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          min: 0, max: 100,
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { font: { size: 10 }, color: '#9ca3af', callback: v => v + '%' },
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 11 }, color: '#374151' },
        },
      },
    },
  });
}
