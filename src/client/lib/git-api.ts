import type { GitBranchesResponse, GitCheckoutResponse, GitStatusResponse } from '../../shared/git.js';
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
};
