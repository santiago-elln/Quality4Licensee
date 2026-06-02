/* ============================================================
   CONSULTA POR ASSOCIADO — Painel de análise por colaborador
   ============================================================ */
import { getCurrentUser, getRealUser } from '../auth.js';
import { supabase } from '../supabase.js';
import { navigate } from '../router.js';
import { can, P } from '../utils/permissions.js';
import {
  formatDate, resultBand, scoreColor, scoreColorHex, getInitials,
} from '../utils/formatters.js';
import { renderRadarChart, renderHistoryChart, destroyAll } from '../components/charts.js';
import { toast } from '../components/toast.js';

/* ── Module state ─────────────────────────── */
let _currentUser        = null;
let _departments        = [];
let _teams              = [];
let _employees          = [];
let _evalCriteria       = [];
let _topicMap           = {};
let _sgEcMap            = new Map(); // Map<sector_group_id, Set<eval_criteria_id>>
let _monStats           = {};
let _filters            = { supId: '', collabId: '' };
let _employeeActionPlans = {};  // { empId: [plans] }
let _dataLoaded         = false;
let _fetchedGlobalScope = null;
let _fetchedUserId      = null;

/* ── New plan modal state ─────────────────── */
let _npEmpId     = null;   // employee the modal is targeting
let _npRowCount  = 0;      // monotonic index for target rows
let _npStepCount = 0;      // monotonic index for step rows

/* ── AP target label helpers ──────────────── */
const AP_TARGET_LABELS = {
  monitoring_pct: 'Pontuação', tmer: 'TMEr',
  tmpr: 'TMPr', tma: 'TMA', csat: 'CSAT',
};

function apTargetLabel(t) {
  if (t.target_type === 'eval_criteria') return t.eval_criteria?.name ?? '—';
  if (t.target_type === 'custom')        return t.custom_label ?? '—';
  return AP_TARGET_LABELS[t.target_type] ?? t.target_type;
}

function apFmtValue(pct, time) {
  if (pct  != null) return `${pct}%`;
  if (time != null) return String(time).substring(0, 8);
  return '—';
}

/* ── Department helper ────────────────────── */
function myDept() {
  return _departments.find(d => d.id === _currentUser?.departmentId);
}

function buildCollabOpts(supId, selectedId) {
  const list = supId ? _employees.filter(e => e.team_id === supId) : _employees;
  return `<option value="">Todos</option>` +
    list.map(c =>
      `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.name}</option>`
    ).join('');
}

/* ── Card visibility ──────────────────────── */
function applyCardVisibility() {
  const { supId, collabId } = _filters;
  let visible = 0;
  document.querySelectorAll('.cc-card').forEach(card => {
    const show = (!supId || card.dataset.supId === supId) &&
                 (!collabId || card.dataset.collab === collabId);
    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const countEl = document.getElementById('summary-collab-count');
  if (countEl) countEl.textContent = visible;
}

/* ── Interval helpers ─────────────────────── */
function intervalToSecs(str) {
  if (!str) return 0;
  const parts = str.split(':');
  return (+parts[0]) * 3600 + (+parts[1] || 0) * 60 + (+parts[2] || 0);
}
function secsToHHMMSS(secs) {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

/* ── Compute per-employee stats ───────────── */
function computeMonStats(monitorings) {
  const stats = {};
  for (const emp of _employees) {
    stats[emp.id] = {
      count: 0, zeroed: 0, avgPct: 0, ptsLost: 0,
      scCount: 0, avgTma: '—', avgTmpr: '—', avgTmer: '—', avgCsat: 0,
      radarPcts: {}, history: [], lastDate: null,
    };
  }

  for (const mon of monitorings) {
    const s = stats[mon.employee_id];
    if (!s) continue;

    s.count++;
    if (mon.zeroed) s.zeroed++;

    let earnedPts = 0, totalMax = 0;
    const earnedByCriteria = {}, maxByCriteria = {};

    for (const ta of (mon.topic_approval ?? [])) {
      const topic = _topicMap[ta.topic_id];
      if (!topic) continue;
      const cid = topic.eval_criteria_id;
      earnedByCriteria[cid] = (earnedByCriteria[cid] ?? 0);
      maxByCriteria[cid]    = (maxByCriteria[cid]    ?? 0) + topic.points;
      totalMax += topic.points;
      if (ta.obtained) { earnedByCriteria[cid] += topic.points; earnedPts += topic.points; }
    }

    const pct = totalMax > 0 ? Math.round(earnedPts / totalMax * 100) : 0;
    s._pctSum     = (s._pctSum     ?? 0) + pct;
    s._ptsLostSum = (s._ptsLostSum ?? 0) + (totalMax - earnedPts);
    s.history.push({ date: mon.date, pct });
    if (!s.lastDate || mon.date > s.lastDate) s.lastDate = mon.date;

    for (const cid of Object.keys(maxByCriteria)) {
      if (!s._radarSum) s._radarSum = {};
      s._radarSum[cid] = s._radarSum[cid] ?? { e: 0, m: 0 };
      s._radarSum[cid].e += earnedByCriteria[cid] ?? 0;
      s._radarSum[cid].m += maxByCriteria[cid];
    }

    for (const sc of (mon.service_chat ?? [])) {
      s.scCount++;
      s._tmaSum  = (s._tmaSum  ?? 0) + intervalToSecs(sc.service_time);
      s._tmprSum = (s._tmprSum ?? 0) + intervalToSecs(sc.first_response_time);
      s._tmerSum = (s._tmerSum ?? 0) + intervalToSecs(sc.max_response_time);
      if (sc.csat) { s._csatSum = (s._csatSum ?? 0) + sc.csat; s._csatN = (s._csatN ?? 0) + 1; }
    }
  }

  for (const s of Object.values(stats)) {
    if (s.count) {
      s.avgPct  = Math.round(s._pctSum / s.count);
      s.ptsLost = Math.round((s._ptsLostSum / s.count) * 10) / 10;
    }
    if (s.scCount) {
      s.avgTma  = secsToHHMMSS(Math.round(s._tmaSum  / s.scCount));
      s.avgTmpr = secsToHHMMSS(Math.round(s._tmprSum / s.scCount));
      s.avgTmer = secsToHHMMSS(Math.round(s._tmerSum / s.scCount));
    }
    s.avgCsat = s._csatN ? Math.round(s._csatSum / s._csatN * 10) / 10 : 0;

    for (const [cid, { e, m }] of Object.entries(s._radarSum ?? {})) {
      s.radarPcts[cid] = m > 0 ? Math.round(e / m * 100) : 0;
    }
    s.history.sort((a, b) => a.date.localeCompare(b.date));

    delete s._pctSum; delete s._ptsLostSum; delete s._tmaSum;
    delete s._tmprSum; delete s._tmerSum; delete s._csatSum;
    delete s._csatN; delete s._radarSum;
  }

  return stats;
}

/* ── Data fetch ───────────────────────────── */
async function fetchData() {
  const globalScope = can(_currentUser, P.GLOBAL_VIEW_DEPT);
  const scopeIds    = globalScope ? null : (_currentUser.supervisedTeamIds ?? []);
  const noAccess    = !globalScope && scopeIds.length === 0;
  const EMPTY_GUID  = '00000000-0000-0000-0000-000000000000';

  let empQuery   = supabase.from('employees').select('id, name, team_id, sector_group_id, avatar_url').eq('active', true).order('name');
  let teamsQuery = supabase.from('teams').select('id, name').eq('active', true).order('name');
  if (!globalScope) {
    const ids = noAccess ? [EMPTY_GUID] : scopeIds;
    empQuery   = empQuery.in('team_id', ids);
    teamsQuery = teamsQuery.in('id', ids);
  }

  const [deptRes, teamsRes, empRes, ecRes, topicRes, sgEcRes] = await Promise.all([
    supabase.from('departments').select('id, name').eq('active', true).order('name'),
    teamsQuery,
    empQuery,
    supabase.from('eval_criteria').select('id, name').eq('active', true),
    supabase.from('topic').select('id, eval_criteria_id, points').eq('active', true),
    supabase.from('sector_group_eval_criteria').select('sector_group_id, eval_criteria_id'),
  ]);
  if (deptRes.error)  console.error('[consulta] departments:', deptRes.error);
  if (teamsRes.error) console.error('[consulta] teams:', teamsRes.error);
  if (empRes.error)   console.error('[consulta] employees:', empRes.error);
  if (ecRes.error)    console.error('[consulta] eval_criteria:', ecRes.error);
  if (topicRes.error) console.error('[consulta] topic:', topicRes.error);
  _departments  = deptRes.data   ?? [];
  _teams        = teamsRes.data  ?? [];
  _employees    = empRes.data    ?? [];
  _evalCriteria = ecRes.data     ?? [];
  _topicMap     = Object.fromEntries((topicRes.data ?? []).map(t => [t.id, t]));
  _sgEcMap      = new Map();
  for (const { sector_group_id, eval_criteria_id } of (sgEcRes.data ?? [])) {
    if (!_sgEcMap.has(sector_group_id)) _sgEcMap.set(sector_group_id, new Set());
    _sgEcMap.get(sector_group_id).add(eval_criteria_id);
  }
  _fetchedGlobalScope = globalScope;
  _fetchedUserId      = _currentUser?.id ?? null;
}

async function fetchMonitoringData() {
  const { data, error } = await supabase
    .from('monitoring')
    .select(`
      id, employee_id, date, zeroed,
      topic_approval(topic_id, obtained),
      service_chat(service_time, first_response_time, max_response_time, csat)
    `);
  if (error) { console.error('[consulta] monitoring:', error); return; }
  _monStats = computeMonStats(data ?? []);
}

async function fetchEmployeeActionPlans() {
  const empIds = _employees.map(e => e.id);
  if (!empIds.length) { _employeeActionPlans = {}; return; }

  const { data, error } = await supabase
    .from('action_plans')
    .select(`
      id, start_date, finished_at, title, emp_visible, scope_id, created_at,
      profiles!created_by(name),
      action_plan_targets(
        id, target_type, custom_label, eval_criteria_id,
        objective_pct, objective_time,
        eval_criteria(name)
      ),
      action_steps(id, finished_at)
    `)
    .eq('scope_type', 'employee')
    .eq('active', true)
    .in('scope_id', empIds)
    .order('created_at', { ascending: false });

  if (error) { console.error('[consulta] action_plans:', error); _employeeActionPlans = {}; return; }

  _employeeActionPlans = {};
  for (const plan of (data ?? [])) {
    plan.action_steps = (plan.action_steps ?? []).filter(s => s.active !== false);
    (_employeeActionPlans[plan.scope_id] ??= []).push(plan);
  }
}

/* ── render() ─────────────────────────────── */
export function render() {
  if (!_dataLoaded) {
    return `
      <div class="page-enter">
        <div class="page-header">
          <div class="page-title">Consulta por Associado</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;height:300px;gap:12px;color:var(--text-secondary)">
          <div class="boot-spinner" style="width:20px;height:20px;border-width:2px"></div>
          Carregando dados…
        </div>
      </div>`;
  }

  const canFilterSup = can(_currentUser, P.GLOBAL_VIEW_DEPT);
  const dept         = myDept();

  const deptInfoHtml = `
    <div class="form-group" style="margin-bottom:0">
      <label class="form-label">Departamento</label>
      <div class="form-input" style="opacity:.75;cursor:default;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${dept?.name ?? '—'}
      </div>
    </div>`;

  const supFilterHtml = canFilterSup
    ? `<div class="form-group" style="margin-bottom:0">
         <label class="form-label">Supervisor</label>
         <select class="form-select" id="f-sup">
           <option value="">Todos</option>
           ${_teams.map(t =>
             `<option value="${t.id}" ${t.id === _filters.supId ? 'selected' : ''}>${t.name}</option>`
           ).join('')}
         </select>
       </div>`
    : `<div class="form-group" style="margin-bottom:0">
         <label class="form-label">Supervisor</label>
         <div class="form-input" style="opacity:.75;cursor:default">${_currentUser?.name ?? '—'}</div>
       </div>`;

  const sorted = [..._employees].sort((a, b) => {
    const da = _monStats[a.id]?.lastDate ?? '';
    const db = _monStats[b.id]?.lastDate ?? '';
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  });
  const cards = sorted.map(c => renderCard(c)).join('');

  const ecOpts = _evalCriteria.map(ec =>
    `<option value="eval_criteria:${ec.id}">${ec.name}</option>`
  ).join('');

  return `
    <div class="page-enter">
      <div class="page-header">
        <div class="page-title">Consulta por Associado</div>
        <div class="page-subtitle">Análise detalhada de desempenho individual por período</div>
      </div>

      <div class="consulta-filters">
        <div class="consulta-filters__grid">
          ${deptInfoHtml}
          ${supFilterHtml}
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Colaborador</label>
            <select class="form-select" id="f-collab">
              ${buildCollabOpts(_filters.supId, _filters.collabId)}
            </select>
          </div>
        </div>
      </div>

      <div class="consulta-summary-bar">
        <div class="consulta-summary-bar__stat">
          <span>👥 Colaboradores:</span><strong id="summary-collab-count">${_employees.length}</strong>
        </div>
        <div class="consulta-summary-bar__stat">
          <span>📋 Monitorias no período:</span><strong>0</strong>
        </div>
        <div class="consulta-summary-bar__stat">
          <span>📊 Aproveit. médio:</span>
          <strong style="color:var(--text-tertiary)">—</strong>
        </div>
        <div class="consulta-summary-bar__stat">
          <span>⚠ Zeradas:</span><strong>0</strong>
        </div>
      </div>

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

    <!-- ── New action plan modal ───────────── -->
    <div id="np-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal modal--xl">
        <div class="modal__header">
          <div class="modal__title" id="np-modal-title">Novo Plano de Ação</div>
          <button class="modal__close" id="np-close">✕</button>
        </div>

        <div class="modal__body" style="display:flex;flex-direction:column;gap:var(--space-5)">

          <!-- Top row: title, start date, visibility (full width) -->
          <div style="display:grid;grid-template-columns:1fr auto auto;gap:var(--space-4);align-items:end">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">
                Título
                <span style="font-weight:var(--weight-normal);color:var(--text-tertiary)">(opcional)</span>
              </label>
              <input class="form-input" type="text" id="np-title"
                     placeholder="Ex: Melhoria de CSAT — Q3">
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Data de início <span class="required">*</span></label>
              <input class="form-input" type="date" id="np-start-date">
            </div>
            <div class="form-group" style="margin-bottom:0;padding-bottom:2px">
              <label class="check-item">
                <input type="checkbox" id="np-emp-visible" checked>
                <span class="form-label">Visível para o colaborador</span>
              </label>
            </div>
          </div>

          <!-- Bottom row: objectives | steps (two equal columns) -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6);align-items:start">

            <!-- Left: objectives -->
            <div style="display:flex;flex-direction:column;gap:var(--space-3)">
              <div style="font-size:var(--text-xs);font-weight:var(--weight-bold);
                          text-transform:uppercase;letter-spacing:.07em;color:var(--text-tertiary)">
                Objetivos <span class="required">*</span>
              </div>
              <div id="np-target-rows" style="display:flex;flex-direction:column;gap:var(--space-3)">
              </div>
              <button class="btn btn--ghost btn--sm" id="np-add-target">
                + Adicionar objetivo
              </button>
            </div>

            <!-- Right: steps -->
            <div style="display:flex;flex-direction:column;gap:var(--space-3)">
              <div style="font-size:var(--text-xs);font-weight:var(--weight-bold);
                          text-transform:uppercase;letter-spacing:.07em;color:var(--text-tertiary)">
                Passos do plano
              </div>
              <div id="np-step-rows" style="display:flex;flex-direction:column;gap:var(--space-3)">
              </div>
              <button class="btn btn--ghost btn--sm" id="np-add-step">
                + Adicionar passo
              </button>
            </div>

          </div>
        </div>

        <div class="modal__footer">
          <button class="btn btn--ghost" id="np-cancel">Cancelar</button>
          <button class="btn btn--primary" id="np-save">Criar plano</button>
        </div>
      </div>
    </div>`;
}

/* ── Card render ─────────────────────────── */
function renderCard(collab) {
  const s    = _monStats[collab.id] ?? {
    count: 0, zeroed: 0, avgPct: 0, ptsLost: 0,
    scCount: 0, avgTma: '—', avgTmpr: '—', avgTmer: '—', avgCsat: 0,
    history: [], lastDate: null,
  };
  const sup   = _teams.find(t => t.id === collab.team_id);
  const plans = _employeeActionPlans[collab.id] ?? [];
  const band  = resultBand(s.avgPct);

  const scoreValHtml = s.count
    ? `<div class="cc-card__score-val" style="color:${scoreColor(s.avgPct)}">${s.avgPct}%</div>`
    : `<div class="cc-card__score-val" style="color:var(--text-tertiary)">—</div>`;

  const lastMonHtml = s.lastDate
    ? `Última: ${formatDate(s.lastDate)}`
    : 'Sem monitorias no período';

  const historyHtml = s.history.length
    ? `<canvas id="history-cc-${collab.id}" height="80"></canvas>`
    : `<div style="font-size:10px;color:var(--text-tertiary);padding:6px 0">Sem histórico</div>`;

  const csatDisplay = s.avgCsat ? `${s.avgCsat} ★` : '—';

  /* Action plan items */
  const planItems = plans.map(plan => {
    const totalSteps    = plan.action_steps?.length ?? 0;
    const finishedSteps = (plan.action_steps ?? []).filter(s => s.finished_at).length;
    const targets       = plan.action_plan_targets ?? [];
    return `
      <div class="cc-ap-item">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:3px">
          <div style="font-size:var(--text-xs);font-weight:var(--weight-semibold);
                      color:var(--text-primary);min-width:0;overflow:hidden;
                      text-overflow:ellipsis;white-space:nowrap">
            ${plan.title || '<em style="font-weight:normal;color:var(--text-tertiary)">Sem título</em>'}
          </div>
          <button class="btn btn--ghost cc-ap-link"
                  data-plan-id="${plan.id}"
                  style="flex-shrink:0;font-size:10px;padding:1px 6px;height:auto;line-height:1.6">
            Detalhes →
          </button>
        </div>
        <div style="font-size:10px;color:var(--text-tertiary);margin-bottom:3px">
          ${plan.profiles?.name ?? '—'} · ${formatDate(plan.start_date)}
          ${plan.finished_at
            ? ` · <span style="color:var(--color-success)">Concluído</span>`
            : ''}
        </div>
        ${targets.length ? `
          <div style="font-size:10px;color:var(--text-secondary)">
            ${targets.map(t =>
              `${apTargetLabel(t)}: <strong>${apFmtValue(t.objective_pct, t.objective_time)}</strong>`
            ).join(' · ')}
          </div>
        ` : ''}
        ${totalSteps ? `
          <div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">
            ${finishedSteps}/${totalSteps} passos concluídos
          </div>
        ` : ''}
      </div>`;
  }).join('');

  return `
    <div class="cc-card" data-collab="${collab.id}" data-sup-id="${collab.team_id ?? ''}">

      <div class="cc-card__header">
        <div class="cc-card__avatar">
          ${collab.avatar_url
            ? `<img src="${collab.avatar_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block" onerror="this.style.display='none'">`
            : ''}
          <span style="${collab.avatar_url ? 'display:none' : ''}">${getInitials(collab.name)}</span>
        </div>
        <div class="cc-card__info">
          <div class="cc-card__name">
            ${collab.name}
          </div>
          <div class="cc-card__last-mon">${lastMonHtml}</div>
          <div class="cc-card__badges">
            <span class="cc-badge">${sup?.name?.split(' ')[0] ?? '—'}</span>
          </div>
        </div>
        <div class="cc-card__score">
          ${scoreValHtml}
          <div class="cc-card__score-label">${s.count} mon.</div>
          <span class="badge badge--${band.cls}" style="margin-top:4px;font-size:9px">${band.label}</span>
        </div>
      </div>

      <div class="cc-card__body">
        <div class="cc-metrics">
          <div class="cc-metric-row">
            <span class="cc-metric-row__label">Qtd. Atendimentos</span>
            <span class="cc-metric-row__val">${s.scCount || '—'}</span>
          </div>
          <div class="cc-metric-row">
            <span class="cc-metric-row__label">TMA</span>
            <span class="cc-metric-row__val">${s.avgTma}</span>
          </div>
          <div class="cc-metric-row">
            <span class="cc-metric-row__label">TMEr</span>
            <span class="cc-metric-row__val">${s.avgTmer}</span>
          </div>
          <div class="cc-metric-row">
            <span class="cc-metric-row__label">TMPr</span>
            <span class="cc-metric-row__val">${s.avgTmpr}</span>
          </div>
          <div class="cc-metric-row">
            <span class="cc-metric-row__label">CSAT médio</span>
            <span class="cc-metric-row__val">${csatDisplay}</span>
          </div>
          <div class="cc-metric-row">
            <span class="cc-metric-row__label">Monitorias zeradas</span>
            <span class="cc-metric-row__val ${s.zeroed ? 'cc-metric-row__val--red' : ''}">
              ${s.count ? s.zeroed : '—'}
            </span>
          </div>
        </div>
        <div class="cc-radar-wrap">
          <canvas id="radar-cc-${collab.id}" width="240" height="240"></canvas>
        </div>
      </div>

      <!-- Action plan section (always visible; creation is permission-gated) -->
      <div class="cc-action-plan" id="ap-${collab.id}">
        <button class="cc-action-plan__toggle ap-toggle" data-collab="${collab.id}">
          <span>📋 Planos de Ação${plans.length ? ` (${plans.length})` : ''}</span>
          <span class="cc-action-plan__toggle-icon">›</span>
        </button>
        <div class="cc-action-plan__body">
          ${planItems || `
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);
                        padding:var(--space-1) 0">
              Nenhum plano cadastrado
            </div>`}
          ${can(_currentUser, P.CONSULT_ACTION_PLAN) ? `
            <button class="btn btn--ghost btn--sm ap-new-btn"
                    data-collab="${collab.id}"
                    style="margin-top:var(--space-2);width:100%">
              + Novo plano
            </button>
          ` : ''}
        </div>
      </div>

      <div class="cc-history">
        <div class="cc-history__label">Histórico de Resultados</div>
        <div class="cc-history-bar">${historyHtml}</div>
      </div>
    </div>`;
}

/* ── Sector-group criteria helper ─────────── */
function evalCriteriaForSg(sgId) {
  if (!sgId || !_sgEcMap.has(sgId)) return _evalCriteria;
  const linked = _sgEcMap.get(sgId);
  return _evalCriteria.filter(ec => linked.has(ec.id));
}

/* ── Charts ───────────────────────────────── */
function initCharts() {
  _employees.forEach(collab => {
    const s          = _monStats[collab.id];
    const sgCriteria = evalCriteriaForSg(collab.sector_group_id);
    const radarLabels = sgCriteria.map(ec => ec.name.split(' ')[0]);

    renderRadarChart(
      `radar-cc-${collab.id}`,
      radarLabels,
      [{ label: collab.name.split(' ')[0], data: sgCriteria.map(ec => s?.radarPcts[ec.id] ?? 0) }]
    );

    if (s?.history.length) {
      const last5 = s.history.slice(-5);
      renderHistoryChart(
        `history-cc-${collab.id}`,
        last5.map(h => formatDate(h.date)),
        last5.map(h => h.pct),
        last5.map(h => scoreColorHex(h.pct))
      );
    }
  });
}

/* ── Page reload ──────────────────────────── */
function reloadPage() {
  destroyAll();
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = render();
  bindEvents();
  applyCardVisibility();
}


/* ── New plan modal ───────────────────────── */
function openNewPlanModal(empId) {
  _npEmpId    = empId;
  _npRowCount = 0;

  const emp = _employees.find(e => e.id === empId);
  const titleEl = document.getElementById('np-modal-title');
  if (titleEl) titleEl.textContent = emp ? `Novo Plano — ${emp.name}` : 'Novo Plano de Ação';

  const titleInput = document.getElementById('np-title');
  if (titleInput) titleInput.value = '';

  const dateInput = document.getElementById('np-start-date');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

  const visCheck = document.getElementById('np-emp-visible');
  if (visCheck) visCheck.checked = true;

  const rowsContainer = document.getElementById('np-target-rows');
  if (rowsContainer) rowsContainer.innerHTML = '';

  const stepContainer = document.getElementById('np-step-rows');
  if (stepContainer) stepContainer.innerHTML = '';

  _npRowCount  = 0;
  _npStepCount = 0;
  addTargetRow(empId);
  addStepRow();

  document.getElementById('np-modal')?.classList.remove('modal-overlay--hidden');
}

function closeNewPlanModal() {
  document.getElementById('np-modal')?.classList.add('modal-overlay--hidden');
  _npEmpId = null;
}

function addTargetRow(empId) {
  const container = document.getElementById('np-target-rows');
  if (!container) return;

  const idx    = _npRowCount++;
  const ecOpts = _evalCriteria.map(ec =>
    `<option value="eval_criteria:${ec.id}">${ec.name}</option>`
  ).join('');

  const wrapper = document.createElement('div');
  wrapper.id = `np-row-${idx}`;
  wrapper.innerHTML = `
    <div style="background:var(--bg-surface-3);border-radius:var(--radius-sm);
                padding:var(--space-3);position:relative">
      ${idx > 0 ? `
        <button class="btn btn--ghost btn--sm np-remove-target" data-row="${idx}"
                style="position:absolute;top:6px;right:6px;padding:2px 7px;font-size:11px">✕</button>
      ` : ''}

      <div class="form-group" style="margin-bottom:var(--space-2)">
        <label class="form-label">Métrica</label>
        <select class="form-select" id="np-type-${idx}" data-row="${idx}">
          <option value="">— selecione —</option>
          <option value="monitoring_pct">Pontuação de monitoria</option>
          <option value="csat">CSAT</option>
          <option value="tma">TMA</option>
          <option value="tmpr">TMPr</option>
          <option value="tmer">TMEr</option>
          ${ecOpts}
          <option value="custom">Personalizado</option>
        </select>
      </div>

      <div id="np-custom-label-wrap-${idx}" class="form-group"
           style="margin-bottom:var(--space-2);display:none">
        <label class="form-label">Nome do objetivo <span class="required">*</span></label>
        <input class="form-input" type="text" id="np-custom-label-${idx}"
               placeholder="Ex: Taxa de resolução">
      </div>

      <div style="display:flex;gap:var(--space-3);align-items:flex-start">
        <div class="form-group" id="np-obj-pct-wrap-${idx}"
             style="flex:1;margin-bottom:0;display:none">
          <label class="form-label">Meta:
            <span id="np-obj-pct-${idx}-val"
                  style="font-weight:var(--weight-semibold);color:var(--brand-green-dark)">0%</span>
            <span class="required">*</span>
          </label>
          <input type="range" min="0" max="100" value="0" id="np-obj-pct-${idx}"
                 style="width:100%;accent-color:var(--brand-green);cursor:pointer">
        </div>
        <div class="form-group" id="np-obj-time-wrap-${idx}"
             style="flex:1;margin-bottom:0;display:none">
          <label class="form-label">Meta <span class="required">*</span></label>
          <input class="form-input" type="time" step="1"
                 id="np-obj-time-${idx}" placeholder="HH:MM:SS">
        </div>
        <div class="form-group" id="np-baseline-wrap-${idx}"
             style="flex:1;margin-bottom:0;display:none">
          <label class="form-label">Valor atual:
            <span id="np-baseline-${idx}-val"
                  style="font-weight:var(--weight-semibold);color:var(--text-secondary)">0%</span>
            <span class="required">*</span>
          </label>
          <input type="range" min="0" max="100" value="0" id="np-baseline-${idx}"
                 style="width:100%;accent-color:var(--brand-green);cursor:pointer">
        </div>
        <div class="form-group" id="np-obj-custom-wrap-${idx}"
             style="flex:1;margin-bottom:0;display:none">
          <label class="form-label">Meta:
            <span id="np-obj-custom-${idx}-val"
                  style="font-weight:var(--weight-semibold);color:var(--brand-green-dark)">0%</span>
            <span class="required">*</span>
          </label>
          <input type="range" min="0" max="100" value="0" id="np-obj-custom-${idx}"
                 style="width:100%;accent-color:var(--brand-green);cursor:pointer">
        </div>
      </div>
    </div>`;

  container.appendChild(wrapper);
  bindTargetRowEvents(idx);
}

function computeStartlineFromMons(targetType, ecId, mons, topicMap) {
  switch (targetType) {
    case 'monitoring_pct': {
      const pcts = mons.map(m => {
        let earned = 0, total = 0;
        for (const ta of (m.topic_approval ?? [])) {
          const t = topicMap[ta.topic_id]; if (!t) continue;
          total += t.points; if (ta.obtained) earned += t.points;
        }
        return total > 0 ? earned / total * 100 : null;
      }).filter(v => v !== null);
      return { pct: pcts.length ? Math.round(pcts.reduce((a,b) => a+b,0) / pcts.length) : 0, time: null };
    }
    case 'eval_criteria': {
      const pcts = mons.map(m => {
        let earned = 0, total = 0;
        for (const ta of (m.topic_approval ?? [])) {
          const t = topicMap[ta.topic_id]; if (!t || t.eval_criteria_id !== ecId) continue;
          total += t.points; if (ta.obtained) earned += t.points;
        }
        return total > 0 ? earned / total * 100 : null;
      }).filter(v => v !== null);
      return { pct: pcts.length ? Math.round(pcts.reduce((a,b) => a+b,0) / pcts.length) : 0, time: null };
    }
    case 'csat': {
      const csats = mons.flatMap(m => (m.service_chat ?? []).filter(sc => sc.csat).map(sc => sc.csat));
      return { pct: csats.length ? Math.round(csats.filter(c => c >= 4).length / csats.length * 100) : 0, time: null };
    }
    case 'tma': case 'tmpr': case 'tmer': {
      const col  = { tma: 'service_time', tmpr: 'first_response_time', tmer: 'max_response_time' }[targetType];
      const secs = mons.flatMap(m => (m.service_chat ?? []).filter(sc => sc[col]).map(sc => intervalToSecs(sc[col]))).filter(s => s > 0);
      if (!secs.length) return { pct: null, time: null };
      const avg = Math.round(secs.reduce((a,b) => a+b,0) / secs.length);
      const h = Math.floor(avg/3600), mn = Math.floor((avg%3600)/60), s = avg%60;
      return { pct: null, time: `${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}:${String(s).padStart(2,'0')}` };
    }
    default: return { pct: null, time: null };
  }
}

async function fetchEmployeeMonData(empId) {
  const [monRes, topicRes] = await Promise.all([
    supabase.from('monitoring').select(`
      topic_approval(topic_id, obtained),
      service_chat(csat, service_time, first_response_time, max_response_time)
    `).eq('employee_id', empId),
    supabase.from('topic').select('id, eval_criteria_id, points').eq('active', true),
  ]);
  return {
    mons:     monRes.data ?? [],
    topicMap: Object.fromEntries((topicRes.data ?? []).map(t => [t.id, t])),
  };
}

function bindTargetRowEvents(idx) {
  document.getElementById(`np-type-${idx}`)?.addEventListener('change', e => {
    const typeVal  = e.target.value;
    const isTime   = ['tma', 'tmpr', 'tmer'].includes(typeVal);
    const isCustom = typeVal === 'custom';
    const hasPct   = !isTime && !isCustom && typeVal !== '';

    document.getElementById(`np-obj-pct-wrap-${idx}`).style.display      = hasPct   ? '' : 'none';
    document.getElementById(`np-obj-time-wrap-${idx}`).style.display     = isTime   ? '' : 'none';
    document.getElementById(`np-baseline-wrap-${idx}`).style.display     = isCustom ? '' : 'none';
    document.getElementById(`np-obj-custom-wrap-${idx}`).style.display   = isCustom ? '' : 'none';
    document.getElementById(`np-custom-label-wrap-${idx}`).style.display = isCustom ? '' : 'none';
  });

  [`np-obj-pct-${idx}`, `np-baseline-${idx}`, `np-obj-custom-${idx}`].forEach(id => {
    document.getElementById(id)?.addEventListener('input', e => {
      document.getElementById(`${id}-val`).textContent = `${e.target.value}%`;
    });
  });

  document.querySelector(`.np-remove-target[data-row="${idx}"]`)
    ?.addEventListener('click', () => document.getElementById(`np-row-${idx}`)?.remove());
}

function addStepRow() {
  const container = document.getElementById('np-step-rows');
  if (!container) return;

  const idx     = _npStepCount++;
  const wrapper = document.createElement('div');
  wrapper.id    = `np-step-${idx}`;
  wrapper.innerHTML = `
    <div style="background:var(--bg-surface-3);border-radius:var(--radius-sm);
                padding:var(--space-3);position:relative">
      ${idx > 0 ? `
        <button class="np-remove-step" data-row="${idx}"
                style="position:absolute;top:6px;right:6px;
                       background:none;border:none;cursor:pointer;
                       font-size:11px;color:var(--text-tertiary);
                       padding:2px 6px;border-radius:var(--radius-sm)">✕</button>
      ` : ''}
      <div class="form-group" style="margin-bottom:var(--space-2)">
        <label class="form-label">Descrição <span class="required">*</span></label>
        <input class="form-input" type="text" id="np-step-desc-${idx}"
               placeholder="Descreva o passo…">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">
          Data de início
          <span style="font-weight:var(--weight-normal);color:var(--text-tertiary)">(opcional)</span>
        </label>
        <input class="form-input" type="date" id="np-step-date-${idx}"
               min="${document.getElementById('np-start-date')?.value ?? ''}"
               value="${document.getElementById('np-start-date')?.value ?? ''}">
      </div>
    </div>`;

  container.appendChild(wrapper);

  wrapper.querySelector('.np-remove-step')
    ?.addEventListener('click', () => wrapper.remove());
}

async function saveNewPlan() {
  const empId = _npEmpId;
  if (!empId) return;

  const title      = document.getElementById('np-title')?.value.trim() || null;
  const startDate  = document.getElementById('np-start-date')?.value;
  const empVisible = document.getElementById('np-emp-visible')?.checked ?? true;

  if (!startDate) { toast.warning('Atenção', 'Informe a data de início.'); return; }

  const rows = document.querySelectorAll('#np-target-rows > div');
  if (!rows.length) { toast.warning('Atenção', 'Adicione ao menos um objetivo.'); return; }

  const targets = [];
  for (const row of rows) {
    const idx     = row.id.replace('np-row-', '');
    const typeVal = document.getElementById(`np-type-${idx}`)?.value;
    if (!typeVal) { toast.warning('Atenção', 'Selecione o tipo de cada objetivo.'); return; }

    const isTime   = ['tma', 'tmpr', 'tmer'].includes(typeVal);
    const isCustom = typeVal === 'custom';
    const isEC     = typeVal.startsWith('eval_criteria:');

    const targetType  = isEC ? 'eval_criteria' : typeVal;
    const ecId        = isEC ? typeVal.split(':')[1] : null;
    const customLabel = isCustom
      ? document.getElementById(`np-custom-label-${idx}`)?.value.trim() : null;

    if (isCustom && !customLabel) {
      toast.warning('Atenção', 'Informe o nome do objetivo personalizado.'); return;
    }

    let objPct = null, objTime = null, baselinePct = null;
    if (isTime) {
      objTime = document.getElementById(`np-obj-time-${idx}`)?.value.trim() || null;
      if (!objTime) { toast.warning('Atenção', 'Informe o tempo objetivo.'); return; }
    } else if (isCustom) {
      const baseRaw = document.getElementById(`np-baseline-${idx}`)?.value;
      const goalRaw = document.getElementById(`np-obj-custom-${idx}`)?.value;
      if (baseRaw === '' || baseRaw == null) { toast.warning('Atenção', 'Informe o valor atual do objetivo personalizado.'); return; }
      if (goalRaw === '' || goalRaw == null) { toast.warning('Atenção', 'Informe o valor meta do objetivo personalizado.'); return; }
      baselinePct = Number(baseRaw); objPct = Number(goalRaw);
      if ([baselinePct, objPct].some(v => isNaN(v) || v < 0 || v > 100)) {
        toast.warning('Atenção', 'Os valores devem estar entre 0 e 100.'); return;
      }
    } else {
      const rawVal = document.getElementById(`np-obj-pct-${idx}`)?.value;
      if (rawVal === '' || rawVal == null) { toast.warning('Atenção', 'Informe o valor objetivo.'); return; }
      objPct = Number(rawVal);
      if (isNaN(objPct) || objPct < 0 || objPct > 100) { toast.warning('Atenção', 'O valor deve estar entre 0 e 100.'); return; }
    }

    targets.push({
      target_type:      targetType,
      eval_criteria_id: ecId || null,
      custom_label:     customLabel || null,
      objective_pct:    objPct,
      objective_time:   objTime,
      startline_pct:    isCustom ? baselinePct : null,   // computed below for non-custom
      startline_time:   null,
      _isCustom:        isCustom,
    });
  }

  /* Collect steps before any DB write — empty rows are skipped (steps are optional) */
  const rawSteps = [];
  for (const el of document.querySelectorAll('#np-step-rows > div')) {
    const idx  = el.id.replace('np-step-', '');
    const desc = document.getElementById(`np-step-desc-${idx}`)?.value.trim();
    const date = document.getElementById(`np-step-date-${idx}`)?.value || null;
    if (desc) rawSteps.push({ description: desc, start_date: date });
  }

  const saveBtn = document.getElementById('np-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Calculando baseline…'; }

  /* Compute startlines from all-time employee data, ignoring date filters and access level */
  if (targets.some(t => !t._isCustom)) {
    const { mons, topicMap } = await fetchEmployeeMonData(empId);
    for (const t of targets) {
      if (t._isCustom) continue;
      const isTimeT = ['tma','tmpr','tmer'].includes(t.target_type);
      const val     = computeStartlineFromMons(t.target_type, t.eval_criteria_id, mons, topicMap);
      t.startline_pct  = isTimeT ? null : (val.pct  ?? 0);
      t.startline_time = isTimeT ? (val.time ?? '00:00:00') : null;
    }
  }
  targets.forEach(t => delete t._isCustom);

  if (saveBtn) saveBtn.textContent = 'Criando…';

  try {
    const { data: plan, error: planErr } = await supabase
      .from('action_plans')
      .insert({
        created_by:  getRealUser().id,
        start_date:  startDate,
        emp_visible: empVisible,
        title,
        scope_type:  'employee',
        scope_id:    empId,
      })
      .select('id')
      .single();
    if (planErr) throw planErr;

    if (targets.length) {
      const { error: targErr } = await supabase
        .from('action_plan_targets')
        .insert(targets.map(t => ({ ...t, action_plan_id: plan.id })));
      if (targErr) throw targErr;
    }

    if (rawSteps.length) {
      const { error: stepsErr } = await supabase.from('action_steps')
        .insert(rawSteps.map(s => ({ ...s, action_plan_id: plan.id })));
      if (stepsErr) throw stepsErr;
    }

    closeNewPlanModal();
    toast.success('Plano criado');
    await fetchEmployeeActionPlans();
    reloadPage();
  } catch (err) {
    toast.error('Erro ao criar plano', err.message);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Criar plano'; }
  }
}

/* ── Event binding ────────────────────────── */
function bindEvents() {
  initCharts();

  document.getElementById('f-sup')?.addEventListener('change', e => {
    _filters.supId    = e.target.value;
    _filters.collabId = '';
    const colSel = document.getElementById('f-collab');
    if (colSel) colSel.innerHTML = buildCollabOpts(_filters.supId, '');
    applyCardVisibility();
  });

  document.getElementById('f-collab')?.addEventListener('change', e => {
    _filters.collabId = e.target.value;
    applyCardVisibility();
  });

  document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
    _filters = { supId: '', collabId: '' };
    reloadPage();
  });

  /* Action plan toggles */
  document.querySelectorAll('.ap-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(`ap-${btn.dataset.collab}`)?.classList.toggle('open');
    });
  });

  /* "Ver no Metas" links */
  document.querySelectorAll('.cc-ap-link').forEach(btn => {
    btn.addEventListener('click', () => navigate('metas', { planId: btn.dataset.planId }));
  });

  /* "Novo plano" buttons */
  document.querySelectorAll('.ap-new-btn').forEach(btn => {
    btn.addEventListener('click', () => openNewPlanModal(btn.dataset.collab));
  });

  /* Modal controls */
  document.getElementById('np-close')?.addEventListener('click',  closeNewPlanModal);
  document.getElementById('np-cancel')?.addEventListener('click', closeNewPlanModal);
  document.getElementById('np-modal')?.addEventListener('click',
    e => { if (e.target.id === 'np-modal') closeNewPlanModal(); });
  document.getElementById('np-save')?.addEventListener('click', saveNewPlan);
  document.getElementById('np-add-target')?.addEventListener('click', () => {
    if (_npEmpId) addTargetRow(_npEmpId);
  });
  document.getElementById('np-add-step')?.addEventListener('click', addStepRow);

  /* When plan start date changes, push new min to all existing step date inputs */
  document.getElementById('np-start-date')?.addEventListener('change', e => {
    const min = e.target.value;
    document.querySelectorAll('[id^="np-step-date-"]').forEach(input => {
      input.min = min;
      /* Also advance the value if it's now before the new minimum */
      if (input.value && input.value < min) input.value = min;
    });
  });
}

/* ── init ─────────────────────────────────── */
export async function init() {
  _currentUser = getCurrentUser();
  _dataLoaded  = false;
  _npEmpId     = null;

  const _initMain = document.getElementById('main-content');
  if (_initMain) _initMain.innerHTML = render();

  try {
    const globalScope = can(_currentUser, P.GLOBAL_VIEW_DEPT);
    if (!_employees.length || _fetchedGlobalScope !== globalScope || _fetchedUserId !== _currentUser?.id) await fetchData();
    await Promise.all([
      fetchMonitoringData(),
      fetchEmployeeActionPlans(),
    ]);
  } catch (err) {
    console.error('[consulta] init error:', err);
    const main = document.getElementById('main-content');
    if (main) {
      main.innerHTML = `
        <div class="page-enter" style="padding:var(--space-8)">
          <div class="empty-state">
            <div class="empty-state__icon">⚠</div>
            <div class="empty-state__title">Erro ao carregar dados</div>
            <div class="empty-state__desc">${err?.message ?? 'Tente recarregar a página.'}</div>
          </div>
        </div>`;
    }
    return;
  }

  _dataLoaded = true;
  reloadPage();
}
