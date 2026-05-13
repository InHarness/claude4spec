import { useRef } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { StickyNote } from 'lucide-react';
import { dispatchTodoPopover } from '../../../components/TodoPopover.js';

export function TodoView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const comment = String(node.attrs.comment ?? '');
  const trimmed = comment.length > 60 ? `${comment.slice(0, 57)}…` : comment;
  const wrapperRef = useRef<HTMLSpanElement>(null);

  function openEditPopover(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    dispatchTodoPopover({
      x: rect.left,
      y: rect.bottom + 4,
      mode: 'edit',
      initialComment: comment,
      onSubmit: (newComment) => updateAttributes({ comment: newComment }),
      onRemove: () => deleteNode(),
    });
  }

  function handleClick(e: React.MouseEvent) {
    if (!e.altKey) return;
    openEditPopover(e);
  }

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      as="span"
      className="inline-flex align-middle"
      contentEditable={false}
      onClick={handleClick}
      onDoubleClick={openEditPopover}
    >
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[11px]"
        style={{
          background: 'rgba(200, 130, 60, 0.14)',
          color: '#a87033',
          border: '1px solid #c99467',
          fontFamily: 'var(--font-mono)',
          cursor: 'pointer',
        }}
        title={comment ? `${comment}  ·  double-click or alt+click to edit` : 'TODO (no comment) · double-click or alt+click to edit'}
      >
        <StickyNote size={11} aria-hidden="true" />
        <span>TODO{trimmed ? `: ${trimmed}` : ''}</span>
      </span>
    </NodeViewWrapper>
  );
}
