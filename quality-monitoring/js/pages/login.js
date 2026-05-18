/* ============================================================
   LOGIN PAGE
   ============================================================ */
import { login } from '../auth.js';
import { navigate } from '../router.js';
import { toast } from '../components/toast.js';
import { supabase } from '../supabase.js';

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

/* ── Password reset / first-access ───────── */
export function renderReset() {
  return `
    <div class="auth-page">
      <div class="auth-brand">
        <img src="assets/images/logo-dark.png" alt="iGreen" class="auth-brand__logo">
        <div class="auth-brand__title">iGreen Performance</div>
        <div class="auth-brand__subtitle">Monitorias de Qualidade</div>
        <p class="auth-brand__tagline">
          Registro, análise e evolução contínua do desempenho dos seus times de atendimento.
        </p>
      </div>

      <div class="auth-form-panel">
        <div class="auth-form-wrap">
          <div class="auth-form-header">
            <h1 class="auth-form-header__title">Defina sua senha</h1>
            <p class="auth-form-header__subtitle">Crie uma senha segura para acessar sua conta</p>
          </div>

          <form class="auth-form" id="reset-form" novalidate>
            <div id="reset-error" class="auth-error hidden">
              <span>⚠️</span>
              <span id="reset-error-msg"></span>
            </div>

            <div class="form-group">
              <label class="form-label" for="new-password">Nova senha</label>
              <div style="position:relative">
                <input class="form-input" type="password" id="new-password"
                       placeholder="Mínimo 8 caracteres" autocomplete="new-password"
                       required style="padding-right:2.5rem">
                <button type="button" class="pwd-toggle" data-target="new-password"
                        style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-tertiary)">👁</button>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="confirm-password">Confirmar senha</label>
              <div style="position:relative">
                <input class="form-input" type="password" id="confirm-password"
                       placeholder="Repita a senha" autocomplete="new-password"
                       required style="padding-right:2.5rem">
                <button type="button" class="pwd-toggle" data-target="confirm-password"
                        style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-tertiary)">👁</button>
              </div>
            </div>

            <button type="submit" class="btn btn--primary btn--lg btn--block" id="btn-reset">
              Salvar senha
            </button>
          </form>
        </div>
      </div>
    </div>`;
}

export async function initReset() {
  const form     = document.getElementById('reset-form');
  const errorEl  = document.getElementById('reset-error');
  const errorMsg = document.getElementById('reset-error-msg');

  document.querySelectorAll('.pwd-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type  = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '🐵' : '🙈';
    });
  });

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const newPass = document.getElementById('new-password').value;
    const confirm = document.getElementById('confirm-password').value;
    const btn     = document.getElementById('btn-reset');

    errorEl.classList.add('hidden');

    if (newPass.length < 8) {
      errorEl.classList.remove('hidden');
      errorMsg.textContent = 'A senha deve ter pelo menos 8 caracteres.';
      return;
    }
    if (newPass !== confirm) {
      errorEl.classList.remove('hidden');
      errorMsg.textContent = 'As senhas não coincidem.';
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Salvando…';

    try {
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) throw error;

      btn.textContent = 'Senha salva! Redirecionando…';
      // await supabase.auth.signOut();
      window.location.replace(window.location.pathname);
    } catch (err) {
      errorEl.classList.remove('hidden');
      errorMsg.textContent = err.message ?? 'Erro ao definir senha. Tente novamente.';
      btn.disabled    = false;
      btn.textContent = 'Salvar senha';
    }
  });
}
