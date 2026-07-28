import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X, type LucideIcon } from 'lucide-react';
import { withStability } from '../stability.js';
import { TOAST_EVENT, type ToastAction, type ToastKind, type ToastRequest } from './toast-store.js';

/**
 * Auto-dismiss delays, by kind — part of the toast's anatomy, so they live with
 * it. A facade driving the viewport props-in runs its own timers and may use
 * its own delays (the host's `ToastHost` honours a per-call `durationMs`).
 */
export const TOAST_DURATION_MS: Record<ToastKind, number> = {
  success: 2500,
  error: 4000,
  warning: 3500,
  info: 3000,
};

export const TOAST_COLOR: Record<ToastKind, string> = {
  success: 'var(--c-accent)',
  error: 'var(--c-red, #c45a3b)',
  warning: 'var(--c-yellow-ink)',
  info: 'var(--c-muted)',
};

const ICONS: Record<ToastKind, LucideIcon> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

/** One toast in a caller-owned stack. */
export interface ToastViewportItem {
  id: number | string;
  kind: ToastKind;
  message: ReactNode;
  action?: ToastAction;
}

export interface ToastViewportProps {
  /**
   * The stack to render. Supplied, the viewport is strictly props-in: the
   * caller owns the queue, the timers and dismissal. Omitted, the viewport
   * manages its own stack from `useToast()` requests — the plugin-facing path.
   */
  toasts?: ToastViewportItem[];
  onDismiss?(id: number | string): void;
  /** Hover pauses the caller's timer. Only meaningful alongside `toasts`. */
  onPause?(id: number | string): void;
  onResume?(id: number | string): void;
}

/**
 * `ToastViewport` (Overlay/feedback, `experimental`) — the ONLY toast anatomy in
 * C4S (M34/L12 one-implementation rule): a 320px panel with a kind-coloured left
 * border, lucide icon, optional action and an always-visible dismiss, stacking
 * upward from the bottom-right over `--z-toast`.
 *
 * The host's `ToastHost` IS this viewport: it keeps only the queue and the
 * timers and hands the stack in through `toasts`, rather than running a parallel
 * viewport of its own. Plugins mount it bare and drive it with `useToast()`, in
 * which case it manages that stack itself — same renderer either way.
 */
function ToastViewportImpl({ toasts, onDismiss, onPause, onResume }: ToastViewportProps) {
  const propsIn = toasts !== undefined;
  const selfManaged = useSelfManagedToasts(!propsIn);

  const stack = toasts ?? selfManaged.toasts;
  const dismiss = propsIn ? onDismiss : selfManaged.dismiss;
  const pause = propsIn ? onPause : selfManaged.pause;
  const resume = propsIn ? onResume : selfManaged.resume;

  if (stack.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 'var(--z-toast)',
        display: 'flex',
        // Newest toast nearest the corner, older ones pushed upward.
        flexDirection: 'column-reverse',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {stack.map((t) => {
        const Icon = ICONS[t.kind];
        const color = TOAST_COLOR[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            onMouseEnter={() => pause?.(t.id)}
            onMouseLeave={() => resume?.(t.id)}
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
            <Icon size={14} style={{ color, marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ lineHeight: 1.45, wordBreak: 'break-word' }}>{t.message}</div>
              {t.action && (
                // Deliberately does NOT dismiss — acting on a toast shouldn't
                // yank it away mid-read. It expires on its timer, or on ×.
                <button
                  type="button"
                  onClick={t.action.onClick}
                  className="text-[11.5px] font-medium"
                  style={{ marginTop: 6, color: 'var(--c-accent)' }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss?.(t.id)}
              title="Dismiss"
              aria-label="Dismiss"
              style={{ flexShrink: 0, padding: 2, color: 'var(--c-muted)', opacity: 0.6 }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** A pending dismissal. `handle` is null while hover has paused the timer. */
interface PendingTimer {
  handle: number | null;
  expiresAt: number;
  remaining: number;
}

/**
 * The plugin-facing stack: listens for `useToast()` requests and owns the
 * dismissal timers. Only active when the consumer passed no `toasts` — a host
 * facade owning its own queue must not also get this listener, or every toast
 * would be rendered twice.
 */
function useSelfManagedToasts(enabled: boolean) {
  const [toasts, setToasts] = useState<ToastViewportItem[]>([]);
  const idRef = useRef(1);
  // Timers live in a ref, not state: pausing on hover must not re-render the stack.
  const timers = useRef(new Map<number | string, PendingTimer>());

  const dismiss = useCallback((id: number | string) => {
    const entry = timers.current.get(id);
    if (entry?.handle != null) window.clearTimeout(entry.handle);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pause = useCallback((id: number | string) => {
    const entry = timers.current.get(id);
    if (!entry || entry.handle == null) return;
    window.clearTimeout(entry.handle);
    timers.current.set(id, {
      handle: null,
      expiresAt: entry.expiresAt,
      remaining: Math.max(0, entry.expiresAt - Date.now()),
    });
  }, []);

  const resume = useCallback(
    (id: number | string) => {
      const entry = timers.current.get(id);
      if (!entry || entry.handle != null) return;
      const handle = window.setTimeout(() => dismiss(id), entry.remaining);
      timers.current.set(id, {
        handle,
        expiresAt: Date.now() + entry.remaining,
        remaining: entry.remaining,
      });
    },
    [dismiss],
  );

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: Event) => {
      const { kind, message, action } = (e as CustomEvent<ToastRequest>).detail;
      const id = idRef.current++;
      const duration = TOAST_DURATION_MS[kind];
      const handle = window.setTimeout(() => dismiss(id), duration);
      timers.current.set(id, { handle, expiresAt: Date.now() + duration, remaining: duration });
      setToasts((prev) => [...prev, { id, kind, message, action }]);
    };
    window.addEventListener(TOAST_EVENT, handler as EventListener);
    return () => window.removeEventListener(TOAST_EVENT, handler as EventListener);
  }, [enabled, dismiss]);

  // Clear every pending timer on unmount so none fires into a dead tree.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const { handle } of map.values()) if (handle != null) window.clearTimeout(handle);
      map.clear();
    };
  }, []);

  return { toasts, dismiss, pause, resume };
}

export const ToastViewport = withStability(ToastViewportImpl, 'experimental');
