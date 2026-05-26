import type { ReleasePushResponse } from '../../shared/release-push.js';
import { handle } from './api-core.js';

export const releasePushesApi = {
  /** POST /api/release-pushes — synchronous push of a release to the remote. */
  async push(releaseId: number): Promise<ReleasePushResponse> {
    return handle<ReleasePushResponse>(
      await fetch('/api/release-pushes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ releaseId }),
      }),
    );
  },
  async listForRelease(releaseId: number): Promise<ReleasePushResponse[]> {
    const data = await handle<{ items: ReleasePushResponse[] }>(
      await fetch(`/api/release-pushes?releaseId=${encodeURIComponent(String(releaseId))}`),
    );
    return data.items;
  },
  async listAll(): Promise<ReleasePushResponse[]> {
    const data = await handle<{ items: ReleasePushResponse[] }>(await fetch('/api/release-pushes'));
    return data.items;
  },
};
