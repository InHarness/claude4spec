import { useEffect, useState } from 'react';
import { Dialog } from '../host-ui-kit/overlay/Dialog.js';
import { UI_EVENTS, type ConfirmRequest } from './events.js';

/**
 * A `c4s:confirm-open` payload as it may arrive. 0.2.110 answers through
 * `onConfirm` / `onCancel` and names a `kind`; a plugin built against the
 * pre-0.2.110 protocol still sends a bare `resolve(boolean)` and no `kind`.
 * The event names and payload shapes are the plugin contract, so the host keeps
 * accepting the old shape rather than silently leaving such a confirm unanswered.
 */
type IncomingConfirm = Omit<ConfirmRequest, 'onConfirm' | 'onCancel' | 'kind' | 'danger'> &
  Partial<Pick<ConfirmRequest, 'onConfirm' | 'onCancel' | 'kind' | 'danger'>> & {
    resolve?: (confirmed: boolean) => void;
  };

const settledConfirms = new WeakSet<IncomingConfirm>();

/** Answer a confirm exactly once (a React updater may run twice). */
function settleOnce(r: IncomingConfirm, confirmed: boolean): void {
  if (settledConfirms.has(r)) return;
  settledConfirms.add(r);
  if (confirmed) r.onConfirm?.();
  else r.onCancel?.();
  r.resolve?.(confirmed);
}

/**
 * The host's destructive-confirm FACADE (M34/L12 one-implementation rule): it
 * renders the catalog's `Dialog` in its destructive-confirm shape and maps a
 * `confirmDestructive(kind, …)` event payload onto its props. Scrim, panel
 * chrome, focus trap, focus restore and Escape all come from `Dialog` — nothing
 * here reimplements them. What stays is the invocation surface: an event-bus
 * singleton settling a promise, rather than props-in `open` state.
 *
 * 0.2.110: a layer of `<ModalHost/>`, not a host of its own.
 */
export function ConfirmLayer() {
  const [request, setRequest] = useState<IncomingConfirm | null>(null);
  const [typed, setTyped] = useState('');

  // Type-to-confirm: the confirm button stays disabled until the input matches.
  const requireText = request?.requireText;
  const matches = !requireText || typed.trim() === requireText;

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<IncomingConfirm>;
      setTyped('');
      // A newer confirm replaces the open one, which answers "cancel" rather
      // than leaving its caller's promise pending forever.
      setRequest((prev) => {
        if (prev && prev !== ce.detail) settleOnce(prev, false);
        return ce.detail;
      });
    };
    window.addEventListener(UI_EVENTS.CONFIRM, handler as EventListener);
    return () => window.removeEventListener(UI_EVENTS.CONFIRM, handler as EventListener);
  }, []);

  const [pending, setPending] = useState(false);

  function cancel() {
    // While `action` runs the action is already under way (a DELETE in flight):
    // closing the dialog as "cancelled" would not stop it, only hide its outcome.
    if (!request || pending) return;
    const r = request;
    setRequest(null);
    settleOnce(r, false);
  }

  async function confirm() {
    if (!request || !matches || pending) return;
    const r = request;
    if (r.action) {
      setPending(true);
      let done = false;
      try {
        done = await r.action();
      } finally {
        setPending(false);
      }
      if (!done) return;
    }
    setRequest(null);
    settleOnce(r, true);
  }

  if (!request) return null;

  const confirmLabel = request.confirmLabel ?? 'Delete';
  const cancelLabel = request.cancelLabel ?? 'Cancel';
  const danger = request.danger ?? true;

  return (
    <Dialog
      open
      onClose={cancel}
      // The destructive-confirm anatomy pins its own width and Lora title
      // rather than retuning `size="sm"`, which five other call sites share.
      title={
        <span style={{ fontFamily: 'var(--font-heading)', fontSize: 16, fontWeight: 500 }}>
          {request.title}
        </span>
      }
      width={400}
      footer={
        <>
          {/* Cancel is visually first so Escape and the eye both land on the
              safe option, even though the confirm button takes initial focus. */}
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            style={{ fontSize: 12, padding: '6px 12px', borderRadius: 4, color: 'var(--c-muted)' }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!matches || pending}
            autoFocus={!requireText}
            style={{
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: 4,
              fontWeight: 500,
              background: matches
                ? danger
                  ? 'var(--c-red, #c45a3b)'
                  : 'var(--c-accent)'
                : 'var(--c-hair-strong)',
              color: matches ? '#fff' : 'var(--c-subtle)',
              cursor: matches ? 'pointer' : 'not-allowed',
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div
        data-modal-kind={request.kind}
        style={{
          fontSize: 13.5,
          color: 'var(--c-muted)',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
        }}
      >
        {request.body}
      </div>
      {requireText ? (
        <input
          type="text"
          value={typed}
          autoFocus
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches) void confirm();
          }}
          placeholder={requireText}
          spellCheck={false}
          autoComplete="off"
          style={{
            width: '100%',
            fontSize: 13,
            padding: '7px 10px',
            borderRadius: 4,
            marginTop: 16,
            background: 'var(--c-bg)',
            border: '1px solid var(--c-hair-strong)',
            color: 'var(--c-ink)',
          }}
        />
      ) : null}
    </Dialog>
  );
}
