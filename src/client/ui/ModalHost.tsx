import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { ConfirmLayer } from './ConfirmModal.js';
import {
  UI_EVENTS,
  type ModalKind,
  type ModalRequest,
  type ModalResult,
} from './events.js';
import { MODAL_RENDERERS } from './modals/registry.js';

export interface ModalFormProps<K extends ModalKind> {
  request: ModalRequest<K>;
  /** `null` = cancelled / dismissed; anything else is the window's result. */
  onClose: (result: ModalResult<K> | null) => void;
}

/**
 * 0.2.110 M50 — `<ModalHost/>`, mounted ONCE at the app root beside
 * `<PopoverHost/>` and `<ToastHost/>`. It owns two layers:
 *
 * - the destructive confirm (`confirmDestructive(kind, …)` → `c4s:confirm-open`);
 * - the non-destructive modal (`openModal(kind, props)` → `c4s:modal-open`).
 *
 * A modal `kind` renders from the host registry (`modals/registry.ts`). A
 * `<type>-expand` kind the host does not list resolves to that entity type's
 * `renderOverlay` slot — which surface a hidden type expands into is the TYPE's
 * business, so the host names no type. A kind that resolves to nothing (unknown,
 * inactive, not embed-only) cancels at once: that is the broken-chip case, where
 * clicking must do nothing rather than open an empty shell.
 */
export function ModalHost() {
  // One modal on screen at a time. A new window replaces (and cancels) the
  // open one — unless that one is `dismissible: false` (a gate such as
  // plugin trust), which nothing may paint over or close: the newcomer waits.
  const [queue, setQueue] = useState<ModalRequest[]>([]);
  const request = queue[0] ?? null;

  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent<ModalRequest>).detail;
      setQueue((prev) => {
        const [head, ...rest] = prev;
        if (!head) return [next];
        if (head.dismissible === false) return [...prev, next];
        head.onCancel();
        return [next, ...rest];
      });
    };
    window.addEventListener(UI_EVENTS.MODAL, handler as EventListener);
    return () => window.removeEventListener(UI_EVENTS.MODAL, handler as EventListener);
  }, []);

  const close = (result: unknown) => {
    const r = request;
    setQueue((prev) => prev.slice(1));
    if (!r) return;
    if (result === null || result === undefined) {
      // `void`-result kinds (viewers) close with no value — that is not a cancel
      // for them, but both settle the promise the same way (`null`).
      r.onCancel();
    } else {
      r.onSubmit(result as never);
    }
  };

  return (
    <>
      {request ? <ModalLayer request={request} onClose={close} /> : null}
      <ConfirmLayer />
    </>
  );
}

function ModalLayer({
  request,
  onClose,
}: {
  request: ModalRequest;
  onClose: (result: unknown) => void;
}): ReactNode {
  const Renderer = (MODAL_RENDERERS as Record<string, ComponentType<ModalFormProps<ModalKind>>>)[
    request.kind
  ];
  if (Renderer) return <Renderer request={request} onClose={onClose as never} />;

  const expand = /^(.+)-expand$/.exec(request.kind);
  const Overlay = expand ? clientPluginHost.getEntity(expand[1]!)?.renderOverlay : undefined;
  if (!Overlay) {
    queueMicrotask(() => onClose(null));
    return null;
  }
  const props = request.props as { slug: string; caption?: string };
  return (
    <Overlay
      slug={props.slug}
      {...(props.caption ? { caption: props.caption } : {})}
      onClose={() => onClose(null)}
    />
  );
}
