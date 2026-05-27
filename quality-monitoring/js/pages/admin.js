/* ============================================================
   ADMIN — Gestão de departamentos, equipes e usuários
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { ACCESS_LEVELS, roleClass } from '../utils/access.js';
import { toast } from '../components/toast.js';
import { getInitials } from '../utils/formatters.js';
import { supabase } from '../supabase.js';
import { can, P } from '../utils/permissions.js';

/* ── Module state ─────────────────────────── */
let _activeTab        = 'org';
let _catalogTab       = 'eval_criteria';
let _catalogData      = null;
let _catalogDeptFilter = null;  // null=all, 'global'=no dept, uuid=specific dept
let _editState   = null;   // { table, row } — row=null means new
let _deactState  = null;   // { table, id, name }
let _donutChart  = null;
let _mouseX      = 0;
let _mouseY      = 0;

/* ── Org tab state ────────────────────────── */
let _orgData           = null;   // { department, teams, managers, emailMap, transfers }
let _transferDragState = null;   // { empId, empName, fromTeamId, fromTeamName, toTeamId, toTeamName }
let _transferResolveId = null;   // transfer id being reviewed in resolve modal

/* ── Users tab state ──────────────────────── */
let _unclaimedProfiles = [];  // profiles with no employee record
let _adminSectors      = [];  // all sectors for the absorption modal
let _absorbTarget      = null; // profile id being absorbed

/* ── Level change state ───────────────────── */
let _pendingLevelChanges = {};
// { [profileId]: { newLevel, originalLevel, name, isEmployee } }

/* ── Donut color palette ──────────────────── */
const EC_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
];

/* ── Catalog table config ─────────────────── */
const DEPT_COL = {
  key: 'department_id', label: 'Departamento', type: 'select',
  options:  () => _catalogData?.departments ?? [],
  optLabel: d  => d.name,
};

const CATALOG = {
  eval_criteria: {
    label:   'Critérios de Avaliação',
    columns: [
      { key: 'name',   label: 'Nome',  type: 'text',    required: true },
      DEPT_COL,
      { key: 'active', label: 'Ativo', type: 'boolean', default: true },
    ],
    display:   r => r.name,
    meta:      () => '',
    canAdd:    true,
    canEdit:   true,
    canDelete: true,
  },
  topic: {
    label:   'Tópicos',
    columns: [
      { key: 'item',             label: 'Item',      type: 'text',   required: true },
      { key: 'description',      label: 'Descrição', type: 'text' },
      { key: 'points',           label: 'Pontos',    type: 'number', required: true, min: 1 },
      { key: 'eval_criteria_id', label: 'Critério',  type: 'select', required: true,
        options:  () => _catalogData?.eval_criteria ?? [],
        optLabel: r  => r.name },
      DEPT_COL,
      { key: 'active', label: 'Ativo', type: 'boolean', default: true },
    ],
    display: r => r.item,
    meta:    r => (_catalogData?.eval_criteria.find(c => c.id === r.eval_criteria_id))?.name ?? '',
    canAdd:    true,
    canEdit:   true,
    canDelete: true,
  },
  observation_type: {
    label:   'Tipos de Observação',
    note:    'O campo "Código" é imutável após criação — é referenciado internamente pelo sistema.',
    columns: [
      { key: 'code',         label: 'Código',           type: 'text', required: true, editReadonly: true },
      { key: 'display_name', label: 'Nome de exibição', type: 'text', required: true },
      DEPT_COL,
      { key: 'active',       label: 'Ativo',            type: 'boolean', default: true },
    ],
    display:   r => r.display_name,
    meta:      r => r.code,
    canAdd:    true,
    canEdit:   true,
    canDelete: true,
  },
  error_type: {
    label:   'Tipos de Erro',
    columns: [
      { key: 'name',     label: 'Nome',    type: 'text',    required: true },
      { key: 'critical', label: 'Crítico', type: 'boolean', default: false },
      DEPT_COL,
      { key: 'active',   label: 'Ativo',   type: 'boolean', default: true },
    ],
    display:   r => r.name,
    meta:      () => '',
    canAdd:    true,
    canEdit:   true,
    canDelete: true,
  },
  analytical_note_type: {
    label:   'Critérios Analíticos',
    columns: [
      { key: 'name',   label: 'Nome',  type: 'text',    required: true },
      DEPT_COL,
      { key: 'active', label: 'Ativo', type: 'boolean', default: true },
    ],
    display:   r => r.name,
    meta:      () => '',
    canAdd:    true,
    canEdit:   true,
    canDelete: true,
  },
};

const CATALOG_SUBTAB_LABELS = {
  eval_criteria:        'Critérios',
  topic:                'Tópicos',
  observation_type:     'Observações',
  error_type:           'Erros',
  analytical_note_type: 'Analíticos',
};

/* ── render() ─────────────────────────────── */
export function render() {
  const user = getCurrentUser();
  if (!can(user, P.ADMIN_VIEW_STRUCT) && !can(user, P.ADMIN_UPDATE_CRITERIA)) {
    return `<div class="empty-state"><div class="empty-state__icon">🔒</div><div class="empty-state__title">Acesso restrito</div></div>`;
  }

  /* Force to catalog tab if user can't see org/users */
  if (!can(user, P.ADMIN_VIEW_STRUCT) && _activeTab !== 'catalog') {
    _activeTab = 'catalog';
  }

  return `
    <div class="page-enter admin-page">
      <div class="page-header">
        <div class="page-title">Administração</div>
        <div class="page-subtitle">Gerencie a estrutura organizacional e configurações</div>
      </div>

      <div id="page-donut-slot" class="admin-page__donut-slot"></div>

      <div class="admin-tabs">
        ${can(user, P.ADMIN_VIEW_STRUCT) ? `
          <button class="admin-tab ${_activeTab==='org'   ? 'active':''}" data-tab="org">🏢 Organograma</button>
          <button class="admin-tab ${_activeTab==='users' ? 'active':''}" data-tab="users">👥 Usuários</button>
        ` : ''}
        <button class="admin-tab ${_activeTab==='catalog' ? 'active':''}" data-tab="catalog">📋 Critérios</button>
      </div>

      <div id="admin-tab-content">
        ${renderTab(_activeTab, user)}
      </div>
    </div>

    <!-- Edit modal -->
    <div id="catalog-edit-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal">
        <div class="modal__header">
          <div class="modal__title" id="catalog-modal-title">Editar</div>
          <button class="modal__close" id="catalog-modal-close">✕</button>
        </div>
        <div class="modal__body" id="catalog-modal-body"></div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="catalog-modal-cancel">Cancelar</button>
          <button class="btn btn--primary" id="catalog-modal-save">Salvar</button>
        </div>
      </div>
    </div>

    <!-- Deactivate confirm modal -->
    <div id="catalog-deact-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal modal--sm">
        <div class="modal__header">
          <div class="modal__title">Desativar item</div>
        </div>
        <div class="modal__body">
          <p id="catalog-deact-msg" class="catalog-deact-msg"></p>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="catalog-deact-cancel">Cancelar</button>
          <button class="btn btn--danger" id="catalog-deact-confirm">Desativar</button>
        </div>
      </div>
    </div>
  `;
}

/* ── Tab router ───────────────────────────── */
function renderTab(tab, user) {
  if (tab === 'org')     return renderOrgTab(user);
  if (tab === 'users')   return renderUsersTab(user);
  if (tab === 'catalog') return renderCatalogTab();
  return '';
}

/* ── Catalog tab ──────────────────────────── */
function renderCatalogTab() {
  const subtabBtns = Object.entries(CATALOG_SUBTAB_LABELS).map(([key, label]) =>
    `<button class="catalog-subtab ${_catalogTab === key ? 'active' : ''}" data-ctab="${key}">${label}</button>`
  ).join('');

  return `
    <div class="catalog-shell">
      <div class="catalog-subtabs">${subtabBtns}</div>
      <div id="catalog-content" class="catalog-content">
        <div class="catalog-loading">
          <div class="loading-spinner"></div>Carregando…
        </div>
      </div>
    </div>
  `;
}

function renderCatalogContent() {
  const user      = getCurrentUser();
  const canEdit       = can(user, P.ADMIN_UPDATE_CRITERIA);
  const isSysOwner    = can(user, P.CROSS_DEPT_VIEW);
  const cfg       = CATALOG[_catalogTab];
  const allRows   = _catalogData?.[_catalogTab] ?? [];

  /* Department filter — sysowner uses _catalogDeptFilter; others are locked to own dept */
  let displayRows = allRows;
  if (isSysOwner) {
    if (_catalogDeptFilter === 'global') {
      displayRows = allRows.filter(r => !r.department_id);
    } else if (_catalogDeptFilter) {
      displayRows = allRows.filter(r => r.department_id === _catalogDeptFilter);
    }
  } else {
    const myDeptId = user?.departmentId ?? null;
    displayRows = allRows.filter(r => !r.department_id || r.department_id === myDeptId);
  }

  /* Effective permissions: table config AND user permission */
  const eff = {
    canAdd:    cfg.canAdd    && canEdit,
    canEdit:   cfg.canEdit   && canEdit,
    canDelete: cfg.canDelete && canEdit,
  };

  /* ── eval_criteria: enrich rows with active topic pts ── */
  let headerExtra = '';
  if (_catalogTab === 'eval_criteria') {
    const ptMap    = ecPointsMap();
    displayRows    = displayRows.map(r => ({ ...r, points: ptMap[r.id] ?? 0 }));
    const totalPts = displayRows.filter(r => r.active !== false).reduce((s, r) => s + r.points, 0);
    headerExtra    = `<span class="catalog-pts-total">${totalPts} pts total</span>`;
  }

  const rowsHtml = displayRows.length
    ? displayRows.map(r => renderCatalogRow({ ...cfg, ...eff }, r)).join('')
    : `<div class="catalog-empty">Nenhum registro encontrado.</div>`;

  const depts = _catalogData?.departments ?? [];
  const filterBar = isSysOwner ? `
    <div class="catalog-dept-filter">
      <span class="catalog-dept-filter__label">Departamento</span>
      <select class="form-select catalog-dept-filter__select" id="catalog-dept-filter">
        <option value="">Todos</option>
        <option value="global" ${_catalogDeptFilter === 'global' ? 'selected' : ''}>Global</option>
        ${depts.map(d => `<option value="${d.id}" ${_catalogDeptFilter === d.id ? 'selected' : ''}>${d.name}</option>`).join('')}
      </select>
    </div>` : '';

  return `
    ${filterBar}
    <div class="panel catalog-panel">
      <div class="panel__header">
        <div class="panel__title">${cfg.label}</div>
        ${headerExtra}
        ${eff.canAdd ? `<button class="btn btn--primary btn--sm" id="catalog-add-btn">+ Adicionar</button>` : ''}
      </div>
      ${cfg.note ? `<div class="catalog-note">ℹ️ ${cfg.note}</div>` : ''}
      <div class="panel__body panel__body--compact">${rowsHtml}</div>
    </div>
  `;
}

function renderCatalogRow(cfg, row) {
  const isActive = row.active !== false;
  const meta     = cfg.meta(row);
  const depts    = _catalogData?.departments ?? [];
  const deptName = row.department_id ? (depts.find(d => d.id === row.department_id)?.name ?? '?') : null;

  /* Badges */
  const activeBadge   = isActive
    ? `<span class="badge badge--excellent">Ativo</span>`
    : `<span class="badge badge--zero">Inativo</span>`;
  const criticalBadge = row.critical
    ? `<span class="badge badge--critical">Crítico</span>` : '';
  const pointsBadge   = row.points != null
    ? `<span class="catalog-pts-badge">${row.points}pts</span>` : '';
  const deptBadge     = deptName
    ? `<span class="badge catalog-badge--dept">${deptName}</span>`
    : `<span class="badge catalog-badge--global">Global</span>`;

  /* Action buttons */
  const editBtn = cfg.canEdit
    ? `<button class="btn btn--ghost btn--sm catalog-edit-btn" data-id="${row.id}">Editar</button>`
    : '';

  const toggleBtn = cfg.canDelete
    ? isActive
      ? `<button class="btn btn--sm btn--deactivate catalog-deact-btn"
                 data-id="${row.id}" data-name="${cfg.display(row)}">Desativar</button>`
      : `<button class="btn btn--sm btn--activate catalog-act-btn"
                 data-id="${row.id}">Reativar</button>`
    : '';

  return `
    <div class="catalog-row${isActive ? '' : ' catalog-row--inactive'}">
      <div class="catalog-row__main">
        <div class="catalog-row__name">${cfg.display(row)}</div>
        ${meta ? `<div class="catalog-row__meta">${meta}</div>` : ''}
      </div>
      <div class="catalog-row__badges">${pointsBadge}${criticalBadge}${deptBadge}${activeBadge}</div>
      <div class="catalog-row__actions">${editBtn}${toggleBtn}</div>
    </div>
  `;
}

/* ── Points helpers ───────────────────────── */
function _deptMatchFn() {
  const user       = getCurrentUser();
  const isSysOwner = can(user, P.CROSS_DEPT_VIEW);
  if (isSysOwner) {
    if (_catalogDeptFilter === 'global') return item => !item.department_id;
    if (_catalogDeptFilter)             return item => item.department_id === _catalogDeptFilter;
    return () => true;
  }
  const myDeptId = user?.departmentId ?? null;
  return item => !item.department_id || item.department_id === myDeptId;
}

function ecPointsMap() {
  const match = _deptMatchFn();
  const map = {};
  for (const t of _catalogData?.topic ?? []) {
    if (!t.active || !match(t)) continue;
    map[t.eval_criteria_id] = (map[t.eval_criteria_id] ?? 0) + (t.points ?? 0);
  }
  return map;
}

/* ── Catalog data ─────────────────────────── */
async function fetchCatalog() {
  const [ecRes, topicRes, obsRes, errRes, analRes, deptRes] = await Promise.all([
    supabase.from('eval_criteria').select('id, name, active, department_id').order('name'),
    supabase.from('topic').select('id, item, description, points, eval_criteria_id, active, department_id').order('item'),
    supabase.from('observation_type').select('id, code, display_name, active, department_id').order('display_name'),
    supabase.from('error_type').select('id, name, critical, active, department_id').order('name'),
    supabase.from('analytical_note_type').select('id, name, active, department_id').order('name'),
    supabase.from('departments').select('id, name').eq('active', true).order('name'),
  ]);
  _catalogData = {
    eval_criteria:        ecRes.data    ?? [],
    topic:                topicRes.data ?? [],
    observation_type:     obsRes.data   ?? [],
    error_type:           errRes.data   ?? [],
    analytical_note_type: analRes.data  ?? [],
    departments:          deptRes.data  ?? [],
  };
}

async function initCatalogData() {
  if (!_catalogData) await fetchCatalog();
  refreshCatalogContent();
}

function refreshCatalogContent() {
  if (_donutChart) { _donutChart.destroy(); _donutChart = null; }
  removeDonutTooltip();
  const el = document.getElementById('catalog-content');
  if (el) el.innerHTML = renderCatalogContent();
  bindCatalogContentEvents();
  updatePageDonutSlot();
}

function donutExternalTooltip({ tooltip }) {
  let el = document.getElementById('donut-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id        = 'donut-tooltip';
    el.className = 'donut-tooltip';
    document.body.appendChild(el);
  }

  if (tooltip.opacity === 0) { el.style.opacity = '0'; return; }

  const item = tooltip.dataPoints?.[0];
  if (!item) return;

  el.textContent = `${item.label}: ${item.parsed}pts`;
  el.style.opacity = '1';

  /* Position to the left of the real cursor */
  const tipW = el.offsetWidth || 160;
  el.style.left = (_mouseX - tipW - 12) + 'px';
  el.style.top  = (_mouseY - (el.offsetHeight || 28) / 2) + 'px';
}

function removeDonutTooltip() {
  document.getElementById('donut-tooltip')?.remove();
}

function updatePageDonutSlot() {
  const slot = document.getElementById('page-donut-slot');
  if (!slot) return;

  if (_catalogTab !== 'topic') {
    if (_donutChart) { _donutChart.destroy(); _donutChart = null; }
    removeDonutTooltip();
    slot.innerHTML = '';
    return;
  }

  const deptMatch = _deptMatchFn();

  const totalPts = (_catalogData?.topic ?? [])
    .filter(t => t.active && deptMatch(t))
    .reduce((s, t) => s + (t.points ?? 0), 0);

  slot.innerHTML = `
    <div class="catalog-donut-wrap">
      <canvas id="ec-donut-chart" width="110" height="110"></canvas>
      <div class="catalog-donut__label">
        <div class="catalog-donut__pts">${totalPts}</div>
      </div>
    </div>`;

  if (typeof Chart === 'undefined') return;

  const ptMap          = ecPointsMap();
  const activeCriteria = (_catalogData?.eval_criteria ?? []).filter(ec => ec.active && deptMatch(ec));
  const labels         = activeCriteria.map(ec => ec.name);
  const data           = activeCriteria.map(ec => ptMap[ec.id] ?? 0);
  const colors         = activeCriteria.map((_, i) => EC_COLORS[i % EC_COLORS.length]);
  const hasData        = data.some(v => v > 0);

  const canvasEl = document.getElementById('ec-donut-chart');
  canvasEl.addEventListener('mousemove', e => { _mouseX = e.clientX; _mouseY = e.clientY; });

  _donutChart = new Chart(canvasEl, {
    type: 'doughnut',
    data: {
      labels:   hasData ? labels : ['Sem pontos'],
      datasets: [{
        data:            hasData ? data : [1],
        backgroundColor: hasData ? colors : ['#e5e7eb'],
        borderWidth:     0,
      }],
    },
    options: {
      responsive: false,
      animation:  { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled:  false,
          external: donutExternalTooltip,
        },
      },
      cutout: '60%',
    },
  });
}

/* ── Edit modal ───────────────────────────── */
function openEdit(table, row = null) {
  const cfg   = CATALOG[table];
  const isNew = row === null;
  if (isNew && !cfg.canAdd)   return;
  if (!isNew && !cfg.canEdit) return;

  _editState = { table, row };
  document.getElementById('catalog-modal-title').textContent =
    isNew ? `Adicionar — ${cfg.label}` : `Editar — ${cfg.label}`;
  document.getElementById('catalog-modal-body').innerHTML = buildEditForm(cfg, row);
  document.getElementById('catalog-edit-modal').classList.remove('modal-overlay--hidden');

  /* Pre-fill department when adding under a specific dept filter */
  if (isNew && _catalogDeptFilter && _catalogDeptFilter !== 'global') {
    const deptSel = document.getElementById('ef-department_id');
    if (deptSel) deptSel.value = _catalogDeptFilter;
  }
}

function buildEditForm(cfg, row) {
  const isNew = row === null;
  return cfg.columns.filter(c => !c.readonly).map(col => {
    const val        = row?.[col.key] ?? col.default ?? '';
    const isDisabled = !isNew && col.editReadonly;

    if (col.type === 'boolean' && !isDisabled) return `
      <div class="form-group">
        <label class="check-item">
          <input type="checkbox" id="ef-${col.key}" ${val ? 'checked' : ''}>
          <span class="form-label">${col.label}</span>
        </label>
      </div>`;

    if (col.type === 'select' && !isDisabled) {
      const opts = col.options().map(o =>
        `<option value="${o.id}" ${o.id === val ? 'selected' : ''}>${col.optLabel(o)}</option>`
      ).join('');
      return `
        <div class="form-group">
          <label class="form-label">${col.label}${col.required ? ' <span class="required">*</span>' : ''}</label>
          <select class="form-select" id="ef-${col.key}">
            <option value="">— selecione —</option>${opts}
          </select>
        </div>`;
    }

    return `
      <div class="form-group">
        <label class="form-label">${col.label}${col.required && !isDisabled ? ' <span class="required">*</span>' : ''}</label>
        <input class="form-input" type="text" id="ef-${col.key}"
               value="${val ?? ''}"
               ${isDisabled ? 'disabled' : ''}
               ${col.min != null && !isDisabled ? `min="${col.min}" type="${col.type}"` : ''}>
      </div>`;
  }).join('');
}

async function saveEdit() {
  if (!_editState) return;
  const { table, row } = _editState;
  const cfg = CATALOG[table];

  const data = {};
  for (const col of cfg.columns.filter(c => !c.readonly)) {
    const el = document.getElementById(`ef-${col.key}`);
    if (!el || el.disabled) continue;   // skip editReadonly fields when editing
    if (col.type === 'boolean') data[col.key] = el.checked;
    else if (col.type === 'number') data[col.key] = el.value === '' ? null : Number(el.value);
    else data[col.key] = el.value || null;
  }

  for (const col of cfg.columns.filter(c => c.required && !c.readonly)) {
    if (!data[col.key] && data[col.key] !== 0) {
      toast.warning('Campo obrigatório', `"${col.label}" é obrigatório.`); return;
    }
  }

  const btn = document.getElementById('catalog-modal-save');
  btn.disabled = true; btn.textContent = 'Salvando…';

  try {
    if (row) {
      const { error } = await supabase.from(table).update(data).eq('id', row.id);
      if (error) throw error;
      const idx = _catalogData[table].findIndex(r => r.id === row.id);
      if (idx !== -1) _catalogData[table][idx] = { ...row, ...data };
    } else {
      const { data: inserted, error } = await supabase.from(table).insert(data).select().single();
      if (error) throw error;
      _catalogData[table].push(inserted);
      _catalogData[table].sort((a, b) => (cfg.display(a) ?? '').localeCompare(cfg.display(b) ?? ''));
    }
    closeEditModal();
    refreshCatalogContent();
    toast.success(row ? 'Atualizado' : 'Adicionado');
  } catch (err) {
    toast.error('Erro ao salvar', err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar';
  }
}

function closeEditModal() {
  document.getElementById('catalog-edit-modal')?.classList.add('modal-overlay--hidden');
  _editState = null;
}

/* ── Deactivate / Activate ────────────────── */
function openDeactivate(table, id, name) {
  _deactState = { table, id, name };
  document.getElementById('catalog-deact-msg').innerHTML =
    `Deseja desativar <strong>${name}</strong>?<br>
     <span class="catalog-deact-hint">O item não aparecerá mais nas opções disponíveis. Esta ação pode ser revertida.</span>`;
  document.getElementById('catalog-deact-modal').classList.remove('modal-overlay--hidden');
}

async function confirmDeactivate() {
  if (!_deactState) return;
  const { table, id, name } = _deactState;
  const btn = document.getElementById('catalog-deact-confirm');
  btn.disabled = true; btn.textContent = 'Desativando…';

  try {
    const { error } = await supabase.from(table).update({ active: false }).eq('id', id);
    if (error) throw error;
    const row = _catalogData[table].find(r => r.id === id);
    if (row) row.active = false;
    closeDeactivateModal();
    refreshCatalogContent();
    toast.success('Desativado', name);
  } catch (err) {
    toast.error('Erro ao desativar', err.message);
    btn.disabled = false; btn.textContent = 'Desativar';
  }
}

async function activateItem(table, id) {
  try {
    const { error } = await supabase.from(table).update({ active: true }).eq('id', id);
    if (error) throw error;
    const row = _catalogData[table].find(r => r.id === id);
    if (row) row.active = true;
    refreshCatalogContent();
    toast.success('Reativado', CATALOG[table].display(row) ?? '');
  } catch (err) {
    toast.error('Erro ao reativar', err.message);
  }
}

function closeDeactivateModal() {
  document.getElementById('catalog-deact-modal')?.classList.add('modal-overlay--hidden');
  _deactState = null;
}

/* ── Event binding ─────────────────────────── */
function bindCatalogContentEvents() {
  document.getElementById('catalog-dept-filter')?.addEventListener('change', e => {
    _catalogDeptFilter = e.target.value || null;
    refreshCatalogContent();
  });

  document.getElementById('catalog-add-btn')?.addEventListener('click', () => openEdit(_catalogTab, null));

  document.querySelectorAll('.catalog-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const row = _catalogData[_catalogTab].find(r => r.id === btn.dataset.id);
      if (row) openEdit(_catalogTab, row);
    })
  );

  document.querySelectorAll('.catalog-deact-btn').forEach(btn =>
    btn.addEventListener('click', () => openDeactivate(_catalogTab, btn.dataset.id, btn.dataset.name))
  );

  document.querySelectorAll('.catalog-act-btn').forEach(btn =>
    btn.addEventListener('click', () => activateItem(_catalogTab, btn.dataset.id))
  );

  document.querySelectorAll('.catalog-subtab').forEach(btn =>
    btn.addEventListener('click', () => {
      if (_donutChart) { _donutChart.destroy(); _donutChart = null; }
      removeDonutTooltip();
      _catalogTab = btn.dataset.ctab;
      document.querySelectorAll('.catalog-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      refreshCatalogContent();
    })
  );
}

function bindModalEvents() {
  document.getElementById('catalog-modal-close')?.addEventListener('click',  closeEditModal);
  document.getElementById('catalog-modal-cancel')?.addEventListener('click', closeEditModal);
  document.getElementById('catalog-modal-save')?.addEventListener('click',   saveEdit);
  document.getElementById('catalog-deact-cancel')?.addEventListener('click',  closeDeactivateModal);
  document.getElementById('catalog-deact-confirm')?.addEventListener('click', confirmDeactivate);
  document.getElementById('catalog-edit-modal')?.addEventListener('click',
    e => { if (e.target.id === 'catalog-edit-modal') closeEditModal(); });
  document.getElementById('catalog-deact-modal')?.addEventListener('click',
    e => { if (e.target.id === 'catalog-deact-modal') closeDeactivateModal(); });
}

/* ── Org tab data load ────────────────────── */
async function loadOrgTabData() {
  const user      = getCurrentUser();
  const deptId    = user.departmentId;
  const isGlobal  = can(user, P.ADMIN_GLOBAL_VIEW) && can(user, P.CROSS_DEPT_VIEW);

  /* supervisedTeamIds already resolved by buildUser() — no extra query needed */
  const supervisedTeamIds = isGlobal ? null : (user.supervisedTeamIds ?? []);

  /* ── Step 1: resolve teams
     teams have no direct department_id — they link via sector_group_id → sector_groups.
     Global: resolve sector_groups for the dept first, then fetch their teams.
     Non-global: fetch supervised teams directly by ID. */
  let allTeams = [];
  if (isGlobal && deptId) {
    const { data: sgs } = await supabase
      .from('sector_groups').select('id').eq('department_id', deptId);
    const sgIds = (sgs ?? []).map(sg => sg.id);
    if (sgIds.length) {
      const { data: tRows } = await supabase
        .from('teams').select('id, name, supervisor_id')
        .in('sector_group_id', sgIds).eq('active', true).order('name');
      allTeams = tRows ?? [];
    }
  } else if (!isGlobal && supervisedTeamIds.length) {
    const { data: tRows } = await supabase
      .from('teams').select('id, name, supervisor_id')
      .in('id', supervisedTeamIds).eq('active', true).order('name');
    allTeams = tRows ?? [];
  }

  /* ── Step 2: fetch employees and managers in parallel */
  const visibleTeamIds = allTeams.map(t => t.id);

  let empQuery = supabase
    .from('employees').select('id, name, team_id')
    .eq('active', true);
  empQuery = visibleTeamIds.length
    ? empQuery.in('team_id', visibleTeamIds)
    : empQuery.in('team_id', ['00000000-0000-0000-0000-000000000000']);

  const [deptRes, managersRes, employeesRes] = await Promise.all([
    deptId
      ? supabase.from('departments').select('id, name').eq('id', deptId).single()
      : { data: null },
    isGlobal
      ? supabase.from('profiles')
          .select('id, name, role, access_level')
          .eq('department_id', deptId)
          .gte('access_level', 3)
          .order('access_level', { ascending: false })
      : { data: [] },
    empQuery,
  ]);

  /* ── Step 3: build supervisor profile map from team supervisor_ids */
  const supProfileMap = {};
  if (isGlobal) {
    for (const p of (managersRes.data ?? [])) supProfileMap[p.id] = p;
  } else {
    const supervisorIds = [...new Set(allTeams.map(t => t.supervisor_id).filter(Boolean))];
    if (supervisorIds.length) {
      const { data: supProfiles } = await supabase
        .from('profiles').select('id, name, role, access_level').in('id', supervisorIds);
      for (const p of (supProfiles ?? [])) supProfileMap[p.id] = p;
    }
  }

  /* ── Step 4: seed teamMap from all fetched teams (guarantees empty teams appear),
     then slot employees in */
  const teamMap = {};
  for (const t of allTeams) {
    const supPro = t.supervisor_id ? (supProfileMap[t.supervisor_id] ?? null) : null;
    teamMap[t.id] = {
      id:              t.id,
      name:            t.name,
      supervisorId:    t.supervisor_id ?? null,
      supervisorName:  supPro?.name         ?? '—',
      supervisorRole:  supPro?.role         ?? '—',
      supervisorLevel: supPro?.access_level ?? 3,
      members:         [],
    };
  }
  for (const emp of (employeesRes.data ?? [])) {
    if (emp.team_id && teamMap[emp.team_id]) teamMap[emp.team_id].members.push(emp);
  }

  const teams    = Object.values(teamMap).sort((a, b) => a.name.localeCompare(b.name));
  const managers = managersRes.data ?? [];

  const allIds = [
    ...managers.map(m => m.id),
    ...(employeesRes.data ?? []).map(e => e.id),
  ];
  const teamIds = teams.map(t => t.id);

  const [emailResult, transferResult] = await Promise.all([
    allIds.length
      ? supabase.rpc('get_user_emails', { user_ids: allIds })
      : Promise.resolve({ data: [] }),
    teamIds.length
      ? supabase.from('team_transfers').select('*').eq('status', 'pending')
          .or(`from_team_id.in.(${teamIds.join(',')}),to_team_id.in.(${teamIds.join(',')})`)
      : Promise.resolve({ data: [] }),
  ]);

  const emailMap = Object.fromEntries((emailResult.data ?? []).map(r => [r.id, r.email]));
  const transfers = transferResult.data ?? [];

  _orgData = { department: deptRes.data, teams, managers, emailMap, transfers };
}

/* ── Level stepper helper ─────────────────────── */
function levelStepper(profileId, currentLevel, name, isEmployee) {
  const pending      = _pendingLevelChanges[profileId];
  const displayLevel = pending ? pending.newLevel : currentLevel;
  const isPending    = displayLevel !== currentLevel;
  const safeName     = name.replace(/"/g, '&quot;');
  return `
    <span class="level-change-badge${isPending ? '' : ' level-change-badge--hidden'}">${isPending ? `${currentLevel} → ${displayLevel}` : ''}</span>
    <div class="level-stepper"
         data-profile-id="${profileId}"
         data-original-level="${currentLevel}"
         data-is-employee="${isEmployee}"
         data-name="${safeName}">
      <button class="level-stepper__btn" data-action="dec" title="Diminuir nível">−</button>
      <span class="level-stepper__val${isPending ? ' level-stepper__val--pending' : ''}">${displayLevel}</span>
      <button class="level-stepper__btn" data-action="inc" title="Aumentar nível">+</button>
    </div>`;
}

function updatePendingBar() {
  const bar = document.getElementById('level-pending-bar');
  if (!bar) return;
  const count = Object.keys(_pendingLevelChanges).length;
  bar.classList.toggle('level-pending-bar--hidden', count === 0);
  const countEl = bar.querySelector('.level-pending-bar__count');
  if (countEl) countEl.textContent = `${count} alteração(ões) pendente(s)`;
}

function renderOrgTab(user) {
  const currentUser = user ?? getCurrentUser();

  if (!_orgData) {
    return `
      <div style="display:flex;align-items:center;justify-content:center;
                  height:200px;gap:12px;color:var(--text-secondary)">
        <div class="boot-spinner" style="width:20px;height:20px;border-width:2px"></div>
        Carregando organograma…
      </div>`;
  }

  const { department, teams, managers, emailMap, transfers = [] } = _orgData;
  const canSetLevel = can(currentUser, P.ADMIN_SET_ACCESS_LEVEL);
  const myId        = currentUser?.id;
  const myLevel     = currentUser?.accessLevel ?? 0;
  const myTeams     = currentUser?.supervisedTeamIds ?? [];

  const pendingCount = Object.keys(_pendingLevelChanges).length;

  /* ── Transfer helpers ── */
  const transferByEmp = {};
  for (const t of transfers) transferByEmp[t.employee_id] = t;

  const ghostsByTeam = {};
  const empById = {};
  for (const team of teams) {
    for (const emp of team.members) empById[emp.id] = { ...emp, teamName: team.name };
  }
  for (const t of transfers) {
    const emp      = empById[t.employee_id];
    const fromTeam = teams.find(tt => tt.id === t.from_team_id);
    if (!emp || !fromTeam) continue;
    if (!ghostsByTeam[t.to_team_id]) ghostsByTeam[t.to_team_id] = [];
    ghostsByTeam[t.to_team_id].push({ transfer: t, emp, fromTeam });
  }

  /* ── Manager nodes ── */
  const managerNodes = managers.map(u => {
    const isSelf    = u.id === myId;
    const showStep  = canSetLevel && !isSelf;
    const isPending = !!_pendingLevelChanges[u.id];
    return `
      <div class="org-node org-node--user"><div class="org-node__content${isPending ? ' org-node--pending' : ''}">
        <div class="org-node__avatar">${getInitials(u.name)}</div>
        <div class="org-node__info">
          <div class="org-node__name">${u.name}</div>
          <div class="org-node__meta">${u.role ?? '—'}${isSelf ? ' (você)' : ''}${emailMap[u.id] ? `<span class="org-node__email">${emailMap[u.id]}</span>` : ''}</div>
        </div>
        <span class="role-badge role-badge--${roleClass(u.role)}">${u.role ?? '—'}</span>
        ${showStep ? levelStepper(u.id, u.access_level, u.name, false) : ''}
      </div></div>`;
  }).join('');

  /* ── Team blocks ── */
  const teamBlocks = teams.map(team => {
    const canDragFrom  = myLevel >= 5 || myTeams.includes(team.id);
    const canResolve   = myLevel >= 5 || myTeams.includes(team.id);

    const memberNodes = team.members.map(emp => {
      const isSelf          = emp.id === myId;
      const showStep        = canSetLevel && !isSelf;
      const isPending       = !!_pendingLevelChanges[emp.id];
      const hasTransfer     = !!transferByEmp[emp.id];
      const draggable       = canDragFrom && !hasTransfer ? 'draggable="true"' : '';
      return `
        <div class="org-node org-node--user${hasTransfer ? ' org-node--transferring' : ''}"
             data-emp-id="${emp.id}" data-team-id="${team.id}" ${draggable}>
          <div class="org-node__content${isPending ? ' org-node--pending' : ''}">
            <div class="org-node__avatar">${getInitials(emp.name)}</div>
            <div class="org-node__info">
              <div class="org-node__name">${emp.name}</div>
              <div class="org-node__meta">colaborador${emailMap[emp.id] ? `<span class="org-node__email">${emailMap[emp.id]}</span>` : ''}</div>
            </div>
            ${hasTransfer ? '<span class="org-transfer-badge">Transferência pendente</span>' : '<span class="role-badge role-badge--colaborador">colaborador</span>'}
            ${showStep && !hasTransfer ? levelStepper(emp.id, 2, emp.name, true) : ''}
          </div>
        </div>`;
    }).join('');

    const ghostNodes = (ghostsByTeam[team.id] ?? []).map(g => `
      <div class="org-node org-node--user org-node--ghost" data-transfer-id="${g.transfer.id}">
        <div class="org-node__content">
          <div class="org-node__avatar org-node__avatar--ghost">${getInitials(g.emp.name)}</div>
          <div class="org-node__info">
            <div class="org-node__name">${g.emp.name}</div>
            <div class="org-node__meta">Aguardando alocação · de: ${g.fromTeam.name}</div>
          </div>
          ${canResolve ? `<button class="btn btn--sm btn--ghost org-ghost-review-btn" data-transfer-id="${g.transfer.id}" type="button">Revisar</button>` : ''}
        </div>
      </div>`).join('');

    return `
      <div class="org-team-block" id="org-team-${team.id}" data-drop-team-id="${team.id}">
        <div class="org-node org-node--team"><div class="org-node__content">
          <div class="org-node__avatar org-node__avatar--team">👥</div>
          <div class="org-node__info">
            <div class="org-node__name">${team.name}</div>
            <div class="org-node__meta">
              ${team.members.length} colaboradores
              · Supervisor: ${team.supervisorName}
            </div>
          </div>
          <button class="org-team-toggle" data-team="${team.id}" title="Expandir/recolher" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        </div></div>
        <div class="org-children">${memberNodes}${ghostNodes}</div>
      </div>`;
  }).join('');

  return `
    <div class="panel panel--dark">
      <div class="panel__header">
        <div class="panel__title">Estrutura — ${department?.name ?? 'Departamento'}</div>
      </div>
      <div id="level-pending-bar" class="level-pending-bar${pendingCount === 0 ? ' level-pending-bar--hidden' : ''}">
        <span class="level-pending-bar__count">${pendingCount} alteração(ões) pendente(s)</span>
        <div style="display:flex;gap:var(--space-2)">
          <button class="btn btn--ghost btn--sm" id="discard-level-changes">Descartar</button>
          <button class="btn btn--primary btn--sm" id="apply-level-changes">Aplicar</button>
        </div>
      </div>
      <div class="panel__body">
        <div class="org-node org-node--dept">
          <div class="org-node__content">
            <div class="org-node__avatar org-node__avatar--dept">🏢</div>
            <div class="org-node__info">
              <div class="org-node__name">${department?.name ?? '—'}</div>
              <div class="org-node__meta">${managers.length} gestores / analistas</div>
            </div>
          </div>
        </div>
        <div class="org-children org-children--top">${managerNodes}</div>
        ${teamBlocks}
      </div>
    </div>

    <!-- Transfer request modal -->
    <div id="transfer-req-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal modal--sm">
        <div class="modal__header">
          <div class="modal__title">Confirmar transferência</div>
          <button class="modal__close" id="transfer-req-close" type="button">✕</button>
        </div>
        <div class="modal__body">
          <p id="transfer-req-msg" style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-4)"></p>
          <div style="background:#fefce8;border:1px solid #fde68a;border-radius:var(--radius-sm);padding:var(--space-3) var(--space-4);font-size:var(--text-sm);color:#92400e;display:flex;gap:var(--space-2);align-items:flex-start">
            <span>⚠</span>
            <span>A transferência não será concluída até que o supervisor de destino a aceite.</span>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="transfer-req-cancel" type="button">Cancelar</button>
          <button class="btn btn--primary" id="transfer-req-confirm" type="button">Solicitar transferência</button>
        </div>
      </div>
    </div>

    <!-- Transfer resolve modal -->
    <div id="transfer-resolve-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal modal--sm">
        <div class="modal__header">
          <div class="modal__title">Revisão de transferência</div>
          <button class="modal__close" id="transfer-resolve-close" type="button">✕</button>
        </div>
        <div class="modal__body">
          <p id="transfer-resolve-msg" style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-4)"></p>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Alocar em qual setor?</label>
            <select class="form-select" id="transfer-sector-select">
              <option value="">— carregando —</option>
            </select>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost btn--danger-text" id="transfer-deny-btn" type="button">Recusar</button>
          <div style="flex:1"></div>
          <button class="btn btn--ghost" id="transfer-resolve-cancel" type="button">Fechar</button>
          <button class="btn btn--primary" id="transfer-approve-btn" type="button">Confirmar alocação</button>
        </div>
      </div>
    </div>`;
}

/* ── Demotion pre-check ───────────────────────── */
async function checkDemotionAllowed(profileId) {
  const { data: supervisedTeams } = await supabase
    .from('teams')
    .select('id, name')
    .eq('supervisor_id', profileId)
    .eq('active', true);
  if (!supervisedTeams?.length) return { allowed: true };

  const teamIds = supervisedTeams.map(t => t.id);
  const { data: sectors } = await supabase
    .from('sectors')
    .select('id, name')
    .in('team_id', teamIds);
  if (!sectors?.length) return { allowed: true };

  const sectorIds = sectors.map(s => s.id);
  const { data: activeEmps, count } = await supabase
    .from('employees')
    .select('id, sector_id', { count: 'exact' })
    .in('sector_id', sectorIds)
    .eq('active', true);
  if (!count) return { allowed: true };

  const firstBlockingSector = sectors.find(s => activeEmps.some(e => e.sector_id === s.id));
  return {
    allowed: false,
    sectorName: firstBlockingSector?.name ?? '?',
    employeeCount: count,
  };
}

/* ── Level change application ─────────────────── */
async function applyLevelChanges() {
  const changes = Object.entries(_pendingLevelChanges);
  if (!changes.length) return;

  const btn = document.getElementById('apply-level-changes');
  if (btn) { btn.disabled = true; btn.textContent = 'Aplicando…'; }

  try {
    for (const [profileId, change] of changes) {
      const { newLevel, originalLevel } = change;

      if (originalLevel === 2 && newLevel > 2) {
        /* Promotion:
           1. Deactivate employee row
           2. Upsert profile with role scope fields
           3. Create a new team if supervisor */
        const { data: empRow } = await supabase
          .from('employees').select('name, team_id, teams(sector_group_id, sector_groups(department_id))')
          .eq('id', profileId).maybeSingle();
        const sectorGroupId = empRow?.teams?.sector_group_id ?? null;
        const departmentId  = empRow?.teams?.sector_groups?.department_id ?? null;
        const empName       = empRow?.name ?? change.name;

        const { error: e1 } = await supabase.from('employees').update({ active: false }).eq('id', profileId);
        if (e1) throw e1;

        const { error: e2 } = await supabase.from('profiles').upsert({
          id:              profileId,
          name:            empName,
          role:            roleClass(newLevel),
          access_level:    newLevel,
          filter_by:       newLevel === 3 ? 'supervisor' : 'department',
          shifts_filter_by: newLevel === 3 ? 'group' : 'department',
          sector_group_id: sectorGroupId,
          department_id:   departmentId,
        }, { onConflict: 'id' });
        if (e2) throw e2;

        if(newLevel === 3) {
          const { error: e3 } = await supabase.from('teams').insert({
            name:           empName,
            supervisor_id:  profileId,
            sector_group_id: sectorGroupId,
            active:         true,
          });
          if (e3) throw e3;
        }

      } else if (newLevel === 2) {
        /* Demotion to employee:
           Pre-check (safety net in case check was bypassed), then hard delete
           profile and reactivate the employee record. */
        const check = await checkDemotionAllowed(profileId);
        if (!check.allowed) {
          throw new Error(`Não é possível rebaixar ${change.name}: Setor ${check.sectorName} tem ${check.employeeCount} colaborador(es) ativo(s).`);
        }

        const { error: e1 } = await supabase.from('profiles').delete().eq('id', profileId);
        if (e1) throw e1;

        const { data: existingEmp } = await supabase.from('employees').select('id').eq('id', profileId).maybeSingle();
        if (existingEmp) {
          const { error: e2 } = await supabase.from('employees').update({ active: true }).eq('id', profileId);
          if (e2) throw e2;
        }

      } else {
        /* Other lateral changes (e.g. 4→5): update level only */
        const { error: e1 } = await supabase.from('profiles').update({ access_level: newLevel }).eq('id', profileId);
        if (e1) throw e1;
      }
    }

    _pendingLevelChanges = {};
    toast.success('Alterações de nível aplicadas com sucesso');
    _orgData = null;
    await loadOrgTabData();
    document.getElementById('admin-tab-content').innerHTML = renderTab('org', getCurrentUser());
    bindTabEvents();
  } catch (err) {
    toast.error('Erro ao aplicar alterações', err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Aplicar'; }
  }
}

function renderUsersTab() {
  const rows = _unclaimedProfiles.length
    ? _unclaimedProfiles.map(p => `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:var(--space-3)">
              <div class="user-list-item__avatar">${getInitials(p.name)}</div>
              <div>
                <div style="font-weight:var(--weight-medium)">${p.name}</div>
                <div style="font-size:var(--text-xs);color:var(--text-secondary)">${p.email}</div>
              </div>
            </div>
          </td>
          <td style="font-size:var(--text-xs);color:var(--text-secondary)">
            ${new Date(p.created_at).toLocaleDateString('pt-BR')}
          </td>
          <td style="text-align:right">
            <button class="btn btn--primary btn--sm btn-absorb"
                    data-id="${p.id}" data-name="${p.name.replace(/"/g,'&quot;')}">
              Absorver
            </button>
          </td>
        </tr>`)
      .join('')
    : `<tr><td colspan="3">
         <div class="empty-state" style="padding:var(--space-6)">
           <div class="empty-state__title">Todos os usuários já possuem vínculo</div>
         </div>
       </td></tr>`;

  const sectorOpts = _adminSectors.map(s =>
    `<option value="${s.id}">${s.name}</option>`
  ).join('');

  return `
    <div class="panel">
      <div class="panel__header">
        <div class="panel__title">Usuários sem vínculo</div>
        <span class="badge badge--neutral">${_unclaimedProfiles.length}</span>
      </div>
      <table class="admin-table" style="width:100%; padding:10px">
        <thead>
          <tr>
            <th>Usuário</th>
            <th>Cadastro</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <!-- ── Absorption modal ── -->
    <div id="absorb-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal">
        <div class="modal__header">
          <div class="modal__title">Absorver colaborador</div>
          <button class="modal__close" id="absorb-close">✕</button>
        </div>
        <div class="modal__body">
          <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-4)">
            <strong id="absorb-name" style="color:var(--text-primary)"></strong>
            será registrado como colaborador. O setor define automaticamente o grupo e o departamento.
            O vínculo com equipe pode ser configurado posteriormente.
          </p>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Setor <span class="required">*</span></label>
            <select class="form-select" id="absorb-sector">
              <option value="">— selecione —</option>
              ${sectorOpts}
            </select>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="absorb-cancel">Cancelar</button>
          <button class="btn btn--primary" id="absorb-confirm">Absorver</button>
        </div>
      </div>
    </div>`;
}

/* ── Users tab data ───────────────────────── */
async function loadUsersTabData() {
  const [usersRes, sectorsRes] = await Promise.all([
    supabase.rpc('get_unlinked_auth_users'),
    supabase.from('sectors').select('id, name').eq('active', true).order('name'),
  ]);
  _unclaimedProfiles = usersRes.data ?? [];
  _adminSectors      = sectorsRes.data ?? [];
}

function openAbsorbModal(profileId, profileName) {
  _absorbTarget = profileId;
  const nameEl = document.getElementById('absorb-name');
  if (nameEl) nameEl.textContent = profileName;
  document.getElementById('absorb-sector').value = '';
  document.getElementById('absorb-modal')?.classList.remove('modal-overlay--hidden');
}

function closeAbsorbModal() {
  _absorbTarget = null;
  document.getElementById('absorb-modal')?.classList.add('modal-overlay--hidden');
}

async function absorbUser() {
  const sectorId = document.getElementById('absorb-sector')?.value;
  if (!sectorId) { toast.warning('Atenção', 'Selecione um setor.'); return; }

  const authUser = _unclaimedProfiles.find(p => p.id === _absorbTarget);
  if (!authUser) return;

  const btn = document.getElementById('absorb-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Absorvendo…'; }

  /* Resolve sector → sector_group → department for profile fields */
  const { data: sectorRow } = await supabase
    .from('sectors')
    .select('id, sector_group_id, sector_groups(department_id)')
    .eq('id', sectorId)
    .single();
  const sectorGroupId = sectorRow?.sector_group_id ?? null;
  const departmentId  = sectorRow?.sector_groups?.department_id ?? null;

  /* Upsert profile — auth users coming from the unlinked tab have no profile yet */
  const { error: profError } = await supabase.from('profiles').upsert({
    id:             authUser.id,
    name:           authUser.name,
    role:           'colaborador',
    access_level:   2,
    sector_id:      sectorId,
    sector_group_id: sectorGroupId,
    department_id:  departmentId,
    filter_by:      'supervisor',
  }, { onConflict: 'id' });
  if (profError) {
    toast.error('Erro ao criar perfil', profError.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Absorver'; }
    return;
  }

  const { error } = await supabase.from('employees').insert({
    id:        authUser.id,
    name:      authUser.name,
    sector_id: sectorId,
    active:    true,
  });

  if (error) {
    toast.error('Erro ao absorver', error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Absorver'; }
    return;
  }

  // Insert unvalidated default shift (9h–18h, break 13h–14h)
  const user = getCurrentUser();
  await supabase.from('shifts').insert({
    id:                      crypto.randomUUID(),
    employee_id:             authUser.id,
    is_default:              true,
    date:                    null,
    validated:               false,
    start_time:              '09:00:00',
    end_time:                '18:00:00',
    break_start:             '13:00:00',
    break_duration_minutes:  60,
    updated_by:              user?.id ?? authUser.id,
    updated_at:              new Date().toISOString(),
  });

  closeAbsorbModal();
  toast.success(`${authUser.name} absorvido com sucesso`);
  await loadUsersTabData();
  document.getElementById('admin-tab-content').innerHTML = renderTab('users', getCurrentUser());
  bindTabEvents();
}

/* ── init ─────────────────────────────────── */
export async function init() {
  bindModalEvents();

  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (_donutChart) { _donutChart.destroy(); _donutChart = null; }
      removeDonutTooltip();
      const slot = document.getElementById('page-donut-slot');
      if (slot) slot.innerHTML = '';
      _activeTab = btn.dataset.tab;
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _orgData = null;
      _pendingLevelChanges = {};
      if (_activeTab === 'org')   await loadOrgTabData();
      if (_activeTab === 'users') await loadUsersTabData();
      document.getElementById('admin-tab-content').innerHTML = renderTab(_activeTab, getCurrentUser());
      bindTabEvents();
      if (_activeTab === 'catalog') await initCatalogData();
    });
  });

  bindTabEvents();
  if (_activeTab === 'users')   await loadUsersTabData();
  if (_activeTab === 'org')     await loadOrgTabData();
  document.getElementById('admin-tab-content').innerHTML = renderTab(_activeTab, getCurrentUser());
  bindTabEvents();
  if (_activeTab === 'catalog') await initCatalogData();
}

/* ── Team transfer functions ──────────────────── */
function openTransferRequestModal({ empId, empName, fromTeamId, fromTeamName, toTeamId, toTeamName }) {
  _transferDragState = { empId, empName, fromTeamId, fromTeamName, toTeamId, toTeamName };
  const msg = document.getElementById('transfer-req-msg');
  if (msg) msg.innerHTML = `Deseja transferir <strong>${empName}</strong> da equipe <strong>${fromTeamName}</strong> para <strong>${toTeamName}</strong>?`;
  document.getElementById('transfer-req-modal')?.classList.remove('modal-overlay--hidden');
}

function closeTransferRequestModal() {
  _transferDragState = null;
  document.getElementById('transfer-req-modal')?.classList.add('modal-overlay--hidden');
}

async function confirmTransferRequest() {
  if (!_transferDragState) return;
  const { empId, fromTeamId, toTeamId } = _transferDragState;
  const user = getCurrentUser();
  const btn  = document.getElementById('transfer-req-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Solicitando…'; }
  try {
    const { error } = await supabase.from('team_transfers').insert({
      id:           crypto.randomUUID(),
      employee_id:  empId,
      from_team_id: fromTeamId,
      to_team_id:   toTeamId,
      requested_by: user.id,
    });
    if (error) throw error;
    closeTransferRequestModal();
    _orgData = null;
    await loadOrgTabData();
    document.getElementById('admin-tab-content').innerHTML = renderTab('org', getCurrentUser());
    bindTabEvents();
  } catch (err) {
    console.error('[admin] transfer request:', err);
    toast.error('Erro', err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Solicitar transferência'; }
  }
}

async function openTransferResolveModal(transferId) {
  _transferResolveId = transferId;
  const transfer = (_orgData?.transfers ?? []).find(t => t.id === transferId);
  if (!transfer) return;

  const empById = {};
  for (const team of (_orgData?.teams ?? [])) {
    for (const emp of team.members) empById[emp.id] = emp;
  }
  const emp      = empById[transfer.employee_id];
  const fromTeam = (_orgData?.teams ?? []).find(t => t.id === transfer.from_team_id);
  const toTeam   = (_orgData?.teams ?? []).find(t => t.id === transfer.to_team_id);

  const msg = document.getElementById('transfer-resolve-msg');
  if (msg) msg.innerHTML = `O supervisor <strong>${fromTeam?.supervisorName ?? '—'}</strong> deseja transferir <strong>${emp?.name ?? '—'}</strong> para a equipe <strong>${toTeam?.name ?? '—'}</strong>.`;

  const sectorSel = document.getElementById('transfer-sector-select');
  if (sectorSel) {
    sectorSel.innerHTML = '<option value="">— carregando —</option>';
    const { data: sectors } = await supabase
      .from('sectors').select('id, name')
      .eq('team_id', transfer.to_team_id).eq('active', true).order('name');
    sectorSel.innerHTML = '<option value="">— Selecionar setor —</option>' +
      (sectors ?? []).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  }

  document.getElementById('transfer-resolve-modal')?.classList.remove('modal-overlay--hidden');
}

function closeTransferResolveModal() {
  _transferResolveId = null;
  document.getElementById('transfer-resolve-modal')?.classList.add('modal-overlay--hidden');
}

async function approveTransfer() {
  const sectorId = document.getElementById('transfer-sector-select')?.value;
  if (!sectorId) { toast.error('Selecione um setor', 'É necessário escolher um setor para concluir a alocação.'); return; }
  const transfer = (_orgData?.transfers ?? []).find(t => t.id === _transferResolveId);
  if (!transfer) return;

  const user = getCurrentUser();
  const btn  = document.getElementById('transfer-approve-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Processando…'; }
  try {
    const { data: toTeamData } = await supabase
      .from('teams').select('sector_group_id').eq('id', transfer.to_team_id).single();

    const { error: e1 } = await supabase.from('employees').update({
      team_id:         transfer.to_team_id,
      sector_id:       sectorId,
      sector_group_id: toTeamData?.sector_group_id ?? null,
    }).eq('id', transfer.employee_id);
    if (e1) throw e1;

    const { error: e2 } = await supabase.from('team_transfers').update({
      status:           'approved',
      resolved_by:      user.id,
      resolved_at:      new Date().toISOString(),
      target_sector_id: sectorId,
    }).eq('id', _transferResolveId);
    if (e2) throw e2;

    toast.success('Transferência aprovada', 'O colaborador foi alocado na nova equipe.');
    closeTransferResolveModal();
    _orgData = null;
    await loadOrgTabData();
    document.getElementById('admin-tab-content').innerHTML = renderTab('org', getCurrentUser());
    bindTabEvents();
  } catch (err) {
    console.error('[admin] approve transfer:', err);
    toast.error('Erro', err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar alocação'; }
  }
}

async function denyTransfer() {
  if (!_transferResolveId) return;
  const user = getCurrentUser();
  const btn  = document.getElementById('transfer-deny-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Recusando…'; }
  try {
    const { error } = await supabase.from('team_transfers').update({
      status:      'denied',
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    }).eq('id', _transferResolveId);
    if (error) throw error;

    toast.success('Transferência recusada', 'O colaborador permanece na equipe atual.');
    closeTransferResolveModal();
    _orgData = null;
    await loadOrgTabData();
    document.getElementById('admin-tab-content').innerHTML = renderTab('org', getCurrentUser());
    bindTabEvents();
  } catch (err) {
    console.error('[admin] deny transfer:', err);
    toast.error('Erro', err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Recusar'; }
  }
}

function bindTabEvents() {
  /* ── Users tab ── */
  document.querySelectorAll('.btn-absorb').forEach(btn => {
    btn.addEventListener('click', () => openAbsorbModal(btn.dataset.id, btn.dataset.name));
  });
  document.getElementById('absorb-close')?.addEventListener('click', closeAbsorbModal);
  document.getElementById('absorb-cancel')?.addEventListener('click', closeAbsorbModal);
  document.getElementById('absorb-modal')?.addEventListener('click',
    e => { if (e.target.id === 'absorb-modal') closeAbsorbModal(); });
  document.getElementById('absorb-confirm')?.addEventListener('click', absorbUser);

  /* ── Org tab — team collapse toggles ── */
  document.querySelectorAll('.org-team-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.org-team-block')?.classList.toggle('org-team-block--collapsed');
    });
  });

  /* ── Org tab — drag-scroll ── */
  let _dragScrollRaf = null;
  function _dragScroll(e) {
    const ZONE = 80, SPEED = 12;
    const y = e.clientY;
    const h = window.innerHeight;
    cancelAnimationFrame(_dragScrollRaf);
    if (y < ZONE) {
      const force = (ZONE - y) / ZONE;
      _dragScrollRaf = requestAnimationFrame(function tick() {
        window.scrollBy(0, -Math.round(SPEED * force));
        _dragScrollRaf = requestAnimationFrame(tick);
      });
    } else if (y > h - ZONE) {
      const force = (y - (h - ZONE)) / ZONE;
      _dragScrollRaf = requestAnimationFrame(function tick() {
        window.scrollBy(0, Math.round(SPEED * force));
        _dragScrollRaf = requestAnimationFrame(tick);
      });
    }
  }
  function _stopDragScroll() { cancelAnimationFrame(_dragScrollRaf); _dragScrollRaf = null; }
  document.addEventListener('dragover',  _dragScroll);
  document.addEventListener('dragend',   _stopDragScroll);
  document.addEventListener('drop',      _stopDragScroll);

  /* ── Org tab — drag & drop transfers ── */
  document.querySelectorAll('.org-node--user[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', e => {
      const empId    = card.dataset.empId;
      const teamId   = card.dataset.teamId;
      const empName  = card.querySelector('.org-node__name')?.textContent?.trim() ?? '';
      const teamName = card.closest('.org-team-block')
        ?.querySelector('.org-node--team .org-node__name')?.textContent?.trim() ?? '';
      _transferDragState = { empId, empName, fromTeamId: teamId, fromTeamName: teamName };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', empId);

      // Browser snapshots the card at full opacity here (before rAF),
      // then we hide the origin so it vanishes from its starting position.
      requestAnimationFrame(() => {
        card.classList.add('org-node--dragging');
        // Inject drop placeholders into every eligible team
        document.querySelectorAll('.org-team-block[data-drop-team-id]').forEach(block => {
          if (block.dataset.dropTeamId === teamId) return;
          const children = block.querySelector('.org-children');
          if (!children) return;
          const ph = document.createElement('div');
          ph.className = 'org-drop-placeholder';
          ph.dataset.phTeam = block.dataset.dropTeamId;
          ph.textContent = 'Soltar aqui';
          children.appendChild(ph);
        });
      });
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('org-node--dragging');
      document.querySelectorAll('.org-drop-placeholder').forEach(ph => ph.remove());
      document.querySelectorAll('.org-drop-active').forEach(el => el.classList.remove('org-drop-active'));
      // Do NOT clear _transferDragState here — drop fires before dragend, so the
      // modal may already be open and waiting for the user to confirm.
      // State is cleared by confirmTransferRequest() or closeTransferRequestModal().
    });
  });

  document.querySelectorAll('.org-team-block[data-drop-team-id]').forEach(block => {
    block.addEventListener('dragover', e => {
      if (!_transferDragState) return;
      if (block.dataset.dropTeamId === _transferDragState.fromTeamId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      block.classList.add('org-drop-active');
      document.querySelectorAll('.org-drop-placeholder').forEach(ph => {
        ph.classList.toggle('org-drop-placeholder--active', ph.dataset.phTeam === block.dataset.dropTeamId);
      });
    });
    block.addEventListener('dragleave', e => {
      if (!block.contains(e.relatedTarget)) {
        block.classList.remove('org-drop-active');
        document.querySelectorAll('.org-drop-placeholder').forEach(ph =>
          ph.classList.remove('org-drop-placeholder--active'));
      }
    });
    block.addEventListener('drop', e => {
      e.preventDefault();
      block.classList.remove('org-drop-active');
      if (!_transferDragState) return;
      const toTeamId = block.dataset.dropTeamId;
      if (toTeamId === _transferDragState.fromTeamId) return;
      const toTeamName = block.querySelector('.org-node--team .org-node__name')?.textContent?.trim() ?? '';
      openTransferRequestModal({ ..._transferDragState, toTeamId, toTeamName });
    });
  });

  /* ── Org tab — ghost review ── */
  document.querySelectorAll('.org-ghost-review-btn').forEach(btn => {
    btn.addEventListener('click', () => openTransferResolveModal(btn.dataset.transferId));
  });

  /* ── Org tab — transfer request modal ── */
  document.getElementById('transfer-req-confirm')?.addEventListener('click', confirmTransferRequest);
  document.getElementById('transfer-req-cancel')?.addEventListener('click', closeTransferRequestModal);
  document.getElementById('transfer-req-close')?.addEventListener('click', closeTransferRequestModal);
  document.getElementById('transfer-req-modal')?.addEventListener('click',
    e => { if (e.target.id === 'transfer-req-modal') closeTransferRequestModal(); });

  /* ── Org tab — transfer resolve modal ── */
  document.getElementById('transfer-approve-btn')?.addEventListener('click', approveTransfer);
  document.getElementById('transfer-deny-btn')?.addEventListener('click', denyTransfer);
  document.getElementById('transfer-resolve-cancel')?.addEventListener('click', closeTransferResolveModal);
  document.getElementById('transfer-resolve-close')?.addEventListener('click', closeTransferResolveModal);
  document.getElementById('transfer-resolve-modal')?.addEventListener('click',
    e => { if (e.target.id === 'transfer-resolve-modal') closeTransferResolveModal(); });

  /* ── Org tab — level steppers ── */
  document.querySelectorAll('.level-stepper__btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const stepper       = btn.closest('.level-stepper');
      const profileId     = stepper.dataset.profileId;
      const originalLevel = Number(stepper.dataset.originalLevel);
      const isEmployee    = stepper.dataset.isEmployee === 'true';
      const name          = stepper.dataset.name;
      const user          = getCurrentUser();
      const maxLevel      = user?.accessLevel ?? 2;

      const pending           = _pendingLevelChanges[profileId];
      let currentDisplayLevel = pending ? pending.newLevel : originalLevel;

      if (btn.dataset.action === 'inc') {
        if (currentDisplayLevel >= maxLevel) return;
        currentDisplayLevel++;
      } else {
        if (currentDisplayLevel <= 2) return;
        if (currentDisplayLevel - 1 === 2) {
          const check = await checkDemotionAllowed(profileId);
          if (!check.allowed) {
            toast.warn(
              `Este usuário não pode ser rebaixado, pois é supervisor do Setor ${check.sectorName} ` +
              `(${check.employeeCount} colaborador${check.employeeCount !== 1 ? 'es' : ''}). ` +
              `Para continuar, realoque os colaboradores para outra equipe.`
            );
            return;
          }
        }
        currentDisplayLevel--;
      }

      if (currentDisplayLevel === originalLevel) {
        delete _pendingLevelChanges[profileId];
      } else {
        _pendingLevelChanges[profileId] = {
          newLevel: currentDisplayLevel, originalLevel, name, isEmployee,
        };
      }

      /* Update stepper display without full re-render */
      const valEl = stepper.querySelector('.level-stepper__val');
      if (valEl) {
        valEl.textContent = currentDisplayLevel;
        valEl.classList.toggle('level-stepper__val--pending', currentDisplayLevel !== originalLevel);
      }

      /* Update node overlay and change badge */
      const nodeContent = stepper.closest('.org-node__content');
      const badge       = nodeContent?.querySelector('.level-change-badge');
      const isPending   = currentDisplayLevel !== originalLevel;
      nodeContent?.classList.toggle('org-node--pending', isPending);
      if (badge) {
        badge.textContent = isPending ? `${originalLevel} → ${currentDisplayLevel}` : '';
        badge.classList.toggle('level-change-badge--hidden', !isPending);
      }

      updatePendingBar();
    });
  });

  /* ── Org tab — pending bar actions ── */
  document.getElementById('apply-level-changes')?.addEventListener('click', applyLevelChanges);
  document.getElementById('discard-level-changes')?.addEventListener('click', () => {
    _pendingLevelChanges = {};
    document.getElementById('admin-tab-content').innerHTML = renderTab('org', getCurrentUser());
    bindTabEvents();
  });
}
