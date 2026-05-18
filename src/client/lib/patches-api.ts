/**
 * M23 patches REST client. All endpoints return `{ data: T }` (like
 * /api/briefs) — handle() unwraps the envelope.
 *
 * Path encoding mirrors briefs: each patch path is a splat
 * (`/api/patches/<path>`), encodeURIComponent per segment so `/` separators
 * survive but special chars in filenames are escaped.
 */

import type {
  BriefThreadSummary,
  PatchFrontmatterUpdateRequest,
  PatchListItem,
  PatchResponse,
} from '../../shared/entities.js';
import { handle } from './api-core.js';

type Envelope<T> = { data: T };

/** Splat-safe path encoding — preserves `/` separators, escapes special chars per segment. */
function encodePatchPath(patchPath: string): string {
  return patchPath.split('/').map(encodeURIComponent).join('/');
}

export interface PatchDetailResponse extends PatchResponse {
  threads: BriefThreadSummary[];
}

export const patchesApi = {
  async list(opts: { brief?: string; status?: string } = {}): Promise<PatchListItem[]> {
    const qs = new URLSearchParams();
    if (opts.brief !== undefined) qs.set('brief', opts.brief);
    if (opts.status !== undefined) qs.set('status', opts.status);
    const url = qs.toString() ? `/api/patches?${qs.toString()}` : '/api/patches';
    const env = await handle<Envelope<PatchListItem[]>>(await fetch(url));
    return env.data;
  },

  async get(patchPath: string): Promise<PatchDetailResponse> {
    const env = await handle<Envelope<PatchDetailResponse>>(
      await fetch(`/api/patches/${encodePatchPath(patchPath)}`),
    );
    return env.data;
  },

  async updateContent(
    patchPath: string,
    input: { content: string; expectedHash: string },
  ): Promise<PatchResponse> {
    const env = await handle<Envelope<PatchResponse>>(
      await fetch(`/api/patches/${encodePatchPath(patchPath)}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
    return env.data;
  },

  async updateFrontmatter(
    patchPath: string,
    patch: PatchFrontmatterUpdateRequest,
  ): Promise<PatchResponse> {
    const env = await handle<Envelope<PatchResponse>>(
      await fetch(`/api/patches/${encodePatchPath(patchPath)}/frontmatter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    );
    return env.data;
  },

  async createThread(patchPath: string, name?: string): Promise<{ threadId: string }> {
    const env = await handle<Envelope<{ threadId: string }>>(
      await fetch(`/api/patches/${encodePatchPath(patchPath)}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name ? { name } : {}),
      }),
    );
    return env.data;
  },
};

export { encodePatchPath };
