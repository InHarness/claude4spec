import { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X, type LucideIcon } from 'lucide-react';
import { UI_EVENTS, type ToastKind, type ToastRequest } from './events.js';

interface ActiveToast extends ToastRequest {
  id: number;
  expiresAt: number;
  remaining: number;
  paused: boolean;
}

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 2500,
  error: 4000,
  warning: 3500,
  info: 3000,
};

const COLORS: Record<ToastKind, string> = {
  success: 'var(--c-accent)',
  error: 'var(--c-red, #c45a3b)',
  warning: '#c99467',
  info: 'var(--c-muted)',
};

const ICONS: Record<ToastKind, LucideIcon> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export function ToastHost() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const idRef = useRef(1);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<ToastRequest>;
      const duration = ce.detail.durationMs ?? DEFAULT_DURATION[ce.detail.kind];
      const id = idRef.current++;
      const expiresAt = Date.now() + duration;
      setToasts((prev) => [
        ...prev,
        { ...ce.detail, id, expiresAt, remaining: duration, paused: false },
      ]);
    };
    window.addEventListener(UI_EVENTS.TOAST, handler as EventListener);
    return () => window.removeEventListener(UI_EVENTS.TOAST, handler as EventListener);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => t.paused || t.expiresAt > now));
    }, 200);
    return () => window.clearInterval(interval);
  }, [toasts.length]);

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function pause(id: number) {
    setToasts((prev) =>
      prev.map((t) =>
        t.id === id && !t.paused
          ? { ...t, paused: true, remaining: Math.max(0, t.expiresAt - Date.now()) }
          : t,
      ),
    );
  }

  function resume(id: number) {
    setToasts((prev) =>
      prev.map((t) =>
        t.id === id && t.paused
          ? { ...t, paused: false, expiresAt: Date.now() + t.remaining }
          : t,
      ),
    );
  }

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 1300,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => {
        const I = ICONS[t.kind];
        const color = COLORS[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            onMouseEnter={() => pause(t.id)}
            onMouseLeave={() => resume(t.id)}
            style={{
              pointerEvents: 'auto',
              width: 320,
              padding: 12,
              background: 'var(--c-card)',
              border: '1px solid var(--c-hair-strong)',
              borderLeft: `3px solid ${color}`,
              borderRadius: 6,
              boxShadow: '0 10px 28px rgba(0,0,0,0.10)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontSize: 12.5,
              color: 'var(--c-ink)',
            }}
          >
            <I size={14} style={{ color, marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ lineHeight: 1.45, wordBreak: 'break-word' }}>{t.message}</div>
              {t.action && (
                <button
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  style={{
                    marginTop: 6,
                    fontSize: 11.5,
                    color: 'var(--c-accent)',
                    fontWeight: 500,
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              title="Dismiss"
              style={{
                flexShrink: 0,
                padding: 2,
                color: 'var(--c-muted)',
                opacity: 0.6,
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
