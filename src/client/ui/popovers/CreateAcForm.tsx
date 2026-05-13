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

export function CreateAcForm({ request, onClose }: PopoverFormProps<'create-ac'>) {
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
      setError('Text is required');
      return;
    }
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    onClose({
      text: trimmed,
      kind,
      ...(tags.length ? { tags } : {}),
    });
  }

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={400}
      estHeight={260}
      onCancel={() => onClose(null)}
      title="New acceptance criterion"
      icon={<CheckSquare size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <FieldLabel>Text (observable behavior)</FieldLabel>
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
