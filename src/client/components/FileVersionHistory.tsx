import { Clock } from 'lucide-react';
import { useArtifactVersions } from '../hooks/useArtifactVersions.js';
import type { ArtifactKind } from '../hooks/useArtifactThreads.js';

interface Props {
  kind: ArtifactKind;
  path: string;
}

/**
 * 0.1.139: the `file_version` audit trail shared by every artifact detail page
 * (was `BriefVersionHistory`, brief-only). Deliberately read-only — a version
 * is recovered through an M17 release restore or a rewrite from chat, not from
 * here, which is why there is no restore button (unlike the entity-level
 * `VersionHistory` / `PageVersionHistory`).
 */
export function FileVersionHistory({ kind, path }: Props) {
  const { data: versions = [], isLoading } = useArtifactVersions(kind, path);

  if (isLoading) {
    return (
      <div className="p-6 text-[12px]" style={{ color: 'var(--c-subtle)' }}>
        Loading history…
      </div>
    );
  }
  if (versions.length === 0) {
    return (
      <div className="p-6 text-[12px]" style={{ color: 'var(--c-subtle)' }}>
        No versions captured yet.
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <ul className="divide-y" style={{ borderColor: 'var(--c-hair)' }}>
        {versions.map((v) => (
          <li key={v.id} className="px-4 py-2.5">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="font-mono" style={{ color: 'var(--c-muted)' }}>
                v{v.version}
              </span>
              <OpBadge op={v.op} />
              <ChangedByBadge by={v.changedBy} />
              {v.releaseId !== null && <ReleaseIdBadge releaseId={v.releaseId} />}
              <span className="flex-1" />
              <span
                className="inline-flex items-center gap-1 text-[11px]"
                style={{ color: 'var(--c-subtle)' }}
              >
                <Clock size={10} />
                {formatRelative(v.createdAt)}
              </span>
            </div>
            {v.changeSummary && (
              <div
                className="mt-1 text-[11.5px] pl-[2.5rem]"
                style={{ color: 'var(--c-muted)' }}
              >
                {v.changeSummary}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OpBadge({ op }: { op: 'create' | 'update' | 'delete' }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    create: { bg: '#2d6a4f', fg: '#fff' },
    update: { bg: 'var(--c-accent)', fg: '#fff' },
    delete: { bg: '#b33a3a', fg: '#fff' },
  };
  const c = colors[op]!;
  return (
    <span
      className="font-mono text-[10px] px-1.5 py-0.5 rounded uppercase"
      style={{ background: c.bg, color: c.fg }}
    >
      {op}
    </span>
  );
}

function ChangedByBadge({ by }: { by: 'user' | 'agent' | 'filesystem' }) {
  return (
    <span
      className="font-mono text-[10px] px-1.5 py-0.5 rounded"
      style={{ background: 'var(--c-hair)', color: 'var(--c-muted)' }}
    >
      {by}
    </span>
  );
}

function ReleaseIdBadge({ releaseId }: { releaseId: number }) {
  return (
    <span
      className="font-mono text-[10px] px-1.5 py-0.5 rounded"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair-strong)', color: 'var(--c-muted)' }}
    >
      release #{releaseId}
    </span>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return 'unknown';
  try {
    const ts = new Date(iso.replace(' ', 'T') + 'Z').getTime();
    const diff = Date.now() - ts;
    const sec = Math.round(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return new Date(ts).toLocaleString();
  } catch {
    return iso;
  }
}
