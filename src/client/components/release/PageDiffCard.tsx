import { useState } from 'react';
import type { FileDiff, FileDiffModifiedSection, SectionKey } from '../../../shared/entities.js';
import { colorForOp, labelForOp } from '../../lib/release-diff/colors.js';
import { DiffView } from '../../host-ui-kit/detail/DiffView.js';
import { toDiffViewHunks } from '../../lib/release-diff/to-diff-view.js';
import { FrontmatterDiffPanel } from './FrontmatterDiffPanel.js';
import { XmlRefsDiffPanel } from './XmlRefsDiffPanel.js';

interface Props {
  change: FileDiff;
}

/**
 * Hybrid C render dla strony (M17 m17ui002):
 *   1. header z typem + path + label (added/modified/deleted)
 *   2. bullet list operacji sekcji (+ section, − section, ~ section, ↕ section)
 *   3. collapsible line-diff per entry of `modified_sections`
 *   4. side-channels: frontmatter_diff, xml_refs_diff
 *
 * 2.0.0 — the diff comes from the shared section parser: a row exists only
 * when a section's OWN body (or its heading) changed, so a parent touched only
 * through a child has no row of its own; a subsection row names its ancestors
 * (`headingPath`); a change above the first heading is a "Page preamble" row,
 * rendered before the section rows.
 */
export function PageDiffCard({ change }: Props) {
  const op = colorForOp(change.op);
  // A page whose content could not be read on one side (the git-anchored path
  // degrades it to its file-level status) comes with empty section arrays and
  // null side-channels. Without this fallback the card renders a bare op badge
  // with no body at all, indistinguishable from a real "nothing to show" bug —
  // say so explicitly instead.
  const hasDetail =
    change.added_sections.length > 0 ||
    change.removed_sections.length > 0 ||
    change.modified_sections.length > 0 ||
    change.moved_sections.length > 0 ||
    change.frontmatter_diff !== null ||
    change.xml_refs_diff !== null;
  return (
    <div
      className="rounded-md"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className="inline-block rounded text-[10px] font-mono px-1.5 py-0.5 uppercase"
          style={{ background: op.bg, color: op.fg }}
        >
          {labelForOp(change.op)}
        </span>
        <span className="text-[11.5px] font-mono" style={{ color: 'var(--c-subtle)' }}>
          page
        </span>
        <span className="text-[13px] font-mono" style={{ color: 'var(--c-ink)' }}>
          {change.path}
        </span>
      </div>

      <div className="px-3 pb-3 space-y-2">
        <SectionBullets change={change} />
        {change.modified_sections.length > 0 && (
          <div className="space-y-1.5">
            {preambleFirst(change.modified_sections).map((s, i) => (
              <ModifiedSectionDetails key={s.anchor ?? `${s.heading}-${i}`} section={s} />
            ))}
          </div>
        )}
        {change.frontmatter_diff && <FrontmatterDiffPanel diff={change.frontmatter_diff} />}
        {change.xml_refs_diff && <XmlRefsDiffPanel diff={change.xml_refs_diff} />}
        {!hasDetail && (
          <p className="text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
            File-level change only — no section-level detail available for this comparison.
          </p>
        )}
      </div>
    </div>
  );
}

type RowKind = 'add' | 'remove' | 'modify' | 'move';

/** The preamble row renders before every section row. */
function preambleFirst<T extends SectionKey>(entries: readonly T[]): T[] {
  return [...entries.filter((e) => e.kind === 'preamble'), ...entries.filter((e) => e.kind !== 'preamble')];
}

function SectionBullets({ change }: { change: FileDiff }) {
  const items: Array<{ kind: RowKind; key: SectionKey | null; label: string }> = [];
  const push = (kind: RowKind, entries: readonly SectionKey[]) => {
    for (const s of entries) items.push({ kind, key: s, label: sectionLabel(s) });
  };
  push('add', change.added_sections);
  push('remove', change.removed_sections);
  push('modify', change.modified_sections);
  for (const s of change.moved_sections) {
    items.push({ kind: 'move', key: null, label: `${s.anchor} (${s.from_position} → ${s.to_position})` });
  }
  if (items.length === 0) return null;
  const ordered = [
    ...items.filter((it) => it.key?.kind === 'preamble'),
    ...items.filter((it) => it.key?.kind !== 'preamble'),
  ];
  return (
    <ul className="space-y-0.5 text-[12.5px] font-mono">
      {ordered.map((it, i) => (
        <li key={i} className="flex items-baseline gap-1.5" data-testid="section-row">
          <span style={{ color: glyphColor(it.kind), width: 10, display: 'inline-block' }}>
            {glyphFor(it.kind)}
          </span>
          {it.key?.kind === 'preamble' ? (
            <span style={{ color: 'var(--c-ink)' }}>Page preamble</span>
          ) : (
            <>
              <span style={{ color: 'var(--c-muted)' }}>section</span>
              {it.key && it.key.headingPath.length > 0 && (
                <span style={{ color: 'var(--c-subtle)' }}>{it.key.headingPath.join(' › ')} ›</span>
              )}
              <span style={{ color: 'var(--c-ink)' }}>{it.label}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function ModifiedSectionDetails({ section }: { section: FileDiffModifiedSection }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="rounded"
      style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-baseline gap-1.5 px-2 py-1 text-left text-[11.5px] font-mono"
      >
        <span style={{ color: 'var(--c-muted)' }}>{expanded ? '▾' : '▸'}</span>
        <span style={{ color: 'var(--c-ink)' }}>
          {section.kind === 'preamble'
            ? 'Page preamble'
            : [...section.headingPath, sectionLabel(section)].join(' › ')}
        </span>
        <span className="flex-1" />
        <span style={{ color: 'var(--c-subtle)' }}>line diff</span>
      </button>
      {expanded && (
        <div className="px-2 pb-2">
          <DiffView hunks={toDiffViewHunks(section.line_diff)} />
        </div>
      )}
    </div>
  );
}

function sectionLabel(s: SectionKey): string {
  if (s.kind === 'preamble') return 'Page preamble';
  const h = s.heading?.trim() ?? '';
  if (s.anchor === null) return h;
  return h ? `${h} (${s.anchor})` : s.anchor;
}

function glyphFor(kind: RowKind): string {
  if (kind === 'add') return '+';
  if (kind === 'remove') return '−';
  if (kind === 'modify') return '~';
  return '↕';
}

function glyphColor(kind: RowKind): string {
  if (kind === 'add') return '#059669';
  if (kind === 'remove') return '#dc2626';
  if (kind === 'modify') return '#2563eb';
  return 'var(--c-muted)';
}
