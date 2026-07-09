import { withStability } from '../stability.js';
import { EmptyState } from '../list/EmptyState.js';
import type { LineDiffLite } from '../../../shared/entities.js';

type DiffLine = LineDiffLite['lines'][number];

/**
 * `DiffView` (Panel detalu, `experimental`) — the plugin-facing parallel of
 * the host-internal `LineDiffViewer` (M17/L5, not published to plugins).
 * Strictly props-in: it renders an already-computed diff, never computes one
 * itself. Typical data source is `useVersionDiff`'s `raw`/`changes` (author
 * converts to `hunks`), or an author-supplied `before`/`after` pair.
 */
export interface DiffViewProps {
  /** Precomputed line hunks (reuses the shared `LineDiffLite` line shape). Wins over `before`/`after` if both are given. */
  hunks?: DiffLine[];
  /** Pre-stringified "before" text — DiffView never serializes values itself. Only used when `hunks` is absent; requires `after` too. */
  before?: string;
  /** Pre-stringified "after" text — see `before`. */
  after?: string;
  title?: string;
  /** `'inline'` (default): one unified column. `'split'`: two columns. Only affects `hunks` rendering — a `before`/`after` pair always renders as two columns (there's no diffing to unify them). */
  mode?: 'inline' | 'split';
}

function DiffViewImpl({ hunks, before, after, title, mode = 'inline' }: DiffViewProps) {
  const hasHunks = Boolean(hunks && hunks.length > 0);
  const hasBeforeAfter = !hasHunks && before !== undefined && after !== undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {title && (
        <div className="text-[12.5px] font-medium" style={{ color: 'var(--c-ink)', fontFamily: 'var(--font-heading)' }}>
          {title}
        </div>
      )}
      {hasHunks ? (
        mode === 'split' ? (
          <SplitHunks hunks={hunks as DiffLine[]} />
        ) : (
          <InlineHunks hunks={hunks as DiffLine[]} />
        )
      ) : hasBeforeAfter ? (
        <BeforeAfterPanes before={before as string} after={after as string} />
      ) : (
        <EmptyState title="No differences" hint="Nothing changed between these two versions." />
      )}
    </div>
  );
}

function InlineHunks({ hunks }: { hunks: DiffLine[] }) {
  return (
    <div
      className="font-mono text-[11.5px] leading-snug rounded overflow-hidden"
      style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
    >
      {hunks.map((line, i) => (
        <HunkRow key={i} line={line} />
      ))}
    </div>
  );
}

export type PairedRow = { left: DiffLine | null; right: DiffLine | null };

/**
 * Pairs `keep` lines onto the same row on both sides, and zips each
 * contiguous run of `removed`/`added` lines (a "change block") together
 * row-by-row, padding the shorter side with a blank cell. Filtering `hunks`
 * independently per column (dropping `added` on the left, `removed` on the
 * right) would misalign rows the moment a change block has unequal
 * removed/added counts — this keeps every row's left/right cell anchored to
 * the same position in the original line sequence.
 *
 * Exported so the pairing logic can be unit-tested without a rendering
 * harness (no React Testing Library in this repo).
 */
export function pairRows(hunks: DiffLine[]): PairedRow[] {
  const rows: PairedRow[] = [];
  let i = 0;
  while (i < hunks.length) {
    const line = hunks[i];
    if (!line) break;
    if (line.op === 'keep') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (i < hunks.length) {
      const next = hunks[i];
      if (!next || next.op === 'keep') break;
      (next.op === 'removed' ? removed : added).push(next);
      i++;
    }
    const blockSize = Math.max(removed.length, added.length);
    for (let j = 0; j < blockSize; j++) {
      rows.push({ left: removed[j] ?? null, right: added[j] ?? null });
    }
  }
  return rows;
}

/** Split view: left/right columns are row-paired by `pairRows` so shared context and changed lines stay aligned. */
function SplitHunks({ hunks }: { hunks: DiffLine[] }) {
  const rows = pairRows(hunks);
  return (
    <div className="grid grid-cols-2 gap-px rounded overflow-hidden" style={{ background: 'var(--c-hair)' }}>
      <div>{rows.map((r, i) => <HunkRow key={i} line={r.left} />)}</div>
      <div>{rows.map((r, i) => <HunkRow key={i} line={r.right} />)}</div>
    </div>
  );
}

function HunkRow({ line }: { line: DiffLine | null }) {
  const style = line ? stylesFor(line.op) : { bg: 'transparent', fg: 'var(--c-muted)' };
  return (
    <div
      className="flex items-baseline whitespace-pre-wrap break-words"
      style={{ background: style.bg, color: style.fg, paddingLeft: 6, paddingRight: 8 }}
    >
      <span style={{ width: 14, color: 'var(--c-subtle)', flexShrink: 0 }}>{line ? prefixOf(line.op) : ' '}</span>
      <span className="flex-1 min-w-0">{(line && line.content) || ' '}</span>
    </div>
  );
}

function BeforeAfterPanes({ before, after }: { before: string; after: string }) {
  return (
    <div className="grid grid-cols-2 gap-px rounded overflow-hidden" style={{ background: 'var(--c-hair)' }}>
      <TextPane content={before} />
      <TextPane content={after} />
    </div>
  );
}

function TextPane({ content }: { content: string }) {
  return (
    <div
      className="font-mono text-[11.5px] leading-snug overflow-hidden"
      style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
    >
      {content.split('\n').map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-words" style={{ paddingLeft: 6, paddingRight: 8 }}>
          {line || ' '}
        </div>
      ))}
    </div>
  );
}

function prefixOf(op: DiffLine['op']): string {
  if (op === 'added') return '+';
  if (op === 'removed') return '−';
  return ' ';
}

function stylesFor(op: DiffLine['op']): { bg: string; fg: string } {
  if (op === 'added') return { bg: 'rgba(16,185,129,0.10)', fg: 'var(--c-ink)' };
  if (op === 'removed') return { bg: 'rgba(220,38,38,0.10)', fg: 'var(--c-ink)' };
  return { bg: 'transparent', fg: 'var(--c-muted)' };
}

export const DiffView = withStability(DiffViewImpl, 'experimental');
