/* ============================================================
   LOGIN PAGE
   ============================================================ */
import { login, loginAs } from '../auth.js';
import { navigate } from '../router.js';
import { toast } from '../components/toast.js';
import { MOCK_USERS } from '../data/mock.js';
import { getInitials } from '../utils/formatters.js';
import { roleClass } from '../utils/access.js';

const DEMO_USERS = [
  'user-coord-1',
  'user-gest-1',
  'user-anal-1',
  'user-sup-1',
  'collab-1',
];

export function render() {
  const demoTiles = DEMO_USERS.map(id => {
    const u = MOCK_USERS.find(x => x.id === id);
    if (!u) return '';
    return `
      <button class="demo-user-btn" data-user-id="${u.id}">
        <div class="demo-user-btn__avatar">${getInitials(u.name)}</div>
        <div>
          <div class="demo-user-btn__name">${u.name}</div>
          <div class="demo-user-btn__role">${u.title ?? u.role}</div>
        </div>
        <span class="role-badge role-badge--${roleClass(u.role)}" style="margin-left:auto">
          ${u.role}
        </span>
      </button>
    `;
  }).join('');

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

          <div class="auth-divider">ou entre como usuário de demonstração</div>

          <div class="demo-users">
            ${demoTiles}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function init() {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('auth-error');
  const errorMsg = document.getElementById('auth-error-msg');

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-password').value;
    const btn   = document.getElementById('btn-login');

    btn.disabled = true;
    btn.textContent = 'Entrando…';
    errorEl.classList.add('hidden');

    try {
      await login(email, pass);
      toast.success('Bem-vindo!', 'Login realizado com sucesso.');
      navigate('dashboard');
    } catch (err) {
      errorEl.classList.remove('hidden');
      errorMsg.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });

  document.querySelectorAll('.demo-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      loginAs(btn.dataset.userId);
      toast.success('Bem-vindo!', 'Acesso de demonstração ativado.');
      navigate('dashboard');
    });
  });
}
