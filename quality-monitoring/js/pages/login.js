/* ============================================================
   LOGIN PAGE
   ============================================================ */
import { loginWithMicrosoft } from '../auth.js';

export function render() {
  return `
    <div class="auth-page">
      <!-- Brand Panel -->
      <div class="auth-brand">
        <img src="assets/images/logo-dark.png" alt="iGreen" class="auth-brand__logo">
        <div class="auth-brand__title">iGreen Performance</div>
        <div class="auth-brand__subtitle">Monitorias de Qualidade</div>
        <p class="auth-brand__tagline">
          Registro, análise e evolução contínua do desempenho dos seus times de atendimento.
        </p>
        <div class="auth-features">
          <div class="auth-feature">
            <div class="auth-feature__icon">📊</div>
            <span>Dashboards de performance por equipe e período</span>
          </div>
          <div class="auth-feature">
            <div class="auth-feature__icon">📋</div>
            <span>Registro detalhado de critérios qualitativos</span>
          </div>
          <div class="auth-feature">
            <div class="auth-feature__icon">🤖</div>
            <span>Análise inteligente de desvios com IA (Claude)</span>
          </div>
          <div class="auth-feature">
            <div class="auth-feature__icon">🔒</div>
            <span>Controle de acesso por nível hierárquico</span>
          </div>
        </div>
      </div>

      <!-- Form Panel -->
      <div class="auth-form-panel">
        <div class="auth-form-wrap">
          <div class="auth-form-header">
            <h1 class="auth-form-header__title">Bem-vindo de volta</h1>
            <p class="auth-form-header__subtitle">Use sua conta Microsoft para entrar</p>
          </div>

          <div id="auth-error" class="auth-error hidden">
            <span>⚠️</span>
            <span id="auth-error-msg"></span>
          </div>

          <button type="button" class="btn btn--microsoft btn--lg btn--block" id="btn-microsoft">
            <svg class="btn-microsoft__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" width="20" height="20">
              <rect x="1"  y="1"  width="9" height="9" fill="#f25022"/>
              <rect x="11" y="1"  width="9" height="9" fill="#7fba00"/>
              <rect x="1"  y="11" width="9" height="9" fill="#00a4ef"/>
              <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
            </svg>
            Entrar com Microsoft
          </button>
        </div>
      </div>
    </div>
  `;
}

export function init() {
  const errorEl  = document.getElementById('auth-error');
  const errorMsg = document.getElementById('auth-error-msg');

  document.getElementById('btn-microsoft')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-microsoft');
    btn.disabled    = true;
    btn.textContent = 'Redirecionando…';
    errorEl.classList.add('hidden');
    try {
      await loginWithMicrosoft();
    } catch (err) {
      errorEl.classList.remove('hidden');
      errorMsg.textContent = 'Erro ao iniciar login com Microsoft. Tente novamente.';
      btn.disabled    = false;
      btn.textContent = 'Entrar com Microsoft';
    }
  });
}
