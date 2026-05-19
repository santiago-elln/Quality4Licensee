/* ============================================================
   REGISTROS — Histórico de monitorias
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { supabase } from '../supabase.js';
import { navigate } from '../router.js';
import {
  formatDate, resultBand, scoreColor, scoreColorHex, getInitials,
} from '../utils/formatters.js';

const PAGE_SIZE = 20;

/* ── Module state ─────────────────────────── */
let _page         = 1;
let _allRows      = [];   // rows from last DB fetch (date-filtered)
let _rows         = [];   // after client-side collab/sup/band filters
let _employees    = [];   // [{id, name, supervisor_id}]
let _supervisors  = [];   // [{id, name}]
let _topicMap     = {};   // {topicId: {eval_criteria_id, points, item}}
let _evalCriteria = [];   // [{id, name}]
let _refDataLoaded = false;
let _dataLoaded   = false;
let _expandedId   = null;
let _pendingDelete = null;  // {id, number, empName}
let _filters      = { collabId: '', supId: '', dateFrom: '', dateTo: '', band: '' };

/* ── Role helpers ─────────────────────────── */
function isAnalista() {
  const u = getCurrentUser();
  return u?.role === 'analista' || (u?.accessLevel ?? 0) >= 4;
}
function canFilterSupervisors() {
  const u = getCurrentUser();
  return u?.role === 'analista' || u?.role === 'gestor' || (u?.accessLevel ?? 0) >= 3;
}

/* ── Row processor ────────────────────────── */
function processRow(mon) {
  let score = 0, total = 0;
  for (const ta of (mon.topic_approval ?? [])) {
    const t = _topicMap[ta.topic_id];
    if (!t) continue;
    total += t.points;
    if (ta.obtained) score += t.points;
  }
  const pct = total > 0 ? Math.round(score / total * 100) : 0;

  const csats = (mon.service_chat ?? []).filter(sc => sc.csat).map(sc => sc.csat);
  const avgCsat = csats.length
    ? Math.round(csats.reduce((a, b) => a + b, 0) / csats.length * 10) / 10
    : null;

  const emp = _employees.find(e => e.id === mon.employee_id);
  const sup = _supervisors.find(s => s.id === emp?.supervisor_id);

  return {
    id:      mon.id,
    date:    mon.date,
    number:  mon.number,
    zeroed:  mon.zeroed,
    empId:   emp?.id   ?? null,
    empName: emp?.name ?? '—',
    supName: sup?.name ?? '—',
    supId:   emp?.supervisor_id ?? null,
    score, total, pct, avgCsat,
    band: resultBand(pct),
  };
}

/* ── Data fetch ───────────────────────────── */
async function fetchRefData() {
  if (_refDataLoaded) return;
  const [empRes, supRes, topicRes, ecRes] = await Promise.all([
    supabase.from('employees').select('id, name, supervisor_id').eq('active', true),
    supabase.from('profiles').select('id, name').eq('role', 'supervisor'),
    supabase.from('topic').select('id, eval_criteria_id, points, item').eq('active', true),
    supabase.from('eval_criteria').select('id, name').eq('active', true),
  ]);
  _employees    = empRes.data   ?? [];
  _supervisors  = supRes.data   ?? [];
  _topicMap     = Object.fromEntries((topicRes.data ?? []).map(t => [t.id, t]));
  _evalCriteria = ecRes.data    ?? [];
  _refDataLoaded = true;
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

  const canSup  = canFilterSupervisors();
  const analyst = isAnalista();
  const cols    = analyst ? 8 : 7;

  const collabOpts = `<option value="">Todos os colaboradores</option>` +
    _employees.map(e =>
      `<option value="${e.id}" ${e.id === _filters.collabId ? 'selected' : ''}>${e.name}</option>`
    ).join('');

  const supOpts = canSup
    ? `<option value="">Todos os supervisores</option>` +
      _supervisors.map(s =>
        `<option value="${s.id}" ${s.id === _filters.supId ? 'selected' : ''}>${s.name}</option>`
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
              <label class="form-label">Supervisor</label>
              <div class="form-input" style="opacity:.75;cursor:default">
              ${getCurrentUser().name ?? '—'}
              </div>
            </div>`}
          <select class="form-select" id="filter-collab" style="max-width:220px">${collabOpts}</select>
          <div style="display:flex;gap:var(--space-2);align-items:center">
            <input class="form-input" type="date" id="filter-from" value="${_filters.dateFrom}" style="width:150px">
            <span style="color:var(--text-tertiary);font-size:var(--text-xs)">até</span>
            <input class="form-input" type="date" id="filter-to"   value="${_filters.dateTo}"   style="width:150px">
          </div>
          <select class="form-select" id="filter-band" style="max-width:160px">
            <option value="">Todos os resultados</option>
            <option value="excellent">Excelente (≥95%)</option>
            <option value="good">Bom (70–94%)</option>
            <option value="regular">Regular (50–69%)</option>
            <option value="critical">Crítico (1–49%)</option>
            <option value="zero">Zerada (0%)</option>
          </select>
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
                ${analyst ? '<th></th>' : ''}
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
  const cols  = isAnalista() ? 8 : 7;
  const slice = _rows.slice((_page - 1) * PAGE_SIZE, _page * PAGE_SIZE);
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
        ${isAnalista() ? `<td><button class="btn btn--ghost btn--sm detail-btn" data-mon="${r.id}" tabindex="-1">Ver</button></td>` : ''}
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
}

/* ── Detail panel ─────────────────────────── */
async function fetchDetail(monId) {
  const { data, error } = await supabase
    .from('monitoring')
    .select(`
      id, date, number, zeroed,
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
        ${items.map(ta => `
          <div style="display:flex;align-items:center;gap:var(--space-2);padding:3px 0;font-size:var(--text-xs)">
            <span style="color:${ta.obtained ? 'var(--brand-green-dark)' : 'var(--color-danger)'};font-weight:700">${ta.obtained ? '✓' : '✗'}</span>
            <span style="color:${ta.obtained ? 'var(--text-primary)' : 'var(--text-secondary)'}">${ta.topic.item}</span>
            <span style="margin-left:auto;color:var(--text-tertiary);font-family:var(--font-mono)">${ta.obtained ? ta.topic.points : 0}/${ta.topic.points}</span>
          </div>`).join('')}
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
  }).join('') || `<div style="color:var(--text-tertiary);font-size:var(--text-xs)">Nenhuma observação</div>`;

  return `
    <div style="background:var(--bg-surface-2);border-top:2px solid var(--brand-green)">
      ${isAnalista() ? `
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
        <div class="detail-section-label">Atendimentos</div>
        <table class="data-table" style="margin-bottom:var(--space-4);font-size:var(--text-xs)">
          <thead><tr><th>Protocolo</th><th>TMA</th><th>TMPr</th><th>TMEr</th><th>CSAT</th></tr></thead>
          <tbody>${scHtml}</tbody>
        </table>
        <div class="detail-section-label">Observações</div>
        ${obsHtml}
      </div>
    </div>
    </div>`;
}

async function toggleDetail(monId, btn) {
  const existing = document.getElementById(`detail-row-${monId}`);
  if (existing) {
    existing.remove();
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

  const cols     = isAnalista() ? 8 : 7;
  const detailTr = document.createElement('tr');
  detailTr.id    = `detail-row-${monId}`;
  const rowData  = _rows.find(r => r.id === monId);
  detailTr.innerHTML = `<td colspan="${cols}" style="padding:0">${renderDetail(data, rowData)}</td>`;
  row.after(detailTr);

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
  document.getElementById('filter-from')?.addEventListener('change', async e => {
    _filters.dateFrom = e.target.value;
    await fetchMonitorings();
    _page = 1;
    refreshTable();
  });
  document.getElementById('filter-to')?.addEventListener('change', async e => {
    _filters.dateTo = e.target.value;
    await fetchMonitorings();
    _page = 1;
    refreshTable();
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

/* ── init ─────────────────────────────────── */
export async function init() {
  _dataLoaded = false;
  _expandedId = null;
  _page       = 1;

  if (!_filters.dateFrom) {
    const now     = new Date();
    const y       = now.getFullYear();
    const m       = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    _filters.dateFrom = `${y}-${m}-01`;
    _filters.dateTo   = `${y}-${m}-${lastDay}`;
  }

  const main = document.getElementById('main-content');
  if (main) main.innerHTML = render(); // mostra spinner imediatamente

  await fetchRefData();
  await fetchMonitorings();
  _dataLoaded = true;

  if (!main) return;
  main.innerHTML = render();
  bindFilters();
  bindTableEvents();
}
