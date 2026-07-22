/**
 * M23 patches REST client. M36: all endpoints now go through the generic
 * `/api/artifacts/patch/*` family (see `routes/artifacts.ts`) — patches have
 * no creation endpoint (they're authored via `c4s file-patch`). All endpoints
 * return `{ data: T }` — handle() unwraps the envelope.
 *
 * Path encoding mirrors briefs: each patch path is a splat
 * (`/api/artifacts/patch/<path>`), encodeURIComponent per segment so `/`
 * separators survive but special chars in filenames are escaped.
 */

import type {
  ArtifactContentUpdateRequest,
  ArtifactFrontmatterUpdateRequest,
  ArtifactListItem,
  ArtifactResponse,
  ArtifactThreadCreateRequest,
  PatchKind,
  PatchStatus,
} from '../../shared/entities.js';
import { handle, apiFetch } from './api-core.js';
import { encodeArtifactPath, stem } from './artifact-path.js';

type Envelope<T> = { data: T };

/** Splat-safe path encoding — preserves `/` separators, escapes special chars per segment. */
const encodePatchPath = encodeArtifactPath;

/**
 * Reconstructed list-item view — field-compatible with the old (removed)
 * `PatchListItem` DTO, so `BriefsList.tsx` needs no further changes beyond
 * importing this type from here instead of `shared/entities.js`. `briefRef` is
 * the RAW (unresolved) `frontmatter.brief` value — the by-filename-prefix
 * fallback resolution that `PatchService.resolveBriefPath` does server-side
 * for the *legacy* `briefPath` field is reimplemented client-side in
 * `BriefsList.tsx` (the only consumer that groups patches under a brief),
 * since it needs the full list of known brief paths to do so.
 */
export interface PatchListItemView {
  path: string;
  briefRef: string | undefined;
  patchKind: PatchKind;
  status: PatchStatus;
  createdAt: string;
  createdBy: string;
  lastModified: string;
}

export interface PatchArtifactView extends ArtifactResponse {
  /** Client-derived: body's first `# heading`, else `frontmatter.title`, else
   *  the filename stem — mirrors the server's old (removed) title derivation,
   *  now done here since the generic `ArtifactResponse` carries no `title`. */
  title: string;
}

/** Only the detail GET returns `threads` (the old detail route merged them in). */
export interface PatchDetailResponse extends PatchArtifactView {
}

const VALID_PATCH_KINDS: ReadonlySet<string> = new Set(['drift', 'missing', 'incorrect', 'clarification']);

function deriveTitle(path: string, frontmatter: Record<string, unknown>, body: string): string {
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1 && h1[1]) return h1[1].trim();
  if (typeof frontmatter.title === 'string' && frontmatter.title.length > 0) return frontmatter.title;
  return stem(path);
}

function toPatchListItemView(item: ArtifactListItem): PatchListItemView {
  const fm = item.frontmatter as {
    brief?: string;
    patch_kind?: unknown;
    status?: unknown;
    created_at?: unknown;
    created_by?: unknown;
  };
  const createdAt = fm.created_at instanceof Date ? fm.created_at.toISOString() : String(fm.created_at ?? '');
  return {
    path: item.path,
    briefRef: typeof fm.brief === 'string' && fm.brief.length > 0 ? fm.brief : undefined,
    patchKind: VALID_PATCH_KINDS.has(String(fm.patch_kind)) ? (fm.patch_kind as PatchKind) : 'clarification',
    status: fm.status === 'completed' ? 'completed' : 'awaiting',
    createdAt,
    createdBy: String(fm.created_by ?? ''),
    lastModified: item.updatedAt ?? createdAt,
  };
}

function toPatchArtifactView(data: ArtifactResponse): PatchArtifactView {
  return { ...data, title: deriveTitle(data.path, data.frontmatter, data.body) };
}

export const patchesApi = {
  async list(opts: { brief?: string; status?: string } = {}): Promise<PatchListItemView[]> {
    const qs = new URLSearchParams();
    if (opts.brief !== undefined) qs.set('brief', opts.brief);
    if (opts.status !== undefined) qs.set('status', opts.status);
    const url = qs.toString() ? `/api/artifacts/patch?${qs.toString()}` : '/api/artifacts/patch';
    const env = await handle<Envelope<ArtifactListItem[]>>(await apiFetch(url));
    return env.data.map(toPatchListItemView);
  },

  async get(patchPath: string): Promise<PatchDetailResponse> {
    const env = await handle<Envelope<ArtifactResponse>>(
      await apiFetch(`/api/artifacts/patch/${encodePatchPath(patchPath)}`),
    );
    return toPatchArtifactView(env.data);
  },

  async updateContent(
    patchPath: string,
    input: { content: string; expectedHash: string },
  ): Promise<PatchArtifactView> {
    const body: ArtifactContentUpdateRequest = input;
    const env = await handle<Envelope<ArtifactResponse>>(
      await apiFetch(`/api/artifacts/patch/${encodePatchPath(patchPath)}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return toPatchArtifactView(env.data);
  },

  async updateFrontmatter(
    patchPath: string,
    frontmatter: Record<string, unknown>,
  ): Promise<PatchArtifactView> {
    const body: ArtifactFrontmatterUpdateRequest = { frontmatter };
    const env = await handle<Envelope<ArtifactResponse>>(
      await apiFetch(`/api/artifacts/patch/${encodePatchPath(patchPath)}/frontmatter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return toPatchArtifactView(env.data);
  },

  async createThread(patchPath: string, name?: string): Promise<{ threadId: string }> {
    const body: ArtifactThreadCreateRequest = name ? { name } : {};
    const env = await handle<Envelope<{ threadId: string }>>(
      await apiFetch(`/api/artifacts/patch/${encodePatchPath(patchPath)}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return env.data;
  },
};

export { encodePatchPath };
