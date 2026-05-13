import { useEffect, useMemo, useRef, useState } from 'react';
import { Hash } from 'lucide-react';
import {
  FieldLabel,
  InlineError,
  PopoverFooter,
  PopoverShell,
  TextInput,
  type PopoverFormProps,
} from '../Popover.js';
import { useSectionsAutocomplete } from '../../hooks/useSection.js';
import type { SectionIndexEntry } from '../../../shared/entities.js';

export function SectionPickerForm({ request, onClose }: PopoverFormProps<'section'>) {
  const initialAnchor = request.props.initialAnchor ?? '';
  const onRemove = request.props.onRemove;

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState(initialAnchor);
  const [error, setError] = useState<string | null>(null);
  const queryRef = useRef<HTMLInputElement>(null);

  const { data: all = [], isLoading } = useSectionsAutocomplete();

  const filtered = useMemo<SectionIndexEntry[]>(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? all.filter(
          (s) =>
            s.headingText.toLowerCase().includes(q) ||
            s.pagePath.toLowerCase().includes(q) ||
            s.anchor.toLowerCase().includes(q),
        )
      : all;
    return list.slice(0, 50);
  }, [all, query]);

  useEffect(() => {
    const t = window.setTimeout(() => queryRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function submit(picked?: SectionIndexEntry) {
    const target = picked ?? filtered[active];
    const finalAnchor = target?.anchor ?? anchor.trim();
    if (!finalAnchor) {
      setError('Pick a section or paste an anchor');
      return;
    }
    onClose({ anchor: finalAnchor });
  }

  return (
    <PopoverShell
      x={request.x}
      y={request.y}
      width={420}
      estHeight={320}
      onCancel={() => onClose(null)}
      title={initialAnchor ? 'Edit section reference' : 'Insert section reference'}
      icon={<Hash size={12} style={{ color: 'var(--c-accent)' }} />}
    >
      <div style={{ marginBottom: 8 }}>
        <FieldLabel>Search heading or page</FieldLabel>
        <TextInput
          ref={queryRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Cel, faza 0, m06srref…"
        />
      </div>
      <div
        style={{
          maxHeight: 220,
          overflowY: 'auto',
          border: '1px solid var(--c-hair)',
          borderRadius: 4,
          fontSize: 12.5,
        }}
      >
        {isLoading && filtered.length === 0 ? (
          <div style={{ padding: 8, color: 'var(--c-subtle)' }}>Loading sections…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 8, color: 'var(--c-subtle)' }}>No matches</div>
        ) : (
          filtered.map((s, idx) => (
            <button
              type="button"
              key={s.anchor}
              onClick={() => submit(s)}
              onMouseEnter={() => setActive(idx)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '4px 8px',
                background: idx === active ? 'var(--c-accent-soft)' : 'transparent',
                color: 'var(--c-ink)',
                cursor: 'pointer',
                border: 'none',
              }}
            >
              <div style={{ fontWeight: 500 }}>
                {'  '.repeat(Math.max(0, s.headingLevel - 1))}
                {s.headingText}
              </div>
              <div style={{ color: 'var(--c-subtle)', fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>
                {s.pagePath} · {s.anchor}
              </div>
            </button>
          ))
        )}
      </div>
      <InlineError message={error} />
      <div style={{ marginTop: 8 }}>
        <PopoverFooter
          onCancel={() => onClose(null)}
          onSubmit={() => submit()}
          submitLabel={initialAnchor ? 'Save' : 'Insert'}
          {...(onRemove
            ? {
                onRemove: () => {
                  onRemove();
                  onClose({ __action: 'remove' });
                },
              }
            : {})}
        />
      </div>
      <input
        type="hidden"
        value={anchor}
        readOnly
        onChange={(e) => setAnchor(e.target.value)}
      />
    </PopoverShell>
  );
}
