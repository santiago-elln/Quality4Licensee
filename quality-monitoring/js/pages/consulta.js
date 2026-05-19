/* ============================================================
   CONSULTA POR ASSOCIADO — Painel de análise por colaborador
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { supabase } from '../supabase.js';
import {
  formatDate, resultBand, scoreColor, scoreColorHex, getInitials,
} from '../utils/formatters.js';
import { renderRadarChart, renderHistoryChart, destroyAll } from '../components/charts.js';

/* ── Module state ─────────────────────────── */
let _currentUser  = null;
let _departments  = [];
let _supervisors  = [];
let _employees    = [];
let _evalCriteria = [];
let _topicMap     = {};   // {topicId: {eval_criteria_id, points}}
let _monStats     = {};   // {employeeId: computed stats}
let _filters      = { supId: '', collabId: '', dateFrom: '', dateTo: '' };
let _actionPlans  = {};
let _dataLoaded   = false;

/* ── Role helpers ─────────────────────────── */
function isAnalista() {
  return _currentUser?.role === 'analista' || (_currentUser?.accessLevel ?? 0) >= 4;
}

function isGestor() {
  return _currentUser?.role === 'gestor' || (_currentUser?.accessLevel ?? 0) === 3;
}

function canFilterSupervisors() {
  return isAnalista() || isGestor();
}

function myDept() {
  return _departments.find(d => d.id === _currentUser?.departmentId);
}


function buildCollabOpts(supId, selectedId) {
  const list = supId ? _employees.filter(e => e.supervisor_id === supId) : _employees;
  return `<option value="">Todos</option>` +
    list.map(c =>
      `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.name}</option>`
    ).join('');
}

/* ── Card visibility (no re-render) ─────── */
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

/* ── Compute per-employee stats from monitoring rows ── */
function computeMonStats(monitorings) {
  const stats = {};
  for (const emp of _employees) {
    stats[emp.id] = {
      count: 0, zeroed: 0, avgPct: 0, ptsLost: 0,
      scCount: 0, avgTma: '—', avgTmpr: '—', avgTmer: '—', avgCsat: 0,
      radarPcts: {},   // {criteriaId: pct}
      history:   [],   // [{date, pct}] sorted asc
      lastDate:  null,
    };
  }

  for (const mon of monitorings) {
    const s = stats[mon.employee_id];
    if (!s) continue;

    s.count++;
    if (mon.zeroed) s.zeroed++;

    let earnedPts = 0;
    let totalMax  = 0;
    const earnedByCriteria = {};
    const maxByCriteria    = {};

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
  const [deptRes, supRes, empRes, ecRes, topicRes] = await Promise.all([
    supabase.from('departments').select('id, name').order('name'),
    supabase.from('profiles').select('id, name, department_id').eq('role', 'supervisor').order('name'),
    supabase.from('employees').select('id, name, supervisor_id').eq('active', true).order('name'),
    supabase.from('eval_criteria').select('id, name').eq('active', true),
    supabase.from('topic').select('id, eval_criteria_id, points').eq('active', true),
  ]);
  if (deptRes.error)  console.error('[consulta] departments:', deptRes.error);
  if (supRes.error)   console.error('[consulta] supervisors:', supRes.error);
  if (empRes.error)   console.error('[consulta] employees:', empRes.error);
  if (ecRes.error)    console.error('[consulta] eval_criteria:', ecRes.error);
  if (topicRes.error) console.error('[consulta] topic:', topicRes.error);
  _departments  = deptRes.data  ?? [];
  _supervisors  = supRes.data   ?? [];
  _employees    = empRes.data   ?? [];
  _evalCriteria = ecRes.data    ?? [];
  _topicMap     = Object.fromEntries((topicRes.data ?? []).map(t => [t.id, t]));
}

async function fetchMonitoringData() {
  if (!_filters.dateFrom || !_filters.dateTo) return;
  const { data, error } = await supabase
    .from('monitoring')
    .select(`
      id, employee_id, date, zeroed,
      topic_approval(topic_id, obtained),
      service_chat(service_time, first_response_time, max_response_time, csat)
    `)
    .gte('date', _filters.dateFrom)
    .lte('date', _filters.dateTo);
  if (error) { console.error('[consulta] monitoring:', error); return; }
  _monStats = computeMonStats(data ?? []);
}

/* ── render() ─────────────────────────────── */
export function render() {
  if (!_filters.dateFrom) {
    const now     = new Date();
    const y       = now.getFullYear();
    const m       = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    _filters.dateFrom = `${y}-${m}-01`;
    _filters.dateTo   = `${y}-${m}-${lastDay}`;
  }

  if (!_dataLoaded) {
    return `
      <div class="page-enter">
        <div class="page-header">
          <div class="page-title">Consulta por Associado</div>
          <div class="page-subtitle">Análise detalhada de desempenho individual por período</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;height:300px;gap:12px;color:var(--text-secondary)">
          <div class="boot-spinner" style="width:20px;height:20px;border-width:2px"></div>
          Carregando dados…
        </div>
      </div>`;
  }

  const analista    = isAnalista();
  const canFilterSup = canFilterSupervisors();
  const dept        = myDept();
  const daysDiff = _filters.dateFrom && _filters.dateTo
    ? Math.round((new Date(_filters.dateTo) - new Date(_filters.dateFrom)) / 86400000) + 1
    : 0;

  /* Department: info display (same visual as form-group) */
  const deptInfoHtml = `
    <div class="form-group" style="margin-bottom:0">
      <label class="form-label">Departamento</label>
      <div class="form-input" style="opacity:.75;cursor:default;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${dept?.name ?? '—'}
      </div>
    </div>`;

  /* Supervisor: select for analyst/gestor, readonly for supervisor */
  const supFilterHtml = canFilterSup
    ? `<div class="form-group" style="margin-bottom:0">
         <label class="form-label">Supervisor</label>
         <select class="form-select" id="f-sup">
           <option value="">Todos</option>
           ${_supervisors.map(s =>
             `<option value="${s.id}" ${s.id === _filters.supId ? 'selected' : ''}>${s.name}</option>`
           ).join('')}
         </select>
       </div>`
    : `<div class="form-group" style="margin-bottom:0">
         <label class="form-label">Supervisor</label>
         <div class="form-input" style="opacity:.75;cursor:default">
           ${_currentUser?.name ?? '—'}
         </div>
       </div>`;

  /* Render ALL employees as cards sorted by most recent monitoring date */
  const sorted = [..._employees].sort((a, b) => {
    const da = _monStats[a.id]?.lastDate ?? '';
    const db = _monStats[b.id]?.lastDate ?? '';
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  });
  const cards = sorted.map(c => renderCard(c)).join('');

  return `
    <div class="page-enter">
      <!-- Header -->
      <div class="page-header">
        <div class="page-title">Consulta por Associado</div>
        <div class="page-subtitle">Análise detalhada de desempenho individual por período</div>
      </div>

      <!-- Filters -->
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

        <div class="consulta-filters__date-row">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Data inicial</label>
            <input class="form-input" type="date" id="f-date-from" value="${_filters.dateFrom}">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Data final</label>
            <input class="form-input" type="date" id="f-date-to" value="${_filters.dateTo}">
          </div>
          <div class="date-range-info">
            <span id="date-range-days">
              ${daysDiff ? `<strong>${daysDiff}</strong> dias selecionados` : '—'}
            </span>
            ${daysDiff > 90 ? `<span class="warn">⚠ Máximo: 90 dias</span>` : ''}
          </div>
          <button class="btn btn--ghost btn--sm" id="btn-clear-filters">Limpar filtros</button>
        </div>
      </div>

      <!-- Summary bar -->
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
        <div style="margin-left:auto">
          <span style="font-size:var(--text-xs);color:var(--text-tertiary)">
            ${_filters.dateFrom} → ${_filters.dateTo}
          </span>
        </div>
      </div>

      <!-- Cards grid -->
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
  `;
}

/* ── Card render ─────────────────────────── */
function renderCard(collab) {
  const s    = _monStats[collab.id] ?? { count: 0, zeroed: 0, avgPct: 0, ptsLost: 0, scCount: 0, avgTma: '—', avgTmpr: '—', avgTmer: '—', avgCsat: 0, history: [], lastDate: null };
  const sup  = _supervisors.find(sv => sv.id === collab.supervisor_id);
  const plan = _actionPlans[collab.id] ?? [];
  const band = resultBand(s.avgPct);

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

  const planItems = plan.map((item, i) => `
    <div class="cc-action-item">
      <input type="checkbox" class="cc-action-item__check ap-check"
             data-collab="${collab.id}" data-idx="${i}" ${item.done ? 'checked' : ''}>
      <span class="cc-action-item__text" style="${item.done ? 'text-decoration:line-through;opacity:.5' : ''}">${item.text}</span>
      ${item.deadline ? `<span class="cc-action-item__deadline">${item.deadline}</span>` : ''}
      <button class="cc-action-item__del ap-del" data-collab="${collab.id}" data-idx="${i}">🗑</button>
    </div>
  `).join('');

  return `
    <div class="cc-card" data-collab="${collab.id}" data-sup-id="${collab.supervisor_id ?? ''}">

      <div class="cc-card__header">
        <div class="cc-card__avatar">${getInitials(collab.name)}</div>
        <div class="cc-card__info">
          <div class="cc-card__name"><a href="#perfil?id=${collab.id}">${collab.name}</a></div>
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
            <span class="cc-metric-row__val ${s.zeroed ? 'cc-metric-row__val--red' : ''}">${s.count ? s.zeroed : '—'}</span>
          </div>
        </div>
        <div class="cc-radar-wrap">
          <canvas id="radar-cc-${collab.id}" width="240" height="240"></canvas>
        </div>
      </div>

      <div class="cc-action-plan" id="ap-${collab.id}">
        <button class="cc-action-plan__toggle ap-toggle" data-collab="${collab.id}">
          <span>📋 Plano de Ação ${plan.length ? `(${plan.filter(i=>!i.done).length} pendentes)` : ''}</span>
          <span class="cc-action-plan__toggle-icon">›</span>
        </button>
        <div class="cc-action-plan__body">
          <div class="cc-action-items" id="ap-items-${collab.id}">
            ${planItems || `<div style="font-size:var(--text-xs);color:var(--text-tertiary);padding:var(--space-2) 0">Nenhuma ação cadastrada</div>`}
          </div>
          <div class="cc-action-add">
            <input class="form-input ap-input" id="ap-input-${collab.id}"
                   placeholder="Nova ação de melhoria…" data-collab="${collab.id}">
            <input class="form-input" type="date" id="ap-date-${collab.id}"
                   style="font-size:var(--text-xs);height:28px;padding:0 8px">
            <button class="btn btn--primary ap-add-btn" data-collab="${collab.id}">+</button>
          </div>
        </div>
      </div>

      <div class="cc-history">
        <div class="cc-history__label">Histórico de Resultados</div>
        <div class="cc-history-bar">${historyHtml}</div>
      </div>
    </div>`;
  //     <div class="cc-insights">
  //       <div class="cc-insight-col cc-insight-col--error">
  //         <div class="cc-insight-col__title cc-insight-col__title--error">⚠ Erros frequentes</div>
  //         <div class="cc-insight-item" style="opacity:.35">Sem dados</div>
  //       </div>
  //       <div class="cc-insight-col cc-insight-col--good">
  //         <div class="cc-insight-col__title cc-insight-col__title--good">✔ Tem acertado em</div>
  //         <div class="cc-insight-item" style="opacity:.35">Sem dados</div>
  //       </div>
  //       <div class="cc-insight-col cc-insight-col--opp">
  //         <div class="cc-insight-col__title cc-insight-col__title--opp">📘 Oportunidades</div>
  //         <div class="cc-insight-item" style="opacity:.35">Sem dados</div>
  //       </div>
  //     </div>

  //   </div>
  // `;
}

/* ── Charts ───────────────────────────────── */
function initCharts() {
  const radarLabels = _evalCriteria.map(ec => ec.name.split(' ')[0]);

  _employees.forEach(collab => {
    const s = _monStats[collab.id];

    renderRadarChart(
      `radar-cc-${collab.id}`,
      radarLabels,
      [{ label: collab.name.split(' ')[0], data: _evalCriteria.map(ec => s?.radarPcts[ec.id] ?? 0) }]
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

/* ── Page reload (uses cached data) ──────── */
function reloadPage() {
  destroyAll();
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = render();
  bindEvents();
  applyCardVisibility();
}

/* ── Date range validation ─────────────────── */
function enforceDateRange() {
  const fromEl = document.getElementById('f-date-from');
  const toEl   = document.getElementById('f-date-to');
  const infoEl = document.getElementById('date-range-days');
  if (!fromEl || !toEl || !infoEl) return;

  const from = new Date(fromEl.value);
  const to   = new Date(toEl.value);
  if (!fromEl.value || !toEl.value) return;

  const days = Math.round((to - from) / 86400000) + 1;
  if (days > 90) {
    const capped = new Date(from);
    capped.setDate(capped.getDate() + 89);
    toEl.value = capped.toISOString().split('T')[0];
    infoEl.innerHTML = `<strong>90</strong> dias (máx. atingido)`;
  } else if (days > 0) {
    infoEl.innerHTML = `<strong>${days}</strong> dias selecionados`;
  }
}

/* ── Action plan helpers ─────────────────── */
function savePlan(collabId) {
  const items     = _actionPlans[collabId] ?? [];
  const container = document.getElementById(`ap-items-${collabId}`);
  if (!container) return;
  container.innerHTML = items.length
    ? items.map((item, i) => `
        <div class="cc-action-item">
          <input type="checkbox" class="cc-action-item__check ap-check"
                 data-collab="${collabId}" data-idx="${i}" ${item.done ? 'checked' : ''}>
          <span class="cc-action-item__text" style="${item.done ? 'text-decoration:line-through;opacity:.5' : ''}">${item.text}</span>
          ${item.deadline ? `<span class="cc-action-item__deadline">${item.deadline}</span>` : ''}
          <button class="cc-action-item__del ap-del" data-collab="${collabId}" data-idx="${i}">🗑</button>
        </div>
      `).join('')
    : `<div style="font-size:var(--text-xs);color:var(--text-tertiary);padding:var(--space-2) 0">Nenhuma ação cadastrada</div>`;

  container.querySelectorAll('.ap-check').forEach(bindCheckEvent);
  container.querySelectorAll('.ap-del').forEach(bindDelEvent);

  const toggle = document.querySelector(`.ap-toggle[data-collab="${collabId}"] span:first-child`);
  if (toggle) {
    const pending = items.filter(i => !i.done).length;
    toggle.textContent = `📋 Plano de Ação ${items.length ? `(${pending} pendentes)` : ''}`;
  }
}

function bindCheckEvent(chk) {
  chk.addEventListener('change', () => {
    const { collab, idx } = chk.dataset;
    if (_actionPlans[collab]?.[idx]) {
      _actionPlans[collab][idx].done = chk.checked;
      savePlan(collab);
    }
  });
}

function bindDelEvent(btn) {
  btn.addEventListener('click', () => {
    const { collab, idx } = btn.dataset;
    _actionPlans[collab]?.splice(Number(idx), 1);
    savePlan(collab);
  });
}

/* ── Event binding ─────────────────────────── */
function bindEvents() {
  initCharts();

  document.getElementById('f-date-from')?.addEventListener('change', async e => {
    _filters.dateFrom = e.target.value;
    enforceDateRange();
    await fetchMonitoringData();
    reloadPage();
  });
  document.getElementById('f-date-to')?.addEventListener('change', async e => {
    _filters.dateTo = e.target.value;
    enforceDateRange();
    await fetchMonitoringData();
    reloadPage();
  });

  /* Supervisor change → update collab select + apply visibility */
  document.getElementById('f-sup')?.addEventListener('change', e => {
    _filters.supId    = e.target.value;
    _filters.collabId = '';
    const colSel = document.getElementById('f-collab');
    if (colSel) colSel.innerHTML = buildCollabOpts(_filters.supId, '');
    applyCardVisibility();
  });

  /* Collaborator change → apply visibility immediately */
  document.getElementById('f-collab')?.addEventListener('change', e => {
    _filters.collabId = e.target.value;
    applyCardVisibility();
  });

  /* Clear all filters */
  document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
    _filters = {
      supId:    isAnalista() ? '' : (_currentUser?.id ?? ''),
      collabId: '',
      dateFrom: '',
      dateTo:   '',
    };
    reloadPage();
  });

  document.querySelectorAll('.ap-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(`ap-${btn.dataset.collab}`)?.classList.toggle('open');
    });
  });

  document.querySelectorAll('.ap-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const collabId = btn.dataset.collab;
      const input    = document.getElementById(`ap-input-${collabId}`);
      const dateEl   = document.getElementById(`ap-date-${collabId}`);
      const text     = input?.value.trim();
      if (!text) return;
      if (!_actionPlans[collabId]) _actionPlans[collabId] = [];
      _actionPlans[collabId].push({ text, done: false, deadline: dateEl?.value ?? '' });
      if (input)  input.value  = '';
      if (dateEl) dateEl.value = '';
      savePlan(collabId);
    });
  });

  document.querySelectorAll('.ap-input').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')
        document.querySelector(`.ap-add-btn[data-collab="${inp.dataset.collab}"]`)?.click();
    });
  });

  document.querySelectorAll('.ap-check').forEach(bindCheckEvent);
  document.querySelectorAll('.ap-del').forEach(bindDelEvent);
}

/* ── init ─────────────────────────────────── */
export async function init() {
  _currentUser = getCurrentUser();

  if (!canFilterSupervisors()) {
    _filters.supId = _currentUser?.id ?? '';
  }

  /* Garante spinner imediato em qualquer visita (incluindo revisitas com dados obsoletos) */
  _dataLoaded = false;
  const _initMain = document.getElementById('main-content');
  if (_initMain) _initMain.innerHTML = render();

  try {
    if (!_employees.length) await fetchData();
    await fetchMonitoringData();
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
