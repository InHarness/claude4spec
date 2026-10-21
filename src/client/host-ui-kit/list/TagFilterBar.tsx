import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Tag } from '../../../shared/plugin-host/tag.js';
import { TagChip } from '../actions/TagChip.js';
import { ActionButton } from '../actions/ActionButton.js';
import { Popover } from '../overlay-feedback/Popover.js';
import { withStability } from '../stability.js';

/**
 * `TagFilterBar` (List, `experimental`) — the tag-filter strip above an entity
 * list. It stands UNDER `EntityListHeader`, full width, as its sibling in
 * `EntityListLayout`'s `header` — never in the header's `filters` slot, whose
 * one row a variable number of chips would break (record `tag-filter-bar`,
 * 2.1.33; M19 `thm8a14c`). With an empty `tags` it renders nothing, so a
 * consumer needs no guard of its own. Its props type is exported as
 * `TagFilterBarProps` (2.1.40; `TagBarProps` before, against the
 * `<Component>Props` convention). Pure-presentational: tags, current filter and
 * handlers are props, and it declares no types of its own — `Tag` is the M18
 * type from the root of `@c4s/plugin-runtime`. The data side (`useTags` /
 * `useEntityListQuery`) stays in the host app, which builds
 * `TagFilterBarProps` and passes it in.
 *
 * Tag chips render via the kit's `TagChip` (the single tag chip implementation).
 *
 * 2.1.44: `variant` — `'collapsed'` (default) keeps the strip on ONE line: the
 * selected tags are pinned first and always visible, whatever does not fit goes
 * behind a ghost "+N" `ActionButton` opening a `Popover` (text filter + scrollable
 * chips, a click toggles at once); `'wrap'` is the previous multi-line layout.
 * `entityType` + items carrying `counts` (as `useTags()` items do): tags with a
 * zero count of that type are dropped and the rest sorted by it, descending,
 * ties by name. Without either, the input order stays.
 */
export interface TagFilterBarProps {
  tags: Array<Tag & { counts?: Record<string, number> }>;
  tagFilter: string[];
  onTagToggle: (slug: string) => void;
  tagMode: 'and' | 'or';
  onToggleMode: () => void;
  onClear: () => void;
  variant?: 'collapsed' | 'wrap'; // default 'collapsed'
  entityType?: string;
}

type BarTag = TagFilterBarProps['tags'][number];

const CHIP_GAP = 6;
/** Room kept for the "+N" control when not every chip fits. */
const OVERFLOW_RESERVE = 48;
const TAG_CATALOG_MAX_HEIGHT = 240;

/** `entityType` + `counts`: drop zero counts, sort by count desc then name. Selected tags are never dropped. */
function narrowByCounts(tags: BarTag[], entityType: string | undefined, selected: Set<string>): BarTag[] {
  if (!entityType || !tags.some((t) => t.counts)) return tags;
  const count = (t: BarTag) => t.counts?.[entityType] ?? 0;
  return tags
    .filter((t) => count(t) > 0 || selected.has(t.slug))
    .sort((a, b) => count(b) - count(a) || a.name.localeCompare(b.name));
}

function chipOf(tag: BarTag, active: boolean, onClick?: () => void) {
  return (
    <TagChip
      key={tag.slug}
      label={tag.name}
      color={tag.color ?? undefined}
      active={active}
      onClick={onClick}
      small
    />
  );
}

/** Number of leading chips that fit `avail` px; the first `pinned` always count. */
function fitCount(widths: number[], avail: number, pinned: number): number {
  const total = widths.reduce((sum, w, i) => sum + w + (i > 0 ? CHIP_GAP : 0), 0);
  if (total <= avail) return widths.length;
  const room = avail - OVERFLOW_RESERVE;
  let used = 0;
  let n = 0;
  for (const w of widths) {
    const next = used + w + (n > 0 ? CHIP_GAP : 0);
    if (next > room && n >= pinned) break;
    used = next;
    n++;
  }
  return n;
}

function CollapsedChips({
  tags,
  selected,
  onTagToggle,
}: {
  tags: BarTag[];
  selected: Set<string>;
  onTagToggle: (slug: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Selected tags pinned first (stable), the rest in their order.
  const ordered = useMemo(
    () => [...tags.filter((t) => selected.has(t.slug)), ...tags.filter((t) => !selected.has(t.slug))],
    [tags, selected],
  );
  const pinned = ordered.length - tags.filter((t) => !selected.has(t.slug)).length;
  const key = ordered.map((t) => `${t.slug}:${t.name}`).join('|');

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const run = () => {
      const avail = row.offsetWidth;
      // No layout (width 0): nothing to measure against, show everything.
      if (!avail) return setFit(null);
      const widths = Array.from(measure.children).map((c) => (c as HTMLElement).offsetWidth);
      setFit(fitCount(widths, avail, pinned));
    };
    run();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(run);
    ro.observe(row);
    return () => ro.disconnect();
  }, [key, pinned]);

  const visible = fit === null ? ordered : ordered.slice(0, fit);
  const hidden = ordered.length - visible.length;
  const q = query.trim().toLowerCase();
  const listed = q ? ordered.filter((t) => t.name.toLowerCase().includes(q) || t.slug.includes(q)) : ordered;

  return (
    <div className="relative flex-1 min-w-0">
      {/* Off-screen copy used only to measure each chip's width. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        data-tag-measure
        className="flex items-center"
        style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'nowrap', height: 0, overflow: 'hidden', gap: CHIP_GAP }}
      >
        {ordered.map((tag) => (
          <span key={tag.slug} data-tag-measure-chip className="inline-flex">
            {chipOf(tag, selected.has(tag.slug))}
          </span>
        ))}
      </div>
      <div
        ref={rowRef}
        data-tag-row
        className="flex items-center flex-nowrap overflow-hidden"
        style={{ flexWrap: 'nowrap', overflow: 'hidden', gap: CHIP_GAP }}
      >
        {visible.map((tag) => chipOf(tag, selected.has(tag.slug), () => onTagToggle(tag.slug)))}
        {hidden > 0 && (
          <>
            {/* ActionButton takes no ref, so the Popover anchors on this wrapper. */}
            <span ref={anchorRef} className="inline-flex shrink-0">
              <ActionButton variant="ghost" label={`+${hidden}`} onClick={() => setOpen((v) => !v)} />
            </span>
            <Popover
              open={open}
              onClose={() => setOpen(false)}
              anchorRef={anchorRef}
              placement="bottom"
              maxHeight={TAG_CATALOG_MAX_HEIGHT}
              footer={
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter tags…"
                  aria-label="Filter tags"
                  className="w-full rounded-md px-2 py-1 text-[12px]"
                  style={{ background: 'var(--c-card)', color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
                  autoFocus
                />
              }
            >
              <div data-tag-popover-list className="flex flex-wrap gap-1.5" style={{ minWidth: 200, maxWidth: 280 }}>
                {listed.map((tag) => chipOf(tag, selected.has(tag.slug), () => onTagToggle(tag.slug)))}
              </div>
            </Popover>
          </>
        )}
      </div>
    </div>
  );
}

function TagFilterBarImpl({
  tags,
  tagFilter,
  onTagToggle,
  tagMode,
  onToggleMode,
  onClear,
  variant = 'collapsed',
  entityType,
}: TagFilterBarProps) {
  const selected = useMemo(() => new Set(tagFilter), [tagFilter]);
  const shown = useMemo(() => narrowByCounts([...tags], entityType, selected), [tags, entityType, selected]);
  if (tags.length === 0) return null;

  return (
    <div
      className={`px-8 py-3 flex items-center gap-2 ${variant === 'wrap' ? 'flex-wrap' : 'flex-nowrap'}`}
      style={{ borderBottom: '1px solid var(--c-hair)' }}
    >
      <span
        className="text-[10.5px] uppercase font-mono tracking-wider shrink-0"
        style={{ color: 'var(--c-subtle)' }}
      >
        Filter by tag:
      </span>
      {variant === 'wrap' ? (
        <>
          {shown.map((tag) => chipOf(tag, selected.has(tag.slug), () => onTagToggle(tag.slug)))}
          <span className="flex-1" />
        </>
      ) : (
        <CollapsedChips tags={shown} selected={selected} onTagToggle={onTagToggle} />
      )}
      {tagFilter.length > 1 && (
        <button
          onClick={onToggleMode}
          className="text-[10.5px] uppercase font-mono tracking-wider px-2 py-0.5 rounded"
          style={{ color: 'var(--c-muted)', background: 'var(--c-panel)' }}
          title="Toggle AND / OR filter"
        >
          match {tagMode}
        </button>
      )}
      {tagFilter.length > 0 && (
        <button
          onClick={onClear}
          className="text-[10.5px] font-mono px-2 py-0.5 rounded"
          style={{ color: 'var(--c-muted)' }}
        >
          clear
        </button>
      )}
    </div>
  );
}

export const TagFilterBar = withStability(TagFilterBarImpl, 'experimental');
