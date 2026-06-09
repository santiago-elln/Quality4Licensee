/* ============================================================
   APP.JS — Entry point da SPA
   ============================================================ */
import { restoreSession, isAuthenticated, onAuthChange, getCurrentUser } from './auth.js';
import {
  initRouter, registerRoute, setDefaultRoute,
  protectRoute, navigate, getCurrentRoute,
} from './router.js';
import { renderHeader, bindHeader, setOnPeriodChange } from './components/header.js';
import { renderSidebar, bindSidebar, updateActiveNav, setSidebarCollapsed } from './components/sidebar.js';
import { destroyAll } from './components/charts.js';

/* ── Page modules ───────────────────────────── */
import * as LoginPage            from './pages/login.js';
import * as NaoAutorizadoPage    from './pages/nao-autorizado.js';
import * as DashboardPage        from './pages/dashboard.js';
import * as NovaMonitoriaPage    from './pages/nova-monitoria.js';
import * as ConsultaPage         from './pages/consulta.js';
import * as PerfilPage           from './pages/perfil.js';
import * as RegistrosPage        from './pages/registros.js';
import * as AIPage               from './pages/ai-analise.js';
import * as AdminPage            from './pages/admin.js';
import * as MetasPage            from './pages/metas.js';
import * as ComparacaoPage       from './pages/comparacao.js';
import * as EditarMonitoriaPage  from './pages/editar-monitoria.js';
import * as EscalasPage          from './pages/escalas.js';

const app = document.getElementById('app');

/* ── App Shell ──────────────────────────────── */
function mountShell() {
  app.innerHTML = `
    <div class="app-shell" id="app-shell">
      <div id="header-slot"></div>
      <div id="sidebar-slot"></div>
      <main class="app-main" id="main-content"></main>
    </div>
  `;
}

function renderShell() {
  document.getElementById('header-slot').innerHTML  = renderHeader();
  document.getElementById('sidebar-slot').innerHTML = renderSidebar();
  bindHeader();
  bindSidebar();
}

/* ── Page mount ─────────────────────────────── */
async function mountPage(page) {
  destroyAll();
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = page.render();
  updateActiveNav();
  try {
    await page.init?.();
  } catch (err) {
    console.error('[app] page init failed:', err);
    if (main.isConnected) {
      main.innerHTML = `
        <div class="page-enter" style="padding:var(--space-8)">
          <div class="empty-state">
            <div class="empty-state__icon">⚠</div>
            <div class="empty-state__title">Erro ao carregar dados</div>
            <div class="empty-state__desc">Tente recarregar a página.</div>
          </div>
        </div>`;
    }
  }
}

/* ── Default landing page by access level ───── */
function defaultPageFor(user) {
  const lvl = user?.accessLevel;
  if (lvl === 2) return 'perfil';
  if (lvl === 4) return 'nova-monitoria';
  return 'consulta';
}

/* ── Page map (used by view-as re-mount) ────── */
const PAGE_MAP = new Map([
  ['dashboard',        DashboardPage],
  ['nova-monitoria',   NovaMonitoriaPage],
  ['consulta',         ConsultaPage],
  ['perfil',           PerfilPage],
  ['registros',        RegistrosPage],
  ['ai-analise',       AIPage],
  ['admin',            AdminPage],
  ['metas',            MetasPage],
  ['comparacao',       ComparacaoPage],
  ['editar-monitoria', EditarMonitoriaPage],
  ['escalas',          EscalasPage],
]);

/* ── Routes ─────────────────────────────────── */
function registerRoutes() {
  setDefaultRoute('login');

  /* Login — redirect authenticated users */
  registerRoute('login', async () => {
    if (isAuthenticated()) {
      const u = getCurrentUser();
      navigate(u.isClaimed ? defaultPageFor(u) : 'nao-autorizado');
      return;
    }
    app.innerHTML = LoginPage.render();
    LoginPage.init?.();
  });

  /* Unclaimed — SSO users with no employee/profile row */
  protectRoute('nao-autorizado');
  registerRoute('nao-autorizado', async () => {
    const u = getCurrentUser();
    if (u?.isClaimed) { navigate(defaultPageFor(u)); return; }
    mountShell();
    renderShell();
    await mountPage(NaoAutorizadoPage);
  });

  PAGE_MAP.forEach((page, route) => {
    protectRoute(route);
    registerRoute(route, async () => {
      const u = getCurrentUser();
      /* Unclaimed users can only see the nao-autorizado page */
      if (!u?.isClaimed) { navigate('nao-autorizado'); return; }
      mountShell();
      renderShell();
      setSidebarCollapsed(route === 'escalas');
      await mountPage(page);
    });
  });
}

/* ── Period refresh ─────────────────────────── */
function setupPeriodRefresh() {
  setOnPeriodChange(() => {
    const route = getCurrentRoute();
    const map = { registros: RegistrosPage };
    const page = map[route];
    if (page) mountPage(page);
  });
}

/* ── Bootstrap ──────────────────────────────── */
async function bootstrap() {
  await restoreSession();

  onAuthChange(user => {
    if (!user && getCurrentRoute() !== 'login') {
      navigate('login');
    }
  });

  registerRoutes();
  setupPeriodRefresh();

  /* Re-render shell + current page when view-as changes */
  document.addEventListener('viewas:changed', async () => {
    const u = getCurrentUser();
    if (!u?.isClaimed) return;
    mountShell();
    renderShell();
    const route = getCurrentRoute();
    if (route) {
      setSidebarCollapsed(route === 'escalas');
      const page = PAGE_MAP.get(route);
      if (page) await mountPage(page);
    }
  });

  initRouter();
}

bootstrap();
