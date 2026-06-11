/* ============================================================
   PERFIL — Dashboard de equipe do supervisor / departamento
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { getRouteParams } from '../router.js';
import { supabase } from '../supabase.js';
import { can, P } from '../utils/permissions.js';
import { formatDate, scoreColor, scoreColorHex } from '../utils/formatters.js';
import { renderRadarChart, renderHBarChart, renderHistoryChartFull, destroyAll } from '../components/charts.js';
import { CalPicker, calTriggerHtml } from '../components/cal-picker.js';

/* ── Module state ─────────────────────────── */
let _user         = null;
let _scopeLabel   = '';     // team name / sector group name / "Departamento"
let _employees    = [];     // [{id, name, sector_id, sector_group_id}]
let _sectors      = [];     // [{id, name}]
let _sectorFilter = null;   // sector_id | null
let _dateFrom     = null;   // YYYY-MM-DD | null
let _dateTo       = null;   // YYYY-MM-DD | null
let _calPicker    = null;
let _employeeId   = null;   // non-null → individual employee view

let _rawMonsComputed = []; // [{id, date, zeroed, number, pct, radarPcts, avgCsat, employeeId}]
let _monNoteTypes    = new Map(); // monId → Set<analytical_note_type_id>
let _obsLog          = [];        // [{code, criteriaName, content, protocol, monDate, employeeId}]

/* Static ref (cached across navigations) */
let _evalCriteria        = [];
let _topicMap            = {};
let _sgEcMap             = new Map(); // sg_id → Set<ec_id>
let _allAnalyticalTypes  = [];
let _analyticalNoteTypes = []; // scoped to employees' sector groups
let _sgAnMap             = new Map(); // sg_id → Set<analytical_note_type_id>
let _refCacheUserId      = null; // user.id when ref data was last fetched

/* Team-view data cache (skipped for individual employee views) */
let _teamCache = null;
const TEAM_CACHE_TTL = 5 * 60 * 1000; // 5 min

/* ── Obs type codes ────────────────────────── */
const OBS_TYPE = {
  default:       { code: 'G' },
  improvable_by: { code: 'O' },
  excelled_by:   { code: 'A' },
  failed_by:     { code: 'E' },
};

/* ── computeMonData ────────────────────────── */
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
    return {
      id: mon.id, date: mon.date, zeroed: mon.zeroed,
      number: mon.number ?? null,
      pct, radarPcts, avgCsat,
      employeeId: mon.employee_id,
    };
  });
}

/* ── computeFiltered ────────────────────────── */
function computeFiltered() {
  let mons = _rawMonsComputed;
  let emps = _employees;
  if (_sectorFilter) {
    const empIds = new Set(emps.filter(e => e.sector_id === _sectorFilter).map(e => e.id));
    mons = mons.filter(m => empIds.has(m.employeeId));
    emps = emps.filter(e => empIds.has(e.id));
  }
  if (_dateFrom) mons = mons.filter(m => m.date >= _dateFrom);
  if (_dateTo)   mons = mons.filter(m => m.date <= _dateTo);
  return { mons, emps };
}

/* ── buildCatBreakdown (for filtered emps) ──── */
function buildCatBreakdown(mons, emps) {
  const empSgIds  = new Set(emps.map(e => e.sector_group_id).filter(Boolean));
  const usedEcIds = new Set();
  for (const sgId of empSgIds) {
    const linked = _sgEcMap.get(sgId);
    if (linked) for (const id of linked) usedEcIds.add(id);
  }
  const criteria = usedEcIds.size
    ? _evalCriteria.filter(ec => usedEcIds.has(ec.id))
    : _evalCriteria;
  return criteria.map(ec => {
    const vals = mons.filter(m => m.radarPcts[ec.id] !== undefined).map(m => m.radarPcts[ec.id]);
    const avg  = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    return { id: ec.id, name: ec.name, pct: avg };
  });
}

/* ── render() ───────────────────────────────── */
export function render() {
  if (!_user) {
    return `
      <div class="profile-page page-enter"
           style="display:flex;align-items:center;justify-content:center;height:300px;gap:12px;color:var(--text-secondary)">
        <div class="boot-spinner" style="width:20px;height:20px;border-width:2px"></div>
        Carregando…
      </div>`;
  }

  const { mons, emps } = computeFiltered();

  /* Aggregate stats */
  const count    = mons.length;
  const avgPct   = count ? Math.round(mons.reduce((s, m) => s + m.pct, 0) / count) : 0;
  const zeroed   = mons.filter(m => m.zeroed).length;
  const csatVals = mons.filter(m => m.avgCsat).map(m => m.avgCsat);
  const avgCsat  = csatVals.length
    ? Math.round(csatVals.reduce((a, b) => a + b, 0) / csatVals.length * 10) / 10
    : null;

  /* Category breakdown for sidebar bars */
  const catBreakdown = buildCatBreakdown(mons, emps);

  /* Sector filter options */
  const sectorOpts = _sectors.map(s =>
    `<option value="${s.id}"${_sectorFilter === s.id ? ' selected' : ''}>${s.name}</option>`
  ).join('');
  const showSectorFilter = _sectors.length > 1;

  const isIndividualView = !!_employeeId;

  /* Subtitle: reflect filtered count */
  const subtitle = isIndividualView
    ? 'Colaborador'
    : _sectorFilter && emps.length !== _employees.length
      ? `${emps.length} de ${_employees.length} colaboradores`
      : `${_employees.length} colaborador${_employees.length !== 1 ? 'es' : ''}`;

  const canViewObs = can(_user, P.PROFILE_VIEW_OBS);

  /* Observations filtered to current sector scope */
  const filteredEmpIds = new Set(emps.map(e => e.id));
  const filteredObs = _obsLog.filter(o => !o.employeeId || filteredEmpIds.has(o.employeeId));

  /* Analytical notes panel height */
  const anPanelH = Math.max(80, _analyticalNoteTypes.length * 34);

  return `
    <div class="profile-page page-enter">
      <!-- Hero -->
      <div class="profile-hero">
        <div class="profile-hero__top profile-hero__top--team">
          <div class="profile-hero__team-info">
            ${isIndividualView ? `
            <a href="#perfil" class="profile-hero__back" title="Voltar à equipe">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </a>` : ''}
            <div class="profile-hero__team-icon">
              ${isIndividualView ? `
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>` : `
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>`}
            </div>
            <div>
              <div class="profile-hero__name">${_scopeLabel}</div>
              <div class="profile-hero__meta">${subtitle}</div>
            </div>
          </div>
          <div class="profile-hero__filters">
            ${showSectorFilter ? `
            <select id="prof-sector-filter" class="prof-filter-select">
              <option value="">Todos os setores</option>
              ${sectorOpts}
            </select>` : ''}
            ${calTriggerHtml('prof-date-picker', _dateFrom, _dateTo)}
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
          <div class="profile-stat">
            <div class="profile-stat__val">${emps.length}</div>
            <div class="profile-stat__lbl">Colaboradores</div>
          </div>
        </div>
      </div>

      <!-- Charts row -->
      <div class="profile-charts">
        <!-- Radar + category bars -->
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

        <!-- History by monitoring number + analytical notes -->
        <div class="history-panel panel">
          <div class="panel__header"><div class="panel__title">Histórico por Monitoria</div></div>
          <div class="panel__body" style="display:flex;flex-direction:column;gap:var(--space-5)">
            <div class="chart-container chart-h-200">
              <canvas id="chart-history" height="200"></canvas>
            </div>
            ${_analyticalNoteTypes.length ? `
            <div>
              <div class="prof-chart-sublabel">
                Critérios Analíticos
                <span class="badge badge--neutral" style="font-size:var(--text-xs)">% das monitorias</span>
              </div>
              <div class="chart-container" style="height:${anPanelH}px">
                <canvas id="chart-analytical"></canvas>
              </div>
            </div>` : ''}
          </div>
        </div>
      </div>

      ${canViewObs ? `
      <!-- Observations log -->
      <div class="panel">
        <div class="panel__header">
          <div class="panel__title">Observações Qualitativas</div>
          <span class="badge badge--neutral">${filteredObs.length}</span>
        </div>
        <div class="panel__body panel__body--compact">
          <div class="obs-log">
            ${filteredObs.length
              ? filteredObs.map(o => `
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
                 </div>`}
          </div>
        </div>
      </div>` : ''}
    </div>`;
}

/* ── initCharts ─────────────────────────────── */
function initCharts() {
  const { mons, emps } = computeFiltered();
  const catBreakdown   = buildCatBreakdown(mons, emps);

  /* Radar */
  if (catBreakdown.length) {
    renderRadarChart(
      'chart-radar',
      catBreakdown.map(c => c.name.split(' ')[0]),
      [{ label: 'Equipe', data: catBreakdown.map(c => c.pct) }]
    );
  }

  /* History chart: average pct grouped by monitoring number */
  const numGroups = new Map(); // number → [pct]
  for (const mon of mons) {
    if (mon.number == null) continue;
    if (!numGroups.has(mon.number)) numGroups.set(mon.number, []);
    numGroups.get(mon.number).push(mon.pct);
  }
  if (numGroups.size) {
    const sortedNums = [...numGroups.keys()].sort((a, b) => a - b);
    const histLabels  = sortedNums.map(n => `Nº ${n}`);
    const histData    = sortedNums.map(n => {
      const vals = numGroups.get(n);
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    });
    renderHistoryChartFull('chart-history', histLabels, histData, histData.map(scoreColorHex));
  }

  /* Analytical notes: % of monitorings that have each note type */
  if (_analyticalNoteTypes.length && mons.length) {
    const totalMons = mons.length;
    const anData = _analyticalNoteTypes.map(at => {
      let cnt = 0;
      for (const mon of mons) {
        if (_monNoteTypes.get(mon.id)?.has(at.id)) cnt++;
      }
      return Math.round(cnt / totalMons * 100);
    });
    renderHBarChart(
      'chart-analytical',
      _analyticalNoteTypes.map(at => at.name),
      anData,
      'rgba(74,186,61,0.7)'
    );
  }
}

/* ── reloadPage ─────────────────────────────── */
function reloadPage() {
  destroyAll();
  _calPicker?.destroy();
  _calPicker = null;
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = render();
  initCharts();
  bindFilters();
}

/* ── bindFilters ────────────────────────────── */
function bindFilters() {
  document.getElementById('prof-sector-filter')?.addEventListener('change', e => {
    _sectorFilter = e.target.value || null;
    reloadPage();
  });

  const triggerEl = document.getElementById('prof-date-picker');
  if (triggerEl) {
    _calPicker = new CalPicker({
      triggerEl,
      from: _dateFrom ?? '',
      to:   _dateTo   ?? '',
      onApply: (from, to) => {
        _dateFrom = from;
        _dateTo   = to;
        reloadPage();
      },
      onClear: () => {
        _dateFrom = null;
        _dateTo   = null;
        reloadPage();
      },
    });
  }
}

/* ── init ───────────────────────────────────── */
export async function init() {
  const user    = getCurrentUser();
  _user         = user;
  _employeeId   = getRouteParams().id || null;
  const isGlobal = can(user, P.GLOBAL_VIEW_DEPT);
  const hasTeam  = user?.supervisedTeamIds?.length > 0;

  if (!isGlobal && !hasTeam && !_employeeId) {
    const main = document.getElementById('main-content');
    if (main) main.innerHTML = `
      <div class="page-enter"
           style="display:flex;align-items:center;justify-content:center;height:100%;min-height:60vh">
        <div class="empty-state">
          <div class="empty-state__icon">👤</div>
          <div class="empty-state__title">Funcionalidade indisponível</div>
          <div class="empty-state__desc">Esta funcionalidade não está habilitada para o seu perfil.</div>
        </div>
      </div>`;
    return;
  }

  /* 30-day window — used both as the DB filter and the initial cal-picker selection */
  const today = new Date().toISOString().split('T')[0];
  const d30   = new Date();
  d30.setDate(d30.getDate() - 30);
  const since = d30.toISOString().split('T')[0];

  /* Reset per-navigation state (preserve static ref cache) */
  _employees           = [];
  _sectors             = [];
  _sectorFilter        = null;
  _dateFrom            = since;
  _dateTo              = today;
  _rawMonsComputed     = [];
  _monNoteTypes        = new Map();
  _obsLog              = [];
  _analyticalNoteTypes = [];
  _scopeLabel          = '';
  _calPicker?.destroy();
  _calPicker = null;

  const isIndividualView = !!_employeeId;
  const cacheKey = `${user.id}:${isGlobal ? 'global' : (user.supervisedTeamIds ?? []).slice().sort().join(',')}`;

  try {
  /* ── Static ref data (cached; invalidated when viewed user changes) */
  if (!_evalCriteria.length || _refCacheUserId !== user.id) {
    const [ecRes, topicRes, sgEcRes, anRes, sgAnRes] = await Promise.all([
      supabase.from('eval_criteria').select('id, name').eq('active', true),
      supabase.from('topic').select('id, eval_criteria_id, points').eq('active', true),
      supabase.from('sector_group_eval_criteria').select('sector_group_id, eval_criteria_id'),
      supabase.from('analytical_note_type').select('id, name').eq('active', true).order('name'),
      supabase.from('sector_group_analytical_note_type').select('sector_group_id, analytical_note_type_id'),
    ]);
    _evalCriteria = ecRes.data ?? [];
    _topicMap     = Object.fromEntries((topicRes.data ?? []).map(t => [t.id, t]));
    _sgEcMap      = new Map();
    for (const { sector_group_id, eval_criteria_id } of (sgEcRes.data ?? [])) {
      if (!_sgEcMap.has(sector_group_id)) _sgEcMap.set(sector_group_id, new Set());
      _sgEcMap.get(sector_group_id).add(eval_criteria_id);
    }
    _allAnalyticalTypes = anRes.data ?? [];
    _sgAnMap = new Map();
    for (const { sector_group_id, analytical_note_type_id } of (sgAnRes.data ?? [])) {
      if (!_sgAnMap.has(sector_group_id)) _sgAnMap.set(sector_group_id, new Set());
      _sgAnMap.get(sector_group_id).add(analytical_note_type_id);
    }
    _refCacheUserId = user.id;
  }

  /* ── Team-view cache hit → skip all heavy queries */
  if (!isIndividualView &&
      _teamCache?.key === cacheKey &&
      Date.now() - _teamCache.fetchedAt < TEAM_CACHE_TTL) {
    ({ employees:         _employees,
       sectors:           _sectors,
       scopeLabel:        _scopeLabel,
       rawMonsComputed:   _rawMonsComputed,
       monNoteTypes:      _monNoteTypes,
       obsLog:            _obsLog,
       analyticalNoteTypes: _analyticalNoteTypes } = _teamCache);
    reloadPage();
    return;
  }

  /* ── Scope label + employees in parallel */
  let scopeLabelPromise;
  if (isGlobal && user.departmentId) {
    scopeLabelPromise = supabase
      .from('departments').select('name')
      .eq('id', user.departmentId).single()
      .then(({ data }) => data?.name ?? 'Departamento');
  } else if (isGlobal) {
    scopeLabelPromise = Promise.resolve('Departamento');
  } else if (hasTeam) {
    scopeLabelPromise = supabase
      .from('teams').select('name')
      .in('id', user.supervisedTeamIds).eq('active', true)
      .then(({ data }) => (data ?? []).map(t => t.name).filter(Boolean).join(' / ') || user.name);
  } else {
    scopeLabelPromise = Promise.resolve(user.name ?? '');
  }

  let empQuery = supabase
    .from('employees')
    .select('id, name, sector_id, sector_group_id')
    .eq('active', true)
    .order('name');
  if (!isGlobal) empQuery = empQuery.in('team_id', user.supervisedTeamIds);
  if (_employeeId) empQuery = empQuery.eq('id', _employeeId);

  const [scopeLabel, { data: empData }] = await Promise.all([
    scopeLabelPromise,
    empQuery,
  ]);
  _employees  = empData ?? [];
  _scopeLabel = (_employeeId && _employees.length === 1)
    ? _employees[0].name
    : scopeLabel;

  if (!_employees.length) {
    const main = document.getElementById('main-content');
    if (main) main.innerHTML = `
      <div class="page-enter"
           style="display:flex;align-items:center;justify-content:center;height:100%;min-height:60vh">
        <div class="empty-state">
          <div class="empty-state__icon">👥</div>
          <div class="empty-state__title">Nenhum colaborador encontrado</div>
          <div class="empty-state__desc">Não há colaboradores ativos nesta equipe.</div>
        </div>
      </div>`;
    return;
  }

  /* Scoped analytical note types (union of all employees' sector groups) */
  const empSgIds  = new Set(_employees.map(e => e.sector_group_id).filter(Boolean));
  const usedAnIds = new Set();
  for (const sgId of empSgIds) {
    const linked = _sgAnMap.get(sgId);
    if (linked) for (const id of linked) usedAnIds.add(id);
  }
  _analyticalNoteTypes = usedAnIds.size
    ? _allAnalyticalTypes.filter(at => usedAnIds.has(at.id))
    : _allAnalyticalTypes;

  /* Sectors for filter (only if employees span multiple sectors) */
  const sectorIds = [...new Set(_employees.map(e => e.sector_id).filter(Boolean))];
  if (sectorIds.length > 1) {
    const { data: sectorsData } = await supabase
      .from('sectors').select('id, name').in('id', sectorIds).order('name');
    _sectors = sectorsData ?? [];
  }

  /* ── Monitorings (last 30 days) */
  const empIds = _employees.map(e => e.id);
  const { data: rawMons } = await supabase
    .from('monitoring')
    .select(`
      id, date, zeroed, number, employee_id,
      topic_approval(topic_id, obtained),
      service_chat(csat)
    `)
    .in('employee_id', empIds)
    .gte('date', since)
    .order('date', { ascending: true });

  _rawMonsComputed = computeMonData(rawMons ?? []);

  /* ── Analytical notes */
  const monIds = (rawMons ?? []).map(m => m.id);
  if (monIds.length) {
    const { data: anNotes } = await supabase
      .from('analytical_note')
      .select('monitoring_id, analytical_note_type_id')
      .in('monitoring_id', monIds);
    _monNoteTypes = new Map();
    for (const an of (anNotes ?? [])) {
      if (!_monNoteTypes.has(an.monitoring_id)) _monNoteTypes.set(an.monitoring_id, new Set());
      _monNoteTypes.get(an.monitoring_id).add(an.analytical_note_type_id);
    }
  }

  /* ── Observations (if permitted) */
  if (monIds.length && can(user, P.PROFILE_VIEW_OBS)) {
    const monDateMap  = Object.fromEntries((rawMons ?? []).map(m => [m.id, m.date]));
    const monEmpMap   = Object.fromEntries(_rawMonsComputed.map(m => [m.id, m.employeeId]));
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
      .limit(60);
    _obsLog = (obsData ?? []).map(o => {
      const typeInfo = OBS_TYPE[o.observation_type?.code] ?? OBS_TYPE.default;
      return {
        code:         typeInfo.code,
        criteriaName: o.eval_criteria?.name ?? null,
        content:      o.content ?? '',
        protocol:     o.service_chat?.protocol ?? null,
        monDate:      monDateMap[o.monitoring_id] ?? null,
        employeeId:   monEmpMap[o.monitoring_id]  ?? null,
      };
    });
  }

  /* ── Store team-view cache */
  if (!isIndividualView) {
    _teamCache = {
      key:              cacheKey,
      fetchedAt:        Date.now(),
      employees:        _employees,
      sectors:          _sectors,
      scopeLabel:       _scopeLabel,
      rawMonsComputed:  _rawMonsComputed,
      monNoteTypes:     _monNoteTypes,
      obsLog:           _obsLog,
      analyticalNoteTypes: _analyticalNoteTypes,
    };
  }

  reloadPage();
  } catch (err) {
    console.error('[perfil] init:', err);
    const main = document.getElementById('main-content');
    if (main?.isConnected) {
      main.innerHTML = `
        <div class="page-enter" style="padding:var(--space-8)">
          <div class="empty-state">
            <div class="empty-state__icon">⚠</div>
            <div class="empty-state__title">Erro ao carregar dados</div>
            <div class="empty-state__desc">Tente recarregar a página.</div>
          </div>
        </div>`;
    }
  }
}
