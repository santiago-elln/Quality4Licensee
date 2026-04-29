/* ============================================================
   COLABORADORES — Grid de colaboradores da equipe
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { navigate } from '../router.js';
import {
  getCollabsForViewer, getMonitorias, getMonitoriaStats,
  TEAMS, getTeam,
} from '../data/mock.js';
import { formatPct, resultBand, scoreColor, monthOptions, getInitials } from '../utils/formatters.js';
import { getCurrentPeriod } from '../components/header.js';
import { ACCESS_LEVELS } from '../utils/access.js';

export function render() {
  const user = getCurrentUser();
  const period = getCurrentPeriod() ?? monthOptions(1)[0].key;
  const collabs = getCollabsForViewer(user).filter(c => c.role === 'colaborador');

  /* Group by team */
  const byTeam = {};
  collabs.forEach(c => {
    const key = c.teamId ?? 'no-team';
    if (!byTeam[key]) byTeam[key] = [];
    byTeam[key].push(c);
  });

  const teamBlocks = Object.entries(byTeam).map(([teamId, members]) => {
    const team = getTeam(teamId);
    const cards = members.map(c => {
      const mons = getMonitorias({ colaboradorId: c.id, month: period });
      const stats = getMonitoriaStats(mons);
      const band  = resultBand(stats.avgPct ?? 0);
      const color = scoreColor(stats.avgPct ?? 0);
      const initials = getInitials(c.name);
      return `
        <div class="collab-card" data-collab="${c.id}">
          <div class="collab-card__header">
            <div class="collab-card__avatar">${initials}</div>
            <div>
              <div class="collab-card__name">${c.name}</div>
              <div class="collab-card__team">${team?.name ?? '—'}</div>
            </div>
          </div>
          <div class="collab-card__body">
            <div class="collab-card__metrics">
              <div class="collab-metric">
                <div class="collab-metric__val">${stats.count}</div>
                <div class="collab-metric__lbl">Monitorias</div>
              </div>
              <div class="collab-metric">
                <div class="collab-metric__val" style="color:${color}">${stats.count ? stats.avgPct + '%' : '—'}</div>
                <div class="collab-metric__lbl">Aproveit.</div>
              </div>
              <div class="collab-metric">
                <div class="collab-metric__val">${stats.count ? stats.ptsLost : '—'}</div>
                <div class="collab-metric__lbl">Pts perdidos</div>
              </div>
              <div class="collab-metric">
                <div class="collab-metric__val">${stats.count ? stats.zeroed : '—'}</div>
                <div class="collab-metric__lbl">Zeradas</div>
              </div>
            </div>
            <div class="collab-card__score-bar" style="margin-top:var(--space-3)">
              <div class="collab-card__score-fill"
                   style="width:${stats.avgPct ?? 0}%;background:${color}"></div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:var(--space-2)">
              <span class="badge badge--${band.cls}">${band.label}</span>
              <span style="font-size:var(--text-xs);color:var(--text-secondary)">
                ${stats.count ? 'ver perfil →' : 'sem dados'}
              </span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="margin-bottom:var(--space-6)">
        ${team ? `<h3 style="font-size:var(--text-md);font-weight:700;color:var(--text-primary);margin-bottom:var(--space-3)">${team.name}</h3>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--space-4)">
          ${cards}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="page-enter">
      <div class="page-header">
        <div class="page-title">Colaboradores</div>
        <div class="page-subtitle">
          ${collabs.length} colaborador${collabs.length !== 1 ? 'es' : ''} · ${monthOptions(12).find(m => m.key === period)?.label ?? period}
        </div>
      </div>

      <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-5);align-items:center">
        <div class="search-input-wrap" style="flex:1;max-width:320px">
          <span class="search-icon">🔍</span>
          <input class="form-input" id="search-collab" placeholder="Buscar colaborador…">
        </div>
        ${user.accessLevel >= ACCESS_LEVELS.SUPERVISOR ? `
          <select class="form-select" id="filter-team" style="max-width:200px">
            <option value="">Todas as equipes</option>
            ${TEAMS.filter(t => t.deptId === user.deptId).map(t =>
              `<option value="${t.id}">${t.name}</option>`
            ).join('')}
          </select>
        ` : ''}
      </div>

      <div id="collabs-grid">${teamBlocks || `<div class="empty-state"><div class="empty-state__icon">👥</div><div class="empty-state__title">Nenhum colaborador encontrado</div></div>`}</div>
    </div>
  `;
}

export function init() {
  document.querySelectorAll('.collab-card[data-collab]').forEach(card => {
    card.addEventListener('click', () => navigate('perfil', { id: card.dataset.collab }));
  });

  document.getElementById('search-collab')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.collab-card').forEach(card => {
      const name = card.querySelector('.collab-card__name')?.textContent.toLowerCase() ?? '';
      card.style.display = name.includes(q) ? '' : 'none';
    });
  });
}
