import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { GitCommit, Plus } from 'lucide-react';
import { useReleases } from '../hooks/useReleases.js';
import { useAllReleasePushes } from '../hooks/useReleasePushes.js';
import { CreateReleaseDialog } from './CreateReleaseDialog.js';

export function ReleasesList() {
  const { data: releases = [], isLoading } = useReleases();
  const { data: pushes = [] } = useAllReleasePushes();
  const [showCreate, setShowCreate] = useState(false);

  // Per-release count of SUCCESSFUL pushes (dedup hits count; errors do not).
  const pushedCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of pushes) {
      if (p.status !== 'success') continue;
      m.set(p.releaseId, (m.get(p.releaseId) ?? 0) + 1);
    }
    return m;
  }, [pushes]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div
        className="flex items-center gap-3 px-8 py-4"
        style={{ borderBottom: '1px solid var(--c-hair)' }}
      >
        <GitCommit size={18} style={{ color: 'var(--c-accent)' }} />
        <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: 'var(--c-ink)' }}>
          Releases
        </h2>
        <span className="font-mono text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
          {releases.length} {releases.length === 1 ? 'release' : 'releases'}
        </span>
        <span className="flex-1" />
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md flex items-center gap-1.5 px-2.5 py-1 text-[12.5px]"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          <Plus size={13} />
          Create release
        </button>
      </div>

      <div className="flex-1 overflow-auto nice-scroll">
        <div className="mx-auto" style={{ maxWidth: 800, padding: '24px 32px 48px' }}>
          {isLoading && (
            <div className="text-center text-[13px] py-10" style={{ color: 'var(--c-subtle)' }}>
              Loading…
            </div>
          )}
          {!isLoading && releases.length === 0 && (
            <div
              className="text-center py-20 rounded-lg"
              style={{
                background: 'var(--c-card)',
                border: '1px dashed var(--c-hair-strong)',
                color: 'var(--c-subtle)',
              }}
            >
              <div className="text-[14px]">No releases yet.</div>
              <div className="text-[12px] mt-1">
                Create one to snapshot the current spec state.
              </div>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 rounded-md flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] mx-auto"
                style={{ background: 'var(--c-accent)', color: '#fff' }}
              >
                <Plus size={13} />
                Create release
              </button>
            </div>
          )}
          <div className="space-y-2">
            {releases.map((r) => (
              <Link
                key={r.id}
                to="/releases/$idOrName"
                params={{ idOrName: r.name }}
                className="flex items-start gap-3 px-4 py-3 rounded-md transition-colors"
                style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
              >
                <GitCommit size={14} style={{ color: 'var(--c-accent)', marginTop: 3 }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[14px] font-semibold font-mono" style={{ color: 'var(--c-ink)' }}>
                      {r.name}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
                      by {r.createdBy} · {formatDate(r.createdAt)}
                    </span>
                    {pushedCounts.get(r.id) ? (
                      <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--c-accent-soft)', color: 'var(--c-accent-ink)' }}
                      >
                        {pushedCounts.get(r.id) === 1 ? 'Pushed' : `Pushed ${pushedCounts.get(r.id)}×`}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="text-[12.5px] mt-1"
                    style={{ color: 'var(--c-muted)' }}
                  >
                    {r.description}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {showCreate && <CreateReleaseDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function formatDate(iso: string): string {
  // Display-only formatting; preserve UTC ISO interpretation.
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString();
  } catch {
    return iso;
  }
}
