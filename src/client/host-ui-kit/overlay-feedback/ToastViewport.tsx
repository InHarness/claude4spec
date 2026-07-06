import { useEffect, useRef, useState } from 'react';
import { withStability } from '../stability.js';
import { TOAST_EVENT, type ToastKind, type ToastRequest } from './toast-store.js';

interface ActiveToast extends ToastRequest {
  id: number;
}

const DURATION_MS: Record<ToastKind, number> = {
  success: 2500,
  error: 4000,
  warning: 3500,
};

const COLOR: Record<ToastKind, string> = {
  success: 'var(--c-accent)',
  error: 'var(--c-red, #c45a3b)',
  warning: 'var(--c-yellow-ink)',
};

/**
 * `ToastViewport` (Overlay/feedback, `experimental`) — mounted once by the
 * plugin author (typically at their root). Listens for `useToast()` requests
 * and renders the active stack over `--z-toast`.
 */
function ToastViewportImpl() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const idRef = useRef(1);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<ToastRequest>;
      const id = idRef.current++;
      setToasts((prev) => [...prev, { ...ce.detail, id }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, DURATION_MS[ce.detail.kind]);
    };
    window.addEventListener(TOAST_EVENT, handler as EventListener);
    return () => window.removeEventListener(TOAST_EVENT, handler as EventListener);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-2"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 'var(--z-toast)',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="rounded-md shadow-lg flex items-center gap-2"
          style={{
            background: 'var(--c-card)',
            border: `1px solid var(--c-hair-strong)`,
            borderLeft: `3px solid ${COLOR[t.kind]}`,
            padding: '8px 12px',
            fontSize: 13,
            color: 'var(--c-ink)',
            minWidth: 220,
            maxWidth: 360,
          }}
        >
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              onClick={t.action.onClick}
              className="text-[12px] font-medium"
              style={{ color: COLOR[t.kind] }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export const ToastViewport = withStability(ToastViewportImpl, 'experimental');
