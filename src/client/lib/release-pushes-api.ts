import type { ReleasePushRequest, ReleasePushResponse } from '../../shared/release-push.js';
import { handle, apiFetch } from './api-core.js';

export const releasePushesApi = {
  /** POST /api/release-pushes — synchronous push of a release to the remote. */
  /** 2.1.11: the release is addressed by name (`{ releaseName }`). */
  async push(releaseName: string): Promise<ReleasePushResponse> {
    return handle<ReleasePushResponse>(
      await apiFetch('/api/release-pushes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ releaseName } satisfies ReleasePushRequest),
      }),
    );
  },
  async listForRelease(releaseName: string): Promise<ReleasePushResponse[]> {
    const data = await handle<{ items: ReleasePushResponse[] }>(
      await apiFetch(`/api/release-pushes?releaseName=${encodeURIComponent(releaseName)}`),
    );
    return data.items;
  },
  async listAll(): Promise<ReleasePushResponse[]> {
    const data = await handle<{ items: ReleasePushResponse[] }>(await apiFetch('/api/release-pushes'));
    return data.items;
  },
};
