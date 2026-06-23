/* ============================================================
   TEAMS — Dashboard agregado da equipe / departamento
   ------------------------------------------------------------
   Multi-employee aggregate view (staff only). Selecting a single
   colaborador (via Consulta) opens perfil.js. Shared logic lives
   in perfil-data.js.
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { navigate } from '../router.js';
import { supabase } from '../supabase.js';
import { can, P } from '../utils/permissions.js';
import { destroyAll } from '../components/charts.js';
import { CalPicker, calTriggerHtml } from '../components/cal-picker.js';
import {
  defaultDateWindow, loadRefData, loadEmployeeData, scopedAnalyticalNoteTypes,
  buildCatBreakdown, statsBlock, chartsRow, obsPanel, initCharts,
} from './perfil-data.js';

/* ── Module state ─────────────────────────── */
let _user      = null;
let _scopeLabel = '';     // team name / sector group name / "Departamento"
let _employees = [];      // [{id, name, sector_id, sector_group_id}]
let _sectors   = [];      // [{id, name}]
let _sectorFilter = null; // sector_id | null
let _dateFrom  = null;
let _dateTo    = null;
let _calPicker = null;

let _rawMonsComputed     = [];
let _monNoteTypes        = new Map();
let _obsLog              = [];
let _analyticalNoteTypes = [];

/* Team-view data cache */
let _teamCache = null;
const TEAM_CACHE_TTL = 5 * 60 * 1000; // 5 min

function isStaff(user) {
  return can(user, P.GLOBAL_VIEW_DEPT) || (user?.supervisedTeamIds?.length > 0);
}

/* ── computeFiltered (sector + date) ────────── */
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
  const catBreakdown = buildCatBreakdown(mons, emps);
  const canViewObs   = can(_user, P.PROFILE_VIEW_OBS);

  /* Sector filter options */
  const sectorOpts = _sectors.map(s =>
    `<option value="${s.id}"${_sectorFilter === s.id ? ' selected' : ''}>${s.name}</option>`
  ).join('');
  const showSectorFilter = _sectors.length > 1;

  const subtitle = _sectorFilter && emps.length !== _employees.length
    ? `${emps.length} de ${_employees.length} colaboradores`
    : `${_employees.length} colaborador${_employees.length !== 1 ? 'es' : ''}`;

  /* Observations filtered to current sector scope */
  const filteredEmpIds = new Set(emps.map(e => e.id));
  const filteredObs = _obsLog.filter(o => !o.employeeId || filteredEmpIds.has(o.employeeId));

  return `
    <div class="profile-page page-enter">
      <!-- Hero -->
      <div class="profile-hero">
        <div class="profile-hero__top profile-hero__top--team">
          <div class="profile-hero__team-info">
            <div class="profile-hero__team-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div>
              <div class="profile-hero__name">${_scopeLabel}</div>
              <a href="#consulta" class="profile-hero__meta">${subtitle}</a>
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
        ${statsBlock(mons, emps.length)}
      </div>

      ${chartsRow(catBreakdown, _analyticalNoteTypes)}

      ${canViewObs ? obsPanel(filteredObs, { showEmployeeName: true }) : ''}
    </div>`;
}

/* ── reloadPage ─────────────────────────────── */
function reloadPage() {
  destroyAll();
  _calPicker?.destroy();
  _calPicker = null;
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = render();
  const { mons, emps } = computeFiltered();
  initCharts({
    mons, emps,
    monNoteTypes: _monNoteTypes,
    analyticalNoteTypes: _analyticalNoteTypes,
    radarLabel: 'Equipe',
  });
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
      onApply: (from, to) => { _dateFrom = from; _dateTo = to; reloadPage(); },
      onClear: ()         => { _dateFrom = null; _dateTo = null; reloadPage(); },
    });
  }
}

function showState(icon, title, desc) {
  const main = document.getElementById('main-content');
  if (main) main.innerHTML = `
    <div class="page-enter"
         style="display:flex;align-items:center;justify-content:center;height:100%;min-height:60vh">
      <div class="empty-state">
        <div class="empty-state__icon">${icon}</div>
        <div class="empty-state__title">${title}</div>
        <div class="empty-state__desc">${desc}</div>
      </div>
    </div>`;
}

/* ── init ───────────────────────────────────── */
export async function init() {
  const user = getCurrentUser();
  _user      = user;

  const isGlobal = can(user, P.GLOBAL_VIEW_DEPT);
  const hasTeam  = user?.supervisedTeamIds?.length > 0;

  /* The aggregate is staff-only. A plain colaborador is sent to their own
     individual profile instead. */
  if (!isStaff(user)) { navigate('perfil'); return; }

  const { since, today } = defaultDateWindow();
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

  const cacheKey = `${user.id}:${isGlobal ? 'global' : (user.supervisedTeamIds ?? []).slice().sort().join(',')}`;

  try {
    await loadRefData(user);

    /* Cache hit → skip all heavy queries */
    if (_teamCache?.key === cacheKey && Date.now() - _teamCache.fetchedAt < TEAM_CACHE_TTL) {
      ({ employees:           _employees,
         sectors:             _sectors,
         scopeLabel:          _scopeLabel,
         rawMonsComputed:     _rawMonsComputed,
         monNoteTypes:        _monNoteTypes,
         obsLog:              _obsLog,
         analyticalNoteTypes: _analyticalNoteTypes } = _teamCache);
      reloadPage();
      return;
    }

    /* Scope label + employees in parallel */
    let scopeLabelPromise;
    if (isGlobal && user.departmentId) {
      scopeLabelPromise = supabase
        .from('departments').select('name')
        .eq('id', user.departmentId).single()
        .then(({ data }) => data?.name ?? 'Departamento');
    } else if (isGlobal) {
      scopeLabelPromise = Promise.resolve('Departamento');
    } else {
      scopeLabelPromise = supabase
        .from('teams').select('name')
        .in('id', user.supervisedTeamIds).eq('active', true)
        .then(({ data }) => (data ?? []).map(t => t.name).filter(Boolean).join(' / ') || user.name);
    }

    let empQuery = supabase
      .from('employees')
      .select('id, name, sector_id, sector_group_id')
      .eq('active', true)
      .order('name');
    if (!isGlobal) empQuery = empQuery.in('team_id', user.supervisedTeamIds);

    const [scopeLabel, { data: empData }] = await Promise.all([scopeLabelPromise, empQuery]);
    _employees  = empData ?? [];
    _scopeLabel = scopeLabel;

    if (!_employees.length) {
      showState('👥', 'Nenhum colaborador encontrado', 'Não há colaboradores ativos nesta equipe.');
      return;
    }

    _analyticalNoteTypes = scopedAnalyticalNoteTypes(_employees);

    /* Sectors for filter (only if employees span multiple sectors) */
    const sectorIds = [...new Set(_employees.map(e => e.sector_id).filter(Boolean))];
    if (sectorIds.length > 1) {
      const { data: sectorsData } = await supabase
        .from('sectors').select('id, name').in('id', sectorIds).order('name');
      _sectors = sectorsData ?? [];
    }

    const { rawMonsComputed, monNoteTypes, obsLog } = await loadEmployeeData({
      employees: _employees,
      since,
      canViewObs: can(user, P.PROFILE_VIEW_OBS),
    });
    _rawMonsComputed = rawMonsComputed;
    _monNoteTypes    = monNoteTypes;
    _obsLog          = obsLog;

    _teamCache = {
      key:                 cacheKey,
      fetchedAt:           Date.now(),
      employees:           _employees,
      sectors:             _sectors,
      scopeLabel:          _scopeLabel,
      rawMonsComputed:     _rawMonsComputed,
      monNoteTypes:        _monNoteTypes,
      obsLog:              _obsLog,
      analyticalNoteTypes: _analyticalNoteTypes,
    };

    reloadPage();
  } catch (err) {
    console.error('[teams] init:', err);
    if (document.getElementById('main-content')?.isConnected) {
      showState('⚠', 'Erro ao carregar dados', 'Tente recarregar a página.');
    }
  }
}
