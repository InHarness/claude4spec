import { useState } from 'react';
import { withStability } from '../stability.js';
import { EmptyState } from '../list/EmptyState.js';

/**
 * `VersionHistory` (Panel detalu, `experimental`) — a version list rendered
 * entirely from props, driven by the host's `useVersions` hook. No
 * self-fetch: the plugin author wires the hook's `data` in as `versions`.
 */
export interface VersionHistoryItem {
  id: string;
  label: string;
  createdAt: string;
  author?: string;
  /** M13/M34: the release this version belongs to. 0.2.77 — now the GROUP HEADING in `timeline`, no longer a per-row pill. */
  releaseLabel?: string;
  /**
   * 0.2.77 — the grouping key. `null`/absent means unreleased.
   *
   * Distinct from `releaseLabel` because two releases could in principle carry
   * the same display name, and because "unreleased" has to be recognisable
   * without depending on a label being empty.
   */
  releaseId?: number | null;
  /** M13/M34: who made the change — rendered in `timeline` as a colour-coded badge so an agent edit is visually distinct from a user edit. */
  changedBy?: 'user' | 'agent' | 'filesystem';
  /** M13/M34: one-line description of what the change did (the version's change summary). */
  summary?: string;
}

export interface VersionHistoryProps {
  versions: VersionHistoryItem[];
  activeVersion?: string;
  onSelect?(id: string): void;
  onRestore?(id: string): void;
  /** `'flat'` (default) keeps the existing list unchanged. `'timeline'` adds a two-column/dots layout + "Compare to". */
  variant?: 'flat' | 'timeline';
  /** M13/M34: the version currently selected as the `timeline` "Compare to" target — purely for display, this component never diffs. */
  compareVersion?: string;
  /** M13/M34: fired when a `timeline` row's "Compare to" action is used. */
  onCompare?(id: string): void;
}

/**
 * 0.2.77 — the timeline stops being an axis of TIME and becomes an axis of
 * RELEASES.
 *
 * Versions arrive newest-first, so walking them in order and starting a new group
 * whenever the release changes yields groups in the same newest-first order —
 * no sorting, and no assumption about release ids being monotonic.
 *
 * Unreleased entries form ONE group pinned to the top. They are pulled out rather
 * than left where they fall because `createRelease()` moves the whole group at
 * once: after it runs, "Unreleased" is empty and its former contents stand under
 * the new release's heading. A group that could appear in the middle of the axis
 * would make that move look like a reordering.
 *
 * Pure, and exported for its own test — the grouping is the part worth pinning.
 */
export interface VersionGroup {
  key: string;
  label: string;
  unreleased: boolean;
  items: VersionHistoryItem[];
}

export function groupByRelease(versions: readonly VersionHistoryItem[]): VersionGroup[] {
  const unreleased: VersionHistoryItem[] = [];
  const groups: VersionGroup[] = [];
  for (const v of versions) {
    if (v.releaseId === null || v.releaseId === undefined) {
      unreleased.push(v);
      continue;
    }
    const key = String(v.releaseId);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(v);
    else groups.push({ key, label: v.releaseLabel ?? `Release ${key}`, unreleased: false, items: [v] });
  }
  return unreleased.length > 0
    ? [{ key: '__unreleased__', label: 'Unreleased', unreleased: true, items: unreleased }, ...groups]
    : groups;
}

function VersionHistoryImpl({
  versions,
  activeVersion,
  onSelect,
  onRestore,
  variant = 'flat',
  compareVersion,
  onCompare,
}: VersionHistoryProps) {
  if (versions.length === 0) {
    return <EmptyState title="No versions yet" hint="Changes to this entity will appear here." />;
  }

  if (variant === 'timeline') {
    return (
      <TimelineList
        versions={versions}
        activeVersion={activeVersion}
        onSelect={onSelect}
        onRestore={onRestore}
        compareVersion={compareVersion}
        onCompare={onCompare}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {versions.map((v) => {
        const isActive = v.id === activeVersion;
        return (
          <li
            key={v.id}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
            style={{
              background: isActive ? 'var(--c-panel)' : 'transparent',
              border: `1px solid ${isActive ? 'var(--c-hair-strong)' : 'transparent'}`,
              cursor: onSelect ? 'pointer' : 'default',
            }}
            onClick={() => onSelect?.(v.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-medium truncate" style={{ color: 'var(--c-ink)' }}>
                {v.label}
              </div>
              <VersionMeta v={v} />
            </div>
            {onRestore && !isActive && <RestoreButton id={v.id} onRestore={onRestore} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Shared "{createdAt} · {author}" line — used by both the `flat` and `timeline` renderings. */
function VersionMeta({ v }: { v: VersionHistoryItem }) {
  return (
    <>
      <div className="text-[11px]" style={{ color: 'var(--c-muted)' }}>
        {v.createdAt}
        {v.author ? ` · ${v.author}` : ''}
      </div>
      {v.summary && (
        <div className="text-[11.5px] truncate" style={{ color: 'var(--c-muted)' }}>
          {v.summary}
        </div>
      )}
    </>
  );
}

/**
 * Badge colours per author kind. An agent-made change must be tellable from a
 * user-made one at a glance, so this is a colour distinction and not just text.
 *
 * Exported so the "agent and user are visually distinct" invariant can be
 * unit-tested without a rendering harness (no React Testing Library here).
 */
export function changedByBadgeStyle(
  changedBy: NonNullable<VersionHistoryItem['changedBy']>,
): { bg: string; fg: string } {
  if (changedBy === 'agent') return { bg: 'var(--c-blue-soft)', fg: 'var(--c-blue)' };
  if (changedBy === 'user') return { bg: 'var(--c-green-soft)', fg: 'var(--c-green)' };
  return { bg: 'var(--c-panel)', fg: 'var(--c-muted)' };
}

function ChangedByBadge({ changedBy }: { changedBy: NonNullable<VersionHistoryItem['changedBy']> }) {
  const { bg, fg } = changedByBadgeStyle(changedBy);
  return (
    <span
      className="rounded-full px-1.5 text-[9.5px] uppercase tracking-wider font-mono flex-shrink-0"
      style={{ background: bg, color: fg }}
    >
      {changedBy}
    </span>
  );
}

/** Shared Restore action — used by both the `flat` and `timeline` renderings. */
function RestoreButton({ id, onRestore }: { id: string; onRestore(id: string): void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRestore(id);
      }}
      className="rounded px-2 py-1 text-[11px] font-medium btn-ghost"
      style={{ color: 'var(--c-accent)' }}
    >
      Restore
    </button>
  );
}

type TimelineListProps = Pick<
  VersionHistoryProps,
  'versions' | 'activeVersion' | 'onSelect' | 'onRestore' | 'compareVersion' | 'onCompare'
>;

/** `variant='timeline'` — two-column dots/connector layout + "Compare to". Fetch-free, same as flat. */
/**
 * The release axis. One row per release by default, expandable to the individual
 * records inside it.
 *
 * A group starts expanded when it holds the active or the compared version — a
 * collapsed group hiding the row the user is looking at would be a worse default
 * than no collapsing at all — and "Unreleased" starts expanded because it is
 * where current work lives.
 */
function TimelineList({ versions, activeVersion, onSelect, onRestore, compareVersion, onCompare }: TimelineListProps) {
  const groups = groupByRelease(versions);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => {
        const holdsSelection = g.items.some((v) => v.id === activeVersion || v.id === compareVersion);
        const isOpen = collapsed[g.key] === undefined ? g.unreleased || holdsSelection : !collapsed[g.key];
        return (
          <div key={g.key} data-testid={`version-group-${g.key}`} data-open={isOpen}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [g.key]: isOpen }))}
              className="flex items-center gap-1.5 w-full text-left px-1 py-1"
            >
              <span className="text-[10px]" style={{ color: 'var(--c-muted)' }}>
                {isOpen ? '▾' : '▸'}
              </span>
              <span
                className="text-[11.5px] font-medium truncate"
                style={{ color: g.unreleased ? 'var(--c-accent-ink)' : 'var(--c-ink)' }}
              >
                {g.label}
              </span>
              <span className="text-[10.5px]" style={{ color: 'var(--c-muted)' }}>
                {g.items.length}
              </span>
            </button>
            {isOpen && (
              <TimelineRows
                versions={g.items}
                activeVersion={activeVersion}
                onSelect={onSelect}
                onRestore={onRestore}
                compareVersion={compareVersion}
                onCompare={onCompare}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The rows inside one group.
 *
 * The release pill is GONE from the row: the release name is the group's heading
 * now, and repeating it on every row would be noise. What distinguishes versions
 * WITHIN a group is time and author, which `VersionMeta` already renders — so
 * nothing had to be added, only the redundant badge removed.
 */
function TimelineRows({ versions, activeVersion, onSelect, onRestore, compareVersion, onCompare }: TimelineListProps) {
  return (
    <ul className="flex flex-col">
      {versions.map((v, i) => {
        const isActive = v.id === activeVersion;
        const isCompareTarget = v.id === compareVersion;
        const isLast = i === versions.length - 1;
        return (
          <li key={v.id} className="flex gap-2.5">
            <div className="flex flex-col items-center" style={{ width: 12, flexShrink: 0 }}>
              <div
                className="rounded-full"
                style={{
                  width: 8,
                  height: 8,
                  marginTop: 8,
                  background: isActive ? 'var(--c-accent)' : 'var(--c-hair-strong)',
                  flexShrink: 0,
                }}
              />
              {!isLast && <div style={{ width: 1, flex: 1, background: 'var(--c-hair)' }} />}
            </div>
            <div
              className="flex-1 min-w-0 rounded-md px-2.5 py-1.5 mb-1"
              style={{
                background: isActive ? 'var(--c-panel)' : 'transparent',
                border: `1px solid ${isCompareTarget ? 'var(--c-accent)' : isActive ? 'var(--c-hair-strong)' : 'transparent'}`,
                cursor: onSelect ? 'pointer' : 'default',
              }}
              onClick={() => onSelect?.(v.id)}
            >
              <div className="flex items-center gap-1.5">
                <div className="text-[12.5px] font-medium truncate" style={{ color: 'var(--c-ink)' }}>
                  {v.label}
                </div>
                {v.changedBy && <ChangedByBadge changedBy={v.changedBy} />}
              </div>
              <VersionMeta v={v} />
              {(onCompare || (onRestore && !isActive)) && (
                <div className="flex gap-2 mt-1">
                  {onCompare && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCompare(v.id);
                      }}
                      className="rounded px-2 py-0.5 text-[11px] font-medium btn-ghost"
                      style={{ color: isCompareTarget ? 'var(--c-accent)' : 'var(--c-muted)' }}
                    >
                      {isCompareTarget ? 'Comparing' : 'Compare to'}
                    </button>
                  )}
                  {onRestore && !isActive && <RestoreButton id={v.id} onRestore={onRestore} />}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export const VersionHistory = withStability(VersionHistoryImpl, 'experimental');
