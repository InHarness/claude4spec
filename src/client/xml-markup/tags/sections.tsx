import { useEffect, useMemo, useRef, useState } from 'react';
import { Hash } from 'lucide-react';
import { useSection, useSectionsAutocomplete } from '../../hooks/useSection.js';
import { useEditorBridge } from '../../tiptap/EditorContext.js';
import { SectionRefChip, type SectionRefChipState } from '../../components/SectionRefChip.js';
import { SectionRefChipWithData } from '../../components/SectionRefChipWithData.js';
import { FieldLabel, TextInput } from '../../ui/Popover.js';
import type { SectionIndexEntry } from '../../../shared/entities.js';
import { assignTagRender, type TagRenderProps } from '../renders.js';
import { registerTagPopoverFields, type TagFieldsProps } from '../popover-fields.js';

/**
 * M06 — Sections, browser side: `SectionRefChip` as the render of
 * `<section_ref anchor/>` — the heading text from the section index, a `Hash`
 * icon, a `{page_path} > {heading_text}` tooltip, and `[broken: anchor]` in red
 * when the anchor is not in the index. Inside an editor it navigates through
 * the editor bridge; outside one (chat) the self-contained chip resolves
 * page-first, then plan.
 */
function SectionRefRender({ attrs }: TagRenderProps) {
  const bridge = useEditorBridge();
  const anchor = String(attrs.anchor ?? '');
  if (!bridge) return <SectionRefChipWithData anchor={anchor} />;
  return <BridgedSectionRef anchor={anchor} openSection={bridge.openSection} />;
}

function BridgedSectionRef({
  anchor,
  openSection,
}: {
  anchor: string;
  openSection: (pagePath: string, anchor: string) => void;
}) {
  const { data, isLoading } = useSection(anchor || null);
  const state: SectionRefChipState = !anchor
    ? 'broken'
    : isLoading && data === undefined
      ? 'loading'
      : data
        ? 'normal'
        : 'broken';
  return (
    <SectionRefChip
      anchor={anchor}
      pagePath={data?.pagePath}
      headingText={data?.headingText}
      state={state}
      onClick={(e) => {
        // Alt+click belongs to the edit-popover convention of the host surface.
        if (e.altKey) return;
        if (data) openSection(data.pagePath, anchor);
      }}
    />
  );
}

/** The anchor picker: search the section index by heading, page or anchor. */
function SectionFields({ value, onChange, submit }: TagFieldsProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
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
  useEffect(() => setActive(0), [query]);

  const pick = (s: SectionIndexEntry | undefined) => {
    if (!s) return submit();
    const next = { ...value, anchor: s.anchor };
    onChange(next);
    submit(next);
  };

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <FieldLabel>Search heading or page</FieldLabel>
        <TextInput
          ref={queryRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(filtered[active]);
            }
          }}
          placeholder="Goal, phase 0, m06srref…"
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
              onClick={() => pick(s)}
              onMouseEnter={() => setActive(idx)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '4px 8px',
                background:
                  idx === active || s.anchor === value.anchor ? 'var(--c-accent-soft)' : 'transparent',
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
    </>
  );
}

assignTagRender('section_ref', SectionRefRender);
registerTagPopoverFields('section_ref', {
  title: { create: 'Insert section reference', edit: 'Edit section reference' },
  icon: <Hash size={12} style={{ color: 'var(--c-accent)' }} />,
  width: 420,
  Fields: SectionFields,
  normalize: (v) => ({ ...v, anchor: (v.anchor ?? '').trim() }),
  validate: (v) => ((v.anchor ?? '').trim() ? null : 'Pick a section or paste an anchor'),
});
