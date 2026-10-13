import { fireToast, type ToastAction } from './toast-store.js';

/**
 * `useToast` (`experimental`, outside `hostApiVersion`) — a hook exported
 * BESIDE the catalog (no registry entry: `stability`/`binding` describe
 * components), and the `/ui` declarative doctrine's one deliberate imperative
 * exception (feedback is inherently imperative, not
 * props-in). Fires a request `ToastViewport` (mounted once by the plugin
 * author, typically at their root) renders over `--z-toast`.
 */
export function useToast(): {
  success(message: string, action?: ToastAction): void;
  error(message: string, action?: ToastAction): void;
  warning(message: string, action?: ToastAction): void;
} {
  return {
    success: (message, action) => fireToast('success', message, action),
    error: (message, action) => fireToast('error', message, action),
    warning: (message, action) => fireToast('warning', message, action),
  };
}
