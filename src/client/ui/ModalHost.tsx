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
  //
  // Entries carry an id: the layer is keyed on it (a replacing window of the
  // same component starts from fresh state), and a close removes ITS entry by
  // identity — a late `onClose` from a replaced window must not pop the
  // newcomer off the queue.
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const head = queue[0] ?? null;

  useEffect(() => {
    const handler = (e: Event) => {
      const request = (e as CustomEvent<ModalRequest>).detail;
      // A kind that resolves to nothing (unknown, inactive, not embed-only)
      // cancels at once and never takes the screen — the broken-chip case.
      if (!resolvable(request.kind)) {
        settle(request, null);
        return;
      }
      const next: QueueEntry = { id: ++nextId, request };
      setQueue((prev) => {
        const [first, ...rest] = prev;
        if (!first) return [next];
        if (first.request.dismissible === false) return [...prev, next];
        // `settle` is idempotent, so a re-run updater cancels it only once.
        settle(first.request, null);
        return [next, ...rest];
      });
    };
    window.addEventListener(UI_EVENTS.MODAL, handler as EventListener);
    return () => window.removeEventListener(UI_EVENTS.MODAL, handler as EventListener);
  }, []);

  const closeEntry = (entry: QueueEntry, result: unknown) => {
    setQueue((prev) => prev.filter((x) => x !== entry));
    settle(entry.request, result);
  };

  return (
    <>
      {head ? (
        <ModalLayer key={head.id} request={head.request} onClose={(r) => closeEntry(head, r)} />
      ) : null}
      <ConfirmLayer />
    </>
  );
}

interface QueueEntry {
  id: number;
  request: ModalRequest;
}

let nextId = 0;
const settled = new WeakSet<ModalRequest>();

/**
 * Answer a request exactly once. `void`-result kinds (viewers) close with no
 * value — that is not a cancel for them, but both settle the promise the same
 * way (`null`).
 */
function settle(r: ModalRequest, result: unknown): void {
  if (settled.has(r)) return;
  settled.add(r);
  if (result === null || result === undefined) r.onCancel();
  else r.onSubmit(result as never);
}

function expandOverlay(kind: string) {
  const expand = /^(.+)-expand$/.exec(kind);
  return expand ? clientPluginHost.getEntity(expand[1]!)?.renderOverlay : undefined;
}

function resolvable(kind: string): boolean {
  return kind in MODAL_RENDERERS || expandOverlay(kind) !== undefined;
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

  // Resolved at enqueue time too; a type that deactivated since then closes
  // the window from an effect (never as a side effect of rendering).
  const Overlay = expandOverlay(request.kind);
  if (!Overlay) return <CloseNow onClose={onClose} />;
  // Every prop the opener sent reaches the type's overlay — a card that already
  // holds the record passes it along (`entity`), so the overlay need not refetch.
  const { caption, ...rest } = request.props as { slug: string; caption?: string };
  return (
    <Overlay
      {...(rest as { slug: string })}
      {...(caption ? { caption } : {})}
      onClose={() => onClose(null)}
    />
  );
}

function CloseNow({ onClose }: { onClose: (result: unknown) => void }): null {
  useEffect(() => {
    onClose(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
