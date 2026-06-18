import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

/**
 * Editable monospace view for the raw JSX node (M20). Renders the verbatim tag
 * bytes; the user edits the JSX text directly and edits are written back to the
 * `raw` attribute (which the serializer emits verbatim, no fence). Content is
 * NOT markdown-rendered or M06-indexed — it is uninterpreted code.
 */
export function RawJsxView({ node, updateAttributes }: NodeViewProps) {
  const isBlock = node.type.name === 'raw_jsx_block';
  const raw = String(node.attrs.raw ?? '');
  const [value, setValue] = useState(raw);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Keep local state in sync when the attr changes from outside (undo, collab).
  useEffect(() => setValue(raw), [raw]);

  function autosize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }
  useEffect(autosize, [value, isBlock]);

  function commit() {
    if (value !== raw) updateAttributes({ raw: value });
  }

  const codeStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: '12.5px',
    color: 'var(--c-ink, #3a342c)',
    background: 'var(--c-accent-soft, rgba(160, 120, 70, 0.10))',
    border: '1px solid var(--c-border, #d9cdb8)',
    borderRadius: 4,
    padding: isBlock ? '8px 10px' : '0 4px',
    width: isBlock ? '100%' : undefined,
    resize: 'none',
    overflow: 'hidden',
    whiteSpace: 'pre',
    boxSizing: 'border-box',
  };

  if (isBlock) {
    return (
      <NodeViewWrapper as="div" className="c4s-raw-jsx" contentEditable={false}>
        <textarea
          ref={taRef}
          value={value}
          spellCheck={false}
          rows={Math.max(1, value.split('\n').length)}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          style={codeStyle}
          aria-label="Raw JSX block"
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="c4s-raw-jsx inline-flex align-middle" contentEditable={false}>
      <input
        type="text"
        value={value}
        spellCheck={false}
        size={Math.max(1, value.length)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        style={{ ...codeStyle, whiteSpace: 'nowrap' }}
        aria-label="Raw JSX"
      />
    </NodeViewWrapper>
  );
}
