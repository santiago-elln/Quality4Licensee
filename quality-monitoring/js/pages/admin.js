/* ============================================================
   ADMIN — Gestão de departamentos, equipes e usuários
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { DEPARTMENTS, TEAMS, MOCK_USERS } from '../data/mock.js';
import { METRICS_CONFIG } from '../utils/access.js';
import { toast } from '../components/toast.js';
import { ACCESS_LEVELS, roleClass } from '../utils/access.js';
import { getInitials } from '../utils/formatters.js';

let _activeTab = 'org';

export function render() {
  const user = getCurrentUser();
  if (user.accessLevel < ACCESS_LEVELS.GESTOR) {
    return `<div class="empty-state"><div class="empty-state__icon">🔒</div><div class="empty-state__title">Acesso restrito</div></div>`;
  }

  return `
    <div class="page-enter">
      <div class="page-header">
        <div class="page-title">Administração</div>
        <div class="page-subtitle">Gerencie a estrutura organizacional e configurações</div>
      </div>

      <div class="admin-tabs">
        <button class="admin-tab ${_activeTab==='org'?'active':''}" data-tab="org">🏢 Organograma</button>
        <button class="admin-tab ${_activeTab==='users'?'active':''}" data-tab="users">👥 Usuários</button>
        <button class="admin-tab ${_activeTab==='metrics'?'active':''}" data-tab="metrics">🎛 Métricas &amp; Acesso</button>
      </div>

      <div id="admin-tab-content">
        ${renderTab(_activeTab, user)}
      </div>
    </div>
  `;
}

function renderTab(tab, user) {
  if (tab === 'org')     return renderOrgTab(user);
  if (tab === 'users')   return renderUsersTab(user);
  if (tab === 'metrics') return renderMetricsTab(user);
  return '';
}

function renderOrgTab(user) {
  const dept = DEPARTMENTS.find(d => d.id === user.deptId);
  const teams = TEAMS.filter(t => t.deptId === user.deptId);

  const deptMembers = MOCK_USERS.filter(u =>
    u.deptId === user.deptId && u.accessLevel >= ACCESS_LEVELS.ANALISTA
  );

  return `
    <div class="panel">
      <div class="panel__header">
        <div class="panel__title">Estrutura — ${dept?.name ?? 'Departamento'}</div>
        <button class="btn btn--primary btn--sm">+ Adicionar equipe</button>
      </div>
      <div class="panel__body">
        <!-- Dept level -->
        <div class="org-node org-node--dept" style="margin-bottom:var(--space-3)">
          <div class="org-node__content">
            <div class="org-node__avatar org-node__avatar--dept">🏢</div>
            <div class="org-node__info">
              <div class="org-node__name">${dept?.name ?? '—'}</div>
              <div class="org-node__meta">${deptMembers.length} gestores / analistas</div>
            </div>
            <div class="org-node__actions">
              <button class="btn btn--ghost btn--icon btn--sm" title="Editar">✏️</button>
            </div>
          </div>
        </div>

        <!-- Dept staff -->
        <div class="org-children" style="margin-bottom:var(--space-5)">
          ${deptMembers.map(u => `
            <div class="org-node org-node--user">
              <div class="org-node__content">
                <div class="org-node__avatar">${getInitials(u.name)}</div>
                <div class="org-node__info">
                  <div class="org-node__name">${u.name}</div>
                  <div class="org-node__meta">${u.title ?? u.role}</div>
                </div>
                <span class="role-badge role-badge--${roleClass(u.role)}">${u.role}</span>
                <div class="org-node__actions">
                  <button class="btn btn--ghost btn--icon btn--sm" title="Editar">✏️</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Teams -->
        ${teams.map(team => {
          const sup  = MOCK_USERS.find(u => u.id === team.supervisorId);
          const members = MOCK_USERS.filter(u => u.teamId === team.id && u.role === 'colaborador');
          return `
            <div style="margin-bottom:var(--space-4)">
              <div class="org-node org-node--team">
                <div class="org-node__content">
                  <div class="org-node__avatar org-node__avatar--team">👥</div>
                  <div class="org-node__info">
                    <div class="org-node__name">${team.name}</div>
                    <div class="org-node__meta">${members.length} colaboradores · Supervisor: ${sup?.name ?? '—'}</div>
                  </div>
                  <div class="org-node__actions">
                    <button class="btn btn--outline btn--sm">+ Colaborador</button>
                    <button class="btn btn--ghost btn--icon btn--sm" title="Editar">✏️</button>
                  </div>
                </div>
              </div>
              <div class="org-children">
                ${[sup, ...members].filter(Boolean).map(u => `
                  <div class="org-node org-node--user">
                    <div class="org-node__content">
                      <div class="org-node__avatar">${getInitials(u.name)}</div>
                      <div class="org-node__info">
                        <div class="org-node__name">${u.name}</div>
                        <div class="org-node__meta">${u.title ?? u.role}</div>
                      </div>
                      <span class="role-badge role-badge--${roleClass(u.role)}">${u.role}</span>
                      <div class="org-node__actions">
                        <button class="btn btn--ghost btn--icon btn--sm" title="Editar">✏️</button>
                        <button class="btn btn--danger-ghost btn--icon btn--sm" title="Remover">🗑️</button>
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderUsersTab(user) {
  const users = MOCK_USERS.filter(u => u.deptId === user.deptId)
    .sort((a, b) => b.accessLevel - a.accessLevel);

  return `
    <div class="panel">
      <div class="panel__header">
        <div class="panel__title">Usuários do Departamento</div>
        <button class="btn btn--primary btn--sm" id="btn-new-user">+ Novo Usuário</button>
      </div>
      <div>
        ${users.map(u => `
          <div class="user-list-item">
            <div class="user-list-item__avatar">${getInitials(u.name)}</div>
            <div class="user-list-item__info">
              <div class="user-list-item__name">${u.name}</div>
              <div class="user-list-item__email">${u.email}</div>
            </div>
            <div class="user-list-item__role">
              <span class="role-badge role-badge--${roleClass(u.role)}">${u.role}</span>
            </div>
            <div class="user-list-item__actions">
              <button class="btn btn--secondary btn--sm">Editar</button>
              <button class="btn btn--danger-ghost btn--sm">Remover</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderMetricsTab(user) {
  const entries = Object.entries(METRICS_CONFIG);
  const levelLabels = {
    2: 'Colaborador (2)',
    3: 'Supervisor (3)',
    4: 'Analista (4)',
    5: 'Gestor/Coord (5)',
    6: 'Admin (6)',
  };
  const levelDots = (min) => [2,3,4,5].map(lvl => `
    <div class="access-level-dot ${lvl >= min ? 'active' : 'inactive'}"
         style="background:${lvl >= min ? dotColor(lvl) : '#e5e7eb'}"></div>
  `).join('');

  return `
    <div class="panel">
      <div class="panel__header">
        <div class="panel__title">Visibilidade das Métricas por Nível de Acesso</div>
      </div>
      <div style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--border-light);display:grid;grid-template-columns:1fr auto auto;gap:var(--space-4);align-items:center">
        <div style="font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary)">Métrica</div>
        <div style="font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary)">Nível mínimo para ver dados alheios</div>
        <div style="font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary)">Indicador</div>
      </div>
      ${entries.map(([key, cfg]) => `
        <div class="metric-config-row">
          <div>
            <div class="metric-config-row__name">${cfg.name}</div>
            <div class="metric-config-row__desc">${cfg.description}</div>
          </div>
          <select class="form-select metric-config-row__lvl-select" data-metric="${key}" ${user.accessLevel < ACCESS_LEVELS.COORDENADOR ? 'disabled' : ''}>
            ${Object.entries(levelLabels).map(([v, l]) =>
              `<option value="${v}" ${cfg.min_visible_accessLvl == v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
          <div class="metric-config-row__preview">${levelDots(cfg.min_visible_accessLvl)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function dotColor(lvl) {
  return ['#6b7280','#f59e0b','#3b82f6','#8b5cf6'][lvl-2] ?? '#10b981';
}

export function init() {
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const user = getCurrentUser();
      document.getElementById('admin-tab-content').innerHTML = renderTab(_activeTab, user);
      bindTabEvents();
    });
  });
  bindTabEvents();
}

function bindTabEvents() {
  document.getElementById('btn-new-user')?.addEventListener('click', () => {
    toast.info('Em breve', 'Cadastro de usuários será conectado ao Supabase Auth.');
  });
  document.querySelectorAll('.metric-config-row__lvl-select').forEach(sel => {
    sel.addEventListener('change', () => {
      toast.success('Configuração salva', `Visibilidade atualizada (demo — sem persistência).`);
    });
  });
}
