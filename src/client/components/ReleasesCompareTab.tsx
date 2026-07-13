import { useState } from 'react';
import { GitCompare } from 'lucide-react';
import { useReleases, useReleaseDiff, useReleaseSnapshot } from '../hooks/useReleases.js';
import { EmptyState } from '../host-ui-kit/list/EmptyState.js';
import { DeltaSection } from './release/DeltaSection.js';
import { ReleaseSelect } from './release/ReleaseSelect.js';

/**
 * `/releases` Compare tab (0.1.122) — diff a chosen release against the live
 * unreleased spec state (`GET /api/releases/<release>/diff/current`).
 * Defaults to the latest release (`id === maxReleaseId`), matching the
 * "latest → current" preset used by the unreleased-changes counter deep-link.
 */
export function ReleasesCompareTab() {
  const { data: releases = [], isLoading } = useReleases();
  const maxReleaseId = releases.length > 0 ? Math.max(...releases.map((r) => r.id)) : null;
  const latest = releases.find((r) => r.id === maxReleaseId) ?? null;
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const activeName = selectedName ?? latest?.name ?? null;

  const { data: diff, isLoading: diffLoading } = useReleaseDiff(
    activeName ?? undefined,
    activeName ? 'current' : undefined,
  );
  // For `deleted` rendering we need the snapshot of the compared-against release.
  const { data: fromSnapshot } = useReleaseSnapshot(diff?.from?.name ?? undefined);

  if (!isLoading && releases.length === 0) {
    return (
      <div className="flex-1 overflow-auto nice-scroll">
        <div className="mx-auto" style={{ maxWidth: 800, padding: '24px 32px 48px' }}>
          <EmptyState title="Create a release first" hint="There's nothing to compare the current spec state against yet." />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 920, padding: '24px 32px 48px' }}>
        <div className="flex items-center gap-2 mb-4 text-[12.5px]" style={{ color: 'var(--c-muted)' }}>
          <GitCompare size={14} style={{ color: 'var(--c-accent)' }} />
          <span>Compare:</span>
          <ReleaseSelect
            releases={releases}
            value={activeName ?? ''}
            onChange={(v) => setSelectedName(v || null)}
            latestId={maxReleaseId ?? undefined}
          />
          {activeName && (
            <span className="text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
              {activeName} → current
            </span>
          )}
        </div>

        {diffLoading && (
          <div className="text-center text-[13px] py-10" style={{ color: 'var(--c-subtle)' }}>
            Loading…
          </div>
        )}

        {!diffLoading && diff && (
          <DeltaSection
            entityChanges={diff.entities}
            pageChanges={diff.pages}
            fromSnapshot={fromSnapshot}
            emptyMessage={`No changes since ${activeName}.`}
          />
        )}
      </div>
    </div>
  );
}
