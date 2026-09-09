import { useEffect, useState } from 'react';
import { ArrowLeft, Clock, RotateCcw } from 'lucide-react';
import { usePageVersions, usePageVersionDetail } from '../hooks/usePageVersions.js';
import { useReleases, useRestorePage } from '../hooks/useReleases.js';

interface Props {
  rootId: string;
  path: string;
  onBack: () => void;
}

/**
 * Page detail history (M17 m17uitm01) — analogiczny pattern jak entity
 * VersionHistory: lista wersji z release labelkami + restore button per
 * wersja przypisana do release'a. Detail panel pokazuje snapshot data.
 */
export function PageVersionHistory({ rootId, path, onBack }: Props) {
  const { data: versions = [], isLoading } = usePageVersions(rootId, path);
  const releaseNameById = useReleases();
  const restorePage = useRestorePage();
  const [selected, setSelected] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    if (versions.length && selected === null) setSelected(versions[0]!.version);
  }, [versions, selected]);

  const { data: detail } = usePageVersionDetail(rootId, path, selected);

  const onRestore = async (releaseId: number) => {
    setRestoring(releaseId);
    try {
      await restorePage.mutateAsync({ releaseId, path });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setRestoring(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        Loading history…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 860, padding: '24px 48px 100px' }}>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 mb-4 text-[12px] font-medium rounded-md px-2 py-1 -ml-2 transition"
          style={{ color: 'var(--c-muted)' }}
        >
          <ArrowLeft size={13} /> Back to editor
        </button>
        <div className="flex items-center gap-2 mb-6">
          <Clock size={16} />
          <h2 className="text-[19px] font-semibold">Version history</h2>
          <span className="flex-1" />
          <span className="text-[11.5px] font-mono" style={{ color: 'var(--c-subtle)' }}>
            page · {path}
          </span>
        </div>

        <div className="grid grid-cols-[260px_1fr] gap-6">
          <div className="space-y-1">
            {versions.length === 0 && (
              <div className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
                No versions yet.
              </div>
            )}
            {groupPageVersions(versions).map((group) => (
              <div key={group.key} data-testid={`page-version-group-${group.key}`}>
                <div
                  className="px-1 pt-2 pb-1 text-[11px] font-medium truncate"
                  style={{ color: group.unreleased ? 'var(--c-accent-ink)' : 'var(--c-ink)' }}
                >
                  {group.unreleased ? 'Unreleased' : (releaseNameById.get(Number(group.key)) ?? `Release ${group.key}`)}
                  <span className="ml-1.5 text-[10.5px]" style={{ color: 'var(--c-subtle)' }}>
                    {group.items.length}
                  </span>
                </div>
                {group.items.map((v, i) => {
              const active = v.version === selected;
              const releaseName = v.releaseId != null ? releaseNameById.get(v.releaseId) : null;
              const canRestore = v.releaseId != null;
              return (
                <div key={v.version} className="relative">
                  <button
                    onClick={() => setSelected(v.version)}
                    className="w-full text-left relative pl-6 pr-3 py-2 rounded-md transition"
                    style={{
                      background: active ? 'var(--c-accent-soft)' : 'transparent',
                      border: `1px solid ${active ? 'var(--c-accent)' : 'transparent'}`,
                    }}
                  >
                    <span
                      className="absolute"
                      style={{
                        left: 10,
                        top: 14,
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: dotColor(v.changedBy),
                      }}
                    />
                    {i < group.items.length - 1 && (
                      <span
                        className="absolute"
                        style={{
                          left: 13,
                          top: 22,
                          width: 2,
                          height: 28,
                          background: 'var(--c-hair-strong)',
                        }}
                      />
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[12px] font-semibold">v{v.version}</span>
                      <span
                        className="rounded-full px-1.5 text-[9.5px] uppercase tracking-wider font-mono"
                        style={{ background: pillBg(v.changedBy), color: pillFg(v.changedBy) }}
                      >
                        {v.changedBy}
                      </span>
                      <span className="flex-1" />
                      <span className="text-[10.5px]" style={{ color: 'var(--c-subtle)' }}>
                        {v.createdAt.split(' ')[1] ?? v.createdAt}
                      </span>
                    </div>
                    {/*
                      * 0.2.77 — the release pill is gone from the row: the release
                      * name is the group heading above. What tells versions apart
                      * INSIDE a group is time (in the line above) and the op.
                      */}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
                        {v.op}
                      </span>
                    </div>
                  </button>
                  {canRestore && (
                    <button
                      onClick={() => v.releaseId != null && onRestore(v.releaseId)}
                      disabled={restoring != null}
                      className="absolute top-1.5 right-1.5 rounded p-1 transition opacity-60 hover:opacity-100"
                      style={{
                        color: 'var(--c-muted)',
                        opacity: restoring === v.releaseId ? 0.4 : undefined,
                      }}
                      title={`Restore page to release ${releaseName ?? v.releaseId}`}
                    >
                      <RotateCcw size={11} />
                    </button>
                  )}
                </div>
              );
                })}
              </div>
            ))}
          </div>

          <div
            className="rounded-lg overflow-hidden"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
          >
            <div
              className="flex items-center gap-2 px-4 py-2 text-[11.5px]"
              style={{ borderBottom: '1px solid var(--c-hair)', color: 'var(--c-muted)' }}
            >
              <span className="font-mono">{path}</span>
              <span className="flex-1" />
              {selected !== null && <span>v{selected}</span>}
            </div>
            <pre
              className="font-mono text-[12.5px] leading-relaxed overflow-auto p-4 whitespace-pre-wrap"
              style={{ color: 'var(--c-ink)' }}
            >
              {detail ? detail.data.content : '(select a version)'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function dotColor(by: string): string {
  if (by === 'agent') return 'var(--c-blue)';
  if (by === 'filesystem') return 'var(--c-muted)';
  return 'var(--c-green)';
}
function pillBg(by: string): string {
  if (by === 'agent') return 'var(--c-blue-soft)';
  if (by === 'filesystem') return 'var(--c-panel)';
  return 'var(--c-green-soft)';
}
function pillFg(by: string): string {
  if (by === 'agent') return 'var(--c-blue)';
  if (by === 'filesystem') return 'var(--c-muted)';
  return 'var(--c-green)';
}


/**
 * 0.2.77 — the page timeline's release axis, mirroring the entity one.
 *
 * Kept local rather than shared with the kit's `groupByRelease` because the two
 * consume different row types: the kit groups `VersionHistoryItem`s it was handed,
 * this groups `file_version` rows straight from the API. The RULE is the same and
 * is the part that matters — unreleased first, then releases newest-first in the
 * order the (already newest-first) rows introduce them.
 */
function groupPageVersions<T extends { releaseId?: number | null }>(
  versions: readonly T[],
): Array<{ key: string; unreleased: boolean; items: T[] }> {
  const unreleased: T[] = [];
  const groups: Array<{ key: string; unreleased: boolean; items: T[] }> = [];
  for (const v of versions) {
    if (v.releaseId == null) {
      unreleased.push(v);
      continue;
    }
    const key = String(v.releaseId);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(v);
    else groups.push({ key, unreleased: false, items: [v] });
  }
  return unreleased.length > 0
    ? [{ key: '__unreleased__', unreleased: true, items: unreleased }, ...groups]
    : groups;
}
