/* ============================================================
   SIDEBAR — Navegação lateral
   ============================================================ */
import { getCurrentUser, logout } from '../auth.js';
import { navigate, getCurrentRoute } from '../router.js';
import { getInitials } from '../utils/formatters.js';
import { can, P } from '../utils/permissions.js';

let _collapsed = false;

function showNavTooltip(label, anchor) {
  let tip = document.getElementById('sidebar-nav-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id        = 'sidebar-nav-tooltip';
    tip.className = 'sidebar-nav-tooltip';
    document.body.appendChild(tip);
  }
  tip.textContent = label;
  const sidebar = document.querySelector('.app-sidebar');
  const sr = sidebar?.getBoundingClientRect();
  const ar = anchor.getBoundingClientRect();
  tip.style.top  = (ar.top + ar.height / 2) + 'px';
  tip.style.left = ((sr ? sr.right : ar.right) + 10) + 'px';
  tip.classList.add('sidebar-nav-tooltip--visible');
}

function hideNavTooltip() {
  document.getElementById('sidebar-nav-tooltip')?.classList.remove('sidebar-nav-tooltip--visible');
}

function applyCollapsed() {
  document.querySelector('.app-sidebar')?.classList.toggle('app-sidebar--collapsed', _collapsed);
}

export function setSidebarCollapsed(val) {
  _collapsed = val;
  applyCollapsed();
  if (!val) hideNavTooltip();
}

const ICONS = {
  'nova-monitoria': 'writing.png',
  'consulta':       'mag-glass.png',
  'registros':      'sheet.png',
  'perfil':         'user.png',
  'escalas':        'shifts.png',
  'admin':          'gear.png',
};

export function renderSidebar() {
  const user = getCurrentUser();
  if (!user) return '';

  const route = getCurrentRoute();

  const item = (id, label, r, params = null) => `
    <button class="sidebar-nav__item ${route === r ? 'active' : ''}"
            data-route="${r}"
            ${params ? `data-params="${encodeURIComponent(JSON.stringify(params))}"` : ''}
            id="nav-${id}" data-tooltip="${label}">
      <span class="sidebar-icon"><img src="assets/images/${ICONS[id]}" alt="${label}"></span>
      <span class="sidebar-nav__item-label">${label}</span>
    </button>`;

  const sep = label => `
    <div class="sidebar-separator">
      <span class="sidebar-sep-line"></span>
      <span class="sidebar-sep-label">${label}</span>
      <span class="sidebar-sep-line-right"></span>
    </div>`;

  /* ── Minha Equipe ─────────────────────────── */
  const monitoriaItems = [
    can(user, P.NEW_MONITORING_ACCESS) && item('nova-monitoria', 'Nova Monitoria', 'nova-monitoria'),
    can(user, P.CONSULT_ACCESS)        && item('consulta',       'Consulta',        'consulta'),
    can(user, P.RECORD_ACCESS)         && item('registros',      'Registros',       'registros'),
    can(user, P.PROFILE_VIEW) && user.employeeId && item('perfil', 'Perfil', 'perfil', { id: user.employeeId }),
  ].filter(Boolean).join('');

  /* ── Operações ────────────────────────────── */
  const operacoesItems = [
    can(user, P.SHIFTS_ACCESS) && item('escalas', 'Escalas de Trabalho', 'escalas'),
  ].filter(Boolean).join('');

  /* ── Sistema ──────────────────────────────── */
  const adminItems = [
    can(user, P.ADMIN_ACCESS) && item('admin', 'Administração', 'admin'),
  ].filter(Boolean).join('');

  return `
    <aside class="app-sidebar${_collapsed ? ' app-sidebar--collapsed' : ''}">

      <button class="sidebar-toggle" id="btn-sidebar-toggle" aria-label="Toggle menu">
        <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
      </button>

      <div class="sidebar-inner">
        <div class="sidebar-avatar-wrap">
          <div class="sidebar-avatar">${getInitials(user.name)}</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${user.name}</div>
            <div class="sidebar-user-role">${user.title ?? ''}</div>
          </div>
        </div>

        <nav class="sidebar-nav">
          ${monitoriaItems ? sep('Minha Equipe') + monitoriaItems : ''}
          ${operacoesItems ? sep('Operações')    + operacoesItems : ''}
          ${adminItems     ? sep('Sistema')      + adminItems     : ''}
        </nav>

        <div class="sidebar-footer">
          <button class="sidebar-footer__logout" id="btn-logout" data-tooltip="Sair">
            <span class="sidebar-icon"><img src="assets/images/return.png" alt="Sair"></span>
            <span class="sidebar-footer__logout-label">Sair</span>
          </button>
        </div>
      </div>

    </aside>`;
}

export function bindSidebar() {
  applyCollapsed();

  document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
    _collapsed = !_collapsed;
    applyCollapsed();
    if (!_collapsed) hideNavTooltip();
  });

  document.querySelectorAll('[data-tooltip]').forEach(el => {
    el.addEventListener('mouseenter', () => {
      if (_collapsed) showNavTooltip(el.dataset.tooltip, el);
    });
    el.addEventListener('mouseleave', hideNavTooltip);
    el.addEventListener('click',      hideNavTooltip);
  });

  document.querySelectorAll('.sidebar-nav__item[data-route]').forEach(btn => {
    btn.addEventListener('click', () => {
      const params = btn.dataset.params
        ? JSON.parse(decodeURIComponent(btn.dataset.params))
        : {};
      navigate(btn.dataset.route, params);
    });
  });
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await logout();
    navigate('login');
  });
}

export function updateActiveNav() {
  const route = getCurrentRoute();
  document.querySelectorAll('.sidebar-nav__item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.route === route);
  });
}
