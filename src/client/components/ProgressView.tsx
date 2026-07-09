import { TrendingUp, CheckCircle2, Circle, AlertTriangle, GitBranch } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { BriefListItem } from '../../shared/entities.js';
import type { ProgressRelease, ProgressResponse } from '../../shared/progress.js';
import type { GitAheadBehindStatus } from '../../shared/git.js';
import { useProgress } from '../hooks/useProgress.js';
import { encodeBriefPath } from '../lib/briefs-api.js';

/**
 * M35 — read-only view of "which spec releases are already implemented in
 * code, and which are still to-do". The `implementedMarker` (a code-side
 * convention, see `ProgressService.readMarker`) draws the done/queue
 * boundary at the release level; a brief's own `implemented` flag is always
 * shown independently (the marker never overrides it).
 */
export function ProgressView() {
  const { data, isLoading } = useProgress();

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center gap-3 px-8 py-4" style={{ borderBottom: '1px solid var(--c-hair)' }}>
        <TrendingUp size={18} style={{ color: 'var(--c-accent)' }} />
        <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: 'var(--c-ink)' }}>
          Progress
        </h2>
      </div>

      <div className="flex-1 overflow-auto nice-scroll">
        <div className="mx-auto" style={{ maxWidth: 800, padding: '24px 32px 48px' }}>
          {isLoading && (
            <div className="text-center text-[13px] py-10" style={{ color: 'var(--c-subtle)' }}>
              Loading…
            </div>
          )}
          {!isLoading && data && <ProgressBody data={data} />}
        </div>
      </div>
    </div>
  );
}

function ProgressBody({ data }: { data: ProgressResponse }) {
  const { releases, unreleasedBriefs, implementedMarker, gitStatus } = data;

  if (releases.length === 0 && unreleasedBriefs.length === 0) {
    return (
      <div
        className="text-center py-20 rounded-lg"
        style={{ background: 'var(--c-card)', border: '1px dashed var(--c-hair-strong)', color: 'var(--c-subtle)' }}
      >
        <div className="text-[14px]">No releases yet — create one to start tracking implementation progress.</div>
      </div>
    );
  }

  const markerIdx = implementedMarker === null ? -1 : releases.findIndex((r) => r.name === implementedMarker);
  const markerKnown = implementedMarker !== null && markerIdx !== -1;
  const badMarker = implementedMarker !== null && markerIdx === -1;

  return (
    <div className="flex flex-col gap-4">
      {gitStatus !== null && <GitStatusSection status={gitStatus} />}

      {implementedMarker === null && (
        <MutedBanner>No implementation marker found — showing all releases without done/todo status.</MutedBanner>
      )}
      {badMarker && (
        <WarningBanner>
          Implementation marker '{implementedMarker}' does not match any known release — check the marker file.
        </WarningBanner>
      )}

      <div className="space-y-2">
        {releases.map((r, i) => (
          <ReleaseRow key={r.id} release={r} done={markerKnown && i <= markerIdx} />
        ))}
      </div>

      {unreleasedBriefs.length > 0 && (
        <div className="flex flex-col gap-2 pt-2">
          {unreleasedBriefs.map((b) => (
            <BriefRow key={b.path} brief={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReleaseRow({ release, done }: { release: ProgressRelease; done: boolean }) {
  return (
    <div
      className="rounded-md px-4 py-3"
      style={{
        background: done ? 'transparent' : 'var(--c-card)',
        border: '1px solid var(--c-hair)',
        opacity: done ? 0.6 : 1,
      }}
    >
      <div className="flex items-center gap-2">
        {done ? (
          <CheckCircle2 size={14} style={{ color: 'var(--c-green)' }} />
        ) : (
          <Circle size={14} style={{ color: 'var(--c-subtle)' }} />
        )}
        <Link
          to="/releases/$idOrName"
          params={{ idOrName: release.name }}
          className="text-[14px] font-semibold font-mono"
          style={{ color: 'var(--c-ink)' }}
        >
          {release.name}
        </Link>
        <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          {formatDate(release.createdAt)}
        </span>
      </div>
      {release.briefs.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-2 pl-[22px]">
          {release.briefs.map((b) => (
            <BriefRow key={b.path} brief={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function BriefRow({ brief }: { brief: BriefListItem }) {
  return (
    <div className="flex items-center gap-2">
      {brief.implemented ? (
        <CheckCircle2 size={12} style={{ color: 'var(--c-green)' }} />
      ) : (
        <span
          className="inline-block rounded-full"
          style={{ width: 8, height: 8, background: 'var(--c-yellow)', marginLeft: 2, marginRight: 2 }}
          title="Not yet implemented"
        />
      )}
      <Link
        to="/briefs/$path"
        params={{ path: encodeBriefPath(brief.path) }}
        className="text-[12.5px] font-mono truncate"
        style={{ color: brief.implemented ? 'var(--c-subtle)' : 'var(--c-ink)' }}
      >
        {brief.path}
      </Link>
    </div>
  );
}

function GitStatusSection({ status }: { status: GitAheadBehindStatus }) {
  const parts: string[] = [];
  if (status.ahead !== null && status.ahead > 0) parts.push(`${status.ahead} ahead`);
  if (status.behind !== null && status.behind > 0) parts.push(`${status.behind} behind`);
  const aheadBehind = parts.length > 0 ? parts.join(' / ') : status.ahead === null && status.behind === null ? 'no upstream' : 'up to date';

  return (
    <div
      className="flex items-center gap-3 rounded-md px-3 py-2 text-[12px]"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
    >
      <GitBranch size={14} style={{ color: 'var(--c-accent)' }} />
      <span className="font-mono" style={{ color: 'var(--c-ink)' }}>
        {status.branch ?? 'detached HEAD'}
      </span>
      <span
        className="rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide"
        style={
          status.isDirty
            ? { background: 'rgba(168, 112, 51, 0.18)', color: '#a87033' }
            : { background: 'var(--c-accent-soft)', color: 'var(--c-accent)' }
        }
      >
        {status.isDirty ? 'Uncommitted changes' : 'Clean'}
      </span>
      <span style={{ color: 'var(--c-subtle)' }}>{aheadBehind}</span>
    </div>
  );
}

function MutedBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-md px-3 py-2 text-[12px]"
      style={{ background: 'var(--c-hair)', color: 'var(--c-muted)' }}
    >
      {children}
    </div>
  );
}

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md px-3 py-2 text-[12px]"
      style={{ background: 'rgba(168, 112, 51, 0.18)', color: '#a87033' }}
    >
      <AlertTriangle size={13} />
      {children}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString();
  } catch {
    return iso;
  }
}
