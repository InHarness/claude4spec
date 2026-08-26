import { useEffect, useRef, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  PopoverShell,
  type PopoverFormProps,
} from '../Popover.js';
import type { AcKind } from '../../../shared/entities.js';

/** `title`'s bound in `acData` — 500 characters of criterion, not of label. */
const AC_TITLE_MAX_LENGTH = 500;

export function CreateAcForm({ request, onClose }: PopoverFormProps<'create-ac'>) {
  /**
   * 0.2.51 — the form collects `title`, which IS the criterion.
   *
   * It used to collect `text` and let the server derive a 200-character `title`
   * from it. There is no second field to derive from any more, and `title` is
   * required with no `computedDefault`, so a submit without it is a 400 rather
   * than a silently-labelled AC. Still a textarea: the criterion is a sentence
   * and may wrap, which is not the same thing as it being multi-paragraph prose.
   */
  const [text, setText] = useState('');
  const [kind, setKind] = useState<AcKind>('requirement');
  const [tagsRaw, setTagsRaw] = useState((request.props.defaultTags ?? []).join(', '));
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => textRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError('Title is required');
      return;
    }
    if (trimmed.length > AC_TITLE_MAX_LENGTH) {
      setError(
        `${trimmed.length} characters — the limit is ${AC_TITLE_MAX_LENGTH}. A criterion this long ` +
          'is usually several criteria; split it.',
      );
      return;
    }
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    onClose({
      title: trimmed,
      kind,
      ...(tags.length ? { tags } : {}),
    });
  }

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={400}
      onCancel={() => onClose(null)}
      title="New acceptance criterion"
      icon={<CheckSquare size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <FieldLabel>Title (observable behavior)</FieldLabel>
      <textarea
        ref={textRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
        maxLength={AC_TITLE_MAX_LENGTH}
        placeholder="User can verify their email via a one-click link valid for 24h."
        className="w-full rounded-md text-[13px] outline-none px-2 py-1.5"
        style={{
          background: 'var(--c-panel)',
          border: '1px solid var(--c-hair)',
          color: 'var(--c-ink)',
          resize: 'vertical',
        }}
      />

      <div className="mt-2 flex items-center gap-3">
        <FieldLabel>Kind</FieldLabel>
        <label className="text-[12px] flex items-center gap-1" style={{ color: 'var(--c-muted)' }}>
          <input
            type="radio"
            checked={kind === 'requirement'}
            onChange={() => setKind('requirement')}
          />
          requirement
        </label>
        <label className="text-[12px] flex items-center gap-1" style={{ color: 'var(--c-muted)' }}>
          <input
            type="radio"
            checked={kind === 'edge-case'}
            onChange={() => setKind('edge-case')}
          />
          edge-case
        </label>
      </div>

      <div className="mt-2">
        <FieldLabel>Tags (comma separated)</FieldLabel>
        <input
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="m07, security"
          className="w-full rounded-md text-[13px] outline-none px-2 py-1.5"
          style={{
            background: 'var(--c-panel)',
            border: '1px solid var(--c-hair)',
            color: 'var(--c-ink)',
            fontFamily: 'ui-monospace, monospace',
          }}
        />
      </div>

      <InlineError message={error} />
      <PopoverFooter onCancel={() => onClose(null)} onSubmit={submit} submitLabel="Create" />
    </PopoverShell>
  );
}
