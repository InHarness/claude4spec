import { useCallback, useEffect, useRef, useState } from 'react';
import { ToastViewport, TOAST_DURATION_MS } from '../host-ui-kit/overlay-feedback/ToastViewport.js';
import { UI_EVENTS, type ToastVariant, type ToastRequest } from './events.js';

interface ActiveToast extends ToastRequest {
  /** The catalog viewport's prop name for the variant. */
  kind: ToastVariant;
  id: number;
  expiresAt: number;
  remaining: number;
  paused: boolean;
}

const DEFAULT_DURATION: Record<ToastVariant, number> = TOAST_DURATION_MS;

/**
 * The host's toast FACADE (M34/L12 one-implementation rule): `ToastHost` IS the
 * catalog's `ToastViewport` — it renders no viewport of its own. What lives here
 * is only the invocation surface the catalog deliberately doesn't own: the
 * `c4s:toast` event bus, the queue, and the expiry timers (including the
 * per-call `durationMs` override that `toast.*` accepts).
 *
 * `toast.success/error/warning/info` are unchanged; 0.2.110 renamed the payload's
 * `kind` to `variant` (`c4s:toast { variant, message, action? }`).
 */
export function ToastHost() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const idRef = useRef(1);

  useEffect(() => {
    const handler = (e: Event) => {
      // 0.2.110: the payload names the severity `variant`. A plugin built
      // against the pre-0.2.110 protocol still sends `kind` — accepted, so its
      // toasts keep rendering instead of falling through to no duration.
      const detail = (e as CustomEvent<ToastRequest & { kind?: ToastVariant }>).detail;
      const variant = detail.variant ?? detail.kind ?? 'info';
      const duration = detail.durationMs ?? DEFAULT_DURATION[variant];
      const id = idRef.current++;
      setToasts((prev) => [
        ...prev,
        {
          ...detail,
          variant,
          kind: variant,
          id,
          expiresAt: Date.now() + duration,
          remaining: duration,
          paused: false,
        },
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

  const dismiss = useCallback((id: number | string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pause = useCallback((id: number | string) => {
    setToasts((prev) =>
      prev.map((t) =>
        t.id === id && !t.paused
          ? { ...t, paused: true, remaining: Math.max(0, t.expiresAt - Date.now()) }
          : t,
      ),
    );
  }, []);

  const resume = useCallback((id: number | string) => {
    setToasts((prev) =>
      prev.map((t) =>
        t.id === id && t.paused ? { ...t, paused: false, expiresAt: Date.now() + t.remaining } : t,
      ),
    );
  }, []);

  return (
    <ToastViewport toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
  );
}
