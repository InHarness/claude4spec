import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Download, GitBranch, GitFork, Loader2, RefreshCw, Settings } from 'lucide-react';
import { useConfig } from '../hooks/useConfig.js';
import { useGitStatus } from '../hooks/useGitStatus.js';
import { useGitBranches } from '../hooks/useGitBranches.js';
import { useGitShadows } from '../hooks/useGitShadows.js';
import { useGitCheckout } from '../hooks/useGitCheckout.js';
import { useGitFetch, useGitSync } from '../hooks/useGitRemoteOps.js';
import {
  checkoutOutcome,
  entryTooltip,
  fetchOutcome,
  hasUpstream,
  syncCount,
  syncOutcome,
  timeAgo,
  type GitUiOutcome,
} from '../lib/git-results.js';
import { setGitFlashToast, takeGitFlashToast } from '../lib/git-flash.js';
import { reloadProjectRoute } from '../lib/project-reload.js';
import { Popover } from '../host-ui-kit/overlay-feedback/Popover.js';
import { toast } from '../ui/events.js';

/**
 * M28 — sidebar git-status badge (slot `Nagłówek`). Mirrors `UserSection`'s fixed-block
 * placement, but unlike it does NOT reserve a constant height when hidden:
 * most projects won't have git wired up, and an empty reserved block would be
 * more noise than signal for a solo dev.
 *
 * 0.1.123: interactive — click opens a dropdown of local branches (including
 * in detached HEAD, so the user has a way out of it); picking one fires
 * `POST /api/git/checkout`. On `'switched'` the project route reloads so
 * every module-load-time constant and the in-memory entity/section index
 * pick up the new working tree (see M31 reload contract, `project-context.ts`).
 *
 * 2.1.10 (M28 846dmtbu): a Fetch action (icon, only with an upstream) and a
 * `Sync ↓N` button (only with `behind > 0`). While checkout, fetch or sync runs
 * the entry shows a spinner and both actions and the branch list are locked.
 * Results are toasts and hints (`lib/git-results.ts`); after a sync that moved
 * HEAD the route reloads and "Updated from the remote" is shown after it. The
 * tooltip carries the full ahead/behind counts and "Last fetched …".
 *
 * 2.1.46 (M28 8i5qf0xx / 846dmtbu): the dropdown has two sections — „Branches”
 * and, when the shadow list (`GET /api/git/shadows`) is not empty, „Shadows”:
 * set apart visually, never current, each item its id and the tip commit's
 * time (the subject in the tooltip). Picking a shadow ONLY navigates to
 * `/releases?tab=shadow&ref=<id>` (the router percent-encodes the id): no
 * checkout, no dirty/busy guard, no lock, HEAD and the disk untouched.
 */

declare module '@tanstack/history' {
  interface HistoryState {
    /** The header Shadows section's per-click token: the current entry's + 1 (see `onOpenShadow`). */
    shadowVisit?: number;
  }
}

export function GitStatusBadge() {
  const { data: config } = useConfig();
  // Gated: fires only once config confirms git is on, so the common (git
  // off) case never pays for the server-side detect() subprocess spawns.
  const { data: status } = useGitStatus({ enabled: config?.git?.enabled === true });
  const [open, setOpen] = useState(false);
  const [entryHint, setEntryHint] = useState<string | null>(null);
  const [listHint, setListHint] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  // Only fetch the branch list while the dropdown is actually open.
  const { data: branchesData } = useGitBranches({ enabled: open && config?.git?.enabled === true });
  const { data: shadowsData } = useGitShadows({ enabled: open && config?.git?.enabled === true });
  const checkout = useGitCheckout();
  const fetchOp = useGitFetch();
  const syncOp = useGitSync();
  const navigate = useNavigate();

  // A toast parked across the project route reload (sync `fast-forwarded` /
  // `merged`). Deferred one tick so the toast host's listener is mounted.
  useEffect(() => {
    const flash = takeGitFlashToast();
    if (!flash) return;
    const t = window.setTimeout(() => toast[flash.variant](flash.message), 0);
    return () => window.clearTimeout(t);
  }, []);

  if (!config?.git?.enabled || !status?.detected) return null;

  const ahead = status.ahead ?? null;
  const behind = status.behind ?? null;
  const upstream = hasUpstream(status);
  const toPull = syncCount(status);
  const busy = checkout.isPending || fetchOp.isPending || syncOp.isPending;

  function apply(outcome: GitUiOutcome) {
    if (outcome.reload) {
      if (outcome.toast) setGitFlashToast(outcome.toast);
      reloadProjectRoute();
      return;
    }
    if (outcome.toast) toast[outcome.toast.variant](outcome.toast.message);
    if (outcome.entryHint) setEntryHint(outcome.entryHint);
    if (outcome.listHint) setListHint(outcome.listHint);
    if (outcome.closeList) setOpen(false);
  }

  function resetHints() {
    setEntryHint(null);
    setListHint(null);
  }

  function onPick(branch: string) {
    resetHints();
    checkout.mutate(branch, {
      onSuccess: (result) => apply(checkoutOutcome(result)),
      onError: () => toast.error('Branch switch failed.'),
    });
  }

  function onOpenShadow(id: string) {
    setOpen(false);
    // Every click is a new history entry, even onto the URL already shown —
    // the router drops a navigation to the same href with the same state as a
    // no-op. The token is derived from the CURRENT entry's state (it lives in
    // the history, so it survives a page reload; a module-scoped counter would
    // restart and collide): the next entry's token always differs from it.
    navigate({
      to: '/releases',
      search: { tab: 'shadow', ref: id },
      state: (current) => ({ shadowVisit: (current.shadowVisit ?? 0) + 1 }),
    });
  }

  function onFetch() {
    if (busy) return;
    resetHints();
    fetchOp.mutate(undefined, {
      onSuccess: (result) => apply(fetchOutcome(result)),
      onError: () => toast.error('Fetch failed.'),
    });
  }

  function onSync() {
    if (busy) return;
    resetHints();
    syncOp.mutate(undefined, {
      onSuccess: (result) => apply(syncOutcome(result)),
      onError: () => toast.error('Sync failed.'),
    });
  }

  return (
    <div className="relative w-full" data-git-entry>
      <div
        className="w-full flex items-center"
        style={{ minHeight: 40, borderBottom: entryHint ? undefined : '1px solid var(--c-hair)' }}
      >
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 min-w-0 pl-3.5 pr-1 py-2 flex items-center gap-2 text-left"
          title={entryTooltip(status) || undefined}
          aria-busy={busy || undefined}
          data-git-entry-toggle
        >
          {busy ? (
            <Loader2
              size={13}
              className="animate-spin"
              style={{ color: 'var(--c-accent)', flexShrink: 0 }}
              data-git-spinner
            />
          ) : (
            <GitBranch size={13} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />
          )}
          <span className="flex-1 min-w-0 truncate text-[11.5px] font-mono" style={{ color: 'var(--c-ink)' }}>
            {status.branch ?? 'detached HEAD'}
          </span>
          {upstream ? (
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
        {toPull !== null ? (
          <button
            type="button"
            onClick={onSync}
            disabled={busy}
            className="shrink-0 px-1.5 py-0.5 rounded text-[10.5px] font-mono"
            style={{
              color: 'var(--c-accent)',
              border: '1px solid var(--c-hair)',
              opacity: busy ? 0.5 : 1,
              cursor: busy ? 'default' : 'pointer',
            }}
            title={`Pull ${toPull} commit${toPull === 1 ? '' : 's'} from the remote`}
            data-git-sync
          >
            <span className="inline-flex items-center gap-0.5">
              <Download size={10} />
              Sync ↓{toPull}
            </span>
          </button>
        ) : null}
        {upstream ? (
          <button
            type="button"
            onClick={onFetch}
            disabled={busy}
            className="shrink-0 px-2 py-1"
            style={{ color: 'var(--c-muted)', opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer' }}
            title="Fetch from the remote"
            aria-label="Fetch from the remote"
            data-git-fetch
          >
            <RefreshCw size={12} />
          </button>
        ) : null}
      </div>
      {entryHint ? (
        <div
          className="px-3.5 pb-1.5 text-[10.5px]"
          style={{ color: 'var(--c-muted)', borderBottom: '1px solid var(--c-hair)' }}
          role="status"
          data-git-entry-hint
        >
          {entryHint}
        </div>
      ) : null}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        placement="bottom"
        footer={
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate({ to: '/settings', hash: 'git' });
            }}
            className="w-full flex items-center gap-1.5 text-[11px]"
            style={{ color: 'var(--c-muted)' }}
          >
            <Settings size={11} />
            Git settings
          </button>
        }
      >
        <div className="flex flex-col" style={{ minWidth: 180, maxWidth: 260 }}>
          {listHint ? (
            <span className="px-2 py-1 text-[11px]" style={{ color: '#a87033' }} role="status" data-git-list-hint>
              {listHint}
            </span>
          ) : null}
          <SectionLabel>Branches</SectionLabel>
          {(branchesData?.branches ?? []).map((branch) => {
            const isCurrent = branch === (branchesData?.current ?? status.branch);
            return (
              <button
                key={branch}
                type="button"
                disabled={busy || isCurrent}
                onClick={() => {
                  if (isCurrent || busy) return;
                  onPick(branch);
                }}
                className="px-2 py-1 text-left rounded text-[11.5px] font-mono truncate"
                style={{
                  color: isCurrent ? 'var(--c-accent)' : 'var(--c-ink)',
                  fontWeight: isCurrent ? 600 : 400,
                  opacity: busy ? 0.5 : 1,
                  cursor: busy || isCurrent ? 'default' : 'pointer',
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
          {shadowsData && shadowsData.shadows.length > 0 ? (
            <div
              className="flex flex-col mt-1 pt-1"
              style={{ borderTop: '1px solid var(--c-hair)' }}
              data-git-shadows
            >
              <SectionLabel>Shadows</SectionLabel>
              {shadowsData.shadows.map((shadow) => (
                <button
                  key={shadow.id}
                  type="button"
                  onClick={() => onOpenShadow(shadow.id)}
                  className="px-2 py-1 text-left rounded flex items-center gap-1.5 text-[11.5px]"
                  style={{ color: 'var(--c-muted)', cursor: 'pointer' }}
                  title={shadow.tipSubject}
                  data-git-shadow={shadow.id}
                >
                  <GitFork size={11} style={{ flexShrink: 0 }} aria-hidden />
                  <span className="flex-1 min-w-0 truncate font-mono italic">{shadow.id}</span>
                  <span className="shrink-0 text-[10.5px]" style={{ color: 'var(--c-subtle)' }}>
                    {timeAgo(shadow.tipCommittedAt) ?? ''}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </Popover>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <span
      className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wider font-semibold"
      style={{ color: 'var(--c-subtle)' }}
    >
      {children}
    </span>
  );
}
