import { useState } from 'react';
import type { RawDeltaPageChange, ModifiedSectionLite } from '../../../shared/entities.js';
import { colorForOp, labelForOp } from '../../lib/release-diff/colors.js';
import { LineDiffViewer } from './LineDiffViewer.js';
import { FrontmatterDiffPanel } from './FrontmatterDiffPanel.js';
import { XmlRefsDiffPanel } from './XmlRefsDiffPanel.js';

interface Props {
  change: RawDeltaPageChange;
}

/**
 * Hybrid C render dla strony (M17 m17ui002):
 *   1. header z typem + path + label (added/modified/deleted)
 *   2. bullet list operacji sekcji (+ section, − section, ~ section, ↕ section)
 *   3. collapsible line-diff per `section_modified`
 *   4. side-channels: frontmatter_diff, xml_refs_diff
 */
export function PageDiffCard({ change }: Props) {
  const op = colorForOp(change.op);
  // 0.1.118: the git-anchored release-diff path (ReleaseService.tryGitAnchoredDiff)
  // is file-level only — it always emits empty section arrays and null
  // frontmatter/xml diffs (an accepted, spec-confirmed fidelity tradeoff).
  // Without this fallback the card renders a bare op badge with no body at
  // all, indistinguishable from a real "nothing to show" bug — say so
  // explicitly instead.
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
            {change.modified_sections.map((s) => (
              <ModifiedSectionDetails key={s.anchor} section={s} />
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

function SectionBullets({ change }: { change: RawDeltaPageChange }) {
  const items: Array<{ kind: 'add' | 'remove' | 'modify' | 'move'; label: string }> = [];
  for (const s of change.added_sections) {
    items.push({ kind: 'add', label: sectionLabel(s.heading, s.anchor) });
  }
  for (const s of change.removed_sections) {
    items.push({ kind: 'remove', label: sectionLabel(s.heading, s.anchor) });
  }
  for (const s of change.modified_sections) {
    items.push({ kind: 'modify', label: sectionLabel(s.heading, s.anchor) });
  }
  for (const s of change.moved_sections) {
    items.push({
      kind: 'move',
      label: `${s.anchor} (${s.from_position} → ${s.to_position})`,
    });
  }
  if (items.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-[12.5px] font-mono">
      {items.map((it, i) => (
        <li key={i} className="flex items-baseline gap-1.5">
          <span style={{ color: glyphColor(it.kind), width: 10, display: 'inline-block' }}>
            {glyphFor(it.kind)}
          </span>
          <span style={{ color: 'var(--c-muted)' }}>section</span>
          <span style={{ color: 'var(--c-ink)' }}>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

function ModifiedSectionDetails({ section }: { section: ModifiedSectionLite }) {
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
        <span style={{ color: 'var(--c-ink)' }}>{sectionLabel(section.heading, section.anchor)}</span>
        <span className="flex-1" />
        <span style={{ color: 'var(--c-subtle)' }}>line diff</span>
      </button>
      {expanded && (
        <div className="px-2 pb-2">
          <LineDiffViewer lineDiff={section.line_diff} />
        </div>
      )}
    </div>
  );
}

function sectionLabel(heading: string, anchor: string): string {
  const h = heading?.trim();
  return h ? `${h} (${anchor})` : anchor;
}

function glyphFor(kind: 'add' | 'remove' | 'modify' | 'move'): string {
  if (kind === 'add') return '+';
  if (kind === 'remove') return '−';
  if (kind === 'modify') return '~';
  return '↕';
}

function glyphColor(kind: 'add' | 'remove' | 'modify' | 'move'): string {
  if (kind === 'add') return '#059669';
  if (kind === 'remove') return '#dc2626';
  if (kind === 'modify') return '#2563eb';
  return 'var(--c-muted)';
}
