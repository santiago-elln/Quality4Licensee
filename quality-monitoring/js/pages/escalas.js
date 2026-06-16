/* ============================================================
   ESCALAS DE TRABALHO
   ============================================================ */
import { supabase } from '../supabase.js';
import { getCurrentUser } from '../auth.js';
import { toast } from '../components/toast.js';
import { can, P } from '../utils/permissions.js';

// ─── Grid constants ───────────────────────────────────────────────────────────
const GRID_START = 8 * 60
const GRID_END   = 20 * 60
const GRID_DUR   = GRID_END - GRID_START
const SLOT_MIN   = 15
const NUM_SLOTS  = GRID_DUR / SLOT_MIN
const SNAP       = 15

const SECTOR_ORDER = ['Gestores & Abaixo', 'Diretores', 'Executivos', 'Performance']
const SECTOR_CLASS = {
  'Gestores & Abaixo': 'esc-tab-gestores',
  'Diretores':         'esc-tab-diretores',
  'Executivos':        'esc-tab-executivos',
  'Performance':       'esc-tab-performance',
}

// ─── Utilities ────────────────────────────────────────────────────────────────
const timeToMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const minToTime = m =>
  `${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`
const minToPct  = m => ((m - GRID_START) / GRID_DUR * 100).toFixed(4)
const slotPct   = i => (i / NUM_SLOTS * 100).toFixed(4)
const durToPct  = d => (d / GRID_DUR * 100).toFixed(4)
const snapMin   = m => Math.round(m / SNAP) * SNAP
const durLabel  = m => { const h = Math.floor(m/60), r = m%60; return h&&r?`${h}h${String(r).padStart(2,'0')}`:h?`${h}h`:`${r}min` }
const clamp     = (v,lo,hi) => Math.max(lo, Math.min(hi, v))
const todayISO  = () => new Date().toISOString().split('T')[0]
const $e        = id => document.getElementById(id)
const gridPxNow = () => { const el = document.querySelector('.esc-emp-grid'); return el ? el.clientWidth : 800 }

// ─── Calendar Picker ──────────────────────────────────────────────────────────
const EscCalendar = (() => {
  const WEEKDAYS = ['D','S','T','Q','Q','S','S']
  const MONTHS   = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  let leftYear, leftMonth
  let startDate = null, endDate = null
  let pendingStart = null, pendingEnd = null
  let hoverDate = null, selecting = false, onApply = null
  let singleDay = false
  let modal = null

  const pad   = n       => String(n).padStart(2,'0')
  const toStr = (y,m,d) => `${y}-${pad(m+1)}-${pad(d)}`
  const cmp   = (a,b)   => a < b ? -1 : a > b ? 1 : 0
  const fromStr      = s => { const [y,m,d] = s.split('-').map(Number); return { y, m:m-1, d } }
  const daysInMonth  = (y,m) => new Date(y,m+1,0).getDate()
  const dayOfWeek    = (y,m,d) => new Date(y,m,d).getDay()

  function formatRange(from, to) {
    if (!from) return 'Selecionar data'
    const f = fromStr(from), t = to ? fromStr(to) : f
    if (!to || from === to) return `${f.d} de ${MONTHS[f.m]} de ${f.y}`
    if (f.y===t.y && f.m===t.m) return `${f.d}–${t.d} de ${MONTHS[f.m]} de ${f.y}`
    if (f.y===t.y) return `${f.d} ${MONTHS[f.m].slice(0,3)} – ${t.d} ${MONTHS[t.m].slice(0,3)} ${f.y}`
    return `${f.d}/${pad(f.m+1)}/${f.y} – ${t.d}/${pad(t.m+1)}/${t.y}`
  }

  function buildMonthHTML(year, month) {
    const today  = new Date()
    const todayS = toStr(today.getFullYear(), today.getMonth(), today.getDate())
    const sel0   = pendingStart || startDate
    const sel1   = (selecting ? hoverDate : null) || pendingEnd || endDate
    const [rangeA, rangeB] = sel0 && sel1
      ? (cmp(sel0,sel1)<=0 ? [sel0,sel1] : [sel1,sel0]) : [sel0, null]
    const firstDOW = dayOfWeek(year, month, 1)
    const days     = daysInMonth(year, month)
    let h = `<div class="esc-cal-month-header"><div class="esc-cal-month-title">${MONTHS[month]} ${year}</div></div>`
    h += '<div class="esc-cal-weekdays">' + WEEKDAYS.map(w=>`<span class="esc-cal-weekday">${w}</span>`).join('') + '</div><div class="esc-cal-days">'
    for (let i = 0; i < firstDOW; i++) h += '<div class="esc-cal-day empty"></div>'
    for (let d = 1; d <= days; d++) {
      const ds       = toStr(year, month, d)
      const isFuture = cmp(ds, todayS) > 0
      let cls = 'esc-cal-day'
      if (isFuture)                                             cls += ' disabled'
      if (ds === rangeA)                                        cls += ' range-start'
      if (rangeB && ds === rangeB)                              cls += ' range-end'
      if (rangeA && rangeB && cmp(ds,rangeA)>0 && cmp(ds,rangeB)<0) cls += ' in-range'
      if (ds === todayS)                                        cls += ' today'
      h += `<div class="${cls}"${isFuture ? '' : ` data-date="${ds}"`}><span class="esc-day-num">${d}</span></div>`
    }
    return h + '</div>'
  }

  function renderCal() {
    const ry = leftMonth===11 ? leftYear+1 : leftYear
    const rm = leftMonth===11 ? 0 : leftMonth+1
    const elL = $e('escCalLeft'), elR = $e('escCalRight')
    if (!elL || !elR) return
    elL.innerHTML = buildMonthHTML(leftYear, leftMonth)
    elR.innerHTML = buildMonthHTML(ry, rm)
    $e('escCalPrev').onclick = () => { if(leftMonth===0){leftMonth=11;leftYear--}else leftMonth--; renderCal() }
    $e('escCalNext').onclick = () => { if(leftMonth===11){leftMonth=0;leftYear++}else leftMonth++; renderCal() }
  }

  function createModal() {
    const overlay = document.createElement('div')
    overlay.id = 'escCalModal'; overlay.className = 'esc-cal-overlay'
    overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true')
    overlay.innerHTML = `
      <div class="esc-cal-content" id="escCalContent">
        <div class="esc-cal-header">
          <span class="esc-cal-title">Selecionar período</span>
          <button class="esc-cal-close" id="escCalClose">✕</button>
        </div>
        <div class="esc-cal-nav-row">
          <button class="esc-cal-nav" id="escCalPrev">&#8249;</button>
          <div class="esc-calendar-months">
            <div class="esc-cal-month" id="escCalLeft"></div>
            <div class="esc-cal-month" id="escCalRight"></div>
          </div>
          <button class="esc-cal-nav" id="escCalNext">&#8250;</button>
        </div>
        <div class="esc-cal-actions">
          <button class="esc-cal-btn-cancel" id="escCalCancel">Cancelar</button>
          <button class="esc-cal-btn-apply"  id="escCalApply">Aplicar</button>
        </div>
      </div>`
    document.body.appendChild(overlay)
    const mc = overlay.querySelector('.esc-calendar-months')
    mc.addEventListener('click', e => {
      const cell = e.target.closest('[data-date]'); if (!cell) return
      const ds = cell.dataset.date
      if (singleDay) { pendingStart=ds; pendingEnd=ds; selecting=false; hoverDate=null }
      else if (!selecting) { pendingStart=ds; pendingEnd=null; hoverDate=null; selecting=true }
      else {
        const [a,b] = cmp(pendingStart,ds)<=0 ? [pendingStart,ds] : [ds,pendingStart]
        pendingStart=a; pendingEnd=b; hoverDate=null; selecting=false
      }
      renderCal()
    })
    mc.addEventListener('mouseover', e => {
      if (!selecting) return
      const cell = e.target.closest('[data-date]'); if (!cell) return
      const ds = cell.dataset.date; if (ds===hoverDate) return
      hoverDate=ds; renderCal()
    })
    mc.addEventListener('mouseleave', () => { if (!selecting) return; hoverDate=null; renderCal() })
    $e('escCalApply').addEventListener('click', () => {
      if (!pendingStart||!pendingEnd) return
      startDate=pendingStart; endDate=pendingEnd
      const rd=$e('esc-range'); if(rd) rd.textContent=formatRange(startDate,endDate)
      closeModal(); onApply(startDate, endDate)
    })
    $e('escCalCancel').addEventListener('click', closeModal)
    $e('escCalClose').addEventListener('click', closeModal)
    overlay.addEventListener('click', e => { if(e.target===overlay) closeModal() })
    document.addEventListener('keydown', e => {
      if (e.key==='Escape' && modal?.classList.contains('open')) closeModal()
    })
    return overlay
  }

  function openModal() {
    pendingStart=startDate; pendingEnd=endDate; selecting=false; hoverDate=null
    const trigger=$e('esc-cal-toggle'), content=$e('escCalContent')
    if (!content||!trigger) return
    const rect=trigger.getBoundingClientRect(), cardW=content.offsetWidth||480
    let top=rect.bottom+8, left=rect.left
    if (left+cardW>window.innerWidth-16) left=window.innerWidth-cardW-16
    if (left<16) left=16
    if (top+360>window.innerHeight-16) top=rect.top-360-8
    content.style.top=top+'px'; content.style.left=left+'px'
    modal.classList.add('open'); renderCal()
  }

  function closeModal() { modal?.classList.remove('open'); selecting=false; hoverDate=null }

  return {
    setSingleDay(val) {
      singleDay=val
      if (val&&startDate) { endDate=startDate; const rd=$e('esc-range'); if(rd) rd.textContent=formatRange(startDate,startDate) }
    },
    init(from, to, callback, opts={}) {
      singleDay=opts.singleDay??false; onApply=callback; startDate=from; endDate=to
      const a=fromStr(from); leftYear=a.y; leftMonth=a.m
      if (leftMonth===11) leftMonth=10
      const rd=$e('esc-range'); if(rd) rd.textContent=formatRange(from,to)
      if (!modal) modal=createModal()
      const toggle=$e('esc-cal-toggle'); if(toggle) toggle.onclick=openModal
    },
  }
})()

// ─── Module state ─────────────────────────────────────────────────────────────
let _user         = null
let _viewMode     = 'edit'
let _selectedDate = null
let _selectedDateRange = { from: null, to: null }
let _activeMetrics = new Set()
let _sectorGroups = []   // [{id, name}] — unique groups among visible employees
let _deptSectors  = []   // [{id, name}] — unique sectors across visible employees (analytics overlays)
let _employees    = []
let _shifts       = {}
let _origShifts   = {}
let _sbNatural    = {} // eid -> {sb1, sb2}: last explicitly-set SB positions (not push-derived)
let _breakNatural = {} // eid -> break_start_min: last explicitly-set break position (not push-derived)
const _dirty      = new Set()
let _drag              = null
let _abortCtrl         = null
let _pendingSingleSave  = null  // eid awaiting confirmation via the row ✓ button
let _defaultShiftCache = {}    // kept for legacy save paths; no longer used for fetching

// ─── render ───────────────────────────────────────────────────────────────────
export function render() {
  return `
    <div class="escalas-page" id="escalas-root">
      <div class="esc-toolbar">
        <div class="esc-mode-toggle">
          <button class="esc-mode-btn active" data-mode="edit">Edição</button>
          <button class="esc-mode-btn" data-mode="analysis">Análise</button>
        </div>
        <div class="esc-cal-wrap">
          <button id="esc-cal-toggle" class="esc-cal-trigger">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span id="esc-range">—</span>
          </button>
          <span id="esc-metrics-warn" class="esc-metrics-warn"></span>
        </div>
        <div id="esc-metrics-wrap" class="esc-metrics-wrap">
          <button class="esc-metric-btn" data-metric="tme">TME</button>
          <button class="esc-metric-btn" data-metric="tma">TMA</button>
          <button class="esc-metric-btn" data-metric="csat">CSAT</button>
        </div>
      </div>
      <div id="esc-sector-tabs" class="esc-sector-tabs"></div>
      <div id="esc-stats" class="esc-stats-bar"></div>
      <div id="esc-main" class="esc-schedule-main">
        <div class="esc-status-state"><div class="loading-spinner"></div>Carregando…</div>
      </div>
      <div id="esc-save-bar" class="esc-save-bar esc-save-hidden">
        <span class="esc-save-info">⚠ Você tem alterações não salvas</span>
        <div class="esc-save-actions">
          <button id="esc-discard-btn" class="esc-btn-discard" title="Descartar alterações">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
          <button id="esc-save-btn" class="esc-btn-save">Salvar Alterações</button>
        </div>
      </div>
      <div id="esc-confirm-modal" class="modal-overlay modal-overlay--hidden">
        <div class="modal modal--sm">
          <div class="modal__header">
            <span class="modal__title">Confirmar Alterações</span>
          </div>
          <div class="modal__body">
            <p style="color:var(--text-secondary);font-size:var(--text-sm)">
              Deseja salvar as alterações feitas nas escalas?<br>
              Esta ação irá atualizar os dados no banco de dados.
            </p>
            <label class="check-item" style="margin-top:var(--space-3)">
              <input type="checkbox" id="esc-set-default" value="1" checked/>
              <span class="form-label" style="font-weight:var(--weight-normal)">Definir como horário padrão?</span>
            </label>
          </div>
          <div class="modal__footer">
            <button id="esc-modal-cancel" class="btn btn--ghost">Cancelar</button>
            <button id="esc-modal-confirm" class="btn"
                    style="background:var(--brand-green);color:var(--brand-dark);border:none">Salvar</button>
          </div>
        </div>
      </div>
    </div>`
}

// ─── init ─────────────────────────────────────────────────────────────────────
export async function init() {
  _abortCtrl?.abort()
  _abortCtrl = new AbortController()
  const sig = _abortCtrl.signal

  _user = getCurrentUser()
  _viewMode = can(_user, P.SHIFTS_EDIT) ? 'edit' : 'analysis'
  _activeMetrics = new Set()
  _sectorGroups = []
  _deptSectors  = []
  _employees = []; _shifts = {}; _origShifts = {}; _sbNatural = {}; _breakNatural = {}
  _dirty.clear(); _drag = null

  const today = todayISO()
  _selectedDate = today
  _selectedDateRange = { from: today, to: today }
  EscCalendar.init(today, today, async (from, to) => {
    _selectedDate=from; _selectedDateRange={from,to}
    _dirty.clear()
    document.querySelectorAll('.esc-drag-ghost').forEach(g=>g.remove())
    document.querySelectorAll('.esc-emp-row').forEach(r=>r.classList.remove('esc-has-changes'))
    hideSaveBar(); showStatus('Carregando…')
    await loadData(); renderGrid()
  }, { singleDay: true })

  document.querySelectorAll('.esc-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === _viewMode)
    btn.addEventListener('click', () => setViewMode(btn.dataset.mode), { signal: sig })
  })
  document.querySelectorAll('.esc-metric-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const m=btn.dataset.metric
      if (_activeMetrics.has(m)) { _activeMetrics.delete(m); btn.classList.remove('active') }
      else                        { _activeMetrics.add(m);    btn.classList.add('active')    }
      renderMetricOverlay()
    }, { signal: sig })
  )

  $e('esc-discard-btn')?.addEventListener('click', discardChanges, { signal: sig })
  $e('esc-save-btn')?.addEventListener('click', openConfirmModal, { signal: sig })
  $e('esc-modal-cancel')?.addEventListener('click', () => {
    _pendingSingleSave = null
    closeConfirmModal()
  }, { signal: sig })
  $e('esc-modal-confirm')?.addEventListener('click', confirmSave, { signal: sig })

  document.addEventListener('mouseover', e => {
    const sl = e.target.closest('.esc-avail-slot'); if (sl) showAvailTooltip(sl)
    else hideAvailTooltip()
  }, { signal: sig })
  document.addEventListener('mouseleave', hideAvailTooltip, { signal: sig })
  document.addEventListener('mousedown',  onDown, { signal: sig })
  document.addEventListener('mousemove',  onMove, { signal: sig })
  document.addEventListener('mouseup',    onUp,   { signal: sig })
  document.addEventListener('touchstart', onDown, { passive: false, signal: sig })
  document.addEventListener('touchmove',  onMove, { passive: false, signal: sig })
  document.addEventListener('touchend',   onUp,   { signal: sig })
  document.addEventListener('click', e => {
    const eid = e.target.closest('[data-eid]')?.dataset.eid; if (!eid) return
    if (e.target.closest('.esc-row-save'))    { _pendingSingleSave = eid; openConfirmModal() }
    if (e.target.closest('.esc-row-discard')) discardOneEmployee(eid)
  }, { signal: sig })

  $e('esc-sector-tabs') && ($e('esc-sector-tabs').innerHTML = '')
  showStatus('Carregando escala…')
  await loadData()
  renderGrid()
}

// ─── Data ─────────────────────────────────────────────────────────────────────
async function loadData() {
  _shifts = {}; _origShifts = {}; _sbNatural = {}; _breakNatural = {}

  /* Fetch shifts scoped to the user's sector_group (null = global view, no filter) */
  const user     = getCurrentUser();
  const sgFilter = can(user, P.GLOBAL_VIEW_DEPT) ? null : (user.sectorGroupId ?? null);
  const { data: shiftRows, error } = await supabase
    .rpc('get_employees_for_shifts', { p_date: _selectedDate, p_sector_group_id: sgFilter })
  if (error) { showStatus('Erro ao carregar escalas.', true); return }

  /* Fetch own-team employees (names) — scoped explicitly because RLS runs as the
     real authenticated user (not the view-as user) and would otherwise return all rows. */
  let ownEmpsQuery = supabase
    .from('employees')
    .select('id, name, team_id, sector_id, sector_group_id')
    .eq('active', true)
    .order('name')
  if (!can(user, P.GLOBAL_VIEW_DEPT)) {
    const teamIds = user.supervisedTeamIds ?? [];
    if (teamIds.length) {
      ownEmpsQuery = ownEmpsQuery.in('team_id', teamIds);
    } else if (user.employeeId) {
      ownEmpsQuery = ownEmpsQuery.eq('id', user.employeeId);
    } else {
      ownEmpsQuery = ownEmpsQuery.eq('id', '00000000-0000-0000-0000-000000000000');
    }
  }
  const { data: ownEmps } = await ownEmpsQuery
  const ownEmpMap = new Map((ownEmps ?? []).map(e => [e.id, e]))

  /* Build employees list and sector-groups from the shift rows */
  const seenEmps = new Set()
  const seenSgs  = new Set()
  _employees    = []
  _sectorGroups = []

  for (const row of (shiftRows ?? [])) {
    if (row.sector_group_id && !seenSgs.has(row.sector_group_id)) {
      seenSgs.add(row.sector_group_id)
      _sectorGroups.push({ id: row.sector_group_id, name: row.sg_name ?? '—' })
    }
    if (!seenEmps.has(row.employee_id)) {
      seenEmps.add(row.employee_id)
      const own = ownEmpMap.get(row.employee_id)
      _employees.push({
        id:              row.employee_id,
        team_id:         row.team_id,
        sector_id:       own?.sector_id   ?? null,
        sector_group_id: row.sector_group_id,
        name:            own?.name        ?? null,  // null = other team → ghost row
      })
    }
    /* Populate shifts */
    if (row.shift_id) {
      const startMin      = timeToMin(row.start_time)
      const endMin        = timeToMin(row.end_time)
      const breakStartMin = timeToMin(row.break_start)
      const breakEndMin   = breakStartMin + row.break_duration_minutes

      /* Default small-break positions when DB columns are null */
      const sb1Lo = startMin, sb1Hi = breakStartMin - 45
      const sb2Lo = breakEndMin + 30, sb2Hi = endMin - 75
      const sb1Default = sb1Hi > sb1Lo ? clamp(snapMin(startMin + 90), sb1Lo, sb1Hi) : null
      const sb2Default = sb2Hi > sb2Lo ? clamp(snapMin(breakEndMin + 90), sb2Lo, sb2Hi) : null

      const parsed = {
        id:                    row.shift_id,
        employee_id:           row.employee_id,
        start_time:            row.start_time,
        end_time:              row.end_time,
        break_start:           row.break_start,
        break_duration_minutes: row.break_duration_minutes,
        is_default:            row.is_default,
        validated:             row.validated ?? false,
        updated_by:            row.updated_by,
        updated_at:            row.updated_at,
        start_min:             startMin,
        end_min:               endMin,
        break_start_min:       breakStartMin,
        small_break_1_min:     row.small_break_1_start ? timeToMin(row.small_break_1_start) : sb1Default,
        small_break_2_min:     row.small_break_2_start ? timeToMin(row.small_break_2_start) : sb2Default,
        is_from_default:       row.is_default ?? false,
        date_shift_id:         row.is_default ? null : row.shift_id,
        default_shift_id:      row.is_default ? row.shift_id : null,
      }
      _shifts[row.employee_id]     = parsed
      _origShifts[row.employee_id] = { ...parsed }
      _sbNatural[row.employee_id]    = { sb1: parsed.small_break_1_min, sb2: parsed.small_break_2_min }
      _breakNatural[row.employee_id] = parsed.break_start_min
    }
  }

  /* Plain employees (no team, no sector group, no global view) only see their own row */
  const isOwnOnly = !can(user, P.GLOBAL_VIEW_DEPT)
    && !(user.supervisedTeamIds?.length)
    && !user.sectorGroupId;
  if (isOwnOnly) {
    _employees = user.employeeId
      ? _employees.filter(e => e.id === user.employeeId)
      : [];
  }

  /* Own-team employees first (name !== null), then ghosts; alphabetical within each group */
  _employees.sort((a, b) => {
    const aOwn = a.name !== null ? 0 : 1;
    const bOwn = b.name !== null ? 0 : 1;
    if (aOwn !== bOwn) return aOwn - bOwn;
    return (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR');
  });

  if (!_employees.length) { _dirty.clear(); hideSaveBar(); updateStats(); return }

  /* Populate sector data for analytics overlays (both global and supervisor paths) */
  const uniqueSectorIds = [...new Set(_employees.map(e => e.sector_id).filter(Boolean))]
  if (uniqueSectorIds.length) {
    const { data: secData } = await supabase
      .from('sectors').select('id, name').in('id', uniqueSectorIds).eq('active', true).order('name')
    _deptSectors = secData ?? []
  }

  _dirty.clear(); hideSaveBar(); updateStats()
}

// ─── Availability ─────────────────────────────────────────────────────────────
function calcAvailForGroup(slotMin, empIds) {
  return empIds.reduce((n, id) => {
    const s = _shifts[id]; if (!s) return n
    const inShift    = s.start_min <= slotMin && s.end_min > slotMin
    const onBreak    = s.break_start_min <= slotMin && (s.break_start_min + s.break_duration_minutes) > slotMin
    const onSmallBrk = (s.small_break_1_min !== null && s.small_break_1_min <= slotMin && s.small_break_1_min + 15 > slotMin)
                    || (s.small_break_2_min !== null && s.small_break_2_min <= slotMin && s.small_break_2_min + 15 > slotMin)
    return n + (inShift && !onBreak && !onSmallBrk ? 1 : 0)
  }, 0)
}

function calcAvail(slotMin) {
  return calcAvailForGroup(slotMin, _employees.map(e => e.id))
}

// ─── Avail slot tooltip ───────────────────────────────────────────────────────
let _availTooltip = null
function ensureTooltip() {
  if (_availTooltip) return _availTooltip
  _availTooltip = document.createElement('div')
  _availTooltip.className = 'esc-avail-tooltip'
  document.body.appendChild(_availTooltip)
  return _availTooltip
}

function getSlotStatus(s, slotMin) {
  if (!s || s.start_min > slotMin || s.end_min <= slotMin) return null
  if (s.break_start_min <= slotMin && s.break_start_min + s.break_duration_minutes > slotMin) return 'Pausa'
  if (s.small_break_1_min !== null && s.small_break_1_min <= slotMin && s.small_break_1_min + 15 > slotMin) return 'Café'
  if (s.small_break_2_min !== null && s.small_break_2_min <= slotMin && s.small_break_2_min + 15 > slotMin) return 'Café'
  if (s.break_start_min - 30 <= slotMin && slotMin < s.break_start_min) return 'Pré-pausa'
  return 'Disponível'
}

const STATUS_DOT = { 'Disponível':'#16a34a', 'Café':'#4ade80', 'Pausa':'#d97706', 'Pré-pausa':'#f59e0b' }

function showAvailTooltip(slotEl) {
  const slot = parseInt(slotEl.dataset.slot); if (isNaN(slot)) return
  const slotMin  = GRID_START + slot * SLOT_MIN
  const sectorId = slotEl.dataset.sectorId
  const emps     = sectorId
    ? _employees.filter(e => String(e.sector_group_id) === sectorId || String(e.sector_id) === sectorId)
    : _employees
  const entries  = emps.map(emp => ({ name: emp.name, status: getSlotStatus(_shifts[emp.id], slotMin) }))
                       .filter(e => e.status !== null && e.name)
                       .sort((a,b) => a.status.localeCompare(b.status))
  if (!entries.length) return

  const tt = ensureTooltip()
  tt.innerHTML = `<div class="esc-tt-time">${minToTime(slotMin)} – ${minToTime(slotMin + SLOT_MIN)}</div>`
    + entries.map(e=>`<div class="esc-tt-row"><span class="esc-tt-dot" style="background:${STATUS_DOT[e.status]??'#9ca3af'}"></span><span class="esc-tt-name">${e.name}</span><span class="esc-tt-status" style="color:${STATUS_DOT[e.status]??'#6b7280'}">${e.status}</span></div>`).join('')
  tt.style.display = 'block'

  const r   = slotEl.getBoundingClientRect()
  const ttH = tt.offsetHeight || 160
  const ttW = tt.offsetWidth  || 220
  let left  = r.left + r.width / 2 - ttW / 2
  left = Math.max(8, Math.min(left, window.innerWidth - ttW - 8))
  tt.style.left = left + 'px'
  // Flip below if not enough room above
  const spaceAbove = r.top - 8
  if (spaceAbove < ttH) {
    tt.style.transform = 'none'
    tt.style.top = (r.bottom + window.scrollY + 8) + 'px'
  } else {
    tt.style.transform = ''
    tt.style.top = (r.top + window.scrollY - 8) + 'px'
  }
}

function hideAvailTooltip() {
  if (_availTooltip) _availTooltip.style.display = 'none'
}

// ─── Resize tooltip ───────────────────────────────────────────────────────────
let _resizeTip = null
function showResizeTip(durMin) {
  if (!_resizeTip) {
    _resizeTip = document.createElement('div')
    _resizeTip.className = 'esc-resize-tip'
    document.body.appendChild(_resizeTip)
  }
  _resizeTip.textContent = durLabel(durMin)
  _resizeTip.style.display = 'block'
  const bar = document.querySelector(`.esc-shift-bar[data-eid="${_drag.eid}"]`)
  if (!bar) return
  const r   = bar.getBoundingClientRect()
  const ttW = _resizeTip.offsetWidth || 52
  const left = Math.max(8, Math.min(r.right - ttW / 2, window.innerWidth - ttW - 8))
  _resizeTip.style.left = left + 'px'
  _resizeTip.style.top  = (r.top + window.scrollY - 8) + 'px'
}
function hideResizeTip() { if (_resizeTip) _resizeTip.style.display = 'none' }

function calcPreBreakForGroup(slotMin, empIds) {
  return empIds.reduce((n, id) => {
    const s = _shifts[id]; if (!s) return n
    const inShift    = s.start_min <= slotMin && s.end_min > slotMin
    const onBreak    = s.break_start_min <= slotMin && (s.break_start_min + s.break_duration_minutes) > slotMin
    const onSmallBrk = (s.small_break_1_min !== null && s.small_break_1_min <= slotMin && s.small_break_1_min + 15 > slotMin)
                    || (s.small_break_2_min !== null && s.small_break_2_min <= slotMin && s.small_break_2_min + 15 > slotMin)
    const inPreBreak = s.break_start_min - 30 <= slotMin && slotMin < s.break_start_min
    return n + (inShift && !onBreak && !onSmallBrk && inPreBreak ? 1 : 0)
  }, 0)
}

const slotInner = (count, pre) => pre > 0
  ? `${count}<span class="esc-prebreak-sub">${count - pre}</span>`
  : String(count)

function updateStats() {
  const total=_employees.length, withShift=_employees.filter(e=>_shifts[e.id]).length
  const el=$e('esc-stats'); if(!el) return
  const scopeItem = can(_user, P.GLOBAL_VIEW_DEPT)
    ? `<div class="esc-stat-item"><span class="esc-stat-label">Escopo</span><span class="esc-stat-value">Departamento</span></div>`
    : `<div class="esc-stat-item"><span class="esc-stat-label">Grupo</span><span class="esc-stat-value">${_sectorGroups[0]?.name ?? '—'}</span></div>`
  el.innerHTML=`
    <div class="esc-stats-content">
      ${scopeItem}
      <div class="esc-stat-divider"></div>
      <div class="esc-stat-item"><span class="esc-stat-label">Colaboradores</span><span class="esc-stat-value">${total}</span></div>
      <div class="esc-stat-divider"></div>
      <div class="esc-stat-item"><span class="esc-stat-label">Com escala</span><span class="esc-stat-value">${withShift}</span></div>
    </div>`
}

// ─── Sector row builders ──────────────────────────────────────────────────────
function buildSectorHeaderRow(sector, emps) {
  const empIds = emps.map(e => e.id)
  const cells = []
  for (let i = 0; i < NUM_SLOTS; i++) {
    const sm = GRID_START + i * SLOT_MIN
    const count = calcAvailForGroup(sm, empIds)
    const pre   = calcPreBreakForGroup(sm, empIds)
    const total = emps.length
    const hue = total ? Math.round(count / total * 120) : 45
    cells.push(`<div class="esc-avail-slot esc-sector-avail-slot${pre>0?' has-prebreak':''}"
      data-sector-id="${sector.id}" data-slot="${i}"
      style="left:${slotPct(i)}%;width:${slotPct(1)}%;background:hsl(${hue},38%,85%);color:hsl(${hue},50%,30%)">${slotInner(count,pre)}</div>`)
  }
  return `
    <div class="esc-srow esc-sector-header">
      <div class="esc-name-cell esc-sector-header-label">${sector.name}</div>
      <div class="esc-grid-cell esc-sector-header-grid" style="height:var(--esc-hdr-h)">${buildGridLines()}${cells.join('')}</div>
    </div>`
}

// ─── Grid rendering ───────────────────────────────────────────────────────────
function buildGridLines() {
  let h=''
  for(let i=0;i<=NUM_SLOTS;i++) h+=`<div class="esc-grid-line ${i%4===0?'major':i%2===0?'minor':'micro'}" style="left:${slotPct(i)}%"></div>`
  return `<div class="esc-grid-bg">${h}</div>`
}

function renderGrid() {
  const hourSlots=Array.from({length:NUM_SLOTS+1},(_,i)=>i).filter(i=>i%4===0)
  const timeLabels=hourSlots
    .filter((_,idx)=>idx!==0&&idx!==hourSlots.length-1)
    .map(i=>`<div class="esc-th-slot" style="left:${slotPct(i)}%">${minToTime(GRID_START+i*SLOT_MIN)}</div>`)
  const availCells=[]
  for(let i=0;i<NUM_SLOTS;i++){
    const sm=GRID_START+i*SLOT_MIN, count=calcAvail(sm)
    const pre=calcPreBreakForGroup(sm,_employees.map(e=>e.id))
    const total=_employees.length, hue=total?Math.round(count/total*120):45
    availCells.push(`<div class="esc-avail-slot${pre>0?' has-prebreak':''}" data-slot="${i}"
      style="left:${slotPct(i)}%;width:${slotPct(1)}%;background:hsl(${hue},38%,88%);color:hsl(${hue},45%,28%)">${slotInner(count,pre)}</div>`)
  }
  /* Group employees by sector_group when more than one group is visible */
  let empRowsHtml = ''
  if (_sectorGroups.length > 1) {
    for (const group of _sectorGroups) {
      const emps = _employees.filter(e => e.sector_group_id === group.id)
      if (!emps.length) continue
      empRowsHtml += buildSectorHeaderRow(group, emps)
      empRowsHtml += `<div class="esc-sector-rows" data-sector-id="${group.id}">${emps.map(buildEmpRow).join('')}</div>`
    }
  } else {
    empRowsHtml = _employees.map(buildEmpRow).join('')
  }

  const el=$e('esc-main'); if(!el) return
  el.innerHTML=`
    <div class="esc-schedule-wrapper">
      <div class="esc-srow esc-header-row">
        <div class="esc-name-cell esc-header-label">Colaborador</div>
        <div class="esc-grid-cell" style="height:var(--esc-hdr-h)">${buildGridLines()}${timeLabels.join('')}</div>
      </div>
      ${_sectorGroups.length > 1 ? '' : `
      <div class="esc-srow esc-avail-row">
        <div class="esc-name-cell esc-avail-label">Disponíveis</div>
        <div class="esc-grid-cell" id="esc-avail-grid" style="height:var(--esc-hdr-h)">${availCells.join('')}</div>
      </div>`}
      <div id="esc-emp-rows">${empRowsHtml}</div>
    </div>`
  renderMetricOverlay()
  requestAnimationFrame(() => {
    document.querySelectorAll('.esc-shift-bar').forEach(fadeStartTime)
  })
}

// ─── Metric overlay ───────────────────────────────────────────────────────────
function buildMetricSvg(data, pxPerUnit, totalH, rgb, id) {
  const W=1200, n=data.length, hw=W/n
  const hs=data.map(v=>Math.min(Math.round(v*pxPerUnit),totalH))

  /* Invert: values grow upward — map data height to SVG y (y=0 is top) */
  const ys=hs.map(h=>totalH-h)

  /* Points: left anchor + data centers (mid-column) + right anchor */
  const pts=[
    [0, ys[0]],
    ...ys.map((y,i)=>[(i+0.5)*hw, y]),
    [W, ys[n-1]],
  ]

  /* Catmull-Rom → cubic bezier segments */
  let segs=''
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[Math.max(i-1,0)], p1=pts[i], p2=pts[i+1], p3=pts[Math.min(i+2,pts.length-1)]
    const cp1x=(p1[0]+(p2[0]-p0[0])/6).toFixed(1), cp1y=(p1[1]+(p2[1]-p0[1])/6).toFixed(1)
    const cp2x=(p2[0]-(p3[0]-p1[0])/6).toFixed(1), cp2y=(p2[1]-(p3[1]-p1[1])/6).toFixed(1)
    segs+=` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }

  const strokeD=`M ${pts[0][0]} ${pts[0][1]}${segs}`
  /* Fill from bottom edge up to the curve */
  const fillD=`M 0 ${totalH} L ${pts[0][0]} ${pts[0][1]}${segs} L ${W} ${totalH} Z`

  /* Hour dot markers — visible at each data-center point */
  const dots=ys.map((y,i)=>{
    const cx=((i+0.5)*hw).toFixed(1)
    return `<circle cx="${cx}" cy="${y}" r="5" fill="rgba(${rgb},.8)" stroke="rgba(255,255,255,.85)" stroke-width="2" style="cursor:crosshair"/>`
  }).join('')

  const gid=`escmg-${id}`
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg')
  svg.setAttribute('width','100%'); svg.setAttribute('height','100%')
  svg.setAttribute('viewBox',`0 0 ${W} ${totalH}`); svg.setAttribute('preserveAspectRatio','none')
  svg.style.cssText='position:absolute;inset:0;overflow:visible'
  /* Gradient: opaque at the curve (top of fill), transparent at bottom */
  svg.innerHTML=`<defs><linearGradient id="${gid}" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0%"   stop-color="rgba(${rgb},0)"/>
    <stop offset="40%"  stop-color="rgba(${rgb},.08)"/>
    <stop offset="100%" stop-color="rgba(${rgb},.32)"/>
  </linearGradient></defs>
  <path d="${fillD}" fill="url(#${gid})"/>
  <path d="${strokeD}" fill="none" stroke="rgba(${rgb},.7)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  ${dots}`
  return svg
}

function aggregateHourlyMetrics(rows) {
  const r={tme:Array(12).fill(0),tma:Array(12).fill(0),csat:Array(12).fill(0)}, g={}
  rows.forEach(({hour,tme,tma,csat})=>{
    if(!g[hour]) g[hour]={tme:[],tma:[],csat:[]}
    if(tme!=null) g[hour].tme.push(tme)
    if(tma!=null) g[hour].tma.push(tma)
    if(csat!=null) g[hour].csat.push(csat)
  })
  const avg=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0
  for(let h=8;h<=19;h++){
    const gr=g[h]; if(!gr) continue
    const i=h-8; r.tme[i]=Math.round(avg(gr.tme)); r.tma[i]=Math.round(avg(gr.tma)); r.csat[i]=+avg(gr.csat).toFixed(2)
  }
  return r
}


async function loadAllSectorMetrics() {
  if(!_deptSectors.length||!_selectedDateRange.from) return {}
  const sectorIds=_deptSectors.map(s=>s.id)

  /* Weekday of the display date (local time) */
  const [y,mo,d]=_selectedDate.split('-').map(Number)
  const targetWeekday=new Date(y,mo-1,d).getDay()

  const aggregate=(rows, weekdayFilter)=>{
    const groups={}
    for(const row of rows){
      if(weekdayFilter!=null){
        const [ry,rm,rd]=row.date.split('-').map(Number)
        if(new Date(ry,rm-1,rd).getDay()!==weekdayFilter) continue
      }
      const sid=row.sector_id
      if(!groups[sid]) groups[sid]={}
      if(!groups[sid][row.hour]) groups[sid][row.hour]={tme:[],tma:[],csat:[]}
      if(row.tme!=null) groups[sid][row.hour].tme.push(row.tme)
      if(row.tma!=null) groups[sid][row.hour].tma.push(row.tma)
      if(row.csat!=null) groups[sid][row.hour].csat.push(row.csat)
    }
    const avg=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0
    const result={}
    for(const [sid,hours] of Object.entries(groups)){
      result[sid]={tme:Array(12).fill(0),tma:Array(12).fill(0),csat:Array(12).fill(0)}
      for(let h=8;h<=19;h++){
        const g=hours[h]; if(!g) continue
        const i=h-8
        result[sid].tme[i]=Math.round(avg(g.tme))
        result[sid].tma[i]=Math.round(avg(g.tma))
        result[sid].csat[i]=+avg(g.csat).toFixed(2)
      }
    }
    return result
  }

  /* Try the selected period first, filtered to target weekday */
  const {data,error}=await supabase.from('sector_metrics')
    .select('sector_id,date,hour,tme,tma,csat')
    .in('sector_id',sectorIds)
    .gte('date',_selectedDateRange.from)
    .lte('date',_selectedDateRange.to)
    .gte('hour',8).lte('hour',19)

  if(!error&&data?.length){
    const result=aggregate(data, targetWeekday)
    /* If weekday filter left something, return it */
    if(Object.keys(result).length) return result
  }

  /* Fallback: latest available date, no weekday filter */
  const {data:latest}=await supabase.from('sector_metrics')
    .select('date').in('sector_id',sectorIds)
    .order('date',{ascending:false}).limit(1).single()
  if(!latest?.date) return {}

  const {data:fbData,error:fbError}=await supabase.from('sector_metrics')
    .select('sector_id,date,hour,tme,tma,csat')
    .in('sector_id',sectorIds)
    .eq('date',latest.date)
    .gte('hour',8).lte('hour',19)
  if(fbError||!fbData?.length) return {}

  showMetricsWarn(latest.date)
  return aggregate(fbData, null)  // no weekday filter on fallback
}

/* Average the per-sector metrics objects for a list of sector IDs into one combined object. */
function mergeMetrics(allMetrics, sectorIds) {
  const merged={tme:Array(12).fill(0),tma:Array(12).fill(0),csat:Array(12).fill(0)}
  let count=0
  for(const sid of sectorIds){
    const m=allMetrics[sid]; if(!m) continue
    count++
    for(let i=0;i<12;i++){merged.tme[i]+=m.tme[i];merged.tma[i]+=m.tma[i];merged.csat[i]+=m.csat[i]}
  }
  if(!count) return null
  if(count>1) for(let i=0;i<12;i++){
    merged.tme[i]=Math.round(merged.tme[i]/count)
    merged.tma[i]=Math.round(merged.tma[i]/count)
    merged.csat[i]=+(merged.csat[i]/count).toFixed(2)
  }
  return merged
}

function attachMetricOverlay(containerEl, metrics, totalH, overlayId) {
  const rowH=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--esc-row-h'))||38
  const maxH=totalH-rowH*0.02
  const tmeMax=Math.max(...metrics.tme,1), tmaMax=Math.max(...metrics.tma,1)
  const cfg={
    tme: {data:metrics.tme, pxPerUnit:maxH/tmeMax,   rgb:'59,130,246',  label:'TME',  fmt:v=>fmtSec(v)},
    tma: {data:metrics.tma, pxPerUnit:maxH/tmaMax,   rgb:'139,92,246',  label:'TMA',  fmt:v=>fmtSec(v)},
    csat:{data:metrics.csat,pxPerUnit:totalH,          rgb:'245,158,11', label:'CSAT', fmt:v=>Math.round(v*100)+'pp'},
  }
  const overlay=document.createElement('div')
  if(overlayId) overlay.id=overlayId
  overlay.className= overlayId==='esc-metric-overlay' ? 'esc-metric-overlay' : 'esc-sector-metric-overlay'
  overlay.style.pointerEvents='auto'
  containerEl.appendChild(overlay)
  _activeMetrics.forEach(m=>{const c=cfg[m]; if(c) overlay.appendChild(buildMetricSvg(c.data,c.pxPerUnit,totalH,c.rgb,overlayId?`${overlayId}-${m}`:m))})
  overlay.addEventListener('mousemove',e=>{
    const xPct=(e.clientX-overlay.getBoundingClientRect().left)/overlay.getBoundingClientRect().width
    const hourIdx=Math.min(Math.floor(xPct*12),11)
    const rows=[..._activeMetrics].map(m=>{const c=cfg[m]; if(!c) return null; const val=c.data[hourIdx]; if(!val) return null; return{m,label:c.label,val,fmt:c.fmt}}).filter(Boolean)
    if(!rows.length){hideMetricTooltip();return}
    showMetricTooltip(e.clientX,e.clientY,minToTime(GRID_START+hourIdx*60),rows)
  })
  overlay.addEventListener('mouseleave',hideMetricTooltip)
}

async function renderSectorMetricOverlays() {
  if(_viewMode!=='analysis'||!_activeMetrics.size) return

  const allMetrics=await loadAllSectorMetrics()
  if(_viewMode!=='analysis'||!_activeMetrics.size) return

  const rowH=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--esc-row-h'))||38

  /* The DOM groups by sector_group (data-sector-id stores the sector_group id).
     Merge all sector_metrics within each group into one combined overlay. */
  for(const group of _sectorGroups){
    const rowsEl=document.querySelector(`.esc-sector-rows[data-sector-id="${group.id}"]`)
    if(!rowsEl) continue
    const emps=_employees.filter(e=>e.sector_group_id===group.id)
    if(!emps.length) continue

    const groupSectorIds=[...new Set(emps.map(e=>e.sector_id).filter(Boolean))]
    const metrics=mergeMetrics(allMetrics, groupSectorIds)
    if(!metrics) continue

    attachMetricOverlay(rowsEl, metrics, emps.length*rowH, group.id)
  }
}

async function renderMetricOverlay() {
  $e('esc-metric-overlay')?.remove()
  document.querySelectorAll('.esc-sector-metric-overlay').forEach(el=>el.remove())
  hideMetricTooltip(); hideMetricsWarn()
  if(_viewMode!=='analysis'||!_activeMetrics.size||!$e('esc-emp-rows')) return

  /* Per-sector overlays for global mode */
  if(can(_user, P.GLOBAL_VIEW_DEPT) && _deptSectors.length > 1) {
    await renderSectorMetricOverlays()
    return
  }

  /* Single overlay (supervisor mode — one sector_group, no esc-sector-rows wrappers in DOM) */
  const allMetrics=await loadAllSectorMetrics()
  if(_viewMode!=='analysis'||!_activeMetrics.size) return
  const sectorIds=_deptSectors.map(s=>s.id)
  const metricsData=mergeMetrics(allMetrics, sectorIds)
  if(!metricsData) return
  const empRowsEl=$e('esc-emp-rows'); if(!empRowsEl) return
  const rowH=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--esc-row-h'))||38
  attachMetricOverlay(empRowsEl, metricsData, _employees.length*rowH, 'esc-metric-overlay')
}

const fmtSec=s=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.round(s%60);return`${h}h ${String(m).padStart(2,'0')}m ${String(sec).padStart(2,'0')}s`}

function showMetricTooltip(cx,cy,time,rows){
  let tip=$e('esc-metric-tip')
  if(!tip){tip=document.createElement('div');tip.id='esc-metric-tip';tip.className='esc-metric-tip';document.body.appendChild(tip)}
  tip.innerHTML=`<div class="esc-mt-time">${time}</div>${rows.map(r=>`<div class="esc-mt-row"><span class="esc-mt-label esc-mt-${r.m}">${r.label}</span><span class="esc-mt-value">${r.fmt(r.val)}</span></div>`).join('')}`
  const tw=tip.offsetWidth||190,th=tip.offsetHeight||68
  let left=cx+14,top=cy-Math.round(th/2)
  if(left+tw>window.innerWidth-8) left=cx-tw-10
  if(top<8) top=8; if(top+th>window.innerHeight-8) top=window.innerHeight-th-8
  tip.style.left=left+'px'; tip.style.top=top+'px'; tip.classList.add('visible')
}
function hideMetricTooltip(){$e('esc-metric-tip')?.classList.remove('visible')}
function showMetricsWarn(d){const[y,m,day]=d.split('-');const el=$e('esc-metrics-warn');if(el){el.textContent=`Métricas de ${day}/${m}/${y}`;el.classList.add('visible')}}
function hideMetricsWarn(){$e('esc-metrics-warn')?.classList.remove('visible')}

// ─── Employee row ─────────────────────────────────────────────────────────────
function buildEmpRow(emp) {
  const shift   = _shifts[emp.id]
  const isGhost = !emp.name  // no name = employee from another team in the sector group
  const canEdit = !isGhost && can(_user, P.SHIFTS_EDIT) && (can(_user, P.GLOBAL_VIEW_DEPT) || (_user?.supervisedTeamIds ?? []).includes(emp.team_id))
  let gridContent=''
  if(shift){
    const barLeft  = minToPct(shift.start_min)
    const barWidth = durToPct(shift.end_min - shift.start_min)
    const dur      = shift.end_min - shift.start_min
    const rp = (t) => ((t - shift.start_min) / dur * 100).toFixed(4)  // relative left%
    const rd = (d) => (d / dur * 100).toFixed(4)                       // relative width%
    const breakEnd = shift.break_start_min + shift.break_duration_minutes
    const sb1 = shift.small_break_1_min
    const sb2 = shift.small_break_2_min
    const unvalidated = shift.validated === false

    /* Break indicator (main) */
    const brkL = rp(shift.break_start_min), brkW = rd(shift.break_duration_minutes)

    /* Pre-break shadow: 30 min before break_start */
    const shadowL = rp(shift.break_start_min - 30), shadowW = rd(30)

    /* Segment + small-break markup (only when SBs are available) */
    const sbMarkup = (sb1 !== null && sb2 !== null) ? `
        <span class="esc-seg-label" style="left:0;width:${rp(sb1)}%">${durLabel(sb1 - shift.start_min)}</span>
        <div class="esc-break-ind esc-small-break" ${canEdit?'data-drag="sb1"':''} data-eid="${emp.id}"
             style="left:${rp(sb1)}%;width:${rd(15)}%">
          <span class="esc-break-label sm-break">${minToTime(sb1)}</span>
        </div>
        <span class="esc-seg-label" style="left:${rp(sb1+15)}%;width:${rp(shift.break_start_min) - rp(sb1+15)}%">${durLabel(shift.break_start_min-(sb1+15))}</span>
        <div class="esc-pre-break-shadow" style="left:${shadowL}%;width:${shadowW}%"></div>
        <div class="esc-break-ind" ${canEdit?'data-drag="break"':''} data-eid="${emp.id}"
             style="left:${brkL}%;width:${brkW}%">
          <span class="esc-break-label">${minToTime(shift.break_start_min)}</span>
        </div>
        <span class="esc-seg-label" style="left:${rp(breakEnd)}%;width:${rp(sb2) - rp(breakEnd)}%">${durLabel(sb2-breakEnd)}</span>
        <div class="esc-break-ind esc-small-break" ${canEdit?'data-drag="sb2"':''} data-eid="${emp.id}"
             style="left:${rp(sb2)}%;width:${rd(15)}%">
          <span class="esc-break-label sm-break">${minToTime(sb2)}</span>
        </div>
        <span class="esc-seg-label" style="left:${rp(sb2+15)}%;right:0">${durLabel(shift.end_min-(sb2+15))}</span>` : `
        <span class="esc-seg-label" style="left:0;width:${brkL}%">${durLabel(shift.break_start_min-shift.start_min)}</span>
        <div class="esc-pre-break-shadow" style="left:${shadowL}%;width:${shadowW}%"></div>
        <div class="esc-break-ind" ${canEdit?'data-drag="break"':''} data-eid="${emp.id}"
             style="left:${brkL}%;width:${brkW}%">
          <span class="esc-break-label">${minToTime(shift.break_start_min)}</span>
        </div>
        <span class="esc-seg-label" style="left:${parseFloat(brkL)+parseFloat(brkW)}%;right:0">${durLabel(shift.end_min-breakEnd)}</span>`

    gridContent=`
      ${unvalidated ? `<div class="esc-unvalidated-tooltip">Este horário pode estar incorreto</div>` : ''}
      <div class="esc-shift-bar ${canEdit?'esc-can-edit':'esc-read-only'}${unvalidated?' esc-shift-bar--unvalidated':''}"
           data-drag="${canEdit?'bar':''}" data-eid="${emp.id}"
           style="left:${barLeft}%;width:${barWidth}%">
        <span class="esc-sh-time esc-start-time">${minToTime(shift.start_min)}</span>
        ${sbMarkup}
        <span class="esc-sh-time esc-end-time">${minToTime(shift.end_min)}</span>
        ${canEdit?`<div class="esc-resize-handle" data-drag="resize" data-eid="${emp.id}"></div>`:''}
      </div>`
  } else {
    gridContent=`<div class="esc-no-shift">Sem escala para esta data</div>`
  }
  return `
    <div class="esc-srow esc-emp-row${isGhost?' esc-emp-row--ghost':''}" data-eid="${emp.id}">
      <div class="esc-name-cell${canEdit?' esc-my-team':''}">
        ${isGhost
          ? `<span class="esc-emp-name esc-emp-name--ghost" title="Colaborador de outra equipe">— outra equipe —</span>`
          : `<span class="esc-emp-name" title="${emp.name}">${emp.name}</span>
            ${canEdit ? `
            <div class="esc-row-actions">
              <button class="esc-row-btn esc-row-save" data-eid="${emp.id}" title="Salvar">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
              <button class="esc-row-btn esc-row-discard" data-eid="${emp.id}" title="Descartar">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </button>
            </div>` : ''}`
        }
      </div>
      <div class="esc-grid-cell esc-emp-grid" data-eid="${emp.id}" style="height:var(--esc-row-h)">
        ${buildGridLines()}${gridContent}
      </div>
    </div>`
}

// ─── Drag ─────────────────────────────────────────────────────────────────────
const clientX = e => e.touches ? e.touches[0].clientX : e.clientX

function onDown(e) {
  if(_viewMode!=='edit') return
  const el=e.target.closest('[data-drag]'); if(!el||!el.dataset.drag) return
  e.preventDefault()
  const type=el.dataset.drag, eid=el.dataset.eid??el.closest('[data-eid]')?.dataset.eid
  if(!eid||!type) return
  const s=_shifts[eid]; if(!s) return
  const gridEl=el.closest('.esc-emp-grid')||document.querySelector('.esc-emp-grid')
  _drag={type,eid,startX:clientX(e),origStart:s.start_min,origEnd:s.end_min,
         origBreak:s.break_start_min,origSb1:s.small_break_1_min,origSb2:s.small_break_2_min,
         origDur:s.end_min-s.start_min,
         gridPx:gridEl?gridEl.clientWidth:gridPxNow(),gridEl,ghostEl:null,ghostSb1El:null,ghostSb2El:null,moved:false}
  document.querySelector(`.esc-shift-bar[data-eid="${eid}"]`)?.classList.add('esc-dragging')
}

function onMove(e) { if(!_drag) return; if(e.cancelable) e.preventDefault(); applyDrag(clientX(e)) }

function onUp() {
  if(!_drag) return
  hideResizeTip()
  const bar=document.querySelector(`.esc-shift-bar[data-eid="${_drag.eid}"]`)
  bar?.classList.remove('esc-dragging')
  if(_drag.moved){
    const s=_shifts[_drag.eid],orig=_origShifts[_drag.eid]
    // When SBs are explicitly dragged, update their natural positions
    if(_drag.type==='sb1'||_drag.type==='sb2')
      _sbNatural[_drag.eid]={ sb1: s.small_break_1_min, sb2: s.small_break_2_min }
    if(_drag.type==='break')
      _breakNatural[_drag.eid]=s.break_start_min
    const back=s&&orig&&s.start_min===orig.start_min&&s.end_min===orig.end_min&&s.break_start_min===orig.break_start_min&&s.small_break_1_min===orig.small_break_1_min&&s.small_break_2_min===orig.small_break_2_min
    if(back){_dirty.delete(_drag.eid);markRowClean(_drag.eid);if(_dirty.size===0)hideSaveBar()}
    else{bar?.classList.add('esc-dirty-bar');_dirty.add(_drag.eid);markRowDirty(_drag.eid);showSaveBar()}
  }
  _drag=null
}

function applyDrag(cx) {
  const s=_shifts[_drag.eid]; if(!s) return
  const dMin=(cx-_drag.startX)/_drag.gridPx*GRID_DUR
  const breakEnd = () => s.break_start_min + s.break_duration_minutes

  if(_drag.type==='bar'){
    const ns=snapMin(clamp(_drag.origStart+dMin,GRID_START,GRID_END-_drag.origDur))
    s.start_min=ns; s.end_min=ns+_drag.origDur
    s.break_start_min=clamp(ns+(_drag.origBreak-_drag.origStart),ns,ns+_drag.origDur-s.break_duration_minutes)
    if(s.small_break_1_min!==null)
      s.small_break_1_min=clamp(snapMin(ns+(_drag.origSb1-_drag.origStart)),ns,s.break_start_min-45)
    if(s.small_break_2_min!==null)
      s.small_break_2_min=clamp(snapMin(ns+(_drag.origSb2-_drag.origStart)),breakEnd()+30,s.end_min-75)
  } else if(_drag.type==='break'){
    // Hard bounds: break cannot move so far that SBs would exceed their absolute limits
    const brkLo = s.small_break_1_min!==null ? s.start_min+45                              : s.start_min
    const brkHi = s.small_break_2_min!==null ? s.end_min-s.break_duration_minutes-105      : s.end_min-s.break_duration_minutes
    s.break_start_min=snapMin(clamp(_drag.origBreak+dMin,brkLo,brkHi))
    // Spring back to natural positions (survive across multiple drop-and-redrag cycles)
    const nat=_sbNatural[_drag.eid]??{sb1:_drag.origSb1,sb2:_drag.origSb2}
    if(s.small_break_1_min!==null)
      s.small_break_1_min=clamp(nat.sb1,s.start_min,s.break_start_min-45)
    if(s.small_break_2_min!==null)
      s.small_break_2_min=clamp(nat.sb2,breakEnd()+30,s.end_min-75)
  } else if(_drag.type==='sb1'){
    s.small_break_1_min=snapMin(clamp(_drag.origSb1+dMin,s.start_min,s.break_start_min-45))
  } else if(_drag.type==='sb2'){
    s.small_break_2_min=snapMin(clamp(_drag.origSb2+dMin,breakEnd()+30,s.end_min-75))
  } else if(_drag.type==='resize'){
    const MIN_DUR=390, MAX_DUR=540
    s.end_min=clamp(Math.round(_drag.origEnd+dMin), s.start_min+MIN_DUR, Math.min(s.start_min+MAX_DUR,GRID_END))
    const nat=_sbNatural[_drag.eid]??{sb1:_drag.origSb1,sb2:_drag.origSb2}
    const brkNat=_breakNatural[_drag.eid]??_drag.origBreak
    // Clamp break FIRST: ceiling ensures SB2 always has room (break_end+30+15+60 ≤ end_min)
    const brkCeil=s.small_break_2_min!==null
      ? s.end_min-s.break_duration_minutes-105
      : s.end_min-s.break_duration_minutes
    s.break_start_min=clamp(brkNat, s.start_min, brkCeil)
    // Now clamp SB2 against the already-updated breakEnd
    if(s.small_break_2_min!==null)
      s.small_break_2_min=clamp(nat.sb2, breakEnd()+30, s.end_min-75)
    // Clamp SB1 against the updated break
    if(s.small_break_1_min!==null)
      s.small_break_1_min=clamp(nat.sb1, s.start_min, s.break_start_min-45)
    showResizeTip(s.end_min-s.start_min)
  }

  const moved=_drag.type==='bar'?s.start_min!==_drag.origStart
    :_drag.type==='break'?s.break_start_min!==_drag.origBreak
    :_drag.type==='sb1'?s.small_break_1_min!==_drag.origSb1
    :_drag.type==='sb2'?s.small_break_2_min!==_drag.origSb2
    :s.end_min!==_drag.origEnd
  if(moved&&!_drag.moved){_drag.moved=true;_drag.ghostEl=_drag.gridEl?createGhost(_drag.type,_drag.eid,_drag.gridEl):null}
  patchShiftBar(_drag.eid); refreshAvailRow()
  if(_drag.ghostEl) updateGhostGradient(_drag.ghostEl,_drag.type,_drag.eid)

  // Show push ghosts for small breaks when the main break crowds them
  if(_drag.type==='break' && _drag.moved && _drag.gridEl) {
    const SB_C='74,222,128'
    const sbGrad=(delta)=>Math.abs(delta)<8?'':delta>0
      ?`linear-gradient(to right,rgba(${SB_C},.28),transparent)`
      :`linear-gradient(to right,transparent,rgba(${SB_C},.28))`
    const nat=_sbNatural[_drag.eid]??{sb1:_drag.origSb1,sb2:_drag.origSb2}
    if(s.small_break_1_min!==null&&nat.sb1!==null){
      if(!_drag.ghostSb1El){
        const g=document.createElement('div')
        g.className='esc-drag-ghost esc-ghost-sb'; g.dataset.ghostEid=_drag.eid; g.dataset.ghostType='sb1-push'
        g.style.left=minToPct(nat.sb1)+'%'; g.style.width=durToPct(15)+'%'
        _drag.gridEl.appendChild(g); _drag.ghostSb1El=g
      }
      _drag.ghostSb1El.style.background=sbGrad(s.small_break_1_min-nat.sb1)
    }
    if(s.small_break_2_min!==null&&nat.sb2!==null){
      if(!_drag.ghostSb2El){
        const g=document.createElement('div')
        g.className='esc-drag-ghost esc-ghost-sb'; g.dataset.ghostEid=_drag.eid; g.dataset.ghostType='sb2-push'
        g.style.left=minToPct(nat.sb2)+'%'; g.style.width=durToPct(15)+'%'
        _drag.gridEl.appendChild(g); _drag.ghostSb2El=g
      }
      _drag.ghostSb2El.style.background=sbGrad(s.small_break_2_min-nat.sb2)
    }
  }
}

function createGhost(type,eid,gridEl) {
  const ex=gridEl.querySelector(`.esc-drag-ghost[data-ghost-eid="${eid}"][data-ghost-type="${type}"]`)
  if(ex) return ex
  const orig=_origShifts[eid]; if(!orig) return null
  const g=document.createElement('div')
  g.className='esc-drag-ghost'+(type==='break'?' esc-ghost-break':(type==='sb1'||type==='sb2')?' esc-ghost-sb':'')
  g.dataset.ghostEid=eid; g.dataset.ghostType=type
  if(type==='bar'){g.style.left=minToPct(orig.start_min)+'%';g.style.width=durToPct(orig.end_min-orig.start_min)+'%'}
  else if(type==='break'){g.style.left=minToPct(orig.break_start_min)+'%';g.style.width=durToPct(orig.break_duration_minutes)+'%'}
  else if(type==='sb1'){g.style.left=minToPct(orig.small_break_1_min)+'%';g.style.width=durToPct(15)+'%'}
  else if(type==='sb2'){g.style.left=minToPct(orig.small_break_2_min)+'%';g.style.width=durToPct(15)+'%'}
  gridEl.appendChild(g); return g
}

function updateGhostGradient(ghost,type,eid) {
  const orig=_origShifts[eid],cur=_shifts[eid]; if(!orig||!cur){ghost.style.background='';return}
  const origMin=type==='bar'?orig.start_min:type==='break'?orig.break_start_min:type==='sb1'?orig.small_break_1_min:orig.small_break_2_min
  const curMin =type==='bar'?cur.start_min :type==='break'?cur.break_start_min :type==='sb1'?cur.small_break_1_min :cur.small_break_2_min
  const delta=curMin-origMin
  if(Math.abs(delta)<SNAP/2){ghost.style.background='';return}
  const c=type==='bar'?'22,163,74':type==='break'?'245,158,11':'74,222,128'
  ghost.style.background=delta>0?`linear-gradient(to right,rgba(${c},.28),transparent)`:`linear-gradient(to right,transparent,rgba(${c},.28))`
}

function fadeStartTime(bar) {
  requestAnimationFrame(() => {
    if(!bar.isConnected) return
    const st  = bar.querySelector('.esc-start-time')
    const sb1 = bar.querySelector('[data-drag="sb1"]') ?? bar.querySelector('.esc-break-ind.esc-small-break') ?? bar.querySelector('.esc-break-ind')
    if(!st||!sb1) return
    const stR  = st.getBoundingClientRect()
    const sb1R = sb1.getBoundingClientRect()
    st.style.opacity = sb1R.left <= stR.right + 72 ? '0' : '1'
  })
}

function patchShiftBar(eid) {
  const s=_shifts[eid]; if(!s) return
  const bar=document.querySelector(`.esc-shift-bar[data-eid="${eid}"]`); if(!bar) return
  bar.style.left=minToPct(s.start_min)+'%'; bar.style.width=durToPct(s.end_min-s.start_min)+'%'

  const dur=s.end_min-s.start_min
  const rp=(t)=>((t-s.start_min)/dur*100).toFixed(4)
  const rd=(d)=>(d/dur*100).toFixed(4)
  const breakEnd=s.break_start_min+s.break_duration_minutes
  const sb1=s.small_break_1_min, sb2=s.small_break_2_min

  const st=bar.querySelector('.esc-start-time'); if(st) st.textContent=minToTime(s.start_min)
  const en=bar.querySelector('.esc-end-time');   if(en) en.textContent=minToTime(s.end_min)

  /* Main break */
  const brk=bar.querySelector('.esc-break-ind:not(.esc-small-break)')
  if(brk){
    brk.style.left=rp(s.break_start_min)+'%'; brk.style.width=rd(s.break_duration_minutes)+'%'
    const lbl=brk.querySelector('.esc-break-label'); if(lbl) lbl.textContent=minToTime(s.break_start_min)
  }

  /* Pre-break shadow */
  const shadow=bar.querySelector('.esc-pre-break-shadow')
  if(shadow){ shadow.style.left=rp(s.break_start_min-30)+'%'; shadow.style.width=rd(30)+'%' }

  if(sb1!==null&&sb2!==null){
    /* Small break 1 */
    const sb1El=bar.querySelector('.esc-small-break:first-of-type,.esc-small-break[data-drag="sb1"],[data-drag="sb1"]')
    if(sb1El){ sb1El.style.left=rp(sb1)+'%'; sb1El.style.width=rd(15)+'%'; const l=sb1El.querySelector('.esc-break-label'); if(l) l.textContent=minToTime(sb1) }
    /* Small break 2 */
    const sb2El=bar.querySelector('[data-drag="sb2"]')
    if(sb2El){ sb2El.style.left=rp(sb2)+'%'; sb2El.style.width=rd(15)+'%'; const l=sb2El.querySelector('.esc-break-label'); if(l) l.textContent=minToTime(sb2) }
    /* 4 segment labels */
    const segs=[...bar.querySelectorAll('.esc-seg-label')]
    if(segs[0]){ segs[0].style.width=rp(sb1)+'%'; segs[0].textContent=durLabel(sb1-s.start_min) }
    if(segs[1]){ segs[1].style.left=rp(sb1+15)+'%'; segs[1].style.width=(rp(s.break_start_min)-rp(sb1+15))+'%'; segs[1].textContent=durLabel(s.break_start_min-(sb1+15)) }
    if(segs[2]){ segs[2].style.left=rp(breakEnd)+'%'; segs[2].style.width=(rp(sb2)-rp(breakEnd))+'%'; segs[2].textContent=durLabel(sb2-breakEnd) }
    if(segs[3]){ segs[3].style.left=rp(sb2+15)+'%'; segs[3].textContent=durLabel(s.end_min-(sb2+15)) }
  } else {
    /* Fallback 2-segment layout */
    const segs=[...bar.querySelectorAll('.esc-seg-label')]
    const blf=(s.break_start_min-s.start_min)/dur*100, bwf=s.break_duration_minutes/dur*100
    if(segs[0]){ segs[0].style.width=blf.toFixed(4)+'%'; segs[0].textContent=durLabel(s.break_start_min-s.start_min) }
    if(segs[1]){ segs[1].style.left=(blf+bwf).toFixed(4)+'%'; segs[1].textContent=durLabel(s.end_min-breakEnd) }
  }

  // Fade start-time when SB1 (or main break if no SBs) gets close to the left edge
  fadeStartTime(bar)
}

function refreshAvailRow() {
  /* Grand-total row (excludes sector subtotal slots) */
  const allIds = _employees.map(e => e.id)
  document.querySelectorAll('#esc-avail-grid .esc-avail-slot').forEach((el, i) => {
    const sm    = GRID_START + i * SLOT_MIN
    const count = calcAvail(sm), total = _employees.length
    const pre   = calcPreBreakForGroup(sm, allIds)
    const hue   = total ? Math.round(count / total * 140) : 45
    el.classList.toggle('has-prebreak', pre > 0)
    el.innerHTML = slotInner(count, pre)
    el.style.background = `hsl(${hue},48%,78%)`; el.style.color = `hsl(${hue},55%,38%)`
  })

  /* Per-sector subtotal rows */
  _deptSectors.forEach(sector => {
    const emps   = _employees.filter(e => e.sector_id === sector.id)
    const empIds = emps.map(e => e.id)
    document.querySelectorAll(`.esc-sector-avail-slot[data-sector-id="${sector.id}"]`).forEach(el => {
      const slot  = parseInt(el.dataset.slot)
      const sm    = GRID_START + slot * SLOT_MIN
      const count = calcAvailForGroup(sm, empIds)
      const pre   = calcPreBreakForGroup(sm, empIds)
      const total = emps.length
      const hue   = total ? Math.round(count / total * 120) : 45
      el.classList.toggle('has-prebreak', pre > 0)
      el.innerHTML = slotInner(count, pre)
      el.style.background = `hsl(${hue},38%,85%)`
      el.style.color      = `hsl(${hue},50%,30%)`
    })
  })
}

// ─── View mode ────────────────────────────────────────────────────────────────
function setViewMode(m) {
  _viewMode=m
  document.querySelectorAll('.esc-mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===m))
  $e('escalas-root')?.classList.toggle('esc-analysis-mode',m==='analysis')
  EscCalendar.setSingleDay(m==='edit'); renderMetricOverlay()
  if(m==='analysis') hideSaveBar(); else if(_dirty.size>0) showSaveBar()
}

// ─── Save flow ────────────────────────────────────────────────────────────────
function confirmSave() {
  if (_pendingSingleSave) {
    const eid = _pendingSingleSave
    _pendingSingleSave = null
    saveOneEmployee(eid)
  } else {
    saveChanges()
  }
}

function showSaveBar(){$e('esc-save-bar')?.classList.remove('esc-save-hidden')}
function hideSaveBar() {$e('esc-save-bar')?.classList.add('esc-save-hidden')}
function openConfirmModal() {$e('esc-confirm-modal')?.classList.remove('modal-overlay--hidden')}
function closeConfirmModal(){$e('esc-confirm-modal')?.classList.add('modal-overlay--hidden')}
function markRowDirty(eid){document.querySelector(`.esc-emp-row[data-eid="${eid}"]`)?.classList.add('esc-has-changes')}
function markRowClean(eid){
  document.querySelector(`.esc-emp-row[data-eid="${eid}"]`)?.classList.remove('esc-has-changes')
  document.querySelectorAll(`.esc-drag-ghost[data-ghost-eid="${eid}"]`).forEach(g=>g.remove())
  document.querySelector(`.esc-shift-bar[data-eid="${eid}"]`)?.classList.remove('esc-dirty-bar')
}

async function saveOneEmployee(eid) {
  const s = _shifts[eid]; if (!s) return
  closeConfirmModal()
  const setAsDefault = $e('esc-set-default')?.checked ?? false
  const payload = {
    start_time:         minToTime(s.start_min)+':00',
    end_time:           minToTime(s.end_min)+':00',
    break_start:        minToTime(s.break_start_min)+':00',
    small_break_1_start: s.small_break_1_min !== null ? minToTime(s.small_break_1_min)+':00' : null,
    small_break_2_start: s.small_break_2_min !== null ? minToTime(s.small_break_2_min)+':00' : null,
    validated:          true,
    updated_by: _user.id, updated_at: new Date().toISOString(),
  }
  let error
  if (setAsDefault) {
    if (s.default_shift_id) {
      ;({ error } = await supabase.from('shifts').update(payload).eq('id', s.default_shift_id))
    } else {
      const { data: inserted, error: err } = await supabase.from('shifts')
        .insert({ ...payload, employee_id: eid, is_default: true, date: null,
                  break_duration_minutes: s.break_duration_minutes })
        .select('id').single()
      error = err
      if (!error && inserted)
        _shifts[eid] = { ..._shifts[eid], default_shift_id: inserted.id }
    }
    if (!error) delete _defaultShiftCache[eid]  // invalidate so next load re-fetches
  } else {
    if (s.date_shift_id) {
      ;({ error } = await supabase.from('shifts').update(payload).eq('id', s.date_shift_id))
    } else {
      const { data: inserted, error: err } = await supabase.from('shifts')
        .insert({ ...payload, employee_id: eid, date: _selectedDate, is_default: false,
                  break_duration_minutes: s.break_duration_minutes })
        .select('id').single()
      error = err
      if (!error && inserted)
        _shifts[eid] = { ..._shifts[eid], date_shift_id: inserted.id, is_from_default: false }
    }
  }
  if (error) { toast.error('Erro ao salvar', error.message); return }
  _shifts[eid] = { ..._shifts[eid], validated: true }
  _origShifts[eid] = { ..._shifts[eid] }
  _sbNatural[eid]    = { sb1: _shifts[eid].small_break_1_min, sb2: _shifts[eid].small_break_2_min }
  _breakNatural[eid] = _shifts[eid].break_start_min
  _dirty.delete(eid); markRowClean(eid)
  // Remove unvalidated glow/tooltip from DOM immediately
  const bar = document.querySelector(`.esc-shift-bar[data-eid="${eid}"]`)
  bar?.classList.remove('esc-shift-bar--unvalidated')
  bar?.closest('.esc-emp-grid')?.querySelector('.esc-unvalidated-tooltip')?.remove()
  if (_dirty.size === 0) hideSaveBar()
  toast.success('Escala salva!')
}

function discardOneEmployee(eid) {
  const orig=_origShifts[eid]; if(!orig) return
  _shifts[eid]={...orig}; _sbNatural[eid]={ sb1: orig.small_break_1_min, sb2: orig.small_break_2_min }; _breakNatural[eid]=orig.break_start_min
  _dirty.delete(eid); markRowClean(eid)
  patchShiftBar(eid); refreshAvailRow()
  if(_dirty.size===0) hideSaveBar(); toast.success('Alteração descartada.')
}

async function discardChanges(){_dirty.clear();hideSaveBar();await loadData();renderGrid();toast.success('Alterações descartadas.')}

async function saveChanges() {
  closeConfirmModal()
  const setAsDefault = $e('esc-set-default')?.checked ?? false
  const btn = $e('esc-save-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…' }
  try {
    const results = await Promise.all([..._dirty].map(eid => {
      const s = _shifts[eid]
      const payload = {
        start_time:          minToTime(s.start_min)+':00',
        end_time:            minToTime(s.end_min)+':00',
        break_start:         minToTime(s.break_start_min)+':00',
        small_break_1_start: s.small_break_1_min !== null ? minToTime(s.small_break_1_min)+':00' : null,
        small_break_2_start: s.small_break_2_min !== null ? minToTime(s.small_break_2_min)+':00' : null,
        validated:           true,
        updated_by: _user.id, updated_at: new Date().toISOString(),
      }
      if (setAsDefault) {
        /* Update or insert the employee's default shift */
        return s.default_shift_id
          ? supabase.from('shifts').update(payload).eq('id', s.default_shift_id)
          : supabase.from('shifts').insert({ ...payload, employee_id: eid,
              is_default: true, date: null, break_duration_minutes: s.break_duration_minutes })
      } else {
        /* Update or insert a date-specific shift for the selected date */
        return s.date_shift_id
          ? supabase.from('shifts').update(payload).eq('id', s.date_shift_id)
          : supabase.from('shifts').insert({ ...payload, employee_id: eid,
              is_default: false, date: _selectedDate, break_duration_minutes: s.break_duration_minutes })
      }
    }))
    const failed = results.filter(r => r.error)
    if (failed.length) throw new Error(failed[0].error.message)
    /* Invalidate cache for any employees whose default was just written */
    if (setAsDefault) for (const eid of _dirty) delete _defaultShiftCache[eid]
    _dirty.clear(); hideSaveBar()
    /* Reload to sync newly-inserted shift IDs */
    await loadData(); renderGrid()
    toast.success('Escalas salvas com sucesso!')
  } catch (err) {
    toast.error('Erro ao salvar', err.message)
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar Alterações' }
  }
}

function showStatus(msg,isError=false){
  const el=$e('esc-main'); if(!el) return
  el.innerHTML=`<div class="esc-status-state${isError?' esc-error-state':''}">${!isError?'<div class="loading-spinner"></div>':''}${msg}</div>`
}
