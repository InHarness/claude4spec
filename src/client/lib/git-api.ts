import type {
  GitBranchesResponse,
  GitCheckoutResponse,
  GitFetchResponse,
  GitStatusResponse,
  GitSyncResponse,
} from '../../shared/git.js';
import { handle, apiFetch } from './api-core.js';

/** M28 — client for `/api/git/*`. */
export const gitApi = {
  async status(): Promise<GitStatusResponse> {
    return handle<GitStatusResponse>(await apiFetch('/api/git/status'));
  },
  /** 0.1.123: local branches for the interactive git badge dropdown. */
  async branches(): Promise<GitBranchesResponse> {
    return handle<GitBranchesResponse>(await apiFetch('/api/git/branches'));
  },
  /** 0.1.123: switch HEAD to an existing local branch. Never rejects on a
   *  domain outcome (dirty tree, unknown branch, busy) — see `status` on the
   *  resolved `GitCheckoutResponse`. */
  async checkout(branch: string): Promise<GitCheckoutResponse> {
    return handle<GitCheckoutResponse>(
      await apiFetch('/api/git/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
      }),
    );
  },
  /** 2.1.10 (M28, endpoint `post-api-git-fetch`): fetch the upstream's refs.
   *  No body; never rejects on a domain outcome — see `status`. */
  async fetch(): Promise<GitFetchResponse> {
    return handle<GitFetchResponse>(await apiFetch('/api/git/fetch', { method: 'POST' }));
  },
  /** 2.1.10 (M28, endpoint `post-api-git-sync`): pull the upstream into HEAD
   *  (fast-forward or a conflict-free merge commit). No body; never rejects on a
   *  domain outcome — see `status`. After `fast-forwarded`/`merged` the caller
   *  reloads the project route (M31 reload contract). */
  async sync(): Promise<GitSyncResponse> {
    return handle<GitSyncResponse>(await apiFetch('/api/git/sync', { method: 'POST' }));
  },
};
