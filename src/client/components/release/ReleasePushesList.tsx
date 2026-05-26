import { useReleasePushes } from '../../hooks/useReleasePushes.js';
import type { ReleasePushResponse } from '../../../shared/release-push.js';

/**
 * M25 "Pushes" section on the release detail card — the audit log of every push
 * attempt for this release (success and error), newest first. Hidden when the
 * release has never been pushed.
 */
export function ReleasePushesList({ releaseId }: { releaseId: number }) {
  const { data: pushes = [] } = useReleasePushes(releaseId);
  if (pushes.length === 0) return null;

  return (
    <section className="mt-8">
      <h3
        className="text-[11px] uppercase tracking-wider font-mono font-semibold mb-2"
        style={{ color: 'var(--c-subtle)' }}
      >
        Pushes ({pushes.length})
      </h3>
      <div className="space-y-1.5">
        {pushes.map((p) => (
          <PushRow key={p.id} push={p} />
        ))}
      </div>
    </section>
  );
}

function PushRow({ push }: { push: ReleasePushResponse }) {
  const ok = push.status === 'success';
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-md text-[12px]"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
    >
      <span
        className="font-mono px-1.5 py-0.5 rounded text-[10px] uppercase"
        style={{
          background: ok ? 'var(--c-accent-soft)' : 'rgba(182,85,60,0.12)',
          color: ok ? 'var(--c-accent-ink)' : 'var(--c-red)',
        }}
      >
        {ok ? 'success' : 'error'}
      </span>
      {ok && push.remoteReleaseSequence != null && (
        <span className="font-mono" style={{ color: 'var(--c-ink)' }}>
          #{push.remoteReleaseSequence}
        </span>
      )}
      {push.deduplicated && (
        <span
          className="font-mono px-1.5 py-0.5 rounded text-[10px]"
          style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
        >
          dedup
        </span>
      )}
      {!ok && push.errorMessage && (
        <span className="truncate" style={{ color: 'var(--c-red)' }} title={push.errorMessage}>
          {push.errorMessage}
        </span>
      )}
      <span className="flex-1" />
      {push.pushedByAccountEmail && (
        <span style={{ color: 'var(--c-subtle)' }}>{push.pushedByAccountEmail}</span>
      )}
      <span style={{ color: 'var(--c-subtle)' }}>{formatDate(push.pushedAt)}</span>
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
