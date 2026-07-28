import { useEffect, useRef, useState } from 'react';
import { StickyNote } from 'lucide-react';
import { PopoverShell, TextInput, PopoverFooter } from '../ui/Popover.js';

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

/**
 * TODO popover. Its own event contract (callback-based, not promise-resolving)
 * — but no anatomy of its own: the panel, header, click-outside, Escape and
 * viewport clamping all come from `PopoverShell` → the catalog's `Popover`.
 */
export function TodoPopover() {
  const [request, setRequest] = useState<TodoPopoverRequest | null>(null);
  const [comment, setComment] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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

  const trimmed = comment.trim();
  const submitDisabled =
    request.mode === 'create' ? !trimmed : trimmed === request.initialComment.trim();

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      onCancel={cancel}
      title={request.mode === 'create' ? 'New TODO' : 'Edit TODO'}
      icon={<StickyNote size={12} style={{ color: '#a87033' }} />}
    >
      <TextInput
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
      />
      <PopoverFooter
        onCancel={cancel}
        onSubmit={submit}
        submitLabel={request.mode === 'create' ? 'Create' : 'Save'}
        disabled={submitDisabled}
        {...(request.mode === 'edit' ? { onRemove: remove } : null)}
      />
    </PopoverShell>
  );
}
