import { useNavigate } from '@tanstack/react-router';
import { GitBranch } from 'lucide-react';
import { useConfig } from '../hooks/useConfig.js';
import { useGitStatus } from '../hooks/useGitStatus.js';

/**
 * M28 — sidebar git-status badge (the first M28 UI outside Settings). Mirrors
 * `UserSection`'s fixed-block placement, but unlike it does NOT reserve a
 * constant height when hidden: most projects won't have git wired up, and an
 * empty reserved block would be more noise than signal for a solo dev.
 * M28 owns all git-status data; this component is a pure consumer of the
 * already-existing `useGitStatus()` hook (no new endpoint).
 */
export function GitStatusBadge() {
  const { data: config } = useConfig();
  const { data: status } = useGitStatus();
  const navigate = useNavigate();

  if (!config?.git?.enabled || !status?.detected) return null;

  return (
    <button
      onClick={() => navigate({ to: '/settings', hash: 'git' })}
      className="w-full px-3.5 py-2 flex items-center gap-2 text-left"
      style={{ minHeight: 40, borderBottom: '1px solid var(--c-hair)' }}
      title={status.rootPath ?? undefined}
    >
      <GitBranch size={13} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />
      <span className="flex-1 min-w-0 truncate text-[11.5px] font-mono" style={{ color: 'var(--c-ink)' }}>
        {status.branch ?? 'detached HEAD'}
      </span>
      <span
        className="inline-block rounded-full shrink-0"
        style={{
          width: 7,
          height: 7,
          background: status.isDirty ? '#a87033' : 'var(--c-accent)',
        }}
        title={status.isDirty ? 'Uncommitted changes' : 'Clean'}
      />
    </button>
  );
}
