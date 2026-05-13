import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Clock, RotateCcw } from 'lucide-react';
import { useVersions, useVersionDetail } from '../hooks/useVersions.js';
import { useReleases, useRestoreEntity } from '../hooks/useReleases.js';
import { computeLineDiffClient } from '../lib/release-diff/compute-line-diff.js';
import { LineDiffViewer } from './release/LineDiffViewer.js';
import type { EntityType } from '../../shared/entities.js';

interface Props {
  type: EntityType;
  slug: string;
  onBack: () => void;
}

export function VersionHistory({ type, slug, onBack }: Props) {
  const { data: versions = [], isLoading } = useVersions(type, slug);
  const { data: allReleases = [] } = useReleases();
  const restoreEntity = useRestoreEntity();
  const [selected, setSelected] = useState<number | null>(null);
  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const releaseNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of allReleases) m.set(r.id, r.name);
    return m;
  }, [allReleases]);

  useEffect(() => {
    if (versions.length && selected === null) setSelected(versions[0]!.version);
  }, [versions, selected]);

  // Default compare target: the version immediately older than `selected`.
  useEffect(() => {
    if (selected == null || versions.length === 0) return;
    const idx = versions.findIndex((v) => v.version === selected);
    const next = idx >= 0 && idx + 1 < versions.length ? versions[idx + 1]!.version : null;
    setCompareVersion((cur) => (cur === null || !versions.some((v) => v.version === cur) ? next : cur));
  }, [selected, versions]);

  const { data: detail } = useVersionDetail(type, slug, selected);
  const { data: compareDetail } = useVersionDetail(
    type,
    slug,
    compareVersion != null && compareVersion !== selected ? compareVersion : null,
  );

  const onRestore = async (releaseId: number) => {
    setRestoring(releaseId);
    try {
      await restoreEntity.mutateAsync({ releaseId, type, slug });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setRestoring(null);
    }
  };

  const lineDiff = useMemo(() => {
    if (!detail || !compareDetail) return null;
    const a = JSON.stringify(compareDetail.data, null, 2);
    const b = JSON.stringify(detail.data, null, 2);
    return computeLineDiffClient(a, b);
  }, [detail, compareDetail]);

  if (isLoading)
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        Loading history…
      </div>
    );

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 860, padding: '24px 48px 100px' }}>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 mb-4 text-[12px] font-medium rounded-md px-2 py-1 -ml-2 transition"
          style={{ color: 'var(--c-muted)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--c-accent-ink)';
            e.currentTarget.style.background = 'var(--c-panel)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--c-muted)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <ArrowLeft size={13} /> Back to endpoint
        </button>
        <div className="flex items-center gap-2 mb-6">
          <Clock size={16} />
          <h2 className="text-[19px] font-semibold">Version history</h2>
          <span className="flex-1" />
          <span className="text-[11.5px] font-mono" style={{ color: 'var(--c-subtle)' }}>
            {type} · {slug}
          </span>
        </div>

        <div className="grid grid-cols-[240px_1fr] gap-6">
          <div className="space-y-1">
            {versions.length === 0 && (
              <div className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
                No versions yet.
              </div>
            )}
            {versions.map((v, i) => {
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
                        background:
                          v.changedBy === 'agent' ? 'var(--c-blue)' : 'var(--c-green)',
                      }}
                    />
                    {i < versions.length - 1 && (
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
                        style={{
                          background:
                            v.changedBy === 'agent' ? 'var(--c-blue-soft)' : 'var(--c-green-soft)',
                          color: v.changedBy === 'agent' ? 'var(--c-blue)' : 'var(--c-green)',
                        }}
                      >
                        {v.changedBy}
                      </span>
                      <span className="flex-1" />
                      <span className="text-[10.5px]" style={{ color: 'var(--c-subtle)' }}>
                        {v.createdAt.split(' ')[1] ?? v.createdAt}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {releaseName ? (
                        <span
                          className="rounded px-1.5 py-0.5 text-[9.5px] font-mono"
                          style={{
                            background: 'var(--c-accent-soft)',
                            color: 'var(--c-accent-ink)',
                          }}
                          title={`Captured into release ${releaseName}`}
                        >
                          {releaseName}
                        </span>
                      ) : (
                        <span
                          className="rounded px-1.5 py-0.5 text-[9.5px] font-mono italic"
                          style={{ color: 'var(--c-subtle)' }}
                        >
                          (unreleased)
                        </span>
                      )}
                      <span className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
                        {v.changeSummary ?? '—'}
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
                      title={`Restore entity to release ${releaseName ?? v.releaseId}`}
                    >
                      <RotateCcw size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div
            className="rounded-lg overflow-hidden"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
          >
            <div
              className="flex items-center gap-2 px-4 py-2 text-[11.5px]"
              style={{ borderBottom: '1px solid var(--c-hair)', color: 'var(--c-muted)' }}
            >
              <span className="font-mono">{slug}.json</span>
              <span className="flex-1" />
              <span>Compare to:</span>
              <select
                value={compareVersion ?? ''}
                onChange={(e) =>
                  setCompareVersion(e.target.value ? Number(e.target.value) : null)
                }
                className="rounded px-1.5 py-0.5 text-[11.5px] font-mono"
                style={{
                  background: 'var(--c-card)',
                  border: '1px solid var(--c-hair)',
                  color: 'var(--c-ink)',
                }}
              >
                <option value="">— none —</option>
                {versions
                  .filter((v) => v.version !== selected)
                  .map((v) => (
                    <option key={v.version} value={v.version}>
                      v{v.version}
                    </option>
                  ))}
              </select>
              {selected !== null && (
                <span style={{ color: 'var(--c-ink)' }}>
                  {compareVersion ? `v${compareVersion} → v${selected}` : `v${selected}`}
                </span>
              )}
            </div>
            {lineDiff ? (
              <div className="p-3">
                <LineDiffViewer lineDiff={lineDiff} />
              </div>
            ) : (
              <pre
                className="font-mono text-[12.5px] leading-relaxed overflow-auto p-4"
                style={{ color: 'var(--c-ink)' }}
              >
                {detail
                  ? JSON.stringify(detail.data, null, 2)
                  : '(select a version)'}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
