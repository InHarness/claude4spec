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
 * semantics — restore goes down the host's existing `versionService` path
 * (M13), the labels come from `useReleases` (M17) and the diff from the pure
 * `lineDiffHunks` util. The host's own history routes render this very block,
 * so host and plugin show an identical view.
 *
 * Consumed L11 surface: `useVersions`, `useVersionDetail`, `useRestoreVersion`,
 * `useReleases`, `lineDiffHunks` (transport via M33).
 */
export interface EntityVersionHistoryViewProps {
  type: string;
  slug: string;
  /** Show the restore action per row. Default `true`. */
  allowRestore?: boolean;
  /** Show the "Compare to" selection and the diff panel. Default `true`. */
  allowCompare?: boolean;
  /** Show the release-name pill (`(unreleased)` when the version has no release). Default `true`. */
  showReleasePill?: boolean;
  /** Rendered instead of the default empty state when the entity has no versions at all. */
  emptyState?: ReactNode;
  /** Replaces the default diff panel — for entities with their own visualisation. */
  renderDiff?: (hunks: DiffViewLine[]) => ReactNode;
  /** Fired after a successful restore, so the author can invalidate their own views. */
  onRestored?: (versionId: string) => void;
}

type RightTab = 'diff' | 'snapshot';

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
  const { data: versions = [], isLoading } = useVersions(entityType, slug);
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
    ...(showReleasePill
      ? { releaseLabel: (v.releaseId != null ? releaseNameById.get(v.releaseId) : undefined) ?? '(unreleased)' }
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
  if (versions.length === 0) {
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
        // Surfaced inline rather than through `useToast`: a toast needs a
        // `ToastViewport` the embedding app may not have mounted, and a restore
        // that silently does nothing is the worst possible failure here.
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
  ['useVersions', 'useVersionDetail', 'useRestoreVersion', 'useReleases', 'lineDiffHunks'],
);
