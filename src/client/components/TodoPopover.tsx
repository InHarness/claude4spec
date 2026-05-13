import { useEffect, useRef, useState } from 'react';
import { StickyNote } from 'lucide-react';

export type TodoPopoverRequest =
  | {
      x: number;
      y: number;
      mode: 'create';
      onSubmit: (comment: string) => void;
      onCancel?: () => void;
    }
  | {
      x: number;
      y: number;
      mode: 'edit';
      initialComment: string;
      onSubmit: (comment: string) => void;
      onRemove: () => void;
      onCancel?: () => void;
    };

const EVENT_NAME = 'c4s:todo-popover';

export function dispatchTodoPopover(detail: TodoPopoverRequest): void {
  window.dispatchEvent(new CustomEvent<TodoPopoverRequest>(EVENT_NAME, { detail }));
}

export function TodoPopover() {
  const [request, setRequest] = useState<TodoPopoverRequest | null>(null);
  const [comment, setComment] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<TodoPopoverRequest>;
      setRequest(ce.detail);
      setComment(ce.detail.mode === 'edit' ? ce.detail.initialComment : '');
    };
    window.addEventListener(EVENT_NAME, handler as EventListener);
    return () => window.removeEventListener(EVENT_NAME, handler as EventListener);
  }, []);

  useEffect(() => {
    if (request) {
      const t = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) cancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  function cancel() {
    if (!request) return;
    request.onCancel?.();
    setRequest(null);
  }

  function submit() {
    if (!request) return;
    const trimmed = comment.trim();
    if (request.mode === 'create' && !trimmed) return;
    if (request.mode === 'edit' && trimmed === request.initialComment.trim()) return;
    const req = request;
    setRequest(null);
    req.onSubmit(trimmed);
  }

  function remove() {
    if (!request || request.mode !== 'edit') return;
    const req = request;
    setRequest(null);
    req.onRemove();
  }

  if (!request) return null;

  const { x, y } = clampToViewport(request.x, request.y);
  const trimmed = comment.trim();
  const submitDisabled =
    request.mode === 'create'
      ? !trimmed
      : trimmed === request.initialComment.trim();

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={request.mode === 'create' ? 'New TODO' : 'Edit TODO'}
      className="rounded-md shadow-lg"
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 1100,
        width: 320,
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair-strong)',
        padding: 12,
      }}
    >
      <div
        className="flex items-center gap-2 mb-2 text-[11px] uppercase font-mono tracking-wider"
        style={{ color: 'var(--c-subtle)' }}
      >
        <StickyNote size={12} style={{ color: '#a87033' }} />
        {request.mode === 'create' ? 'New TODO' : 'Edit TODO'}
      </div>
      <input
        ref={inputRef}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="rate-limit review"
        spellCheck={false}
        className="w-full text-[13.5px] bg-transparent outline-none mb-2 px-2 py-1 rounded"
        style={{
          color: 'var(--c-ink)',
          border: '1px solid var(--c-hair)',
        }}
      />
      <div className="flex items-center gap-2 justify-end">
        {request.mode === 'edit' && (
          <button
            onClick={remove}
            className="text-[12px] px-2 py-1 rounded mr-auto"
            style={{ color: 'var(--c-red, #c45a3b)' }}
          >
            Remove
          </button>
        )}
        <button
          onClick={cancel}
          className="text-[12px] px-2 py-1 rounded"
          style={{ color: 'var(--c-muted)' }}
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitDisabled}
          className="text-[12px] px-3 py-1 rounded font-medium"
          style={{
            background: 'var(--c-accent)',
            color: '#fff',
            opacity: submitDisabled ? 0.5 : 1,
          }}
        >
          {request.mode === 'create' ? 'Create' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function clampToViewport(x: number, y: number): { x: number; y: number } {
  const width = 320;
  const estHeight = 110;
  const pad = 8;
  const maxX = window.innerWidth - width - pad;
  const maxY = window.innerHeight - estHeight - pad;
  return {
    x: Math.max(pad, Math.min(x, maxX)),
    y: Math.max(pad, Math.min(y, maxY)),
  };
}
