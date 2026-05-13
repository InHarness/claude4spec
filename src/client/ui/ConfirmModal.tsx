import { useEffect, useRef, useState } from 'react';
import { UI_EVENTS, type ConfirmRequest } from './events.js';

export function ModalHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<ConfirmRequest>;
      setRequest(ce.detail);
    };
    window.addEventListener(UI_EVENTS.CONFIRM, handler as EventListener);
    return () => window.removeEventListener(UI_EVENTS.CONFIRM, handler as EventListener);
  }, []);

  useEffect(() => {
    if (!request) return;
    const t = window.setTimeout(() => confirmRef.current?.focus(), 0);
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
      if (e.key === 'Tab') {
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
    if (!request) return;
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
            style={{
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: 4,
              fontWeight: 500,
              background: danger ? 'var(--c-red, #c45a3b)' : 'var(--c-accent)',
              color: '#fff',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
