import type {
  GitCheckoutResponse,
  GitFetchResponse,
  GitStatusResponse,
  GitSyncResponse,
} from '../../shared/git.js';
import type { ToastVariant } from '../ui/events.js';

/**
 * 2.1.10 (M28 8i5qf0xx "Okna", 846dmtbu "Stany") — what the header branch
 * switcher shows for each result of checkout, fetch and sync. Pure: the
 * component only executes the outcome (toast / hint / reload), so the table of
 * the spec lives in one place and is tested without rendering.
 *
 * `busy` is a hint at the entry for all three operations, never a window;
 * `dirty-blocked` on checkout is a hint in the branch list, on sync a toast.
 */

export const BUSY_HINT = 'A background task is running — try again in a moment';
export const DIRTY_CHECKOUT_HINT = 'Commit or stash your changes before switching branches';
export const SYNC_UPDATED_TOAST = { variant: 'success', message: 'Updated from the remote' } as const;

export interface GitUiOutcome {
  toast?: { variant: ToastVariant; message: string };
  /** Hint next to the header entry. */
  entryHint?: string;
  /** Hint inside the branch list. */
  listHint?: string;
  /** HEAD changed — the initiating client reloads the project route (M31 ic35jwy6). */
  reload?: boolean;
  /** Close the branch list. */
  closeList?: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function fetchOutcome(r: GitFetchResponse): GitUiOutcome {
  switch (r.status) {
    case 'fetched': {
      const behind = r.behind ?? 0;
      return {
        toast:
          behind > 0
            ? { variant: 'success', message: `${plural(behind, 'new commit')} on the remote` }
            : { variant: 'success', message: 'Already up to date' },
      };
    }
    case 'busy':
      return { entryHint: BUSY_HINT };
    case 'error':
      return { toast: { variant: 'error', message: r.message ?? 'Fetch failed.' } };
    case 'skipped':
    case 'no-upstream':
      // ASSUMPTION:dev-0001 no toast for no-upstream/skipped (the spec's table
      // has none): the refreshed status hides the actions.
      return {};
  }
}

export function syncOutcome(r: GitSyncResponse): GitUiOutcome {
  switch (r.status) {
    case 'up-to-date':
      return { toast: { variant: 'success', message: 'Already up to date' } };
    case 'fast-forwarded':
    case 'merged':
      // Shown after the route reload (carried through it as a flash toast).
      return { toast: { ...SYNC_UPDATED_TOAST }, reload: true };
    case 'dirty-blocked':
      return {
        toast: {
          variant: 'warning',
          message: `Commit your local changes to ${plural(r.paths?.length ?? 0, 'file')} before syncing`,
        },
      };
    case 'diverged':
      return {
        toast: {
          variant: 'warning',
          message:
            r.reason === 'releases-on-both-sides'
              ? 'New releases exist both locally and on the remote — sync in a terminal'
              : `Your branch and the remote have conflicting changes in ${plural(r.paths?.length ?? 0, 'file')} — resolve them in a terminal`,
        },
      };
    case 'busy':
      return { entryHint: BUSY_HINT };
    case 'error':
      return { toast: { variant: 'error', message: r.message ?? 'Sync failed.' } };
    case 'skipped':
    case 'no-upstream':
      return {};
  }
}

export function checkoutOutcome(r: GitCheckoutResponse): GitUiOutcome {
  switch (r.status) {
    case 'switched':
      return { reload: true };
    case 'dirty-blocked':
      return { listHint: DIRTY_CHECKOUT_HINT };
    case 'busy':
      return { entryHint: BUSY_HINT };
    case 'not-found':
      // The hook refreshes the branch list on this status.
      return { toast: { variant: 'warning', message: 'Branch no longer exists' }, closeList: true };
    case 'error':
    case 'skipped':
      return { toast: { variant: 'error', message: r.message ?? 'Branch switch failed.' }, closeList: true };
  }
}

/** Fetch is offered only when the current branch has an upstream. */
export function hasUpstream(s: Pick<GitStatusResponse, 'ahead' | 'behind'>): boolean {
  return s.ahead !== null || s.behind !== null;
}

/** `Sync ↓N` is offered with an upstream and `behind > 0`. */
export function syncCount(s: Pick<GitStatusResponse, 'ahead' | 'behind'>): number | null {
  return hasUpstream(s) && (s.behind ?? 0) > 0 ? (s.behind as number) : null;
}

/** "Last fetched …" line of the entry tooltip; `null` when the repo never fetched. */
export function lastFetchedLine(lastFetchedAt: string | null, now: number = Date.now()): string | null {
  if (!lastFetchedAt) return null;
  const at = Date.parse(lastFetchedAt);
  if (Number.isNaN(at)) return null;
  const sec = Math.max(0, Math.round((now - at) / 1000));
  let rel: string;
  if (sec < 60) rel = 'just now';
  else if (sec < 3600) rel = `${plural(Math.floor(sec / 60), 'minute')} ago`;
  else if (sec < 86_400) rel = `${plural(Math.floor(sec / 3600), 'hour')} ago`;
  else rel = `${plural(Math.floor(sec / 86_400), 'day')} ago`;
  return `Last fetched ${rel}`;
}

/** Tooltip of the header entry: root, full ahead/behind counts, last fetch time. */
export function entryTooltip(s: GitStatusResponse, now: number = Date.now()): string {
  const lines: string[] = [];
  if (s.rootPath) lines.push(s.rootPath);
  if (hasUpstream(s)) {
    const ahead = s.ahead ?? 0;
    const behind = s.behind ?? 0;
    lines.push(`${plural(ahead, 'commit')} ahead / ${plural(behind, 'commit')} behind upstream`);
  }
  const fetched = lastFetchedLine(s.lastFetchedAt, now);
  if (fetched) lines.push(fetched);
  return lines.join('\n');
}
