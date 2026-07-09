import type { ProgressResponse } from '../../shared/progress.js';
import { handle, apiFetch } from './api-core.js';

/** M35 — client for `GET /api/progress`. Read-only, aggregated view. */
export const progressApi = {
  async get(): Promise<ProgressResponse> {
    return handle<ProgressResponse>(await apiFetch('/api/progress'));
  },
};
