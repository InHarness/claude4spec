import type { GitStatusResponse } from '../../shared/git.js';
import { handle, apiFetch } from './api-core.js';

/** M28 — client for `/api/git/*`. Read-only repo detection. */
export const gitApi = {
  async status(): Promise<GitStatusResponse> {
    return handle<GitStatusResponse>(await apiFetch('/api/git/status'));
  },
};
