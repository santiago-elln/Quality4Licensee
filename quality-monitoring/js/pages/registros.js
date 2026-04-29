/* ============================================================
   REGISTROS — Histórico de monitorias
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { navigate } from '../router.js';
import {
  getCollabsForViewer, getMonitorias, MOCK_USERS, TEAMS, getTeam,
} from '../data/mock.js';
import {
  formatDate, formatHHMMSS, resultBand, scoreColor, monthOptions,
} from '../utils/formatters.js';
import { getCurrentPeriod } from '../components/header.js';

const PAGE_SIZE = 15;
let _page = 1;
let _filtered = [];

export function render() {
  const user   = getCurrentUser();
  const period = getCurrentPeriod() ?? monthOptions(1)[0].key;
  const collabs = getCollabsForViewer(user).filter(c => c.role === 'colaborador');
  const collabIds = new Set(collabs.map(c => c.id));
  const all = getMonitorias({ deptId: user.deptId }).filter(m => collabIds.has(m.colaboradorId));
  _filtered = all;
  _page = 1;

  const collabOpts = [
    `<option value="">Todos os colaboradores</option>`,
    ...collabs.map(c => `<option value="${c.id}">${c.name}</option>`),
  ].join('');

  const teamOpts = [
    `<option value="">Todas as equipes</option>`,
    ...TEAMS.filter(t => t.deptId === user.deptId).map(t => `<option value="${t.id}">${t.name}</option>`),
  ].join('');

  return `
    <div class="page-enter">
      <div class="page-header">
        <div class="page-title">Registros</div>
        <div class="page-subtitle">Histórico de monitorias realizadas</div>
      </div>

      <div class="panel">
        <!-- Filters -->
        <div class="table-filters">
          <select class="form-select" id="filter-collab" style="max-width:220px">${collabOpts}</select>
          <select class="form-select" id="filter-team"   style="max-width:180px">${teamOpts}</select>
          <select class="form-select" id="filter-month"  style="max-width:180px">
            <option value="">Todos os períodos</option>
            ${monthOptions(12).map(m => `<option value="${m.key}">${m.label}</option>`).join('')}
          </select>
          <select class="form-select" id="filter-band"   style="max-width:160px">
            <option value="">Todas as faixas</option>
            <option value="excellent">Excelente (≥95%)</option>
            <option value="good">Bom (70–94%)</option>
            <option value="regular">Regular (50–69%)</option>
            <option value="critical">Crítico (1–49%)</option>
            <option value="zero">Zerada (0%)</option>
          </select>
        </div>

        <!-- Table -->
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Colaborador</th>
                <th>Equipe</th>
                <th>Protocolo</th>
                <th>Pontuação</th>
                <th>Aproveit.</th>
                <th>CSAT</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody id="records-tbody">
              ${renderRows(_filtered.slice(0, PAGE_SIZE), collabs)}
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="table-pagination">
          <span class="pagination-info" id="pag-info">
            Exibindo 1–${Math.min(PAGE_SIZE, _filtered.length)} de ${_filtered.length}
          </span>
          <div class="pagination-controls" id="pag-controls">
            ${renderPagination(_filtered.length)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderRows(mons, collabs) {
  if (!mons.length) return `<tr><td colspan="8" style="text-align:center;padding:var(--space-8);color:var(--text-tertiary)">Nenhum registro encontrado</td></tr>`;
  return mons.map(m => {
    const collab = MOCK_USERS.find(u => u.id === m.colaboradorId);
    const team   = collab?.teamId ? getTeam(collab.teamId) : null;
    const band   = resultBand(m.pct);
    return `
      <tr class="clickable" data-mon="${m.id}" data-collab="${m.colaboradorId}">
        <td>${formatDate(m.date)}</td>
        <td><strong>${collab?.name ?? '—'}</strong></td>
        <td class="muted">${team?.name ?? '—'}</td>
        <td class="muted" style="font-family:var(--font-mono)">${m.attendanceId}</td>
        <td>
          <div class="score-cell">
            <span class="score-val" style="color:${scoreColor(m.pct)}">${m.score}</span>
            <span style="font-size:var(--text-xs);color:var(--text-tertiary)">/100</span>
          </div>
        </td>
        <td>
          <div class="score-cell">
            <div class="score-bar">
              <div class="score-bar__fill" style="width:${m.pct}%;background:${scoreColor(m.pct)}"></div>
            </div>
            <span class="score-val" style="color:${scoreColor(m.pct)}">${m.pct}%</span>
          </div>
        </td>
        <td style="text-align:center">${m.csat ?? '—'}</td>
        <td><span class="badge badge--${band.cls}">${band.label}</span></td>
      </tr>
    `;
  }).join('');
}

function renderPagination(total) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return '';
  return Array.from({ length: Math.min(pages, 7) }, (_, i) => i + 1)
    .map(p => `<button class="page-btn ${p === _page ? 'active' : ''}" data-page="${p}">${p}</button>`)
    .join('');
}

function applyFilters() {
  const user    = getCurrentUser();
  const collabs = getCollabsForViewer(user).filter(c => c.role === 'colaborador');
  const collabIds = new Set(collabs.map(c => c.id));

  const collabFilter = document.getElementById('filter-collab')?.value ?? '';
  const teamFilter   = document.getElementById('filter-team')?.value ?? '';
  const monthFilter  = document.getElementById('filter-month')?.value ?? '';
  const bandFilter   = document.getElementById('filter-band')?.value ?? '';

  let all = getMonitorias({ deptId: user.deptId }).filter(m => collabIds.has(m.colaboradorId));

  if (collabFilter) all = all.filter(m => m.colaboradorId === collabFilter);
  if (teamFilter) {
    const teamCollabs = new Set(collabs.filter(c => c.teamId === teamFilter).map(c => c.id));
    all = all.filter(m => teamCollabs.has(m.colaboradorId));
  }
  if (monthFilter) all = all.filter(m => m.date.startsWith(monthFilter));
  if (bandFilter) {
    const ranges = { excellent: [95,100], good: [70,94], regular: [50,69], critical: [1,49], zero: [0,0] };
    const [lo, hi] = ranges[bandFilter] ?? [0, 100];
    all = all.filter(m => m.pct >= lo && m.pct <= hi);
  }

  _filtered = all;
  _page = 1;
  refreshTable();
}

function refreshTable() {
  const start = (_page - 1) * PAGE_SIZE;
  const slice = _filtered.slice(start, start + PAGE_SIZE);
  const collabs = getCollabsForViewer(getCurrentUser()).filter(c => c.role === 'colaborador');
  const tbody = document.getElementById('records-tbody');
  const info  = document.getElementById('pag-info');
  const ctrl  = document.getElementById('pag-controls');
  if (tbody) tbody.innerHTML = renderRows(slice, collabs);
  if (info)  info.textContent = `Exibindo ${start+1}–${Math.min(start+PAGE_SIZE, _filtered.length)} de ${_filtered.length}`;
  if (ctrl)  ctrl.innerHTML = renderPagination(_filtered.length);
  bindTableEvents();
}

function bindTableEvents() {
  document.querySelectorAll('tr[data-collab]').forEach(row => {
    row.addEventListener('click', () => navigate('perfil', { id: row.dataset.collab }));
  });
  document.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      _page = parseInt(btn.dataset.page);
      refreshTable();
    });
  });
}

export function init() {
  bindTableEvents();
  ['filter-collab', 'filter-team', 'filter-month', 'filter-band'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', applyFilters);
  });
}
