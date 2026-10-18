import { Search, type LucideIcon } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `EntityListHeader` (Core, `stable`; contributed by M19) — the header of an
 * entity list: title + result counter, with slots for search/filter and
 * actions. The canonical host-supplied header a plugin renders instead of
 * hand-rebuilding one per plugin.
 *
 * Pure-presentational: every value and handler is a prop. No host access.
 *
 * Prop contract (`stable`, part of `hostApiVersion`; M19 `m19l12sc`, 2.1.16),
 * with no default values: `title` is required; `icon`, `count` ("N results"),
 * `search` + `onSearchChange` + `searchPlaceholder`, `filters` and `actions`
 * are optional. Omitting `search` hides the search box. Slot order, left to
 * right: icon, title, count, search, `filters` (between search and actions),
 * `actions` (trailing edge, e.g. a create button).
 *
 * 2.1.33 (record `entity-list-header`): `filters` shares the header row with
 * title, search and actions, so it holds compact controls that fit that row —
 * e.g. `SegmentedControlTabs` (the AC list's status and kind switches) or a
 * select. The header has no place for `TagFilterBar`: a strip with a variable
 * number of chips would break the row, so the tag bar stands BELOW the header,
 * as its sibling in `EntityListLayout`'s `header` (M19 `thm8a14c`).
 *
 * 2.1.35 — explicit shrink order in a narrow panel:
 * 1. the search box gives way first, from 280 px down to 160 px (flex basis
 *    280 px, min-width 160 px, a shrink factor far above the title's);
 * 2. only then the title truncates with an ellipsis on one line (at once when
 *    `search` is omitted);
 * the icon, the counter and the `filters` / `actions` slot areas (items side by
 * side, 12 px apart) keep their natural width throughout.
 *
 * 2.1.37 — the title has a minimum visible width (~4 characters + ellipsis), and
 * two more phases follow:
 * 3. when the first line does not fit at the minimum values (search 160 px or
 *    hidden, title at its minimum), the whole `filters` area moves to a second
 *    line, aligned with the title text (not the icon), above the page's tag bar;
 *    `actions` stays on the first line;
 * 4. when the first line does not fit even without `filters` (or `filters` is
 *    empty), the result counter hides — the last step.
 * The phases are computed from natural widths at those minimum values, never from
 * the current widths, so a fixed panel width maps to one layout (no flicker) and
 * the header returns to an earlier phase as soon as it fits again. Below the lower
 * threshold (icon + minimum title + 160 px search + `actions`) the row is clipped
 * at the header's right edge — there is no further phase.
 */
export interface EntityListHeaderProps {
  /** Leading icon (e.g. a lucide icon component). */
  icon?: LucideIcon;
  title: string;
  /** Result counter; rendered as "N results" when provided. */
  count?: number;
  /** Search box state. Omit to hide the search box. */
  search?: string;
  onSearchChange?: (q: string) => void;
  searchPlaceholder?: string;
  /**
   * Filter slot, rendered between search and actions — for compact
   * fixed-width controls (segmented tabs, a select); moves as a whole to the
   * second line when the first one runs out of room (2.1.37). Not for `TagFilterBar`,
   * which stands under the header as its sibling in `EntityListLayout.header`.
   */
  filters?: ReactNode;
  /** Action slot (e.g. a create button), rendered at the trailing edge. */
  actions?: ReactNode;
}

interface HeaderLayout {
  /** Minimum visible title width in px (~4 characters + ellipsis); undefined until measured. */
  titleMin?: number;
  /** Phase 3 — the `filters` area stands on the second line. */
  twoLines: boolean;
  /** Phase 4 — the result counter is hidden. */
  hideCount: boolean;
}

const ONE_LINE: HeaderLayout = { twoLines: false, hideCount: false };
const ICON_SIZE = 18;
/** `gap-3` between first-line items and inside the slot areas. */
const GAP = 12;
const SEARCH_MIN = 160;
const TITLE_MIN_CHARS = 4;
const TITLE_TYPE = 'text-[18px] font-semibold tracking-tight';
const COUNT_TYPE = 'font-mono text-[11.5px]';
const MEASURE_LAYER: CSSProperties = { position: 'absolute', left: 0, top: 0, visibility: 'hidden' };
const MEASURE_ITEM: CSSProperties = { position: 'absolute', left: 0, top: 0 };

const countLabel = (count: number) => `${count} ${count === 1 ? 'result' : 'results'}`;

/** The shortest the title may get: its first characters with an ellipsis (the whole title when shorter). */
function minTitle(title: string): string {
  const chars = Array.from(title);
  return chars.length > TITLE_MIN_CHARS ? `${chars.slice(0, TITLE_MIN_CHARS).join('')}…` : title;
}

function EntityListHeaderImpl({
  icon: Icon,
  title,
  count,
  search,
  onSearchChange,
  searchPlaceholder,
  filters,
  actions,
}: EntityListHeaderProps) {
  const lineRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const titleFullRef = useRef<HTMLSpanElement>(null);
  const titleMinRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<HeaderLayout>(ONE_LINE);

  const hasFilters = Boolean(filters);
  const hasSearch = search != null;
  const hasCount = count != null;

  // Phases 3–4 from natural widths at the minimum values (search 160 px or none,
  // title at its minimum) — never from the current widths, so a fixed panel width
  // maps to exactly one layout and the header does not flicker between them.
  const measure = useCallback(() => {
    const line = lineRef.current;
    if (!line) return;
    const available = line.getBoundingClientRect().width;
    if (available <= 0) return; // not laid out (hidden panel, no layout engine)
    const width = (el: Element | null) => (el ? el.getBoundingClientRect().width : 0);
    const titleFull = width(titleFullRef.current);
    const titleMin = Math.ceil(Math.min(titleFull, width(titleMinRef.current)));
    const firstLine = (withFilters: boolean) => {
      const items = [
        ...(Icon ? [ICON_SIZE] : []),
        titleMin,
        ...(hasCount ? [width(countRef.current)] : []),
        0, // the spacer
        ...(hasSearch ? [SEARCH_MIN] : []),
        ...(withFilters && hasFilters ? [width(filtersRef.current)] : []),
        ...(actions ? [width(actionsRef.current)] : []),
      ];
      return items.reduce((a, b) => a + b, 0) + GAP * (items.length - 1);
    };
    const next: HeaderLayout = {
      titleMin,
      // Phase 3 — the whole `filters` area goes to the second line.
      twoLines: hasFilters && firstLine(true) > available + 0.5,
      // Phase 4 — the counter hides when the line does not fit even without `filters`.
      hideCount: hasCount && firstLine(false) > available + 0.5,
    };
    setLayout((prev) =>
      prev.titleMin === next.titleMin && prev.twoLines === next.twoLines && prev.hideCount === next.hideCount
        ? prev
        : next,
    );
  }, [Icon, hasCount, hasSearch, hasFilters, actions]);

  // Re-measure after every render (title, count or slot content may have changed)…
  useLayoutEffect(measure);
  // …and whenever the panel or a measured piece changes size. Re-observed when the
  // `filters` area moves between lines (it is a new element there).
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    for (const el of [lineRef, filtersRef, actionsRef, titleFullRef, titleMinRef, countRef]) {
      if (el.current) ro.observe(el.current);
    }
    return () => ro.disconnect();
  }, [measure, layout.twoLines]);

  const filtersArea = hasFilters ? (
    <div ref={filtersRef} className="flex shrink-0 items-center gap-3">
      {filters}
    </div>
  ) : null;

  return (
    <div className="relative overflow-hidden px-8 py-4" style={{ borderBottom: '1px solid var(--c-hair)' }}>
      {/* Off-screen copies at natural width — the title in full and at its minimum, the counter. */}
      <div aria-hidden className="pointer-events-none whitespace-nowrap" style={MEASURE_LAYER}>
        <span ref={titleFullRef} className={TITLE_TYPE} style={MEASURE_ITEM}>
          {title}
        </span>
        <span ref={titleMinRef} className={TITLE_TYPE} style={MEASURE_ITEM}>
          {minTitle(title)}
        </span>
        {hasCount && (
          <span ref={countRef} className={COUNT_TYPE} style={MEASURE_ITEM}>
            {countLabel(count)}
          </span>
        )}
      </div>
      <div ref={lineRef} data-line="1" className="flex items-center gap-3">
        {Icon && <Icon size={ICON_SIZE} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />}
        <h2
          className={`min-w-0 truncate ${TITLE_TYPE}`}
          style={{ color: 'var(--c-ink)', minWidth: layout.titleMin }}
        >
          {title}
        </h2>
        {hasCount && !layout.hideCount && (
          <span className={`shrink-0 whitespace-nowrap ${COUNT_TYPE}`} style={{ color: 'var(--c-subtle)' }}>
            {countLabel(count)}
          </span>
        )}
        <span className="flex-1" />
        {hasSearch && (
          <div
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5"
            style={{
              background: 'var(--c-card)',
              border: '1px solid var(--c-hair)',
              // Gives way first: 280 px → 160 px before the title starts to truncate.
              flex: '0 1000 280px',
              minWidth: SEARCH_MIN,
            }}
          >
            <Search size={13} style={{ color: 'var(--c-subtle)', flexShrink: 0 }} />
            <input
              value={search}
              onChange={(e) => onSearchChange?.(e.target.value)}
              className="bg-transparent flex-1 min-w-0 text-[13px] outline-none"
              placeholder={searchPlaceholder}
              style={{ color: 'var(--c-ink)' }}
            />
          </div>
        )}
        {!layout.twoLines && filtersArea}
        {actions ? (
          <div ref={actionsRef} className="flex shrink-0 items-center gap-3">
            {actions}
          </div>
        ) : null}
      </div>
      {layout.twoLines && filtersArea && (
        // Second line: under the title text (past the icon), above the page's tag bar.
        <div data-line="2" className="mt-3 flex items-center" style={{ paddingLeft: Icon ? ICON_SIZE + GAP : 0 }}>
          {filtersArea}
        </div>
      )}
    </div>
  );
}

export const EntityListHeader = withStability(EntityListHeaderImpl, 'stable');
