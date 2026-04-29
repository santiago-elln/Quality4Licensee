/* ============================================================
   FORMATTERS — Formatação de datas, tempos e números
   ============================================================ */

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatMonthYear(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + '-01');
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    .replace(/^\w/, c => c.toUpperCase());
}

export function formatTime(seconds) {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export function formatHHMMSS(seconds) {
  if (seconds == null) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export function parseHHMMSS(str) {
  if (!str) return 0;
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60 + parts[1];
  return 0;
}

export function formatScore(score, decimals = 1) {
  if (score == null) return '—';
  return Number(score).toFixed(decimals);
}

export function formatPct(value, decimals = 1) {
  if (value == null) return '—';
  return `${Number(value).toFixed(decimals)}%`;
}

export function formatNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString('pt-BR');
}

export function getInitials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

export function monthKey(date = new Date()) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthOptions(count = 12) {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      .replace(/^\w/, c => c.toUpperCase());
    opts.push({ key, label });
  }
  return opts;
}

export function resultBand(pct) {
  if (pct >= 95) return { label: 'Excelente', cls: 'excellent' };
  if (pct >= 70) return { label: 'Bom',       cls: 'good' };
  if (pct >= 50) return { label: 'Regular',   cls: 'regular' };
  if (pct >  0)  return { label: 'Crítico',   cls: 'critical' };
  return             { label: 'Zerada',    cls: 'zero' };
}

export function scoreColor(pct) {
  if (pct >= 95) return 'var(--result-excellent)';
  if (pct >= 70) return 'var(--result-good)';
  if (pct >= 50) return 'var(--result-regular)';
  if (pct >  0)  return 'var(--result-critical)';
  return 'var(--result-zero)';
}
