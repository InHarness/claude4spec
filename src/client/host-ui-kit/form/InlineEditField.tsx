import { useEffect, useRef, useState } from 'react';
import { withStability } from '../stability.js';

/**
 * `InlineEditField` (Form, `experimental`) — a single-line value that turns into
 * a text input on click and commits on blur / Enter (Escape reverts) — once per
 * edit: the blur that follows Enter or Escape commits nothing. Mirrors
 * the host's inline-edit pattern (debounced autosave lives in the caller).
 *
 * Pure-presentational: holds only local editing state; the committed value and
 * `onCommit` are props. No host access.
 */
export interface InlineEditFieldProps {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  /** Render the value with a monospace font (e.g. slugs, paths). */
  mono?: boolean;
}

function InlineEditFieldImpl({ value, onCommit, placeholder, mono }: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  // One settle per edit: Enter / Escape settle it, and the blur the input fires
  // as it leaves the DOM runs the PREVIOUS render's closure (the stale draft) —
  // it must neither commit a second time nor commit an Escape-reverted draft.
  const settled = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const startEditing = () => {
    settled.current = false;
    setEditing(true);
  };

  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    setDraft(value);
    setEditing(false);
  };

  const fontClass = mono ? 'font-mono' : '';

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder={placeholder}
        className={`w-full text-[13.5px] bg-transparent outline-none px-2 py-1 rounded ${fontClass}`}
        style={{ color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className={`w-full text-left text-[13.5px] px-2 py-1 rounded ${fontClass}`}
      style={{ color: value ? 'var(--c-ink)' : 'var(--c-subtle)', border: '1px solid transparent' }}
    >
      {value || placeholder || '—'}
    </button>
  );
}

export const InlineEditField = withStability(InlineEditFieldImpl, 'experimental');
