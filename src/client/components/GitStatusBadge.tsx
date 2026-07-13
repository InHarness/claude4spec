import { useRef, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useConfig } from '../hooks/useConfig.js';
import { useGitStatus } from '../hooks/useGitStatus.js';
import { useGitBranches } from '../hooks/useGitBranches.js';
import { useGitCheckout } from '../hooks/useGitCheckout.js';
import { Popover } from '../host-ui-kit/overlay-feedback/Popover.js';
import { toast } from '../ui/events.js';

/**
 * M28 — sidebar git-status badge. Mirrors `UserSection`'s fixed-block
 * placement, but unlike it does NOT reserve a constant height when hidden:
 * most projects won't have git wired up, and an empty reserved block would be
 * more noise than signal for a solo dev.
 *
 * 0.1.123: interactive — click opens a dropdown of local branches (including
 * in detached HEAD, so the user has a way out of it); picking one fires
 * `POST /api/git/checkout`. On `'switched'` the page does a full reload so
 * every module-load-time constant and the in-memory entity/section index
 * pick up the new working tree (see M31 reload contract, `project-context.ts`).
 */
export function GitStatusBadge() {
  const { data: config } = useConfig();
  // Gated: fires only once config confirms git is on, so the common (git
  // off) case never pays for the server-side detect() subprocess spawns.
  const { data: status } = useGitStatus({ enabled: config?.git?.enabled === true });
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  // Only fetch the branch list while the dropdown is actually open.
  const { data: branchesData } = useGitBranches({ enabled: open && config?.git?.enabled === true });
  const checkout = useGitCheckout();

  if (!config?.git?.enabled || !status?.detected) return null;

  const ahead = status.ahead ?? null;
  const behind = status.behind ?? null;
  const hasAheadBehind = ahead !== null || behind !== null;

  function onPick(branch: string) {
    setHint(null);
    checkout.mutate(branch, {
      onSuccess: (result) => {
        switch (result.status) {
          case 'switched':
            // Full reload — module-load constants and the in-memory index
            // must re-initialize against the new working tree.
            window.location.reload();
            return;
          case 'dirty-blocked':
          case 'busy':
            setHint(result.message);
            return;
          case 'not-found':
            toast.error(result.message ?? `Branch "${branch}" was not found.`);
            setOpen(false);
            return;
          case 'error':
          case 'skipped':
            toast.error(result.message ?? 'Branch switch failed.');
            setOpen(false);
            return;
        }
      },
      onError: () => {
        toast.error('Branch switch failed.');
      },
    });
  }

  return (
    <div className="relative w-full">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3.5 py-2 flex items-center gap-2 text-left"
        style={{ minHeight: 40, borderBottom: '1px solid var(--c-hair)' }}
        title={status.rootPath ?? undefined}
      >
        <GitBranch size={13} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />
        <span className="flex-1 min-w-0 truncate text-[11.5px] font-mono" style={{ color: 'var(--c-ink)' }}>
          {status.branch ?? 'detached HEAD'}
        </span>
        {hasAheadBehind ? (
          <span
            className="shrink-0 text-[10.5px] font-mono"
            style={{ color: 'var(--c-muted)' }}
            title={`${ahead ?? 0} commit${ahead === 1 ? '' : 's'} ahead / ${behind ?? 0} commit${behind === 1 ? '' : 's'} behind upstream`}
          >
            ↑{ahead ?? 0} ↓{behind ?? 0}
          </span>
        ) : null}
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
      <Popover
        open={open}
        onClose={() => {
          setOpen(false);
          setHint(null);
        }}
        anchorRef={anchorRef}
        placement="bottom"
        footer={hint ? <span className="text-[11px]" style={{ color: 'var(--c-muted)' }}>{hint}</span> : undefined}
      >
        <div className="flex flex-col" style={{ minWidth: 180, maxWidth: 260 }}>
          {(branchesData?.branches ?? []).map((branch) => {
            const isCurrent = branch === (branchesData?.current ?? status.branch);
            return (
              <button
                key={branch}
                type="button"
                disabled={checkout.isPending}
                onClick={() => onPick(branch)}
                className="px-2 py-1 text-left rounded text-[11.5px] font-mono truncate"
                style={{
                  color: isCurrent ? 'var(--c-accent)' : 'var(--c-ink)',
                  fontWeight: isCurrent ? 600 : 400,
                  opacity: checkout.isPending ? 0.5 : 1,
                  cursor: checkout.isPending ? 'default' : 'pointer',
                }}
              >
                {branch}
              </button>
            );
          })}
          {branchesData && branchesData.branches.length === 0 ? (
            <span className="px-2 py-1 text-[11px]" style={{ color: 'var(--c-muted)' }}>
              No local branches
            </span>
          ) : null}
        </div>
      </Popover>
    </div>
  );
}
