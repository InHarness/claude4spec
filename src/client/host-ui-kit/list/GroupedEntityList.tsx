import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `GroupedEntityList` (List, `experimental`) — an entity list broken into
 * labelled sections, for a type whose default reading is "by something" rather
 * than "all of them".
 *
 * WHY IT IS IN THE CATALOG rather than inside the one plugin that needed it
 * first. L12's rule is that a component present in the catalog has no
 * host-internal twin, and a plugin may keep its own markup only when it is used
 * in ONE place AND its shape follows from that one entity. A grouped list fails
 * both tests: `/mcp-tools` groups by the mirror tag `srv-*`, and `/acs` groups
 * by the dominant `mNN` / `entity-*` tag — the same anatomy (section heading,
 * rows beneath, a toggle back to flat) specified twice, for two unrelated types.
 * Built inside either one, the second would have copied it.
 *
 * THE BOUNDARY, which is the reason the props look thin: THE KIT RENDERS, IT
 * DOES NOT COMPUTE. Which key to group on, what a group is called, how groups
 * are ordered, and where an item belonging to none of them goes are all
 * decisions of the consumer, who is the only one who knows what the grouping
 * MEANS. This component receives groups already formed and lays them out. There
 * is deliberately no `groupBy` prop taking a field name or a tag prefix — that
 * would pull entity semantics into a presentational component and make the
 * catalog the place two types argue about what a "dominant tag" is.
 *
 * Flat rendering is NOT a mode here. A consumer offering a "Flat list" toggle
 * renders its ordinary flat list instead of this component; a boolean prop that
 * makes a grouped list stop grouping is a component doing two jobs.
 *
 * Pure-presentational. Experimental: props may change without a major bump.
 */
export interface GroupedEntityListGroup<T> {
  /** Stable identity of the group — the React key, never displayed. */
  key: string;
  /** What the section heading shows. A node, so a consumer can add a count or a chip. */
  label: ReactNode;
  /** The group's rows, in the order they should appear. */
  items: T[];
}

export interface GroupedEntityListProps<T> {
  groups: GroupedEntityListGroup<T>[];
  /** Draws one row. The consumer owns the row component — usually `EntityListRow`. */
  renderRow: (item: T, index: number) => ReactNode;
  /**
   * Rendered in place of the whole list when `groups` is empty, or when every
   * group is. Absent means nothing is drawn — the consumer is then expected to
   * be handling the empty case itself (typically with `EmptyState`).
   */
  emptyState?: ReactNode;
  /**
   * Rendered inside a group that has no items. Absent means such a group is
   * skipped entirely, which is the common case: a consumer usually forms groups
   * from the items it has. Supplying this is how a consumer says "this server
   * exists and has no tools" rather than letting it vanish.
   */
  emptyGroupState?: ReactNode;
}

/**
 * Which groups get drawn — the component's only decision, extracted so it can be
 * asserted without a renderer.
 *
 * An empty group is SKIPPED by default and KEPT once the caller supplies
 * something to draw inside it. The default is the safe one: a consumer normally
 * forms groups out of the items it already has, so an empty group means "this
 * bucket happens to be unused right now", and drawing a heading over nothing
 * reads as a bug. Keeping it is the deliberate act, because "this server exists
 * and has no tools yet" is a real thing a consumer may want to say.
 */
export function visibleGroups<T>(
  groups: GroupedEntityListGroup<T>[],
  emptyGroupState: ReactNode | undefined,
): GroupedEntityListGroup<T>[] {
  return emptyGroupState === undefined ? groups.filter((g) => g.items.length > 0) : groups;
}

function GroupedEntityListImpl<T>({
  groups,
  renderRow,
  emptyState,
  emptyGroupState,
}: GroupedEntityListProps<T>) {
  const visible = visibleGroups(groups, emptyGroupState);

  if (visible.length === 0) return <>{emptyState ?? null}</>;

  return (
    <div className="flex flex-col" style={{ gap: 24 }}>
      {visible.map((group) => (
        <section key={group.key} className="flex flex-col" style={{ gap: 6 }}>
          <h2
            className="uppercase tracking-wide"
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              color: 'var(--c-text-muted)',
              padding: '0 2px 2px',
              borderBottom: '1px solid var(--c-border)',
            }}
          >
            {group.label}
          </h2>
          {group.items.length === 0 ? (
            <div style={{ padding: '8px 2px', color: 'var(--c-text-muted)', fontSize: 13 }}>
              {emptyGroupState}
            </div>
          ) : (
            group.items.map((item, i) => renderRow(item, i))
          )}
        </section>
      ))}
    </div>
  );
}

export const GroupedEntityList = withStability(GroupedEntityListImpl, 'experimental');
