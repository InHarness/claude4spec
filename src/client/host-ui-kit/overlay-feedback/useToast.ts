import { fireToast, type ToastAction } from './toast-store.js';

/**
 * `useToast` (Overlay/feedback, `experimental`) — the catalog's one
 * deliberate imperative exception (feedback is inherently imperative, not
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
