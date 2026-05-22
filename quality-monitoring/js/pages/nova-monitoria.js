/* ============================================================
   NOVA MONITORIA — Formulário dois colunas + sidebar chat
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { navigate }       from '../router.js';
import { toast }          from '../components/toast.js';
import { can, P }         from '../utils/permissions.js';
/* EVAL_CATEGORIES, ANALYTICAL_CRITERIA and TOTAL_MAX_PTS are now built
   dynamically from the DB in init() — config.js is no longer used here. */
import { supabase }       from '../supabase.js';
import { formatHHMMSS, parseHHMMSS, resultBand, scoreColor } from '../utils/formatters.js';

/* ── Module state ─────────────────────────── */
let _observations          = [];   // {typeCode, typeId, criteriaId, criteriaName, errorTypeId, errorTypeName, proto, text}
let _serviceChats          = [];   // {protocol, startedAt, tmpr, tmer, tma, csat}
let _totalEarned           = 0;
let _pendingDeleteProtocol = null;

/* Fetched from DB on init */
let _topics          = [];   // [{id, item, eval_criteria_id, points, description}]
let _obsTypeMap      = {};   // {G: uuid, O: uuid, A: uuid, E: uuid}
let _evalCriteria    = [];   // [{id, name}]
let _analyticalTypes = [];   // [{id, name}]
let _errorTypes      = [];   // [{id, name, critical}]
let _employees       = [];   // [{id, name}]

/* Built from DB data after first fetch */
let _EVAL_CATEGORIES    = [];  // [{id, name, items:[{id,name,pts,description}], totalPts}]
let _ANALYTICAL_CRITERIA = []; // [{id, name}]
let _TOTAL_MAX_PTS      = 0;

/* ── Draft (localStorage) ─────────────────── */
const DRAFT_KEY = 'nova-monitoria-draft';

function saveDraft() {
  const topics = {};
  document.querySelectorAll('.eval-item__check').forEach(chk => {
    if (chk.dataset.item) topics[chk.dataset.item] = chk.checked;
  });

  const analytical = {};
  document.querySelectorAll('.analytical-check').forEach(chk => {
    const just = document.getElementById(`an-just-${chk.dataset.id}`)?.value ?? '';
    analytical[chk.dataset.id] = { checked: chk.checked, justification: just };
  });

  const collabId        = document.getElementById('collab-select')?.value ?? '';
  const monitoringNumber = document.getElementById('monitoring-number')?.value ?? '';

  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      serviceChats: _serviceChats,
      observations: _observations,
      topics,
      analytical,
      collabId,
      monitoringNumber,
    }));
  } catch {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

function restoreDraftCheckboxes(draft) {
  if (!draft) return;

  /* Colaborador e nº da monitoria */
  if (draft.collabId) {
    const sel = document.getElementById('collab-select');
    if (sel) {
      sel.value = draft.collabId;
      const av  = document.getElementById('collab-avatar');
      if (av) {
        const text = sel.options[sel.selectedIndex]?.text ?? '';
        av.textContent = text
          ? text.trim().split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
          : '?';
      }
    }
  }
  if (draft.monitoringNumber) {
    const num = document.getElementById('monitoring-number');
    if (num) num.value = draft.monitoringNumber;
  }

  if (draft.topics) {
    Object.entries(draft.topics).forEach(([itemId, checked]) => {
      const chk = document.querySelector(`.eval-item__check[data-item="${itemId}"]`);
      if (chk) chk.checked = checked;
    });
  }
  recalcScores();

  if (draft.analytical) {
    Object.entries(draft.analytical).forEach(([id, { checked, justification }]) => {
      const chk  = document.querySelector(`.analytical-check[data-id="${id}"]`);
      const just = document.getElementById(`an-just-${id}`);
      if (chk)  chk.checked = checked;
      if (just) {
        just.value       = justification ?? '';
        just.placeholder = checked ? 'Justificativa (opcional)' : 'Justificativa obrigatória…';
        if (just.value) autoResize(just);
      }
    });
  }
}

function resetForm() {
  clearDraft();
  _serviceChats          = [];
  _observations          = [];
  _pendingDeleteProtocol = null;

  const colSel = document.getElementById('collab-select');
  if (colSel) colSel.value = '';
  const av = document.getElementById('collab-avatar');
  if (av) av.textContent = '?';
  const num = document.getElementById('monitoring-number');
  if (num) num.value = 1;

  document.querySelectorAll('.eval-item__check').forEach(chk => { chk.checked = true; });
  recalcScores();

  document.querySelectorAll('.analytical-check').forEach(chk => {
    chk.checked = true;
    const just = document.getElementById(`an-just-${chk.dataset.id}`);
    if (just) { just.value = ''; just.placeholder = 'Justificativa (opcional)'; }
  });

  renderServiceChatList();
  renderObsChat();
}

/* ── Auto-resize textarea ─────────────────── */
function autoResize(el) {
  if (!el.value) { el.style.height = '35px'; return; }
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

/* ── Helpers ──────────────────────────────── */
function normalizeTime(val) {
  if (!val || !val.trim()) return null;
  const parts = val.trim().split(':');
  if (parts.length === 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`;
  if (parts.length === 3) return parts.map(p => p.padStart(2, '0')).join(':');
  return null;
}

function computeMonitoringWeek(dateStr) {
  const d     = new Date(dateStr);
  const day   = d.getDate();
  const year  = d.getFullYear();
  const month = d.getMonth();

  if (day >= 26) {
    const next = new Date(year, month + 1, 1);
    return {
      weekNumber:     1,
      referenceMonth: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`,
    };
  }

  const refMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const dow1     = new Date(year, month, 1).getDay();
  const firstSun = dow1 === 0 ? 1 : 1 + (7 - dow1);
  const w2End    = Math.min(firstSun, 25);

  if (day <= w2End) return { weekNumber: 2, referenceMonth: refMonth };

  let start  = w2End + 1;
  let weekNo = 3;
  while (start <= 25) {
    const end = Math.min(start + 6, 25);
    if (day <= end) return { weekNumber: weekNo, referenceMonth: refMonth };
    start = end + 1;
    weekNo++;
  }
  return { weekNumber: weekNo, referenceMonth: refMonth };
}

/* ── Validation ───────────────────────────── */
function validateRequiredFields() {
  const collabId = document.getElementById('collab-select')?.value;
  if (!collabId) { toast.warning('Atenção', 'Selecione um colaborador.'); return false; }

  const monNum = Number(document.getElementById('monitoring-number')?.value);
  if (!monNum || monNum < 1) { toast.warning('Atenção', 'Informe um número de monitoria válido.'); return false; }

  if (!_serviceChats.length) {
    toast.warning('Atenção', 'Adicione pelo menos um atendimento.');
    return false;
  }

  for (const c of _ANALYTICAL_CRITERIA) {
    const checked = document.getElementById(`an-${c.id}`)?.checked;
    if (!checked) {
      const just = document.getElementById(`an-just-${c.id}`)?.value.trim();
      if (!just) {
        toast.warning('Atenção', `Justificativa obrigatória: "${c.name}"`);
        return false;
      }
    }
  }

  return true;
}

/* ── DB save ──────────────────────────────── */
async function persistMonitoring({ isZeroed = false, resetData = null } = {}) {
  const user = getCurrentUser();
  if (!user?.id) throw new Error('Sessão expirada. Faça login novamente.');

  const collabId = document.getElementById('collab-select')?.value;
  const monNum   = Number(document.getElementById('monitoring-number')?.value);

  const { data: emp } = await supabase
    .from('employees').select('sector_id').eq('id', collabId).single();
  const sectorId = emp?.sector_id ?? null;

  /* Use first service_chat's date for week calculation */
  const firstSC = _serviceChats[0];
  const { weekNumber, referenceMonth } = computeMonitoringWeek(firstSC.startedAt);
  const today = new Date().toISOString().split('T')[0];

  /* 1 — monitoring */
  const { data: mon, error: monErr } = await supabase
    .from('monitoring')
    .insert({ number: monNum, employee_id: collabId, author_id: user.id,
              date: today, reference_month: referenceMonth, week_number: weekNumber })
    .select('id').single();
  if (monErr) throw monErr;
  const monId = mon.id;

  /* 2 — service_chats (one per attendance) */
  const scIdByProtocol = {};
  let firstScId = null;
  for (const sc of _serviceChats) {
    const started = sc.startedAt.length === 16 ? `${sc.startedAt}:00` : sc.startedAt;
    const { data: scRow, error: scErr } = await supabase
      .from('service_chat')
      .insert({ protocol: sc.protocol, employee_id: collabId, support_type: sectorId,
                started_at: started, service_time: sc.tma,
                first_response_time: sc.tmpr, max_response_time: sc.tmer, csat: sc.csat,
                monitoring_id: monId })
      .select('id').single();
    if (scErr) {
      await supabase.from('monitoring').delete().eq('id', monId);
      if (scErr.code === '23505') throw new Error(`Protocolo duplicado: ${sc.protocol}`);
      throw scErr;
    }
    scIdByProtocol[sc.protocol] = scRow.id;
    if (!firstScId) firstScId = scRow.id;
  }
  const scId = firstScId;

  /* 3 — topic_approval (batch) — item.id is the DB topic UUID */
  const approvals = _EVAL_CATEGORIES.flatMap(cat =>
    cat.items.map(item => ({
      monitoring_id: monId,
      topic_id:      item.id,
      obtained:      isZeroed ? false : (document.getElementById(`chk-${item.id}`)?.checked ?? false),
    }))
  );
  if (approvals.length) {
    const { error } = await supabase.from('topic_approval').insert(approvals);
    if (error) throw error;
  }

  /* 4 — analytical_note (batch) — c.id is the DB analytical_note_type UUID */
  const notes = _ANALYTICAL_CRITERIA.map(c => ({
    monitoring_id:           monId,
    analytical_note_type_id: c.id,
    obtained:                document.getElementById(`an-${c.id}`)?.checked ?? true,
    justification:           document.getElementById(`an-just-${c.id}`)?.value.trim() || null,
  }));
  if (notes.length) {
    const { error } = await supabase.from('analytical_note').insert(notes);
    if (error) throw error;
  }

  /* 5 — observations */
  for (const obs of _observations) {
    const obsSCId = scIdByProtocol[obs.proto] ?? scId;
    let errorId = null;
    if (obs.typeCode === 'E' && obs.errorTypeId) {
      errorId = crypto.randomUUID();
      const { error: errErr } = await supabase
        .from('error').insert({ id: errorId, error_type_id: obs.errorTypeId });
      if (errErr) throw errErr;
    }
    const { error } = await supabase.from('monitoring_observation').insert({
      monitoring_id:       monId,
      service_chat_id:     obsSCId,
      observation_type_id: obs.typeId,
      eval_criteria_id:    obs.criteriaId || null,
      error_id:            errorId,
      author_id:           user.id,
      content:             obs.text,
    });
    if (error) throw error;
  }

  /* 6 — critical observation for zeroing */
  if (isZeroed && resetData) {
    const critErrId = crypto.randomUUID();
    const { error: critErrErr } = await supabase
      .from('error').insert({ id: critErrId, error_type_id: resetData.errorTypeId });
    if (critErrErr) throw critErrErr;

    let content = resetData.justification;
    if (resetData.datetime) content = `[Horário: ${resetData.datetime}] ${content}`;
    const zeroScId = (resetData.protocol && scIdByProtocol[resetData.protocol]) ? scIdByProtocol[resetData.protocol] : scId;

    const { error } = await supabase.from('monitoring_observation').insert({
      monitoring_id:       monId,
      service_chat_id:     zeroScId,
      observation_type_id: _obsTypeMap['E'],
      eval_criteria_id:    null,
      error_id:            critErrId,
      author_id:           user.id,
      content,
    });
    if (error) throw error;
  }

  return monId;
}

/* ── render() ─────────────────────────────── */
const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

export function render() {
  if (!_EVAL_CATEGORIES.length) {
    return `
      <div class="page-enter"
           style="display:flex;align-items:center;justify-content:center;height:300px;
                  gap:12px;color:var(--text-secondary)">
        <div class="boot-spinner" style="width:20px;height:20px;border-width:2px"></div>
        Carregando formulário…
      </div>`;
  }

  const { weekNumber, referenceMonth } = computeMonitoringWeek(new Date());
  const refDate   = new Date(`${referenceMonth}T12:00:00`);
  const weekLabel = `Sem. ${weekNumber} · ${MONTH_NAMES[refDate.getMonth()]}`;

  const categorySections = _EVAL_CATEGORIES.map(cat => renderCategory(cat)).join('');

  const analyticalRows = _ANALYTICAL_CRITERIA.map(c => `
    <div class="analytical-item">
      <div class="analytical-item__name">${c.name}</div>
      <div class="analytical-item__check-wrap">
        <input type="checkbox" class="eval-item__check analytical-check"
          id="an-${c.id}" data-id="${c.id}" checked>
      </div>
      <textarea class="analytical-item__justification" id="an-just-${c.id}" placeholder="Justificativa (opcional)"></textarea>
    </div>
  `).join('');

  return `
    <div class="monitoring-page page-enter">
      <div class="monitoring-header">
        <div class="monitoring-header__title-wrap">
          <div class="monitoring-header__title">Monitoria de Qualidade</div>
        </div>
      </div>

      <div class="monitoring-layout">

        <!-- ══ LEFT COLUMN ══ -->
        <div class="monitoring-main">

          <!-- Timer Δt -->
          <div class="timer-calc">
            <div><div class="timer-calc__label">Cálculo Δt entre tempos</div></div>
            <div class="timer-calc__fields">
              <div class="timer-field">
                <label class="timer-field__label">msg1</label>
                <input class="timer-field__input" id="timer-msg1" type="time" step="1">
              </div>
              <div class="timer-field">
                <label class="timer-field__label">msg2</label>
                <input class="timer-field__input" id="timer-msg2" type="time" step="1">
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
              </select>
            </div>
            <div class="monitoring-number-section">
              <label class="form-label">Monitoria Nº</label>
              <input class="monitoring-number-input" type="number" id="monitoring-number" value="1" min="1">
              <div class="monitoring-week-indicator">${weekLabel}</div>
            </div>
          </div>

          <!-- Attendance info -->
          <div class="attendance-section">
            <div class="attendance-section__header">
              <span class="attendance-section__icon">🔧</span>
              <span class="attendance-section__title">Dados do Atendimento</span>
            </div>

            <!-- Add-form -->
            <div class="attendance-grid" id="sc-form">
              <div class="attendance-field">
                <div class="attendance-field__label">ID / Protocolo <span class="required">*</span></div>
                <input class="attendance-field__input" id="att-id" placeholder="ex: 123456">
              </div>
              <div class="attendance-field">
                <div class="attendance-field__label">Data e hora do início <span class="required">*</span></div>
                <div class="time-input-wrap">
                  <input class="attendance-field__input" id="att-date" type="datetime-local">
                  <button type="button" class="time-input-wrap__btn" tabindex="-1" data-for="att-date">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  </button>
                </div>
              </div>
              <div class="attendance-field">
                <div class="attendance-field__label">Tempo de primeira resposta</div>
                <div class="time-input-wrap">
                  <input class="attendance-field__input" id="att-tmpr" type="time" step="1">
                  <button type="button" class="time-input-wrap__btn" tabindex="-1" data-for="att-tmpr">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </button>
                </div>
              </div>
              <div class="attendance-field">
                <div class="attendance-field__label">Tempo máx. entre respostas</div>
                <div class="time-input-wrap">
                  <input class="attendance-field__input" id="att-tmer" type="time" step="1">
                  <button type="button" class="time-input-wrap__btn" tabindex="-1" data-for="att-tmer">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </button>
                </div>
              </div>
              <div class="attendance-field">
                <div class="attendance-field__label">Tempo de atendimento <span class="required">*</span></div>
                <div class="time-input-wrap">
                  <input class="attendance-field__input" id="att-tma" type="time" step="1">
                  <button type="button" class="time-input-wrap__btn" tabindex="-1" data-for="att-tma">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </button>
                </div>
              </div>
              <div class="attendance-field">
                <div class="attendance-field__label">Avaliação CSAT</div>
                <div class="csat-group">
                  ${[1,2,3,4,5].map(v =>
                    `<label class="csat-option csat-option--${v}">
                      <input type="radio" name="csat" value="${v}">
                      <span class="csat-label">${v}</span>
                    </label>`
                  ).join('')}
                </div>
              </div>
            </div>

            <!-- Add button -->
            <div style="display:flex;justify-content:flex-end;padding:var(--space-3) var(--space-5);border-top:1px solid var(--border-light)">
              <button class="btn btn--primary btn--sm" id="btn-add-sc">+ Adicionar Atendimento</button>
            </div>

            <!-- Bubbles list -->
            <div class="sc-bubbles" id="sc-list">
              <span class="sc-empty-label">Nenhum atendimento adicionado</span>
            </div>
          </div>

          <!-- Score summary -->
          <div class="score-summary" id="score-summary">
            <div>
              <div class="score-summary__title">Pontuação Total</div>
              <div style="display:flex;align-items:baseline;gap:8px">
                <div class="score-summary__value" id="score-total">0</div>
                <div class="score-summary__max">/ ${_TOTAL_MAX_PTS}</div>
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

          <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);margin-top:var(--space-4)">
            ${can(getCurrentUser(), P.NEW_MONITORING_SAVE) ? `
              <button class="btn btn--danger btn--lg btn--ghost" id="btn-reset-monitoring">
                ⚠️ Zerar Monitoria
              </button>` : '<div></div>'}
            <div style="display:flex;gap:var(--space-3)">
              <button class="btn btn--secondary btn--lg" id="btn-cancel-form">Cancelar</button>
              ${can(getCurrentUser(), P.NEW_MONITORING_SAVE) ? `
                <button class="btn btn--primary btn--lg" id="btn-save-monitoring">
                  💾 Salvar Monitoria
                </button>` : ''}
            </div>
          </div>
        </div>

        <!-- ══ RIGHT COLUMN ══ -->
        <div class="monitoring-sidebar">
          <div class="obs-sidebar-panel">
            <div class="obs-sidebar-panel__header">
              <span class="obs-sidebar-panel__title">💬 Observações</span>
              <span class="badge badge--dark" id="obs-count-badge">0</span>
            </div>

            <div class="obs-add-form" id="obs-add-form">
              <div class="obs-add-form__row">
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">Protocolo <span class="required">*</span></label>
                  <select class="form-select" id="obs-proto">
                    <option value="">— selecione —</option>
                  </select>
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
                </select>
              </div>
              <div class="form-group obs-error-field" id="obs-error-field" style="margin-bottom:0">
                <label class="form-label" style="color:var(--color-danger)">Tipo do Erro</label>
                <select class="form-select" id="obs-error-type">
                  <option value="">— selecione —</option>
                </select>
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label">Observação <span class="required">*</span></label>
                <textarea class="form-input" id="obs-text" placeholder="Descreva a observação…"
                          rows="1" style="resize:none;overflow:hidden;line-height:1.5;font-family:var(--font-sans)"></textarea>
              </div>
              <button class="btn btn--primary btn--sm btn--block" id="btn-obs-save" style="margin-top:2px">
                + Adicionar Observação
              </button>
            </div>

            <div class="obs-chat-scrollable" id="obs-chat"></div>
          </div>
        </div>

      </div>

      <!-- Modal: Excluir Atendimento -->
      <div class="modal-overlay modal-overlay--hidden" id="modal-sc-delete-overlay">
        <div class="modal" id="modal-sc-delete">
          <div class="modal__header">
            <div class="modal__title">Excluir Atendimento</div>
            <button class="modal__close" id="btn-sc-delete-close">✕</button>
          </div>
          <div class="modal__body">
            <p style="color:var(--text-primary);font-size:var(--text-sm)">
              Deseja excluir o atendimento <strong id="modal-sc-protocol-label" style="color:var(--brand-green-dark)"></strong> desta monitoria?
            </p>
          </div>
          <div class="modal__footer">
            <button class="btn btn--secondary" id="btn-sc-delete-cancel">Cancelar</button>
            <button class="btn btn--danger" id="btn-sc-delete-confirm">Excluir</button>
          </div>
        </div>
      </div>

      <!-- Modal: Zerar Monitoria -->
      <div class="modal-overlay modal-overlay--hidden" id="modal-reset-overlay">
        <div class="modal" id="modal-reset-monitoring">
          <div class="modal__header">
            <div class="modal__title">Zerar Monitoria</div>
            <button class="modal__close" id="btn-modal-close">✕</button>
          </div>
          <div class="modal__body">
            <div class="form-group">
              <label class="form-label">Tipo de Erro Crítico <span class="required">*</span></label>
              <select class="form-select" id="reset-error-type">
                <option value="">— selecione —</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Protocolo do Atendimento <span class="required">*</span></label>
              <select class="form-select" id="reset-protocol">
                <option value="">— selecione —</option>
              </select>
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
  if (!_EVAL_CATEGORIES.length) return;
  let total = 0;
  _EVAL_CATEGORIES.forEach(cat => {
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
    const pct    = Math.round((earned / cat.totalPts) * 100);
    const prog   = document.getElementById(`prog-${cat.id}`);
    const secPts = document.getElementById(`sec-pts-${cat.id}`);
    if (prog)   { prog.style.width = `${pct}%`; prog.style.background = scoreColor(pct); }
    if (secPts) secPts.textContent = earned;
  });

  _totalEarned = total;
  const pct  = _TOTAL_MAX_PTS ? Math.round((total / _TOTAL_MAX_PTS) * 100) : 0;
  const band = resultBand(pct);

  const bar     = document.getElementById('total-progress-bar');
  const totalEl = document.getElementById('score-total');
  const pctEl   = document.getElementById('score-pct');
  const bandEl  = document.getElementById('score-band');
  if (bar)     { bar.style.width = `${pct}%`; bar.style.background = scoreColor(pct); }
  if (totalEl) totalEl.textContent = total;
  if (pctEl)   pctEl.textContent   = `${pct}%`;
  if (bandEl)  { bandEl.textContent = band.label; bandEl.className = `badge badge--${band.cls}`; }
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
    <div class="obs-bubble-compact obs-bubble-compact--${o.typeCode}">
      <div class="obs-bubble-compact__header">
        <span class="obs-type-tag obs-type-tag--${o.typeCode}">${o.typeCode}</span>
        ${o.criteriaName ? `<span class="obs-bubble-compact__criteria">${o.criteriaName}</span>` : ''}
        ${o.proto ? `<span class="obs-bubble-compact__proto">#${o.proto}</span>` : ''}
      </div>
      <div class="obs-bubble-compact__text">${o.text}</div>
      ${o.errorTypeName ? `<div style="font-size:10px;margin-top:3px;color:var(--color-danger);font-weight:600">⚠ ${o.errorTypeName}</div>` : ''}
      <button class="obs-bubble-compact__delete" data-idx="${idx}" title="Remover">✕</button>
    </div>
  `).join('');

  area.querySelectorAll('.obs-bubble-compact__delete').forEach(btn => {
    btn.addEventListener('click', () => {
      _observations.splice(Number(btn.dataset.idx), 1);
      saveDraft();
      renderObsChat();
    });
  });
}

/* ── init ─────────────────────────────────── */
/* ── Obs protocol select sync ────────────── */
function renderObsProtoSelect() {
  const sel = document.getElementById('obs-proto');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">— selecione —</option>` +
    _serviceChats.map(s => `<option value="${s.protocol}">${s.protocol}</option>`).join('');
  if (_serviceChats.some(s => s.protocol === current)) sel.value = current;
}

/* ── Service chat list render ─────────────── */
function renderServiceChatList() {
  const container = document.getElementById('sc-list');
  if (!container) return;
  renderObsProtoSelect();
  if (!_serviceChats.length) {
    container.innerHTML = `<span class="sc-empty-label">Nenhum atendimento adicionado</span>`;
    return;
  }
  container.innerHTML = _serviceChats.map(sc => {
    const dtStr = sc.startedAt
      ? new Date(sc.startedAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '';
    return `
      <div class="sc-bubble">
        <span class="sc-bubble__proto">#${sc.protocol}</span>
        ${dtStr ? `<span class="sc-bubble__date">${dtStr}</span>` : ''}
        <button class="sc-bubble__del" data-protocol="${sc.protocol}" title="Excluir">✕</button>
      </div>`;
  }).join('');

  container.querySelectorAll('.sc-bubble__del').forEach(btn => {
    btn.addEventListener('click', () => openScDeleteModal(btn.dataset.protocol));
  });
}

function openScDeleteModal(protocol) {
  _pendingDeleteProtocol = protocol;
  const label = document.getElementById('modal-sc-protocol-label');
  if (label) label.textContent = `#${protocol}`;
  document.getElementById('modal-sc-delete-overlay')?.classList.remove('modal-overlay--hidden');
  const appMain = document.querySelector('.app-main');
  if (appMain) appMain.style.overflowY = 'hidden';
}

function closeScDeleteModal() {
  _pendingDeleteProtocol = null;
  document.getElementById('modal-sc-delete-overlay')?.classList.add('modal-overlay--hidden');
  const appMain = document.querySelector('.app-main');
  if (appMain) appMain.style.overflowY = '';
}

export async function init() {
  /* Reset dados do usuário */
  _pendingDeleteProtocol = null;

  /* Restaura rascunho salvo ou começa limpo */
  const _draft = loadDraft();
  _serviceChats = _draft?.serviceChats ?? [];
  _observations = _draft?.observations ?? [];

  /* ── Fetch ref data on every visit — guarantees active topics/criteria are current ── */
  const [empRes, topicRes, obsTypeRes, evalCrRes, analTypeRes, errTypeRes] = await Promise.all([
    supabase.from('employees').select('id, name').eq('active', true).order('name'),
    supabase.from('topic').select('id, item, eval_criteria_id, points, description').eq('active', true),
    supabase.from('observation_type').select('id, code').eq('active', true),
    supabase.from('eval_criteria').select('id, name').eq('active', true).order('name'),
    supabase.from('analytical_note_type').select('id, name').eq('active', true),
    supabase.from('error_type').select('id, name, critical').eq('active', true).order('name'),
  ]);

  _employees       = empRes.data        ?? [];
  _topics          = topicRes.data      ?? [];
  _evalCriteria    = evalCrRes.data     ?? [];
  _analyticalTypes = analTypeRes.data   ?? [];
  _errorTypes      = errTypeRes.data    ?? [];

  const codeToKey = { default: 'G', improvable_by: 'O', excelled_by: 'A', failed_by: 'E' };
  _obsTypeMap = {};
  for (const row of (obsTypeRes.data ?? [])) {
    const key = codeToKey[row.code];
    if (key) _obsTypeMap[key] = row.id;
  }

  _EVAL_CATEGORIES = _evalCriteria.map(ec => {
    const items = _topics
      .filter(t => t.eval_criteria_id === ec.id)
      .map(t => ({ id: t.id, name: t.item, pts: t.points ?? 0, description: t.description ?? '' }));
    return { id: ec.id, name: ec.name, items, totalPts: items.reduce((s, i) => s + i.pts, 0) };
  });
  _TOTAL_MAX_PTS       = _EVAL_CATEGORIES.reduce((s, c) => s + c.totalPts, 0);
  _ANALYTICAL_CRITERIA = _analyticalTypes.map(t => ({ id: t.id, name: t.name }));

  /* Re-render now that fresh data is available */
  const main = document.getElementById('main-content');
  if (main) main.innerHTML = render();

  /* ── Restore transient state into the (now fully populated) DOM ── */
  recalcScores();
  renderObsChat();
  renderServiceChatList();
  restoreDraftCheckboxes(_draft);

  /* ── Populate selects ───────────────────── */
  const collabSel = document.getElementById('collab-select');
  if (collabSel && _employees.length) {
    collabSel.innerHTML = `<option value="">— selecione —</option>` +
      _employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  }

  const criteriaSel = document.getElementById('obs-criteria');
  if (criteriaSel) {
    criteriaSel.innerHTML = `<option value="">— nenhum —</option>` +
      _evalCriteria.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  const nonCriticalErrors = _errorTypes.filter(e => !e.critical);
  const criticalErrors    = _errorTypes.filter(e => e.critical);

  const obsErrSel = document.getElementById('obs-error-type');
  if (obsErrSel) {
    obsErrSel.innerHTML = `<option value="">— selecione —</option>` +
      nonCriticalErrors.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  }

  const resetErrSel = document.getElementById('reset-error-type');
  if (resetErrSel) {
    resetErrSel.innerHTML = `<option value="">— selecione —</option>` +
      criticalErrors.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  }

  /* ── Modal helpers ──────────────────────── */
  const appMain = document.querySelector('.app-main');

  function openResetModal() {
    document.getElementById('modal-reset-overlay')?.classList.remove('modal-overlay--hidden');
    if (appMain) appMain.style.overflowY = 'hidden';
  }
  function closeResetModal() {
    document.getElementById('modal-reset-overlay')?.classList.add('modal-overlay--hidden');
    if (appMain) appMain.style.overflowY = '';
    document.getElementById('reset-error-type').value    = '';
    document.getElementById('reset-protocol').value      = '';
    document.getElementById('reset-datetime').value      = '';
    document.getElementById('reset-justification').value = '';
  }

  document.getElementById('modal-reset-overlay')?.addEventListener('click', closeResetModal);
  document.getElementById('modal-reset-monitoring')?.addEventListener('click', e => e.stopPropagation());
  document.getElementById('btn-modal-close')?.addEventListener('click', closeResetModal);
  document.getElementById('btn-reset-cancel')?.addEventListener('click', closeResetModal);

  /* ── CSAT toggle-off: clicking an already-selected label deselects it ── */
  document.querySelectorAll('input[name="csat"]').forEach(radio => {
    radio.addEventListener('click', function () {
      if (this.dataset.wasChecked === 'true') {
        this.checked = false;
        this.dataset.wasChecked = 'false';
      } else {
        document.querySelectorAll('input[name="csat"]').forEach(r => r.dataset.wasChecked = 'false');
        this.dataset.wasChecked = 'true';
      }
    });
  });

  /* ── Add service chat ───────────────────── */
  document.getElementById('btn-add-sc')?.addEventListener('click', () => {
    const collabId  = document.getElementById('collab-select')?.value;
    if (!collabId)  { toast.warning('Atenção', 'Selecione um colaborador antes de adicionar atendimentos.'); return; }

    const protocol  = document.getElementById('att-id')?.value.trim();
    const startedAt = document.getElementById('att-date')?.value;
    const tma       = document.getElementById('att-tma')?.value;

    if (!protocol)  { toast.warning('Atenção', 'Informe o protocolo do atendimento.'); return; }
    if (!startedAt) { toast.warning('Atenção', 'Informe a data e hora do atendimento.'); return; }
    if (!tma)       { toast.warning('Atenção', 'Informe o tempo de atendimento.'); return; }

    if (_serviceChats.some(s => s.protocol === protocol)) {
      toast.warning('Atenção', `Protocolo ${protocol} já foi adicionado.`);
      return;
    }

    const tmpr = document.getElementById('att-tmpr')?.value || null;
    const tmer = document.getElementById('att-tmer')?.value || null;
    const csatChecked = document.querySelector('input[name="csat"]:checked');
    const csat = csatChecked ? Number(csatChecked.value) : null;

    _serviceChats.push({ protocol, startedAt, tmpr: normalizeTime(tmpr), tmer: normalizeTime(tmer), tma: normalizeTime(tma), csat });
    renderServiceChatList();
    saveDraft();

    /* Reset form fields */
    document.getElementById('att-id').value   = '';
    document.getElementById('att-date').value = '';
    document.getElementById('att-tmpr').value = '';
    document.getElementById('att-tmer').value = '';
    document.getElementById('att-tma').value  = '';
    document.querySelectorAll('input[name="csat"]').forEach(r => { r.checked = false; r.dataset.wasChecked = 'false'; });
    document.getElementById('att-id')?.focus();
  });

  /* ── Delete service chat modal ──────────── */
  document.getElementById('modal-sc-delete-overlay')?.addEventListener('click', closeScDeleteModal);
  document.getElementById('modal-sc-delete')?.addEventListener('click', e => e.stopPropagation());
  document.getElementById('btn-sc-delete-close')?.addEventListener('click', closeScDeleteModal);
  document.getElementById('btn-sc-delete-cancel')?.addEventListener('click', closeScDeleteModal);
  document.getElementById('btn-sc-delete-confirm')?.addEventListener('click', () => {
    if (_pendingDeleteProtocol) {
      _serviceChats = _serviceChats.filter(s => s.protocol !== _pendingDeleteProtocol);
      renderServiceChatList();
      saveDraft();
    }
    closeScDeleteModal();
  });

  /* ── Zerar Monitoria ────────────────────── */
  document.getElementById('btn-reset-monitoring')?.addEventListener('click', () => {
    if (!can(getCurrentUser(), P.NEW_MONITORING_SAVE)) return;
    if (!validateRequiredFields()) return;
    /* Populate protocol select in reset modal */
    const resetProtoEl = document.getElementById('reset-protocol');
    if (resetProtoEl) {
      resetProtoEl.innerHTML = `<option value="">— selecione —</option>` +
        _serviceChats.map(s => `<option value="${s.protocol}">#${s.protocol}</option>`).join('');
    }
    document.querySelectorAll('.eval-item__check, .analytical-check').forEach(chk => { chk.checked = false; });
    recalcScores();
    openResetModal();
  });

  document.getElementById('btn-reset-confirm')?.addEventListener('click', async () => {
    const errorTypeId    = document.getElementById('reset-error-type')?.value;
    const protocol       = document.getElementById('reset-protocol')?.value.trim();
    const justification  = document.getElementById('reset-justification')?.value.trim();
    const datetime       = document.getElementById('reset-datetime')?.value;

    if (!errorTypeId)   { toast.warning('Atenção', 'Selecione o tipo de erro crítico.'); return; }
    if (!protocol)      { toast.warning('Atenção', 'Informe o protocolo do atendimento.'); return; }
    if (!justification) { toast.warning('Atenção', 'Preencha a justificativa.'); return; }

    const btn = document.getElementById('btn-reset-confirm');
    btn.disabled = true;
    btn.textContent = 'Salvando…';
    try {
      await persistMonitoring({ isZeroed: true, resetData: { errorTypeId, justification, protocol, datetime } });
      clearDraft();
      toast.success('Monitoria zerada', 'Registrada com sucesso.');
      closeResetModal();
      setTimeout(() => navigate('consulta'), 1200);
    } catch (err) {
      toast.error('Erro', err.message ?? 'Não foi possível salvar.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirmar Zeramento';
    }
  });

  /* ── Save Monitoria ─────────────────────── */
  document.getElementById('btn-cancel-form')?.addEventListener('click', resetForm);

  document.getElementById('btn-save-monitoring')?.addEventListener('click', async () => {
    if (!can(getCurrentUser(), P.NEW_MONITORING_SAVE)) return;
    if (!validateRequiredFields()) return;

    const btn = document.getElementById('btn-save-monitoring');
    btn.disabled = true;
    btn.textContent = 'Salvando…';
    try {
      await persistMonitoring();
      clearDraft();
      const pct = _TOTAL_MAX_PTS ? Math.round(_totalEarned / _TOTAL_MAX_PTS * 100) : 0;
      toast.success('Monitoria salva!',
        `${_totalEarned}/${_TOTAL_MAX_PTS} pts (${pct}%) · ${_observations.length} obs.`);
      setTimeout(() => navigate('consulta'), 1200);
    } catch (err) {
      console.error('[save-monitoring]', err);
      toast.error('Erro ao salvar', err.message || err.code || JSON.stringify(err));
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Salvar Monitoria';
    }
  });

  /* ── Custom picker buttons ─────────────── */
  document.querySelectorAll('.time-input-wrap__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.for);
      if (!input) return;
      try { input.showPicker(); } catch { input.focus(); }
    });
  });

  /* ── Time field auto-format (digits → HH:MM:SS) ── */
  function autoFormatTime(input) {
    const digits = input.value.replace(/\D/g, '');
    if (!digits) return;
    const padded = digits.padStart(6, '0').slice(-6);
    input.value = `${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4, 6)}`;
  }
  ['att-tmpr', 'att-tmer', 'att-tma'].forEach(id => {
    document.getElementById(id)?.addEventListener('blur', e => autoFormatTime(e.target));
  });

  /* ── Timer Δt ───────────────────────────── */
  document.getElementById('timer-msg1').value = '00:00:00';
  document.getElementById('timer-msg2').value = '00:00:00';

  const calcDelta = () => {
    const t1 = parseHHMMSS(document.getElementById('timer-msg1')?.value || '0');
    const t2 = parseHHMMSS(document.getElementById('timer-msg2')?.value || '0');
    const el = document.getElementById('timer-delta');
    if (el) el.textContent = formatHHMMSS(Math.abs(t2 - t1));
  };
  document.getElementById('timer-msg1')?.addEventListener('input', calcDelta);
  document.getElementById('timer-msg2')?.addEventListener('input', calcDelta);

  /* ── Collaborator → avatar ──────────────── */
  document.getElementById('collab-select')?.addEventListener('change', async e => {
    const av  = document.getElementById('collab-avatar');
    const sel = e.target.options[e.target.selectedIndex];
    if (av) {
      av.textContent = sel.text
        ? sel.text.trim().split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
        : '?';
    }

    const numInput = document.getElementById('monitoring-number');
    if (!numInput) return;

    const collabId = e.target.value;
    if (!collabId) { numInput.value = 1; return; }

    const { data } = await supabase
      .from('monitoring')
      .select('number')
      .eq('employee_id', collabId)
      .order('number', { ascending: false })
      .limit(1)
      .maybeSingle();

    numInput.value = data ? data.number + 1 : 1;
    saveDraft();
  });

  document.getElementById('monitoring-number')?.addEventListener('change', saveDraft);

  /* ── Eval checkboxes ────────────────────── */
  document.querySelectorAll('.eval-item__check').forEach(chk => {
    chk.addEventListener('change', () => { recalcScores(); saveDraft(); });
  });

  /* ── Analytical: justification required when unchecked ── */
  document.querySelectorAll('.analytical-check').forEach(chk => {
    chk.addEventListener('change', () => {
      const justEl = document.getElementById(`an-just-${chk.dataset.id}`);
      if (justEl) justEl.placeholder = chk.checked ? 'Justificativa (opcional)' : 'Justificativa obrigatória…';
      saveDraft();
    });
  });

  /* ── Analytical justifications — auto-resize + salvar ── */
  _ANALYTICAL_CRITERIA.forEach(c => {
    const el = document.getElementById(`an-just-${c.id}`);
    if (!el) return;
    el.addEventListener('input', () => { autoResize(el); saveDraft(); });
  });

  /* ── obs-text — auto-resize ── */
  const obsTextEl = document.getElementById('obs-text');
  if (obsTextEl) obsTextEl.addEventListener('input', () => autoResize(obsTextEl));

  /* ── Section collapse ───────────────────── */
  document.querySelectorAll('.eval-section__header').forEach(hdr => {
    hdr.addEventListener('click', e => {
      if (e.target.closest('.eval-item__check, label')) return;
      hdr.closest('.eval-section')?.classList.toggle('collapsed');
    });
  });

  /* ── Obs type → show/hide error field ───── */
  document.getElementById('obs-type')?.addEventListener('change', e => {
    document.getElementById('obs-error-field')?.classList.toggle('visible', e.target.value === 'E');
  });

  /* ── Add observation ────────────────────── */
  document.getElementById('btn-obs-save')?.addEventListener('click', () => {
    const proto = document.getElementById('obs-proto')?.value.trim();
    if (!proto) { toast.warning('Atenção', 'Informe o protocolo da observação.'); return; }

    const text = document.getElementById('obs-text')?.value.trim();
    if (!text) { toast.warning('Atenção', 'Preencha o texto da observação.'); return; }

    const typeCode = document.getElementById('obs-type')?.value ?? 'G';
    const typeId   = _obsTypeMap[typeCode] ?? null;

    const criteriaEl   = document.getElementById('obs-criteria');
    const criteriaId   = criteriaEl?.value ?? '';
    const criteriaName = criteriaId ? criteriaEl?.options[criteriaEl.selectedIndex]?.text : '';

    let errorTypeId = '', errorTypeName = '';
    if (typeCode === 'E') {
      const errEl = document.getElementById('obs-error-type');
      if (!errEl?.value) { toast.warning('Atenção', 'Selecione o tipo de erro.'); return; }
      errorTypeId   = errEl.value;
      errorTypeName = errEl.options[errEl.selectedIndex]?.text ?? '';
    }

    _observations.push({
      typeCode, typeId,
      criteriaId, criteriaName,
      errorTypeId, errorTypeName,
      proto,
      text,
    });

    const _obsEl = document.getElementById('obs-text');
    if (_obsEl) { _obsEl.value = ''; _obsEl.style.height = 'auto'; }
    saveDraft();
    renderObsChat();
  });

  /* ── Restaurar checkboxes do rascunho ─────── */
  restoreDraftCheckboxes(_draft);
}
