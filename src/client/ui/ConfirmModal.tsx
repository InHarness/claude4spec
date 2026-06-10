import { useEffect, useRef, useState } from 'react';
import { UI_EVENTS, type ConfirmRequest } from './events.js';

export function ModalHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [typed, setTyped] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!request) return;
    // Focus the input for type-to-confirm, otherwise the confirm button.
    const t = window.setTimeout(
      () => (request.requireText ? inputRef.current : confirmRef.current)?.focus(),
      0,
    );
    return () => window.clearTimeout(t);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      // With a type-to-confirm input present, let Tab move naturally so the
      // input stays reachable; only trap focus in the plain two-button case.
      if (e.key === 'Tab' && !request.requireText) {
        e.preventDefault();
        const el = document.activeElement;
        if (el === confirmRef.current) cancelRef.current?.focus();
        else confirmRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={request.title}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        style={{
          width: 400,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair-strong)',
          borderRadius: 8,
          padding: 20,
          boxShadow: '0 20px 48px rgba(0,0,0,0.20)',
        }}
      >
        <div
          style={{
            fontFamily: 'Lora, serif',
            fontSize: 16,
            color: 'var(--c-ink)',
            marginBottom: 10,
            fontWeight: 500,
          }}
        >
          {request.title}
        </div>
        <div
          style={{
            fontSize: 13.5,
            color: 'var(--c-muted)',
            lineHeight: 1.5,
            marginBottom: 20,
            whiteSpace: 'pre-wrap',
          }}
        >
          {request.body}
        </div>
        {requireText ? (
          <input
            ref={inputRef}
            type="text"
            value={typed}
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
              marginBottom: 20,
              background: 'var(--c-bg)',
              border: '1px solid var(--c-hair-strong)',
              color: 'var(--c-ink)',
            }}
          />
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            ref={cancelRef}
            onClick={cancel}
            style={{
              fontSize: 12,
              padding: '6px 12px',
              borderRadius: 4,
              color: 'var(--c-muted)',
            }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={confirm}
            disabled={!matches}
            style={{
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: 4,
              fontWeight: 500,
              background: matches ? (danger ? 'var(--c-red, #c45a3b)' : 'var(--c-accent)') : 'var(--c-hair-strong)',
              color: matches ? '#fff' : 'var(--c-subtle)',
              cursor: matches ? 'pointer' : 'not-allowed',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
