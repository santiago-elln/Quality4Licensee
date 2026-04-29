/* ============================================================
   METAS — Configuração de metas da equipe
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { TEAMS, TEAM_GOALS, getTeam } from '../data/mock.js';
import { toast } from '../components/toast.js';
import { ACCESS_LEVELS } from '../utils/access.js';

export function render() {
  const user = getCurrentUser();
  const teams = user.accessLevel >= ACCESS_LEVELS.ANALISTA
    ? TEAMS.filter(t => t.deptId === user.deptId)
    : [getTeam(user.teamId)].filter(Boolean);

  const teamForms = teams.map(team => {
    const goals = TEAM_GOALS[team.id] ?? { minScore: 36, qualityTarget: 80 };
    return `
      <div class="panel" style="margin-bottom:var(--space-4)">
        <div class="panel__header">
          <div class="panel__title">${team.name}</div>
          <button class="btn btn--primary btn--sm" data-team="${team.id}" id="save-goal-${team.id}">
            Salvar
          </button>
        </div>
        <div class="panel__body">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Pontuação mínima <span class="required">*</span></label>
              <input class="form-input" type="number" id="min-score-${team.id}"
                     value="${goals.minScore}" min="0" max="100" placeholder="ex: 36">
              <div class="form-hint">Nota mínima aceitável por monitoria</div>
            </div>
            <div class="form-group">
              <label class="form-label">Meta de qualidade (%) <span class="required">*</span></label>
              <input class="form-input" type="number" id="quality-target-${team.id}"
                     value="${goals.qualityTarget}" min="0" max="100" placeholder="ex: 80">
              <div class="form-hint">% de monitorias que devem atingir a nota mínima</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="page-enter">
      <div class="page-header">
        <div class="page-title">Metas da Equipe</div>
        <div class="page-subtitle">Configure os objetivos de qualidade por equipe</div>
      </div>
      ${teamForms || `<div class="empty-state"><div class="empty-state__title">Nenhuma equipe encontrada</div></div>`}
    </div>
  `;
}

export function init() {
  document.querySelectorAll('[id^="save-goal-"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const teamId = btn.dataset.team;
      const minScore = document.getElementById(`min-score-${teamId}`)?.value;
      const quality  = document.getElementById(`quality-target-${teamId}`)?.value;
      if (!minScore || !quality) {
        toast.warning('Atenção', 'Preencha todos os campos.');
        return;
      }
      toast.success('Metas salvas', `Mínimo: ${minScore} pts · Meta: ${quality}% (demo)`);
    });
  });
}
