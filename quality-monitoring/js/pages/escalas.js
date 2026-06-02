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
const SLOT_MIN   = 30
const NUM_SLOTS  = GRID_DUR / SLOT_MIN
const SNAP       = 30

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
      const ds = toStr(year, month, d)
      let cls  = 'esc-cal-day'
      if (ds === rangeA)                                        cls += ' range-start'
      if (rangeB && ds === rangeB)                              cls += ' range-end'
      if (rangeA && rangeB && cmp(ds,rangeA)>0 && cmp(ds,rangeB)<0) cls += ' in-range'
      if (ds === todayS)                                        cls += ' today'
      h += `<div class="${cls}" data-date="${ds}"><span class="esc-day-num">${d}</span></div>`
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
let _employees    = []
let _shifts       = {}
let _origShifts   = {}
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
  _employees = []; _shifts = {}; _origShifts = {}
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
  _shifts = {}; _origShifts = {}

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
    const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';
    ownEmpsQuery = ownEmpsQuery.in('team_id', teamIds.length ? teamIds : [EMPTY_GUID]);
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
        start_min:             timeToMin(row.start_time),
        end_min:               timeToMin(row.end_time),
        break_start_min:       timeToMin(row.break_start),
        is_from_default:       row.is_default ?? false,
        date_shift_id:         row.is_default ? null : row.shift_id,
        default_shift_id:      row.is_default ? row.shift_id : null,
      }
      _shifts[row.employee_id]     = parsed
      _origShifts[row.employee_id] = { ...parsed }
    }
  }

  if (!_employees.length) { _dirty.clear(); hideSaveBar(); updateStats(); return }
  _dirty.clear(); hideSaveBar(); updateStats()
}

// ─── Availability ─────────────────────────────────────────────────────────────
function calcAvailForGroup(slotMin, empIds) {
  return empIds.reduce((n, id) => {
    const s = _shifts[id]; if (!s) return n
    const inShift = s.start_min <= slotMin && s.end_min > slotMin
    const onBreak  = s.break_start_min <= slotMin && (s.break_start_min + s.break_duration_minutes) > slotMin
    return n + (inShift && !onBreak ? 1 : 0)
  }, 0)
}

function calcAvail(slotMin) {
  return calcAvailForGroup(slotMin, _employees.map(e => e.id))
}

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
    const total = emps.length
    const hue = total ? Math.round(count / total * 120) : 45
    cells.push(`<div class="esc-avail-slot esc-sector-avail-slot"
      data-sector-id="${sector.id}" data-slot="${i}"
      style="left:${slotPct(i)}%;width:${slotPct(1)}%;background:hsl(${hue},38%,85%);color:hsl(${hue},50%,30%)">${count}</div>`)
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
  for(let i=0;i<=NUM_SLOTS;i++) h+=`<div class="esc-grid-line ${i%2===0?'major':'minor'}" style="left:${slotPct(i)}%"></div>`
  return `<div class="esc-grid-bg">${h}</div>`
}

function renderGrid() {
  const hourSlots=Array.from({length:NUM_SLOTS+1},(_,i)=>i).filter(i=>i%2===0)
  const timeLabels=hourSlots
    .filter((_,idx)=>idx!==0&&idx!==hourSlots.length-1)
    .map(i=>`<div class="esc-th-slot" style="left:${slotPct(i)}%">${minToTime(GRID_START+i*SLOT_MIN)}</div>`)
  const availCells=[]
  for(let i=0;i<NUM_SLOTS;i++){
    const sm=GRID_START+i*SLOT_MIN, count=calcAvail(sm)
    const total=_employees.length, hue=total?Math.round(count/total*120):45
    availCells.push(`<div class="esc-avail-slot" data-slot="${i}"
      style="left:${slotPct(i)}%;width:${slotPct(1)}%;background:hsl(${hue},38%,88%);color:hsl(${hue},45%,28%)">${count}</div>`)
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

async function loadMetrics() {
  const empty={tme:Array(12).fill(0),tma:Array(12).fill(0),csat:Array(12).fill(0),fallbackDate:null}
  if(!_sectorId||!_selectedDateRange.from) return empty
  const {data,error}=await supabase.from('sector_metrics').select('hour,tme,tma,csat')
    .eq('sector_id',_sectorId).gte('date',_selectedDateRange.from).lte('date',_selectedDateRange.to)
    .gte('hour',8).lte('hour',19)
  if(!error&&data?.length) return{...aggregateHourlyMetrics(data),fallbackDate:null}
  const {data:latest}=await supabase.from('sector_metrics').select('date')
    .eq('sector_id',_sectorId).order('date',{ascending:false}).limit(1).single()
  if(!latest?.date) return empty
  const {data:fbData,error:fbError}=await supabase.from('sector_metrics').select('hour,tme,tma,csat')
    .eq('sector_id',_sectorId).eq('date',latest.date).gte('hour',8).lte('hour',19)
  if(fbError||!fbData?.length) return empty
  return{...aggregateHourlyMetrics(fbData),fallbackDate:latest.date}
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

async function renderSectorMetricOverlays() {
  if(_viewMode!=='analysis'||!_activeMetrics.size) return

  const allMetrics=await loadAllSectorMetrics()
  if(_viewMode!=='analysis'||!_activeMetrics.size) return

  const rowH=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--esc-row-h'))||38
  const metricCfg={
    tme: {rgb:'59,130,246',  label:'TME',  fmt:v=>fmtSec(v)},
    tma: {rgb:'139,92,246',  label:'TMA',  fmt:v=>fmtSec(v)},
    csat:{rgb:'245,158,11',  label:'CSAT', fmt:v=>Math.round(v*100)+'pp'},
  }

  for(const sector of _deptSectors){
    const rowsEl=document.querySelector(`.esc-sector-rows[data-sector-id="${sector.id}"]`)
    if(!rowsEl) continue
    const emps=_employees.filter(e=>e.sector_id===sector.id)
    if(!emps.length) continue

    const metrics=allMetrics[sector.id]
    if(!metrics) continue

    const totalH=emps.length*rowH

    /* Per-metric scale: largest value in each metric → 90% of sector height */
    const cfg={}
    _activeMetrics.forEach(m=>{
      const c=metricCfg[m]; if(!c) return
      const maxVal=Math.max(...metrics[m],0.001)
      cfg[m]={...c, data:metrics[m], pxPerUnit:(totalH*0.9)/maxVal}
    })
    if(!Object.keys(cfg).length) continue

    const overlay=document.createElement('div')
    overlay.className='esc-sector-metric-overlay'
    overlay.style.pointerEvents='auto'
    rowsEl.appendChild(overlay)

    Object.entries(cfg).forEach(([m,c])=>
      overlay.appendChild(buildMetricSvg(c.data,c.pxPerUnit,totalH,c.rgb,`${sector.id}-${m}`))
    )

    overlay.addEventListener('mousemove',e=>{
      const xPct=(e.clientX-overlay.getBoundingClientRect().left)/overlay.getBoundingClientRect().width
      const hourIdx=Math.min(Math.floor(xPct*12),11)
      const rows=Object.entries(cfg).map(([m,c])=>{
        const val=c.data[hourIdx]; if(!val) return null
        return{m,label:c.label,val,fmt:c.fmt}
      }).filter(Boolean)
      if(!rows.length){hideMetricTooltip();return}
      showMetricTooltip(e.clientX,e.clientY,minToTime(GRID_START+hourIdx*60),rows)
    })
    overlay.addEventListener('mouseleave',hideMetricTooltip)
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

  /* Single-sector overlay (supervisor mode) */
  const metricsData=await loadMetrics()
  if(_viewMode!=='analysis'||!_activeMetrics.size) return
  if(metricsData.fallbackDate) showMetricsWarn(metricsData.fallbackDate)
  const empRowsEl=$e('esc-emp-rows'); if(!empRowsEl) return
  const rowH=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--esc-row-h'))||38
  const totalH=_employees.length*rowH, maxH=totalH-rowH*0.02
  const tmeMax=Math.max(...metricsData.tme,1), tmaMax=Math.max(...metricsData.tma,1)
  const overlay=document.createElement('div')
  overlay.id='esc-metric-overlay'; overlay.className='esc-metric-overlay'; overlay.style.pointerEvents='auto'
  empRowsEl.appendChild(overlay)
  const cfg={
    tme: {data:metricsData.tme, pxPerUnit:maxH/tmeMax,  rgb:'59,130,246',  label:'TME',  fmt:v=>fmtSec(v)},
    tma: {data:metricsData.tma, pxPerUnit:maxH/tmaMax,  rgb:'139,92,246',  label:'TMA',  fmt:v=>fmtSec(v)},
    csat:{data:metricsData.csat,pxPerUnit:totalH,         rgb:'245,158,11', label:'CSAT', fmt:v=>Math.round(v*100)+'pp'},
  }
  _activeMetrics.forEach(m=>{const c=cfg[m]; if(c) overlay.appendChild(buildMetricSvg(c.data,c.pxPerUnit,totalH,c.rgb,m))})
  overlay.addEventListener('mousemove',e=>{
    const xPct=(e.clientX-overlay.getBoundingClientRect().left)/overlay.getBoundingClientRect().width
    const hourIdx=Math.min(Math.floor(xPct*12),11)
    const rows=[..._activeMetrics].map(m=>{
      const c=cfg[m]; if(!c) return null
      const val=c.data[hourIdx]; if(!val) return null
      return{m,label:c.label,val,fmt:c.fmt}
    }).filter(Boolean)
    if(!rows.length){hideMetricTooltip();return}
    showMetricTooltip(e.clientX,e.clientY,minToTime(GRID_START+hourIdx*60),rows)
  })
  overlay.addEventListener('mouseleave',hideMetricTooltip)
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
    const barLeft=minToPct(shift.start_min),barWidth=durToPct(shift.end_min-shift.start_min)
    const shiftDur=shift.end_min-shift.start_min
    const brkLeft=(((shift.break_start_min-shift.start_min)/shiftDur)*100).toFixed(4)
    const brkWidth=((shift.break_duration_minutes/shiftDur)*100).toFixed(4)
    const brkLeftF=parseFloat(brkLeft),brkWidthF=parseFloat(brkWidth)
    const unvalidated = shift.validated === false
    gridContent=`
      ${unvalidated ? `<div class="esc-unvalidated-tooltip">Este horário pode estar incorreto</div>` : ''}
      <div class="esc-shift-bar ${canEdit?'esc-can-edit':'esc-read-only'}${unvalidated?' esc-shift-bar--unvalidated':''}"
           data-drag="${canEdit?'bar':''}" data-eid="${emp.id}"
           style="left:${barLeft}%;width:${barWidth}%">
        <span class="esc-sh-time esc-start-time">${minToTime(shift.start_min)}</span>
        <span class="esc-seg-label esc-seg-before" style="left:0;width:${brkLeft}%">${durLabel(shift.break_start_min-shift.start_min)}</span>
        <div class="esc-break-ind" ${canEdit?'data-drag="break"':''} data-eid="${emp.id}"
             style="left:${brkLeft}%;width:${brkWidth}%">
          <span class="esc-break-label">${minToTime(shift.break_start_min)}</span>
        </div>
        <span class="esc-seg-label esc-seg-after" style="left:${brkLeftF+brkWidthF}%;right:0">${durLabel(shift.end_min-(shift.break_start_min+shift.break_duration_minutes))}</span>
        <span class="esc-sh-time esc-end-time">${minToTime(shift.end_min)}</span>
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
         origBreak:s.break_start_min,origDur:s.end_min-s.start_min,
         gridPx:gridEl?gridEl.clientWidth:gridPxNow(),gridEl,ghostEl:null,moved:false}
  document.querySelector(`.esc-shift-bar[data-eid="${eid}"]`)?.classList.add('esc-dragging')
}

function onMove(e) { if(!_drag) return; if(e.cancelable) e.preventDefault(); applyDrag(clientX(e)) }

function onUp() {
  if(!_drag) return
  const bar=document.querySelector(`.esc-shift-bar[data-eid="${_drag.eid}"]`)
  bar?.classList.remove('esc-dragging')
  if(_drag.moved){
    const s=_shifts[_drag.eid],orig=_origShifts[_drag.eid]
    const back=s&&orig&&s.start_min===orig.start_min&&s.end_min===orig.end_min&&s.break_start_min===orig.break_start_min
    if(back){_dirty.delete(_drag.eid);markRowClean(_drag.eid);if(_dirty.size===0)hideSaveBar()}
    else{bar?.classList.add('esc-dirty-bar');_dirty.add(_drag.eid);markRowDirty(_drag.eid);showSaveBar()}
  }
  _drag=null
}

function applyDrag(cx) {
  const s=_shifts[_drag.eid]; if(!s) return
  const dMin=(cx-_drag.startX)/_drag.gridPx*GRID_DUR
  if(_drag.type==='bar'){
    const ns=snapMin(clamp(_drag.origStart+dMin,GRID_START,GRID_END-_drag.origDur))
    s.start_min=ns; s.end_min=ns+_drag.origDur
    s.break_start_min=clamp(ns+(_drag.origBreak-_drag.origStart),ns,ns+_drag.origDur-s.break_duration_minutes)
  } else {
    s.break_start_min=snapMin(clamp(_drag.origBreak+dMin,s.start_min,s.end_min-s.break_duration_minutes))
  }
  const moved=_drag.type==='bar'?s.start_min!==_drag.origStart:s.break_start_min!==_drag.origBreak
  if(moved&&!_drag.moved){_drag.moved=true;_drag.ghostEl=_drag.gridEl?createGhost(_drag.type,_drag.eid,_drag.gridEl):null}
  patchShiftBar(_drag.eid); refreshAvailRow()
  if(_drag.ghostEl) updateGhostGradient(_drag.ghostEl,_drag.type,_drag.eid)
}

function createGhost(type,eid,gridEl) {
  const ex=gridEl.querySelector(`.esc-drag-ghost[data-ghost-eid="${eid}"][data-ghost-type="${type}"]`)
  if(ex) return ex
  const orig=_origShifts[eid]; if(!orig) return null
  const g=document.createElement('div')
  g.className='esc-drag-ghost'+(type==='break'?' esc-ghost-break':'')
  g.dataset.ghostEid=eid; g.dataset.ghostType=type
  if(type==='bar'){g.style.left=minToPct(orig.start_min)+'%';g.style.width=durToPct(orig.end_min-orig.start_min)+'%'}
  else{g.style.left=minToPct(orig.break_start_min)+'%';g.style.width=durToPct(orig.break_duration_minutes)+'%'}
  gridEl.appendChild(g); return g
}

function updateGhostGradient(ghost,type,eid) {
  const orig=_origShifts[eid],cur=_shifts[eid]; if(!orig||!cur){ghost.style.background='';return}
  const origMin=type==='bar'?orig.start_min:orig.break_start_min
  const curMin =type==='bar'?cur.start_min :cur.break_start_min
  const delta=curMin-origMin
  if(Math.abs(delta)<SNAP/2){ghost.style.background='';return}
  const c=type==='bar'?'22,163,74':'245,158,11'
  ghost.style.background=delta>0?`linear-gradient(to right,rgba(${c},.28),transparent)`:`linear-gradient(to right,transparent,rgba(${c},.28))`
}

function patchShiftBar(eid) {
  const s=_shifts[eid]; if(!s) return
  const bar=document.querySelector(`.esc-shift-bar[data-eid="${eid}"]`); if(!bar) return
  bar.style.left=minToPct(s.start_min)+'%'; bar.style.width=durToPct(s.end_min-s.start_min)+'%'
  const brk=bar.querySelector('.esc-break-ind')
  if(brk){
    const dur=s.end_min-s.start_min
    const bl=(((s.break_start_min-s.start_min)/dur)*100).toFixed(4)
    const bw=((s.break_duration_minutes/dur)*100).toFixed(4)
    brk.style.left=bl+'%'; brk.style.width=bw+'%'
    const lbl=brk.querySelector('.esc-break-label'); if(lbl) lbl.textContent=minToTime(s.break_start_min)
  }
  const st=bar.querySelector('.esc-start-time'); if(st) st.textContent=minToTime(s.start_min)
  const en=bar.querySelector('.esc-end-time');   if(en) en.textContent=minToTime(s.end_min)
  const s1=bar.querySelector('.esc-seg-before'),s2=bar.querySelector('.esc-seg-after')
  if(brk&&s1&&s2){
    const dur=s.end_min-s.start_min
    const blf=(s.break_start_min-s.start_min)/dur*100
    const bwf=s.break_duration_minutes/dur*100
    s1.style.width=blf.toFixed(4)+'%'; s1.textContent=durLabel(s.break_start_min-s.start_min)
    s2.style.left=(blf+bwf).toFixed(4)+'%'; s2.textContent=durLabel(s.end_min-(s.break_start_min+s.break_duration_minutes))
  }
}

function refreshAvailRow() {
  /* Grand-total row (excludes sector subtotal slots) */
  document.querySelectorAll('#esc-avail-grid .esc-avail-slot').forEach((el, i) => {
    const count = calcAvail(GRID_START + i * SLOT_MIN), total = _employees.length
    const hue = total ? Math.round(count / total * 140) : 45
    el.textContent = count; el.style.background = `hsl(${hue},48%,78%)`; el.style.color = `hsl(${hue},55%,38%)`
  })

  /* Per-sector subtotal rows */
  _deptSectors.forEach(sector => {
    const emps   = _employees.filter(e => e.sector_id === sector.id)
    const empIds = emps.map(e => e.id)
    document.querySelectorAll(`.esc-sector-avail-slot[data-sector-id="${sector.id}"]`).forEach(el => {
      const slot  = parseInt(el.dataset.slot)
      const count = calcAvailForGroup(GRID_START + slot * SLOT_MIN, empIds)
      const total = emps.length
      const hue   = total ? Math.round(count / total * 120) : 45
      el.textContent = count
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
    start_time:  minToTime(s.start_min)+':00',
    end_time:    minToTime(s.end_min)+':00',
    break_start: minToTime(s.break_start_min)+':00',
    validated:   true,
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
  _shifts[eid]={...orig}; _dirty.delete(eid); markRowClean(eid)
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
        start_time:  minToTime(s.start_min)+':00',
        end_time:    minToTime(s.end_min)+':00',
        break_start: minToTime(s.break_start_min)+':00',
        validated:   true,
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
