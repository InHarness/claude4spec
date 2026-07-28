import { useEffect, useState } from 'react';
import { Dialog } from '../host-ui-kit/overlay/Dialog.js';
import { UI_EVENTS, type ConfirmRequest } from './events.js';

/**
 * The host's destructive-confirm FACADE (M34/L12 one-implementation rule): it
 * renders the catalog's `Dialog` in its destructive-confirm shape and maps a
 * `confirmDestructive()` event payload onto its props. Scrim, panel chrome,
 * focus trap, focus restore and Escape all come from `Dialog` — nothing here
 * reimplements them. What stays is the invocation surface: an event-bus
 * singleton resolving a promise, rather than props-in `open` state.
 *
 * `confirmDestructive()` itself is unchanged by the move.
 */
export function ModalHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [typed, setTyped] = useState('');

  // Type-to-confirm: the confirm button stays disabled until the input matches.
  const requireText = request?.requireText;
  const matches = !requireText || typed.trim() === requireText;

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<ConfirmRequest>;
      setTyped('');
      setRequest(ce.detail);
    };
    window.addEventListener(UI_EVENTS.CONFIRM, handler as EventListener);
    return () => window.removeEventListener(UI_EVENTS.CONFIRM, handler as EventListener);
  }, []);

  function cancel() {
    if (!request) return;
    const r = request;
    setRequest(null);
    r.resolve(false);
  }

  function confirm() {
    if (!request || !matches) return;
    const r = request;
    setRequest(null);
    r.resolve(true);
  }

  if (!request) return null;

  const confirmLabel = request.confirmLabel ?? 'Delete';
  const cancelLabel = request.cancelLabel ?? 'Cancel';
  const danger = request.danger ?? true;

  return (
    <Dialog
      open
      onClose={cancel}
      title={request.title}
      size="sm"
      footer={
        <>
          {/* Cancel is visually first so Escape and the eye both land on the
              safe option, even though the confirm button takes initial focus. */}
          <button
            type="button"
            onClick={cancel}
            style={{ fontSize: 12, padding: '6px 12px', borderRadius: 4, color: 'var(--c-muted)' }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!matches}
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
            if (e.key === 'Enter' && matches) confirm();
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
