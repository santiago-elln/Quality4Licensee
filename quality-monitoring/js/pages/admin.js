/* ============================================================
   ADMIN — Gestão de departamentos, equipes e usuários
   ============================================================ */
import { getCurrentUser, getRealUser } from '../auth.js';
import { ACCESS_LEVELS, roleClass, roleName } from '../utils/access.js';
import { toast } from '../components/toast.js';
import { getInitials } from '../utils/formatters.js';
import { supabase } from '../supabase.js';
import { can, P, DEFAULT_PERMISSIONS_BY_LEVEL } from '../utils/permissions.js';

/* ── Module state ─────────────────────────── */
let _activeTab        = 'org';
let _catalogTab          = 'eval_criteria';
let _catalogData         = null;
let _catalogSgFilter     = null;  // selected sector_group id (null = show all)
let _copyFromSourceSgId  = null;
/* Page-level department scope for P.ADMIN_FILTER_DEPTS holders (level 9). Drives ALL
   tabs; null = fall back to the user's own department. */
let _adminDeptScope      = null;  // selected department id
let _allDepartments      = [];    // active departments, for the page-level selector & manage modal
let _deptMgrDirty        = false; // dept create/rename/deactivate happened → refresh selector on modal close
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
let _absorbStaffDepts  = null; // cached departments the current user can SELECT (staff absorb)
let _inviteTarget      = null; // { name, email } being submitted
let _newSectorData     = null; // { sectorGroups, teams, supervisors } fetched when modal opens

/* ── Level change state ───────────────────── */
let _pendingLevelChanges = {};
// { [profileId]: { newLevel, originalLevel, name, isEmployee } }
let _deactivationTarget  = null; // { profileId, name } — employee pending deactivation confirm

/* ── Team management state ────────────────── */
let _teamSupervisorTarget   = null; // { teamId, teamName }
let _teamSupervisorProfiles = [];
let _teamDeactivateTarget   = null; // { teamId, teamName, memberCount }
let _roleEditTarget         = null; // { profileId, name }

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

/* junction table metadata for the 4 sector-group-scoped tables */
const SG_JUNCTION = {
  eval_criteria:        { table: 'sector_group_eval_criteria',        col: 'eval_criteria_id',        editManual: true  },
  topic:                { table: 'sector_group_topic',                 col: 'topic_id',                editManual: false },
  error_type:           { table: 'sector_group_error_type',            col: 'error_type_id',           editManual: true  },
  analytical_note_type: { table: 'sector_group_analytical_note_type',  col: 'analytical_note_type_id', editManual: true  },
};

/* sector-group link helpers */
function _sgLinksOf(table, itemId) {
  const junc = SG_JUNCTION[table];
  if (!junc) return [];
  return (_catalogData?.sg_links?.[table] ?? [])
    .filter(l => l[junc.col] === itemId)
    .map(l => l.sector_group_id);
}

function _sgMatchFn(table) {
  const junc = SG_JUNCTION[table];
  if (!junc) return () => true;
  const links = _catalogData?.sg_links?.[table] ?? [];
  if (_catalogSgFilter) {
    const linked = new Set(links.filter(l => l.sector_group_id === _catalogSgFilter).map(l => l[junc.col]));
    return item => linked.has(item.id);
  }
  /* No specific group selected: when a department scope is active, limit items to the
     union of links across that department's sector_groups (option-1 scoping). */
  const scopeDept = catalogScopeDeptId();
  if (!scopeDept) return () => true;
  const deptSgIds = new Set((_catalogData?.sector_groups ?? [])
    .filter(sg => sg.department_id === scopeDept).map(sg => sg.id));
  const linked = new Set(links.filter(l => deptSgIds.has(l.sector_group_id)).map(l => l[junc.col]));
  return item => linked.has(item.id);
}

/* ── Department scope (page-level, P.ADMIN_FILTER_DEPTS / level 9) ─────────── */
function canFilterDepts(user) { return can(user ?? getRealUser(), P.ADMIN_FILTER_DEPTS); }

/* Effective department for Organograma: chosen page scope, else the user's own. */
function effectiveDeptId() {
  const user = getCurrentUser();
  return canFilterDepts(user) ? (_adminDeptScope ?? user.departmentId ?? null) : user.departmentId;
}

/* Catalog (Critérios) scope. null for non-filter users preserves the legacy global view. */
function catalogScopeDeptId() {
  const user = getCurrentUser();
  return canFilterDepts(user) ? (_adminDeptScope ?? user.departmentId ?? null) : null;
}

const escAttr = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function deptScopeOptionsHtml() {
  const sel = _adminDeptScope ?? getRealUser()?.departmentId ?? null;
  const placeholder = sel ? '' : `<option value="" selected disabled>Selecione um departamento…</option>`;
  return placeholder + _allDepartments
    .map(d => `<option value="${d.id}" ${d.id === sel ? 'selected' : ''}>${escAttr(d.name)}</option>`)
    .join('');
}

/* ── render() ─────────────────────────────── */
export function render() {
  const user = getRealUser();
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

      <div class="admin-tabs-row" style="position:relative">
        <div class="admin-tabs">
          ${can(user, P.ADMIN_VIEW_STRUCT) ? `
            <button class="admin-tab ${_activeTab==='org'   ? 'active':''}" data-tab="org">🏢 Organograma</button>
            <button class="admin-tab ${_activeTab==='users' ? 'active':''}" data-tab="users">👥 Usuários</button>
          ` : ''}
          <button class="admin-tab ${_activeTab==='catalog' ? 'active':''}" data-tab="catalog">📋 Critérios</button>
        </div>
        ${canFilterDepts(user) ? `
          <div class="admin-dept-scope" style="position:absolute;right:0;top:2px;display:flex;align-items:center;gap:var(--space-2)">
            <select class="form-select" id="admin-dept-scope" title="Departamento (afeta Organograma e Critérios)" style="min-width:210px">
              ${deptScopeOptionsHtml()}
            </select>
            <button class="btn btn--sm btn--ghost" id="btn-manage-depts" type="button" title="Criar, renomear ou desativar departamentos">⚙ Departamentos</button>
          </div>` : ''}
      </div>

      <div id="admin-tab-content">
        ${renderTab(_activeTab, user)}
      </div>
    </div>

    <!-- Employee deactivation confirm modal -->
    <div id="deactivation-confirm-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal modal--sm">
        <div class="modal__header">
          <div class="modal__title">Remover colaborador</div>
        </div>
        <div class="modal__body">
          <p id="deactivation-confirm-msg" style="font-size:var(--text-sm);color:var(--text-secondary)"></p>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="deactivation-cancel" type="button">Cancelar</button>
          <button class="btn btn--danger" id="deactivation-confirm" type="button">Remover</button>
        </div>
      </div>
    </div>

    ${canFilterDepts(user) ? `
    <!-- Department management modal (create / rename / deactivate) -->
    <div id="dept-mgr-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal modal--sm">
        <div class="modal__header">
          <div class="modal__title">Departamentos</div>
          <button class="modal__close" id="dept-mgr-close" type="button">✕</button>
        </div>
        <div class="modal__body">
          <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4)">
            <input id="dept-mgr-new-name" type="text" class="input" placeholder="Novo departamento…" autocomplete="off" style="flex:1">
            <button class="btn btn--primary btn--sm" id="dept-mgr-create" type="button">Criar</button>
          </div>
          <div id="dept-mgr-list"></div>
        </div>
      </div>
    </div>` : ''}

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

    <!-- Copy-from modal -->
    <div id="copy-from-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal modal--lg" style="max-height:90vh;display:flex;flex-direction:column">
        <div class="modal__header" style="flex-shrink:0">
          <div class="modal__title">Copiar itens para <span id="copy-from-target-name"></span></div>
          <button class="modal__close" id="copy-from-close" type="button">✕</button>
        </div>
        <div class="modal__body" style="display:flex;flex-direction:column;gap:var(--space-4);flex:1;overflow-y:auto;min-height:0">
          <div class="form-group" style="margin:0;flex-shrink:0">
            <label class="form-label">Copiar de</label>
            <select class="form-select" id="copy-from-source-sg">
              <option value="">— selecione um grupo —</option>
            </select>
          </div>
          <div id="copy-from-items" style="display:flex;flex-direction:column;gap:var(--space-3)"></div>
        </div>
        <div class="modal__footer" style="flex-shrink:0">
          <button class="btn btn--ghost" id="copy-from-cancel" type="button">Cancelar</button>
          <button class="btn btn--primary" id="copy-from-confirm" type="button">Copiar selecionados</button>
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
  const cfg      = CATALOG[_catalogTab];
  const allRows  = _catalogData?.[_catalogTab] ?? [];
  const scopeDept = catalogScopeDeptId();
  /* Sector-group dropdown is limited to the active department's groups (option-1 scoping) */
  const sgs      = scopeDept
    ? (_catalogData?.sector_groups ?? []).filter(sg => sg.department_id === scopeDept)
    : (_catalogData?.sector_groups ?? []);
  const hasSgScope = !!SG_JUNCTION[_catalogTab];

  /* Filter rows by selected sector_group / department (for junction-scoped tables) */
  let displayRows = hasSgScope ? allRows.filter(_sgMatchFn(_catalogTab)) : allRows;
  /* observation_type carries department_id directly — scope it to the active department */
  if (_catalogTab === 'observation_type' && scopeDept) {
    displayRows = displayRows.filter(r => r.department_id === scopeDept);
  }

  const eff = {
    canAdd:    cfg.canAdd    && canEdit,
    canEdit:   cfg.canEdit   && canEdit,
    canDelete: cfg.canDelete && canEdit,
  };

  /* eval_criteria: enrich with topic point totals for selected sg */
  let headerExtra = '';
  if (_catalogTab === 'eval_criteria') {
    const ptMap    = ecPointsMap();
    displayRows    = displayRows.map(r => ({ ...r, points: ptMap[r.id] ?? 0 }));
    const totalPts = displayRows.filter(r => r.active !== false).reduce((s, r) => s + r.points, 0);
    headerExtra    = `<span class="catalog-pts-total">${totalPts} pts total</span>`;
  }

  const rowsHtml = displayRows.length
    ? displayRows.map(r => renderCatalogRow({ ...cfg, ...eff }, r)).join('')
    : `<div class="catalog-empty">Nenhum registro encontrado${_catalogSgFilter ? ' para este grupo' : ''}.</div>`;

  const sgFilterBar = hasSgScope ? `
    <div class="catalog-dept-filter">
      <span class="catalog-dept-filter__label">Grupo de Setor</span>
      <select class="form-select catalog-dept-filter__select" id="catalog-sg-filter">
        <option value="">Todos os grupos</option>
        ${sgs.map(sg => `<option value="${sg.id}" ${sg.id === _catalogSgFilter ? 'selected' : ''}>${sg.name}</option>`).join('')}
      </select>
      ${canEdit && _catalogSgFilter ? `
        <button class="btn btn--ghost btn--sm" id="catalog-copy-from-btn" title="Copiar itens de outro grupo">
          Copiar de…
        </button>` : ''}
    </div>` : '';

  return `
    ${sgFilterBar}
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

  /* Sector-group badges (for junction-scoped tables) */
  const junc = SG_JUNCTION[_catalogTab];
  let scopeBadges = '';
  if (junc) {
    const sgIds  = _sgLinksOf(_catalogTab, row.id);
    const sgs    = _catalogData?.sector_groups ?? [];
    scopeBadges  = sgIds.length
      ? sgIds.map(id => {
          const sg = sgs.find(s => s.id === id);
          return sg ? `<span class="badge catalog-badge--dept">${sg.name}</span>` : '';
        }).join('')
      : `<span class="badge catalog-badge--global">Sem grupo</span>`;
  } else {
    const depts    = _catalogData?.departments ?? [];
    const deptName = row.department_id ? (depts.find(d => d.id === row.department_id)?.name ?? '?') : null;
    scopeBadges    = deptName
      ? `<span class="badge catalog-badge--dept">${deptName}</span>`
      : `<span class="badge catalog-badge--global">Global</span>`;
  }

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
      <div class="catalog-row__badges">${pointsBadge}${criticalBadge}${scopeBadges}${activeBadge}</div>
      <div class="catalog-row__actions">${editBtn}${toggleBtn}</div>
    </div>
  `;
}

/* ── Points helpers ───────────────────────── */
function ecPointsMap() {
  const match = _sgMatchFn('topic');
  const map = {};
  for (const t of _catalogData?.topic ?? []) {
    if (!t.active || !match(t)) continue;
    map[t.eval_criteria_id] = (map[t.eval_criteria_id] ?? 0) + (t.points ?? 0);
  }
  return map;
}

/* ── Catalog data ─────────────────────────── */
async function fetchCatalog() {
  const [ecRes, topicRes, obsRes, errRes, analRes, deptRes, sgRes,
         sgEcRes, sgTopicRes, sgErrRes, sgAnalRes] = await Promise.all([
    supabase.from('eval_criteria').select('id, name, active').order('name'),
    supabase.from('topic').select('id, item, description, points, eval_criteria_id, active').order('item'),
    supabase.from('observation_type').select('id, code, display_name, active, department_id').order('display_name'),
    supabase.from('error_type').select('id, name, critical, active').order('name'),
    supabase.from('analytical_note_type').select('id, name, active').order('name'),
    supabase.from('departments').select('id, name').eq('active', true).order('name'),
    supabase.from('sector_groups').select('id, name, department_id').order('name'),
    supabase.from('sector_group_eval_criteria').select('sector_group_id, eval_criteria_id'),
    supabase.from('sector_group_topic').select('sector_group_id, topic_id'),
    supabase.from('sector_group_error_type').select('sector_group_id, error_type_id'),
    supabase.from('sector_group_analytical_note_type').select('sector_group_id, analytical_note_type_id'),
  ]);
  _catalogData = {
    eval_criteria:        ecRes.data    ?? [],
    topic:                topicRes.data ?? [],
    observation_type:     obsRes.data   ?? [],
    error_type:           errRes.data   ?? [],
    analytical_note_type: analRes.data  ?? [],
    departments:          deptRes.data  ?? [],
    sector_groups:        sgRes.data    ?? [],
    sg_links: {
      eval_criteria:        sgEcRes.data    ?? [],
      topic:                sgTopicRes.data ?? [],
      error_type:           sgErrRes.data   ?? [],
      analytical_note_type: sgAnalRes.data  ?? [],
    },
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

  const sgMatch = _sgMatchFn('topic');

  const totalPts = (_catalogData?.topic ?? [])
    .filter(t => t.active && sgMatch(t))
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
  const ecMatch        = _sgMatchFn('eval_criteria');
  const activeCriteria = (_catalogData?.eval_criteria ?? []).filter(ec => ec.active && ecMatch(ec));
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
  const colsHtml = cfg.columns.filter(c => !c.readonly).map(col => {
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

  /* Sector-group multi-select for manually-managed junction tables */
  const junc = SG_JUNCTION[_editState?.table];
  let sgHtml = '';
  if (junc?.editManual) {
    const sgs    = _catalogData?.sector_groups ?? [];
    const linked = row ? new Set(_sgLinksOf(_editState.table, row.id)) : new Set();
    const opts   = sgs.map(sg => `
      <label class="check-item" style="display:flex;align-items:center;gap:var(--space-2);padding:3px 0">
        <input type="checkbox" name="ef-sg-link" value="${sg.id}" ${linked.has(sg.id) ? 'checked' : ''}>
        <span>${sg.name}</span>
      </label>`).join('');
    sgHtml = `
      <div class="form-group">
        <label class="form-label">Grupos de Setor</label>
        <div id="ef-sg-links" style="border:1px solid var(--border);border-radius:var(--radius-sm);
             padding:var(--space-2);max-height:160px;overflow-y:auto">
          ${opts || '<span style="color:var(--text-tertiary);font-size:var(--text-sm)">Nenhum grupo cadastrado</span>'}
        </div>
      </div>`;
  }

  return colsHtml + sgHtml;
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
    let itemId = row?.id;
    if (row) {
      const { error } = await supabase.from(table).update(data).eq('id', row.id);
      if (error) throw error;
      const idx = _catalogData[table].findIndex(r => r.id === row.id);
      if (idx !== -1) _catalogData[table][idx] = { ...row, ...data };
    } else {
      const { data: inserted, error } = await supabase.from(table).insert(data).select().single();
      if (error) throw error;
      itemId = inserted.id;
      _catalogData[table].push(inserted);
      _catalogData[table].sort((a, b) => (cfg.display(a) ?? '').localeCompare(cfg.display(b) ?? ''));
    }

    /* Sync sector-group junction rows */
    const junc = SG_JUNCTION[table];
    if (junc && itemId) {
      if (junc.editManual) {
        /* Manual: read checkboxes and diff against current links */
        const checked  = [...document.querySelectorAll('#ef-sg-links input[name="ef-sg-link"]:checked')];
        const newSgIds = new Set(checked.map(cb => cb.value));
        const oldSgIds = new Set(row ? _sgLinksOf(table, itemId) : []);

        const toAdd    = [...newSgIds].filter(id => !oldSgIds.has(id));
        const toRemove = [...oldSgIds].filter(id => !newSgIds.has(id));

        if (toAdd.length) {
          await supabase.from(junc.table).insert(toAdd.map(sgId => ({ sector_group_id: sgId, [junc.col]: itemId })));
          for (const sgId of toAdd) _catalogData.sg_links[table].push({ sector_group_id: sgId, [junc.col]: itemId });
        }
        for (const sgId of toRemove) {
          await supabase.from(junc.table).delete().eq('sector_group_id', sgId).eq(junc.col, itemId);
        }
        if (toRemove.length) {
          _catalogData.sg_links[table] = _catalogData.sg_links[table]
            .filter(l => !(l[junc.col] === itemId && toRemove.includes(l.sector_group_id)));
        }
      } else {
        /* Auto-inherit: derive sector groups from parent (topic → eval_criteria) */
        const criteriaId  = data.eval_criteria_id ?? row?.eval_criteria_id;
        const parentSgIds = (_catalogData?.sg_links?.eval_criteria ?? [])
          .filter(l => l.eval_criteria_id === criteriaId)
          .map(l => l.sector_group_id);
        const existing    = new Set(_sgLinksOf(table, itemId));
        const toAdd       = parentSgIds.filter(id => !existing.has(id));
        const toRemove    = [...existing].filter(id => !parentSgIds.includes(id));

        if (toAdd.length) {
          await supabase.from(junc.table).insert(toAdd.map(sgId => ({ sector_group_id: sgId, [junc.col]: itemId })));
          for (const sgId of toAdd) _catalogData.sg_links[table].push({ sector_group_id: sgId, [junc.col]: itemId });
        }
        for (const sgId of toRemove) {
          await supabase.from(junc.table).delete().eq('sector_group_id', sgId).eq(junc.col, itemId);
        }
        if (toRemove.length) {
          _catalogData.sg_links[table] = _catalogData.sg_links[table]
            .filter(l => !(l[junc.col] === itemId && toRemove.includes(l.sector_group_id)));
        }
      }
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
  const btn = document.getElementById('catalog-deact-confirm');
  if (btn) { btn.disabled = false; btn.textContent = 'Desativar'; }
  _deactState = null;
}

/* ── Event binding ─────────────────────────── */
function bindCatalogContentEvents() {
  document.getElementById('catalog-sg-filter')?.addEventListener('change', e => {
    _catalogSgFilter = e.target.value || null;
    refreshCatalogContent();
  });

  document.getElementById('catalog-copy-from-btn')?.addEventListener('click', openCopyFromModal);

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

/* ── Copy-from modal ──────────────────────── */
function openCopyFromModal() {
  if (!_catalogSgFilter) return;
  _copyFromSourceSgId = null;
  const targetSg = (_catalogData?.sector_groups ?? []).find(sg => sg.id === _catalogSgFilter);
  const modal    = document.getElementById('copy-from-modal');
  if (!modal) return;

  modal.querySelector('#copy-from-target-name').textContent = targetSg?.name ?? '—';

  const sgs  = (_catalogData?.sector_groups ?? []).filter(sg => sg.id !== _catalogSgFilter);
  const opts = sgs.map(sg => `<option value="${sg.id}">${sg.name}</option>`).join('');
  const sel  = modal.querySelector('#copy-from-source-sg');
  if (sel) sel.innerHTML = `<option value="">— selecione —</option>${opts}`;

  modal.querySelector('#copy-from-items').innerHTML = '';
  modal.classList.remove('modal-overlay--hidden');
}

function closeCopyFromModal() {
  document.getElementById('copy-from-modal')?.classList.add('modal-overlay--hidden');
  _copyFromSourceSgId = null;
}

function renderCopyFromItems(sourceSgId) {
  const container = document.getElementById('copy-from-items');
  if (!container) return;
  if (!sourceSgId) { container.innerHTML = ''; return; }

  const tables = [
    { key: 'eval_criteria',        label: 'Critérios de Avaliação', display: r => r.name },
    { key: 'topic',                label: 'Tópicos',                display: r => `${r.item} — ${(_catalogData?.eval_criteria.find(c => c.id === r.eval_criteria_id))?.name ?? '?'}` },
    { key: 'error_type',           label: 'Tipos de Erro',          display: r => r.name },
    { key: 'analytical_note_type', label: 'Critérios Analíticos',   display: r => r.name },
  ];

  const targetLinked = {}; // table → Set of item ids already in target group
  for (const { key } of tables) {
    const junc = SG_JUNCTION[key];
    targetLinked[key] = new Set(
      (_catalogData?.sg_links?.[key] ?? [])
        .filter(l => l.sector_group_id === _catalogSgFilter)
        .map(l => l[junc.col])
    );
  }

  const sectionsHtml = tables.map(({ key, label, display }) => {
    const junc        = SG_JUNCTION[key];
    const sourceItems = (_catalogData?.sg_links?.[key] ?? [])
      .filter(l => l.sector_group_id === sourceSgId)
      .map(l => (_catalogData?.[key] ?? []).find(r => r.id === l[junc.col]))
      .filter(Boolean);

    if (!sourceItems.length) return '';

    const rows = sourceItems.map(r => {
      const already = targetLinked[key].has(r.id);
      return `
        <label class="check-item" style="display:flex;align-items:flex-start;gap:var(--space-2);padding:3px 0;
               ${already ? 'opacity:.45' : ''}">
          <input type="checkbox" data-table="${key}" data-id="${r.id}" style="flex-shrink:0;margin-top:2px"
                 ${already ? 'disabled checked' : 'checked'}>
          <span style="font-size:var(--text-sm);min-width:0;word-break:break-word">${display(r)}</span>
          ${already ? '<span style="font-size:10px;color:var(--text-tertiary);white-space:nowrap;margin-left:auto;padding-left:var(--space-2)">já existe</span>' : ''}
        </label>`;
    }).join('');

    return `
      <div class="copy-from-section">
        <div class="copy-from-section__header">
          <span>${label} (${sourceItems.length})</span>
          <button class="btn btn--ghost btn--sm copy-from-toggle-all" data-table="${key}" type="button">Desmarcar todos</button>
        </div>
        <div class="copy-from-section__rows">${rows}</div>
      </div>`;
  }).join('');

  container.innerHTML = sectionsHtml || '<p style="color:var(--text-tertiary);font-size:var(--text-sm)">Nenhum item encontrado neste grupo.</p>';

  /* Toggle-all buttons */
  container.querySelectorAll('.copy-from-toggle-all').forEach(btn => {
    btn.addEventListener('click', () => {
      const tbl      = btn.dataset.table;
      const boxes    = [...container.querySelectorAll(`input[data-table="${tbl}"]:not(:disabled)`)];
      const allCheck = boxes.every(cb => cb.checked);
      boxes.forEach(cb => { cb.checked = !allCheck; });
      btn.textContent = allCheck ? 'Marcar todos' : 'Desmarcar todos';
    });
  });
}

async function confirmCopyFrom() {
  if (!_catalogSgFilter || !_copyFromSourceSgId) return;
  const btn = document.getElementById('copy-from-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Copiando…'; }

  try {
    const container = document.getElementById('copy-from-items');
    const checked   = [...(container?.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)') ?? [])];

    /* Group by table */
    const byTable = {};
    for (const cb of checked) {
      const t = cb.dataset.table;
      if (!byTable[t]) byTable[t] = [];
      byTable[t].push(cb.dataset.id);
    }

    for (const [table, ids] of Object.entries(byTable)) {
      const junc = SG_JUNCTION[table];
      if (!junc || !ids.length) continue;
      const rows = ids.map(id => ({ sector_group_id: _catalogSgFilter, [junc.col]: id }));
      const { error } = await supabase.from(junc.table).insert(rows).select();
      if (error) throw error;
      for (const id of ids) {
        _catalogData.sg_links[table].push({ sector_group_id: _catalogSgFilter, [junc.col]: id });
      }
    }

    const total = Object.values(byTable).reduce((s, arr) => s + arr.length, 0);
    toast.success('Itens copiados', `${total} item(ns) adicionado(s) ao grupo.`);
    closeCopyFromModal();
    refreshCatalogContent();
  } catch (err) {
    toast.error('Erro ao copiar', err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Copiar selecionados'; }
  }
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

  document.getElementById('deactivation-cancel')?.addEventListener('click', () => {
    _deactivationTarget = null;
    document.getElementById('deactivation-confirm-modal')?.classList.add('modal-overlay--hidden');
  });
  document.getElementById('deactivation-confirm')?.addEventListener('click', confirmDeactivateEmployee);
  document.getElementById('deactivation-confirm-modal')?.addEventListener('click',
    e => { if (e.target.id === 'deactivation-confirm-modal') {
      _deactivationTarget = null;
      document.getElementById('deactivation-confirm-modal').classList.add('modal-overlay--hidden');
    }});

  document.getElementById('copy-from-close')?.addEventListener('click',   closeCopyFromModal);
  document.getElementById('copy-from-cancel')?.addEventListener('click',  closeCopyFromModal);
  document.getElementById('copy-from-confirm')?.addEventListener('click', confirmCopyFrom);
  document.getElementById('copy-from-modal')?.addEventListener('click',
    e => { if (e.target.id === 'copy-from-modal') closeCopyFromModal(); });
  document.getElementById('copy-from-source-sg')?.addEventListener('change', e => {
    _copyFromSourceSgId = e.target.value || null;
    renderCopyFromItems(_copyFromSourceSgId);
  });
}

/* ── Org tab data load ────────────────────── */
async function loadOrgTabData() {
  const user      = getCurrentUser();
  const isGlobal  = can(user, P.ADMIN_GLOBAL_VIEW) && can(user, P.CROSS_DEPT_VIEW);
  /* Filter-capable users (level 9) can point the tree at any department via the
     page-level scope; everyone else is pinned to their own. */
  const deptId    = effectiveDeptId();

  /* supervisedTeamIds already resolved by buildUser() — no extra query needed */
  const supervisedTeamIds = isGlobal ? null : (user.supervisedTeamIds ?? []);

  /* ── Step 1: resolve teams
     teams have no direct department_id — they link via sector_group_id → sector_groups.
     Global: resolve sector_groups for the dept first, then fetch their teams.
     Non-global: fetch supervised teams directly by ID. */
  let allTeams = [];
  if (deptId) {
    /* Both global and non-global users with a deptId see all department teams.
       This lets supervisors drag employees across sector_group boundaries. */
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
    /* Fallback for supervisors without a department_id: show supervised teams only. */
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
    deptId
      ? supabase.from('profiles')
          .select('id, name, role, access_level')
          .eq('department_id', deptId)
          .gte('access_level', isGlobal ? 3 : 4)
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
  const canManage   = can(currentUser, P.ADMIN_CREATE_GROUPS);
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
    if (!fromTeam) continue;
    if (!ghostsByTeam[t.to_team_id]) ghostsByTeam[t.to_team_id] = [];
    // emp may be null for the receiving supervisor (RLS hides source-team employees)
    const empResolved = emp ?? { id: t.employee_id, name: t.employee_name ?? '?' };
    ghostsByTeam[t.to_team_id].push({ transfer: t, emp: empResolved, fromTeam });
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
        <span class="role-badge role-badge--${roleClass(u.role)}${canManage && !isSelf ? ' org-role-edit-btn' : ''}"
              ${canManage && !isSelf ? `data-id="${u.id}" data-name="${u.name.replace(/"/g,'&quot;')}" data-role="${u.role ?? ''}" title="Clique para alterar cargo"` : ''}>${u.role ?? '—'}</span>
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

    const safeName   = team.name.replace(/"/g, '&quot;');
    const canManage  = can(currentUser, P.ADMIN_CREATE_GROUPS);
    const manageHtml = canManage ? `
      <button class="btn btn--ghost btn--sm org-team-edit-sup-btn"
              data-team-id="${team.id}" data-team-name="${safeName}"
              type="button" title="Alterar supervisor">✎</button>
      <button class="btn btn--ghost btn--sm btn--danger-text org-team-deactivate-btn"
              data-team-id="${team.id}" data-team-name="${safeName}"
              data-member-count="${team.members.length}"
              type="button" title="Desativar equipe">✕</button>` : '';

    return `
      <div class="org-team-block org-team-block--collapsed" id="org-team-${team.id}" data-drop-team-id="${team.id}">
        <div class="org-node org-node--team"><div class="org-node__content">
          <div class="org-node__avatar org-node__avatar--team">👥</div>
          <div class="org-node__info">
            <div class="org-node__name">${team.name}</div>
            <div class="org-node__meta">
              ${team.members.length} colaboradores
              · Supervisor: ${team.supervisorName}
            </div>
          </div>
          ${manageHtml}
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
        ${can(currentUser, P.ADMIN_CREATE_GROUPS) ? `<button class="btn btn--sm btn--primary" id="btn-new-sector" type="button">+ Novo Setor</button>` : ''}
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

    ${can(currentUser, P.ADMIN_CREATE_GROUPS) ? `
    <!-- Team supervisor change modal -->
    <div id="team-supervisor-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal modal--sm">
        <div class="modal__header">
          <div class="modal__title">Alterar Supervisor</div>
          <button class="modal__close" id="team-sup-close" type="button">✕</button>
        </div>
        <div class="modal__body">
          <p id="team-sup-msg" style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-4)"></p>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Novo supervisor <span style="color:var(--error)">*</span></label>
            <select id="team-sup-select" class="form-select">
              <option value="">— carregando —</option>
            </select>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="team-sup-cancel" type="button">Cancelar</button>
          <button class="btn btn--primary" id="team-sup-confirm" type="button">Salvar</button>
        </div>
      </div>
    </div>

    <!-- Team deactivate modal -->
    <div id="team-deactivate-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal modal--sm">
        <div class="modal__header">
          <div class="modal__title">Desativar Equipe</div>
          <button class="modal__close" id="team-deact-close" type="button">✕</button>
        </div>
        <div class="modal__body">
          <p id="team-deact-msg" style="font-size:var(--text-sm);color:var(--text-secondary)"></p>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="team-deact-cancel" type="button">Cancelar</button>
          <button class="btn btn--danger" id="team-deact-confirm" type="button">Desativar</button>
        </div>
      </div>
    </div>

    <!-- New sector modal -->
    <div id="new-sector-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal modal--sm">
        <div class="modal__header">
          <div class="modal__title">Novo Setor</div>
          <button class="modal__close" id="new-sector-close" type="button">✕</button>
        </div>
        <div class="modal__body">

          <div class="form-field" style="margin-bottom:var(--space-4)">
            <label class="form-label">Nome do setor <span style="color:var(--error)">*</span></label>
            <input id="ns-name" type="text" class="input" placeholder="Ex.: Atendimento Premium" autocomplete="off">
          </div>

          <div class="form-field" style="margin-bottom:var(--space-4)">
            <label class="form-label" style="margin-bottom:var(--space-2)">Equipe</label>
            <div style="display:flex;gap:var(--space-5);margin-bottom:var(--space-3)">
              <label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm)"><input type="radio" name="ns-team-mode" value="none" checked> Nenhuma</label>
              <label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm)"><input type="radio" name="ns-team-mode" value="existing"> Existente</label>
              <label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm)"><input type="radio" name="ns-team-mode" value="new"> Criar nova</label>
            </div>
            <div id="ns-team-existing-wrap" style="display:none">
              <select id="ns-team-select" class="input"><option value="">Selecione a equipe…</option></select>
            </div>
            <div id="ns-team-new-wrap" style="display:none">
              <div style="margin-bottom:var(--space-3)">
                <label class="form-label" style="font-size:var(--text-xs)">Nome da equipe <span style="color:var(--error)">*</span></label>
                <input id="ns-team-name" type="text" class="input" placeholder="Nome da nova equipe" autocomplete="off">
              </div>
              <div style="margin-bottom:var(--space-4)">
                <label class="form-label" style="font-size:var(--text-xs)">Supervisor <span style="color:var(--error)">*</span></label>
                <select id="ns-team-supervisor" class="input"><option value="">Selecione o supervisor…</option></select>
              </div>
              <div style="border-top:1px solid var(--border);padding-top:var(--space-3)">
                <label class="form-label" style="font-size:var(--text-xs);margin-bottom:var(--space-2)">Grupo de setor da equipe</label>
                <div style="display:flex;gap:var(--space-5);margin-bottom:var(--space-3)">
                  <label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm)"><input type="radio" name="ns-sg-mode" value="existing" checked> Existente</label>
                  <label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm)"><input type="radio" name="ns-sg-mode" value="new"> Criar novo</label>
                </div>
                <div id="ns-sg-existing-wrap" style="display:none">
                  <select id="ns-sg-select" class="input"><option value="">Selecione o grupo…</option></select>
                </div>
                <div id="ns-sg-new-wrap" style="display:none">
                  <input id="ns-sg-name" type="text" class="input" placeholder="Nome do novo grupo de setor" autocomplete="off">
                </div>
              </div>
            </div>
          </div>

        </div>
        <div class="modal__footer">
          <button id="new-sector-cancel" class="btn btn--ghost" type="button">Cancelar</button>
          <button id="new-sector-confirm" class="btn btn--primary" type="button">Criar Setor</button>
        </div>
      </div>
    </div>` : ''}

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

    <!-- Role edit modal -->
    <div id="role-edit-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal modal--sm">
        <div class="modal__header">
          <div class="modal__title">Alterar Cargo</div>
          <button class="modal__close" id="role-edit-close" type="button">✕</button>
        </div>
        <div class="modal__body">
          <p id="role-edit-msg" style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-4)"></p>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Cargo <span style="color:var(--error)">*</span></label>
            <select id="role-edit-select" class="form-select">
              <option value="">— selecione —</option>
              <option value="colaborador">Colaborador</option>
              <option value="supervisor">Supervisor</option>
              <option value="supervisora">Supervisora</option>
              <option value="analista">Analista</option>
              <option value="gestor">Gestor</option>
              <option value="gestora">Gestora</option>
              <option value="coordenador">Coordenador</option>
              <option value="coordenadora">Coordenadora</option>
              <option value="admin">Admin</option>
              <option value="sysowner">SysOwner</option>
              <option value="VIP">VIP</option>
            </select>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="role-edit-cancel" type="button">Cancelar</button>
          <button class="btn btn--primary" id="role-edit-confirm" type="button">Salvar</button>
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
async function confirmDeactivateEmployee() {
  if (!_deactivationTarget) return;
  const { profileId, name } = _deactivationTarget;
  const btn = document.getElementById('deactivation-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Removendo…'; }
  try {
    const { error: e1 } = await supabase.from('employees').update({
      active:     false,
      team_id:    null,
    }).eq('id', profileId);
    if (e1) throw e1;

    /* Remove profile so auth access is revoked */
    await supabase.from('profiles').delete().eq('id', profileId);

    _deactivationTarget = null;
    document.getElementById('deactivation-confirm-modal')?.classList.add('modal-overlay--hidden');
    toast.success('Colaborador removido', name);
    _orgData = null;
    await loadOrgTabData();
    document.getElementById('admin-tab-content').innerHTML = renderTab('org', getCurrentUser());
    bindTabEvents();
  } catch (err) {
    console.error('[admin] deactivate employee:', err);
    toast.error('Erro ao remover colaborador', err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Remover'; }
  }
}

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

function renderUsersTab(user) {
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

  /* Absorb-as-staff (level 7+): create a profile instead of an employee. Gated on the
     REAL user — RLS runs under their JWT, not the view-as user. */
  const realUser    = getRealUser();
  const canStaff    = can(realUser, P.ADMIN_MANAGE_STAFF);
  const creatorLvl  = realUser?.accessLevel ?? 2;
  /* Derive the assignable staff levels from the defined permission tiers (single source of
     truth): every level that maps to a permission set, from 3 (supervisor — level 2 is the
     collaborator/employee path) up to the creator's own level (anti-escalation, mirrors the RLS policy). */
  const staffLevels = Object.keys(DEFAULT_PERMISSIONS_BY_LEVEL)
    .map(Number)
    .filter(lvl => lvl >= 3 && lvl <= creatorLvl)
    .sort((a, b) => a - b);
  const staffLevelOpts = staffLevels
    .map((lvl, i) => `<option value="${lvl}" ${i === 0 ? 'selected' : ''}>${lvl} — ${roleName(lvl)}</option>`)
    .join('');

  const inviteBtn = can(user, P.ADMIN_INVITE_USER)
    ? `<button class="btn btn--ghost btn--sm" id="btn-invite-user">+ Convidar usuário</button>`
    : '';

  return `
    <div class="panel">
      <div class="panel__header">
        <div class="panel__title">Usuários sem vínculo</div>
        <span class="badge badge--neutral">${_unclaimedProfiles.length}</span>
        ${inviteBtn}
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
            <strong id="absorb-name" style="color:var(--text-primary)"></strong> será vinculado ao sistema.
          </p>

          ${canStaff ? `
          <div class="form-group">
            <label class="form-label">Tipo de vínculo</label>
            <div style="display:flex;gap:var(--space-5)">
              <label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm)"><input type="radio" name="absorb-mode" value="collab" checked> Colaborador</label>
              <label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm)"><input type="radio" name="absorb-mode" value="staff"> Equipe / Staff</label>
            </div>
          </div>` : ''}

          <div id="absorb-collab-fields">
            <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:var(--space-3)">
              Registrado como colaborador. O setor define automaticamente o grupo e o departamento. O vínculo com equipe pode ser configurado posteriormente.
            </p>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Setor <span class="required">*</span></label>
              <select class="form-select" id="absorb-sector">
                <option value="">— selecione —</option>
                ${sectorOpts}
              </select>
            </div>
          </div>

          ${canStaff ? `
          <div id="absorb-staff-fields" style="display:none">
            <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:var(--space-3)">
              Registrado como membro de equipe (perfil), permitindo criar setores, grupos e equipes no departamento.
            </p>
            <div class="form-group">
              <label class="form-label">Nível de acesso <span class="required">*</span></label>
              <select class="form-select" id="absorb-staff-level">${staffLevelOpts}</select>
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Departamento <span class="required">*</span></label>
              <select class="form-select" id="absorb-staff-dept"><option value="">— carregando —</option></select>
            </div>
          </div>` : ''}
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="absorb-cancel">Cancelar</button>
          <button class="btn btn--primary" id="absorb-confirm">Absorver</button>
        </div>
      </div>
    </div>

    <!-- ── Invite user modal ── -->
    <div id="invite-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal">
        <div class="modal__header">
          <div class="modal__title">Convidar usuário</div>
          <button class="modal__close" id="invite-close">✕</button>
        </div>
        <div class="modal__body">
          <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-4)">
            O convite será registrado. O usuário receberá acesso ao sistema após a confirmação.
          </p>
          <div class="form-group">
            <label class="form-label">Nome <span class="required">*</span></label>
            <input class="form-input" type="text" id="invite-name" placeholder="Nome completo" autocomplete="off" />
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">E-mail <span class="required">*</span></label>
            <input class="form-input" type="email" id="invite-email" placeholder="email@exemplo.com" autocomplete="off" />
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="invite-cancel">Cancelar</button>
          <button class="btn btn--primary" id="invite-confirm">Convidar</button>
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
  const sectorSel = document.getElementById('absorb-sector');
  if (sectorSel) sectorSel.value = '';
  /* reset to collaborator mode each open */
  const collabRadio = document.querySelector('input[name="absorb-mode"][value="collab"]');
  if (collabRadio) collabRadio.checked = true;
  setAbsorbMode('collab');
  if (document.getElementById('absorb-staff-dept')) populateAbsorbStaffDepts();
  document.getElementById('absorb-modal')?.classList.remove('modal-overlay--hidden');
}

function setAbsorbMode(mode) {
  const collab = document.getElementById('absorb-collab-fields');
  const staff  = document.getElementById('absorb-staff-fields');
  if (collab) collab.style.display = mode === 'staff' ? 'none' : '';
  if (staff)  staff.style.display  = mode === 'staff' ? '' : 'none';
}

/* Departments the current user can SELECT (RLS: own dept, or all for level 9), cached. */
async function populateAbsorbStaffDepts() {
  const sel = document.getElementById('absorb-staff-dept');
  if (!sel) return;
  if (!_absorbStaffDepts) {
    const { data } = await supabase.from('departments').select('id, name').eq('active', true).order('name');
    _absorbStaffDepts = data ?? [];
  }
  sel.innerHTML = _absorbStaffDepts.length
    ? `<option value="">— selecione —</option>` +
      _absorbStaffDepts.map(d => `<option value="${d.id}">${escAttr(d.name)}</option>`).join('')
    : `<option value="">— nenhum departamento disponível —</option>`;
}

function closeAbsorbModal() {
  _absorbTarget = null;
  document.getElementById('absorb-modal')?.classList.add('modal-overlay--hidden');
}

async function absorbUser() {
  const authUser = _unclaimedProfiles.find(p => p.id === _absorbTarget);
  if (!authUser) return;
  const mode = document.querySelector('input[name="absorb-mode"]:checked')?.value ?? 'collab';
  const btn  = document.getElementById('absorb-confirm');

  /* ── Staff path: create a profile (RLS authorizes level + department) ── */
  if (mode === 'staff') {
    const lvl    = Number(document.getElementById('absorb-staff-level')?.value);
    const deptId = document.getElementById('absorb-staff-dept')?.value || null;
    if (!lvl)    { toast.warning('Atenção', 'Selecione o nível de acesso.'); return; }
    if (!deptId) { toast.warning('Atenção', 'Selecione o departamento.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Absorvendo…'; }

    const { error, count } = await supabase.from('profiles').insert({
      id:               authUser.id,
      name:             authUser.name,
      role:             'supervisor',
      access_level:     lvl,
      department_id:    deptId,
      filter_by:        lvl === 3 ? 'supervisor' : 'department',
      shifts_filter_by: lvl === 3 ? 'group' : 'department',
    }, { count: 'exact' });

    if (error || count === 0) {
      toast.error('Erro ao absorver', error?.message ?? 'Sem permissão para criar este perfil.');
      if (btn) { btn.disabled = false; btn.textContent = 'Absorver'; }
      return;
    }
    closeAbsorbModal();
    toast.success(`${authUser.name} adicionado como staff`);
    await loadUsersTabData();
    document.getElementById('admin-tab-content').innerHTML = renderTab('users', getCurrentUser());
    bindTabEvents();
    return;
  }

  /* ── Collaborator path: create an employee + default shift ── */
  const sectorId = document.getElementById('absorb-sector')?.value;
  if (!sectorId) { toast.warning('Atenção', 'Selecione um setor.'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Absorvendo…'; }

  /* Resolve sector → team → sector_group → department */
  const { data: sectorRow } = await supabase
    .from('sectors')
    .select('id, team_id, teams(sector_group_id, sector_groups(department_id))')
    .eq('id', sectorId)
    .single();
  const sectorGroupId = sectorRow?.teams?.sector_group_id ?? null;
  const departmentId  = sectorRow?.teams?.sector_groups?.department_id ?? null;

  const { error } = await supabase.from('employees').insert({
    id:             authUser.id,
    name:           authUser.name,
    sector_id:      sectorId,
    sector_group_id: sectorGroupId,
    active:         true,
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

  /* Page-level department scope (level 9): load the department list, fill the
     selector (render() ran before this fetch), and bind its events once. */
  if (canFilterDepts(getRealUser())) {
    if (!_allDepartments.length) await refreshAllDepartments();
    const sel = document.getElementById('admin-dept-scope');
    if (sel) sel.innerHTML = deptScopeOptionsHtml();
    bindDeptScopeEvents();
  }

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
      try {
        if (_activeTab === 'org')   await loadOrgTabData();
        if (_activeTab === 'users') await loadUsersTabData();
        document.getElementById('admin-tab-content').innerHTML = renderTab(_activeTab, getCurrentUser());
        bindTabEvents();
        if (_activeTab === 'catalog') await initCatalogData();
      } catch (err) {
        console.error('[admin] tab load:', err);
        const content = document.getElementById('admin-tab-content');
        if (content) content.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:200px">
            <div class="empty-state">
              <div class="empty-state__icon">⚠</div>
              <div class="empty-state__title">Erro ao carregar</div>
              <div class="empty-state__desc">Tente novamente.</div>
            </div>
          </div>`;
      }
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
  const user = getRealUser();
  const btn  = document.getElementById('transfer-req-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Solicitando…'; }
  try {
    const { error } = await supabase.from('team_transfers').insert({
      id:            crypto.randomUUID(),
      employee_id:   empId,
      employee_name: _transferDragState.empName,
      from_team_id:  fromTeamId,
      to_team_id:    toTeamId,
      requested_by:  user.id,
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
  const empName  = emp?.name ?? transfer.employee_name ?? '—';

  const msg = document.getElementById('transfer-resolve-msg');
  if (msg) msg.innerHTML = `O supervisor <strong>${fromTeam?.supervisorName ?? '—'}</strong> deseja transferir <strong>${empName}</strong> para a equipe <strong>${toTeam?.name ?? '—'}</strong>.`;

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

  const user = getRealUser();
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
  const user = getRealUser();
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

function openInviteModal() {
  const nameEl  = document.getElementById('invite-name');
  const emailEl = document.getElementById('invite-email');
  if (nameEl)  nameEl.value  = '';
  if (emailEl) emailEl.value = '';
  document.getElementById('invite-modal')?.classList.remove('modal-overlay--hidden');
  nameEl?.focus();
}

function closeInviteModal() {
  document.getElementById('invite-modal')?.classList.add('modal-overlay--hidden');
}

async function inviteUser() {
  const name  = document.getElementById('invite-name')?.value.trim()  ?? '';
  const email = document.getElementById('invite-email')?.value.trim() ?? '';
  if (!name)  { toast.warning('Atenção', 'Informe o nome do usuário.'); return; }
  if (!email) { toast.warning('Atenção', 'Informe o e-mail do usuário.'); return; }

  const btn = document.getElementById('invite-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }

  const emailLower = email.toLowerCase();

  const alreadyUnclaimed = _unclaimedProfiles.some(p => p.email?.toLowerCase() === emailLower);
  if (alreadyUnclaimed) {
    toast.warning('E-mail já cadastrado', 'Este e-mail já possui uma conta no sistema aguardando vínculo.');
    if (btn) { btn.disabled = false; btn.textContent = 'Convidar'; }
    return;
  }

  const { data: hasAccount } = await supabase.rpc('email_has_account', { lookup_email: emailLower });
  if (hasAccount) {
    toast.warning('E-mail já cadastrado', 'Este e-mail já possui uma conta ativa no sistema.');
    if (btn) { btn.disabled = false; btn.textContent = 'Convidar'; }
    return;
  }

  const cooldownCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: recentInvite } = await supabase
    .from('user_invitations').select('id').ilike('email', emailLower)
    .gte('created_at', cooldownCutoff).maybeSingle();

  if (recentInvite) {
    toast.warning('Convite duplicado', 'Um convite já foi enviado para este e-mail. Verifique o e-mail e caixa de spam, ou aguarde um pouco antes de tentar enviar novamente.');
    if (btn) { btn.disabled = false; btn.textContent = 'Convidar'; }
    return;
  }

  if (btn) btn.textContent = 'Convidando…';

  const { error: fnError } = await supabase.functions.invoke('invite-user', {
    body: { email: emailLower, name },
  });

  if (fnError) {
    let message = fnError.message;
    try { ({ error: message } = await fnError.context.json()); } catch { /* keep original */ }
    toast.error('Erro ao enviar convite', message);
    if (btn) { btn.disabled = false; btn.textContent = 'Convidar'; }
    return;
  }

  await supabase.from('user_invitations').insert({ email: emailLower, name });

  if (btn) { btn.disabled = false; btn.textContent = 'Convidar'; }
  closeInviteModal();
  toast.success('Convite enviado', `Um e-mail de convite foi enviado para ${emailLower}.`);
}

/* ── Team supervisor change ───────────────── */
async function openTeamSupervisorModal(teamId, teamName) {
  _teamSupervisorTarget = { teamId, teamName };
  const deptId = effectiveDeptId();  // scoped department (own dept for non-filter users)

  const msg = document.getElementById('team-sup-msg');
  if (msg) msg.innerHTML = `Selecione o novo supervisor para a equipe <strong>${teamName}</strong>.`;

  const sel = document.getElementById('team-sup-select');
  if (sel) sel.innerHTML = '<option value="">— carregando —</option>';
  document.getElementById('team-supervisor-modal')?.classList.remove('modal-overlay--hidden');

  const { data: profiles } = await (deptId
    ? supabase.from('profiles').select('id, name').eq('department_id', deptId).gte('access_level', 3).order('name')
    : supabase.from('profiles').select('id, name').gte('access_level', 3).order('name'));

  _teamSupervisorProfiles = profiles ?? [];
  const team = _orgData?.teams.find(t => t.id === teamId);

  if (sel) {
    sel.innerHTML = '<option value="">— selecione —</option>' +
      _teamSupervisorProfiles.map(p =>
        `<option value="${p.id}" ${p.id === team?.supervisorId ? 'selected' : ''}>${p.name}</option>`
      ).join('');
  }
}

function closeTeamSupervisorModal() {
  document.getElementById('team-supervisor-modal')?.classList.add('modal-overlay--hidden');
  _teamSupervisorTarget   = null;
  _teamSupervisorProfiles = [];
}

async function submitTeamSupervisorChange() {
  const supervisorId = document.getElementById('team-sup-select')?.value;
  if (!supervisorId) { toast.warning('Atenção', 'Selecione um supervisor.'); return; }
  if (!_teamSupervisorTarget) return;

  const { teamId, teamName } = _teamSupervisorTarget;
  const btn = document.getElementById('team-sup-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }

  try {
    const { error } = await supabase.from('teams').update({ supervisor_id: supervisorId }).eq('id', teamId);
    if (error) throw error;
    toast.success('Supervisor alterado', teamName);
    closeTeamSupervisorModal();
    _orgData = null;
    await loadOrgTabData();
    document.getElementById('admin-tab-content').innerHTML = renderTab('org', getCurrentUser());
    bindTabEvents();
  } catch (err) {
    toast.error('Erro ao alterar supervisor', err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
  }
}

/* ── Team deactivation ────────────────────── */
function openTeamDeactivateModal(teamId, teamName, memberCount) {
  _teamDeactivateTarget = { teamId, teamName, memberCount };
  const msg        = document.getElementById('team-deact-msg');
  const confirmBtn = document.getElementById('team-deact-confirm');

  if (memberCount > 0) {
    if (msg) msg.innerHTML =
      `A equipe <strong>${teamName}</strong> possui <strong>${memberCount} colaborador${memberCount !== 1 ? 'es' : ''}</strong>. ` +
      `Transfira todos os colaboradores para outra equipe antes de desativar.`;
    if (confirmBtn) confirmBtn.style.display = 'none';
  } else {
    if (msg) msg.innerHTML =
      `Desativar a equipe <strong>${teamName}</strong>? Os setores vinculados também serão desativados. ` +
      `Esta ação pode ser revertida manualmente.`;
    if (confirmBtn) confirmBtn.style.display = '';
  }

  document.getElementById('team-deactivate-modal')?.classList.remove('modal-overlay--hidden');
}

function closeTeamDeactivateModal() {
  document.getElementById('team-deactivate-modal')?.classList.add('modal-overlay--hidden');
  _teamDeactivateTarget = null;
}

/* ── Role edit modal ──────────────────────── */
function openRoleEditModal(profileId, name, currentRole) {
  _roleEditTarget = { profileId, name };
  const msg = document.getElementById('role-edit-msg');
  if (msg) msg.innerHTML = `Selecione o cargo de <strong>${name}</strong>.`;
  const sel = document.getElementById('role-edit-select');
  if (sel) sel.value = currentRole ?? '';
  document.getElementById('role-edit-modal')?.classList.remove('modal-overlay--hidden');
}

function closeRoleEditModal() {
  document.getElementById('role-edit-modal')?.classList.add('modal-overlay--hidden');
  _roleEditTarget = null;
}

async function submitRoleEdit() {
  if (!_roleEditTarget) return;
  const { profileId, name } = _roleEditTarget;
  const role = document.getElementById('role-edit-select')?.value;
  if (!role) { toast.warning('Atenção', 'Selecione um cargo.'); return; }

  const btn = document.getElementById('role-edit-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }

  const { error } = await supabase.from('profiles').update({ role }).eq('id', profileId);
  if (error) {
    toast.error('Erro ao alterar cargo', error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
    return;
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
  closeRoleEditModal();
  toast.success('Cargo atualizado', `${name} agora é ${role}.`);
  _orgData = null;
  await loadOrgTabData();
  document.getElementById('admin-tab-content').innerHTML = renderTab('org', getCurrentUser());
  bindTabEvents();
}

async function confirmTeamDeactivate() {
  if (!_teamDeactivateTarget) return;
  const { teamId, teamName } = _teamDeactivateTarget;
  const btn = document.getElementById('team-deact-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Desativando…'; }

  try {
    const { error: e1 } = await supabase.from('sectors').update({ active: false }).eq('team_id', teamId);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from('teams').update({ active: false }).eq('id', teamId);
    if (e2) throw e2;
    toast.success('Equipe desativada', teamName);
    closeTeamDeactivateModal();
    _orgData = null;
    await loadOrgTabData();
    document.getElementById('admin-tab-content').innerHTML = renderTab('org', getCurrentUser());
    bindTabEvents();
  } catch (err) {
    toast.error('Erro ao desativar equipe', err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Desativar'; }
  }
}

/* ── New sector modal ─────────────────────── */
async function openNewSectorModal() {
  const deptId = effectiveDeptId();  // scoped department (own dept for non-filter users)

  document.getElementById('ns-name').value = '';
  document.getElementById('ns-team-name').value = '';
  document.getElementById('ns-sg-name').value = '';
  document.querySelector('input[name="ns-team-mode"][value="none"]').checked = true;
  document.querySelector('input[name="ns-sg-mode"][value="existing"]').checked = true;
  _refreshNewSectorConditionals();

  const btn = document.getElementById('new-sector-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Carregando…'; }

  const [sgRes, teamRes, supRes] = await Promise.all([
    deptId
      ? supabase.from('sector_groups').select('id, name').eq('department_id', deptId).order('name')
      : supabase.from('sector_groups').select('id, name').order('name'),
    supabase.from('teams').select('id, name, sector_group_id').eq('active', true).order('name'),
    deptId
      ? supabase.from('profiles').select('id, name').eq('department_id', deptId).gte('access_level', 3).order('name')
      : supabase.from('profiles').select('id, name').gte('access_level', 3).order('name'),
  ]);

  _newSectorData = {
    sectorGroups: sgRes.data  ?? [],
    teams:        teamRes.data ?? [],
    supervisors:  supRes.data  ?? [],
  };

  const sgOpts   = _newSectorData.sectorGroups.map(sg => `<option value="${sg.id}">${sg.name}</option>`).join('');
  const teamOpts = _newSectorData.teams.map(t => {
    const sg = _newSectorData.sectorGroups.find(s => s.id === t.sector_group_id);
    return `<option value="${t.id}">${t.name}${sg ? ` (${sg.name})` : ''}</option>`;
  }).join('');
  const supOpts  = _newSectorData.supervisors.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

  document.getElementById('ns-sg-select').innerHTML   = `<option value="">Selecione o grupo…</option>${sgOpts}`;
  document.getElementById('ns-team-select').innerHTML = `<option value="">Selecione a equipe…</option>${teamOpts}`;
  document.getElementById('ns-team-supervisor').innerHTML = `<option value="">Selecione o supervisor…</option>${supOpts}`;

  if (btn) { btn.disabled = false; btn.textContent = 'Criar Setor'; }
  document.getElementById('new-sector-modal')?.classList.remove('modal-overlay--hidden');
  document.getElementById('ns-name')?.focus();
}

function closeNewSectorModal() {
  document.getElementById('new-sector-modal')?.classList.add('modal-overlay--hidden');
  _newSectorData = null;
}

function _refreshNewSectorConditionals() {
  const teamMode = document.querySelector('input[name="ns-team-mode"]:checked')?.value ?? 'none';
  document.getElementById('ns-team-existing-wrap').style.display = teamMode === 'existing' ? '' : 'none';
  document.getElementById('ns-team-new-wrap').style.display      = teamMode === 'new'      ? '' : 'none';

  const sgMode = document.querySelector('input[name="ns-sg-mode"]:checked')?.value ?? 'existing';
  document.getElementById('ns-sg-existing-wrap').style.display = sgMode === 'existing' ? '' : 'none';
  document.getElementById('ns-sg-new-wrap').style.display      = sgMode === 'new'      ? '' : 'none';
}

async function submitNewSector() {
  const sectorName = document.getElementById('ns-name')?.value.trim();
  if (!sectorName) {
    document.getElementById('ns-name')?.focus();
    toast.error('Campo obrigatório', 'Informe o nome do setor.');
    return;
  }

  const teamMode = document.querySelector('input[name="ns-team-mode"]:checked')?.value ?? 'none';
  const btn      = document.getElementById('new-sector-confirm');
  let   teamId   = null;

  if (btn) { btn.disabled = true; btn.textContent = 'Criando…'; }

  try {
    if (teamMode === 'existing') {
      teamId = document.getElementById('ns-team-select')?.value || null;
      if (!teamId) { toast.error('Campo obrigatório', 'Selecione uma equipe.'); return; }

    } else if (teamMode === 'new') {
      const teamName     = document.getElementById('ns-team-name')?.value.trim();
      const supervisorId = document.getElementById('ns-team-supervisor')?.value || null;
      if (!teamName)     { toast.error('Campo obrigatório', 'Informe o nome da nova equipe.'); return; }
      if (!supervisorId) { toast.error('Campo obrigatório', 'Selecione um supervisor para a equipe.'); return; }

      const sgMode = document.querySelector('input[name="ns-sg-mode"]:checked')?.value ?? 'existing';
      let sectorGroupId = null;

      if (sgMode === 'existing') {
        sectorGroupId = document.getElementById('ns-sg-select')?.value || null;
        if (!sectorGroupId) { toast.error('Campo obrigatório', 'Selecione um grupo de setor.'); return; }
      } else if (sgMode === 'new') {
        const sgName = document.getElementById('ns-sg-name')?.value.trim();
        if (!sgName) { toast.error('Campo obrigatório', 'Informe o nome do novo grupo de setor.'); return; }
        const { data: newSg, error: sgErr } = await supabase
          .from('sector_groups')
          .insert({ name: sgName, department_id: effectiveDeptId() })
          .select('id').single();
        if (sgErr) throw sgErr;
        sectorGroupId = newSg.id;
      }

      const { data: newTeam, error: teamErr } = await supabase
        .from('teams')
        .insert({ name: teamName, supervisor_id: supervisorId, sector_group_id: sectorGroupId })
        .select('id').single();
      if (teamErr) throw teamErr;
      teamId = newTeam.id;
    }

    const { error: sectorErr } = await supabase
      .from('sectors')
      .insert({ name: sectorName, team_id: teamId });
    if (sectorErr) throw sectorErr;

    toast.success('Setor criado', sectorName);
    closeNewSectorModal();
    _orgData = null;
    await loadOrgTabData();
    document.getElementById('admin-tab-content').innerHTML = renderTab('org', getCurrentUser());
    bindTabEvents();
  } catch (err) {
    console.error('[admin] new sector:', err);
    toast.error('Erro ao criar', err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Criar Setor'; }
  }
}

/* ── Department scope selector + management (page level) ──────────────────── */
async function refreshAllDepartments() {
  const { data } = await supabase
    .from('departments').select('id, name').eq('active', true).order('name');
  _allDepartments = data ?? [];
  _absorbStaffDepts = null;  // dept list changed → absorb-staff selector refetches on next open
}

/* Re-run the active tab against the current department scope. */
async function reloadActiveScopedTab() {
  _catalogSgFilter = null;  // the previous group belongs to a different department
  if (_activeTab === 'org') {
    _orgData = null; _pendingLevelChanges = {};
    document.getElementById('admin-tab-content').innerHTML = renderTab('org', getCurrentUser());
    try { await loadOrgTabData(); } catch (err) { console.error('[admin] scoped org load:', err); toast.error('Erro ao carregar departamento'); }
    document.getElementById('admin-tab-content').innerHTML = renderTab('org', getCurrentUser());
    bindTabEvents();
  } else if (_activeTab === 'catalog') {
    refreshCatalogContent();
  }
  /* users tab is global (unclaimed auth users) — unaffected by department scope */
}

function bindDeptScopeEvents() {
  document.getElementById('admin-dept-scope')?.addEventListener('change', async e => {
    _adminDeptScope = e.target.value || null;
    await reloadActiveScopedTab();
  });
  document.getElementById('btn-manage-depts')?.addEventListener('click', openDeptManageModal);
  document.getElementById('dept-mgr-close')?.addEventListener('click', closeDeptManageModal);
  document.getElementById('dept-mgr-modal')?.addEventListener('click',
    e => { if (e.target.id === 'dept-mgr-modal') closeDeptManageModal(); });
  document.getElementById('dept-mgr-create')?.addEventListener('click', createDept);
  document.getElementById('dept-mgr-list')?.addEventListener('click', e => {
    const ren = e.target.closest('.dept-mgr-rename');
    if (ren) { renameDept(ren.dataset.id); return; }
    const del = e.target.closest('.dept-mgr-deact');
    if (del) { deactivateDept(del.dataset.id, del.dataset.name); return; }
  });
}

function renderDeptMgrList() {
  const el = document.getElementById('dept-mgr-list');
  if (!el) return;
  el.innerHTML = _allDepartments.length
    ? _allDepartments.map(d => `
      <div class="dept-mgr-row" data-id="${d.id}"
           style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) 0;border-bottom:1px solid var(--border)">
        <input class="input dept-mgr-name" value="${escAttr(d.name)}" data-id="${d.id}" style="flex:1">
        <button class="btn btn--ghost btn--sm dept-mgr-rename" data-id="${d.id}" type="button">Renomear</button>
        <button class="btn btn--ghost btn--sm dept-mgr-deact" data-id="${d.id}" data-name="${escAttr(d.name)}" type="button" title="Desativar">🗑</button>
      </div>`).join('')
    : `<div class="catalog-empty">Nenhum departamento ativo.</div>`;
}

function openDeptManageModal() {
  _deptMgrDirty = false;
  renderDeptMgrList();
  const input = document.getElementById('dept-mgr-new-name');
  if (input) input.value = '';
  document.getElementById('dept-mgr-modal')?.classList.remove('modal-overlay--hidden');
}

async function closeDeptManageModal() {
  document.getElementById('dept-mgr-modal')?.classList.add('modal-overlay--hidden');
  if (!_deptMgrDirty) return;
  _deptMgrDirty = false;
  /* Department list changed → refresh the page-level selector and reload the scoped tab. */
  const sel = document.getElementById('admin-dept-scope');
  if (sel) sel.innerHTML = deptScopeOptionsHtml();
  await reloadActiveScopedTab();
}

async function createDept() {
  const input = document.getElementById('dept-mgr-new-name');
  const name  = input?.value.trim();
  if (!name) { input?.focus(); toast.error('Campo obrigatório', 'Informe o nome do departamento.'); return; }
  const btn = document.getElementById('dept-mgr-create');
  if (btn) { btn.disabled = true; btn.textContent = 'Criando…'; }
  try {
    const { error } = await supabase.from('departments').insert({ name, active: true });
    if (error) throw error;
    await refreshAllDepartments();
    _deptMgrDirty = true;
    renderDeptMgrList();
    if (input) input.value = '';
    toast.success('Departamento criado', name);
  } catch (err) {
    console.error('[admin] create dept:', err);
    toast.error('Erro ao criar', err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Criar'; }
  }
}

async function renameDept(id) {
  const input   = document.querySelector(`.dept-mgr-name[data-id="${id}"]`);
  const name    = input?.value.trim();
  const current = _allDepartments.find(d => d.id === id)?.name;
  if (!name) { input?.focus(); toast.error('Campo obrigatório', 'Informe o nome do departamento.'); return; }
  if (name === current) return;
  try {
    const { error } = await supabase.from('departments').update({ name }).eq('id', id);
    if (error) throw error;
    await refreshAllDepartments();
    _deptMgrDirty = true;
    renderDeptMgrList();
    toast.success('Departamento renomeado', name);
  } catch (err) {
    console.error('[admin] rename dept:', err);
    toast.error('Erro ao renomear', err.message);
  }
}

async function deactivateDept(id, name) {
  const btn = document.querySelector(`.dept-mgr-deact[data-id="${id}"]`);
  /* Two-step inline confirm so a single misclick can't deactivate a department. */
  if (btn && btn.dataset.armed !== '1') {
    document.querySelectorAll('.dept-mgr-deact[data-armed="1"]').forEach(b => { b.dataset.armed = '0'; b.textContent = '🗑'; });
    btn.dataset.armed = '1';
    btn.textContent = 'Confirmar?';
    return;
  }
  try {
    const { error } = await supabase.from('departments').update({ active: false }).eq('id', id);
    if (error) throw error;
    if (_adminDeptScope === id) _adminDeptScope = null;  // the viewed department is gone → reset scope
    await refreshAllDepartments();
    _deptMgrDirty = true;
    renderDeptMgrList();
    toast.success('Departamento desativado', name);
  } catch (err) {
    console.error('[admin] deactivate dept:', err);
    toast.error('Erro ao desativar', err.message);
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
  document.querySelectorAll('input[name="absorb-mode"]').forEach(r =>
    r.addEventListener('change', e => setAbsorbMode(e.target.value)));

  document.getElementById('btn-invite-user')?.addEventListener('click', openInviteModal);
  document.getElementById('invite-close')?.addEventListener('click', closeInviteModal);
  document.getElementById('invite-cancel')?.addEventListener('click', closeInviteModal);
  document.getElementById('invite-modal')?.addEventListener('click',
    e => { if (e.target.id === 'invite-modal') closeInviteModal(); });
  document.getElementById('invite-confirm')?.addEventListener('click', inviteUser);

  /* ── Org tab — team supervisor change ── */
  document.querySelectorAll('.org-team-edit-sup-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openTeamSupervisorModal(btn.dataset.teamId, btn.dataset.teamName);
    });
  });
  document.getElementById('team-sup-close')?.addEventListener('click', closeTeamSupervisorModal);
  document.getElementById('team-sup-cancel')?.addEventListener('click', closeTeamSupervisorModal);
  document.getElementById('team-supervisor-modal')?.addEventListener('click',
    e => { if (e.target.id === 'team-supervisor-modal') closeTeamSupervisorModal(); });
  document.getElementById('team-sup-confirm')?.addEventListener('click', submitTeamSupervisorChange);

  /* ── Org tab — team deactivation ── */
  document.querySelectorAll('.org-team-deactivate-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openTeamDeactivateModal(btn.dataset.teamId, btn.dataset.teamName, Number(btn.dataset.memberCount));
    });
  });
  document.getElementById('team-deact-close')?.addEventListener('click', closeTeamDeactivateModal);
  document.getElementById('team-deact-cancel')?.addEventListener('click', closeTeamDeactivateModal);
  document.getElementById('team-deactivate-modal')?.addEventListener('click',
    e => { if (e.target.id === 'team-deactivate-modal') closeTeamDeactivateModal(); });
  document.getElementById('team-deact-confirm')?.addEventListener('click', confirmTeamDeactivate);

  /* ── Org tab — role edit ── */
  document.querySelectorAll('.org-role-edit-btn').forEach(badge => {
    badge.addEventListener('click', () =>
      openRoleEditModal(badge.dataset.id, badge.dataset.name, badge.dataset.role));
  });
  document.getElementById('role-edit-close')?.addEventListener('click', closeRoleEditModal);
  document.getElementById('role-edit-cancel')?.addEventListener('click', closeRoleEditModal);
  document.getElementById('role-edit-modal')?.addEventListener('click',
    e => { if (e.target.id === 'role-edit-modal') closeRoleEditModal(); });
  document.getElementById('role-edit-confirm')?.addEventListener('click', submitRoleEdit);

  /* ── Org tab — new sector ── */
  document.getElementById('btn-new-sector')?.addEventListener('click', openNewSectorModal);
  document.getElementById('new-sector-close')?.addEventListener('click', closeNewSectorModal);
  document.getElementById('new-sector-cancel')?.addEventListener('click', closeNewSectorModal);
  document.getElementById('new-sector-modal')?.addEventListener('click',
    e => { if (e.target.id === 'new-sector-modal') closeNewSectorModal(); });
  document.getElementById('new-sector-confirm')?.addEventListener('click', submitNewSector);
  document.querySelectorAll('input[name="ns-team-mode"]').forEach(r => r.addEventListener('change', _refreshNewSectorConditionals));
  document.querySelectorAll('input[name="ns-sg-mode"]').forEach(r => r.addEventListener('change', _refreshNewSectorConditionals));

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
      const user          = getRealUser();
      const maxLevel      = user?.accessLevel ?? 2;

      const pending           = _pendingLevelChanges[profileId];
      let currentDisplayLevel = pending ? pending.newLevel : originalLevel;

      if (btn.dataset.action === 'inc') {
        if (currentDisplayLevel >= maxLevel) return;
        currentDisplayLevel++;
      } else {
        if (currentDisplayLevel <= 2) {
          /* Trying to go below level 2 — trigger deactivation flow */
          if (!isEmployee) return; // only valid for employee rows
          _deactivationTarget = { profileId, name };
          const msg = document.getElementById('deactivation-confirm-msg');
          if (msg) msg.innerHTML =
            `Esta ação removerá <strong>${name}</strong> de todas as equipes e revogará o acesso à plataforma. ` +
            `O registro do colaborador será inativado. Deseja continuar?`;
          document.getElementById('deactivation-confirm-modal')?.classList.remove('modal-overlay--hidden');
          return;
        }
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
