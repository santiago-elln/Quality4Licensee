/* ============================================================
   AI ANALISE — Insights gerados por IA (Claude)
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { AI_INSIGHTS, MOCK_USERS } from '../data/mock.js';
import { formatDateTime } from '../utils/formatters.js';
import { navigate } from '../router.js';

export function render() {
  const user = getCurrentUser();

  const cards = AI_INSIGHTS.map(insight => renderInsightCard(insight)).join('');

  return `
    <div class="ai-page page-enter">
      <!-- Banner -->
      <div class="ai-banner">
        <div class="ai-banner__icon">🤖</div>
        <div class="ai-banner__content">
          <div class="ai-banner__title">Análise por IA — Claude</div>
          <div class="ai-banner__subtitle">
            Insights automáticos sobre desvios, padrões e oportunidades identificados nas monitorias
          </div>
        </div>
        <div class="ai-banner__actions">
          <button class="btn-ai-run" id="btn-run-ai">
            ✨ Gerar Nova Análise
          </button>
        </div>
      </div>

      <!-- Info box -->
      <div style="background:var(--color-info-bg);border:1px solid rgba(59,130,246,0.25);border-radius:var(--radius-md);padding:var(--space-4) var(--space-5);margin-bottom:var(--space-5);display:flex;gap:var(--space-3);align-items:flex-start">
        <span style="font-size:1.1rem;flex-shrink:0">ℹ️</span>
        <div>
          <div style="font-size:var(--text-sm);font-weight:600;color:var(--color-info-text);margin-bottom:2px">Como funciona</div>
          <div style="font-size:var(--text-sm);color:var(--color-info-text)">
            A IA analisa as monitorias registradas e identifica padrões de desvio, queda de performance e oportunidades de melhoria.
            Os insights são gerados via API da Claude (Anthropic) e atualizados sob demanda.
            <strong>Esta visualização usa dados de exemplo.</strong>
          </div>
        </div>
      </div>

      <!-- Insight cards -->
      <div id="insights-container">
        ${cards || `<div class="empty-state"><div class="empty-state__icon">🤖</div><div class="empty-state__title">Nenhum insight disponível</div><div class="empty-state__desc">Clique em "Gerar Nova Análise" para iniciar.</div></div>`}
      </div>

      <div class="ai-generated-at">
        <span>🕐</span>
        <span>Última análise gerada em: ${formatDateTime(AI_INSIGHTS[0]?.generatedAt ?? new Date().toISOString())}</span>
      </div>
    </div>
  `;
}

function severityLabel(s) {
  return { high: 'Alto', medium: 'Médio', critical: 'Crítico', low: 'Baixo' }[s] ?? s;
}
function severityClass(s) {
  return { high: 'warning', medium: 'info', critical: 'danger', low: 'success' }[s] ?? 'neutral';
}
function typeIcon(t) {
  return { deviation: '⚠️', trend: '📈', pattern: '🔍', praise: '🌟' }[t] ?? '📌';
}

function renderInsightCard(insight) {
  const target = MOCK_USERS.find(u => u.id === insight.target);
  const evidenceItems = insight.evidence.map(e => `
    <div class="ai-evidence__item ai-evidence__item--deviation">
      <div class="ai-evidence__dot ai-evidence__dot--deviation"></div>
      <span>${e}</span>
    </div>
  `).join('');

  const recommendations = insight.recommendations.map(r => `
    <div class="ai-recommendation">
      <span class="ai-recommendation__icon">→</span>
      <span>${r}</span>
    </div>
  `).join('');

  return `
    <div class="ai-insight-card" data-insight="${insight.id}">
      <div class="ai-insight-card__header">
        <div class="ai-insight-card__icon ai-insight-card__icon--${insight.type}">
          ${typeIcon(insight.type)}
        </div>
        <div>
          <div class="ai-insight-card__title">${insight.title}</div>
          <div class="ai-insight-card__meta">
            Alvo: <strong>${insight.targetName}</strong> ·
            ${formatDateTime(insight.generatedAt)}
          </div>
        </div>
        <div class="ai-insight-card__severity">
          <span class="badge badge--${severityClass(insight.severity)}">
            ${severityLabel(insight.severity)}
          </span>
        </div>
      </div>
      <div class="ai-insight-card__body">
        <p class="ai-insight-text">${insight.summary}</p>

        <div style="font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary);margin-bottom:var(--space-2)">
          Evidências
        </div>
        <div class="ai-evidence">${evidenceItems}</div>

        <div class="ai-recommendations">
          <div style="font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary);margin-bottom:var(--space-1)">
            Recomendações
          </div>
          ${recommendations}
        </div>
      </div>
    </div>
  `;
}

export function init() {
  document.getElementById('btn-run-ai')?.addEventListener('click', () => {
    const container = document.getElementById('insights-container');
    if (!container) return;
    container.innerHTML = `
      <div class="ai-loading">
        <div class="ai-loading__spinner"></div>
        <div class="ai-loading__text">Analisando monitorias com Claude…</div>
      </div>
    `;
    setTimeout(() => {
      container.innerHTML = AI_INSIGHTS.map(i => renderInsightCard(i)).join('');
    }, 2500);
  });
}
