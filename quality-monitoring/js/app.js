/* ============================================================
   APP.JS — Entry point da SPA
   ============================================================ */
import { restoreSession, isAuthenticated, onAuthChange } from './auth.js';
import {
  initRouter, registerRoute, setDefaultRoute,
  protectRoute, navigate, getCurrentRoute,
} from './router.js';
import { renderHeader, bindHeader, setOnPeriodChange } from './components/header.js';
import { renderSidebar, bindSidebar, updateActiveNav } from './components/sidebar.js';
import { destroyAll } from './components/charts.js';

/* ── Page modules ───────────────────────────── */
import * as LoginPage          from './pages/login.js';
import * as DashboardPage      from './pages/dashboard.js';
import * as NovaMonitoriaPage  from './pages/nova-monitoria.js';
import * as ColabPage          from './pages/colaboradores.js';
import * as ConsultaPage       from './pages/consulta.js';
import * as PerfilPage         from './pages/perfil.js';
import * as RegistrosPage      from './pages/registros.js';
import * as AIPage             from './pages/ai-analise.js';
import * as AdminPage          from './pages/admin.js';
import * as MetasPage          from './pages/metas.js';
import * as ComparacaoPage     from './pages/comparacao.js';

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
  await page.init?.();
}

/* ── Routes ─────────────────────────────────── */
function registerRoutes() {
  setDefaultRoute('login');

  registerRoute('login', async () => {
    if (isAuthenticated()) { navigate('nova-monitoria'); return; }
    app.innerHTML = LoginPage.render();
    LoginPage.init?.();
  });

  const protected_ = [
    ['dashboard',      DashboardPage],
    ['nova-monitoria', NovaMonitoriaPage],
    ['colaboradores',  ColabPage],
    ['consulta',       ConsultaPage],
    ['perfil',         PerfilPage],
    ['registros',      RegistrosPage],
    ['ai-analise',     AIPage],
    ['admin',          AdminPage],
    ['metas',          MetasPage],
    ['comparacao',     ComparacaoPage],
  ];

  protected_.forEach(([route, page]) => {
    protectRoute(route);
    registerRoute(route, async () => {
      mountShell();
      renderShell();
      await mountPage(page);
    });
  });
}

/* ── Period refresh ─────────────────────────── */
function setupPeriodRefresh() {
  setOnPeriodChange(() => {
    const route = getCurrentRoute();
    const map = {
      colaboradores: ColabPage,
      registros:     RegistrosPage,
    };
    const page = map[route];
    if (page) mountPage(page);
  });
}

/* ── Bootstrap ──────────────────────────────── */
async function bootstrap() {
  /* Capture hash BEFORE restoreSession — Supabase clears it via history.replaceState */
  const hash = window.location.hash;
  const isAuthCallback = hash.includes('type=recovery') ||
                         hash.includes('type=invite')   ||
                         hash.includes('type=signup');

  await restoreSession();

  if (isAuthCallback) {
    app.innerHTML = LoginPage.renderReset();
    await LoginPage.initReset();
    return;
  }

  onAuthChange(user => {
    if (!user && getCurrentRoute() !== 'login') {
      navigate('login');
    }
  });

  registerRoutes();
  setupPeriodRefresh();
  initRouter();
}

bootstrap();
