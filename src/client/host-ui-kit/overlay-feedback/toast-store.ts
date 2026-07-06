/**
 * M34/L12 — internal event bus backing `useToast()`/`ToastViewport`. Not part
 * of the public barrel: consumers only see the hook + component.
 *
 * Deliberately its OWN `CustomEvent` name (`c4s-ui:toast`), distinct from the
 * host-internal `c4s:toast` (`src/client/ui/events.ts`) — this is a separate
 * published contract, not a wrapper around the host's own toast system.
 */

export type ToastKind = 'success' | 'error' | 'warning';

export interface ToastAction {
  label: string;
  onClick(): void;
}

export interface ToastRequest {
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

export const TOAST_EVENT = 'c4s-ui:toast';

export function fireToast(kind: ToastKind, message: string, action?: ToastAction): void {
  const detail: ToastRequest = { kind, message, action };
  window.dispatchEvent(new CustomEvent<ToastRequest>(TOAST_EVENT, { detail }));
}
