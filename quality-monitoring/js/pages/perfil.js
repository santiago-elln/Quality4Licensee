/* ============================================================
   PERFIL — Dashboard individual de um colaborador
   ------------------------------------------------------------
   Single-employee view only. The multi-employee aggregate lives
   in teams.js; shared logic lives in perfil-data.js.
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { getRouteParams, navigate } from '../router.js';
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
let _employees = [];     // single-element [{id, name, sector_id, sector_group_id}]
let _scopeLabel = '';    // employee name
let _dateFrom  = null;
let _dateTo    = null;
let _calPicker = null;

let _rawMonsComputed     = [];
let _monNoteTypes        = new Map();
let _obsLog              = [];
let _analyticalNoteTypes = [];

/* ── Is this viewer a staff member (has a team scope to return to)? ── */
function isStaff(user) {
  return can(user, P.GLOBAL_VIEW_DEPT) || (user?.supervisedTeamIds?.length > 0);
}

/* ── computeFiltered (date only — single employee) ── */
function computeFiltered() {
  let mons = _rawMonsComputed;
  if (_dateFrom) mons = mons.filter(m => m.date >= _dateFrom);
  if (_dateTo)   mons = mons.filter(m => m.date <= _dateTo);
  return { mons };
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

  const { mons } = computeFiltered();
  const emps = _employees;
  const catBreakdown = buildCatBreakdown(mons, emps);
  const canViewObs   = can(_user, P.PROFILE_VIEW_OBS);

  /* Back-to-team link only for staff who have an aggregate to return to. */
  const canGoBack = isStaff(_user);

  return `
    <div class="profile-page page-enter">
      <!-- Hero -->
      <div class="profile-hero">
        <div class="profile-hero__top profile-hero__top--team">
          <div class="profile-hero__team-info">
            ${canGoBack ? `
            <a href="#teams" class="profile-hero__back" title="Voltar à equipe">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </a>` : ''}
            <div class="profile-hero__team-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div>
              <div class="profile-hero__name">${_scopeLabel}</div>
              <div class="profile-hero__meta">Colaborador</div>
            </div>
          </div>
          <div class="profile-hero__filters">
            ${calTriggerHtml('prof-date-picker', _dateFrom, _dateTo)}
          </div>
        </div>
        ${statsBlock(mons, emps.length)}
      </div>

      ${chartsRow(catBreakdown, _analyticalNoteTypes)}

      ${canViewObs ? obsPanel(_obsLog, { showEmployeeName: false }) : ''}
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
  const { mons } = computeFiltered();
  initCharts({
    mons, emps: _employees,
    monNoteTypes: _monNoteTypes,
    analyticalNoteTypes: _analyticalNoteTypes,
    radarLabel: _scopeLabel || 'Colaborador',
  });
  bindFilters();
}

/* ── bindFilters (date picker only) ─────────── */
function bindFilters() {
  const triggerEl = document.getElementById('prof-date-picker');
  if (!triggerEl) return;
  _calPicker = new CalPicker({
    triggerEl,
    from: _dateFrom ?? '',
    to:   _dateTo   ?? '',
    onApply: (from, to) => { _dateFrom = from; _dateTo = to; reloadPage(); },
    onClear: ()         => { _dateFrom = null; _dateTo = null; reloadPage(); },
  });
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

  const staff   = isStaff(user);
  const isGlobal = can(user, P.GLOBAL_VIEW_DEPT);
  const hasTeam  = user?.supervisedTeamIds?.length > 0;
  const routeId  = getRouteParams().id || null;
  const ownId    = user?.employeeId ?? null;

  /* Resolve which employee to show.
     · Plain employees may ONLY ever see their own record (ignore route id).
     · Staff may open any employee (route id), defaulting to their own;
       with neither, there is no individual to show → send them to the team
       aggregate instead. */
  let employeeId;
  if (!staff) {
    employeeId = ownId;
    if (!employeeId) {
      showState('👤', 'Funcionalidade indisponível',
        'Esta funcionalidade não está habilitada para o seu perfil.');
      return;
    }
  } else {
    employeeId = routeId || ownId;
    if (!employeeId) { navigate('teams'); return; }
  }

  /* Reset per-navigation state */
  const { since, today } = defaultDateWindow();
  _employees           = [];
  _scopeLabel          = '';
  _dateFrom            = since;
  _dateTo              = today;
  _rawMonsComputed     = [];
  _monNoteTypes        = new Map();
  _obsLog              = [];
  _analyticalNoteTypes = [];
  _calPicker?.destroy();
  _calPicker = null;

  try {
    await loadRefData(user);

    /* Fetch the employee, enforcing scope: a supervisor may only open an
       employee within their supervised teams; a plain employee only their
       own id; global users any. */
    let empQuery = supabase
      .from('employees')
      .select('id, name, sector_id, sector_group_id')
      .eq('id', employeeId)
      .eq('active', true);
    if (staff && hasTeam && !isGlobal) empQuery = empQuery.in('team_id', user.supervisedTeamIds);

    const { data: empData } = await empQuery;
    _employees = empData ?? [];

    if (!_employees.length) {
      showState('👥', 'Colaborador não encontrado',
        'Este colaborador não está disponível para o seu perfil.');
      return;
    }
    _scopeLabel = _employees[0].name;

    _analyticalNoteTypes = scopedAnalyticalNoteTypes(_employees);

    const { rawMonsComputed, monNoteTypes, obsLog } = await loadEmployeeData({
      employees: _employees,
      since,
      canViewObs: can(user, P.PROFILE_VIEW_OBS),
    });
    _rawMonsComputed = rawMonsComputed;
    _monNoteTypes    = monNoteTypes;
    _obsLog          = obsLog;

    reloadPage();
  } catch (err) {
    console.error('[perfil] init:', err);
    if (document.getElementById('main-content')?.isConnected) {
      showState('⚠', 'Erro ao carregar dados', 'Tente recarregar a página.');
    }
  }
}
