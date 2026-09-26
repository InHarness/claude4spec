/**
 * The host's UI event protocol, spoken directly.
 *
 * `toast` and `confirmDestructive` are host-internal helpers over two
 * `CustomEvent`s on `window`; the host's toast host and confirm layer listen
 * for them regardless of who dispatched. Re-implementing the two dispatchers is
 * a handful of lines and keeps this package free of a host import — the event
 * NAMES and payload shapes are the contract, and they are pinned by the
 * frontend smoke test.
 *
 * 0.2.110 (M50): `c4s:toast` names the severity `variant` (a toast has no
 * `kind`), and `c4s:confirm-open` carries the window's `kind` and answers
 * through `onConfirm` / `onCancel`.
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  detail?: string;
  duration?: number;
}

const TOAST_EVENT = 'c4s:toast';
const CONFIRM_EVENT = 'c4s:confirm-open';

function fire(variant: ToastVariant, message: string, options?: ToastOptions): void {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { variant, message, ...options } }));
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
 * `kind` names the window (`<type>-delete`, `dto-example-delete`, …). The host's
 * confirm layer answers through the `onConfirm` / `onCancel` callbacks carried
 * on the event detail.
 */
export function confirmDestructive(kind: string, input: ConfirmInput): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(
      new CustomEvent(CONFIRM_EVENT, {
        detail: {
          ...input,
          kind,
          danger: true,
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
        },
      }),
    );
  });
}

const MODAL_EVENT = 'c4s:modal-open';

/**
 * 0.2.110 (M50): open a named modal window — e.g. `<type>-expand` for a hidden
 * type's read-only fullscreen view, which the host resolves to the type's own
 * `renderOverlay` slot. Resolves `null` when the window closes without a result.
 */
export function openModal<R = unknown>(kind: string, props: Record<string, unknown>): Promise<R | null> {
  return new Promise<R | null>((resolve) => {
    window.dispatchEvent(
      new CustomEvent(MODAL_EVENT, {
        detail: { kind, props, onSubmit: (r: R) => resolve(r), onCancel: () => resolve(null) },
      }),
    );
  });
}
