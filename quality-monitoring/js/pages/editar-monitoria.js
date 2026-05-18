/* ============================================================
   EDITAR MONITORIA — Edição e exclusão de uma monitoria
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { supabase } from '../supabase.js';
import { getRouteParams, navigate } from '../router.js';
import { formatDate, resultBand, scoreColor } from '../utils/formatters.js';
import { toast } from '../components/toast.js';

/* ── State ────────────────────────────────── */
let _monitoring      = null;   // raw monitoring record with nested data
let _employee        = null;   // {id, name}
let _evalCriteria    = [];     // [{id, name}]
let _topicMap        = {};     // {topicId: {id, item, points, eval_criteria_id}}
let _analyticalTypes = [];     // [{id, name}]

const OBS = {
  default:       { label: 'Geral',        color: 'var(--text-secondary)' },
  improvable_by: { label: 'Oportunidade', color: '#2563eb' },
  excelled_by:   { label: 'Acerto',       color: 'var(--brand-green-dark)' },
  failed_by:     { label: 'Erro',         color: 'var(--color-danger)' },
};

/* ── Fetch ────────────────────────────────── */
async function loadData(monId) {
  const [monRes, ecRes, topicRes, anTypeRes] = await Promise.all([
    supabase.from('monitoring')
      .select(`
        id, date, number, zeroed, employee_id,
        employee:employee_id(id, name),
        topic_approval(topic_id, obtained),
        analytical_note(analytical_note_type_id, obtained, justification),
        service_chat(id, protocol, started_at, service_time, first_response_time, max_response_time, csat),
        monitoring_observation(
          id, content,
          observation_type(code),
          eval_criteria(name),
          service_chat(protocol)
        )
      `)
      .eq('id', monId)
      .single(),
    supabase.from('eval_criteria').select('id, name').eq('active', true),
    supabase.from('topic').select('id, item, points, eval_criteria_id').eq('active', true),
    supabase.from('analytical_note_type').select('id, name').eq('active', true),
  ]);

  if (monRes.error) throw monRes.error;

  _monitoring      = monRes.data;
  _employee        = _monitoring.employee ?? null;
  _evalCriteria    = ecRes.data       ?? [];
  _topicMap        = Object.fromEntries((topicRes.data ?? []).map(t => [t.id, t]));
  _analyticalTypes = anTypeRes.data   ?? [];
}

/* ── render() ─────────────────────────────── */
export function render() {
  return `
    <div class="page-enter">
      <div class="page-header">
        <div class="page-title">Editar Monitoria</div>
        <div class="page-subtitle">Carregando…</div>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;height:300px;gap:12px;color:var(--text-secondary)">
        <div class="boot-spinner" style="width:20px;height:20px;border-width:2px"></div>
        Carregando monitoria…
      </div>
    </div>`;
}

function renderForm() {
  const mon = _monitoring;
  const emp = _employee;

  /* Build topic approval map: topicId → obtained */
  const taMap = Object.fromEntries(
    (mon.topic_approval ?? []).map(ta => [ta.topic_id, ta.obtained])
  );

  /* Build analytical note map: typeId → {obtained, justification} */
  const anMap = Object.fromEntries(
    (mon.analytical_note ?? []).map(an => [an.analytical_note_type_id, an])
  );

  /* Topics by category */
  const topicsByCategory = _evalCriteria.map(ec => {
    const items = Object.values(_topicMap).filter(t => t.eval_criteria_id === ec.id);
    return { ec, items };
  }).filter(g => g.items.length);

  const topicsHtml = topicsByCategory.map(({ ec, items }) => `
    <div class="eval-section">
      <div class="eval-section__title">${ec.name}</div>
      ${items.map(t => {
        const checked = taMap[t.id] ?? false;
        return `
          <label class="eval-item">
            <input type="checkbox" class="eval-item__check topic-check"
                   data-topic-id="${t.id}" data-pts="${t.points}" ${checked ? 'checked' : ''}>
            <div class="eval-item__info">
              <span class="eval-item__name">${t.item}</span>
              <span class="eval-item__pts">${t.points} pts</span>
            </div>
          </label>`;
      }).join('')}
    </div>`).join('');

  /* Analytical notes */
  const analyticalHtml = _analyticalTypes.map(type => {
    const an       = anMap[type.id];
    const obtained = an?.obtained ?? true;
    const just     = an?.justification ?? '';
    return `
      <div class="analytical-item" id="an-wrap-${type.id}">
        <label class="analytical-item__label">
          <input type="checkbox" class="analytical-check" data-id="${type.id}" ${obtained ? 'checked' : ''}>
          <span>${type.name}</span>
        </label>
        <input class="form-input form-input--sm" type="text"
               id="an-just-${type.id}"
               placeholder="${obtained ? 'Justificativa (opcional)' : 'Justificativa obrigatória…'}"
               value="${just}"
               style="${obtained ? 'opacity:.5' : ''}">
      </div>`;
  }).join('');

  /* Service chats (read-only) */
  const scHtml = (mon.service_chat ?? []).length
    ? `<table class="data-table" style="font-size:var(--text-xs)">
        <thead><tr><th>Protocolo</th><th>TMA</th><th>TMPr</th><th>TMEr</th><th>CSAT</th></tr></thead>
        <tbody>
          ${(mon.service_chat ?? []).map(sc => `
            <tr>
              <td class="muted" style="font-family:var(--font-mono)">${sc.protocol ?? '—'}</td>
              <td>${sc.service_time ?? '—'}</td>
              <td>${sc.first_response_time ?? '—'}</td>
              <td>${sc.max_response_time ?? '—'}</td>
              <td style="text-align:center">${sc.csat ? sc.csat + ' ★' : '—'}</td>
            </tr>`).join('')}
        </tbody>
       </table>`
    : `<div style="color:var(--text-tertiary);font-size:var(--text-xs)">Nenhum atendimento registrado</div>`;

  /* Observations (read-only) */
  const obsHtml = (mon.monitoring_observation ?? []).length
    ? (mon.monitoring_observation ?? []).map(o => {
        const t = OBS[o.observation_type?.code] ?? OBS.default;
        return `
          <div style="padding:var(--space-2) 0;border-bottom:1px solid var(--border-light);font-size:var(--text-xs)">
            <div style="display:flex;gap:var(--space-2);margin-bottom:2px">
              <span style="font-weight:700;color:${t.color}">${t.label}</span>
              ${o.eval_criteria?.name ? `<span style="color:var(--text-tertiary)">· ${o.eval_criteria.name}</span>` : ''}
              ${o.service_chat?.protocol ? `<span style="color:var(--text-tertiary);font-family:var(--font-mono)">· ${o.service_chat.protocol}</span>` : ''}
            </div>
            <div>${o.content}</div>
          </div>`;
      }).join('')
    : `<div style="color:var(--text-tertiary);font-size:var(--text-xs)">Nenhuma observação</div>`;

  return `
    <div class="page-enter">
      <div class="page-header">
        <div>
          <div class="page-title">Editando Monitoria #${mon.number}</div>
          <div class="page-subtitle">${emp?.name ?? '—'} · ${formatDate(mon.date)}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 380px;gap:var(--space-5);align-items:start">

        <!-- Left: editable fields -->
        <div style="display:flex;flex-direction:column;gap:var(--space-5)">

          <!-- Date & Number -->
          <div class="panel">
            <div class="panel__header"><div class="panel__title">Dados da Monitoria</div></div>
            <div class="panel__body" style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4)">
              <div class="form-group">
                <label class="form-label">Data</label>
                <input class="form-input" type="date" id="edit-date" value="${mon.date}">
              </div>
              <div class="form-group">
                <label class="form-label">Nº da Monitoria</label>
                <input class="form-input" type="number" id="edit-number" value="${mon.number}" min="1">
              </div>
            </div>
          </div>

          <!-- Topics -->
          <div class="panel">
            <div class="panel__header"><div class="panel__title">Tópicos Avaliados</div></div>
            <div class="panel__body">
              <div class="eval-sections">${topicsHtml}</div>
            </div>
          </div>

          <!-- Analytical -->
          <div class="panel">
            <div class="panel__header"><div class="panel__title">Critérios Analíticos</div></div>
            <div class="panel__body">
              <div style="display:flex;flex-direction:column;gap:var(--space-3)">${analyticalHtml}</div>
            </div>
          </div>

        </div>

        <!-- Right: read-only info + actions -->
        <div style="display:flex;flex-direction:column;gap:var(--space-5)">

          <!-- Actions -->
          <div class="panel">
            <div class="panel__body" style="display:flex;flex-direction:column;gap:var(--space-3)">
              <button class="btn btn--primary btn--block" id="btn-save">Salvar alterações</button>
              <button class="btn btn--ghost btn--block" id="btn-cancel">Cancelar</button>
              <hr style="border:none;border-top:1px solid var(--border-light);margin:var(--space-1) 0">
              <button class="btn btn--block" id="btn-delete"
                      style="background:var(--color-danger-bg);color:var(--color-danger);border:1px solid var(--color-danger)">
                Excluir monitoria
              </button>
            </div>
          </div>

          <!-- Service chats (read-only) -->
          <div class="panel">
            <div class="panel__header"><div class="panel__title">Atendimentos</div></div>
            <div class="panel__body">${scHtml}</div>
          </div>

          <!-- Observations (read-only) -->
          <div class="panel">
            <div class="panel__header">
              <div class="panel__title">Observações</div>
              <span class="badge badge--neutral">${(mon.monitoring_observation ?? []).length}</span>
            </div>
            <div class="panel__body">${obsHtml}</div>
          </div>

        </div>
      </div>

      <!-- Delete confirm modal -->
      <div id="delete-modal" class="modal-backdrop hidden">
        <div class="modal" style="max-width:400px">
          <div class="modal__header">
            <div class="modal__title">Excluir monitoria?</div>
          </div>
          <div class="modal__body">
            <p style="color:var(--text-secondary);font-size:var(--text-sm)">
              Esta ação é irreversível. A monitoria <strong>#${mon.number}</strong> de
              <strong>${emp?.name ?? '—'}</strong> e todos os seus registros associados
              (tópicos, observações, atendimentos) serão excluídos permanentemente.
            </p>
          </div>
          <div class="modal__footer" style="justify-content:flex-end">
            <button class="btn btn--ghost" id="btn-delete-cancel">Cancelar</button>
            <button class="btn" id="btn-delete-confirm"
                    style="background:var(--color-danger);color:#fff;border:none">
              Confirmar exclusão
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

/* ── Save ─────────────────────────────────── */
async function persistEdit() {
  const btn = document.getElementById('btn-save');
  btn.disabled    = true;
  btn.textContent = 'Salvando…';

  try {
    const date   = document.getElementById('edit-date')?.value;
    const number = Number(document.getElementById('edit-number')?.value);
    const monId  = _monitoring.id;

    if (!date) throw new Error('Informe a data da monitoria.');
    if (!number || number < 1) throw new Error('Informe um número de monitoria válido.');

    /* Validate analytical justifications */
    for (const type of _analyticalTypes) {
      const chk  = document.querySelector(`.analytical-check[data-id="${type.id}"]`);
      const just = document.getElementById(`an-just-${type.id}`)?.value.trim();
      if (chk && !chk.checked && !just) {
        throw new Error(`Justificativa obrigatória: "${type.name}"`);
      }
    }

    /* 1 — Update monitoring header */
    const { error: monErr } = await supabase
      .from('monitoring')
      .update({ date, number })
      .eq('id', monId);
    if (monErr) throw monErr;

    /* 2 — Re-insert topic approvals */
    await supabase.from('topic_approval').delete().eq('monitoring_id', monId);
    const approvals = [];
    document.querySelectorAll('.topic-check').forEach(chk => {
      approvals.push({ monitoring_id: monId, topic_id: chk.dataset.topicId, obtained: chk.checked });
    });
    if (approvals.length) {
      const { error: taErr } = await supabase.from('topic_approval').insert(approvals);
      if (taErr) throw taErr;
    }

    /* 3 — Re-insert analytical notes */
    await supabase.from('analytical_note').delete().eq('monitoring_id', monId);
    const notes = _analyticalTypes.map(type => {
      const chk  = document.querySelector(`.analytical-check[data-id="${type.id}"]`);
      const just = document.getElementById(`an-just-${type.id}`)?.value.trim();
      return {
        monitoring_id:            monId,
        analytical_note_type_id:  type.id,
        obtained:                 chk?.checked ?? true,
        justification:            just || null,
      };
    });
    const { error: anErr } = await supabase.from('analytical_note').insert(notes);
    if (anErr) throw anErr;

    toast.success('Salvo!', 'Monitoria atualizada com sucesso.');
    navigate('registros');
  } catch (err) {
    toast.warning('Erro', err.message ?? 'Não foi possível salvar.');
    btn.disabled    = false;
    btn.textContent = 'Salvar alterações';
  }
}

/* ── Delete ───────────────────────────────── */
async function deleteMonitoring() {
  const monId = _monitoring.id;
  const btn   = document.getElementById('btn-delete-confirm');
  btn.disabled    = true;
  btn.textContent = 'Excluindo…';

  try {
    /* Collect error_ids before deleting observations */
    const { data: obsRows } = await supabase
      .from('monitoring_observation')
      .select('error_id')
      .eq('monitoring_id', monId)
      .not('error_id', 'is', null);

    /* Delete observations (NO ACTION constraint) */
    const { error: obsErr } = await supabase
      .from('monitoring_observation')
      .delete()
      .eq('monitoring_id', monId);
    if (obsErr) throw obsErr;

    /* Delete orphaned errors */
    const errorIds = (obsRows ?? []).map(r => r.error_id).filter(Boolean);
    if (errorIds.length) {
      await supabase.from('error').delete().in('id', errorIds);
    }

    /* Delete service chats (NO ACTION constraint) */
    const { error: scErr } = await supabase
      .from('service_chat')
      .delete()
      .eq('monitoring_id', monId);
    if (scErr) throw scErr;

    /* Delete monitoring — topic_approval and analytical_note cascade automatically */
    const { error: monErr } = await supabase
      .from('monitoring')
      .delete()
      .eq('id', monId);
    if (monErr) throw monErr;

    toast.success('Excluído!', 'Monitoria removida com sucesso.');
    navigate('registros');
  } catch (err) {
    toast.warning('Erro', err.message ?? 'Não foi possível excluir.');
    btn.disabled    = false;
    btn.textContent = 'Confirmar exclusão';
  }
}

/* ── Event binding ────────────────────────── */
function bindEvents() {
  document.getElementById('btn-save')?.addEventListener('click', persistEdit);
  document.getElementById('btn-cancel')?.addEventListener('click', () => navigate('registros'));

  document.getElementById('btn-delete')?.addEventListener('click', () => {
    document.getElementById('delete-modal')?.classList.remove('hidden');
  });
  document.getElementById('btn-delete-cancel')?.addEventListener('click', () => {
    document.getElementById('delete-modal')?.classList.add('hidden');
  });
  document.getElementById('btn-delete-confirm')?.addEventListener('click', deleteMonitoring);

  /* Analytical: dim justification when checked */
  document.querySelectorAll('.analytical-check').forEach(chk => {
    chk.addEventListener('change', () => {
      const justEl = document.getElementById(`an-just-${chk.dataset.id}`);
      if (!justEl) return;
      justEl.style.opacity      = chk.checked ? '.5' : '1';
      justEl.placeholder        = chk.checked ? 'Justificativa (opcional)' : 'Justificativa obrigatória…';
    });
  });
}

/* ── init ─────────────────────────────────── */
export async function init() {
  const { id: monId } = getRouteParams();
  if (!monId) { navigate('registros'); return; }

  /* Only analysts can edit */
  const u = getCurrentUser();
  if (!u || (u.role !== 'analista' && (u.accessLevel ?? 0) < 4)) {
    navigate('registros');
    return;
  }

  try {
    await loadData(monId);
  } catch (err) {
    console.error('[editar-monitoria]', err);
    toast.warning('Erro', 'Não foi possível carregar a monitoria.');
    navigate('registros');
    return;
  }

  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = renderForm();
  bindEvents();
}
