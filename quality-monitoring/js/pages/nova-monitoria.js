/* ============================================================
   NOVA MONITORIA — Formulário de registro
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { navigate } from '../router.js';
import { toast } from '../components/toast.js';
import { getCollabsForViewer, EVAL_CATEGORIES, ANALYTICAL_CRITERIA, TOTAL_MAX_PTS, MONITORIAS } from '../data/mock.js';
import { formatHHMMSS, parseHHMMSS, resultBand } from '../utils/formatters.js';

let _scores = {};        // categoryId → earned pts
let _totalEarned = 0;

export function render() {
  const user = getCurrentUser();
  const collabs = getCollabsForViewer(user).filter(c => c.role === 'colaborador');
  const monCount = MONITORIAS.length + 1;

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

  return `
    <div class="monitoring-page page-enter">
      <!-- Header -->
      <div class="monitoring-header">
        <button class="monitoring-header__back" id="btn-back">
          ← Voltar
        </button>
        <div class="monitoring-header__title-wrap">
          <div class="monitoring-header__title">Monitoria de Qualidade</div>
          <div class="monitoring-header__subtitle">Registro de atendimento</div>
        </div>
      </div>

      <!-- Timer calculator -->
      <div class="timer-calc">
        <div>
          <div class="timer-calc__label">Cálculo de diferença entre tempos</div>
        </div>
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

      <!-- Collaborator selector -->
      <div class="collab-selector-section">
        <div class="collab-selector__avatar" id="collab-avatar">?</div>
        <div class="collab-selector__field">
          <label class="collab-selector__label">Selecione o colaborador</label>
          <select class="form-select collab-selector__select" id="collab-select">
            <option value="">— escolha um colaborador —</option>
            ${collabOpts}
          </select>
        </div>
        <div class="monitoring-number-section">
          <label class="form-label">Monitoria Nº</label>
          <div class="monitoring-number-val" id="mon-number">${monCount}</div>
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
            <div class="attendance-field__label">ID / Protocolo do atendimento</div>
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
            <div class="attendance-field__label">Tempo máx. de espera entre respostas</div>
            <input class="attendance-field__input" id="att-tmer" placeholder="00:00:00">
          </div>
          <div class="attendance-field">
            <div class="attendance-field__label">Tempo de atendimento</div>
            <input class="attendance-field__input" id="att-tma" placeholder="00:00:00">
          </div>
          <div class="attendance-field">
            <div class="attendance-field__label">Avaliação CSAT</div>
            <div class="csat-group" id="csat-group">
              ${[1,2,3,4,5].map(v => `
                <label class="csat-option">
                  <input type="radio" name="csat" value="${v}" ${v===5?'checked':''}>
                  <span class="csat-label">${v}</span>
                </label>
              `).join('')}
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
        <div>
          <div class="score-summary__title">Aproveitamento</div>
          <div class="score-summary__pct" id="score-pct">0%</div>
        </div>
        <div>
          <div class="score-summary__band badge badge--zero" id="score-band">Zerada</div>
        </div>
      </div>

      <!-- Evaluation categories -->
      ${categorySections}

      <!-- Analytical criteria -->
      <div class="analytical-section">
        <div class="analytical-section__header">
          <div class="analytical-section__title">Critérios Analíticos</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 50px 1fr;padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--border-light);gap:var(--space-4)">
          <div style="font-size:var(--text-xs);font-weight:600;text-transform:uppercase;text-align:right;color:var(--text-secondary)">Critério</div>
          <div style="font-size:var(--text-xs);font-weight:600;text-transform:uppercase;text-align:center;color:var(--text-secondary)">✓</div>
          <div style="font-size:var(--text-xs);font-weight:600;text-transform:uppercase;color:var(--text-secondary)">Justificativas</div>
        </div>
        ${analyticalRows}
      </div>

      <!-- Observations panel -->
      <div class="obs-panel">
        <div class="obs-panel__header">
          <div class="obs-panel__title">Observações</div>
          <button class="btn btn--outline btn--sm" id="btn-add-obs">+ Adicionar</button>
        </div>
        <div class="obs-form" id="obs-form" style="display:none">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Tipo <span class="required">*</span></label>
            <select class="form-select" id="obs-type">
              <option value="G">Genérico (G)</option>
              <option value="O">Operador (O)</option>
              <option value="A">Analítico (A)</option>
              <option value="E">Erro (E)</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Critério</label>
            <select class="form-select" id="obs-criteria">
              <option value="">— selecione —</option>
              ${[...EVAL_CATEGORIES.map(c => c.name), ...ANALYTICAL_CRITERIA.map(c => c.name)]
                .map(n => `<option>${n}</option>`).join('')}
            </select>
          </div>
          <div class="obs-form__row">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Texto da observação</label>
              <input class="form-input" id="obs-text" placeholder="Descreva a observação...">
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Possui Erro?</label>
              <div class="check-item" style="margin-top:var(--space-2)">
                <input type="checkbox" id="obs-has-error">
                <label for="obs-has-error" style="font-size:var(--text-sm)">Sim, registrar como erro</label>
              </div>
            </div>
          </div>
          <div style="grid-column:1/-1;display:flex;justify-content:flex-end;gap:var(--space-2)">
            <button class="btn btn--ghost btn--sm" id="btn-obs-cancel">Cancelar</button>
            <button class="btn btn--primary btn--sm" id="btn-obs-save">Salvar Observação</button>
          </div>
        </div>
        <div class="obs-chat-area" id="obs-chat"></div>
      </div>

      <!-- iGreen watermark -->
      <div class="form-logo-mark">
        <img src="assets/images/logo-light.png" alt="iGreen">
      </div>

      <!-- Submit -->
      <div style="display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-6)">
        <button class="btn btn--secondary btn--lg" id="btn-cancel-form">Cancelar</button>
        <button class="btn btn--primary btn--lg" id="btn-save-monitoring">
          💾 Salvar Monitoria
        </button>
      </div>
    </div>
  `;
}

function renderCategory(cat) {
  const items = cat.items.map(item => `
    <div class="eval-item" id="row-${item.id}">
      <input type="checkbox" class="eval-item__check" data-cat="${cat.id}"
             data-pts="${item.pts}" data-item="${item.id}" id="chk-${item.id}" checked>
      <label class="eval-item__name" for="chk-${item.id}">${item.name}</label>
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
          <div class="eval-section__progress-fill" id="prog-${cat.id}" style="width:100%"></div>
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
        ptsEl.className = `eval-item__pts-val${chk?.checked ? ' earned' : ''}`;
      }
    });
    total += earned;
    const prog = document.getElementById(`prog-${cat.id}`);
    const secPts = document.getElementById(`sec-pts-${cat.id}`);
    if (prog)   prog.style.width = `${Math.round((earned/cat.totalPts)*100)}%`;
    if (secPts) secPts.textContent = earned;
  });

  _totalEarned = total;
  const pct = Math.round((total / TOTAL_MAX_PTS) * 100);
  const band = resultBand(pct);

  const totalEl = document.getElementById('score-total');
  const pctEl   = document.getElementById('score-pct');
  const bandEl  = document.getElementById('score-band');
  if (totalEl) totalEl.textContent = total;
  if (pctEl)   pctEl.textContent   = pct + '%';
  if (bandEl) {
    bandEl.textContent  = band.label;
    bandEl.className    = `badge badge--${band.cls}`;
  }
}

const _observations = [];

function renderObsBubbles() {
  const area = document.getElementById('obs-chat');
  if (!area) return;
  if (!_observations.length) {
    area.innerHTML = `<div class="empty-state" style="padding:var(--space-6)">
      <div class="empty-state__icon">💬</div>
      <div class="empty-state__title">Nenhuma observação adicionada</div>
    </div>`;
    return;
  }
  area.innerHTML = _observations.map(o => `
    <div class="obs-bubble obs-bubble--${o.type}">
      <div class="obs-bubble__type">${typeLabel(o.type)}</div>
      ${o.criteria ? `<div class="obs-bubble__criteria">${o.criteria}</div>` : ''}
      <div class="obs-bubble__text">${o.text}</div>
      <div class="obs-bubble__meta">${new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })} · ${o.hasError ? '⚠️ Erro registrado' : ''}</div>
    </div>
  `).join('');
}

function typeLabel(t) {
  return { G: 'Genérico', O: 'Operador', A: 'Analítico', E: 'Erro' }[t] ?? t;
}

export function init() {
  recalcScores();
  renderObsBubbles();

  document.getElementById('btn-back')?.addEventListener('click', () => history.back());
  document.getElementById('btn-cancel-form')?.addEventListener('click', () => navigate('dashboard'));

  /* Timer */
  const calcDelta = () => {
    const t1 = parseHHMMSS(document.getElementById('timer-msg1')?.value);
    const t2 = parseHHMMSS(document.getElementById('timer-msg2')?.value);
    const delta = document.getElementById('timer-delta');
    if (delta) delta.textContent = formatHHMMSS(Math.abs(t2 - t1));
  };
  document.getElementById('timer-msg1')?.addEventListener('input', calcDelta);
  document.getElementById('timer-msg2')?.addEventListener('input', calcDelta);

  /* Collab select → avatar */
  document.getElementById('collab-select')?.addEventListener('change', e => {
    const sel = e.target.options[e.target.selectedIndex];
    const av = document.getElementById('collab-avatar');
    if (av) av.textContent = sel.text ? sel.text.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase() : '?';
  });

  /* Eval checkboxes */
  document.querySelectorAll('.eval-item__check').forEach(chk => {
    chk.addEventListener('change', recalcScores);
  });

  /* Section collapse */
  document.querySelectorAll('.eval-section__header').forEach(hdr => {
    hdr.addEventListener('click', e => {
      if (e.target.closest('.eval-item__check')) return;
      hdr.closest('.eval-section').classList.toggle('collapsed');
    });
  });

  /* Observations */
  document.getElementById('btn-add-obs')?.addEventListener('click', () => {
    document.getElementById('obs-form').style.display = 'grid';
  });
  document.getElementById('btn-obs-cancel')?.addEventListener('click', () => {
    document.getElementById('obs-form').style.display = 'none';
  });
  document.getElementById('btn-obs-save')?.addEventListener('click', () => {
    const text = document.getElementById('obs-text').value.trim();
    if (!text) { toast.warning('Atenção', 'Preencha o texto da observação.'); return; }
    _observations.push({
      type:     document.getElementById('obs-type').value,
      criteria: document.getElementById('obs-criteria').value,
      text,
      hasError: document.getElementById('obs-has-error').checked,
    });
    document.getElementById('obs-text').value = '';
    document.getElementById('obs-form').style.display = 'none';
    renderObsBubbles();
    toast.success('Observação adicionada');
  });

  /* Save */
  document.getElementById('btn-save-monitoring')?.addEventListener('click', () => {
    const collabId = document.getElementById('collab-select').value;
    if (!collabId) { toast.warning('Atenção', 'Selecione um colaborador.'); return; }
    const attId = document.getElementById('att-id').value.trim();
    if (!attId)   { toast.warning('Atenção', 'Informe o ID/protocolo do atendimento.'); return; }

    toast.success('Monitoria salva!', `Pontuação: ${_totalEarned}/${TOTAL_MAX_PTS} (${Math.round(_totalEarned/TOTAL_MAX_PTS*100)}%)`);
    setTimeout(() => navigate('registros'), 1500);
  });
}
