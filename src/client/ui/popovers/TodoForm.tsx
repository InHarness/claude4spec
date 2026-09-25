import { useEffect, useRef, useState } from 'react';
import { StickyNote } from 'lucide-react';
import { PopoverShell, TextInput, PopoverFooter, type PopoverFormProps } from '../Popover.js';

/**
 * 0.2.110 M08 — the `todo-create` / `todo-edit` popovers (`openPopover`),
 * replacing the TODO popover's own `c4s:todo-popover` event. No anatomy of its
 * own: the panel, header, click-outside, Escape and viewport clamping all come
 * from `PopoverShell` → the catalog's `Popover`.
 *
 * create: Cancel / Create (disabled while empty). edit: Cancel / Remove / Save
 * (Save enabled only once the comment changed).
 */
export function TodoForm({
  request,
  onClose,
}: PopoverFormProps<'todo-create'> | PopoverFormProps<'todo-edit'>) {
  const edit = request.kind === 'todo-edit' ? (request.props as { initialComment: string; onRemove: () => void }) : null;
  const initialComment = edit?.initialComment ?? '';
  const [comment, setComment] = useState(initialComment);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = onClose as (r: { comment: string } | null) => void;

  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const trimmed = comment.trim();
  const submitDisabled = edit ? trimmed === initialComment.trim() : !trimmed;

  function submit() {
    if (submitDisabled) return;
    close({ comment: trimmed });
  }

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      onCancel={() => close(null)}
      title={edit ? 'Edit TODO' : 'New TODO'}
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
        onCancel={() => close(null)}
        onSubmit={submit}
        submitLabel={edit ? 'Save' : 'Create'}
        disabled={submitDisabled}
        {...(edit
          ? {
              onRemove: () => {
                edit.onRemove();
                close(null);
              },
            }
          : null)}
      />
    </PopoverShell>
  );
}
