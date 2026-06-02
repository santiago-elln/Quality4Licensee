/* ============================================================
   HEADER — Barra superior da aplicação
   ============================================================ */
import { getCurrentUser, getRealUser, isViewingAs } from '../auth.js';
import { navigate } from '../router.js';
import { getInitials } from '../utils/formatters.js';
import { can, P } from '../utils/permissions.js';
import { openViewAsModal } from './view-as-modal.js';

let _onPeriodChange = null;
let _currentPeriod  = null;

export function setOnPeriodChange(fn) { _onPeriodChange = fn; }
export function getCurrentPeriod()    { return _currentPeriod; }
export function setPeriod(ym) {
  _currentPeriod = ym;
  _onPeriodChange?.(_currentPeriod);
}

export function renderHeader() {
  const user     = getCurrentUser();
  const realUser = getRealUser();
  if (!user || !realUser) return '';

  const viewing  = isViewingAs();
  const canViewAs = can(realUser, P.GLOBAL_VIEW_AS);

  const badge = viewing
    ? `<div class="user-badge user-badge--view-as" id="user-badge" title="Clique para trocar visualização">
         <div class="user-avatar user-avatar--impersonate">${getInitials(user.name)}</div>
         <div class="user-badge__impersonate-info">
           <span class="user-badge__impersonate-lbl">Visualizando como</span>
           <span class="user-badge__name truncate">${user.name.split(' ')[0]}</span>
         </div>
       </div>`
    : `<div class="user-badge${canViewAs ? ' user-badge--clickable' : ''}" id="user-badge">
         <div class="user-avatar">${getInitials(user.name)}</div>
         <span class="user-badge__name truncate">${user.name.split(' ')[0]}</span>
       </div>`;

  return `
    <header class="app-header${viewing ? ' app-header--impersonate' : ''}">
      <a class="header-brand" href="#dashboard">
        <img src="assets/images/logo-dark.png" alt="iGreen" class="header-brand__icon">
        <div class="header-brand__text">
          <div class="header-brand__name">iGreen Performance</div>
          <div class="header-brand__sub">Monitorias de Qualidade</div>
        </div>
      </a>

      <div class="header-actions">
        ${badge}
      </div>
    </header>
  `;
}

export function bindHeader() {
  const realUser = getRealUser();
  document.getElementById('user-badge')?.addEventListener('click', () => {
    if (can(realUser, P.GLOBAL_VIEW_AS)) {
      openViewAsModal();
    } else {
      navigate('perfil');
    }
  });
}
