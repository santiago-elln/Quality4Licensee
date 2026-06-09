/* ============================================================
   CAL-PICKER — Reusable dual-month date range picker
   ============================================================ */

const WEEKDAYS = ['D','S','T','Q','Q','S','S'];
const MONTHS   = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const pad         = n     => String(n).padStart(2,'0');
const toStr       = (y,m,d) => `${y}-${pad(m+1)}-${pad(d)}`;
const cmp         = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const fromStr     = s => { const [y,m,d] = s.split('-').map(Number); return { y, m: m-1, d }; };
const daysInMonth = (y,m) => new Date(y,m+1,0).getDate();
const dayOfWeek   = (y,m,d) => new Date(y,m,d).getDay();

const CAL_ICON = `<svg class="cal-picker-trigger__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="18" rx="2"/>
  <line x1="16" y1="2" x2="16" y2="6"/>
  <line x1="8" y1="2" x2="8" y2="6"/>
  <line x1="3" y1="10" x2="21" y2="10"/>
</svg>`;

export function formatDateRange(from, to) {
  if (!from) return 'Qualquer data';
  const f = fromStr(from), t = to ? fromStr(to) : f;
  if (!to || from === to) return `${f.d} de ${MONTHS[f.m]} de ${f.y}`;
  if (f.y === t.y && f.m === t.m) return `${f.d}–${t.d} de ${MONTHS[f.m]} de ${f.y}`;
  if (f.y === t.y) return `${f.d} ${MONTHS[f.m].slice(0,3)} – ${t.d} ${MONTHS[t.m].slice(0,3)} ${f.y}`;
  return `${f.d}/${pad(f.m+1)}/${f.y} – ${t.d}/${pad(t.m+1)}/${t.y}`;
}

export function calTriggerHtml(id, from, to) {
  const active = !!(from && to);
  return `<button class="cal-picker-trigger${active ? ' active' : ''}" id="${id}" type="button" aria-expanded="false">
    ${CAL_ICON}
    <span class="cal-picker-trigger__label">${formatDateRange(from, to)}</span>
    <span class="cal-picker-trigger__clear${active ? '' : ' hidden'}" aria-hidden="true">×</span>
  </button>`;
}

export class CalPicker {
  #triggerEl;
  #onApply;
  #onClear;
  #startDate;
  #endDate;
  #pendingStart;
  #pendingEnd;
  #hoverDate;
  #selecting;
  #leftYear;
  #leftMonth;
  #overlay;
  #labelEl;
  #clearEl;
  #escHandler;

  constructor({ triggerEl, from = '', to = '', onApply, onClear } = {}) {
    this.#triggerEl  = triggerEl;
    this.#onApply    = onApply ?? (() => {});
    this.#onClear    = onClear ?? (() => {});
    this.#startDate  = from || null;
    this.#endDate    = to   || null;
    this.#overlay    = null;
    this.#labelEl    = triggerEl?.querySelector('.cal-picker-trigger__label') ?? null;
    this.#clearEl    = triggerEl?.querySelector('.cal-picker-trigger__clear') ?? null;
    this.#updateTrigger();

    triggerEl?.addEventListener('click', e => {
      if (e.target.closest('.cal-picker-trigger__clear')) return;
      this.open();
    });
    this.#clearEl?.addEventListener('click', e => {
      e.stopPropagation();
      this.#startDate = null;
      this.#endDate   = null;
      this.#updateTrigger();
      this.#onClear();
    });

    this.#escHandler = e => {
      if (e.key === 'Escape' && this.#overlay?.classList.contains('open')) this.close();
    };
    document.addEventListener('keydown', this.#escHandler);
  }

  #updateTrigger() {
    if (this.#labelEl) {
      this.#labelEl.textContent = formatDateRange(this.#startDate, this.#endDate);
    }
    const active = !!(this.#startDate && this.#endDate);
    this.#triggerEl?.classList.toggle('active', active);
    this.#clearEl?.classList.toggle('hidden', !active);
  }

  #buildMonthHTML(year, month) {
    const today  = new Date();
    const todayS = toStr(today.getFullYear(), today.getMonth(), today.getDate());
    const sel0   = this.#pendingStart || this.#startDate;
    const sel1   = (this.#selecting ? this.#hoverDate : null) || this.#pendingEnd || this.#endDate;
    const [rangeA, rangeB] = sel0 && sel1
      ? (cmp(sel0,sel1) <= 0 ? [sel0,sel1] : [sel1,sel0]) : [sel0, null];

    const firstDOW = dayOfWeek(year, month, 1);
    const days     = daysInMonth(year, month);

    let h = `<div class="cp-month-header"><div class="cp-month-title">${MONTHS[month]} ${year}</div></div>`;
    h += '<div class="cp-weekdays">'
      + WEEKDAYS.map(w => `<span class="cp-weekday">${w}</span>`).join('')
      + '</div><div class="cp-days">';

    for (let i = 0; i < firstDOW; i++) h += '<div class="cp-day cp-empty"></div>';

    for (let d = 1; d <= days; d++) {
      const ds         = toStr(year, month, d);
      const isFuture   = cmp(ds, todayS) > 0;
      const isStart    = ds === rangeA;
      const isEnd      = rangeB && ds === rangeB;
      const inRange    = rangeA && rangeB && cmp(ds,rangeA) > 0 && cmp(ds,rangeB) < 0;
      const isToday    = ds === todayS;
      let cls = 'cp-day';
      if (isFuture) cls += ' cp-disabled';
      if (isStart)  cls += ' cp-range-start';
      if (isEnd)    cls += ' cp-range-end';
      if (inRange)  cls += ' cp-in-range';
      if (isToday)  cls += ' cp-today';
      h += `<div class="${cls}"${isFuture ? '' : ` data-date="${ds}"`}><span class="cp-day-num">${d}</span></div>`;
    }
    return h + '</div>';
  }

  #render() {
    const ry = this.#leftMonth === 11 ? this.#leftYear + 1 : this.#leftYear;
    const rm = this.#leftMonth === 11 ? 0 : this.#leftMonth + 1;
    const leftEl  = this.#overlay.querySelector('.cp-cal-left');
    const rightEl = this.#overlay.querySelector('.cp-cal-right');
    if (leftEl)  leftEl.innerHTML  = this.#buildMonthHTML(this.#leftYear, this.#leftMonth);
    if (rightEl) rightEl.innerHTML = this.#buildMonthHTML(ry, rm);

    this.#overlay.querySelector('.cal-nav--prev').onclick = () => {
      this.#leftMonth === 0 ? (this.#leftMonth = 11, this.#leftYear--) : this.#leftMonth--;
      this.#render();
    };
    this.#overlay.querySelector('.cal-nav--next').onclick = () => {
      this.#leftMonth === 11 ? (this.#leftMonth = 0, this.#leftYear++) : this.#leftMonth++;
      this.#render();
    };
  }

  #createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'cal-picker-overlay';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.innerHTML = `
      <div class="cal-picker-content">
        <div class="cal-picker-header">
          <span class="cal-picker-title">Selecionar período</span>
          <button class="cal-picker-close" type="button" aria-label="Fechar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="cal-picker-nav-row">
          <button class="cal-nav cal-nav--prev" type="button">&#8249;</button>
          <div class="cal-picker-months">
            <div class="cp-month cp-cal-left"></div>
            <div class="cp-month cp-cal-right"></div>
          </div>
          <button class="cal-nav cal-nav--next" type="button">&#8250;</button>
        </div>
        <div class="cal-picker-actions">
          <button class="btn-cal-cancel" type="button">Cancelar</button>
          <button class="btn-cal-apply"  type="button">Aplicar</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const months = overlay.querySelector('.cal-picker-months');
    months.addEventListener('click', e => {
      const cell = e.target.closest('[data-date]');
      if (!cell) return;
      const ds = cell.dataset.date;
      if (!this.#selecting) {
        this.#pendingStart = ds; this.#pendingEnd = null; this.#hoverDate = null; this.#selecting = true;
      } else {
        const [a,b] = cmp(this.#pendingStart, ds) <= 0 ? [this.#pendingStart, ds] : [ds, this.#pendingStart];
        this.#pendingStart = a; this.#pendingEnd = b; this.#hoverDate = null; this.#selecting = false;
      }
      this.#render();
    });
    months.addEventListener('mouseover', e => {
      if (!this.#selecting) return;
      const cell = e.target.closest('[data-date]');
      if (!cell) return;
      const ds = cell.dataset.date;
      if (ds === this.#hoverDate) return;
      this.#hoverDate = ds;
      this.#render();
    });
    months.addEventListener('mouseleave', () => {
      if (!this.#selecting) return;
      this.#hoverDate = null;
      this.#render();
    });

    overlay.querySelector('.btn-cal-apply').addEventListener('click', () => {
      if (!this.#pendingStart || !this.#pendingEnd) return;
      this.#startDate = this.#pendingStart;
      this.#endDate   = this.#pendingEnd;
      this.#updateTrigger();
      this.close();
      this.#onApply(this.#startDate, this.#endDate);
    });

    overlay.querySelector('.btn-cal-cancel').addEventListener('click', () => {
      if (this.#startDate && this.#endDate) {
        this.#startDate = null;
        this.#endDate   = null;
        this.#updateTrigger();
        this.close();
        this.#onClear();
      } else {
        this.close();
      }
    });

    overlay.querySelector('.cal-picker-close').addEventListener('click', () => this.close());
    overlay.addEventListener('click', e => { if (e.target === overlay) this.close(); });

    return overlay;
  }

  #syncCancelBtn() {
    const btn = this.#overlay?.querySelector('.btn-cal-cancel');
    if (!btn) return;
    if (this.#startDate && this.#endDate) {
      btn.textContent = 'Limpar filtro';
      btn.classList.add('visible');
    } else {
      btn.textContent = 'Cancelar';
      btn.classList.remove('visible');
    }
  }

  #position() {
    const content = this.#overlay.querySelector('.cal-picker-content');
    const rect    = this.#triggerEl.getBoundingClientRect();
    const cardW   = content.offsetWidth  || 480;
    const cardH   = content.offsetHeight || 420;
    let top  = rect.bottom + 8;
    let left = rect.left;
    if (left + cardW > window.innerWidth  - 16) left = window.innerWidth  - cardW - 16;
    if (left < 16) left = 16;
    if (top  + cardH > window.innerHeight - 16) top  = rect.top - cardH - 8;
    if (top  < 8) top = 8;
    content.style.top  = top  + 'px';
    content.style.left = left + 'px';
  }

  open() {
    if (!this.#overlay) this.#overlay = this.#createOverlay();
    this.#pendingStart = this.#startDate;
    this.#pendingEnd   = this.#endDate;
    this.#selecting    = false;
    this.#hoverDate    = null;

    const now = new Date();
    this.#leftYear  = this.#startDate ? fromStr(this.#startDate).y : now.getFullYear();
    this.#leftMonth = this.#startDate ? fromStr(this.#startDate).m : now.getMonth();
    if (this.#leftMonth === 11) this.#leftMonth = 10;

    this.#position();
    this.#overlay.classList.add('open');
    this.#triggerEl?.setAttribute('aria-expanded','true');
    this.#syncCancelBtn();
    this.#render();
  }

  close() {
    if (!this.#overlay) return;
    this.#overlay.classList.remove('open');
    this.#triggerEl?.setAttribute('aria-expanded','false');
    this.#selecting  = false;
    this.#hoverDate  = null;
  }

  setRange(from, to) {
    this.#startDate = from || null;
    this.#endDate   = to   || null;
    this.#updateTrigger();
  }

  destroy() {
    document.removeEventListener('keydown', this.#escHandler);
    this.#overlay?.remove();
    this.#overlay = null;
  }
}
