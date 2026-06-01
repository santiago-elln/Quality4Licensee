/* ============================================================
   PERFIL — Perfil individual do colaborador
   ============================================================ */
import { getCurrentUser } from '../auth.js';
import { getRouteParams } from '../router.js';
import { supabase } from '../supabase.js';
import { can, P } from '../utils/permissions.js';
import {
  formatDate, resultBand, scoreColor, scoreColorHex, getInitials,
} from '../utils/formatters.js';
import { renderRadarChart, renderHistoryChartFull, destroyAll } from '../components/charts.js';
import { toast } from '../components/toast.js';

/* ── Module state ─────────────────────────── */
let _employee    = null;   // {id, name, team_id, avatar_url}
let _supervisor  = null;   // {id, name}
let _monitorings = [];     // [{id, date, zeroed, pct, radarPcts, avgCsat}]
let _obsLog      = [];     // [{typeCode, typeLabel, criteriaName, content, protocol, monDate}]
let _evalCriteria = [];    // [{id, name}]  — cached across navigations
let _topicMap    = {};     // {topicId: {eval_criteria_id, points}} — cached
let _loadedEmpId = null;   // cache key

/* ── Avatar crop state ────────────────────── */
let _cropImg      = null;
let _cropPanX     = 0;
let _cropPanY     = 0;
let _cropZoom     = 1;
let _cropBaseZoom = 1;
let _cropDragging = false;
let _cropDragStart = null;
let _cropObjectUrl = null;
const CROP_SIZE    = 240;

/* ── Obs type code → display ──────────────── */
const OBS_TYPE = {
  default:        { code: 'G', label: 'Geral' },
  improvable_by:  { code: 'O', label: 'Oportunidade' },
  excelled_by:    { code: 'A', label: 'Acerto' },
  failed_by:      { code: 'E', label: 'Erro' },
};

/* ── Compute scored monitorings from raw rows ── */
function computeMonData(rawMons) {
  return rawMons.map(mon => {
    let earned = 0, total = 0;
    const earnedByC = {}, maxByC = {};

    for (const ta of (mon.topic_approval ?? [])) {
      const t = _topicMap[ta.topic_id];
      if (!t) continue;
      const cid = t.eval_criteria_id;
      maxByC[cid]    = (maxByC[cid]    ?? 0) + t.points;
      total          += t.points;
      if (ta.obtained) {
        earnedByC[cid] = (earnedByC[cid] ?? 0) + t.points;
        earned         += t.points;
      }
    }

    const pct = total > 0 ? Math.round(earned / total * 100) : 0;
    const radarPcts = {};
    for (const [cid, m] of Object.entries(maxByC)) {
      radarPcts[cid] = m > 0 ? Math.round((earnedByC[cid] ?? 0) / m * 100) : 0;
    }

    const csats = (mon.service_chat ?? []).filter(sc => sc.csat).map(sc => sc.csat);
    const avgCsat = csats.length
      ? Math.round(csats.reduce((a, b) => a + b, 0) / csats.length * 10) / 10
      : 0;

    return { id: mon.id, date: mon.date, zeroed: mon.zeroed, pct, radarPcts, avgCsat };
  });
}

/* ── render() ─────────────────────────────── */
export function render() {
  if (!_employee) {
    return `
      <div class="profile-page page-enter"
           style="display:flex;align-items:center;justify-content:center;height:300px;gap:12px;color:var(--text-secondary)">
        <div class="boot-spinner" style="width:20px;height:20px;border-width:2px"></div>
        Carregando perfil…
      </div>`;
  }

  const count    = _monitorings.length;
  const avgPct   = count ? Math.round(_monitorings.reduce((s, m) => s + m.pct, 0) / count) : 0;
  const zeroed   = _monitorings.filter(m => m.zeroed).length;
  const lastDate = _monitorings.length ? _monitorings[_monitorings.length - 1].date : null;

  const csatVals  = _monitorings.filter(m => m.avgCsat).map(m => m.avgCsat);
  const avgCsat   = csatVals.length
    ? Math.round(csatVals.reduce((a, b) => a + b, 0) / csatVals.length * 10) / 10
    : null;

  /* Category breakdown (avg per eval_criteria across all monitorings) */
  const catBreakdown = _evalCriteria.map(ec => {
    const vals = _monitorings.map(m => m.radarPcts[ec.id] ?? 0);
    const avg  = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    return { name: ec.name, pct: avg };
  });

  /* Obs log HTML — only for users with Profile.canViewObs */
  const canViewObs = can(getCurrentUser(), P.PROFILE_VIEW_OBS);
  const obsLogHtml = !canViewObs ? null : _obsLog.length
    ? _obsLog.map(o => `
        <div class="obs-log-item obs-log-item--${o.code}">
          <div class="obs-log-item__badge obs-log-item__badge--${o.code}">${o.code}</div>
          <div class="obs-log-item__body">
            ${o.criteriaName ? `<div class="obs-log-item__criteria">${o.criteriaName}</div>` : ''}
            <div class="obs-log-item__text">${o.content}</div>
            <div class="obs-log-item__meta">
              ${o.monDate ? formatDate(o.monDate) : ''}
              ${o.protocol ? ` · Prot. ${o.protocol}` : ''}
            </div>
          </div>
        </div>`).join('')
    : `<div class="empty-state" style="padding:var(--space-6)">
         <div class="empty-state__title">Sem observações</div>
       </div>`;

  const currentUser = getCurrentUser();
  const isSelf = currentUser?.employeeId === _employee.id || can(currentUser, P.CROSS_DEPT_VIEW);

  const avatarUrl = _employee.avatar_url ?? null;

  return `
    <div class="profile-page page-enter">
      <!-- Hero -->
      <div class="profile-hero">
        <div class="profile-hero__top">
          <div class="profile-hero__avatar${isSelf ? ' profile-hero__avatar--editable' : ''}" id="profile-avatar">
            ${avatarUrl ? `<img src="${avatarUrl}" alt="" class="profile-hero__avatar-img" onerror="this.style.display='none';document.getElementById('avatar-initials-span').style.display=''">` : ''}
            <span id="avatar-initials-span"${avatarUrl ? ' style="display:none"' : ''}>${getInitials(_employee.name)}</span>
            ${isSelf ? `
              <div class="profile-hero__avatar-overlay" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
              <input type="file" id="avatar-file-input" accept="image/*" style="position:absolute;inset:0;opacity:0;cursor:pointer;border-radius:50%;width:100%;height:100%">
            ` : ''}
          </div>
          <div class="profile-hero__info">
            <div class="profile-hero__name-row">
              <div class="profile-hero__name" id="profile-name-display">${_employee.name}</div>
              ${isSelf ? `
                <input class="profile-hero__name-input hidden" id="profile-name-input"
                       value="${_employee.name.replace(/"/g, '&quot;')}" maxlength="80" />
                <button class="profile-hero__edit-btn" id="profile-name-edit" title="Editar nome" type="button">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>` : ''}
            </div>
            <div class="profile-hero__meta">${_supervisor?.name ?? '—'}</div>
            <div class="profile-hero__badges">
              ${lastDate ? `<span class="badge badge--neutral">Última monitoria: ${formatDate(lastDate)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="profile-hero__stats">
          <div class="profile-stat">
            <div class="profile-stat__val">${count}</div>
            <div class="profile-stat__lbl">Monitorias</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat__val" style="color:${scoreColor(avgPct)}">${count ? avgPct + '%' : '—'}</div>
            <div class="profile-stat__lbl">Aproveit. médio</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat__val">${avgCsat ? avgCsat + ' ★' : '—'}</div>
            <div class="profile-stat__lbl">CSAT médio</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat__val" style="color:${zeroed > 0 ? 'var(--color-danger)' : 'inherit'}">${zeroed}</div>
            <div class="profile-stat__lbl">Zeradas</div>
          </div>
        </div>
      </div>

      <!-- Charts row -->
      <div class="profile-charts">
        <!-- Radar -->
        <div class="radar-panel panel">
          <div class="panel__header"><div class="panel__title">Radar de Categorias</div></div>
          <div class="panel__body">
            <div class="radar-chart-wrapper" style="max-width:260px">
              <canvas id="chart-radar" width="260" height="260"></canvas>
            </div>
            <div class="category-breakdown">
              ${catBreakdown.map(c => `
                <div>
                  <div class="cat-row">
                    <div class="cat-row__name">${c.name.split(' ')[0]}</div>
                    <div class="cat-row__val" style="color:${scoreColor(c.pct)}">${c.pct}%</div>
                  </div>
                  <div class="cat-row__bar-wrap">
                    <div class="cat-row__bar-fill" style="width:${c.pct}%;background:${scoreColor(c.pct)}"></div>
                  </div>
                </div>`).join('')}
            </div>
          </div>
        </div>

        <!-- History chart -->
        <div class="history-panel panel">
          <div class="panel__header"><div class="panel__title">Histórico de Resultados</div></div>
          <div class="panel__body">
            <div class="chart-container chart-h-250">
              <canvas id="chart-history" height="250"></canvas>
            </div>
          </div>
        </div>
      </div>

      ${obsLogHtml !== null ? `
      <!-- Observations log -->
      <div class="panel">
        <div class="panel__header">
          <div class="panel__title">Observações Qualitativas</div>
          <span class="badge badge--neutral">${_obsLog.length}</span>
        </div>
        <div class="panel__body panel__body--compact">
          <div class="obs-log">${obsLogHtml}</div>
        </div>
      </div>` : ''}
    </div>

    ${isSelf ? `
    <!-- Avatar crop modal -->
    <div id="avatar-crop-modal" class="modal-overlay modal-overlay--hidden">
      <div class="modal" style="max-width:340px">
        <div class="modal__header">
          <div class="modal__title">Ajustar foto de perfil</div>
          <button class="modal__close" id="avatar-crop-close" type="button">✕</button>
        </div>
        <div class="modal__body" style="display:flex;flex-direction:column;align-items:center;gap:var(--space-4)">
          <div id="avatar-crop-container" class="avatar-crop-container">
            <canvas id="avatar-crop-canvas" width="${CROP_SIZE}" height="${CROP_SIZE}"></canvas>
          </div>
          <div style="width:100%;display:flex;align-items:center;gap:var(--space-3)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="range" id="avatar-zoom-slider" min="1" max="3" step="0.01" value="1" style="flex:1;accent-color:var(--brand-green)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </div>
          <p style="font-size:var(--text-xs);color:var(--text-secondary);margin:0">Arraste para reposicionar · Scroll ou deslize para ampliar</p>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="avatar-crop-cancel" type="button">Cancelar</button>
          <button class="btn btn--primary" id="avatar-crop-confirm" type="button">Salvar foto</button>
        </div>
      </div>
    </div>` : ''}`;
}

/* ── Charts ───────────────────────────────── */
function initCharts() {
  const radarLabels = _evalCriteria.map(ec => ec.name.split(' ')[0]);
  const radarData   = _evalCriteria.map(ec => {
    const vals = _monitorings.map(m => m.radarPcts[ec.id] ?? 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  });

  renderRadarChart(
    'chart-radar',
    radarLabels,
    [{ label: _employee.name.split(' ')[0], data: radarData }]
  );

  if (_monitorings.length) {
    renderHistoryChartFull(
      'chart-history',
      _monitorings.map(m => formatDate(m.date)),
      _monitorings.map(m => m.pct),
      _monitorings.map(m => scoreColorHex(m.pct))
    );
  }
}

/* ── Access control ───────────────────────── */
// RLS enforces row-level access at the DB. If the employee was fetched, access is granted.
// GLOBAL_VIEW_DEPT is kept as an explicit frontend guard for future cached-state edge cases.
function isAllowed(user, _empId, employee) {
  if (can(user, P.GLOBAL_VIEW_DEPT)) return true;
  return !!employee;
}

function renderDenied() {
  const main = document.getElementById('main-content');
  if (main) main.innerHTML = `
    <div class="page-enter">
      <div class="empty-state">
        <div class="empty-state__icon">🔒</div>
        <div class="empty-state__title">Acesso não autorizado</div>
        <div class="empty-state__desc">Você não tem permissão para visualizar este perfil.</div>
      </div>
    </div>`;
}

/* ── Page reload ──────────────────────────── */
function reloadPage() {
  destroyAll();
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = render();
  initCharts();
  bindNameEdit();
  bindAvatarUpload();
}

/* ── Avatar crop helpers ──────────────────── */
function _clampCropPan(px, py, zoom) {
  const iw = _cropImg.naturalWidth  * zoom;
  const ih = _cropImg.naturalHeight * zoom;
  return {
    x: Math.min(0, Math.max(CROP_SIZE - iw, px)),
    y: Math.min(0, Math.max(CROP_SIZE - ih, py)),
  };
}

function _drawCrop() {
  const canvas = document.getElementById('avatar-crop-canvas');
  if (!canvas || !_cropImg) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
  ctx.drawImage(_cropImg, _cropPanX, _cropPanY,
    _cropImg.naturalWidth * _cropZoom, _cropImg.naturalHeight * _cropZoom);
}

function openCropModal(file) {
  if (_cropObjectUrl) URL.revokeObjectURL(_cropObjectUrl);
  _cropObjectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    _cropImg      = img;
    _cropBaseZoom = Math.max(CROP_SIZE / img.naturalWidth, CROP_SIZE / img.naturalHeight);
    _cropZoom     = _cropBaseZoom;
    _cropPanX     = (CROP_SIZE - img.naturalWidth  * _cropZoom) / 2;
    _cropPanY     = (CROP_SIZE - img.naturalHeight * _cropZoom) / 2;
    const c = _clampCropPan(_cropPanX, _cropPanY, _cropZoom);
    _cropPanX = c.x; _cropPanY = c.y;

    const slider = document.getElementById('avatar-zoom-slider');
    if (slider) { slider.min = _cropBaseZoom; slider.max = _cropBaseZoom * 3; slider.value = _cropZoom; }

    document.getElementById('avatar-crop-modal')?.classList.remove('modal-overlay--hidden');
    _drawCrop();
  };
  img.src = _cropObjectUrl;
}

function closeCropModal() {
  document.getElementById('avatar-crop-modal')?.classList.add('modal-overlay--hidden');
  _cropDragging = false;
  _cropImg = null;
  if (_cropObjectUrl) { URL.revokeObjectURL(_cropObjectUrl); _cropObjectUrl = null; }
}

function _zoomAroundCenter(newZoom) {
  const cx = CROP_SIZE / 2, cy = CROP_SIZE / 2;
  const imgCX = (cx - _cropPanX) / _cropZoom;
  const imgCY = (cy - _cropPanY) / _cropZoom;
  _cropZoom = newZoom;
  const c = _clampCropPan(cx - imgCX * newZoom, cy - imgCY * newZoom, newZoom);
  _cropPanX = c.x; _cropPanY = c.y;
}

async function confirmCrop() {
  if (!_cropImg) return;
  const btn = document.getElementById('avatar-crop-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  try {
    const out = document.createElement('canvas');
    out.width = out.height = 72;
    const ctx = out.getContext('2d');
    ctx.drawImage(_cropImg,
      -_cropPanX / _cropZoom, -_cropPanY / _cropZoom,
      CROP_SIZE   / _cropZoom, CROP_SIZE   / _cropZoom,
      0, 0, 72, 72
    );
    const blob = await new Promise(res => out.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) throw new Error('Falha ao processar imagem.');

    const path = `employees/${_employee.id}.jpg`;
    const { error: upErr } = await supabase.storage
      .from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (upErr) throw upErr;

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = urlData.publicUrl;
    await supabase.from('employees').update({ avatar_url: publicUrl }).eq('id', _employee.id);
    _employee = { ..._employee, avatar_url: publicUrl };

    const avatarEl = document.getElementById('profile-avatar');
    if (avatarEl) {
      const img = avatarEl.querySelector('.profile-hero__avatar-img') ?? document.createElement('img');
      img.src = publicUrl + '?t=' + Date.now();
      img.alt = '';
      img.className = 'profile-hero__avatar-img';
      img.onerror = () => { img.style.display = 'none'; document.getElementById('avatar-initials-span').style.display = ''; };
      if (!avatarEl.contains(img)) avatarEl.prepend(img);
      document.getElementById('avatar-initials-span').style.display = 'none';
    }
    closeCropModal();
    toast.success('Foto atualizada');
  } catch (err) {
    console.error('[perfil] avatar upload:', err);
    toast.error('Erro ao salvar foto', err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar foto'; }
  }
}

function bindAvatarUpload() {
  const fileInput = document.getElementById('avatar-file-input');
  const container = document.getElementById('avatar-crop-container');
  const slider    = document.getElementById('avatar-zoom-slider');
  if (!fileInput) return;

  fileInput.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    fileInput.value = '';
    openCropModal(file);
  });

  document.getElementById('avatar-crop-close')?.addEventListener('click', closeCropModal);
  document.getElementById('avatar-crop-cancel')?.addEventListener('click', closeCropModal);
  document.getElementById('avatar-crop-modal')?.addEventListener('click',
    e => { if (e.target.id === 'avatar-crop-modal') closeCropModal(); });
  document.getElementById('avatar-crop-confirm')?.addEventListener('click', confirmCrop);

  if (!container) return;

  container.addEventListener('mousedown', e => {
    if (!_cropImg) return;
    _cropDragging  = true;
    _cropDragStart = { x: e.clientX - _cropPanX, y: e.clientY - _cropPanY };
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!_cropDragging || !_cropImg) return;
    const c = _clampCropPan(e.clientX - _cropDragStart.x, e.clientY - _cropDragStart.y, _cropZoom);
    _cropPanX = c.x; _cropPanY = c.y;
    _drawCrop();
  });
  document.addEventListener('mouseup', () => { _cropDragging = false; });

  container.addEventListener('touchstart', e => {
    if (!_cropImg) return;
    _cropDragging  = true;
    const t = e.touches[0];
    _cropDragStart = { x: t.clientX - _cropPanX, y: t.clientY - _cropPanY };
    e.preventDefault();
  }, { passive: false });
  container.addEventListener('touchmove', e => {
    if (!_cropDragging || !_cropImg) return;
    const t = e.touches[0];
    const c = _clampCropPan(t.clientX - _cropDragStart.x, t.clientY - _cropDragStart.y, _cropZoom);
    _cropPanX = c.x; _cropPanY = c.y;
    _drawCrop();
    e.preventDefault();
  }, { passive: false });
  container.addEventListener('touchend', () => { _cropDragging = false; });

  container.addEventListener('wheel', e => {
    if (!_cropImg) return;
    e.preventDefault();
    const delta    = e.deltaY < 0 ? 0.05 : -0.05;
    const newZoom  = Math.max(_cropBaseZoom, Math.min(_cropBaseZoom * 3, _cropZoom + delta * _cropZoom));
    _zoomAroundCenter(newZoom);
    if (slider) slider.value = newZoom;
    _drawCrop();
  }, { passive: false });

  slider?.addEventListener('input', () => {
    if (!_cropImg) return;
    _zoomAroundCenter(parseFloat(slider.value));
    _drawCrop();
  });
}

function bindNameEdit() {
  const editBtn  = document.getElementById('profile-name-edit');
  const display  = document.getElementById('profile-name-display');
  const input    = document.getElementById('profile-name-input');
  const avatar   = document.getElementById('profile-avatar');
  if (!editBtn || !display || !input) return;

  editBtn.addEventListener('click', () => {
    display.classList.add('hidden');
    editBtn.classList.add('hidden');
    input.classList.remove('hidden');
    input.focus();
    input.select();
  });

  async function commitEdit() {
    const newName = input.value.trim();
    if (!newName || newName === _employee.name) {
      input.value = _employee.name;
      input.classList.add('hidden');
      display.classList.remove('hidden');
      editBtn.classList.remove('hidden');
      return;
    }
    const { error } = await supabase
      .from('employees').update({ name: newName }).eq('id', _employee.id);
    if (error) {
      input.value = _employee.name;
    } else {
      _employee = { ..._employee, name: newName };
      display.textContent = newName;
      const initialsSpan = document.getElementById('avatar-initials-span');
      if (initialsSpan) initialsSpan.textContent = getInitials(newName);
    }
    input.classList.add('hidden');
    display.classList.remove('hidden');
    editBtn.classList.remove('hidden');
  }

  input.addEventListener('blur', commitEdit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = _employee.name; input.blur(); }
  });
}

/* ── init ─────────────────────────────────── */
export async function init() {
  const user          = getCurrentUser();
  const { id: empId } = getRouteParams();

  /* No employee ID in params, OR user passed their own profile ID but has no employee record */
  const ownProfileWithNoEmployee = empId === user?.id && !user?.employeeId;
  if (!empId || ownProfileWithNoEmployee) {
    const main = document.getElementById('main-content');
    if (main) main.innerHTML = `
      <div class="page-enter" style="display:flex;align-items:center;justify-content:center;height:100%;min-height:60vh">
        <div class="empty-state">
          <div class="empty-state__icon">👤</div>
          <div class="empty-state__title">Funcionalidade indisponível</div>
          <div class="empty-state__desc">Esta funcionalidade não está habilitada para o seu perfil.</div>
        </div>
      </div>`;
    return;
  }

  /* Cache hit — re-validate access before rendering */
  if (_loadedEmpId === empId) {
    if (!isAllowed(user, empId, _employee)) { renderDenied(); return; }
    reloadPage();
    return;
  }

  /* Reset para novo employee */
  _employee = null;
  _supervisor = null;
  _monitorings = [];
  _obsLog = [];

  /* Static ref data (cached across navigations) */
  if (!_evalCriteria.length) {
    const [ecRes, topicRes] = await Promise.all([
      supabase.from('eval_criteria').select('id, name').eq('active', true),
      supabase.from('topic').select('id, eval_criteria_id, points').eq('active', true),
    ]);
    _evalCriteria = ecRes.data ?? [];
    _topicMap     = Object.fromEntries((topicRes.data ?? []).map(t => [t.id, t]));
  }

  /* Employee + monitorings in parallel; supervisor resolved separately to avoid FK ambiguity */
  const [empRes, monsRes] = await Promise.all([
    supabase.from('employees')
      .select('id, name, team_id, avatar_url, teams(supervisor_id)')
      .eq('id', empId)
      .single(),
    supabase.from('monitoring')
      .select(`
        id, date, zeroed,
        topic_approval(topic_id, obtained),
        service_chat(csat, protocol)
      `)
      .eq('employee_id', empId)
      .order('date', { ascending: true }),
  ]);

  if (empRes.error || !empRes.data) {
    const main = document.getElementById('main-content');
    if (main) main.innerHTML = `
      <div class="page-enter">
        <div class="empty-state">
          <div class="empty-state__title">Colaborador não encontrado</div>
        </div>
      </div>`;
    return;
  }

  const { teams: empTeam, ...empData } = empRes.data;
  _employee = empData;

  const supervisorId = empTeam?.supervisor_id ?? null;
  if (supervisorId) {
    const { data: supData } = await supabase
      .from('profiles').select('id, name').eq('id', supervisorId).single();
    _supervisor = supData ?? null;
  } else {
    _supervisor = null;
  }

  if (!isAllowed(user, empId, _employee)) { renderDenied(); return; }
  const rawMons = monsRes.data ?? [];
  _monitorings = computeMonData(rawMons);

  /* Observations — skip fetch for users without Profile.canViewObs */
  const monIds = rawMons.map(m => m.id);
  if (monIds.length && can(user, P.PROFILE_VIEW_OBS)) {
    const monDateMap = Object.fromEntries(rawMons.map(m => [m.id, m.date]));

    const { data: obsData } = await supabase
      .from('monitoring_observation')
      .select(`
        id, content, monitoring_id,
        observation_type(code),
        eval_criteria(name),
        service_chat(protocol)
      `)
      .in('monitoring_id', monIds)
      .order('id', { ascending: false })
      .limit(30);

    _obsLog = (obsData ?? []).map(o => {
      const typeInfo = OBS_TYPE[o.observation_type?.code] ?? OBS_TYPE.default;
      return {
        code:         typeInfo.code,
        label:        typeInfo.label,
        criteriaName: o.eval_criteria?.name ?? null,
        content:      o.content ?? '',
        protocol:     o.service_chat?.protocol ?? null,
        monDate:      monDateMap[o.monitoring_id] ?? null,
      };
    });
  }

  _loadedEmpId = empId;
  reloadPage();
}
