import { useMemo, useState, type ReactNode } from 'react';
import { withStability } from '../stability.js';
import { EmptyState } from '../list/EmptyState.js';
import { LoadingState } from '../actions/LoadingState.js';
import { SegmentedControlTabs } from './SegmentedControlTabs.js';
import { VersionHistory, type VersionHistoryItem } from './VersionHistory.js';
import { EntityDetailToolbar } from './EntityDetailToolbar.js';
import { DiffView, type DiffViewLine } from './DiffView.js';
import { useVersions, useVersionDetail, useRestoreVersion } from '../../hooks/useVersions.js';
import { useReleases } from '../../hooks/useReleases.js';
import { lineDiffHunks } from '../../runtime/line-diff.js';
import type { EntityType } from '../../../shared/entities.js';
import type { ApiError } from '../../lib/api-core.js';

/**
 * `EntityVersionHistoryView` (Panel detalu, `experimental`, `binding: 'connected'`)
 * — the catalog's first higher-order block. Given nothing but `type` and `slug`
 * it renders the complete entity version-history view: it fetches the versions,
 * the snapshots and the release labels itself, then composes the existing
 * catalog components (`EntityDetailToolbar`, `VersionHistory variant='timeline'`,
 * `SegmentedControlTabs`, `DiffView`).
 *
 * The boundary the `connected` class does NOT move: this block renders, it does
 * not compute. It implements no versioning, no diff algorithm and no release
 * semantics — restore goes through the host's `useRestoreVersion` hook (M13),
 * the labels come from `useReleases` (M17) and the diff from the pure
 * `lineDiffHunks` util over the two `useVersionDetail` snapshots (never
 * `useVersionDiff`). Versions are grouped by release with "Unreleased" on top;
 * the version row carries no release pill. The host's own history routes render this very block,
 * so host and plugin show an identical view.
 *
 * Consumed L11 surface (fetched by the component): `useVersions`,
 * `useVersionDetail`, `useRestoreVersion`, `useReleases` (transport via M33).
 * It also calls the pure L11 util `lineDiffHunks`, which fetches nothing and so
 * is not a data source of the component.
 */
export interface EntityVersionHistoryViewProps {
  type: string;
  slug: string;
  /** Show the restore action per row. Default `true`. */
  allowRestore?: boolean;
  /** Show the "Compare to" selection and the diff panel. Default `true`. */
  allowCompare?: boolean;
  /** Switches the release GROUP heading to the form `Release <release name>` (default `true`); `false` heads it with the bare release name. Until `useReleases` delivers the name, the numeric release id stands in its place. The version row carries no release pill either way. */
  showReleasePill?: boolean;
  /** Rendered instead of the default empty state when the entity has no versions at all. */
  emptyState?: ReactNode;
  /** Replaces the default diff panel — for entities with their own visualisation. */
  renderDiff?: (hunks: DiffViewLine[]) => ReactNode;
  /** Fired after a successful restore, so the author can invalidate their own views. */
  onRestored?: (versionId: string) => void;
}

type RightTab = 'diff' | 'snapshot';

/**
 * The release group heading: "Release <release name>" with `showReleasePill`
 * (default), the bare release name without it. Exported for its own test.
 */
export function releaseGroupHeading(releaseName: string, showReleasePill: boolean): string {
  return showReleasePill ? `Release ${releaseName}` : releaseName;
}

/** Just enough of a version row for the selection maths below. */
interface VersionLike {
  version: number;
}

/**
 * Which version is active. DERIVED rather than stored-and-reset: `type`/`slug`
 * can change under the same React instance (navigating entity A → entity B
 * reuses it), and carrying A's version number over would fetch a version B may
 * not have. Anything not present in the current list falls back to the newest.
 *
 * Exported so the entity-switch case is unit-testable without a browser.
 */
export function resolveActiveVersion(versions: VersionLike[], selected: number | null): number | null {
  if (selected != null && versions.some((v) => v.version === selected)) return selected;
  return versions[0]?.version ?? null;
}

/**
 * Which version the active one is compared against. Defaults to the version
 * immediately older than the active one; a requested target is honoured only if
 * it is in the current list and is not the active version itself. Returns
 * `null` when there is nothing older — the "nothing to compare" placeholder.
 */
export function resolveCompareVersion(
  versions: VersionLike[],
  active: number | null,
  requested: number | null,
): number | null {
  if (active == null) return null;
  if (requested != null && requested !== active && versions.some((v) => v.version === requested)) {
    return requested;
  }
  const idx = versions.findIndex((v) => v.version === active);
  return idx >= 0 && idx + 1 < versions.length ? versions[idx + 1]!.version : null;
}

function EntityVersionHistoryViewImpl({
  type,
  slug,
  allowRestore = true,
  allowCompare = true,
  showReleasePill = true,
  emptyState,
  renderDiff,
  onRestored,
}: EntityVersionHistoryViewProps) {
  const entityType = type as EntityType;
  const { data: versionsData, isLoading, isError, error } = useVersions(entityType, slug);
  const versions = versionsData ?? [];
  /**
   * 2.1.16 — ONLY a 404 means "the entity is gone". Any other error keeps what
   * the query already has: TanStack Query keeps cached `data` and sets `isError`
   * when a background refetch (restore, WS invalidation) fails, and a transient
   * failure must not replace a populated timeline with the empty state.
   */
  const entityGone = isError && (error as Partial<ApiError> | null)?.status === 404;
  const releaseNameById = useReleases();
  const restoreVersion = useRestoreVersion();

  const [selected, setSelected] = useState<number | null>(null);
  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const [tab, setTab] = useState<RightTab>('diff');

  const activeVersion = resolveActiveVersion(versions, selected);
  const compareTarget = allowCompare
    ? resolveCompareVersion(versions, activeVersion, compareVersion)
    : null;

  const { data: detail } = useVersionDetail(entityType, slug, activeVersion);
  const { data: compareDetail } = useVersionDetail(entityType, slug, compareTarget);

  const hunks = useMemo<DiffViewLine[] | null>(() => {
    if (!detail || !compareDetail) return null;
    return lineDiffHunks(compareDetail.data, detail.data);
  }, [detail, compareDetail]);

  const items: VersionHistoryItem[] = versions.map((v) => ({
    id: String(v.version),
    label: `v${v.version}`,
    createdAt: v.createdAt,
    changedBy: v.changedBy,
    ...(v.changeSummary ? { summary: v.changeSummary } : {}),
    /**
     * 2.1.20 — the kit item carries no `releaseId`; `releaseLabel` is the
     * timeline's group heading AND grouping key, so a released version ALWAYS
     * gets one: without it every version would fall into "Unreleased".
     *
     * 2.1.28 (record `entity-version-history-view`): `showReleasePill` switches
     * the group heading to the form "Release <id>". A release is addressed by
     * its name (2.1.11), so `<id>` is the release name, with the numeric id only
     * when the name is not loaded yet. ASSUMPTION:dev-2809 — `false` heads the
     * group with the bare release identifier, without the "Release" prefix;
     * the version row carries no release pill either way.
     */
    ...(v.releaseId != null
      ? {
          releaseLabel: releaseGroupHeading(
            releaseNameById.get(v.releaseId) ?? String(v.releaseId),
            showReleasePill,
          ),
        }
      : {}),
  }));

  // `mutate`, not `mutateAsync`: the kit's Restore button calls this
  // synchronously and drops the return value, so a rejected promise would
  // become an unhandled rejection and the failure would be invisible. The
  // in-flight guard stops a double click from capturing two restores.
  const onRestore = (id: string) => {
    if (restoreVersion.isPending) return;
    restoreVersion.mutate(
      { type: entityType, slug, version: Number(id) },
      { onSuccess: () => onRestored?.(id) },
    );
  };

  if (isLoading) return <LoadingState lines={4} height={32} />;
  /**
   * 2.1.16 — a deleted entity shows the EMPTY history state, never a tombstone.
   * Its versions endpoint answers 404 (the entity no longer exists), so the
   * list query errors out with status 404; that is the same "nothing to show"
   * as an entity with no captured versions, not a separate deleted-entity view.
   */
  if (isError && !entityGone && versions.length === 0) {
    // A real load failure with nothing cached is an error, not an empty history.
    return (
      <div
        role="alert"
        className="mx-5 mt-3 rounded-md px-3 py-2 text-[12px]"
        style={{ background: 'var(--c-red-soft)', color: 'var(--c-red)' }}
      >
        Could not load version history: {(error as Error | null)?.message ?? 'unknown error'}
      </div>
    );
  }
  if (entityGone || versions.length === 0) {
    return (
      <>
        {emptyState ?? (
          <EmptyState title="No versions yet" hint="Changes to this entity will appear here." />
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <EntityDetailToolbar title={`${type} · ${slug}`} />
      {restoreVersion.isError && (
        // Surfaced inline rather than through `useToast`: a toast is transient
        // and lands in the host stack away from this view, and a restore that
        // silently does nothing is the worst possible failure here.
        <div
          role="alert"
          className="mx-5 mt-3 rounded-md px-3 py-2 text-[12px]"
          style={{ background: 'var(--c-red-soft)', color: 'var(--c-red)' }}
        >
          Restore failed: {(restoreVersion.error as Error).message}
        </div>
      )}
      <div className="grid grid-cols-[260px_1fr] gap-6 p-5 min-h-0 flex-1 overflow-auto">
        <VersionHistory
          versions={items}
          variant="timeline"
          activeVersion={activeVersion != null ? String(activeVersion) : undefined}
          onSelect={(id) => setSelected(Number(id))}
          {...(allowCompare
            ? {
                compareVersion: compareTarget != null ? String(compareTarget) : undefined,
                onCompare: (id: string) => setCompareVersion(Number(id)),
              }
            : {})}
          {...(allowRestore ? { onRestore } : {})}
        />
        <RightPane
          tab={tab}
          onTab={setTab}
          allowCompare={allowCompare}
          hunks={hunks}
          snapshot={detail?.data}
          renderDiff={renderDiff}
        />
      </div>
    </div>
  );
}

function RightPane({
  tab,
  onTab,
  allowCompare,
  hunks,
  snapshot,
  renderDiff,
}: {
  tab: RightTab;
  onTab(t: RightTab): void;
  allowCompare: boolean;
  hunks: DiffViewLine[] | null;
  snapshot: unknown;
  renderDiff?: (hunks: DiffViewLine[]) => ReactNode;
}) {
  const activeTab = allowCompare ? tab : 'snapshot';

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {allowCompare && (
        <SegmentedControlTabs
          tabs={[
            { id: 'diff', label: 'Diff' },
            { id: 'snapshot', label: 'Snapshot' },
          ]}
          active={activeTab}
          onChange={(id) => onTab(id as RightTab)}
        />
      )}
      {activeTab === 'diff' ? (
        // No compare target selected yet is a PLACEHOLDER, never an error.
        hunks ? (
          // Gated on `renderDiff` being GIVEN, not on what it returns —
          // `null`/`undefined` are valid nodes meaning "render nothing".
          renderDiff ? (
            renderDiff(hunks)
          ) : (
            <DiffView hunks={hunks} />
          )
        ) : (
          <EmptyState
            title="Nothing to compare"
            hint="Pick a version to compare against with “Compare to”."
          />
        )
      ) : (
        <pre
          className="font-mono text-[12.5px] leading-relaxed overflow-auto p-4 rounded-lg"
          style={{
            color: 'var(--c-ink)',
            background: 'var(--c-card)',
            border: '1px solid var(--c-hair)',
          }}
        >
          {snapshot !== undefined ? JSON.stringify(snapshot, null, 2) : '(select a version)'}
        </pre>
      )}
    </div>
  );
}

export const EntityVersionHistoryView = withStability(
  EntityVersionHistoryViewImpl,
  'experimental',
  'connected',
  // The record's `dataSources` with `usage: fetchedByComponent` (M34 `m34l12sc`).
  // `lineDiffHunks` is a pure util that fetches nothing, so it is not a data
  // source of the component and is not listed.
  ['useVersions', 'useVersionDetail', 'useRestoreVersion', 'useReleases'],
);
