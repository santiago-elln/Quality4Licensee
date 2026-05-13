/* ============================================================
   NOVA MONITORIA — Formulário dois colunas + sidebar chat
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { navigate } from '../router.js';
import { toast } from '../components/toast.js';
import {
  getCollabsForViewer, EVAL_CATEGORIES, ANALYTICAL_CRITERIA,
  TOTAL_MAX_PTS, MONITORIAS, getMonitorias, getMonitoriaStats,
  OBSERVATIONS,
} from '../data/mock.js';
import {
  formatHHMMSS, parseHHMMSS, resultBand, scoreColor, formatDate,
} from '../utils/formatters.js';

let _observations = [];
let _totalEarned  = 0;
let _selectedCollabId = null;

export function render() {
  const user   = getCurrentUser();
  const collabs = getCollabsForViewer(user).filter(c => c.role === 'colaborador');
  const monNum  = MONITORIAS.length + 1;

  const collabOpts = collabs.map(c =>
    `<option value="${c.id}">${c.name}</option>`
  ).join('');

  const categorySections = EVAL_CATEGORIES.map(cat => renderCategory(cat)).join('');

  const analyticalRows = ANALYTICAL_CRITERIA.map(c => `
    <div class="analytical-item">
      <div class="analytical-item__name">${c.name}</div>
      <div class="analytical-item__check-wrap">
        <input type="checkbox" class="eval-item__check analytical-check"
               id="an-${c.id}" data-id="${c.id}" checked>
      </div>
      <input class="analytical-item__justification" type="text"
             id="an-just-${c.id}" placeholder="Justificativa (opcional)">
    </div>
  `).join('');

  const criteriaOpts = [
    ...EVAL_CATEGORIES.map(c => c.name),
    ...ANALYTICAL_CRITERIA.map(c => c.name),
  ].map(n => `<option value="${n}">${n}</option>`).join('');

  return `
    <div class="monitoring-page page-enter">
      <!-- Page header -->
      <div class="monitoring-header">
        <div class="monitoring-header__title-wrap">
          <div class="monitoring-header__title">Monitoria de Qualidade</div>
          <div class="monitoring-header__subtitle">Registro de atendimento</div>
        </div>
      </div>

      <!-- Two-column layout -->
      <div class="monitoring-layout">

        <!-- ══ LEFT COLUMN: main form ══ -->
        <div class="monitoring-main">

          <!-- Timer calculator -->
          <div class="timer-calc">
            <div><div class="timer-calc__label">Cálculo Δt entre tempos</div></div>
            <div class="timer-calc__fields">
              <div class="timer-field">
                <label class="timer-field__label">msg1</label>
                <input class="timer-field__input" id="timer-msg1" placeholder="00:00:00" value="00:00:00">
              </div>
              <div class="timer-field">
                <label class="timer-field__label">msg2</label>
                <input class="timer-field__input" id="timer-msg2" placeholder="00:00:00" value="00:00:00">
              </div>
              <div class="timer-field">
                <label class="timer-delta">Δt <span class="timer-delta__val" id="timer-delta">00:00:00</span></label>
              </div>
            </div>
          </div>

          <!-- Collaborator + number -->
          <div class="collab-selector-section">
            <div class="collab-selector__avatar" id="collab-avatar">?</div>
            <div class="collab-selector__field">
              <label class="collab-selector__label">Colaborador</label>
              <select class="form-select collab-selector__select" id="collab-select">
                <option value="">— selecione —</option>
                ${collabOpts}
              </select>
            </div>
            <div class="monitoring-number-section">
              <label class="form-label">Monitoria Nº</label>
              <input class="monitoring-number-input" type="number" id="monitoring-number" value="${monNum}" min="1">
            </div>
          </div>

          <!-- Attendance info -->
          <div class="attendance-section">
            <div class="attendance-section__header">
              <span class="attendance-section__icon">🔧</span>
              <span class="attendance-section__title">Dados do Atendimento</span>
            </div>
            <div class="attendance-grid">
              <div class="attendance-field">
                <div class="attendance-field__label">ID / Protocolo</div>
                <input class="attendance-field__input" id="att-id" placeholder="ex: 123456">
              </div>
              <div class="attendance-field">
                <div class="attendance-field__label">Data e hora do início</div>
                <input class="attendance-field__input" id="att-date" type="datetime-local">
              </div>
              <div class="attendance-field">
                <div class="attendance-field__label">Tempo de primeira resposta</div>
                <input class="attendance-field__input" id="att-tmpr" placeholder="00:00:00">
              </div>
              <div class="attendance-field">
                <div class="attendance-field__label">Tempo máx. espera entre respostas</div>
                <input class="attendance-field__input" id="att-tmer" placeholder="00:00:00">
              </div>
              <div class="attendance-field">
                <div class="attendance-field__label">Tempo de atendimento</div>
                <input class="attendance-field__input" id="att-tma" placeholder="00:00:00">
              </div>
              <div class="attendance-field">
                <div class="attendance-field__label">Avaliação CSAT</div>
                <div class="csat-group">
                  ${[1,2,3,4,5].map(v =>
                    `<label class="csat-option csat-option--${v}">
                      <input type="radio" name="csat" value="${v}" ${v===5?'checked':''}>
                      <span class="csat-label">${v}</span>
                    </label>`
                  ).join('')}
                </div>
              </div>
            </div>
          </div>

          <!-- Score summary -->
          <div class="score-summary" id="score-summary">
            <div>
              <div class="score-summary__title">Pontuação Total</div>
              <div style="display:flex;align-items:baseline;gap:8px">
                <div class="score-summary__value" id="score-total">0</div>
                <div class="score-summary__max">/ ${TOTAL_MAX_PTS}</div>
              </div>
            </div>
            <div style="flex:1;margin:0 var(--space-5)">
              <div class="score-summary__title" style="margin-bottom:6px">Progresso</div>
              <div style="height:8px;background:rgba(255,255,255,0.1);border-radius:var(--radius-full);overflow:hidden">
                <div id="total-progress-bar"
                     style="height:100%;width:0%;background:var(--brand-green);border-radius:var(--radius-full);transition:width .4s ease"></div>
              </div>
            </div>
            <div>
              <div class="score-summary__title">Aproveitamento</div>
              <div class="score-summary__pct" id="score-pct">0%</div>
            </div>
            <div>
              <span class="badge badge--zero" id="score-band">Zerada</span>
            </div>
          </div>

          <!-- Evaluation criteria -->
          ${categorySections}

          <!-- Analytical criteria -->
          <div class="analytical-section">
            <div class="analytical-section__header">
              <div class="analytical-section__title">Critérios Analíticos</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 50px 1fr;padding:var(--space-2) var(--space-5);border-bottom:1px solid var(--border-light);gap:var(--space-4)">
              <div style="font-size:var(--text-xs);font-weight:600;text-transform:uppercase;text-align:right;color:var(--text-secondary)">Critério</div>
              <div style="font-size:var(--text-xs);font-weight:600;text-transform:uppercase;text-align:center;color:var(--text-secondary)">✓</div>
              <div style="font-size:var(--text-xs);font-weight:600;text-transform:uppercase;color:var(--text-secondary)">Justificativa</div>
            </div>
            ${analyticalRows}
          </div>

          <!-- Watermark + submit -->
          <div class="form-logo-mark">
            <img src="assets/images/logo-light.png" alt="iGreen">
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);margin-top:var(--space-4)">
            <button class="btn btn--danger btn--lg btn--ghost" id="btn-reset-monitoring" title="Zerar todas as respostas da monitoria">
              ⚠️ Zerar Monitoria
            </button>
            <div style="display:flex;gap:var(--space-3)">
              <button class="btn btn--secondary btn--lg" id="btn-cancel-form">Cancelar</button>
              <button class="btn btn--primary btn--lg" id="btn-save-monitoring">
                💾 Salvar Monitoria
              </button>
            </div>
          </div>
        </div>

        <!-- ══ RIGHT COLUMN: sidebar ══ -->
        <div class="monitoring-sidebar">

          <!-- AI Summary -->
          <!-- <div class="ai-summary-panel" id="ai-summary-panel">
            <div class="ai-summary-panel__header" id="ai-summary-toggle">
              <span class="ai-summary-panel__title">✨ Resumo IA — Histórico do Colaborador</span>
              <span class="ai-summary-panel__toggle">▾</span>
            </div>
            <div class="ai-summary-panel__body" id="ai-summary-body">
              <div class="ai-summary-placeholder" id="ai-summary-placeholder">
                <div class="ai-summary-placeholder__icon">🤖</div>
                <div>Selecione um colaborador para ver o resumo das monitorias anteriores</div>
              </div>
            </div>
          </div> -->

          <!-- Observations Chat Sidebar -->
          <div class="obs-sidebar-panel">
            <div class="obs-sidebar-panel__header">
              <span class="obs-sidebar-panel__title">💬 Observações</span>
              <span class="badge badge--dark" id="obs-count-badge">0</span>
            </div>

            <!-- Add observation form -->
            <div class="obs-add-form" id="obs-add-form">
              <div class="obs-add-form__row">
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">Protocolo</label>
                  <input class="form-input" id="obs-proto" placeholder="ID do atendimento">
                </div>
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">Tipo <span class="required">*</span></label>
                  <select class="form-select" id="obs-type">
                    <option value="G">Genérico</option>
                    <option value="O">Oportunidade</option>
                    <option value="A">Acerto</option>
                    <option value="E">Erro</option>
                  </select>
                </div>
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label">Critério (opcional)</label>
                <select class="form-select" id="obs-criteria">
                  <option value="">— nenhum —</option>
                  ${criteriaOpts}
                </select>
              </div>
              <div class="form-group obs-error-field" id="obs-error-field" style="margin-bottom:0">
                <label class="form-label" style="color:var(--color-danger)">Tipo do Erro</label>
                <select class="form-select" id="obs-error-type">
                  <option value="">— selecione —</option>
                  <option value="Violação de norma legal">Violação de norma legal</option>
                  <option value="Falha em procedimento interno">Falha em procedimento interno</option>
                  <option value="Informação incorreta">Informação incorreta</option>
                  <option value="Conduta inadequada">Conduta inadequada</option>
                  <option value="Outro">Outro</option>
                </select>
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label">Observação <span class="required">*</span></label>
                <input class="form-input" id="obs-text" placeholder="Descreva a observação…">
              </div>
              <button class="btn btn--primary btn--sm btn--block" id="btn-obs-save" style="margin-top:2px">
                + Adicionar Observação
              </button>
            </div>

            <!-- Bubbles -->
            <div class="obs-chat-scrollable" id="obs-chat"></div>
          </div>
        </div><!-- /sidebar -->
      </div><!-- /monitoring-layout -->

      <!-- Modal: Zerar Monitoria -->
      <div class="modal-overlay modal-overlay--hidden" id="modal-reset-overlay"></div>
      <div class="modal modal--hidden" id="modal-reset-monitoring">
        <div class="modal__header">
          <div class="modal__title">Zerar Monitoria</div>
          <button class="modal__close" id="btn-modal-close">✕</button>
        </div>
        <div class="modal__body">
          <div class="form-group">
            <label class="form-label">Tipo de Erro <span class="required">*</span></label>
            <select class="form-select" id="reset-error-type">
              <option value="">— selecione —</option>
              <option value="Violação de norma legal">Violação de norma legal</option>
              <option value="Falha em procedimento interno">Falha em procedimento interno</option>
              <option value="Informação incorreta">Informação incorreta</option>
              <option value="Conduta inadequada">Conduta inadequada</option>
              <option value="Outro">Outro</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Protocolo do Atendimento</label>
            <input class="form-input" id="reset-protocol" placeholder="ex: 123456" type="text">
          </div>
          <div class="form-group">
            <label class="form-label">Data e Horário da Violação</label>
            <input class="form-input" id="reset-datetime" type="datetime-local">
          </div>
          <div class="form-group">
            <label class="form-label">Justificativa <span class="required">*</span></label>
            <textarea class="form-textarea" id="reset-justification" placeholder="Explique o motivo do zeramento..."></textarea>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--secondary" id="btn-reset-cancel">Cancelar</button>
          <button class="btn btn--danger" id="btn-reset-confirm">Confirmar Zeramento</button>
        </div>
      </div>
    </div>
  `;
}

/* ── Category section HTML ─────────────────── */
function renderCategory(cat) {
  const items = cat.items.map(item => `
    <div class="eval-item" id="row-${item.id}">
      <input type="checkbox" class="eval-item__check" data-cat="${cat.id}"
             data-pts="${item.pts}" data-item="${item.id}" id="chk-${item.id}" checked>
      <label class="eval-item__name eval-item__criterion" for="chk-${item.id}"
             data-description="${item.description || ''}">${item.name}</label>
      <div class="eval-item__pts">
        <span class="eval-item__pts-val earned" id="pts-${item.id}">${item.pts}</span>
        <span class="eval-item__pts-max">/${item.pts}</span>
      </div>
    </div>
  `).join('');

  return `
    <div class="eval-section" id="section-${cat.id}">
      <div class="eval-section__header">
        <span class="eval-section__name">${cat.name}</span>
        <div class="eval-section__progress">
          <div class="eval-section__progress-fill" id="prog-${cat.id}" style="width:100%;transition:width .35s ease"></div>
        </div>
        <span class="eval-section__pts">
          <span class="current" id="sec-pts-${cat.id}">${cat.totalPts}</span>/${cat.totalPts}
        </span>
        <span class="eval-section__toggle">▾</span>
      </div>
      <div class="eval-items">${items}</div>
    </div>
  `;
}

/* ── Score recalculation ───────────────────── */
function recalcScores() {
  let total = 0;
  EVAL_CATEGORIES.forEach(cat => {
    let earned = 0;
    cat.items.forEach(item => {
      const chk = document.getElementById(`chk-${item.id}`);
      const pts = chk?.checked ? item.pts : 0;
      earned += pts;
      const ptsEl = document.getElementById(`pts-${item.id}`);
      if (ptsEl) {
        ptsEl.textContent = pts;
        ptsEl.className   = `eval-item__pts-val${chk?.checked ? ' earned' : ''}`;
      }
    });
    total += earned;
    const pct  = Math.round((earned / cat.totalPts) * 100);
    const prog = document.getElementById(`prog-${cat.id}`);
    const secPts = document.getElementById(`sec-pts-${cat.id}`);
    if (prog) {
      prog.style.width = `${pct}%`;
      prog.style.background = scoreColor(pct);
    }
    if (secPts) secPts.textContent = earned;
  });

  _totalEarned = total;
  const pct  = Math.round((total / TOTAL_MAX_PTS) * 100);
  const band = resultBand(pct);

  const bar = document.getElementById('total-progress-bar');
  if (bar) {
    bar.style.width      = `${pct}%`;
    bar.style.background = scoreColor(pct);
  }
  const totalEl = document.getElementById('score-total');
  const pctEl   = document.getElementById('score-pct');
  const bandEl  = document.getElementById('score-band');
  if (totalEl) totalEl.textContent = total;
  if (pctEl)   pctEl.textContent   = `${pct}%`;
  if (bandEl) {
    bandEl.textContent = band.label;
    bandEl.className   = `badge badge--${band.cls}`;
  }
}

/* ── AI Summary panel ─────────────────────── */
function renderAiSummary(collabId) {
  const body = document.getElementById('ai-summary-body');
  if (!body) return;

  const mons  = getMonitorias({ colaboradorId: collabId });
  if (!mons.length) {
    body.innerHTML = `
      <div class="ai-summary-placeholder">
        <div class="ai-summary-placeholder__icon">📋</div>
        <div>Nenhuma monitoria anterior encontrada para este colaborador.</div>
      </div>`;
    return;
  }

  const stats = getMonitoriaStats(mons);
  const last3 = mons.slice(0, 3);
  const trend = mons.length >= 2
    ? mons[0].pct - mons[1].pct
    : null;

  /* Category avgs */
  const catData = EVAL_CATEGORIES.map(cat => {
    const earned = mons.length
      ? mons.reduce((s, m) =>
          s + cat.items.reduce((cs, item) =>
            cs + (m.checkedItems?.[item.id] ? item.pts : 0), 0), 0) / mons.length
      : 0;
    return { name: cat.name.split(' ')[0], pct: Math.round((earned / cat.totalPts) * 100) };
  });

  const weakest  = [...catData].sort((a,b) => a.pct - b.pct)[0];
  const strongest = [...catData].sort((a,b) => b.pct - a.pct)[0];

  const recentObs = OBSERVATIONS.filter(o => o.colaboradorId === collabId).slice(0, 3);

  const trendStr = trend === null ? ''
    : trend > 0 ? `<span style="color:var(--brand-green)">↑ +${trend}% vs. ant.</span>`
    : trend < 0 ? `<span style="color:#ff6b6b">↓ ${trend}% vs. ant.</span>`
    : `<span style="color:rgba(255,255,255,.4)">→ Estável</span>`;

  body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);gap:var(--space-2);flex-wrap:wrap">
      <span style="font-size:var(--text-xs);color:rgba(255,255,255,.35)">${mons.length} monitorias registradas</span>
      <span style="font-size:var(--text-xs)">${trendStr}</span>
    </div>

    <div class="ai-metric-row">
      <span class="ai-metric-row__label">Aproveit. médio</span>
      <span class="ai-metric-row__val" style="color:${scoreColor(stats.avgPct)}">${stats.avgPct}%</span>
    </div>
    <div class="ai-metric-row">
      <span class="ai-metric-row__label">Pts perdidos/mon</span>
      <span class="ai-metric-row__val">${stats.ptsLost}</span>
    </div>
    <div class="ai-metric-row">
      <span class="ai-metric-row__label">Zeradas</span>
      <span class="ai-metric-row__val" style="color:${stats.zeroed>0?'#ff6b6b':'inherit'}">${stats.zeroed}</span>
    </div>
    <div class="ai-metric-row">
      <span class="ai-metric-row__label">Mais forte</span>
      <span class="ai-metric-row__val" style="color:var(--brand-green)">${strongest.name} (${strongest.pct}%)</span>
    </div>
    <div class="ai-metric-row">
      <span class="ai-metric-row__label">Mais fraco</span>
      <span class="ai-metric-row__val" style="color:#ffd166">${weakest.name} (${weakest.pct}%)</span>
    </div>

    <div style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid rgba(255,255,255,.08)">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.35);margin-bottom:var(--space-2)">Últimas 3 monitorias</div>
      ${last3.map(m => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:var(--text-xs)">
          <span style="color:rgba(255,255,255,.45)">${formatDate(m.date)}</span>
          <div style="display:flex;align-items:center;gap:var(--space-2)">
            <div style="width:50px;height:4px;background:rgba(255,255,255,.1);border-radius:99px;overflow:hidden">
              <div style="width:${m.pct}%;height:100%;background:${scoreColor(m.pct)};border-radius:99px"></div>
            </div>
            <span style="color:${scoreColor(m.pct)};font-weight:700">${m.pct}%</span>
          </div>
        </div>
      `).join('')}
    </div>

    ${recentObs.length ? `
      <div style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid rgba(255,255,255,.08)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.35);margin-bottom:var(--space-2)">Observações recentes</div>
        ${recentObs.map(o => `
          <div style="display:flex;gap:var(--space-2);padding:3px 0;font-size:var(--text-xs);color:rgba(255,255,255,.5)">
            <span class="obs-type-tag obs-type-tag--${o.type}" style="flex-shrink:0">${o.type}</span>
            <span style="line-height:var(--leading-snug)">${o.text}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

/* ── Observation chat render ───────────────── */
function renderObsChat() {
  const area  = document.getElementById('obs-chat');
  const badge = document.getElementById('obs-count-badge');
  if (!area) return;
  if (badge) badge.textContent = _observations.length;

  if (!_observations.length) {
    area.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;padding:var(--space-6) var(--space-4);gap:var(--space-2);color:var(--text-tertiary);text-align:center">
        <span style="font-size:1.5rem;opacity:.3">💬</span>
        <span style="font-size:var(--text-xs)">Adicione observações usando o formulário acima</span>
      </div>`;
    return;
  }

  area.innerHTML = _observations.map((o, idx) => `
    <div class="obs-bubble-compact obs-bubble-compact--${o.type}">
      <div class="obs-bubble-compact__header">
        <span class="obs-type-tag obs-type-tag--${o.type}">${o.type}</span>
        ${o.criteria ? `<span class="obs-bubble-compact__criteria">${o.criteria}</span>` : ''}
        ${o.proto ? `<span class="obs-bubble-compact__proto">#${o.proto}</span>` : ''}
      </div>
      <div class="obs-bubble-compact__text">${o.text}</div>
      ${o.errorType ? `<div style="font-size:10px;margin-top:3px;color:var(--color-danger);font-weight:600">⚠ ${o.errorType}</div>` : ''}
      <button class="obs-bubble-compact__delete" data-idx="${idx}" title="Remover">✕</button>
    </div>
  `).join('');

  area.querySelectorAll('.obs-bubble-compact__delete').forEach(btn => {
    btn.addEventListener('click', () => {
      _observations.splice(Number(btn.dataset.idx), 1);
      renderObsChat();
    });
  });
}

export function init() {
  _observations = [];
  _selectedCollabId = null;
  recalcScores();
  renderObsChat();

  /* Back / cancel */
  document.getElementById('btn-back')?.addEventListener('click', () => history.back());
  document.getElementById('btn-cancel-form')?.addEventListener('click', () => navigate('dashboard'));

  /* Reset monitoring */
  document.getElementById('btn-reset-monitoring')?.addEventListener('click', () => {
    // Desmarcar todos os checkboxes
    document.querySelectorAll('.eval-item__check').forEach(chk => {
      chk.checked = false;
    });
    recalcScores();

    // Delay de 1 segundo antes de abrir o modal
    setTimeout(() => {
      openResetModal();
    }, 1000);
  });

  // Modal: Abrir/Fechar
  function openResetModal() {
    const modal = document.getElementById('modal-reset-monitoring');
    if (modal) modal.classList.remove('modal--hidden');
  }
  function closeResetModal() {
    const modal = document.getElementById('modal-reset-monitoring');
    if (modal) modal.classList.add('modal--hidden');
    // Limpar campos
    document.getElementById('reset-error-type').value = '';
    document.getElementById('reset-protocol').value = '';
    document.getElementById('reset-datetime').value = '';
    document.getElementById('reset-justification').value = '';
  }

  // Fechar modal ao clicar no X ou no overlay
  document.getElementById('btn-modal-close')?.addEventListener('click', closeResetModal);
  document.getElementById('modal-reset-overlay')?.addEventListener('click', closeResetModal);

  // Botão Cancelar
  document.getElementById('btn-reset-cancel')?.addEventListener('click', closeResetModal);

  // Botão Confirmar
  document.getElementById('btn-reset-confirm')?.addEventListener('click', () => {
    const errorType = document.getElementById('reset-error-type')?.value.trim();
    const justification = document.getElementById('reset-justification')?.value.trim();

    if (!errorType) {
      toast.warning('Atenção', 'Selecione o tipo de erro.');
      return;
    }
    if (!justification) {
      toast.warning('Atenção', 'Preencha a justificativa.');
      return;
    }

    // TODO: Implementar salvamento do zeramento
    console.log('Zeramento confirmado:', {
      errorType,
      protocol: document.getElementById('reset-protocol')?.value || '',
      datetime: document.getElementById('reset-datetime')?.value || '',
      justification,
    });

    toast.success('Monitoria zerada', 'O zeramento foi registrado com sucesso.');
    closeResetModal();
  });

  /* Timer Δt */
  const calcDelta = () => {
    const t1 = parseHHMMSS(document.getElementById('timer-msg1')?.value || '0');
    const t2 = parseHHMMSS(document.getElementById('timer-msg2')?.value || '0');
    const el = document.getElementById('timer-delta');
    if (el) el.textContent = formatHHMMSS(Math.abs(t2 - t1));
  };
  document.getElementById('timer-msg1')?.addEventListener('input', calcDelta);
  document.getElementById('timer-msg2')?.addEventListener('input', calcDelta);

  /* Collaborator select → avatar + AI summary */
  document.getElementById('collab-select')?.addEventListener('change', e => {
    _selectedCollabId = e.target.value || null;
    const av = document.getElementById('collab-avatar');
    if (av) {
      const sel = e.target.options[e.target.selectedIndex];
      av.textContent = sel.text
        ? sel.text.trim().split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase()
        : '?';
    }
    if (_selectedCollabId) {
      renderAiSummary(_selectedCollabId);
    } else {
      const body = document.getElementById('ai-summary-body');
      if (body) body.innerHTML = `
        <div class="ai-summary-placeholder">
          <div class="ai-summary-placeholder__icon">🤖</div>
          <div>Selecione um colaborador para ver o resumo das monitorias anteriores</div>
        </div>`;
    }
  });

  /* AI summary collapse */
  document.getElementById('ai-summary-toggle')?.addEventListener('click', () => {
    document.getElementById('ai-summary-panel')?.classList.toggle('collapsed');
  });

  /* Eval checkboxes */
  document.querySelectorAll('.eval-item__check').forEach(chk => {
    chk.addEventListener('change', recalcScores);
  });

  /* Section collapse toggle */
  document.querySelectorAll('.eval-section__header').forEach(hdr => {
    hdr.addEventListener('click', e => {
      if (e.target.closest('.eval-item__check, label')) return;
      hdr.closest('.eval-section')?.classList.toggle('collapsed');
    });
  });

  /* Obs type change: show/hide error field */
  document.getElementById('obs-type')?.addEventListener('change', e => {
    const errField = document.getElementById('obs-error-field');
    if (errField) errField.classList.toggle('visible', e.target.value === 'E');
  });

  /* Add observation */
  document.getElementById('btn-obs-save')?.addEventListener('click', () => {
    const text = document.getElementById('obs-text')?.value.trim();
    if (!text) { toast.warning('Atenção', 'Preencha o texto da observação.'); return; }

    const type      = document.getElementById('obs-type')?.value ?? 'G';
    const criteria  = document.getElementById('obs-criteria')?.value ?? '';
    const proto     = document.getElementById('obs-proto')?.value.trim() ?? '';
    const errorType = type === 'E'
      ? (document.getElementById('obs-error-type')?.value ?? '') : '';

    _observations.push({ type, criteria, proto, text, errorType });
    document.getElementById('obs-text').value = '';
    document.getElementById('obs-proto').value = '';
    renderObsChat();
  });

  /* Save monitoring */
  document.getElementById('btn-save-monitoring')?.addEventListener('click', () => {
    const collabId = document.getElementById('collab-select')?.value;
    if (!collabId) { toast.warning('Atenção', 'Selecione um colaborador.'); return; }
    const attId = document.getElementById('att-id')?.value.trim();
    if (!attId)   { toast.warning('Atenção', 'Informe o ID/protocolo do atendimento.'); return; }

    const pct = Math.round(_totalEarned / TOTAL_MAX_PTS * 100);
    toast.success('Monitoria salva!',
      `${_totalEarned}/${TOTAL_MAX_PTS} pts (${pct}%) · ${_observations.length} observação(ões)`);
    setTimeout(() => navigate('registros'), 1500);
  });
}
