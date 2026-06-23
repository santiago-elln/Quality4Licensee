/* ============================================================
   PERFIL-DATA — Shared data + render helpers for perfil / teams
   ------------------------------------------------------------
   perfil.js  → single-employee view
   teams.js   → multi-employee aggregate view
   Both share the metric computation, data fetching, the static
   reference cache, and the chart/observation render fragments
   defined here so the two pages stay in lockstep.
   ============================================================ */
import { supabase } from '../supabase.js';
import { formatDate, scoreColor, scoreColorHex } from '../utils/formatters.js';
import { renderRadarChart, renderHBarChart, renderHistoryChartFull } from '../components/charts.js';

/* ── Obs type codes ────────────────────────── */
export const OBS_TYPE = {
  default:       { code: 'G' },
  improvable_by: { code: 'O' },
  excelled_by:   { code: 'A' },
  failed_by:     { code: 'E' },
};

/* ── Default 30-day window (DB filter + initial cal-picker selection) ── */
export function defaultDateWindow() {
  const today = new Date().toISOString().split('T')[0];
  const d30   = new Date();
  d30.setDate(d30.getDate() - 30);
  return { since: d30.toISOString().split('T')[0], today };
}

/* ── Static reference data (cached across navigations & both pages) ── */
let _ref = {
  evalCriteria:       [],
  topicMap:           {},
  sgEcMap:            new Map(),  // sg_id → Set<ec_id>
  allAnalyticalTypes: [],
  sgAnMap:            new Map(),  // sg_id → Set<analytical_note_type_id>
  userId:             null,       // user.id when last fetched (view-as invalidates)
};

export async function loadRefData(user) {
  if (_ref.evalCriteria.length && _ref.userId === user.id) return _ref;

  const [ecRes, topicRes, sgEcRes, anRes, sgAnRes] = await Promise.all([
    supabase.from('eval_criteria').select('id, name').eq('active', true),
    supabase.from('topic').select('id, eval_criteria_id, points').eq('active', true),
    supabase.from('sector_group_eval_criteria').select('sector_group_id, eval_criteria_id'),
    supabase.from('analytical_note_type').select('id, name').eq('active', true).order('name'),
    supabase.from('sector_group_analytical_note_type').select('sector_group_id, analytical_note_type_id'),
  ]);

  const sgEcMap = new Map();
  for (const { sector_group_id, eval_criteria_id } of (sgEcRes.data ?? [])) {
    if (!sgEcMap.has(sector_group_id)) sgEcMap.set(sector_group_id, new Set());
    sgEcMap.get(sector_group_id).add(eval_criteria_id);
  }
  const sgAnMap = new Map();
  for (const { sector_group_id, analytical_note_type_id } of (sgAnRes.data ?? [])) {
    if (!sgAnMap.has(sector_group_id)) sgAnMap.set(sector_group_id, new Set());
    sgAnMap.get(sector_group_id).add(analytical_note_type_id);
  }

  _ref = {
    evalCriteria:       ecRes.data ?? [],
    topicMap:           Object.fromEntries((topicRes.data ?? []).map(t => [t.id, t])),
    sgEcMap,
    allAnalyticalTypes: anRes.data ?? [],
    sgAnMap,
    userId:             user.id,
  };
  return _ref;
}

/* ── computeMonData ────────────────────────── */
export function computeMonData(rawMons) {
  const topicMap = _ref.topicMap;
  return rawMons.map(mon => {
    let earned = 0, total = 0;
    const earnedByC = {}, maxByC = {};
    for (const ta of (mon.topic_approval ?? [])) {
      const t = topicMap[ta.topic_id];
      if (!t) continue;
      const cid = t.eval_criteria_id;
      maxByC[cid] = (maxByC[cid] ?? 0) + t.points;
      total       += t.points;
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

/* ── buildCatBreakdown (for a set of employees) ──── */
export function buildCatBreakdown(mons, emps) {
  const { sgEcMap, evalCriteria } = _ref;
  const empSgIds  = new Set(emps.map(e => e.sector_group_id).filter(Boolean));
  const usedEcIds = new Set();
  for (const sgId of empSgIds) {
    const linked = sgEcMap.get(sgId);
    if (linked) for (const id of linked) usedEcIds.add(id);
  }
  const criteria = usedEcIds.size
    ? evalCriteria.filter(ec => usedEcIds.has(ec.id))
    : evalCriteria;
  return criteria.map(ec => {
    const vals = mons.filter(m => m.radarPcts[ec.id] !== undefined).map(m => m.radarPcts[ec.id]);
    const avg  = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    return { id: ec.id, name: ec.name, pct: avg };
  });
}

/* ── Analytical note types scoped to a set of employees' sector groups ── */
export function scopedAnalyticalNoteTypes(employees) {
  const { sgAnMap, allAnalyticalTypes } = _ref;
  const empSgIds  = new Set(employees.map(e => e.sector_group_id).filter(Boolean));
  const usedAnIds = new Set();
  for (const sgId of empSgIds) {
    const linked = sgAnMap.get(sgId);
    if (linked) for (const id of linked) usedAnIds.add(id);
  }
  return usedAnIds.size
    ? allAnalyticalTypes.filter(at => usedAnIds.has(at.id))
    : allAnalyticalTypes;
}

/* ── Fetch monitorings + analytical notes + observations for employees ── */
export async function loadEmployeeData({ employees, since, canViewObs }) {
  const empIds = employees.map(e => e.id);

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

  const rawMonsComputed = computeMonData(rawMons ?? []);
  const monIds = (rawMons ?? []).map(m => m.id);

  /* Analytical notes */
  const monNoteTypes = new Map();
  if (monIds.length) {
    const { data: anNotes } = await supabase
      .from('analytical_note')
      .select('monitoring_id, analytical_note_type_id')
      .in('monitoring_id', monIds);
    for (const an of (anNotes ?? [])) {
      if (!monNoteTypes.has(an.monitoring_id)) monNoteTypes.set(an.monitoring_id, new Set());
      monNoteTypes.get(an.monitoring_id).add(an.analytical_note_type_id);
    }
  }

  /* Observations (if permitted) */
  let obsLog = [];
  if (monIds.length && canViewObs) {
    const monDateMap = Object.fromEntries((rawMons ?? []).map(m => [m.id, m.date]));
    const monEmpMap  = Object.fromEntries(rawMonsComputed.map(m => [m.id, m.employeeId]));
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
    const empNameMap = Object.fromEntries(employees.map(e => [e.id, e.name]));
    obsLog = (obsData ?? []).map(o => {
      const typeInfo = OBS_TYPE[o.observation_type?.code] ?? OBS_TYPE.default;
      const empId    = monEmpMap[o.monitoring_id] ?? null;
      return {
        code:         typeInfo.code,
        criteriaName: o.eval_criteria?.name ?? null,
        content:      o.content ?? '',
        protocol:     o.service_chat?.protocol ?? null,
        monDate:      monDateMap[o.monitoring_id] ?? null,
        employeeId:   empId,
        employeeName: empId ? (empNameMap[empId] ?? null) : null,
      };
    });
  }

  return { rawMonsComputed, monNoteTypes, obsLog };
}

/* ── Render fragment: hero stats row ───────────────── */
/* csatOverride: pass { pct, nps } to source the survey metrics externally
   (used by teams.js for sector_groups whose CSAT/NPS come from Firestore) — CSAT
   renders as a top-2-box percentage and an NPS card is added. Leave undefined to
   derive CSAT from `mons` (star average), as perfil does. */
export function statsBlock(mons, empCount, csatOverride) {
  const count    = mons.length;
  const avgPct   = count ? Math.round(mons.reduce((s, m) => s + m.pct, 0) / count) : 0;
  const zeroed   = mons.filter(m => m.zeroed).length;
  const csatVals = mons.filter(m => m.avgCsat).map(m => m.avgCsat);
  const computedCsat = csatVals.length
    ? Math.round(csatVals.reduce((a, b) => a + b, 0) / csatVals.length * 10) / 10
    : null;

  /* External (Firestore) source: csatOverride is { pct, nps } — CSAT is shown as
     a top-2-box percentage and an NPS card is added. Otherwise CSAT is the
     monitoring-derived average shown in stars (default; used by perfil). */
  const external = csatOverride !== undefined && csatOverride !== null;
  const csatHtml = external
    ? (csatOverride.pct != null ? `${csatOverride.pct}%` : '—')
    : (computedCsat ? `${computedCsat} ★` : '—');
  const csatLbl = external ? 'CSAT' : 'CSAT médio';
  const npsCard = external ? `
      <div class="profile-stat">
        <div class="profile-stat__val" id="hero-nps-stat">${csatOverride.nps != null ? csatOverride.nps + '%' : '—'}</div>
        <div class="profile-stat__lbl">NPS</div>
      </div>` : '';
  return `
    <div class="profile-hero__stats${external ? ' profile-hero__stats--6' : ''}">
      <div class="profile-stat">
        <div class="profile-stat__val">${count}</div>
        <div class="profile-stat__lbl">Monitorias</div>
      </div>
      <div class="profile-stat">
        <div class="profile-stat__val" style="color:${scoreColor(avgPct)}">${count ? avgPct + '%' : '—'}</div>
        <div class="profile-stat__lbl">Aproveit. médio</div>
      </div>
      <div class="profile-stat">
        <div class="profile-stat__val" id="hero-csat-stat">${csatHtml}</div>
        <div class="profile-stat__lbl">${csatLbl}</div>
      </div>
      ${npsCard}
      <div class="profile-stat">
        <div class="profile-stat__val" style="color:${zeroed > 0 ? 'var(--color-danger)' : 'inherit'}">${zeroed}</div>
        <div class="profile-stat__lbl">Zeradas</div>
      </div>
      <div class="profile-stat">
        <div class="profile-stat__val">${empCount}</div>
        <div class="profile-stat__lbl">Colaboradores</div>
      </div>
    </div>`;
}

/* ── Render fragment: radar + history + analytical charts ─── */
export function chartsRow(catBreakdown, analyticalNoteTypes) {
  const anPanelH = Math.max(80, analyticalNoteTypes.length * 34);
  return `
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
          ${analyticalNoteTypes.length ? `
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
    </div>`;
}

/* ── Render fragment: observations panel ───────────── */
export function obsPanel(obsLog, { showEmployeeName }) {
  return `
    <div class="panel">
      <div class="panel__header">
        <div class="panel__title">Observações Qualitativas</div>
        <span class="badge badge--neutral">${obsLog.length}</span>
      </div>
      <div class="panel__body panel__body--compact">
        <div class="obs-log">
          ${obsLog.length
            ? obsLog.map(o => `
              <div class="obs-log-item obs-log-item--${o.code}">
                <div class="obs-log-item__badge obs-log-item__badge--${o.code}">${o.code}</div>
                <div class="obs-log-item__body">
                  ${o.criteriaName ? `<div class="obs-log-item__criteria">${o.criteriaName}</div>` : ''}
                  <div class="obs-log-item__text">${o.content}</div>
                  <div class="obs-log-item__meta">
                    ${showEmployeeName && o.employeeName ? `${o.employeeName} · ` : ''}${o.monDate ? formatDate(o.monDate) : ''}${o.protocol ? ` · Prot. ${o.protocol}` : ''}
                  </div>
                </div>
              </div>`).join('')
            : `<div class="empty-state" style="padding:var(--space-6)">
                 <div class="empty-state__title">Sem observações</div>
               </div>`}
        </div>
      </div>
    </div>`;
}

/* ── Chart initialisation (shared) ─────────────────── */
export function initCharts({ mons, emps, monNoteTypes, analyticalNoteTypes, radarLabel }) {
  const catBreakdown = buildCatBreakdown(mons, emps);

  /* Radar */
  if (catBreakdown.length) {
    renderRadarChart(
      'chart-radar',
      catBreakdown.map(c => c.name.split(' ')[0]),
      [{ label: radarLabel, data: catBreakdown.map(c => c.pct) }]
    );
  }

  /* History chart: average pct grouped by monitoring number */
  const numGroups = new Map();
  for (const mon of mons) {
    if (mon.number == null) continue;
    if (!numGroups.has(mon.number)) numGroups.set(mon.number, []);
    numGroups.get(mon.number).push(mon.pct);
  }
  if (numGroups.size) {
    const sortedNums = [...numGroups.keys()].sort((a, b) => a - b);
    const histLabels = sortedNums.map(n => `Nº ${n}`);
    const histData   = sortedNums.map(n => {
      const vals = numGroups.get(n);
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    });
    renderHistoryChartFull('chart-history', histLabels, histData, histData.map(scoreColorHex));
  }

  /* Analytical notes: % of monitorings that have each note type */
  if (analyticalNoteTypes.length && mons.length) {
    const totalMons = mons.length;
    const anData = analyticalNoteTypes.map(at => {
      let cnt = 0;
      for (const mon of mons) {
        if (monNoteTypes.get(mon.id)?.has(at.id)) cnt++;
      }
      return Math.round(cnt / totalMons * 100);
    });
    renderHBarChart(
      'chart-analytical',
      analyticalNoteTypes.map(at => at.name),
      anData,
      'rgba(74,186,61,0.7)'
    );
  }
}
