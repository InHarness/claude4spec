/**
 * M21 briefs REST client. M36: list/detail/content/frontmatter/threads now go
 * through the generic `/api/artifacts/brief/*` family (see `routes/artifacts.ts`)
 * — only brief CREATION stays at `POST /api/briefs` (M21's own consumer slice,
 * per the brief's carve-out). All endpoints return `{ data: T }` — handle()
 * unwraps the envelope.
 *
 * Path encoding: each brief path is a splat (`/api/artifacts/brief/<path>`),
 * encodeURIComponent per segment so `/` separators survive nested folders but
 * special chars in filenames are escaped.
 */

import type {
  ArtifactContentUpdateRequest,
  ArtifactFrontmatterUpdateRequest,
  ArtifactListItem,
  ArtifactResponse,
  ArtifactThreadCreateRequest,
  BriefCreateRequest,
  BriefCreateResult,
  BriefThreadSummary,
} from '../../shared/entities.js';
import { handle, apiFetch } from './api-core.js';

type Envelope<T> = { data: T };

/** Splat-safe path encoding — preserves `/` separators, escapes special chars per segment. */
function encodeBriefPath(briefPath: string): string {
  return briefPath.split('/').map(encodeURIComponent).join('/');
}

/**
 * Reconstructed list-item view — field-compatible with the old (removed)
 * `BriefListItem` DTO, so `BriefsList.tsx`/`ReleasesList.tsx` need no further
 * changes beyond importing this type from here instead of `shared/entities.js`.
 * `threadCount` is dropped (not rendered by either consumer) — the generic
 * `ArtifactListItem` has no equivalent field.
 */
export interface BriefListItemView {
  path: string;
  source: string;
  fromRelease: string | null;
  toRelease: string | null;
  implemented: boolean;
  generatedAt: string;
  lastModifiedAt: string | null;
}

export interface BriefDetailResponse extends ArtifactResponse {
  threads: BriefThreadSummary[];
}

/**
 * Typed view of `ArtifactResponse.frontmatter` for briefs — cast at call sites
 * that need concrete field access (was `BriefFrontmatter` before M36 narrowed
 * the generic detail DTO's `frontmatter` to `Record<string, unknown>`).
 */
export interface BriefFrontmatterView {
  type: 'brief';
  source: string;
  from_release: string | null;
  to_release: string | null;
  generated_at: string;
  generator_version: string;
  implemented?: boolean;
  roots?: string[];
  [key: string]: unknown;
}

function toBriefListItemView(item: ArtifactListItem): BriefListItemView {
  const fm = item.frontmatter as {
    source?: string;
    from_release?: string | null;
    to_release?: string | null;
    implemented?: boolean;
    generated_at?: string;
  };
  return {
    path: item.path,
    source: fm.source === 'analysis' ? 'analysis' : 'release-diff',
    fromRelease: typeof fm.from_release === 'string' ? fm.from_release : null,
    toRelease: typeof fm.to_release === 'string' ? fm.to_release : null,
    implemented: fm.implemented === true,
    generatedAt: String(fm.generated_at ?? ''),
    lastModifiedAt: item.updatedAt,
  };
}

export const briefsApi = {
  async list(opts: { implemented?: boolean } = {}): Promise<BriefListItemView[]> {
    const url = opts.implemented === undefined
      ? '/api/artifacts/brief'
      : `/api/artifacts/brief?implemented=${opts.implemented ? 'true' : 'false'}`;
    const env = await handle<Envelope<ArtifactListItem[]>>(await apiFetch(url));
    return env.data.map(toBriefListItemView);
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
      await apiFetch(`/api/artifacts/brief/${encodeBriefPath(briefPath)}`),
    );
    return env.data;
  },

  async updateContent(
    briefPath: string,
    input: { content: string; expectedHash: string },
  ): Promise<ArtifactResponse> {
    const body: ArtifactContentUpdateRequest = input;
    const env = await handle<Envelope<ArtifactResponse>>(
      await apiFetch(`/api/artifacts/brief/${encodeBriefPath(briefPath)}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return env.data;
  },

  async updateFrontmatter(
    briefPath: string,
    frontmatter: Record<string, unknown>,
  ): Promise<ArtifactResponse> {
    const body: ArtifactFrontmatterUpdateRequest = { frontmatter };
    const env = await handle<Envelope<ArtifactResponse>>(
      await apiFetch(`/api/artifacts/brief/${encodeBriefPath(briefPath)}/frontmatter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return env.data;
  },

  async createThread(briefPath: string, name?: string): Promise<{ threadId: string }> {
    const body: ArtifactThreadCreateRequest = name ? { name } : {};
    const env = await handle<Envelope<{ threadId: string }>>(
      await apiFetch(`/api/artifacts/brief/${encodeBriefPath(briefPath)}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return env.data;
  },
};

export { encodeBriefPath };
