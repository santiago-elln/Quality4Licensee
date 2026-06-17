/* ============================================================
   METAS — Planos de Ação da Equipe
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { getRouteParams } from '../router.js';
import { supabase } from '../supabase.js';
import { can, P } from '../utils/permissions.js';
import { toast } from '../components/toast.js';
import { formatDate } from '../utils/formatters.js';

/* ── Module state ─────────────────────────── */
let _plans       = null;   // null = loading, [] = loaded
let _scopeNames  = {};     // { scope_id: display_name }
let _selectedId  = null;
let _pending          = {};    // { stepId: bool } — step done/undone
let _pendingFinished  = null;  // null | bool — plan finished
let _pendingStepEdits   = {};  // { stepId: { description?, start_date? } }
let _pendingPlanEdits   = {};  // { title?, start_date? }
let _pendingTargetEdits = {};  // { targetId: { objective_pct?, objective_time? } }
let _editingStepId    = null;  // step currently showing edit inputs
let _editingPlanField = null;  // 'title' | 'start_date' | null
let _editingTargetId  = null;  // target currently showing edit inputs
let _addingStep          = false; // inline new-step form open
let _addingTarget        = false; // inline new-target form open
let _newTargetType       = '';    // selected metric in the new-target form
let _targetValueCache    = {};     // { planId: { targetId: {pct,time} } } — persists across plan switches
let _filterScope = '';
let _currentUser = null;

/* ── New plan modal state ─────────────────── */
let _evalCriteria  = [];   // [{id, name}] — fetched once on first modal open
let _mnpScopeOpts  = {};   // { scopeType: [{id,name}] } — cached per type
let _mnpRowCount   = 0;
let _mnpStepCount  = 0;

/* ── Constants ────────────────────────────── */
const SCOPE_LABELS = {
  employee:     'Colaborador',
  team:         'Equipe',
  sector:       'Setor',
  sector_group: 'Grupo',
  department:   'Departamento',
};

const TARGET_LABELS = {
  monitoring_pct: 'Pontuação',
  tmer:           'TMEr',
  tmpr:           'TMPr',
  tma:            'TMA',
  csat:           'CSAT',
};

const TABLE_MAP = {
  department:   'departments',
  sector_group: 'sector_groups',
  sector:       'sectors',
  team:         'teams',
  employee:     'employees',
};

/* Tables that have soft-deletion (active column) */
const ACTIVE_TABLES = new Set(['departments', 'sectors', 'teams', 'employees', 'action_plans', 'action_steps']);

/* ── Data fetch ───────────────────────────── */
async function fetchPlans() {
  const globalScope = can(_currentUser, P.GLOBAL_VIEW_DEPT);

  let query = supabase
    .from('action_plans')
    .select(`
      id, start_date, finished_at, emp_visible, title,
      scope_type, scope_id, created_at,
      profiles!created_by(name),
      action_plan_targets(
        id, target_type, eval_criteria_id, custom_label,
        objective_pct, objective_time,
        startline_pct, startline_time,
        eval_criteria(name)
      ),
      action_steps(
        id, description, start_date, finished_at, created_at,
        action_step_milestones(id, action_plan_target_id, milestone_pct, milestone_time, is_manual)
      )
    `)
    .eq('active', true)
    .order('created_at', { ascending: false });

  /* For non-global users, restrict to the scope IDs they're allowed to see.
     This must run in app code: RLS always runs under the real authenticated
     JWT, so it can't express "plans within my supervised teams OR plans that
     target a scope I belong to".

     Two kinds of visibility:
       · Manager scope  — supervisors see every plan within their supervised
         teams (and the employees in them), regardless of emp_visible, because
         they manage those plans.
       · Member scope   — any user sees plans targeting a scope they belong to
         (their own record, team, sector, sector group, department), but only
         when the plan is marked visible to the collaborator (emp_visible). */
  let managerScope = new Set();
  if (!globalScope) {
    const teamIds = _currentUser?.supervisedTeamIds ?? [];

    /* The current user's own memberships — own employee id + hierarchy FKs.
       Read straight from employees so it works even for users with no profile
       row (where _currentUser.sectorId/etc. are null). */
    const mePromise = _currentUser?.employeeId
      ? supabase.from('employees')
          .select('id, team_id, sector_id, sector_group_id, department_id')
          .eq('id', _currentUser.employeeId).maybeSingle()
      : Promise.resolve({ data: null });

    /* Employees within supervised teams → the supervisor can see their plans. */
    const teamEmpsPromise = teamIds.length
      ? supabase.from('employees').select('id').eq('active', true).in('team_id', teamIds)
      : Promise.resolve({ data: [] });

    const [{ data: me }, { data: teamEmps }] = await Promise.all([mePromise, teamEmpsPromise]);

    managerScope = new Set([...teamIds, ...(teamEmps ?? []).map(e => e.id)]);
    const memberScope = me
      ? [me.id, me.team_id, me.sector_id, me.sector_group_id, me.department_id].filter(Boolean)
      : [];

    const allowed = [...new Set([...managerScope, ...memberScope])];
    if (!allowed.length) { _plans = []; _scopeNames = {}; return; }
    query = query.in('scope_id', allowed);
  }

  const { data, error } = await query;
  if (error) { console.error('[metas] fetch:', error); _plans = []; return; }
  _plans = (data ?? [])
    /* Member-scope plans only reach the collaborator when emp_visible; plans in
       a manager's own scope are always shown; global users see everything. */
    .filter(p => globalScope || managerScope.has(p.scope_id) || p.emp_visible)
    .map(p => ({
      ...p,
      action_steps: (p.action_steps ?? []).filter(s => s.active !== false),
    }));
  _scopeNames = await resolveScopeNames(_plans);
}

async function resolveScopeNames(plans) {
  const byType = {};
  for (const p of plans) {
    (byType[p.scope_type] ??= new Set()).add(p.scope_id);
  }

  const names = {};
  await Promise.all(
    Object.entries(byType).map(async ([type, ids]) => {
      const table = TABLE_MAP[type];
      if (!table) return;
      let q = supabase.from(table).select('id, name').in('id', [...ids]);
      if (ACTIVE_TABLES.has(table)) q = q.eq('active', true);
      const { data } = await q;
      for (const row of (data ?? [])) names[row.id] = row.name;
    })
  );
  return names;
}

/* ── Time helpers ─────────────────────────── */
function intervalToSecs(str) {
  if (!str) return 0;
  const s   = String(str);
  const neg = s.startsWith('-');
  const parts = s.replace('-', '').split(':');
  const secs  = (+parts[0]) * 3600 + (+parts[1] || 0) * 60 + (+parts[2] || 0);
  return neg ? -secs : secs;
}

function secsToSignedInterval(secs) {
  const neg = secs < 0;
  const abs = Math.abs(secs);
  const h   = Math.floor(abs / 3600);
  const m   = Math.floor((abs % 3600) / 60);
  const s   = Math.floor(abs % 60);
  const t   = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return neg ? `-${t}` : t;
}

/* ── Scope resolution ─────────────────────── */
async function resolveEmployeeIds(scopeType, scopeId) {
  if (scopeType === 'employee') return [scopeId];

  /* employees carries all hierarchy FKs as denormalised columns */
  const colMap = {
    team:         'team_id',
    sector:       'sector_id',
    sector_group: 'sector_group_id',
    department:   'department_id',
  };
  const col = colMap[scopeType];
  if (!col) return [];

  const { data } = await supabase
    .from('employees')
    .select('id')
    .eq(col, scopeId)
    .eq('active', true);
  return (data ?? []).map(e => e.id);
}

/* Fetch all monitoring data for a scope — no date filter, no access filter */
async function fetchScopeMonitoringData(scopeType, scopeId) {
  const empIds = await resolveEmployeeIds(scopeType, scopeId);
  if (!empIds.length) return { mons: [], topicMap: {} };

  const [monRes, topicRes] = await Promise.all([
    supabase.from('monitoring').select(`
      topic_approval(topic_id, obtained),
      service_chat(csat, service_time, first_response_time, max_response_time)
    `).in('employee_id', empIds),
    supabase.from('topic').select('id, eval_criteria_id, points').eq('active', true),
  ]);

  return {
    mons:     monRes.data ?? [],
    topicMap: Object.fromEntries((topicRes.data ?? []).map(t => [t.id, t])),
  };
}

async function loadCurrentTargetValues(plan) {
  _targetValueCache[plan.id] = {};   // sentinel: fetch in progress, prevent re-entry
  const { mons, topicMap } = await fetchScopeMonitoringData(plan.scope_type, plan.scope_id);
  const values = {};
  for (const t of (plan.action_plan_targets ?? [])) {
    if (t.target_type === 'custom') continue;
    values[t.id] = computeTargetCurrentValue(t, mons, topicMap);
  }
  _targetValueCache[plan.id] = values;
  refreshDetail();
}

/* ── Milestone computation ────────────────── */
async function resolvePlanEmployees(plan) {
  return resolveEmployeeIds(plan.scope_type, plan.scope_id);
}

async function computeMilestoneValues(plan) {
  const targets = (plan.action_plan_targets ?? []).filter(t => t.target_type !== 'custom');
  if (!targets.length) return {};

  const empIds = await resolvePlanEmployees(plan);
  if (!empIds.length) return {};

  const needsTopics = targets.some(t =>
    t.target_type === 'monitoring_pct' || t.target_type === 'eval_criteria'
  );

  const [monRes, topicRes] = await Promise.all([
    supabase.from('monitoring').select(`
      employee_id,
      topic_approval(topic_id, obtained),
      service_chat(csat, service_time, first_response_time, max_response_time)
    `).in('employee_id', empIds),
    needsTopics
      ? supabase.from('topic').select('id, eval_criteria_id, points').eq('active', true)
      : { data: [] },
  ]);

  const mons     = monRes.data ?? [];
  const topicMap = Object.fromEntries((topicRes.data ?? []).map(t => [t.id, t]));

  const result = {};
  for (const target of targets) {
    result[target.id] = computeTargetCurrentValue(target, mons, topicMap);
  }
  return result;
}

function computeTargetCurrentValue(target, mons, topicMap) {
  switch (target.target_type) {

    case 'monitoring_pct': {
      const pcts = mons.map(m => {
        let earned = 0, total = 0;
        for (const ta of (m.topic_approval ?? [])) {
          const t = topicMap[ta.topic_id];
          if (!t) continue;
          total += t.points;
          if (ta.obtained) earned += t.points;
        }
        return total > 0 ? earned / total * 100 : null;
      }).filter(v => v !== null);
      const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
      return { pct: Math.round(avg), time: null };
    }

    case 'eval_criteria': {
      const ecId = target.eval_criteria_id;
      const pcts = mons.map(m => {
        let earned = 0, total = 0;
        for (const ta of (m.topic_approval ?? [])) {
          const t = topicMap[ta.topic_id];
          if (!t || t.eval_criteria_id !== ecId) continue;
          total += t.points;
          if (ta.obtained) earned += t.points;
        }
        return total > 0 ? earned / total * 100 : null;
      }).filter(v => v !== null);
      const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
      return { pct: Math.round(avg), time: null };
    }

    case 'csat': {
      const csats = mons.flatMap(m =>
        (m.service_chat ?? []).filter(sc => sc.csat).map(sc => sc.csat)
      );
      if (!csats.length) return { pct: 0, time: null };
      return { pct: Math.round(csats.filter(c => c >= 4).length / csats.length * 100), time: null };
    }

    case 'tma':
    case 'tmpr':
    case 'tmer': {
      const col  = { tma: 'service_time', tmpr: 'first_response_time', tmer: 'max_response_time' }[target.target_type];
      const secs = mons
        .flatMap(m => (m.service_chat ?? []).filter(sc => sc[col]).map(sc => intervalToSecs(sc[col])))
        .filter(s => s > 0);
      if (!secs.length) return { pct: null, time: null };
      return { pct: null, time: secsToSignedInterval(Math.round(secs.reduce((a, b) => a + b, 0) / secs.length)) };
    }

    default: return { pct: null, time: null };
  }
}

async function saveStepMilestones(plan, completedStepIds) {
  const targets = (plan.action_plan_targets ?? []).filter(t => t.target_type !== 'custom');
  if (!targets.length || !completedStepIds.length) return;

  const current = await computeMilestoneValues(plan);
  const rows    = [];

  for (const stepId of completedStepIds) {
    for (const target of targets) {
      const val = current[target.id];
      if (!val) continue;

      let milestonePct = null, milestoneTime = null;

      if (val.pct != null && target.startline_pct != null) {
        milestonePct = val.pct - target.startline_pct;
      }
      if (val.time != null && target.startline_time != null) {
        const delta = intervalToSecs(val.time) - intervalToSecs(String(target.startline_time).substring(0, 9));
        milestoneTime = secsToSignedInterval(delta);
      }

      if (milestonePct === null && milestoneTime === null) continue;

      rows.push({
        action_step_id:        stepId,
        action_plan_target_id: target.id,
        milestone_pct:         milestonePct,
        milestone_time:        milestoneTime,
        is_manual:             false,
      });
    }
  }

  if (rows.length) {
    const { error } = await supabase
      .from('action_step_milestones')
      .upsert(rows, { onConflict: 'action_step_id,action_plan_target_id' });
    if (error) console.error('[metas] milestones upsert:', error);
  }
}

/* ── Helpers ──────────────────────────────── */
function hasPending() {
  return Object.keys(_pending).length > 0
    || _pendingFinished !== null
    || Object.keys(_pendingStepEdits).length > 0
    || Object.keys(_pendingPlanEdits).length > 0
    || Object.keys(_pendingTargetEdits).length > 0;
}

function planIsDone(plan) {
  return _pendingFinished !== null ? _pendingFinished : plan.finished_at != null;
}

function parseStepLinks(text) {
  const escaped = (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) =>
    `<a href="${url.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer"
        style="color:var(--brand-green);text-decoration:underline">${label}</a>`
  );
}

function targetLabel(t) {
  if (t.target_type === 'eval_criteria') return t.eval_criteria?.name ?? '—';
  if (t.target_type === 'custom')        return t.custom_label ?? '—';
  return TARGET_LABELS[t.target_type] ?? t.target_type;
}

function fmtValue(pct, time) {
  if (pct  != null) return `${pct}%`;
  if (time != null) return time;
  return '—';
}

/* Returns 'good' | 'bad' | 'neutral' | null based on whether current
   value moves in the same direction as the objective relative to startline. */
function targetProgressColor(t, curVal, curObjPct, curObjTime) {
  if (!curVal) return null;
  const isTime = ['tma','tmpr','tmer'].includes(t.target_type);
  let start, cur, obj;
  if (isTime) {
    const sl = String(t.startline_time ?? '').substring(0, 9);
    start = sl ? intervalToSecs(sl) : null;
    cur   = curVal.time ? intervalToSecs(curVal.time) : null;
    obj   = curObjTime  ? intervalToSecs(curObjTime)  : null;
  } else {
    start = t.startline_pct ?? null;
    cur   = curVal.pct      ?? null;
    obj   = curObjPct       ?? null;
  }
  if (start === null || cur === null || obj === null) return null;
  const signObj = Math.sign(obj - start);
  const signCur = Math.sign(cur - start);
  if (signObj === 0) return null;    // objective equals startline — no direction
  if (signCur === 0) return 'neutral'; // current at baseline — no movement yet
  return signObj === signCur ? 'good' : 'bad';
}

function stepIsDone(step) {
  return step.id in _pending ? _pending[step.id] : step.finished_at != null;
}

function visibilityLabel(plan) {
  const name = _scopeNames[plan.scope_id] ?? '—';
  switch (plan.scope_type) {
    case 'department':
    case 'sector_group':
    case 'sector':   return `Visível para: todos em ${name}`;
    case 'team':
      return plan.emp_visible
        ? `Visível para: todos da equipe ${name}`
        : `Visível para: ${name}`;
    case 'employee': return `Visível para: ${name}`;
    default:         return name;
  }
}

/* ── render() ─────────────────────────────── */
export function render() {
  if (!can(_currentUser, P.SIDEBAR_GOALS)) {
    return `
      <div class="page-enter">
        <div class="empty-state">
          <div class="empty-state__icon">🔒</div>
          <div class="empty-state__title">Acesso restrito</div>
        </div>
      </div>`;
  }

  if (_plans === null) {
    return `
      <div class="page-enter"
           style="display:flex;align-items:center;justify-content:center;height:300px;gap:12px;color:var(--text-secondary)">
        <div class="boot-spinner" style="width:20px;height:20px;border-width:2px"></div>
        Carregando planos…
      </div>`;
  }

  const filtered = _filterScope
    ? _plans.filter(p => p.scope_type === _filterScope)
    : _plans;

  const scopeTypes = [...new Set(_plans.map(p => p.scope_type))];
  const selected   = _selectedId ? _plans.find(p => p.id === _selectedId) : null;

  return `
    <div class="page-enter"
         style="display:flex;flex-direction:column;height:100%;min-height:0">

      <div class="page-header" style="flex-shrink:0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-4)">
          <div class="page-title">Ações da Equipe</div>
          ${can(_currentUser, P.CONSULT_ACTION_PLAN) ? `
            <button class="btn btn--primary btn--sm" id="btn-new-plan-metas">+ Novo Plano</button>
          ` : ''}
        </div>
        <div class="page-subtitle">Planos de ação e acompanhamento de metas da equipe</div>
      </div>

      <!-- Scope filter tabs -->
      <div class="period-bar" style="flex-shrink:0;margin-bottom:var(--space-4);background:var(--brand-dark)">
        <button class="pbar-chip ${!_filterScope ? 'pbar-chip--active' : ''} metas-scope-tab"
                data-scope="">Todos (${_plans.length})</button>
        ${scopeTypes.map(s => `
          <button class="pbar-chip ${_filterScope === s ? 'pbar-chip--active' : ''} metas-scope-tab"
                  data-scope="${s}">
            ${SCOPE_LABELS[s]} (${_plans.filter(p => p.scope_type === s).length})
          </button>
        `).join('')}
      </div>

      <!-- Split layout -->
      <div style="display:flex;gap:var(--space-4);flex:1;min-height:0">

        <!-- Left: plan list -->
        <div style="width:340px;flex-shrink:0;overflow-y:auto;
                    display:flex;flex-direction:column;gap:var(--space-3);
                    padding-right:var(--space-1)">
          ${filtered.length
            ? filtered.map(p => renderPlanCard(p, p.id === _selectedId)).join('')
            : `<div class="empty-state">
                 <div class="empty-state__title">Nenhum plano encontrado</div>
               </div>`
          }
        </div>

        <!-- Right: detail — flex column so header never scrolls -->
        <div id="metas-detail"
             style="flex:1;min-width:0;min-height:0;display:flex;flex-direction:column">
          ${selected ? renderPlanDetail(selected) : `
            <div class="empty-state" style="height:100%;justify-content:center">
              <div class="empty-state__icon" style="font-size:2rem">📋</div>
              <div class="empty-state__title">Selecione um plano</div>
              <div class="empty-state__desc">Clique em um plano à esquerda para ver seus passos</div>
            </div>
          `}
        </div>

      </div>

      ${can(_currentUser, P.CONSULT_ACTION_PLAN) ? renderMetasPlanModal() : ''}
    </div>`;
}

/* ── New plan modal HTML ──────────────────── */
function renderMetasPlanModal() {
  return `
    <div id="mnp-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal modal--xl">
        <div class="modal__header">
          <div class="modal__title">Novo Plano de Ação</div>
          <button class="modal__close" id="mnp-close">✕</button>
        </div>

        <div class="modal__body" style="display:flex;flex-direction:column;gap:var(--space-5)">

          <!-- Scope row -->
          <div style="display:grid;grid-template-columns:auto 1fr;gap:var(--space-4);align-items:end">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Tipo de escopo</label>
              <select class="form-select" id="mnp-scope-type">
                <option value="employee">Colaborador</option>
                <option value="team">Equipe</option>
                <option value="sector">Setor</option>
                <option value="sector_group">Grupo</option>
                <option value="department">Departamento</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Destinatário <span class="required">*</span></label>
              <select class="form-select" id="mnp-scope-id">
                <option value="">Carregando…</option>
              </select>
            </div>
          </div>

          <!-- Top row: title, start date, visibility -->
          <div style="display:grid;grid-template-columns:1fr auto auto;gap:var(--space-4);align-items:end">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">
                Título
                <span style="font-weight:var(--weight-normal);color:var(--text-tertiary)">(opcional)</span>
              </label>
              <input class="form-input" type="text" id="mnp-title"
                     placeholder="Ex: Melhoria de CSAT — Q3">
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Data de início <span class="required">*</span></label>
              <input class="form-input" type="date" id="mnp-start-date">
            </div>
            <div class="form-group" style="margin-bottom:0;padding-bottom:2px">
              <label class="check-item">
                <input type="checkbox" id="mnp-emp-visible" checked>
                <span class="form-label">Visível para o colaborador</span>
              </label>
            </div>
          </div>

          <!-- Bottom: objectives | steps -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6);align-items:start">

            <div style="display:flex;flex-direction:column;gap:var(--space-3)">
              <div style="font-size:var(--text-xs);font-weight:var(--weight-bold);
                          text-transform:uppercase;letter-spacing:.07em;color:var(--text-tertiary)">
                Objetivos <span class="required">*</span>
              </div>
              <div id="mnp-target-rows" style="display:flex;flex-direction:column;gap:var(--space-3)"></div>
              <button class="btn btn--ghost btn--sm" id="mnp-add-target">+ Adicionar objetivo</button>
            </div>

            <div style="display:flex;flex-direction:column;gap:var(--space-3)">
              <div style="font-size:var(--text-xs);font-weight:var(--weight-bold);
                          text-transform:uppercase;letter-spacing:.07em;color:var(--text-tertiary)">
                Passos do plano
              </div>
              <div id="mnp-step-rows" style="display:flex;flex-direction:column;gap:var(--space-3)"></div>
              <button class="btn btn--ghost btn--sm" id="mnp-add-step">+ Adicionar passo</button>
            </div>

          </div>
        </div>

        <div class="modal__footer">
          <button class="btn btn--ghost" id="mnp-cancel">Cancelar</button>
          <button class="btn btn--primary" id="mnp-save">Criar plano</button>
        </div>
      </div>
    </div>`;
}

/* ── Plan card (left panel) ───────────────── */
function renderPlanCard(plan, isSelected) {
  const targets  = plan.action_plan_targets ?? [];
  const isDone   = plan.finished_at != null;
  const border   = isSelected ? 'var(--brand-green)' : 'var(--border)';
  const bg       = isSelected ? 'var(--brand-green-muted)' : 'var(--bg-surface)';

  return `
    <div class="metas-plan-card"
         data-plan-id="${plan.id}"
         style="border:1px solid ${border};background:${bg};border-radius:var(--radius-md);
                padding:var(--space-3) var(--space-4);cursor:pointer;
                transition:border-color var(--transition-fast),background var(--transition-fast)">

      <div style="display:flex;align-items:flex-start;justify-content:space-between;
                  gap:var(--space-2);margin-bottom:var(--space-2)">
        <div style="min-width:0">
          <div style="font-weight:var(--weight-semibold);font-size:var(--text-sm);
                      color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${plan.title
              ? plan.title
              : `<span style="color:var(--text-tertiary);font-style:italic">Sem título</span>`}
          </div>
          <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:2px">
            ${plan.profiles?.name ?? '—'} · ${formatDate(plan.start_date)}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-1);flex-shrink:0;overflow:hidden">
          ${isDone
            ? `<span class="badge badge--excellent">Concluído</span>`
            : `<span class="badge badge--neutral">${SCOPE_LABELS[plan.scope_type]}</span>`}
          <button class="metas-delete-plan btn btn--ghost" data-plan-id="${plan.id}"
                  style="padding:2px 5px;font-size:13px;height:auto;color:var(--color-danger);
                         flex-shrink:0;overflow:hidden;white-space:nowrap;
                         max-width:${isSelected ? '28px' : '0'};
                         opacity:${isSelected ? '1' : '0'};
                         pointer-events:${isSelected ? 'auto' : 'none'};
                         transition:max-width 220ms ease,opacity 180ms ease"
                  title="Excluir plano">🗑</button>
        </div>
      </div>

      <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:var(--space-2)">
        ${_scopeNames[plan.scope_id] ?? '—'}
        ${!plan.emp_visible ? ' · <em>oculto p/ colaboradores</em>' : ''}
      </div>

      ${targets.length ? `
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${targets.map(t => `
            <span style="font-size:10px;background:var(--bg-surface-3);border-radius:4px;
                         padding:2px 6px;color:var(--text-secondary)">
              ${targetLabel(t)}:
              ${fmtValue(t.startline_pct, t.startline_time)}→${fmtValue(t.objective_pct, t.objective_time)}
            </span>
          `).join('')}
        </div>
      ` : ''}
    </div>`;
}

/* ── Plan detail (right panel) ────────────── */
function renderPlanDetail(plan) {
  const steps     = [...(plan.action_steps ?? [])]
    .sort((a, b) => (a.start_date ?? a.created_at ?? '').localeCompare(b.start_date ?? b.created_at ?? ''));
  const pending   = hasPending();
  const doneCount = steps.filter(s => stepIsDone(s)).length;

  const planDone    = planIsDone(plan);
  const planPending = _pendingFinished !== null;
  const targetMap   = Object.fromEntries((plan.action_plan_targets ?? []).map(t => [t.id, t]));

  /* ── Editable title + start date + emp_visible (open together) ── */
  const displayTitle      = _pendingPlanEdits.title       !== undefined ? _pendingPlanEdits.title       : (plan.title ?? '');
  const displayStartDate  = _pendingPlanEdits.start_date  !== undefined ? _pendingPlanEdits.start_date  : (plan.start_date ?? '');
  const displayEmpVisible = _pendingPlanEdits.emp_visible !== undefined ? _pendingPlanEdits.emp_visible : plan.emp_visible;
  const titlePending      = _pendingPlanEdits.title       !== undefined;
  const startPending      = _pendingPlanEdits.start_date  !== undefined;
  const empVisPending     = _pendingPlanEdits.emp_visible !== undefined;
  const anyPlanPending    = titlePending || startPending || empVisPending;

  const titleHtml = _editingPlanField === 'title' ? `
    <div style="display:flex;align-items:center;gap:var(--space-2);flex:1;min-width:0">
      <input type="text" id="edit-plan-title" class="form-input"
             value="${displayTitle.replace(/"/g,'&quot;')}" placeholder="Título do plano"
             style="height:32px;font-size:var(--text-sm);font-weight:var(--weight-semibold)">
      <button class="btn btn--ghost   btn--sm cancel-plan-field">✕</button>
      <button class="btn btn--primary btn--sm confirm-plan-field" data-field="title">✓</button>
    </div>` : `
    <div style="display:flex;align-items:center;gap:var(--space-2);flex:1;min-width:0">
      <div class="panel__title" style="flex:1">
        ${displayTitle || '<span style="font-style:italic;color:var(--text-tertiary)">Sem título</span>'}
        ${anyPlanPending ? '<span style="color:var(--color-warning);font-size:10px;margin-left:2px">●</span>' : ''}
      </div>
    </div>`;

  /* start date: input when title edit is open, plain text otherwise */
  const startDateHtml = _editingPlanField === 'title' ? `
    <span style="display:inline-flex;align-items:center;gap:4px">
      <input type="date" id="edit-plan-start-date" class="form-input"
             value="${displayStartDate}"
             style="height:26px;font-size:var(--text-xs);padding:0 6px">
    </span>` : `
    <span>
      ${formatDate(displayStartDate)}
      ${startPending ? '<span style="color:var(--color-warning);font-size:10px;margin-left:2px">●</span>' : ''}
    </span>`;

  return `
    <div style="display:flex;flex-direction:column;height:100%;min-height:0;
                background:var(--bg-surface);border:1px solid var(--border);
                border-radius:var(--radius-md)">

      <!-- ── Fixed header ── -->
      <div style="flex-shrink:0;padding:var(--space-4) var(--space-5);
                  border-bottom:1px solid var(--border-light);
                  border-radius:var(--radius-md) var(--radius-md) 0 0;
                  background:var(--bg-surface);display:flex;flex-direction:column;gap:var(--space-1)">

        <div style="display:flex;justify-content:space-between;align-items:center;width:100%">
          ${titleHtml}
          <div style="flex-shrink:0;margin-left:var(--space-3)">
            ${planDone
              ? `<span class="badge badge--excellent">Concluído${plan.finished_at ? ' em ' + formatDate(plan.finished_at) : ''}</span>`
              : `<span class="badge badge--neutral">Em andamento</span>`}
            <button class="plan-field-edit btn btn--ghost" data-field="title"
              style="padding:2px 6px;font-size:11px;height:auto;flex-shrink:0" title="Editar">•••</button>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
          <span style="font-size:var(--text-xs);color:var(--brand-green-dark);font-weight:var(--weight-medium)">
            ${visibilityLabel(plan)}
          </span>
          ${_editingPlanField === 'title' ? `
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;
                          font-size:var(--text-xs);color:var(--text-secondary)">
              <input type="checkbox" id="edit-plan-emp-visible" ${displayEmpVisible ? 'checked' : ''}>
              Visível para colaboradores
            </label>
          ` : `
            <span style="font-size:9px;padding:2px 7px;border-radius:4px;font-weight:var(--weight-medium);
                         ${displayEmpVisible
                           ? 'background:rgba(74,186,61,0.12);color:var(--brand-green-dark)'
                           : 'background:var(--bg-surface-3);color:var(--text-tertiary)'}">
              ${displayEmpVisible ? '👁 Visível p/ colaboradores' : '🔒 Oculto p/ colaboradores'}
              ${empVisPending ? '<span style="color:var(--color-warning);margin-left:2px">●</span>' : ''}
            </span>
          `}
        </div>
        <div style="font-size:var(--text-xs);color:var(--text-tertiary)">
          Criado por ${plan.profiles?.name ?? '—'} · Início: ${startDateHtml}
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;
                    gap:var(--space-3);margin-top:var(--space-2)">
          <label style="display:flex;align-items:center;gap:var(--space-2);
                        cursor:pointer;user-select:none;
                        padding:var(--space-2) var(--space-3);border-radius:var(--radius-sm);
                        ${planPending ? 'border:1px solid var(--color-warning)' : ''};">
            <input type="checkbox" id="plan-finished-check" ${planDone ? 'checked' : ''}
                   style="cursor:pointer">
            <span style="font-size:var(--text-sm);color:var(--text-primary)">
              Marcar plano como concluído
            </span>
            ${planPending ? `<span style="font-size:var(--text-xs);color:var(--color-warning)">● pendente</span>` : ''}
          </label>
          ${pending ? `
            <div style="display:flex;align-items:center;gap:var(--space-2);flex-shrink:0">
              <span style="font-size:var(--text-xs);color:var(--color-warning)">● Não salvo</span>
              <button class="btn btn--primary btn--sm" id="btn-save-steps">Salvar alterações</button>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- ── Scrollable body ── -->
      <div style="flex:1;overflow-y:auto;min-height:0">

        <!-- Targets -->
        <div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border)">
          <div style="font-size:10px;font-weight:var(--weight-bold);text-transform:uppercase;
                      letter-spacing:.07em;color:var(--text-tertiary);margin-bottom:var(--space-2);
                      display:flex;justify-content:space-between;align-items:center">
            <span>Objetivos</span>
            ${!_addingTarget ? `
              <button class="btn btn--ghost" id="btn-add-target"
                      style="padding:1px 8px;font-size:10px;height:auto">+ Adicionar</button>` : ''}
          </div>
          ${(plan.action_plan_targets ?? []).length ? `
            <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-2)">
              ${(plan.action_plan_targets ?? []).map(t => {
                const tPend      = !!_pendingTargetEdits[t.id];
                const tEdit      = _pendingTargetEdits[t.id] ?? {};
                const curObjPct  = tEdit.objective_pct  ?? t.objective_pct;
                const curObjTime = tEdit.objective_time ?? t.objective_time;
                const isTimeT    = ['tma','tmpr','tmer'].includes(t.target_type);
                const isEditingT = _editingTargetId === t.id;
                return `
                  <div style="background:var(--bg-surface-3);border-radius:var(--radius-sm);
                              padding:var(--space-2) var(--space-3);font-size:var(--text-xs);min-width:120px;
                              border:1px solid ${tPend ? 'var(--color-warning)' : 'transparent'}">
                    <div style="font-weight:var(--weight-semibold);color:var(--text-primary);
                                margin-bottom:4px;display:flex;justify-content:space-between;
                                align-items:center;gap:4px">
                      <span>
                        ${targetLabel(t)}
                        ${tPend ? '<span style="color:var(--color-warning);font-size:10px">●</span>' : ''}
                      </span>
                      ${isEditingT ? `
                        <div style="display:flex;gap:2px">
                          <button class="btn btn--ghost cancel-target-btn"
                                  style="padding:1px 6px;font-size:10px;height:auto">✕</button>
                          <button class="btn btn--primary confirm-target-btn"
                                  style="padding:1px 6px;font-size:10px;height:auto">✓</button>
                        </div>` : `
                        <button class="target-edit-btn btn btn--ghost" data-target-id="${t.id}"
                                style="padding:1px 4px;font-size:10px;height:auto" title="Editar meta">➕</button>`}
                    </div>
                    ${(() => {
                      const planCache = _targetValueCache[plan.id];
                      const curVal = t.target_type !== 'custom'
                        ? (planCache ? (planCache[t.id] ?? null) : null)
                        : undefined;
                      let atualHtml = '';
                      if (curVal === null) {
                        atualHtml = `<span style="color:var(--text-tertiary)">…</span> → `;
                      } else if (curVal !== undefined) {
                        const progress = targetProgressColor(t, curVal, curObjPct, curObjTime);
                        const bg  = progress === 'good'    ? 'rgba(74,186,61,0.15)'
                                  : progress === 'bad'     ? 'rgba(239,68,68,.12)'
                                  : 'var(--bg-surface-2)';
                        const clr = progress === 'good'    ? 'var(--brand-green-dark)'
                                  : progress === 'bad'     ? 'var(--color-danger)'
                                  : 'var(--text-primary)';
                        atualHtml = `<span style="background:${bg};color:${clr};border-radius:4px;padding:1px 5px;font-weight:var(--weight-semibold)">${fmtValue(curVal.pct, curVal.time)}</span> → `;
                      }
                      return `
                      <div style="color:var(--text-secondary)">
                        <strong style="color:var(--text-tertiary)">${fmtValue(t.startline_pct, t.startline_time)}</strong>
                        &nbsp;→&nbsp; ${atualHtml}${isEditingT && isTimeT ? `
                          <input type="time" id="edit-target-obj" class="form-input" step="1"
                                 value="${curObjTime ?? ''}" placeholder="HH:MM:SS"
                                 style="display:inline-block;width:90px;height:22px;padding:0 4px;font-size:10px">
                        ` : `<strong style="color:var(--brand-green-dark)">${
                            isEditingT
                              ? `<span id="edit-target-obj-val">${curObjPct ?? 0}%</span>`
                              : fmtValue(curObjPct, curObjTime)
                          }</strong>`}
                      </div>`;
                    })()}
                    ${isEditingT && !isTimeT ? `
                      <input type="range" id="edit-target-obj" min="0" max="100"
                             value="${curObjPct ?? 0}"
                             style="width:100%;accent-color:var(--brand-green);
                                    cursor:pointer;margin-top:var(--space-1)">
                    ` : ''}
                  </div>`;
              }).join('')}
            </div>` : `
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);padding:var(--space-1) 0;
                        margin-bottom:var(--space-2)">
              Nenhum objetivo cadastrado
            </div>`}
          ${_addingTarget ? renderNewTargetForm() : ''}
        </div>

        <!-- Steps -->
        <div style="padding:var(--space-5)">
          <div style="font-size:10px;font-weight:var(--weight-bold);text-transform:uppercase;
                      letter-spacing:.07em;color:var(--text-tertiary);margin-bottom:var(--space-3);
                      display:flex;justify-content:space-between;align-items:center">
            <span>Passos (${doneCount}/${steps.length} concluídos)</span>
            ${!_addingStep ? `
              <button class="btn btn--ghost" id="btn-add-step"
                      style="padding:1px 8px;font-size:10px;height:auto">+ Adicionar passo</button>` : ''}
          </div>

          ${steps.length ? `
            <div style="display:flex;flex-direction:column;gap:var(--space-2)">
              ${steps.map(step => {
                const done        = stepIsDone(step);
                const isDonePend  = step.id in _pending;
                const isEditPend  = step.id in _pendingStepEdits;
                const isStepPend  = isDonePend || isEditPend;
                const isEditingS  = _editingStepId === step.id;
                const displayDesc = _pendingStepEdits[step.id]?.description ?? step.description;
                const displayDate = _pendingStepEdits[step.id]?.start_date  ?? step.start_date;

                const milestones    = step.action_step_milestones ?? [];
                const milestoneHtml = milestones.length ? (() => {
                  const tags = milestones.map(m => {
                    const target = targetMap[m.action_plan_target_id];
                    if (!target) return '';
                    const label = targetLabel(target);
                    let text, improved;
                    if (m.milestone_pct != null) {
                      text = `${m.milestone_pct >= 0 ? '+' : ''}${m.milestone_pct}%`;
                      improved = m.milestone_pct > 0;
                    } else if (m.milestone_time != null) {
                      text = String(m.milestone_time).substring(0, 9);
                      improved = text.startsWith('-');
                    } else { return ''; }
                    const color = improved ? 'var(--brand-green-dark)' : 'var(--color-danger)';
                    const bg    = improved ? 'rgba(74,186,61,0.12)'    : 'rgba(239,68,68,.1)';
                    return `<span style="font-size:10px;border-radius:4px;padding:2px 6px;
                                        background:${bg};color:${color};font-weight:var(--weight-medium)">
                              ${label}: ${text}</span>`;
                  }).filter(Boolean).join('');
                  return tags ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:var(--space-2)">${tags}</div>` : '';
                })() : '';

                if (isEditingS) return `
                  <div style="background:var(--bg-surface-3);border-radius:var(--radius-sm);padding:var(--space-3);
                              border:1px solid var(--brand-green);display:flex;flex-direction:column;gap:var(--space-2)">
                    <input type="text" id="edit-step-desc-${step.id}" class="form-input"
                           value="${(displayDesc ?? '').replace(/"/g,'&quot;')}"
                           placeholder="Descrição do passo — use [texto](https://url) para links" style="font-size:var(--text-sm)">
                    <div style="display:flex;gap:var(--space-2);align-items:flex-end">
                      <div class="form-group" style="flex:1;margin-bottom:0">
                        <label class="form-label" style="font-size:10px">Data de início</label>
                        <input type="date" id="edit-step-date-${step.id}" class="form-input"
                               value="${displayDate ?? ''}" style="height:32px;font-size:var(--text-xs)">
                      </div>
                      <div style="display:flex;gap:var(--space-1);padding-bottom:2px">
                        <button class="btn btn--ghost btn--sm cancel-step-btn"
                                data-step-id="${step.id}">✕</button>
                        <button class="btn btn--primary btn--sm confirm-step-btn"
                                data-step-id="${step.id}">✓</button>
                      </div>
                    </div>
                  </div>`;

                return `
                  <div style="background:var(--bg-surface-3);border-radius:var(--radius-sm);
                              border:1px solid ${isStepPend ? 'var(--color-warning)' : 'transparent'};
                              transition:border-color var(--transition-fast)">
                    <label style="display:flex;align-items:flex-start;gap:var(--space-3);
                                  padding:var(--space-3);cursor:pointer;user-select:none">
                      <input type="checkbox" class="metas-step-check" data-step-id="${step.id}"
                             ${done ? 'checked' : ''} style="margin-top:2px;flex-shrink:0;cursor:pointer">
                      <div style="flex:1;min-width:0">
                        <div style="font-size:var(--text-sm);
                                    color:${done ? 'var(--text-tertiary)' : 'var(--text-primary)'};
                                    ${done ? 'text-decoration:line-through;' : ''}">
                          ${parseStepLinks(displayDesc)}
                          ${isEditPend ? '<span style="color:var(--color-warning);font-size:10px;margin-left:2px">●</span>' : ''}
                        </div>
                        ${displayDate || step.finished_at ? `
                          <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-top:2px">
                            ${displayDate ? `Início: ${formatDate(displayDate)}` : ''}
                            ${step.finished_at ? ` · Concluído: ${formatDate(step.finished_at)}` : ''}
                            ${isDonePend ? ` · <em style="color:var(--color-warning)">pendente</em>` : ''}
                          </div>` : isDonePend ? `
                          <div style="font-size:var(--text-xs);color:var(--color-warning);margin-top:2px">
                            <em>pendente</em>
                          </div>` : ''}
                        ${milestoneHtml}
                      </div>
                      <button class="step-edit-btn btn btn--ghost" data-step-id="${step.id}"
                              style="font-size:15px;height:auto;align-self:center"
                              title="Editar">⋮</button>
                    </label>
                  </div>`;
              }).join('')}
            </div>
          ` : `
            <div class="empty-state" style="padding:var(--space-6) 0">
              <div class="empty-state__title">Sem passos cadastrados</div>
            </div>
          `}
          ${_addingStep ? renderNewStepForm(plan) : ''}
        </div>
      </div>
    </div>`;
}

/* ── Inline add-target form ───────────────── */
function renderNewTargetForm() {
  const ecOpts = _evalCriteria.map(ec =>
    `<option value="eval_criteria:${ec.id}" ${_newTargetType === `eval_criteria:${ec.id}` ? 'selected' : ''}>${ec.name}</option>`
  ).join('');
  const isTime   = ['tma','tmpr','tmer'].includes(_newTargetType);
  const isCustom = _newTargetType === 'custom';
  const hasPct   = !isTime && !isCustom && _newTargetType !== '';

  return `
    <div style="background:var(--bg-surface-3);border-radius:var(--radius-sm);
                padding:var(--space-3);border:1px solid var(--brand-green)">
      <div class="form-group" style="margin-bottom:var(--space-2)">
        <label class="form-label" style="font-size:10px">Métrica</label>
        <select class="form-select" id="nt-type" style="height:30px;font-size:var(--text-xs)">
          <option value="">— selecione —</option>
          <option value="monitoring_pct" ${_newTargetType==='monitoring_pct'?'selected':''}>Pontuação de monitoria</option>
          <option value="csat"  ${_newTargetType==='csat' ?'selected':''}>CSAT</option>
          <option value="tma"   ${_newTargetType==='tma'  ?'selected':''}>TMA</option>
          <option value="tmpr"  ${_newTargetType==='tmpr' ?'selected':''}>TMPr</option>
          <option value="tmer"  ${_newTargetType==='tmer' ?'selected':''}>TMEr</option>
          ${ecOpts}
          <option value="custom" ${_newTargetType==='custom'?'selected':''}>Personalizado</option>
        </select>
      </div>
      ${isCustom ? `
        <div class="form-group" style="margin-bottom:var(--space-2)">
          <label class="form-label" style="font-size:10px">Nome do objetivo <span class="required">*</span></label>
          <input class="form-input" type="text" id="nt-custom-label"
                 style="height:30px;font-size:var(--text-xs)" placeholder="Ex: Taxa de resolução">
        </div>` : ''}
      ${hasPct ? `
        <div class="form-group" style="margin-bottom:var(--space-2)">
          <label class="form-label" style="font-size:10px">Meta:
            <span id="nt-obj-pct-val" style="font-weight:var(--weight-semibold);color:var(--brand-green-dark)">0%</span>
            <span class="required">*</span>
          </label>
          <input type="range" id="nt-obj-pct" min="0" max="100" value="0"
                 style="width:100%;accent-color:var(--brand-green);cursor:pointer">
        </div>` : ''}
      ${isTime ? `
        <div class="form-group" style="margin-bottom:var(--space-2)">
          <label class="form-label" style="font-size:10px">Meta <span class="required">*</span></label>
          <input class="form-input" type="time" id="nt-obj-time" step="1"
                 style="height:30px;font-size:var(--text-xs)">
        </div>` : ''}
      ${isCustom ? `
        <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2)">
          <div class="form-group" style="flex:1;margin-bottom:0">
            <label class="form-label" style="font-size:10px">Valor atual:
              <span id="nt-baseline-val" style="font-weight:var(--weight-semibold);color:var(--text-secondary)">0%</span>
              <span class="required">*</span>
            </label>
            <input type="range" id="nt-baseline" min="0" max="100" value="0"
                   style="width:100%;accent-color:var(--brand-green);cursor:pointer">
          </div>
          <div class="form-group" style="flex:1;margin-bottom:0">
            <label class="form-label" style="font-size:10px">Meta:
              <span id="nt-obj-custom-val" style="font-weight:var(--weight-semibold);color:var(--brand-green-dark)">0%</span>
              <span class="required">*</span>
            </label>
            <input type="range" id="nt-obj-custom" min="0" max="100" value="0"
                   style="width:100%;accent-color:var(--brand-green);cursor:pointer">
          </div>
        </div>` : ''}
      <div style="display:flex;gap:var(--space-1);justify-content:flex-end">
        <button class="btn btn--ghost btn--sm" id="cancel-new-target">✕</button>
        <button class="btn btn--primary btn--sm" id="confirm-new-target">✓ Adicionar</button>
      </div>
    </div>`;
}

/* ── Inline add-step form ─────────────────── */
function renderNewStepForm(plan) {
  const minDate = plan.start_date ?? '';
  return `
    <div style="background:var(--bg-surface-3);border-radius:var(--radius-sm);
                padding:var(--space-3);margin-top:var(--space-2);
                border:1px solid var(--brand-green);
                display:flex;flex-direction:column;gap:var(--space-2)">
      <input type="text" id="ns-desc" class="form-input"
             placeholder="Descrição do passo… — use [texto](https://url) para links" style="font-size:var(--text-sm)">
      <div style="display:flex;gap:var(--space-2);align-items:flex-end">
        <div class="form-group" style="flex:1;margin-bottom:0">
          <label class="form-label" style="font-size:10px">Data de início (opcional)</label>
          <input type="date" id="ns-date" class="form-input"
                 min="${minDate}" value="${minDate}"
                 style="height:32px;font-size:var(--text-xs)">
        </div>
        <div style="display:flex;gap:var(--space-1);padding-bottom:2px">
          <button class="btn btn--ghost btn--sm" id="cancel-new-step">✕</button>
          <button class="btn btn--primary btn--sm" id="confirm-new-step">✓ Adicionar</button>
        </div>
      </div>
    </div>`;
}

/* ── Save new step (direct insert) ───────── */
async function saveNewStep(plan) {
  const desc = document.getElementById('ns-desc')?.value.trim();
  const date = document.getElementById('ns-date')?.value || null;
  if (!desc) { toast.warning('Atenção', 'Informe a descrição do passo.'); return; }

  const btn = document.getElementById('confirm-new-step');
  if (btn) { btn.disabled = true; btn.textContent = 'Adicionando…'; }

  const { error } = await supabase.from('action_steps').insert({
    action_plan_id: plan.id,
    description:    desc,
    start_date:     date,
  });
  if (error) {
    toast.error('Erro', error.message);
    if (btn) { btn.disabled = false; btn.textContent = '✓ Adicionar'; }
    return;
  }

  _addingStep = false;
  toast.success('Passo adicionado');
  await fetchPlans();
  reloadPage();
}

/* ── Save new target (direct insert) ─────── */
async function saveNewTarget(plan) {
  const typeVal = _newTargetType;
  if (!typeVal) { toast.warning('Atenção', 'Selecione o tipo de objetivo.'); return; }

  const isTime   = ['tma','tmpr','tmer'].includes(typeVal);
  const isCustom = typeVal === 'custom';
  const isEC     = typeVal.startsWith('eval_criteria:');
  const targetType  = isEC ? 'eval_criteria' : typeVal;
  const ecId        = isEC ? typeVal.split(':')[1] : null;
  const customLabel = isCustom
    ? document.getElementById('nt-custom-label')?.value.trim() : null;
  if (isCustom && !customLabel) {
    toast.warning('Atenção', 'Informe o nome do objetivo.'); return;
  }

  let objPct = null, objTime = null, baselinePct = null;
  if (isTime) {
    objTime = document.getElementById('nt-obj-time')?.value.trim() || null;
    if (!objTime) { toast.warning('Atenção', 'Informe o tempo objetivo.'); return; }
  } else if (isCustom) {
    const baseRaw = document.getElementById('nt-baseline')?.value;
    const goalRaw = document.getElementById('nt-obj-custom')?.value;
    if (baseRaw === '' || baseRaw == null) { toast.warning('Atenção', 'Informe o valor atual.'); return; }
    if (goalRaw === '' || goalRaw == null) { toast.warning('Atenção', 'Informe o valor meta.'); return; }
    baselinePct = Number(baseRaw); objPct = Number(goalRaw);
    if ([baselinePct, objPct].some(v => isNaN(v) || v < 0 || v > 100)) {
      toast.warning('Atenção', 'Os valores devem ser 0–100.'); return;
    }
  } else {
    const rawVal = document.getElementById('nt-obj-pct')?.value;
    if (rawVal === '' || rawVal == null) { toast.warning('Atenção', 'Informe o valor objetivo.'); return; }
    objPct = Number(rawVal);
    if (isNaN(objPct) || objPct < 0 || objPct > 100) { toast.warning('Atenção', 'O valor deve ser 0–100.'); return; }
  }

  const btn = document.getElementById('confirm-new-target');
  if (btn) { btn.disabled = true; btn.textContent = 'Calculando…'; }

  let startlinePct = isCustom ? baselinePct : null;
  let startlineTime = null;
  if (!isCustom) {
    const { mons, topicMap } = await fetchScopeMonitoringData(plan.scope_type, plan.scope_id);
    const val = computeTargetCurrentValue({ target_type: targetType, eval_criteria_id: ecId }, mons, topicMap);
    startlinePct  = isTime ? null : (val.pct  ?? 0);
    startlineTime = isTime ? (val.time ?? '00:00:00') : null;
  }

  if (btn) btn.textContent = 'Adicionando…';

  const { error } = await supabase.from('action_plan_targets').insert({
    action_plan_id:   plan.id,
    target_type:      targetType,
    eval_criteria_id: ecId || null,
    custom_label:     customLabel || null,
    objective_pct:    objPct,
    objective_time:   objTime,
    startline_pct:    startlinePct,
    startline_time:   startlineTime,
  });
  if (error) {
    toast.error('Erro', error.message);
    if (btn) { btn.disabled = false; btn.textContent = '✓ Adicionar'; }
    return;
  }

  _addingTarget  = false;
  _newTargetType = '';
  delete _targetValueCache[plan.id];   // new target needs fresh computation
  toast.success('Objetivo adicionado');
  await fetchPlans();
  reloadPage();
}

/* ── Save step changes ────────────────────── */
async function saveStepChanges() {
  const btn = document.getElementById('btn-save-steps');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }

  try {
    const today   = new Date().toISOString().split('T')[0];
    const writes  = Object.entries(_pending).map(([stepId, isDone]) =>
      supabase.from('action_steps')
        .update({ finished_at: isDone ? today : null })
        .eq('id', stepId)
    );
    if (_pendingFinished !== null) {
      writes.push(
        supabase.from('action_plans')
          .update({ finished_at: _pendingFinished ? today : null })
          .eq('id', _selectedId)
      );
    }
    const completedStepIds = Object.entries(_pending)
      .filter(([, isDone]) => isDone)
      .map(([stepId]) => stepId);

    /* Step content edits */
    for (const [stepId, edits] of Object.entries(_pendingStepEdits)) {
      if (Object.keys(edits).length)
        writes.push(supabase.from('action_steps').update(edits).eq('id', stepId));
    }
    /* Plan field edits */
    if (Object.keys(_pendingPlanEdits).length)
      writes.push(supabase.from('action_plans').update(_pendingPlanEdits).eq('id', _selectedId));
    /* Target objective edits */
    for (const [targetId, edits] of Object.entries(_pendingTargetEdits)) {
      if (Object.keys(edits).length)
        writes.push(supabase.from('action_plan_targets').update(edits).eq('id', targetId));
    }

    await Promise.all(writes);

    /* Compute and persist milestones for newly finished steps */
    const plan = _plans?.find(p => p.id === _selectedId);
    if (plan && completedStepIds.length) {
      await saveStepMilestones(plan, completedStepIds);
    }

    _pending            = {};
    _pendingFinished    = null;
    _pendingStepEdits   = {};
    _pendingPlanEdits   = {};
    _pendingTargetEdits = {};
    _editingStepId    = null;
    _editingPlanField = null;
    _editingTargetId  = null;
    toast.success('Alterações salvas');
    await fetchPlans();
    reloadPage();
  } catch (err) {
    toast.error('Erro ao salvar', err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar alterações'; }
  }
}

/* ── Partial re-render: detail panel only ── */
function refreshDetail() {
  const el   = document.getElementById('metas-detail');
  const plan = _plans?.find(p => p.id === _selectedId);
  if (!el) return;
  el.innerHTML = plan ? renderPlanDetail(plan) : '';
  bindDetailEvents();
  if (plan && !(_selectedId in _targetValueCache)) {
    loadCurrentTargetValues(plan);
  }
}

/* ── Full page reload ─────────────────────── */
function reloadPage() {
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = render();
  bindEvents();
  if (_selectedId) refreshDetail();
}

/* ── Delete plan ──────────────────────────── */
async function deletePlan(planId) {
  const ok = confirm('Excluir este plano de ação? Esta ação não pode ser desfeita.');
  if (!ok) return;

  const hardDelete = _currentUser?.accessLevel >= 4;
  const { error } = hardDelete
    ? await supabase.from('action_plans').delete().eq('id', planId)
    : await supabase.from('action_plans').update({ active: false }).eq('id', planId);
  if (error) { toast.error('Erro ao excluir', error.message); return; }

  _selectedId         = null;
  _pending            = {};
  _pendingFinished    = null;
  _pendingStepEdits   = {};
  _pendingPlanEdits   = {};
  _pendingTargetEdits = {};
  _editingStepId      = null;
  _editingPlanField   = null;
  _editingTargetId    = null;
  _addingStep         = false;
  _addingTarget       = false;
  _newTargetType      = '';

  toast.success('Plano excluído');
  await fetchPlans();
  reloadPage();
}

/* ── Apply selected card state (no re-render) */
function applySelectedCard(planId) {
  document.querySelectorAll('.metas-plan-card').forEach(card => {
    const sel = card.dataset.planId === planId;
    card.style.borderColor = sel ? 'var(--brand-green)' : 'var(--border)';
    card.style.background  = sel ? 'var(--brand-green-muted)' : 'var(--bg-surface)';
    const btn = card.querySelector('.metas-delete-plan');
    if (btn) {
      btn.style.maxWidth      = sel ? '28px' : '0';
      btn.style.opacity       = sel ? '1'    : '0';
      btn.style.pointerEvents = sel ? 'auto' : 'none';
    }
  });
}

/* ── Event binding ────────────────────────── */
function bindEvents() {
  // Scope filter tabs
  document.querySelectorAll('.metas-scope-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _filterScope = btn.dataset.scope;
      reloadPage();
    });
  });

  // Plan delete button
  document.querySelectorAll('.metas-delete-plan').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deletePlan(btn.dataset.planId);
    });
  });

  // Plan card selection
  document.querySelectorAll('.metas-plan-card').forEach(card => {
    card.addEventListener('click', () => {
      const newId = card.dataset.planId;
      if (newId === _selectedId) return;

      if (hasPending()) {
        const ok = confirm('Há alterações não salvas. Deseja descartar e continuar?');
        if (!ok) return;
        _pending            = {};
        _pendingFinished    = null;
        _pendingStepEdits   = {};
        _pendingPlanEdits   = {};
        _pendingTargetEdits = {};
        _editingStepId      = null;
        _editingPlanField   = null;
        _editingTargetId    = null;
        _addingStep   = false;
        _addingTarget = false;
        _newTargetType = '';
      }

      _selectedId = newId;
      applySelectedCard(newId);
      refreshDetail();
    });
  });

  /* ── New plan modal ── */
  document.getElementById('btn-new-plan-metas')?.addEventListener('click', openMetasPlanModal);
  document.getElementById('mnp-close')?.addEventListener('click', closeMetasPlanModal);
  document.getElementById('mnp-cancel')?.addEventListener('click', closeMetasPlanModal);
  document.getElementById('mnp-modal')?.addEventListener('click',
    e => { if (e.target.id === 'mnp-modal') closeMetasPlanModal(); });
  document.getElementById('mnp-save')?.addEventListener('click', saveMetasPlan);
  document.getElementById('mnp-add-target')?.addEventListener('click', addMetasTargetRow);
  document.getElementById('mnp-add-step')?.addEventListener('click', addMetasStepRow);
  document.getElementById('mnp-scope-type')?.addEventListener('change', async e => {
    fillMetasScopeSelect([{ id: '', name: 'Carregando…' }]);
    const opts = await loadMetasScopeOpts(e.target.value);
    fillMetasScopeSelect(opts);
  });
  document.getElementById('mnp-start-date')?.addEventListener('change', e => {
    const min = e.target.value;
    document.querySelectorAll('[id^="mnp-step-date-"]').forEach(input => {
      input.min = min;
      if (input.value && input.value < min) input.value = min;
    });
  });

  bindDetailEvents();
}

function bindDetailEvents() {
  /* ── Plan finished checkbox ── */
  document.getElementById('plan-finished-check')?.addEventListener('change', e => {
    const plan = _plans?.find(p => p.id === _selectedId);
    if (!plan) return;
    const newChecked   = e.target.checked;
    const originalDone = plan.finished_at != null;
    _pendingFinished   = newChecked === originalDone ? null : newChecked;
    for (const step of (plan.action_steps ?? [])) {
      if (step.finished_at != null) continue;
      if (newChecked) { _pending[step.id] = true; }
      else            { delete _pending[step.id]; }
    }
    refreshDetail();
  });

  /* ── Step checkboxes ── */
  document.querySelectorAll('.metas-step-check').forEach(chk => {
    chk.addEventListener('change', () => {
      const stepId = chk.dataset.stepId;
      const plan   = _plans?.find(p => p.id === _selectedId);
      const step   = plan?.action_steps?.find(s => s.id === stepId);
      if (!step) return;
      const originalDone = step.finished_at != null;
      if (chk.checked === originalDone) { delete _pending[stepId]; }
      else                              { _pending[stepId] = chk.checked; }
      refreshDetail();
    });
  });

  /* ── Save button ── */
  document.getElementById('btn-save-steps')?.addEventListener('click', saveStepChanges);

  /* ── Plan field editing (title, start_date) ── */
  document.querySelectorAll('.plan-field-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      _editingPlanField = _editingPlanField === btn.dataset.field ? null : btn.dataset.field;
      refreshDetail();
    });
  });

  document.querySelectorAll('.confirm-plan-field').forEach(btn => {
    btn.addEventListener('click', () => {
      const plan = _plans?.find(p => p.id === _selectedId);

      const titleVal = document.getElementById('edit-plan-title')?.value.trim() ?? '';
      if (titleVal === (plan?.title ?? '')) { delete _pendingPlanEdits.title; }
      else                                  { _pendingPlanEdits.title = titleVal; }

      const dateVal = document.getElementById('edit-plan-start-date')?.value ?? '';
      if (dateVal === (plan?.start_date ?? '')) { delete _pendingPlanEdits.start_date; }
      else if (dateVal)                         { _pendingPlanEdits.start_date = dateVal; }

      const visEl = document.getElementById('edit-plan-emp-visible');
      if (visEl) {
        const newVis = visEl.checked;
        if (newVis === plan?.emp_visible) { delete _pendingPlanEdits.emp_visible; }
        else                              { _pendingPlanEdits.emp_visible = newVis; }
      }

      _editingPlanField = null;
      refreshDetail();
    });
  });

  document.querySelectorAll('.cancel-plan-field').forEach(btn => {
    btn.addEventListener('click', () => { _editingPlanField = null; refreshDetail(); });
  });

  /* ── Target objective editing ── */
  document.querySelectorAll('.target-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _editingTargetId = _editingTargetId === btn.dataset.targetId ? null : btn.dataset.targetId;
      refreshDetail();
    });
  });

  document.getElementById('edit-target-obj')?.addEventListener('input', e => {
    const lbl = document.getElementById('edit-target-obj-val');
    if (lbl) lbl.textContent = `${e.target.value}%`;
  });

  document.querySelectorAll('.confirm-target-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const plan   = _plans?.find(p => p.id === _selectedId);
      const target = plan?.action_plan_targets?.find(t => t.id === _editingTargetId);
      if (target) {
        const isTime = ['tma','tmpr','tmer'].includes(target.target_type);
        const val    = document.getElementById('edit-target-obj')?.value.trim();
        if (val != null && val !== '') {
          const orig   = isTime ? target.objective_time : target.objective_pct;
          const newVal = isTime ? val : Number(val);
          if (String(newVal) === String(orig)) { delete _pendingTargetEdits[_editingTargetId]; }
          else { _pendingTargetEdits[_editingTargetId] = isTime ? { objective_time: val } : { objective_pct: Number(val) }; }
        }
      }
      _editingTargetId = null;
      refreshDetail();
    });
  });

  document.querySelectorAll('.cancel-target-btn').forEach(btn => {
    btn.addEventListener('click', () => { _editingTargetId = null; refreshDetail(); });
  });

  /* ── Step content editing ── */
  document.querySelectorAll('.step-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      _editingStepId = _editingStepId === btn.dataset.stepId ? null : btn.dataset.stepId;
      refreshDetail();
    });
  });

  document.querySelectorAll('.confirm-step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const stepId = btn.dataset.stepId;
      const plan   = _plans?.find(p => p.id === _selectedId);
      const step   = plan?.action_steps?.find(s => s.id === stepId);
      if (step) {
        const desc  = document.getElementById(`edit-step-desc-${stepId}`)?.value.trim() ?? '';
        const date  = document.getElementById(`edit-step-date-${stepId}`)?.value || null;
        const edits = {};
        if (desc !== (step.description ?? ''))  edits.description = desc;
        if (date !== (step.start_date  ?? null)) edits.start_date  = date;
        if (Object.keys(edits).length) { _pendingStepEdits[stepId] = edits; }
        else                           { delete _pendingStepEdits[stepId]; }
      }
      _editingStepId = null;
      refreshDetail();
    });
  });

  document.querySelectorAll('.cancel-step-btn').forEach(btn => {
    btn.addEventListener('click', () => { _editingStepId = null; refreshDetail(); });
  });

  /* ── Inline add-target ── */
  document.getElementById('btn-add-target')?.addEventListener('click', async () => {
    if (!_evalCriteria.length) {
      const { data } = await supabase.from('eval_criteria').select('id, name').eq('active', true).order('name');
      _evalCriteria = data ?? [];
    }
    _addingTarget  = true;
    _newTargetType = '';
    refreshDetail();
  });
  document.getElementById('nt-type')?.addEventListener('change', e => {
    _newTargetType = e.target.value;
    refreshDetail();
  });
  ['nt-obj-pct', 'nt-baseline', 'nt-obj-custom'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', e => {
      document.getElementById(`${id}-val`).textContent = `${e.target.value}%`;
    });
  });
  document.getElementById('cancel-new-target')?.addEventListener('click', () => {
    _addingTarget  = false;
    _newTargetType = '';
    refreshDetail();
  });
  document.getElementById('confirm-new-target')?.addEventListener('click', () => {
    const plan = _plans?.find(p => p.id === _selectedId);
    if (plan) saveNewTarget(plan);
  });

  /* ── Inline add-step ── */
  document.getElementById('btn-add-step')?.addEventListener('click', () => {
    _addingStep = true;
    refreshDetail();
  });
  document.getElementById('cancel-new-step')?.addEventListener('click', () => {
    _addingStep = false;
    refreshDetail();
  });
  document.getElementById('confirm-new-step')?.addEventListener('click', () => {
    const plan = _plans?.find(p => p.id === _selectedId);
    if (plan) saveNewStep(plan);
  });
}

/* ── New plan modal — scope helpers ──────── */
async function loadMetasScopeOpts(type) {
  if (_mnpScopeOpts[type]) return _mnpScopeOpts[type];
  const table = TABLE_MAP[type];
  if (!table) return [];
  let q = supabase.from(table).select('id, name').order('name');
  if (ACTIVE_TABLES.has(table)) q = q.eq('active', true);
  const { data } = await q;
  _mnpScopeOpts[type] = data ?? [];
  return _mnpScopeOpts[type];
}

function fillMetasScopeSelect(opts) {
  const el = document.getElementById('mnp-scope-id');
  if (!el) return;
  el.innerHTML = `<option value="">— selecione —</option>` +
    opts.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
}

async function openMetasPlanModal() {
  _mnpRowCount  = 0;
  _mnpStepCount = 0;

  const titleEl = document.getElementById('mnp-title');
  if (titleEl) titleEl.value = '';

  const dateEl = document.getElementById('mnp-start-date');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];

  const visEl = document.getElementById('mnp-emp-visible');
  if (visEl) visEl.checked = true;

  const scopeTypeEl = document.getElementById('mnp-scope-type');
  if (scopeTypeEl) scopeTypeEl.value = 'employee';

  const targetRows = document.getElementById('mnp-target-rows');
  if (targetRows) targetRows.innerHTML = '';
  const stepRows = document.getElementById('mnp-step-rows');
  if (stepRows) stepRows.innerHTML = '';

  document.getElementById('mnp-modal')?.classList.remove('modal-overlay--hidden');

  const [opts] = await Promise.all([
    loadMetasScopeOpts('employee'),
    _evalCriteria.length ? Promise.resolve() :
      supabase.from('eval_criteria').select('id, name').eq('active', true).order('name')
        .then(({ data }) => { _evalCriteria = data ?? []; }),
  ]);

  fillMetasScopeSelect(opts);
  addMetasTargetRow();
  addMetasStepRow();
}

function closeMetasPlanModal() {
  document.getElementById('mnp-modal')?.classList.add('modal-overlay--hidden');
}

function addMetasTargetRow() {
  const container = document.getElementById('mnp-target-rows');
  if (!container) return;

  const idx    = _mnpRowCount++;
  const ecOpts = _evalCriteria.map(ec =>
    `<option value="eval_criteria:${ec.id}">${ec.name}</option>`
  ).join('');

  const wrapper = document.createElement('div');
  wrapper.id = `mnp-row-${idx}`;
  wrapper.innerHTML = `
    <div style="background:var(--bg-surface-3);border-radius:var(--radius-sm);
                padding:var(--space-3);position:relative">
      ${idx > 0 ? `
        <button class="btn btn--ghost btn--sm mnp-remove-target" data-row="${idx}"
                style="position:absolute;top:6px;right:6px;padding:2px 7px;font-size:11px">✕</button>
      ` : ''}
      <div class="form-group" style="margin-bottom:var(--space-2)">
        <label class="form-label">Métrica</label>
        <select class="form-select" id="mnp-type-${idx}" data-row="${idx}">
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
      <div id="mnp-custom-label-wrap-${idx}" class="form-group"
           style="margin-bottom:var(--space-2);display:none">
        <label class="form-label">Nome do objetivo <span class="required">*</span></label>
        <input class="form-input" type="text" id="mnp-custom-label-${idx}"
               placeholder="Ex: Taxa de resolução">
      </div>
      <div style="display:flex;gap:var(--space-3)">
        <div class="form-group" id="mnp-obj-pct-wrap-${idx}"
             style="flex:1;margin-bottom:0;display:none">
          <label class="form-label">Meta: <span id="mnp-obj-pct-${idx}-val"
                 style="font-weight:var(--weight-semibold);color:var(--brand-green-dark)">0%</span>
                 <span class="required">*</span></label>
          <input type="range" min="0" max="100" value="0" id="mnp-obj-pct-${idx}"
                 style="width:100%;accent-color:var(--brand-green);cursor:pointer">
        </div>
        <div class="form-group" id="mnp-obj-time-wrap-${idx}"
             style="flex:1;margin-bottom:0;display:none">
          <label class="form-label">Meta <span class="required">*</span></label>
          <input class="form-input" type="time" step="1" id="mnp-obj-time-${idx}">
        </div>
        <div class="form-group" id="mnp-obj-custom-wrap-${idx}"
             style="flex:1;margin-bottom:0;display:none">
          <label class="form-label">Valor atual: <span id="mnp-baseline-${idx}-val"
                 style="font-weight:var(--weight-semibold);color:var(--text-secondary)">0%</span>
                 <span class="required">*</span></label>
          <input type="range" min="0" max="100" value="0" id="mnp-baseline-${idx}"
                 style="width:100%;accent-color:var(--brand-green);cursor:pointer">
        </div>
        <div class="form-group" id="mnp-obj-custom-goal-wrap-${idx}"
             style="flex:1;margin-bottom:0;display:none">
          <label class="form-label">Meta: <span id="mnp-obj-custom-${idx}-val"
                 style="font-weight:var(--weight-semibold);color:var(--brand-green-dark)">0%</span>
                 <span class="required">*</span></label>
          <input type="range" min="0" max="100" value="0" id="mnp-obj-custom-${idx}"
                 style="width:100%;accent-color:var(--brand-green);cursor:pointer">
        </div>
      </div>
    </div>`;

  container.appendChild(wrapper);

  document.getElementById(`mnp-type-${idx}`)?.addEventListener('change', e => {
    const typeVal  = e.target.value;
    const isTime   = ['tma', 'tmpr', 'tmer'].includes(typeVal);
    const isCustom = typeVal === 'custom';
    const hasPct   = !isTime && !isCustom && typeVal !== '';
    document.getElementById(`mnp-obj-pct-wrap-${idx}`).style.display          = hasPct   ? '' : 'none';
    document.getElementById(`mnp-obj-time-wrap-${idx}`).style.display         = isTime   ? '' : 'none';
    document.getElementById(`mnp-obj-custom-wrap-${idx}`).style.display       = isCustom ? '' : 'none';
    document.getElementById(`mnp-obj-custom-goal-wrap-${idx}`).style.display  = isCustom ? '' : 'none';
    document.getElementById(`mnp-custom-label-wrap-${idx}`).style.display     = isCustom ? '' : 'none';
  });

  [`mnp-obj-pct-${idx}`, `mnp-baseline-${idx}`, `mnp-obj-custom-${idx}`].forEach(id => {
    document.getElementById(id)?.addEventListener('input', e => {
      document.getElementById(`${id}-val`).textContent = `${e.target.value}%`;
    });
  });

  wrapper.querySelector(`.mnp-remove-target[data-row="${idx}"]`)
    ?.addEventListener('click', () => wrapper.remove());
}

function addMetasStepRow() {
  const container = document.getElementById('mnp-step-rows');
  if (!container) return;

  const idx     = _mnpStepCount++;
  const minDate = document.getElementById('mnp-start-date')?.value ?? '';
  const wrapper = document.createElement('div');
  wrapper.id    = `mnp-step-${idx}`;
  wrapper.innerHTML = `
    <div style="background:var(--bg-surface-3);border-radius:var(--radius-sm);
                padding:var(--space-3);position:relative">
      ${idx > 0 ? `
        <button class="mnp-remove-step"
                style="position:absolute;top:6px;right:6px;
                       background:none;border:none;cursor:pointer;
                       font-size:11px;color:var(--text-tertiary);
                       padding:2px 6px;border-radius:var(--radius-sm)">✕</button>
      ` : ''}
      <div class="form-group" style="margin-bottom:var(--space-2)">
        <label class="form-label">Descrição <span class="required">*</span></label>
        <input class="form-input" type="text" id="mnp-step-desc-${idx}"
               placeholder="Descreva o passo…">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">
          Data de início
          <span style="font-weight:var(--weight-normal);color:var(--text-tertiary)">(opcional)</span>
        </label>
        <input class="form-input" type="date" id="mnp-step-date-${idx}"
               min="${minDate}" value="${minDate}">
      </div>
    </div>`;

  container.appendChild(wrapper);
  wrapper.querySelector('.mnp-remove-step')?.addEventListener('click', () => wrapper.remove());
}

async function saveMetasPlan() {
  const scopeType = document.getElementById('mnp-scope-type')?.value;
  const scopeId   = document.getElementById('mnp-scope-id')?.value;
  const title     = document.getElementById('mnp-title')?.value.trim() || null;
  const startDate = document.getElementById('mnp-start-date')?.value;
  const empVisible = document.getElementById('mnp-emp-visible')?.checked ?? true;

  if (!scopeId)   { toast.warning('Atenção', 'Selecione o destinatário do plano.'); return; }
  if (!startDate) { toast.warning('Atenção', 'Informe a data de início.'); return; }

  const rows = document.querySelectorAll('#mnp-target-rows > div');
  if (!rows.length) { toast.warning('Atenção', 'Adicione ao menos um objetivo.'); return; }

  const targets = [];
  for (const row of rows) {
    const idx     = row.id.replace('mnp-row-', '');
    const typeVal = document.getElementById(`mnp-type-${idx}`)?.value;
    if (!typeVal) { toast.warning('Atenção', 'Selecione o tipo de cada objetivo.'); return; }

    const isTime   = ['tma', 'tmpr', 'tmer'].includes(typeVal);
    const isCustom = typeVal === 'custom';
    const isEC     = typeVal.startsWith('eval_criteria:');

    const targetType  = isEC ? 'eval_criteria' : typeVal;
    const ecId        = isEC ? typeVal.split(':')[1] : null;
    const customLabel = isCustom
      ? document.getElementById(`mnp-custom-label-${idx}`)?.value.trim() : null;
    if (isCustom && !customLabel) {
      toast.warning('Atenção', 'Informe o nome do objetivo personalizado.'); return;
    }

    let objPct = null, objTime = null, baselinePct = null;
    if (isTime) {
      objTime = document.getElementById(`mnp-obj-time-${idx}`)?.value.trim() || null;
      if (!objTime) { toast.warning('Atenção', 'Informe o tempo objetivo.'); return; }
    } else if (isCustom) {
      const baseRaw = document.getElementById(`mnp-baseline-${idx}`)?.value;
      const goalRaw = document.getElementById(`mnp-obj-custom-${idx}`)?.value;
      if (baseRaw === '' || baseRaw == null) { toast.warning('Atenção', 'Informe o valor atual do objetivo personalizado.'); return; }
      if (goalRaw === '' || goalRaw == null) { toast.warning('Atenção', 'Informe o valor meta do objetivo personalizado.'); return; }
      baselinePct = Number(baseRaw);
      objPct      = Number(goalRaw);
      if ([baselinePct, objPct].some(v => isNaN(v) || v < 0 || v > 100)) {
        toast.warning('Atenção', 'Os valores devem estar entre 0 e 100.'); return;
      }
    } else {
      const rawVal = document.getElementById(`mnp-obj-pct-${idx}`)?.value;
      if (rawVal === '' || rawVal == null) { toast.warning('Atenção', 'Informe o valor objetivo.'); return; }
      objPct = Number(rawVal);
      if (isNaN(objPct) || objPct < 0 || objPct > 100) {
        toast.warning('Atenção', 'O valor deve estar entre 0 e 100.'); return;
      }
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

  /* Compute startlines for non-custom targets from all-time scope data */
  const saveBtn = document.getElementById('mnp-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Calculando baseline…'; }

  if (targets.some(t => !t._isCustom)) {
    const { mons, topicMap } = await fetchScopeMonitoringData(scopeType, scopeId);
    for (const t of targets) {
      if (t._isCustom) continue;
      const isTime = ['tma','tmpr','tmer'].includes(t.target_type);
      const val    = computeTargetCurrentValue(t, mons, topicMap);
      t.startline_pct  = isTime ? null : (val.pct  ?? 0);
      t.startline_time = isTime ? (val.time ?? '00:00:00') : null;
    }
  }
  targets.forEach(t => delete t._isCustom);

  /* Collect steps before any DB write — empty rows are skipped (steps are optional) */
  const rawSteps = [];
  for (const el of document.querySelectorAll('#mnp-step-rows > div')) {
    const idx  = el.id.replace('mnp-step-', '');
    const desc = document.getElementById(`mnp-step-desc-${idx}`)?.value.trim();
    const date = document.getElementById(`mnp-step-date-${idx}`)?.value || null;
    if (desc) rawSteps.push({ description: desc, start_date: date });
  }

  if (saveBtn) saveBtn.textContent = 'Criando…';

  try {
    const { data: plan, error: planErr } = await supabase
      .from('action_plans')
      .insert({
        created_by:  _currentUser.id,
        start_date:  startDate,
        emp_visible: empVisible,
        title,
        scope_type:  scopeType,
        scope_id:    scopeId,
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

    closeMetasPlanModal();
    toast.success('Plano criado');
    await fetchPlans();
    reloadPage();
  } catch (err) {
    toast.error('Erro ao criar plano', err.message);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Criar plano'; }
  }
}

/* ── init ─────────────────────────────────── */
export async function init() {
  _currentUser = getCurrentUser();
  _pending            = {};
  _pendingFinished    = null;
  _pendingStepEdits   = {};
  _pendingPlanEdits   = {};
  _pendingTargetEdits = {};
  _editingStepId      = null;
  _editingPlanField   = null;
  _editingTargetId    = null;
  _addingStep       = false;
  _addingTarget     = false;
  _newTargetType    = '';
  _targetValueCache = {};
  _plans            = null;

  /* Render immediately so the DOM never shows stale data from a previous navigation */
  const main = document.getElementById('main-content');
  if (main) main.innerHTML = render();

  if (!can(_currentUser, P.SIDEBAR_GOALS)) return;

  /* Pre-select a plan if navigated here from consulta */
  const { planId } = getRouteParams();
  if (planId) _selectedId = planId;

  try {
    await fetchPlans();
  } catch (err) {
    console.error('[metas] fetchPlans failed:', err);
    if (main?.isConnected) {
      main.innerHTML = `
        <div class="page-enter" style="padding:var(--space-8)">
          <div class="empty-state">
            <div class="empty-state__icon">⚠</div>
            <div class="empty-state__title">Erro ao carregar planos</div>
            <div class="empty-state__desc">Tente recarregar a página.</div>
          </div>
        </div>`;
    }
    return;
  }
  reloadPage();
}
