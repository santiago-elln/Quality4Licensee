/* ============================================================
   NÃO AUTORIZADO — Usuário autenticado sem vínculo de equipe
   ============================================================ */
import { getCurrentUser } from '../auth.js';

export function render() {
  const user = getCurrentUser();
  return `
    <div class="page-enter" style="display:flex;align-items:center;justify-content:center;height:100%;min-height:60vh">
      <div class="empty-state">
        <div class="empty-state__icon">🔒</div>
        <div class="empty-state__title">Acesso pendente</div>
        <div class="empty-state__desc">
          Você ainda não foi vinculado a nenhum departamento.<br>
          Entre em contato com seu gestor para receber autorização.
        </div>
        ${user?.email ? `<div style="margin-top:var(--space-4);color:var(--text-muted);font-size:.85rem">${user.email}</div>` : ''}
      </div>
    </div>`;
}

export function init() {}
