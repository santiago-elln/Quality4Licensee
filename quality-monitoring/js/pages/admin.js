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
let _activeTab   = 'org';
let _catalogTab  = 'eval_criteria';
let _catalogData = null;
let _editState   = null;   // { table, row } — row=null means new
let _deactState  = null;   // { table, id, name }
let _donutChart  = null;
let _mouseX      = 0;
let _mouseY      = 0;

/* ── Org tab state ────────────────────────── */
let _orgData = null;   // { department, teams:[{id,name,supervisorName,supervisorRole,members}], managers }

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
const CATALOG = {
  eval_criteria: {
    label:   'Critérios de Avaliação',
    columns: [
      { key: 'name',   label: 'Nome',  type: 'text',    required: true },
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
  const user    = getCurrentUser();
  const canEdit = can(user, P.ADMIN_UPDATE_CRITERIA);
  const cfg     = CATALOG[_catalogTab];
  const rows    = _catalogData?.[_catalogTab] ?? [];

  /* Effective permissions: table config AND user permission */
  const eff = {
    canAdd:    cfg.canAdd    && canEdit,
    canEdit:   cfg.canEdit   && canEdit,
    canDelete: cfg.canDelete && canEdit,
  };

  /* ── eval_criteria: enrich rows with active topic pts ── */
  let displayRows  = rows;
  let headerExtra  = '';

  if (_catalogTab === 'eval_criteria') {
    const ptMap    = ecPointsMap();
    displayRows    = rows.map(r => ({ ...r, points: ptMap[r.id] ?? 0 }));
    const totalPts = displayRows
      .filter(r => r.active !== false)
      .reduce((s, r) => s + r.points, 0);
    headerExtra = `<span class="catalog-pts-total">${totalPts} pts total</span>`;
  }

  const rowsHtml = displayRows.length
    ? displayRows.map(r => renderCatalogRow({ ...cfg, ...eff }, r)).join('')
    : `<div class="catalog-empty">Nenhum registro encontrado.</div>`;

  return `
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
  const isActive   = row.active !== false;
  const meta       = cfg.meta(row);

  /* Badges */
  const activeBadge   = isActive
    ? `<span class="badge badge--excellent">Ativo</span>`
    : `<span class="badge badge--zero">Inativo</span>`;
  const criticalBadge = row.critical
    ? `<span class="badge badge--critical">Crítico</span>` : '';
  const pointsBadge   = row.points != null
    ? `<span class="catalog-pts-badge">${row.points}pts</span>` : '';

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
      <div class="catalog-row__badges">${pointsBadge}${criticalBadge}${activeBadge}</div>
      <div class="catalog-row__actions">${editBtn}${toggleBtn}</div>
    </div>
  `;
}

/* ── Points helpers ───────────────────────── */
function ecPointsMap() {
  const map = {};
  for (const t of _catalogData?.topic ?? []) {
    if (!t.active) continue;
    map[t.eval_criteria_id] = (map[t.eval_criteria_id] ?? 0) + (t.points ?? 0);
  }
  return map;
}

/* ── Catalog data ─────────────────────────── */
async function fetchCatalog() {
  const [ecRes, topicRes, obsRes, errRes, analRes] = await Promise.all([
    supabase.from('eval_criteria').select('id, name, active').order('name'),
    supabase.from('topic').select('id, item, description, points, eval_criteria_id, active').order('item'),
    supabase.from('observation_type').select('id, code, display_name, active').order('display_name'),
    supabase.from('error_type').select('id, name, critical, active').order('name'),
    supabase.from('analytical_note_type').select('id, name, active').order('name'),
  ]);
  _catalogData = {
    eval_criteria:        ecRes.data    ?? [],
    topic:                topicRes.data ?? [],
    observation_type:     obsRes.data   ?? [],
    error_type:           errRes.data   ?? [],
    analytical_note_type: analRes.data  ?? [],
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

  const totalPts = (_catalogData?.topic ?? [])
    .filter(t => t.active)
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
  const activeCriteria = (_catalogData?.eval_criteria ?? []).filter(ec => ec.active);
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
  const isGlobal  = can(user, P.ADMIN_GLOBAL_VIEW);

  /* supervisedTeamIds already resolved by buildUser() — no extra query needed */
  const supervisedTeamIds = isGlobal ? null : (user.supervisedTeamIds ?? []);

  /* teams.supervisor_id has no FK to profiles — omit nested profile join */
  let empQuery = supabase
    .from('employees')
    .select('id, name, team_id, teams(id, name, supervisor_id)')
    .eq('department_id', deptId)
    .eq('active', true);

  if (!isGlobal) {
    /* Show only employees on supervised teams; empty list if supervising none */
    empQuery = supervisedTeamIds.length
      ? empQuery.in('team_id', supervisedTeamIds)
      : empQuery.in('team_id', ['00000000-0000-0000-0000-000000000000']); // no results
  }

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
      : { data: [] },   // non-global users don't see the managers strip
    empQuery,
  ]);

  /* Build supervisor profile map.
     Global users: managersRes already contains all profiles with access_level ≥ 3,
     which is a superset of every team supervisor — no extra fetch needed.
     Non-global users: fetch only the profiles for supervisors visible in their teams. */
  const supProfileMap = {};
  if (isGlobal) {
    for (const p of (managersRes.data ?? [])) supProfileMap[p.id] = p;
  } else {
    const supervisorIds = [...new Set(
      (employeesRes.data ?? []).map(e => e.teams?.supervisor_id).filter(Boolean)
    )];
    if (supervisorIds.length) {
      const { data: supProfiles } = await supabase
        .from('profiles').select('id, name, role, access_level').in('id', supervisorIds);
      for (const p of (supProfiles ?? [])) supProfileMap[p.id] = p;
    }
  }

  /* Group employees by team */
  const teamMap = {};
  for (const emp of (employeesRes.data ?? [])) {
    if (!emp.team_id) continue;
    if (!teamMap[emp.team_id]) {
      const supId  = emp.teams?.supervisor_id ?? null;
      const supPro = supId ? (supProfileMap[supId] ?? null) : null;
      teamMap[emp.team_id] = {
        id:              emp.team_id,
        name:            emp.teams?.name ?? '—',
        supervisorId:    supId,
        supervisorName:  supPro?.name         ?? '—',
        supervisorRole:  supPro?.role         ?? '—',
        supervisorLevel: supPro?.access_level ?? 3,
        members:         [],
      };
    }
    teamMap[emp.team_id].members.push(emp);
  }

  _orgData = {
    department: deptRes.data,
    teams:      Object.values(teamMap).sort((a, b) => a.name.localeCompare(b.name)),
    managers:   managersRes.data ?? [],
  };
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

  const { department, teams, managers } = _orgData;
  const canSetLevel = can(currentUser, P.ADMIN_SET_ACCESS_LEVEL);
  const myId        = currentUser?.id;

  const pendingCount = Object.keys(_pendingLevelChanges).length;

  const managerNodes = managers.map(u => {
    const isSelf    = u.id === myId;
    const showStep  = canSetLevel && !isSelf;
    const isPending = !!_pendingLevelChanges[u.id];
    return `
      <div class="org-node org-node--user"><div class="org-node__content${isPending ? ' org-node--pending' : ''}">
        <div class="org-node__avatar">${getInitials(u.name)}</div>
        <div class="org-node__info">
          <div class="org-node__name">${u.name}</div>
          <div class="org-node__meta">${u.role ?? '—'}${isSelf ? ' (você)' : ''}</div>
        </div>
        <span class="role-badge role-badge--${roleClass(u.role)}">${u.role ?? '—'}</span>
        ${showStep ? levelStepper(u.id, u.access_level, u.name, false) : ''}
      </div></div>`;
  }).join('');

  const teamBlocks = teams.map(team => {
    const memberNodes = team.members.map(emp => {
      const isSelf   = emp.id === myId;
      const showStep = canSetLevel && !isSelf;
      const isPending = !!_pendingLevelChanges[emp.id];
      return `
        <div class="org-node org-node--user"><div class="org-node__content${isPending ? ' org-node--pending' : ''}">
          <div class="org-node__avatar">${getInitials(emp.name)}</div>
          <div class="org-node__info">
            <div class="org-node__name">${emp.name}</div>
            <div class="org-node__meta">colaborador</div>
          </div>
          <span class="role-badge role-badge--colaborador">colaborador</span>
          ${showStep ? levelStepper(emp.id, 2, emp.name, true) : ''}
        </div></div>`;
    }).join('');

    return `
      <div class="org-team-block">
        <div class="org-node org-node--team"><div class="org-node__content">
          <div class="org-node__avatar org-node__avatar--team">👥</div>
          <div class="org-node__info">
            <div class="org-node__name">${team.name}</div>
            <div class="org-node__meta">
              ${team.members.length} colaboradores
              · Supervisor: ${team.supervisorName}
            </div>
          </div>
        </div></div>
        <div class="org-children">${memberNodes}</div>
      </div>`;
  }).join('');

  return `
    <div class="panel">
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
    </div>`;
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
        /* Upgrade: soft-delete employee row, elevate profile */
        const { error: e1 } = await supabase.from('employees').update({ active: false }).eq('id', profileId);
        if (e1) throw e1;
        const { error: e2 } = await supabase.from('profiles').update({ access_level: newLevel }).eq('id', profileId);
        if (e2) throw e2;

      } else if (originalLevel > 2 && newLevel === 2) {
        /* Demotion: set profile to level 2, reactivate or create employee */
        const { error: e1 } = await supabase.from('profiles').update({ access_level: 2 }).eq('id', profileId);
        if (e1) throw e1;
        const { data: existingEmp } = await supabase.from('employees').select('id').eq('id', profileId).maybeSingle();
        if (existingEmp) {
          const { error: e2 } = await supabase.from('employees').update({ active: true }).eq('id', profileId);
          if (e2) throw e2;
        } else {
          /* No prior employee record — create one using profile's sector */
          const { data: profile } = await supabase.from('profiles').select('name, sector_id').eq('id', profileId).single();
          if (profile?.sector_id) {
            const { error: e3 } = await supabase.from('employees').insert({
              id:        profileId,
              name:      profile.name,
              sector_id: profile.sector_id,
              active:    true,
            });
            if (e3) throw e3;
          }
        }

      } else {
        /* Lateral level change (3+ → different 3+): update profile only */
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
              <span style="font-weight:var(--weight-medium)">${p.name}</span>
            </div>
          </td>
          <td>${p.role ?? '—'}</td>
          <td>
            <span class="role-badge role-badge--${roleClass(p.role)}">${ACCESS_LEVELS[p.access_level] ?? `Nível ${p.access_level}`}</span>
          </td>
          <td style="text-align:right">
            <button class="btn btn--primary btn--sm btn-absorb"
                    data-id="${p.id}" data-name="${p.name.replace(/"/g,'&quot;')}">
              Absorver
            </button>
          </td>
        </tr>`)
      .join('')
    : `<tr><td colspan="4">
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
            <th>Nome</th>
            <th>Cargo</th>
            <th>Nível</th>
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
  const [profilesRes, empRes, sectorsRes] = await Promise.all([
    /* Only collaborators (level 2) can be absorbed as employees */
    supabase.from('profiles').select('id, name, role, access_level')
      .eq('access_level', 2).order('name'),
    supabase.from('employees').select('id'),
    supabase.from('sectors').select('id, name').eq('active', true).order('name'),
  ]);
  const claimedIds = new Set((empRes.data ?? []).map(e => e.id));
  _unclaimedProfiles = (profilesRes.data ?? []).filter(p => !claimedIds.has(p.id));
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

  const profile = _unclaimedProfiles.find(p => p.id === _absorbTarget);
  if (!profile) return;

  const btn = document.getElementById('absorb-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Absorvendo…'; }

  const { error } = await supabase.from('employees').insert({
    id:        profile.id,   // employees.id = profiles.id by convention (see auth.js)
    name:      profile.name,
    sector_id: sectorId,     // trigger auto-fills sector_group_id + department_id
    active:    true,
  });

  if (error) {
    toast.error('Erro ao absorver', error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Absorver'; }
    return;
  }

  closeAbsorbModal();
  toast.success(`${profile.name} absorvido com sucesso`);
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

  /* ── Org tab — level steppers ── */
  document.querySelectorAll('.level-stepper__btn').forEach(btn => {
    btn.addEventListener('click', () => {
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
