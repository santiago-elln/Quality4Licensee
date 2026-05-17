/* ============================================================
   LOGIN PAGE
   ============================================================ */
import { login } from '../auth.js';
import { navigate } from '../router.js';
import { toast } from '../components/toast.js';

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
            <p class="auth-form-header__subtitle">Faça login para continuar</p>
          </div>

          <form class="auth-form" id="login-form" novalidate>
            <div id="auth-error" class="auth-error hidden">
              <span>⚠️</span>
              <span id="auth-error-msg">Credenciais inválidas.</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="login-email">E-mail</label>
              <input class="form-input" type="email" id="login-email"
                     placeholder="seu@email.com" autocomplete="email" required>
            </div>

            <div class="form-group">
              <label class="form-label" for="login-password">Senha</label>
              <input class="form-input" type="password" id="login-password"
                     placeholder="••••••••" autocomplete="current-password" required>
            </div>

            <button type="submit" class="btn btn--primary btn--lg btn--block" id="btn-login">
              Entrar
            </button>
          </form>
        </div>
      </div>
    </div>
  `;
}

export function init() {
  const form     = document.getElementById('login-form');
  const errorEl  = document.getElementById('auth-error');
  const errorMsg = document.getElementById('auth-error-msg');

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-password').value;
    const btn   = document.getElementById('btn-login');

    btn.disabled    = true;
    btn.textContent = 'Entrando…';
    errorEl.classList.add('hidden');

    try {
      await login(email, pass);
      toast.success('Bem-vindo!', 'Login realizado com sucesso.');
      navigate('nova-monitoria');
    } catch (err) {
      errorEl.classList.remove('hidden');
      errorMsg.textContent = err.message;
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Entrar';
    }
  });
}
