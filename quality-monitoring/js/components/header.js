/* ============================================================
   HEADER — Barra superior da aplicação
   ============================================================ */
import { getCurrentUser, logout } from '../auth.js';
import { navigate } from '../router.js';
import { getInitials, monthOptions } from '../utils/formatters.js';

let _onPeriodChange = null;
let _currentPeriod  = null;

export function setOnPeriodChange(fn) { _onPeriodChange = fn; }
export function getCurrentPeriod()    { return _currentPeriod; }

export function renderHeader() {
  const user = getCurrentUser();
  if (!user) return '';

  const months = monthOptions(12);
  if (!_currentPeriod) _currentPeriod = months[0].key;

  const opts = months.map(m =>
    `<option value="${m.key}" ${m.key === _currentPeriod ? 'selected' : ''}>${m.label}</option>`
  ).join('');

  return `
    <header class="app-header">
      <a class="header-brand" href="#dashboard">
        <img src="assets/images/logo-dark.png" alt="iGreen" class="header-brand__icon">
        <div class="header-brand__text">
          <div class="header-brand__name">iGreen Performance</div>
          <div class="header-brand__sub">Monitorias de Qualidade</div>
        </div>
      </a>

      <div class="header-center">
        <div class="period-nav">
          <button class="period-nav__btn" id="period-prev">&#8249;</button>
          <select class="period-selector" id="period-selector" style="background:transparent;border:none;color:rgba(255,255,255,0.85);font-size:0.875rem;font-weight:600;cursor:pointer;min-width:140px;text-align:center;outline:none;">
            ${opts}
          </select>
          <button class="period-nav__btn" id="period-next">&#8250;</button>
        </div>
      </div>

      <div class="header-actions">
        <div class="user-badge" id="user-badge">
          <div class="user-avatar">${getInitials(user.name)}</div>
          <span class="user-badge__name truncate">${user.name.split(' ')[0]}</span>
        </div>
        <a href="#nova-monitoria" class="btn-new-monitoring">
          <span class="icon">＋</span> Monitoria
        </a>
      </div>
    </header>
  `;
}

export function bindHeader() {
  const months = monthOptions(12);

  const sel = document.getElementById('period-selector');
  if (sel) {
    sel.addEventListener('change', e => {
      _currentPeriod = e.target.value;
      _onPeriodChange?.(_currentPeriod);
    });
  }

  document.getElementById('period-prev')?.addEventListener('click', () => {
    const idx = months.findIndex(m => m.key === _currentPeriod);
    if (idx < months.length - 1) {
      _currentPeriod = months[idx + 1].key;
      if (sel) sel.value = _currentPeriod;
      _onPeriodChange?.(_currentPeriod);
    }
  });

  document.getElementById('period-next')?.addEventListener('click', () => {
    const idx = months.findIndex(m => m.key === _currentPeriod);
    if (idx > 0) {
      _currentPeriod = months[idx - 1].key;
      if (sel) sel.value = _currentPeriod;
      _onPeriodChange?.(_currentPeriod);
    }
  });

  document.getElementById('user-badge')?.addEventListener('click', () => {
    navigate('perfil', { id: getCurrentUser()?.id });
  });
}
