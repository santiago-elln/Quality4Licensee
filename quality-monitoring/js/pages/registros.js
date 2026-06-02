/* ============================================================
   REGISTROS — Histórico de monitorias
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { supabase } from '../supabase.js';
import { navigate } from '../router.js';
import { can, P } from '../utils/permissions.js';
import {
  formatDate, resultBand, scoreColor, scoreColorHex, getInitials,
} from '../utils/formatters.js';
import { renderRadarChart } from '../components/charts.js';
import { CalPicker, calTriggerHtml } from '../components/cal-picker.js';

const PAGE_SIZE = 20;

/* ── Module state ─────────────────────────── */
let _page         = 1;
let _allRows      = [];   // rows from last DB fetch (date-filtered)
let _rows         = [];   // after client-side collab/sup/band filters
let _employees    = [];   // [{id, name, team_id}]
let _teams        = [];   // [{id, name}]
let _topicMap     = {};   // {topicId: {eval_criteria_id, points, item}}
let _evalCriteria = [];   // [{id, name}]
let _sgEcMap      = new Map(); // sector_group_id → Set<eval_criteria_id>
let _currentUser      = null;
let _refDataLoaded    = false;
let _fetchedGlobalScope = null;
let _fetchedUserId      = null;
let _dataLoaded       = false;
let _expandedId       = null;
let _pendingDelete    = null;  // {id, number, empName}
let _editableRefData  = null;  // { obsTypeMap, evalCriteria, errorTypes } — lazily loaded
let _filters          = { collabId: '', supId: '', dateFrom: '', dateTo: '', band: '' };
let _calPicker        = null;
let _allObservations    = [];  // [{monId, typeCode, ecId, ecName, errorTypeId, errorTypeName, content}]
let _pendingTopicChanges = {}; // { [monId]: { [topicId]: { newObtained, points } } }

/* ── Row processor ────────────────────────── */
function processRow(mon) {
  let score = 0, total = 0;
  const radarSum = {};
  for (const ta of (mon.topic_approval ?? [])) {
    const t = _topicMap[ta.topic_id];
    if (!t) continue;
    total += t.points;
    if (ta.obtained) score += t.points;
    const cid = t.eval_criteria_id;
    if (!radarSum[cid]) radarSum[cid] = { e: 0, m: 0 };
    radarSum[cid].m += t.points;
    if (ta.obtained) radarSum[cid].e += t.points;
  }
  const pct = total > 0 ? Math.round(score / total * 100) : 0;

  const csats = (mon.service_chat ?? []).filter(sc => sc.csat).map(sc => sc.csat);
  const avgCsat = csats.length
    ? Math.round(csats.reduce((a, b) => a + b, 0) / csats.length * 10) / 10
    : null;

  const emp = _employees.find(e => e.id === mon.employee_id);
  const team = _teams.find(t => t.id === emp?.team_id);

  return {
    id:      mon.id,
    date:    mon.date,
    number:  mon.number,
    zeroed:  mon.zeroed,
    empId:   emp?.id   ?? null,
    empName: emp?.name ?? '—',
    supName: team?.name ?? '—',
    supId:   emp?.team_id ?? null,
    score, total, pct, avgCsat,
    band: resultBand(pct),
    radarSum,
  };
}

/* ── Data fetch ───────────────────────────── */
async function fetchRefData() {
  const globalScope = can(_currentUser, P.GLOBAL_VIEW_DEPT);
  if (_refDataLoaded && _fetchedGlobalScope === globalScope && _fetchedUserId === _currentUser?.id) return;

  const scopeIds   = globalScope ? null : (_currentUser.supervisedTeamIds ?? []);
  const noAccess   = !globalScope && scopeIds.length === 0;
  const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

  let empQuery   = supabase.from('employees').select('id, name, team_id').eq('active', true);
  let teamsQuery = supabase.from('teams').select('id, name, sector_group_id').eq('active', true).order('name');
  if (!globalScope) {
    const ids = noAccess ? [EMPTY_GUID] : scopeIds;
    empQuery   = empQuery.in('team_id', ids);
    teamsQuery = teamsQuery.in('id', ids);
  }

  const [empRes, teamsRes, topicRes, ecRes, sgEcRes] = await Promise.all([
    empQuery,
    teamsQuery,
    supabase.from('topic').select('id, eval_criteria_id, points, item').eq('active', true),
    supabase.from('eval_criteria').select('id, name').eq('active', true),
    supabase.from('sector_group_eval_criteria').select('sector_group_id, eval_criteria_id'),
  ]);
  _employees    = empRes.data    ?? [];
  _teams        = teamsRes.data  ?? [];
  _topicMap     = Object.fromEntries((topicRes.data ?? []).map(t => [t.id, t]));
  _evalCriteria = ecRes.data    ?? [];
  _sgEcMap      = new Map();
  for (const { sector_group_id, eval_criteria_id } of (sgEcRes.data ?? [])) {
    if (!_sgEcMap.has(sector_group_id)) _sgEcMap.set(sector_group_id, new Set());
    _sgEcMap.get(sector_group_id).add(eval_criteria_id);
  }
  _refDataLoaded      = true;
  _fetchedGlobalScope = globalScope;
  _fetchedUserId      = _currentUser?.id ?? null;
}

async function fetchMonitorings() {
  const empIds = _employees.map(e => e.id);
  if (!empIds.length) { _allRows = []; _rows = []; return; }

  let q = supabase
    .from('monitoring')
    .select(`id, date, number, zeroed, employee_id,
      topic_approval(topic_id, obtained),
      service_chat(csat)`)
    .in('employee_id', empIds)
    .order('date', { ascending: false })
    .order('number', { ascending: false });

  if (_filters.dateFrom) q = q.gte('date', _filters.dateFrom);
  if (_filters.dateTo)   q = q.lte('date', _filters.dateTo);

  const { data, error } = await q;
  if (error) { console.error('[registros] monitoring:', error); return; }

  _allRows = (data ?? []).map(processRow);
  applyClientFilters();
}

function applyClientFilters() {
  let rows = [..._allRows];
  if (_filters.collabId) rows = rows.filter(r => r.empId === _filters.collabId);
  if (_filters.supId)    rows = rows.filter(r => r.supId === _filters.supId);
  if (_filters.band) {
    const ranges = { excellent: [95,100], good: [70,94], regular: [50,69], critical: [1,49], zero: [0,0] };
    const [lo, hi] = ranges[_filters.band] ?? [0,100];
    rows = rows.filter(r => r.pct >= lo && r.pct <= hi);
  }
  _rows = rows;
}

async function fetchObservations() {
  const monIds = _allRows.map(r => r.id);
  if (!monIds.length) { _allObservations = []; return; }
  const { data, error } = await supabase
    .from('monitoring_observation')
    .select(`
      monitoring_id, content, eval_criteria_id,
      observation_type(code),
      eval_criteria(name),
      error:error_id(error_type:error_type_id(id, name))
    `)
    .in('monitoring_id', monIds);
  if (error) { console.error('[registros] obs:', error); _allObservations = []; return; }
  const RELEVANT = new Set(['excelled_by', 'improvable_by', 'failed_by']);
  _allObservations = (data ?? [])
    .filter(o => RELEVANT.has(o.observation_type?.code))
    .map(o => ({
      monId:         o.monitoring_id,
      typeCode:      o.observation_type.code,
      ecId:          o.eval_criteria_id,
      ecName:        o.eval_criteria?.name ?? null,
      errorTypeId:   o.error?.error_type?.id   ?? null,
      errorTypeName: o.error?.error_type?.name ?? null,
      content:       o.content,
    }));
}

/* ── Radar chart ──────────────────────────── */
function scopedEvalCriteria() {
  const sgIds = new Set(_teams.map(t => t.sector_group_id).filter(Boolean));
  if (!sgIds.size || !_sgEcMap.size) return _evalCriteria;
  const allowed = new Set();
  for (const sgId of sgIds) {
    for (const ecId of (_sgEcMap.get(sgId) ?? [])) allowed.add(ecId);
  }
  return _evalCriteria.filter(ec => allowed.has(ec.id));
}

function refreshRadarChart() {
  const criteria = scopedEvalCriteria();
  if (!criteria.length) return;
  const labels = criteria.map(ec => ec.name.split(' ')[0]);
  const sum = {};
  for (const row of _rows) {
    for (const [cid, { e, m }] of Object.entries(row.radarSum ?? {})) {
      if (!sum[cid]) sum[cid] = { e: 0, m: 0 };
      sum[cid].e += e;
      sum[cid].m += m;
    }
  }
  const data = criteria.map(ec => sum[ec.id]?.m > 0 ? Math.round(sum[ec.id].e / sum[ec.id].m * 100) : 0);
  renderRadarChart('reg-radar-chart', labels, [{ label: 'Média', data }]);
}

/* ── Observation stats ────────────────────── */
function computeObsStats() {
  const monIdSet = new Set(_rows.map(r => r.id));
  const obs = _allObservations.filter(o => monIdSet.has(o.monId));
  const result = {};
  for (const typeCode of ['excelled_by', 'improvable_by', 'failed_by']) {
    const isFailed = typeCode === 'failed_by';
    const groups = {};
    for (const o of obs.filter(o => o.typeCode === typeCode)) {
      const key  = isFailed ? o.errorTypeId  : o.ecId;
      const name = isFailed ? o.errorTypeName : o.ecName;
      if (!key || !name) continue;
      if (!groups[key]) groups[key] = { name, count: 0, items: [] };
      groups[key].count++;
      groups[key].items.push(o.content);
    }
    result[typeCode] = Object.values(groups)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(g => ({ name: g.name, count: g.count, samples: g.items.slice(0, 2) }));
  }
  return result;
}

function renderObsPanel() {
  const stats = computeObsStats();
  const TYPES = [
    { code: 'excelled_by',   label: 'Acertos',       color: 'var(--brand-green-dark)' },
    { code: 'improvable_by', label: 'Oportunidades',  color: '#2563eb'                  },
    { code: 'failed_by',     label: 'Erros',          color: 'var(--color-danger)'      },
  ];

  /* Build only non-empty sections first, then assign column breaks */
  const populated = TYPES.map(({ code, label, color }) => {
    const groups = stats[code] ?? [];
    if (!groups.length) return null;
    const groupsHtml = groups.map(g => `
      <div style="break-inside:avoid;margin-bottom:var(--space-3)">
        <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:3px">
          <span style="font-size:var(--text-xs);font-weight:700;color:${color}">${g.name}</span>
          <span style="font-size:10px;color:var(--text-tertiary)">${g.count}×</span>
        </div>
        ${g.samples.map(s => `
          <div style="font-size:var(--text-xs);color:var(--text-secondary);padding:2px var(--space-2);
                      border-left:2px solid ${color};margin-bottom:2px;line-height:1.4">${s}</div>
        `).join('')}
      </div>`).join('');
    return { label, color, groupsHtml };
  }).filter(Boolean);

  if (!populated.length) return `<div style="color:var(--text-tertiary);font-size:var(--text-sm)">Sem observações no período.</div>`;

  return populated.map(({ label, color, groupsHtml }, i) => `
    <div style="${i > 0 ? 'break-before:column;' : ''}margin-bottom:var(--space-4)">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
                  color:${color};margin-bottom:var(--space-2)">${label}</div>
      ${groupsHtml}
    </div>`).join('');
}

function refreshInsightsPanel() {
  refreshRadarChart();
  const obsEl = document.getElementById('reg-obs-panel');
  if (obsEl) obsEl.innerHTML = renderObsPanel();
}

/* ── render() ─────────────────────────────── */
export function render() {
  if (!_dataLoaded) {
    return `
      <div class="page-enter">
        <div class="page-header">
          <div class="page-title">Registros</div>
          <div class="page-subtitle">Histórico de monitorias realizadas</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;height:300px;gap:12px;color:var(--text-secondary)">
          <div class="boot-spinner" style="width:20px;height:20px;border-width:2px"></div>
          Carregando registros…
        </div>
      </div>`;
  }

  const canSup    = can(_currentUser, P.GLOBAL_VIEW_DEPT);
  const canDetail = can(_currentUser, P.RECORD_DETAIL);
  const cols      = canDetail ? 8 : 7;

  const collabOpts = `<option value="">Todos os colaboradores</option>` +
    _employees.map(e =>
      `<option value="${e.id}" ${e.id === _filters.collabId ? 'selected' : ''}>${e.name}</option>`
    ).join('');

  const supOpts = canSup
    ? `<option value="">Todos os supervisores</option>` +
      _teams.map(t =>
        `<option value="${t.id}" ${t.id === _filters.supId ? 'selected' : ''}>${t.name}</option>`
      ).join('')
    : '';

  return `
    <div class="page-enter">
      <div class="page-header">
        <div class="page-title">Registros</div>
        <div class="page-subtitle">Histórico de monitorias realizadas</div>
      </div>

      <div class="panel">
        <div class="table-filters">
          ${canSup ?
            `<select class="form-select" id="filter-sup" style="max-width:200px">${supOpts}</select>` :
            `<div class="form-group" style="margin-bottom:0">
              <div class="form-input" style="opacity:.75;cursor:default">
              ${_currentUser?.name ?? '—'}
              </div>
            </div>`}
          <select class="form-select" id="filter-collab" style="max-width:220px">${collabOpts}</select>
          ${calTriggerHtml('filter-date-trigger', _filters.dateFrom, _filters.dateTo)}
          <select class="form-select" id="filter-band" style="max-width:160px">
            <option value="">Todos os resultados</option>
            <option value="excellent">Excelente (≥95%)</option>
            <option value="good">Bom (70–94%)</option>
            <option value="regular">Regular (50–69%)</option>
            <option value="critical">Crítico (1–49%)</option>
            <option value="zero">Zerada (0%)</option>
          </select>
        </div>

        <!-- Insights row: radar + observation summary -->
        <div style="display:grid;grid-template-columns:230px 1fr;gap:var(--space-5);
                    padding:var(--space-4) var(--space-5);border-top:1px solid var(--border-light)">
          <div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
                        color:var(--text-secondary);margin-bottom:var(--space-2);text-align:center">
              Desempenho por Critério
            </div>
            <canvas id="reg-radar-chart" width="230" height="230"></canvas>
          </div>
          <div id="reg-obs-panel" style="overflow-y:auto;max-height:260px;
               column-count:3;column-gap:var(--space-5);column-fill:balance"></div>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Nº</th>
                <th>Colaborador</th>
                <th>Supervisor</th>
                <th>Pontuação</th>
                <th>CSAT</th>
                <th>Resultado</th>
                ${canDetail ? '<th></th>' : ''}
              </tr>
            </thead>
            <tbody id="records-tbody">${renderRows()}</tbody>
          </table>
        </div>

        <div class="table-pagination">
          <span class="pagination-info" id="pag-info">${paginationInfo()}</span>
          <div class="pagination-controls" id="pag-controls">${renderPagination()}</div>
        </div>
      </div>
    </div>

    <!-- Modal: Excluir monitoria -->
    <div id="delete-mon-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal" style="max-width:420px">
        <div class="modal__header">
          <div class="modal__title">Excluir monitoria?</div>
        </div>
        <div class="modal__body">
          <p id="delete-mon-msg" style="color:var(--text-secondary);font-size:var(--text-sm)"></p>
        </div>
        <div class="modal__footer" style="justify-content:flex-end">
          <button class="btn btn--ghost" id="delete-mon-cancel">Cancelar</button>
          <button class="btn" id="delete-mon-confirm"
                  style="background:var(--color-danger);color:#fff;border:none">
            Confirmar exclusão
          </button>
        </div>
      </div>
    </div>`;
}

/* ── Table helpers ────────────────────────── */
function paginationInfo() {
  const total = _rows.length;
  if (!total) return 'Nenhum registro encontrado';
  const start = (_page - 1) * PAGE_SIZE + 1;
  const end   = Math.min(_page * PAGE_SIZE, total);
  return `Exibindo ${start}–${end} de ${total}`;
}

function renderRows() {
  const canDetail = can(_currentUser, P.RECORD_DETAIL);
  const cols      = canDetail ? 8 : 7;
  const slice     = _rows.slice((_page - 1) * PAGE_SIZE, _page * PAGE_SIZE);
  if (!slice.length) {
    return `<tr><td colspan="${cols}" style="text-align:center;padding:var(--space-8);color:var(--text-tertiary)">Nenhum registro encontrado</td></tr>`;
  }
  return slice.map(r => {
    const scoreCell = r.total
      ? `<span style="font-weight:700;color:${scoreColor(r.pct)}">${r.score}</span><span style="color:var(--text-tertiary);font-size:var(--text-xs)">/${r.total}</span>`
      : '—';
    return `
      <tr data-mon="${r.id}" data-emp="${r.empId ?? ''}" class="clickable${r.zeroed ? ' row--zeroed' : ''}">
        <td>${formatDate(r.date)}</td>
        <td class="muted">${r.number ?? '—'}</td>
        <td><strong>${r.empName}</strong></td>
        <td class="muted">${r.supName}</td>
        <td><div class="score-cell">${scoreCell}</div></td>
        <td style="text-align:center">${r.avgCsat ? r.avgCsat + ' ★' : '—'}</td>
        <td><span class="badge badge--${r.band.cls}">${r.band.label}</span></td>
        ${canDetail ? `<td><button class="btn btn--ghost btn--sm detail-btn" data-mon="${r.id}" tabindex="-1">Ver</button></td>` : ''}
      </tr>`;
  }).join('');
}

function renderPagination() {
  const pages = Math.ceil(_rows.length / PAGE_SIZE);
  if (pages <= 1) return '';
  return Array.from({ length: Math.min(pages, 7) }, (_, i) => i + 1)
    .map(p => `<button class="page-btn ${p === _page ? 'active' : ''}" data-page="${p}">${p}</button>`)
    .join('');
}

function refreshTable() {
  document.getElementById('records-tbody').innerHTML = renderRows();
  document.getElementById('pag-info').textContent    = paginationInfo();
  document.getElementById('pag-controls').innerHTML  = renderPagination();
  _expandedId = null;
  bindTableEvents();
  refreshInsightsPanel();
}

/* ── Detail panel ─────────────────────────── */
async function fetchDetail(monId) {
  const { data, error } = await supabase
    .from('monitoring')
    .select(`
      id, date, number, zeroed, employee_id,
      service_chat(id, protocol, service_time, first_response_time, max_response_time, csat),
      topic_approval(obtained, topic:topic_id(id, item, points, eval_criteria_id)),
      monitoring_observation(
        id, content,
        observation_type(code),
        eval_criteria(name),
        service_chat(protocol)
      ),
      analytical_note(
        id, obtained, justification,
        analytical_note_type(name)
      )
    `)
    .eq('id', monId)
    .single();
  if (error) { console.error('[registros] detail:', error); return null; }
  return data;
}

function renderDetail(data, rowData) {
  const canEditObs = can(_currentUser, P.RECORD_EDITABLE_OBS);
  const monId      = data.id;

  /* Service chats */
  const scHtml = (data.service_chat ?? []).map(sc => `
    <tr>
      <td class="muted" style="font-family:var(--font-mono)">${sc.protocol ?? '—'}</td>
      <td>${sc.service_time ?? '—'}</td>
      <td>${sc.first_response_time ?? '—'}</td>
      <td>${sc.max_response_time ?? '—'}</td>
      <td style="text-align:center">${sc.csat ? sc.csat + ' ★' : '—'}</td>
    </tr>`).join('') ||
    `<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:var(--space-3)">—</td></tr>`;

  /* Topics by eval_criteria */
  const byCategory = {};
  for (const ta of (data.topic_approval ?? [])) {
    if (!ta.topic) continue;
    const cid = ta.topic.eval_criteria_id;
    if (!byCategory[cid]) byCategory[cid] = [];
    byCategory[cid].push(ta);
  }
  const topicsHtml = _evalCriteria.map(ec => {
    const items = byCategory[ec.id];
    if (!items?.length) return '';
    return `
      <div style="margin-bottom:var(--space-3)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary);margin-bottom:var(--space-1)">${ec.name}</div>
        ${items.map(ta => {
          const obt = ta.obtained;
          const pts = ta.topic.points;
          const checkSpan = canEditObs
            ? `<span class="ro-topic-toggle"
                    data-topic-id="${ta.topic.id}"
                    data-obtained-orig="${obt ? '1' : '0'}"
                    data-points="${pts}"
                    style="color:${obt ? 'var(--brand-green-dark)' : 'var(--color-danger)'};font-weight:700;cursor:pointer;user-select:none"
                    title="Clique para alterar">${obt ? '✓' : '✗'}</span>`
            : `<span style="color:${obt ? 'var(--brand-green-dark)' : 'var(--color-danger)'};font-weight:700">${obt ? '✓' : '✗'}</span>`;
          const ptsSpan = canEditObs
            ? `<span id="ro-topic-pts-${monId}-${ta.topic.id}" style="margin-left:auto;color:var(--text-tertiary);font-family:var(--font-mono)">${obt ? pts : 0}/${pts}</span>`
            : `<span style="margin-left:auto;color:var(--text-tertiary);font-family:var(--font-mono)">${obt ? pts : 0}/${pts}</span>`;
          return `
          <div style="display:flex;align-items:center;gap:var(--space-2);padding:3px 0;font-size:var(--text-xs)">
            ${checkSpan}
            <span style="color:${obt ? 'var(--text-primary)' : 'var(--text-secondary)'}">${ta.topic.item}</span>
            ${ptsSpan}
          </div>`;
        }).join('')}
      </div>`;
  }).join('') || `<div style="color:var(--text-tertiary);font-size:var(--text-xs)">—</div>`;

  /* Analytical notes */
  const analyticalHtml = (data.analytical_note ?? []).map(n => `
    <div style="display:flex;align-items:flex-start;gap:var(--space-2);padding:3px 0;font-size:var(--text-xs)">
      <span style="color:${n.obtained ? 'var(--brand-green-dark)' : 'var(--color-danger)'};font-weight:700;flex-shrink:0">${n.obtained ? '✓' : '✗'}</span>
      <div>
        <span>${n.analytical_note_type?.name ?? '—'}</span>
        ${n.justification ? `<div style="color:var(--text-tertiary);margin-top:1px">${n.justification}</div>` : ''}
      </div>
    </div>`).join('');

  /* Observations */
  const OBS = {
    default:       { label: 'Geral',        color: 'var(--text-secondary)' },
    improvable_by: { label: 'Oportunidade', color: '#2563eb' },
    excelled_by:   { label: 'Acerto',       color: 'var(--brand-green-dark)' },
    failed_by:     { label: 'Erro',         color: 'var(--color-danger)' },
  };
  const obsHtml = (data.monitoring_observation ?? []).map(o => {
    const t = OBS[o.observation_type?.code] ?? OBS.default;
    return `
      <div style="padding:var(--space-2) 0;border-bottom:1px solid var(--border-light);font-size:var(--text-xs)">
        <div style="display:flex;gap:var(--space-2);align-items:center;margin-bottom:2px">
          <span style="font-weight:700;color:${t.color}">${t.label}</span>
          ${o.eval_criteria?.name ? `<span style="color:var(--text-tertiary)">· ${o.eval_criteria.name}</span>` : ''}
          ${o.service_chat?.protocol ? `<span style="color:var(--text-tertiary);font-family:var(--font-mono)">· ${o.service_chat.protocol}</span>` : ''}
        </div>
        <div>${o.content}</div>
      </div>`;
  }).join('') || `<div data-obs-empty style="color:var(--text-tertiary);font-size:var(--text-xs)">Nenhuma observação</div>`;

  return `
    <div style="background:var(--bg-surface-2);border-top:2px solid var(--brand-green)">
      ${canEditObs ? `
        <div id="ro-topic-pending-bar-${monId}"
             style="display:none;align-items:center;justify-content:space-between;
                    padding:var(--space-2) var(--space-5);
                    border-bottom:1px solid var(--border);background:rgba(245,158,11,.08)">
          <span style="font-size:var(--text-xs);color:var(--text-secondary)">Tópicos com alterações pendentes</span>
          <div style="display:flex;gap:var(--space-2)">
            <button class="btn btn--ghost btn--sm" id="ro-topic-discard-${monId}" type="button">Descartar</button>
            <button class="btn btn--primary btn--sm" id="ro-topic-confirm-${monId}" type="button">Confirmar</button>
          </div>
        </div>` : ''}
      ${can(_currentUser, P.RECORD_DELETE) ? `
        <div style="display:flex;justify-content:flex-end;gap:var(--space-2);
                    padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--border-light)">
          <button class="btn btn--sm delete-monitoring-btn"
                  data-mon="${data.id}"
                  data-number="${rowData?.number ?? data.number ?? '—'}"
                  data-emp="${rowData?.empName ?? '—'}"
                  style="background:var(--color-danger-bg);color:var(--color-danger);border:1px solid var(--color-danger)"
                  title="Excluir monitoria">
            🗑
          </button>
        </div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-5);
                padding:var(--space-4) var(--space-5)">
      <div>
        <div class="detail-section-label">Tópicos Avaliados</div>
        ${topicsHtml}
        ${analyticalHtml ? `
          <div class="detail-section-label" style="margin-top:var(--space-3)">Critérios Analíticos</div>
          ${analyticalHtml}` : ''}
      </div>
      <div>
        <div class="${can(_currentUser, P.RECORD_EDITABLE_OBS) ? 'detail-section-label editable' : 'detail-section-label'}">Atendimentos</div>
        <table class="data-table" style="margin-bottom:var(--space-2);font-size:var(--text-xs)">
          <thead><tr><th>Protocolo</th><th>TMA</th><th>TMPr</th><th>TMEr</th><th>CSAT</th></tr></thead>
          <tbody id="ro-sc-tbody-${data.id}">${scHtml}</tbody>
        </table>
        ${can(_currentUser, P.RECORD_EDITABLE_OBS) ? `
          <div style="display:flex;justify-content:flex-end;margin-bottom:var(--space-3)">
            <button class="btn btn--secondary btn--sm" id="ro-add-sc-btn-${data.id}">+ Adicionar Atendimento</button>
          </div>` : ''}
        ${can(_currentUser, P.RECORD_EDITABLE_OBS) ? buildEditObsPanel(data.id, data.service_chat ?? []) : ''}
        <div class="detail-section-label">Observações</div>
        <div id="ro-obs-list-${data.id}">${obsHtml}</div>
      </div>
    </div>
    </div>`;
}

async function toggleDetail(monId, btn) {
  const existing = document.getElementById(`detail-row-${monId}`);
  if (existing) {
    existing.remove();
    document.getElementById('ro-sc-modal')?.remove();
    delete _pendingTopicChanges[monId];
    btn.textContent = 'Ver';
    _expandedId = null;
    return;
  }

  if (_expandedId) {
    document.getElementById(`detail-row-${_expandedId}`)?.remove();
    document.querySelector(`.detail-btn[data-mon="${_expandedId}"]`).textContent = 'Ver';
  }

  btn.textContent = '…';
  btn.disabled    = true;
  _expandedId     = monId;

  const data = await fetchDetail(monId);
  const row  = document.querySelector(`tr[data-mon="${monId}"]`);

  if (!row || !data) {
    btn.textContent = 'Ver';
    btn.disabled    = false;
    _expandedId     = null;
    return;
  }

  const cols     = can(_currentUser, P.RECORD_DETAIL) ? 8 : 7;
  const detailTr = document.createElement('tr');
  detailTr.id    = `detail-row-${monId}`;
  const rowData  = _rows.find(r => r.id === monId);
  detailTr.innerHTML = `<td colspan="${cols}" style="padding:0">${renderDetail(data, rowData)}</td>`;
  row.after(detailTr);

  /* Bind topic toggles */
  if (can(_currentUser, P.RECORD_EDITABLE_OBS)) {
    bindTopicToggles(monId, detailTr);
  }

  /* Bind editable obs + SC for users with permission */
  if (can(_currentUser, P.RECORD_EDITABLE_OBS)) {
    loadEditableRefData().then(ref => {
      const critSel = document.getElementById(`ro-obs-criteria-${monId}`);
      if (critSel) {
        critSel.innerHTML = `<option value="">— nenhum —</option>` +
          ref.evalCriteria.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      }
      const errSel = document.getElementById(`ro-obs-error-type-${monId}`);
      if (errSel) {
        errSel.innerHTML = `<option value="">— selecione —</option>` +
          ref.errorTypes.filter(e => !e.critical)
            .map(e => `<option value="${e.id}">${e.name}</option>`).join('');
      }
      document.getElementById(`ro-obs-type-${monId}`)?.addEventListener('change', e => {
        const errField = document.getElementById(`ro-obs-error-field-${monId}`);
        if (errField) errField.style.display = e.target.value === 'E' ? '' : 'none';
      });
      document.getElementById(`ro-obs-save-${monId}`)?.addEventListener('click', () =>
        saveNewObservation(monId, ref)
      );
    });
    document.getElementById(`ro-add-sc-btn-${monId}`)?.addEventListener('click', () =>
      openAddScModal(monId, data.employee_id)
    );
  }

  /* Bind do botão de exclusão criado dinamicamente */
  detailTr.querySelector('.delete-monitoring-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    _pendingDelete = {
      id:      e.currentTarget.dataset.mon,
      number:  e.currentTarget.dataset.number,
      empName: e.currentTarget.dataset.emp,
    };
    const msg = document.getElementById('delete-mon-msg');
    if (msg) msg.innerHTML =
      `Deseja excluir a monitoria <strong>Nº ${_pendingDelete.number}</strong> de <strong>${_pendingDelete.empName}</strong>?<br>
       <span style="font-size:var(--text-xs);color:var(--text-tertiary)">Esta ação é irreversível.</span>`;
    const modal = document.getElementById('delete-mon-modal');
    modal?.classList.remove('modal-overlay--hidden');
    const confirmBtn = document.getElementById('delete-mon-confirm');
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirmar exclusão'; }
  });

  btn.textContent = 'Fechar';
  btn.disabled    = false;
}

/* ── Topic toggle ─────────────────────────── */
function bindTopicToggles(monId, detailTr) {
  if (!_pendingTopicChanges[monId]) _pendingTopicChanges[monId] = {};
  const pending = _pendingTopicChanges[monId];

  detailTr.querySelectorAll('.ro-topic-toggle').forEach(span => {
    span.addEventListener('click', () => {
      const topicId = span.dataset.topicId;
      const origObt = span.dataset.obtainedOrig === '1';
      const pts     = Number(span.dataset.points);
      const curObt  = topicId in pending ? pending[topicId].newObtained : origObt;
      const newObt  = !curObt;

      if (newObt === origObt) {
        delete pending[topicId];
      } else {
        pending[topicId] = { newObtained: newObt, points: pts };
      }

      const color = newObt ? 'var(--brand-green-dark)' : 'var(--color-danger)';
      span.textContent  = newObt ? '✓' : '✗';
      span.style.color  = color;
      span.style.outline = newObt !== origObt ? '2px solid var(--color-warning)' : '';
      const itemSpan = span.nextElementSibling;
      if (itemSpan) itemSpan.style.color = newObt ? 'var(--text-primary)' : 'var(--text-secondary)';
      const ptsEl = document.getElementById(`ro-topic-pts-${monId}-${topicId}`);
      if (ptsEl) ptsEl.textContent = `${newObt ? pts : 0}/${pts}`;

      const bar = document.getElementById(`ro-topic-pending-bar-${monId}`);
      if (bar) bar.style.display = Object.keys(pending).length ? 'flex' : 'none';
    });
  });

  document.getElementById(`ro-topic-confirm-${monId}`)?.addEventListener('click', () =>
    confirmTopicChanges(monId, detailTr));
  document.getElementById(`ro-topic-discard-${monId}`)?.addEventListener('click', () =>
    discardTopicChanges(monId, detailTr));
}

async function confirmTopicChanges(monId, detailTr) {
  const pending = _pendingTopicChanges[monId] ?? {};
  if (!Object.keys(pending).length) return;
  const btn = document.getElementById(`ro-topic-confirm-${monId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  try {
    /* Snapshot original states before mutating */
    const origStates = {};
    detailTr.querySelectorAll('.ro-topic-toggle').forEach(s => {
      origStates[s.dataset.topicId] = s.dataset.obtainedOrig === '1';
    });

    for (const [topicId, { newObtained }] of Object.entries(pending)) {
      const { error } = await supabase
        .from('topic_approval')
        .update({ obtained: newObtained })
        .eq('monitoring_id', monId)
        .eq('topic_id', topicId);
      if (error) throw error;
    }

    /* Recalculate score + radarSum from all spans */
    let earned = 0, total = 0;
    const newRadarSum = {};
    detailTr.querySelectorAll('.ro-topic-toggle').forEach(s => {
      const tid  = s.dataset.topicId;
      const pts  = Number(s.dataset.points);
      const obt  = tid in pending ? pending[tid].newObtained : origStates[tid];
      const t    = _topicMap[tid];
      total += pts;
      if (obt) earned += pts;
      if (t) {
        const cid = t.eval_criteria_id;
        if (!newRadarSum[cid]) newRadarSum[cid] = { e: 0, m: 0 };
        newRadarSum[cid].m += pts;
        if (obt) newRadarSum[cid].e += pts;
      }
    });
    const pct = total > 0 ? Math.round(earned / total * 100) : 0;

    const rowIdx = _allRows.findIndex(r => r.id === monId);
    if (rowIdx !== -1) {
      _allRows[rowIdx] = { ..._allRows[rowIdx], score: earned, total, pct,
                           band: resultBand(pct), radarSum: newRadarSum };
    }
    applyClientFilters();

    /* Patch table row in-place */
    const tableRow = document.querySelector(`tr[data-mon="${monId}"]`);
    if (tableRow && total) {
      const sc = tableRow.querySelector('.score-cell');
      if (sc) sc.innerHTML = `<span style="font-weight:700;color:${scoreColor(pct)}">${earned}</span><span style="color:var(--text-tertiary);font-size:var(--text-xs)">/${total}</span>`;
      const badge = tableRow.querySelector('.badge');
      if (badge) {
        const b = resultBand(pct);
        badge.className   = `badge badge--${b.cls}`;
        badge.textContent = b.label;
      }
    }

    /* Update orig states on spans & clear pending indicators */
    detailTr.querySelectorAll('.ro-topic-toggle').forEach(s => {
      if (s.dataset.topicId in pending) {
        s.dataset.obtainedOrig = pending[s.dataset.topicId].newObtained ? '1' : '0';
        s.style.outline = '';
      }
    });

    delete _pendingTopicChanges[monId];
    const bar = document.getElementById(`ro-topic-pending-bar-${monId}`);
    if (bar) bar.style.display = 'none';

    refreshInsightsPanel();
    toast.success('Tópicos atualizados');
  } catch (err) {
    console.error('[registros] topic update:', err);
    toast.error('Erro ao salvar', err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar'; }
  }
}

function discardTopicChanges(monId, detailTr) {
  const pending = _pendingTopicChanges[monId] ?? {};
  detailTr.querySelectorAll('.ro-topic-toggle').forEach(s => {
    const tid  = s.dataset.topicId;
    if (!(tid in pending)) return;
    const obt = s.dataset.obtainedOrig === '1';
    const pts = Number(s.dataset.points);
    s.textContent  = obt ? '✓' : '✗';
    s.style.color  = obt ? 'var(--brand-green-dark)' : 'var(--color-danger)';
    s.style.outline = '';
    const itemSpan = s.nextElementSibling;
    if (itemSpan) itemSpan.style.color = obt ? 'var(--text-primary)' : 'var(--text-secondary)';
    const ptsEl = document.getElementById(`ro-topic-pts-${monId}-${tid}`);
    if (ptsEl) ptsEl.textContent = `${obt ? pts : 0}/${pts}`;
  });
  delete _pendingTopicChanges[monId];
  const bar = document.getElementById(`ro-topic-pending-bar-${monId}`);
  if (bar) bar.style.display = 'none';
}

/* ── Delete monitoring ────────────────────── */
async function deleteMonitoring(monId) {
  const confirmBtn = document.getElementById('delete-mon-confirm');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Excluindo…'; }

  try {
    /* Coleta error_ids antes do cascade apagar monitoring_observation */
    const { data: obsRows } = await supabase
      .from('monitoring_observation')
      .select('error_id')
      .eq('monitoring_id', monId)
      .not('error_id', 'is', null);

    /* Exclui monitoring — cascade: topic_approval, analytical_note,
       service_chat → monitoring_observation */
    const { error } = await supabase.from('monitoring').delete().eq('id', monId);
    if (error) throw error;

    /* Limpa orphaned errors */
    const errorIds = (obsRows ?? []).map(r => r.error_id).filter(Boolean);
    if (errorIds.length) await supabase.from('error').delete().in('id', errorIds);

    /* Remove da lista local e atualiza tabela */
    _allRows = _allRows.filter(r => r.id !== monId);
    applyClientFilters();
    document.getElementById('delete-mon-modal')?.classList.add('modal-overlay--hidden');
    _pendingDelete = null;
    _expandedId = null;
    _page = Math.min(_page, Math.ceil(_rows.length / PAGE_SIZE)) || 1;
    refreshTable();
  } catch (err) {
    console.error('[registros] delete:', err);
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirmar exclusão'; }
  }
}

/* ── Event binding ─────────────────────────── */
function bindTableEvents() {
  document.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => { _page = +btn.dataset.page; refreshTable(); });
  });

  document.querySelectorAll('.detail-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await toggleDetail(btn.dataset.mon, btn);
    });
  });

  document.querySelectorAll('tr[data-emp]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.detail-btn, .delete-monitoring-btn')) return;
      if (row.dataset.emp) navigate('perfil', { id: row.dataset.emp });
    });
  });
}

function bindFilters() {
  document.getElementById('filter-collab')?.addEventListener('change', e => {
    _filters.collabId = e.target.value;
    applyClientFilters();
    _page = 1;
    refreshTable();
  });
  document.getElementById('filter-sup')?.addEventListener('change', e => {
    _filters.supId = e.target.value;
    applyClientFilters();
    _page = 1;
    refreshTable();
  });
  document.getElementById('filter-band')?.addEventListener('change', e => {
    _filters.band = e.target.value;
    applyClientFilters();
    _page = 1;
    refreshTable();
  });
  _calPicker?.destroy();
  _calPicker = new CalPicker({
    triggerEl: document.getElementById('filter-date-trigger'),
    from: _filters.dateFrom,
    to:   _filters.dateTo,
    onApply: async (from, to) => {
      _filters.dateFrom = from;
      _filters.dateTo   = to;
      await fetchMonitorings();
      await fetchObservations();
      _page = 1;
      refreshTable();
    },
    onClear: async () => {
      _filters.dateFrom = '';
      _filters.dateTo   = '';
      await fetchMonitorings();
      await fetchObservations();
      _page = 1;
      refreshTable();
    },
  });

  /* Modal de exclusão — vinculado uma vez, persiste entre refreshes */
  document.getElementById('delete-mon-cancel')?.addEventListener('click', () => {
    document.getElementById('delete-mon-modal')?.classList.add('modal-overlay--hidden');
    _pendingDelete = null;
  });
  document.getElementById('delete-mon-confirm')?.addEventListener('click', () => {
    if (_pendingDelete) deleteMonitoring(_pendingDelete.id);
  });
}

/* ── Editable obs helpers ─────────────────── */
async function loadEditableRefData() {
  if (_editableRefData) return _editableRefData;
  const [obsTypeRes, evalCrRes, errTypeRes] = await Promise.all([
    supabase.from('observation_type').select('id, code').eq('active', true),
    supabase.from('eval_criteria').select('id, name').eq('active', true).order('name'),
    supabase.from('error_type').select('id, name, critical').eq('active', true).order('name'),
  ]);
  const codeToKey = { default: 'G', improvable_by: 'O', excelled_by: 'A', failed_by: 'E' };
  const obsTypeMap = {};
  for (const row of (obsTypeRes.data ?? [])) {
    const key = codeToKey[row.code];
    if (key) obsTypeMap[key] = row.id;
  }
  _editableRefData = {
    obsTypeMap,
    evalCriteria: evalCrRes.data ?? [],
    errorTypes:   errTypeRes.data ?? [],
  };
  return _editableRefData;
}

function buildEditObsPanel(monId, serviceChats) {
  const scOpts = serviceChats
    .map(sc => `<option value="${sc.id}">${sc.protocol}</option>`)
    .join('');
  return `
    <div style="margin-top:var(--space-4)" id="ro-edit-obs-${monId}">
      <div class="${can(_currentUser, P.RECORD_EDITABLE_OBS) ? 'detail-section-label editable' : 'detail-section-label'}">Nova Observação</div>
      <div class="obs-add-form">
        <div class="obs-add-form__row">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Protocolo <span class="required">*</span></label>
            <select class="form-select" id="ro-obs-proto-${monId}">
              <option value="">— selecione —</option>
              ${scOpts}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Tipo <span class="required">*</span></label>
            <select class="form-select" id="ro-obs-type-${monId}">
              <option value="G">Genérico</option>
              <option value="O">Oportunidade</option>
              <option value="A">Acerto</option>
              <option value="E">Erro</option>
            </select>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Critério (opcional)</label>
          <select class="form-select" id="ro-obs-criteria-${monId}">
            <option value="">— nenhum —</option>
          </select>
        </div>
        <div class="form-group" id="ro-obs-error-field-${monId}" style="margin-bottom:0;display:none">
          <label class="form-label" style="color:var(--color-danger)">Tipo do Erro</label>
          <select class="form-select" id="ro-obs-error-type-${monId}">
            <option value="">— selecione —</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Observação <span class="required">*</span></label>
          <textarea class="form-input" id="ro-obs-text-${monId}" rows="2"
            style="resize:none;font-family:var(--font-sans)"
            placeholder="Descreva a observação…"></textarea>
        </div>
        <button class="btn btn--primary btn--sm" style="width:100%" id="ro-obs-save-${monId}">
          + Adicionar Observação
        </button>
      </div>
    </div>`;
}

function syncObsProtoDropdown(monId, sc) {
  const sel = document.getElementById(`ro-obs-proto-${monId}`);
  if (!sel) return;
  const opt = document.createElement('option');
  opt.value = sc.id;
  opt.textContent = sc.protocol;
  sel.appendChild(opt);
}

function openAddScModal(monId, empId) {
  document.getElementById('ro-sc-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'ro-sc-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal modal--lg" id="ro-sc-modal-content">
      <div class="modal__header">
        <div class="modal__title">Adicionar Atendimento</div>
        <button class="modal__close" id="ro-sc-close">✕</button>
      </div>
      <div class="modal__body">
        <div class="attendance-grid">
          <div class="attendance-field">
            <div class="attendance-field__label">ID / Protocolo <span class="required">*</span></div>
            <input class="attendance-field__input" id="ro-att-id" placeholder="ex: 123456">
          </div>
          <div class="attendance-field">
            <div class="attendance-field__label">Data e hora do início <span class="required">*</span></div>
            <input class="attendance-field__input" id="ro-att-date" type="datetime-local">
          </div>
          <div class="attendance-field">
            <div class="attendance-field__label">Tempo de primeira resposta</div>
            <input class="attendance-field__input" id="ro-att-tmpr" type="time" step="1">
          </div>
          <div class="attendance-field">
            <div class="attendance-field__label">Tempo máx. entre respostas</div>
            <input class="attendance-field__input" id="ro-att-tmer" type="time" step="1">
          </div>
          <div class="attendance-field">
            <div class="attendance-field__label">Tempo de atendimento <span class="required">*</span></div>
            <input class="attendance-field__input" id="ro-att-tma" type="time" step="1">
          </div>
          <div class="attendance-field">
            <div class="attendance-field__label">Avaliação CSAT</div>
            <div class="csat-group">
              ${[1,2,3,4,5].map(v => `
                <label class="csat-option csat-option--${v}">
                  <input type="radio" name="ro-csat" value="${v}">
                  <span class="csat-label">${v}</span>
                </label>`).join('')}
            </div>
          </div>
        </div>
      </div>
      <div class="modal__footer">
        <button class="btn btn--ghost" id="ro-sc-cancel">Cancelar</button>
        <button class="btn btn--primary" id="ro-sc-save">Adicionar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('ro-sc-close')?.addEventListener('click', close);
  document.getElementById('ro-sc-cancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.getElementById('ro-sc-save')?.addEventListener('click', () =>
    saveNewServiceChat(monId, empId, close)
  );
}

function normalizeTimeVal(val) {
  if (!val) return null;
  const parts = val.split(':');
  if (parts.length === 2) return `${parts[0].padStart(2,'0')}:${parts[1].padStart(2,'0')}:00`;
  return parts.map(p => p.padStart(2,'0')).join(':');
}

async function saveNewServiceChat(monId, empId, closeModal) {
  const protocol  = document.getElementById('ro-att-id')?.value.trim();
  const startedAt = document.getElementById('ro-att-date')?.value;
  const tma       = document.getElementById('ro-att-tma')?.value;

  if (!protocol)  { toast.warning('Atenção', 'Informe o protocolo.'); return; }
  if (!startedAt) { toast.warning('Atenção', 'Informe a data e hora.'); return; }
  if (!tma)       { toast.warning('Atenção', 'Informe o tempo de atendimento.'); return; }

  const tmpr = document.getElementById('ro-att-tmpr')?.value || null;
  const tmer = document.getElementById('ro-att-tmer')?.value || null;
  const csatChecked = document.querySelector('input[name="ro-csat"]:checked');
  const csat = csatChecked ? Number(csatChecked.value) : null;

  const { data: emp } = await supabase.from('employees').select('sector_id').eq('id', empId).single();
  const started = startedAt.length === 16 ? `${startedAt}:00` : startedAt;

  const btn = document.getElementById('ro-sc-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Adicionando…'; }

  const { data: sc, error } = await supabase.from('service_chat').insert({
    protocol,
    employee_id:         empId,
    support_type:        emp?.sector_id ?? null,
    started_at:          started,
    service_time:        normalizeTimeVal(tma),
    first_response_time: normalizeTimeVal(tmpr),
    max_response_time:   normalizeTimeVal(tmer),
    csat,
    monitoring_id:       monId,
  }).select('id').single();

  if (error) {
    if (btn) { btn.disabled = false; btn.textContent = 'Adicionar'; }
    if (error.code === '23505') toast.warning('Atenção', `Protocolo duplicado: ${protocol}`);
    else toast.error('Erro ao adicionar atendimento', error.message);
    return;
  }

  /* Update the atendimentos table body in the expanded row */
  const tbody = document.getElementById(`ro-sc-tbody-${monId}`);
  if (tbody) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="muted" style="font-family:var(--font-mono)">${protocol}</td>
      <td>${normalizeTimeVal(tma) ?? '—'}</td>
      <td>${normalizeTimeVal(tmpr) ?? '—'}</td>
      <td>${normalizeTimeVal(tmer) ?? '—'}</td>
      <td style="text-align:center">${csat ? csat + ' ★' : '—'}</td>`;
    tbody.appendChild(tr);
  }

  syncObsProtoDropdown(monId, { id: sc.id, protocol });
  closeModal();
  toast.success('Atendimento adicionado');
}

async function saveNewObservation(monId, ref) {
  const scId = document.getElementById(`ro-obs-proto-${monId}`)?.value;
  if (!scId) { toast.warning('Atenção', 'Selecione o protocolo.'); return; }

  const text = document.getElementById(`ro-obs-text-${monId}`)?.value.trim();
  if (!text) { toast.warning('Atenção', 'Preencha a observação.'); return; }

  const typeCode  = document.getElementById(`ro-obs-type-${monId}`)?.value ?? 'G';
  const typeId    = ref.obsTypeMap[typeCode] ?? null;
  const criteriaEl = document.getElementById(`ro-obs-criteria-${monId}`);
  const criteriaId = criteriaEl?.value || null;

  let errorId = null;
  if (typeCode === 'E') {
    const errEl = document.getElementById(`ro-obs-error-type-${monId}`);
    if (!errEl?.value) { toast.warning('Atenção', 'Selecione o tipo de erro.'); return; }
    errorId = crypto.randomUUID();
    const { error: errErr } = await supabase.from('error')
      .insert({ id: errorId, error_type_id: errEl.value });
    if (errErr) { toast.error('Erro', errErr.message); return; }
  }

  const btn = document.getElementById(`ro-obs-save-${monId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Adicionando…'; }

  const { error } = await supabase.from('monitoring_observation').insert({
    monitoring_id:       monId,
    service_chat_id:     scId,
    observation_type_id: typeId,
    eval_criteria_id:    criteriaId,
    error_id:            errorId,
    author_id:           _currentUser.id,
    content:             text,
  });

  if (btn) { btn.disabled = false; btn.textContent = '+ Adicionar Observação'; }
  if (error) { toast.error('Erro', error.message); return; }

  document.getElementById(`ro-obs-text-${monId}`).value = '';
  document.getElementById(`ro-obs-type-${monId}`).value = 'G';
  document.getElementById(`ro-obs-error-field-${monId}`).style.display = 'none';

  /* Append new bubble to the list without a full re-render */
  const obsContainer = document.getElementById(`ro-obs-list-${monId}`);
  if (obsContainer) {
    obsContainer.querySelector('[data-obs-empty]')?.remove();

    const OBS_INFO = {
      G: { label: 'Geral',        color: 'var(--text-secondary)' },
      O: { label: 'Oportunidade', color: '#2563eb' },
      A: { label: 'Acerto',       color: 'var(--brand-green-dark)' },
      E: { label: 'Erro',         color: 'var(--color-danger)' },
    };
    const t = OBS_INFO[typeCode] ?? OBS_INFO.G;

    const protoSel    = document.getElementById(`ro-obs-proto-${monId}`);
    const protoText   = protoSel?.options[protoSel.selectedIndex]?.text ?? '';
    const criteriaText = criteriaEl?.value
      ? (criteriaEl.options[criteriaEl.selectedIndex]?.text ?? '') : '';

    const bubble = document.createElement('div');
    bubble.style.cssText = 'padding:var(--space-2) 0;border-bottom:1px solid var(--border-light);font-size:var(--text-xs)';
    bubble.innerHTML = `
      <div style="display:flex;gap:var(--space-2);align-items:center;margin-bottom:2px">
        <span style="font-weight:700;color:${t.color}">${t.label}</span>
        ${criteriaText ? `<span style="color:var(--text-tertiary)">· ${criteriaText}</span>` : ''}
        ${protoText    ? `<span style="color:var(--text-tertiary);font-family:var(--font-mono)">· ${protoText}</span>` : ''}
      </div>
      <div>${text}</div>`;
    bubble.animate(
      [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 200, easing: 'ease', fill: 'forwards' }
    );
    obsContainer.appendChild(bubble);
  }

  toast.success('Observação adicionada');
}

/* ── init ─────────────────────────────────── */
export async function init() {
  _currentUser = getCurrentUser();
  _dataLoaded  = false;
  _expandedId  = null;
  _page        = 1;

  _filters.supId    = '';
  _filters.dateFrom = '';
  _filters.dateTo   = '';

  const main = document.getElementById('main-content');
  if (main) main.innerHTML = render(); // mostra spinner imediatamente

  await fetchRefData();
  await fetchMonitorings();
  await fetchObservations();
  _dataLoaded = true;

  if (!main) return;
  main.innerHTML = render();
  bindFilters();
  bindTableEvents();
  refreshInsightsPanel();
}
