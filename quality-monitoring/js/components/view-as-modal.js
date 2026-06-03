/* ============================================================
   VIEW-AS MODAL — SysOwner employee impersonation selector
   ============================================================ */
import { supabase }                       from '../supabase.js';
import { getRealUser, isViewingAs, clearViewAs, setViewAs } from '../auth.js';
import { getInitials }                    from '../utils/formatters.js';

let _overlay = null;

async function fetchEmployees() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, role, access_level')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

function normalizeProfile(e) {
  return { role: e.role ?? '', level: e.access_level ?? 2 };
}

function levelLabel(n) {
  const map = { 2: 'Colaborador', 3: 'Supervisor', 4: 'Analista', 5: 'Gestor', 6: 'Aux. Analista', 9: 'SysOwner' };
  return map[n] ?? `Nível ${n}`;
}

function renderItems(employees, query = '') {
  const q = query.toLowerCase().trim();
  const filtered = q ? employees.filter(e => e.name.toLowerCase().includes(q)) : employees;
  if (!filtered.length) return `<div class="va-empty">Nenhum colaborador encontrado.</div>`;
  return filtered.map(e => {
    const { role, level } = normalizeProfile(e);
    return `
      <button class="va-item" data-id="${e.id}" type="button">
        <span class="va-item__avatar">${getInitials(e.name)}</span>
        <span class="va-item__info">
          <span class="va-item__name">${e.name}</span>
          ${role ? `<span class="va-item__role">${role}</span>` : ''}
        </span>
        <span class="va-item__level">${levelLabel(level)}</span>
      </button>`;
  }).join('');
}

function close() {
  document.removeEventListener('keydown', _escHandler);
  _overlay?.remove();
  _overlay = null;
}

function dispatchChanged() {
  document.dispatchEvent(new CustomEvent('viewas:changed'));
}

export async function openViewAsModal() {
  if (_overlay) { close(); return; }

  _overlay = document.createElement('div');
  _overlay.className = 'modal-overlay view-as-overlay';
  _overlay.innerHTML = `
    <div class="modal modal--lg view-as-modal">
      <div class="modal__header">
        <span class="modal__title">Visualizar como...</span>
        <button class="modal__close" id="va-close" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="va-search-wrap">
        <svg class="va-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input class="va-search" id="va-search" placeholder="Buscar colaborador..." autocomplete="off" spellcheck="false">
      </div>
      <div class="modal__body modal__body--flush">
        <div class="va-list" id="va-list">
          <div class="va-loading">Carregando colaboradores...</div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(_overlay);

  // Close on backdrop click or Escape
  _overlay.addEventListener('click', e => { if (e.target === _overlay) close(); });
  document.addEventListener('keydown', _escHandler);
  document.getElementById('va-close')?.addEventListener('click', close);

  // Fetch employees
  let employees;
  try {
    employees = await fetchEmployees();
  } catch (err) {
    console.error('[view-as] fetchEmployees:', err);
    const list = document.getElementById('va-list');
    if (list) list.innerHTML = `<div class="va-empty">Erro ao carregar colaboradores. Tente novamente.</div>`;
    return;
  }

  const list = document.getElementById('va-list');
  if (!list) return;

  const realUser    = getRealUser();
  const ownEmpId    = realUser?.employeeId ?? null;

  function buildList(query = '') {
    const returnHtml = isViewingAs() ? `
      <button class="va-item va-item--own" type="button">
        <span class="va-item__avatar va-item__avatar--own">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </span>
        <span class="va-item__info">
          <span class="va-item__name">Retornar ao meu perfil</span>
          <span class="va-item__role">Sair da visualização</span>
        </span>
      </button>` : '';

    const empShortcutHtml = ownEmpId ? `
      <button class="va-item va-item--emp-shortcut" data-id="${ownEmpId}" type="button">
        <span class="va-item__avatar va-item__avatar--emp">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </span>
        <span class="va-item__info">
          <span class="va-item__name">Ver como Colaborador</span>
          <span class="va-item__role">Meu próprio perfil de colaborador</span>
        </span>
      </button>` : '';

    const hasTop = returnHtml || empShortcutHtml;
    const sepHtml = hasTop ? '<div class="va-separator"></div>' : '';

    list.innerHTML = returnHtml + empShortcutHtml + sepHtml + renderItems(employees, query);
  }

  buildList();

  // Single delegated listener on the list
  list.addEventListener('click', async e => {
    if (e.target.closest('.va-item--own')) {
      clearViewAs();
      close();
      dispatchChanged();
      return;
    }
    const item = e.target.closest('.va-item[data-id]');
    if (!item) return;
    item.classList.add('va-item--loading');
    try {
      await setViewAs(item.dataset.id);
    } catch (err) {
      console.error('[view-as] setViewAs:', err);
      item.classList.remove('va-item--loading');
      return;
    }
    close();
    dispatchChanged();
  });

  // Live search
  const searchEl = document.getElementById('va-search');
  searchEl?.addEventListener('input', () => buildList(searchEl.value));
  searchEl?.focus();
}

function _escHandler(e) {
  if (e.key === 'Escape' && _overlay) {
    close();
    document.removeEventListener('keydown', _escHandler);
  }
}
