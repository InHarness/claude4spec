/**
 * The host's UI event protocol, spoken directly.
 *
 * `toast` and `confirmDestructive` are host-internal helpers over two
 * `CustomEvent`s on `window`; the host's toast host and confirm modal listen
 * for them regardless of who dispatched. Re-implementing the two dispatchers is
 * a handful of lines and keeps this package free of a host import — the event
 * NAMES and payload shapes are the contract, and they are pinned by the
 * frontend smoke test.
 */

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  detail?: string;
  duration?: number;
}

const TOAST_EVENT = 'c4s:toast';
const CONFIRM_EVENT = 'c4s:confirm-open';

function fire(kind: ToastKind, message: string, options?: ToastOptions): void {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { kind, message, ...options } }));
}

export const toast = {
  success: (message: string, options?: ToastOptions) => fire('success', message, options),
  error: (message: string, options?: ToastOptions) => fire('error', message, options),
  warning: (message: string, options?: ToastOptions) => fire('warning', message, options),
  info: (message: string, options?: ToastOptions) => fire('info', message, options),
};

export interface ConfirmInput {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * The host's confirm modal answers through the `resolve` callback carried on
 * the event detail. Verbatim protocol — same event name, same payload shape.
 */
export function confirmDestructive(input: ConfirmInput): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(new CustomEvent(CONFIRM_EVENT, { detail: { ...input, resolve } }));
  });
}
