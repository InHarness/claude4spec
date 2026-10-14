import { toast } from '../../ui/events.js';
import type { ToastAction } from './ToastViewport.js';

/**
 * `useToast` (`experimental`, outside `hostApiVersion`) — a hook exported
 * BESIDE the catalog (no registry entry: `stability`/`binding` describe
 * components), and the `/ui` declarative doctrine's one deliberate imperative
 * exception (feedback is inherently imperative, not props-in).
 *
 * 2.1.20 (M34 `l0i0c5wm`): a thin layer over the shell's `toast` facade
 * (M50 `tbeatf5z`). A call goes onto the host toast bus, so the toast lands in
 * the host's one stack — the controlled `ToastViewport` that `ToastHost`
 * renders. The hook has no queue, no timers and no bus of its own, and a
 * plugin mounts no `ToastViewport` for it. No `info` kind, no duration.
 */
export function useToast(): {
  success(message: string, action?: ToastAction): void;
  error(message: string, action?: ToastAction): void;
  warning(message: string, action?: ToastAction): void;
} {
  return {
    success: (message, action) => toast.success(message, action),
    error: (message, action) => toast.error(message, action),
    warning: (message, action) => toast.warning(message, action),
  };
}
