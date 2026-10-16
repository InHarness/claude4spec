import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X, type LucideIcon } from 'lucide-react';
import { withStability } from '../stability.js';

/**
 * `info` is renderable but absent from `useToast()`: the hook publishes the
 * three kinds of the shell `toast` facade's plugin contract, while the host's
 * own `toast.info()` still needs a kind the one viewport can render.
 */
export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick(): void;
}

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
  error: 'var(--c-red)',
  warning: 'var(--c-yellow)',
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
   * The stack to render — the viewport is CONTROLLED: the caller owns the
   * queue, the timers and dismissal. Behaviour without `toasts` is not part of
   * the contract (today: nothing is rendered).
   */
  toasts?: ToastViewportItem[];
  onDismiss?(id: number | string): void;
  /** Hover pauses the caller's timer. Only meaningful alongside `toasts`. */
  onPause?(id: number | string): void;
  onResume?(id: number | string): void;
}

/**
 * `ToastViewport` (group `feedback`, `experimental`) — the ONLY toast anatomy in
 * C4S (M34/L12 one-implementation rule): a 320px panel with a kind-coloured left
 * border, lucide icon, optional action and an always-visible dismiss, stacking
 * upward from the bottom-right over `--z-toast`.
 *
 * A CONTROLLED stack component: it renders the `toasts` it is given and reports
 * a close through `onDismiss`. The host's `ToastHost` renders it this way and
 * holds the host's one toast stack (queue, timers, the `c4s:toast` bus);
 * `useToast()` sends onto that bus, so no second stack exists (2.1.20,
 * `l0i0c5wm` / `wbs9m5zj`).
 */
function ToastViewportImpl({ toasts, onDismiss, onPause, onResume }: ToastViewportProps) {
  const stack = toasts ?? [];
  const dismiss = onDismiss;
  const pause = onPause;
  const resume = onResume;

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

export const ToastViewport = withStability(ToastViewportImpl, 'experimental');
