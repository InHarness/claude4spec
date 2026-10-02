import { useEffect, useRef } from 'react';
import { StickyNote } from 'lucide-react';
import { FieldLabel } from '../../ui/Popover.js';
import { assignTagRender, type TagRenderProps } from '../renders.js';
import { registerTagPopoverFields, type TagFieldsProps } from '../popover-fields.js';

/**
 * M08 — TODOs, browser side: an amber chip with a note icon, the comment
 * shortened in the text and whole in the tooltip. It points at nothing, so it
 * never navigates and has no broken state. `data-todo-chip` is what
 * `useScrollToTodo` counts to find the n-th marker.
 */
function TodoChip({ attrs }: TagRenderProps) {
  const comment = String(attrs.comment ?? '');
  const short = comment.length > 60 ? `${comment.slice(0, 57)}…` : comment;
  return (
    <span
      data-todo-chip=""
      className="inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[11px]"
      style={{
        background: 'rgba(200, 130, 60, 0.14)',
        color: '#a87033',
        border: '1px solid #c99467',
        fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
      }}
      title={
        comment
          ? `${comment}  ·  double-click or alt+click to edit`
          : 'TODO (no comment) · double-click or alt+click to edit'
      }
    >
      <StickyNote size={11} aria-hidden="true" />
      <span>TODO{short ? `: ${short}` : ''}</span>
    </span>
  );
}

/**
 * `comment` — multi-line text, the only field. A blank line would end the
 * paragraph the inline tag stands in, so runs of blank lines collapse to one
 * line break; Cmd/Ctrl+Enter submits.
 */
function TodoFields({ value, onChange, submit }: TagFieldsProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <>
      <FieldLabel>Comment</FieldLabel>
      <textarea
        ref={ref}
        rows={3}
        spellCheck={false}
        value={value.comment ?? ''}
        onChange={(e) => onChange({ ...value, comment: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="rate-limit review"
        className="w-full text-[13.5px] bg-transparent outline-none px-2 py-1 rounded resize-y"
        style={{ color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
      />
    </>
  );
}

export function normalizeTodoComment(comment: string): string {
  return comment.replace(/\r\n?/g, '\n').replace(/\n[ \t]*(\n[ \t]*)+/g, '\n').trim();
}

assignTagRender('todo', TodoChip);
registerTagPopoverFields('todo', {
  title: { create: 'New TODO', edit: 'Edit TODO' },
  icon: <StickyNote size={12} style={{ color: '#a87033' }} />,
  Fields: TodoFields,
  normalize: (v) => ({ ...v, comment: normalizeTodoComment(v.comment ?? '') }),
  // A non-empty comment is required to CREATE a marker; an empty one is still
  // a legal state of a marker already in the text, so editing may clear it.
  validate: (v, mode) => (mode === 'create' && !(v.comment ?? '').trim() ? 'A comment is required' : null),
  openOnDoubleClick: true,
});
