/* ============================================================
   SIDEBAR — Navegação lateral
   ============================================================ */
import { getCurrentUser, logout } from '../auth.js';
import { navigate, getCurrentRoute } from '../router.js';
import { getInitials } from '../utils/formatters.js';
import { ACCESS_LEVELS } from '../utils/access.js';
import { getTeam, getDept } from '../data/mock.js';

export function renderSidebar() {
  const user = getCurrentUser();
  if (!user) return '';

  const team  = user.teamId ? getTeam(user.teamId)  : null;
  const dept  = user.deptId ? getDept(user.deptId) : null;
  const route = getCurrentRoute();
  const lvl   = user.accessLevel;

  const item = (id, icon, label, r) => `
    <button class="sidebar-nav__item ${route === r ? 'active' : ''}"
            data-route="${r}" id="nav-${id}">
      <span class="nav-icon">${icon}</span>${label}
    </button>
  `;

  const myTeam = `
    <div class="sidebar-nav__section">
      <div class="sidebar-nav__label">Minha Equipe</div>
      ${item('dashboard',     '📊', 'Painel',          'dashboard')}
      ${lvl >= ACCESS_LEVELS.SUPERVISOR ? item('colaboradores', '👥', 'Colaboradores', 'colaboradores') : ''}
      ${lvl >= ACCESS_LEVELS.SUPERVISOR ? item('consulta',      '🔍', 'Consulta por Associado', 'consulta') : ''}
    </div>`;

  const dados = `
    <div class="sidebar-nav__section">
      <div class="sidebar-nav__label">Dados</div>
      ${item('registros', '📋', 'Registros', 'registros')}
      ${lvl >= ACCESS_LEVELS.ANALISTA ? item('ai-analise', '🤖', 'Análise por IA', 'ai-analise') : ''}
    </div>`;

  const config = lvl >= ACCESS_LEVELS.SUPERVISOR ? `
    <div class="sidebar-nav__section">
      <div class="sidebar-nav__label">Configurações</div>
      ${item('metas', '🎯', 'Metas da Equipe', 'metas')}
      ${lvl >= ACCESS_LEVELS.GESTOR ? item('admin', '⚙️', 'Administração', 'admin') : ''}
    </div>` : '';

  return `
    <aside class="app-sidebar">
      <div class="sidebar-user">
        <div class="sidebar-avatar">${getInitials(user.name)}</div>
        <div class="sidebar-user__name">${user.name}</div>
        <div class="sidebar-user__meta">${user.title ?? ''}</div>
        <div class="sidebar-user__dept">${team ? team.name + ' · ' : ''}${dept?.name ?? ''}</div>
      </div>
      <nav class="sidebar-nav">${myTeam}${dados}${config}</nav>
      <div class="sidebar-footer">
        <button class="sidebar-footer__logout" id="btn-logout">↩ Sair</button>
      </div>
    </aside>`;
}

export function bindSidebar() {
  document.querySelectorAll('.sidebar-nav__item[data-route]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    logout();
    navigate('login');
  });
}

export function updateActiveNav() {
  const route = getCurrentRoute();
  document.querySelectorAll('.sidebar-nav__item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.route === route);
  });
}
