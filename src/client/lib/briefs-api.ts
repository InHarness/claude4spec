/**
 * M21 briefs REST client. Wszystkie endpointy zwracaja `{ data: T }` (jak
 * /api/plans, /api/releases) — handle() rozpakowuje envelope.
 *
 * Path encoding: kazda sciezka brief'u jest splatem (`/api/briefs/<path>`),
 * encodeURIComponent na kazdy segment osobno (zachowuje slash separator dla
 * zagniezdzonych folderow, ale escapuje znaki specjalne w nazwach plikow).
 */

import type {
  Brief,
  BriefContentUpdateResult,
  BriefCreateRequest,
  BriefCreateResult,
  BriefFrontmatterUpdateRequest,
  BriefListItem,
  BriefThreadSummary,
} from '../../shared/entities.js';
import { handle, apiFetch } from './api-core.js';

type Envelope<T> = { data: T };

/** Splat-safe path encoding — preserves `/` separators, escapes special chars per segment. */
function encodeBriefPath(briefPath: string): string {
  return briefPath.split('/').map(encodeURIComponent).join('/');
}

export interface BriefDetailResponse extends Brief {
  threads: BriefThreadSummary[];
}

export const briefsApi = {
  async list(opts: { implemented?: boolean } = {}): Promise<BriefListItem[]> {
    const url = opts.implemented === undefined
      ? '/api/briefs'
      : `/api/briefs?implemented=${opts.implemented ? 'true' : 'false'}`;
    const env = await handle<Envelope<BriefListItem[]>>(await apiFetch(url));
    return env.data;
  },

  async create(input: BriefCreateRequest): Promise<BriefCreateResult> {
    const env = await handle<Envelope<BriefCreateResult>>(
      await apiFetch('/api/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
    return env.data;
  },

  async get(briefPath: string): Promise<BriefDetailResponse> {
    const env = await handle<Envelope<BriefDetailResponse>>(
      await apiFetch(`/api/briefs/${encodeBriefPath(briefPath)}`),
    );
    return env.data;
  },

  async updateContent(
    briefPath: string,
    input: { content: string; expectedHash: string; changeSummary?: string },
  ): Promise<BriefContentUpdateResult> {
    const env = await handle<Envelope<BriefContentUpdateResult>>(
      await apiFetch(`/api/briefs/${encodeBriefPath(briefPath)}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
    return env.data;
  },

  async updateFrontmatter(
    briefPath: string,
    patch: BriefFrontmatterUpdateRequest,
  ): Promise<Brief> {
    const env = await handle<Envelope<Brief>>(
      await apiFetch(`/api/briefs/${encodeBriefPath(briefPath)}/frontmatter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    );
    return env.data;
  },

  async listThreads(briefPath: string): Promise<BriefThreadSummary[]> {
    const env = await handle<Envelope<BriefThreadSummary[]>>(
      await apiFetch(`/api/briefs/${encodeBriefPath(briefPath)}/threads`),
    );
    return env.data;
  },

  async createThread(briefPath: string, name?: string): Promise<{ threadId: string }> {
    const env = await handle<Envelope<{ threadId: string }>>(
      await apiFetch(`/api/briefs/${encodeBriefPath(briefPath)}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name ? { name } : {}),
      }),
    );
    return env.data;
  },
};

export { encodeBriefPath };
