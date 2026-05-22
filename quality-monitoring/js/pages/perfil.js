/* ============================================================
   PERFIL — Perfil individual do colaborador
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { getRouteParams } from '../router.js';
import { supabase } from '../supabase.js';
import { can, P } from '../utils/permissions.js';
import {
  formatDate, resultBand, scoreColor, scoreColorHex, getInitials,
} from '../utils/formatters.js';
import { renderRadarChart, renderHistoryChartFull, destroyAll } from '../components/charts.js';

/* ── Module state ─────────────────────────── */
let _employee    = null;   // {id, name, team_id}
let _supervisor  = null;   // {id, name}
let _monitorings = [];     // [{id, date, zeroed, pct, radarPcts, avgCsat}]
let _obsLog      = [];     // [{typeCode, typeLabel, criteriaName, content, protocol, monDate}]
let _evalCriteria = [];    // [{id, name}]  — cached across navigations
let _topicMap    = {};     // {topicId: {eval_criteria_id, points}} — cached
let _loadedEmpId = null;   // cache key

/* ── Obs type code → display ──────────────── */
const OBS_TYPE = {
  default:        { code: 'G', label: 'Geral' },
  improvable_by:  { code: 'O', label: 'Oportunidade' },
  excelled_by:    { code: 'A', label: 'Acerto' },
  failed_by:      { code: 'E', label: 'Erro' },
};

/* ── Compute scored monitorings from raw rows ── */
function computeMonData(rawMons) {
  return rawMons.map(mon => {
    let earned = 0, total = 0;
    const earnedByC = {}, maxByC = {};

    for (const ta of (mon.topic_approval ?? [])) {
      const t = _topicMap[ta.topic_id];
      if (!t) continue;
      const cid = t.eval_criteria_id;
      maxByC[cid]    = (maxByC[cid]    ?? 0) + t.points;
      total          += t.points;
      if (ta.obtained) {
        earnedByC[cid] = (earnedByC[cid] ?? 0) + t.points;
        earned         += t.points;
      }
    }

    const pct = total > 0 ? Math.round(earned / total * 100) : 0;
    const radarPcts = {};
    for (const [cid, m] of Object.entries(maxByC)) {
      radarPcts[cid] = m > 0 ? Math.round((earnedByC[cid] ?? 0) / m * 100) : 0;
    }

    const csats = (mon.service_chat ?? []).filter(sc => sc.csat).map(sc => sc.csat);
    const avgCsat = csats.length
      ? Math.round(csats.reduce((a, b) => a + b, 0) / csats.length * 10) / 10
      : 0;

    return { id: mon.id, date: mon.date, zeroed: mon.zeroed, pct, radarPcts, avgCsat };
  });
}

/* ── render() ─────────────────────────────── */
export function render() {
  if (!_employee) {
    return `
      <div class="profile-page page-enter"
           style="display:flex;align-items:center;justify-content:center;height:300px;gap:12px;color:var(--text-secondary)">
        <div class="boot-spinner" style="width:20px;height:20px;border-width:2px"></div>
        Carregando perfil…
      </div>`;
  }

  const count    = _monitorings.length;
  const avgPct   = count ? Math.round(_monitorings.reduce((s, m) => s + m.pct, 0) / count) : 0;
  const zeroed   = _monitorings.filter(m => m.zeroed).length;
  const lastDate = _monitorings.length ? _monitorings[_monitorings.length - 1].date : null;

  const csatVals  = _monitorings.filter(m => m.avgCsat).map(m => m.avgCsat);
  const avgCsat   = csatVals.length
    ? Math.round(csatVals.reduce((a, b) => a + b, 0) / csatVals.length * 10) / 10
    : null;

  /* Category breakdown (avg per eval_criteria across all monitorings) */
  const catBreakdown = _evalCriteria.map(ec => {
    const vals = _monitorings.map(m => m.radarPcts[ec.id] ?? 0);
    const avg  = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    return { name: ec.name, pct: avg };
  });

  /* Obs log HTML — only for users with Profile.canViewObs */
  const canViewObs = can(getCurrentUser(), P.PROFILE_VIEW_OBS);
  const obsLogHtml = !canViewObs ? null : _obsLog.length
    ? _obsLog.map(o => `
        <div class="obs-log-item obs-log-item--${o.code}">
          <div class="obs-log-item__badge obs-log-item__badge--${o.code}">${o.code}</div>
          <div class="obs-log-item__body">
            ${o.criteriaName ? `<div class="obs-log-item__criteria">${o.criteriaName}</div>` : ''}
            <div class="obs-log-item__text">${o.content}</div>
            <div class="obs-log-item__meta">
              ${o.monDate ? formatDate(o.monDate) : ''}
              ${o.protocol ? ` · Prot. ${o.protocol}` : ''}
            </div>
          </div>
        </div>`).join('')
    : `<div class="empty-state" style="padding:var(--space-6)">
         <div class="empty-state__title">Sem observações</div>
       </div>`;

  return `
    <div class="profile-page page-enter">
      <!-- Hero -->
      <div class="profile-hero">
        <div class="profile-hero__top">
          <div class="profile-hero__avatar">${getInitials(_employee.name)}</div>
          <div class="profile-hero__info">
            <div class="profile-hero__name">${_employee.name}</div>
            <div class="profile-hero__meta">${_supervisor?.name ?? '—'}</div>
            <div class="profile-hero__badges">
              ${lastDate ? `<span class="badge badge--neutral">Última monitoria: ${formatDate(lastDate)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="profile-hero__stats">
          <div class="profile-stat">
            <div class="profile-stat__val">${count}</div>
            <div class="profile-stat__lbl">Monitorias</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat__val" style="color:${scoreColor(avgPct)}">${count ? avgPct + '%' : '—'}</div>
            <div class="profile-stat__lbl">Aproveit. médio</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat__val">${avgCsat ? avgCsat + ' ★' : '—'}</div>
            <div class="profile-stat__lbl">CSAT médio</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat__val" style="color:${zeroed > 0 ? 'var(--color-danger)' : 'inherit'}">${zeroed}</div>
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
            <div class="radar-chart-wrapper" style="max-width:260px">
              <canvas id="chart-radar" width="260" height="260"></canvas>
            </div>
            <div class="category-breakdown">
              ${catBreakdown.map(c => `
                <div>
                  <div class="cat-row">
                    <div class="cat-row__name">${c.name.split(' ')[0]}</div>
                    <div class="cat-row__val" style="color:${scoreColor(c.pct)}">${c.pct}%</div>
                  </div>
                  <div class="cat-row__bar-wrap">
                    <div class="cat-row__bar-fill" style="width:${c.pct}%;background:${scoreColor(c.pct)}"></div>
                  </div>
                </div>`).join('')}
            </div>
          </div>
        </div>

        <!-- History chart -->
        <div class="history-panel panel">
          <div class="panel__header"><div class="panel__title">Histórico de Resultados</div></div>
          <div class="panel__body">
            <div class="chart-container chart-h-250">
              <canvas id="chart-history" height="250"></canvas>
            </div>
          </div>
        </div>
      </div>

      ${obsLogHtml !== null ? `
      <!-- Observations log -->
      <div class="panel">
        <div class="panel__header">
          <div class="panel__title">Observações Qualitativas</div>
          <span class="badge badge--neutral">${_obsLog.length}</span>
        </div>
        <div class="panel__body panel__body--compact">
          <div class="obs-log">${obsLogHtml}</div>
        </div>
      </div>` : ''}
    </div>`;
}

/* ── Charts ───────────────────────────────── */
function initCharts() {
  const radarLabels = _evalCriteria.map(ec => ec.name.split(' ')[0]);
  const radarData   = _evalCriteria.map(ec => {
    const vals = _monitorings.map(m => m.radarPcts[ec.id] ?? 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  });

  renderRadarChart(
    'chart-radar',
    radarLabels,
    [{ label: _employee.name.split(' ')[0], data: radarData }]
  );

  if (_monitorings.length) {
    renderHistoryChartFull(
      'chart-history',
      _monitorings.map(m => formatDate(m.date)),
      _monitorings.map(m => m.pct),
      _monitorings.map(m => scoreColorHex(m.pct))
    );
  }
}

/* ── Access control ───────────────────────── */
// RLS enforces row-level access at the DB. If the employee was fetched, access is granted.
// GLOBAL_VIEW_DEPT is kept as an explicit frontend guard for future cached-state edge cases.
function isAllowed(user, _empId, employee) {
  if (can(user, P.GLOBAL_VIEW_DEPT)) return true;
  return !!employee;
}

function renderDenied() {
  const main = document.getElementById('main-content');
  if (main) main.innerHTML = `
    <div class="page-enter">
      <div class="empty-state">
        <div class="empty-state__icon">🔒</div>
        <div class="empty-state__title">Acesso não autorizado</div>
        <div class="empty-state__desc">Você não tem permissão para visualizar este perfil.</div>
      </div>
    </div>`;
}

/* ── Page reload ──────────────────────────── */
function reloadPage() {
  destroyAll();
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = render();
  initCharts();
}

/* ── init ─────────────────────────────────── */
export async function init() {
  const user          = getCurrentUser();
  const { id: empId } = getRouteParams();

  /* No employee ID in params, OR user passed their own profile ID but has no employee record */
  const ownProfileWithNoEmployee = empId === user?.id && !user?.employeeId;
  if (!empId || ownProfileWithNoEmployee) {
    const main = document.getElementById('main-content');
    if (main) main.innerHTML = `
      <div class="page-enter" style="display:flex;align-items:center;justify-content:center;height:100%;min-height:60vh">
        <div class="empty-state">
          <div class="empty-state__icon">👤</div>
          <div class="empty-state__title">Funcionalidade indisponível</div>
          <div class="empty-state__desc">Esta funcionalidade não está habilitada para o seu perfil.</div>
        </div>
      </div>`;
    return;
  }

  /* Cache hit — re-validate access before rendering */
  if (_loadedEmpId === empId) {
    if (!isAllowed(user, empId, _employee)) { renderDenied(); return; }
    reloadPage();
    return;
  }

  /* Reset para novo employee */
  _employee = null;
  _supervisor = null;
  _monitorings = [];
  _obsLog = [];

  /* Static ref data (cached across navigations) */
  if (!_evalCriteria.length) {
    const [ecRes, topicRes] = await Promise.all([
      supabase.from('eval_criteria').select('id, name').eq('active', true),
      supabase.from('topic').select('id, eval_criteria_id, points').eq('active', true),
    ]);
    _evalCriteria = ecRes.data ?? [];
    _topicMap     = Object.fromEntries((topicRes.data ?? []).map(t => [t.id, t]));
  }

  /* Employee + monitorings in parallel; supervisor resolved separately to avoid FK ambiguity */
  const [empRes, monsRes] = await Promise.all([
    supabase.from('employees')
      .select('id, name, team_id, teams(supervisor_id)')
      .eq('id', empId)
      .single(),
    supabase.from('monitoring')
      .select(`
        id, date, zeroed,
        topic_approval(topic_id, obtained),
        service_chat(csat, protocol)
      `)
      .eq('employee_id', empId)
      .order('date', { ascending: true }),
  ]);

  if (empRes.error || !empRes.data) {
    const main = document.getElementById('main-content');
    if (main) main.innerHTML = `
      <div class="page-enter">
        <div class="empty-state">
          <div class="empty-state__title">Colaborador não encontrado</div>
        </div>
      </div>`;
    return;
  }

  const { teams: empTeam, ...empData } = empRes.data;
  _employee = empData;

  const supervisorId = empTeam?.supervisor_id ?? null;
  if (supervisorId) {
    const { data: supData } = await supabase
      .from('profiles').select('id, name').eq('id', supervisorId).single();
    _supervisor = supData ?? null;
  } else {
    _supervisor = null;
  }

  if (!isAllowed(user, empId, _employee)) { renderDenied(); return; }
  const rawMons = monsRes.data ?? [];
  _monitorings = computeMonData(rawMons);

  /* Observations — skip fetch for users without Profile.canViewObs */
  const monIds = rawMons.map(m => m.id);
  if (monIds.length && can(user, P.PROFILE_VIEW_OBS)) {
    const monDateMap = Object.fromEntries(rawMons.map(m => [m.id, m.date]));

    const { data: obsData } = await supabase
      .from('monitoring_observation')
      .select(`
        id, content, monitoring_id,
        observation_type(code),
        eval_criteria(name),
        service_chat(protocol)
      `)
      .in('monitoring_id', monIds)
      .order('id', { ascending: false })
      .limit(30);

    _obsLog = (obsData ?? []).map(o => {
      const typeInfo = OBS_TYPE[o.observation_type?.code] ?? OBS_TYPE.default;
      return {
        code:         typeInfo.code,
        label:        typeInfo.label,
        criteriaName: o.eval_criteria?.name ?? null,
        content:      o.content ?? '',
        protocol:     o.service_chat?.protocol ?? null,
        monDate:      monDateMap[o.monitoring_id] ?? null,
      };
    });
  }

  _loadedEmpId = empId;
  reloadPage();
}
