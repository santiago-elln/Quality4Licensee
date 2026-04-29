/* ============================================================
   TOAST — Notificações não-bloqueantes
   ============================================================ */
let _container = null;

function getContainer() {
  if (!_container) {
    _container = document.createElement('div');
    _container.className = 'toast-container';
    document.body.appendChild(_container);
  }
  return _container;
}

const ICONS = {
  success: '✅',
  error:   '❌',
  warning: '⚠️',
  info:    'ℹ️',
};

export function showToast({ type = 'info', title, message, duration = 4000 }) {
  const container = getContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span class="toast__icon">${ICONS[type] ?? 'ℹ️'}</span>
    <div class="toast__content">
      ${title ? `<div class="toast__title">${title}</div>` : ''}
      ${message ? `<div class="toast__message">${message}</div>` : ''}
    </div>
    <button class="toast__close">✕</button>
  `;
  container.appendChild(toast);

  const close = () => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  toast.querySelector('.toast__close').addEventListener('click', close);
  if (duration > 0) setTimeout(close, duration);
}

export const toast = {
  success: (title, message) => showToast({ type: 'success', title, message }),
  error:   (title, message) => showToast({ type: 'error',   title, message }),
  warning: (title, message) => showToast({ type: 'warning', title, message }),
  info:    (title, message) => showToast({ type: 'info',    title, message }),
};
