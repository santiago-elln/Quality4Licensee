/* ============================================================
   HEADER — Barra superior da aplicação
   ============================================================ */
import { getCurrentUser, logout } from '../auth.js';
import { navigate } from '../router.js';
import { getInitials } from '../utils/formatters.js';

let _onPeriodChange = null;
let _currentPeriod  = null;

export function setOnPeriodChange(fn) { _onPeriodChange = fn; }
export function getCurrentPeriod()    { return _currentPeriod; }
export function setPeriod(ym) {
  _currentPeriod = ym;
  _onPeriodChange?.(_currentPeriod);
}

export function renderHeader() {
  const user = getCurrentUser();
  if (!user) return '';

  return `
    <header class="app-header">
      <a class="header-brand" href="#dashboard">
        <img src="assets/images/logo-dark.png" alt="iGreen" class="header-brand__icon">
        <div class="header-brand__text">
          <div class="header-brand__name">iGreen Performance</div>
          <div class="header-brand__sub">Monitorias de Qualidade</div>
        </div>
      </a>

      <div class="header-actions">
        <div class="user-badge" id="user-badge">
          <div class="user-avatar">${getInitials(user.name)}</div>
          <span class="user-badge__name truncate">${user.name.split(' ')[0]}</span>
        </div>
      </div>
    </header>
  `;
}

export function bindHeader() {
  document.getElementById('user-badge')?.addEventListener('click', () => {
    navigate('perfil', { id: getCurrentUser()?.id });
  });
}
