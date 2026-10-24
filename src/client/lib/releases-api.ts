import type {
  CreateReleaseResponse,
  RawDelta,
  Release,
  ReleaseDetail,
  ShadowAcceptRequest,
  ShadowDiffResponse,
  SpecSnapshot,
  UpdateReleaseResponse,
} from '../../shared/entities.js';
import type { UnreleasedDeltaTotal } from '../../shared/unreleased-counter.js';
import { handle, apiFetch } from './api-core.js';

export interface RestoreEntityResponse {
  type: string;
  slug: string;
  op: 'created' | 'updated' | 'deleted' | 'noop';
  warnings?: string[];
}

export interface RestorePageResponse {
  path: string;
  op: 'created' | 'updated' | 'deleted' | 'noop';
  warnings?: string[];
}

export interface RestoreSpecResponse {
  releaseId: number;
  entityResults: RestoreEntityResponse[];
  pageResults: RestorePageResponse[];
}

export const releasesApi = {
  async list(): Promise<Release[]> {
    const data = await handle<{ releases: Release[] }>(await apiFetch('/api/releases'));
    return data.releases;
  },
  /**
   * 2.1.45 (M17 zbc9jdnr) — the LIGHT delta map (`view=operation&summaryOnly=true`)
   * between two releases, or a release and `current`. Only `total` is typed: it
   * is what the unreleased counter reads (`unreleasedCountOf`).
   */
  async diffSummary(from: string, to: string): Promise<{ total?: UnreleasedDeltaTotal }> {
    const data = await handle<{ data: { total?: UnreleasedDeltaTotal } }>(
      await apiFetch(
        `/api/releases/${encodeURIComponent(from)}/diff/${encodeURIComponent(to)}?view=operation&summaryOnly=true`,
      ),
    );
    return data.data;
  },
  async create(input: { name: string; description: string }): Promise<CreateReleaseResponse> {
    return handle<CreateReleaseResponse>(
      await apiFetch('/api/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },
  /** 2.1.11: every release route is addressed by NAME, percent-encoded in one segment. */
  async update(
    name: string,
    input: { name?: string; description?: string; assignUnreleased?: boolean },
  ): Promise<UpdateReleaseResponse> {
    return handle<UpdateReleaseResponse>(
      await apiFetch(`/api/releases/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },
  async get(name: string): Promise<ReleaseDetail> {
    return handle<ReleaseDetail>(
      await apiFetch(`/api/releases/${encodeURIComponent(name)}`),
    );
  },
  async snapshot(name: string): Promise<SpecSnapshot> {
    return handle<SpecSnapshot>(
      await apiFetch(`/api/releases/${encodeURIComponent(name)}/snapshot`),
    );
  },
  async diff(from: string | null, to: string): Promise<RawDelta> {
    const fromSegment = from === null ? 'initial' : encodeURIComponent(from);
    return handle<RawDelta>(
      await apiFetch(
        `/api/releases/${fromSegment}/diff/${encodeURIComponent(to)}`,
      ),
    );
  },
  /**
   * 2.1.46 (M17, endpoint `get-api-shadow-diff`) — what accepting the shadow
   * `ref` would change in the master's specification. The id may contain `/`,
   * so it travels percent-encoded in the query, never in a path segment.
   */
  async shadowDiff(ref: string): Promise<ShadowDiffResponse> {
    return handle<ShadowDiffResponse>(await apiFetch(`/api/shadow-diff?ref=${encodeURIComponent(ref)}`));
  },
  /**
   * 2.1.47 (M17, endpoint `post-api-shadow-accept`) — accept a shadow as a new
   * release. The shadow id travels in the body (it may contain `/`); the answer
   * is the release (`acceptedShadow` set) with `gitSync`, like `create`.
   */
  async acceptShadow(input: ShadowAcceptRequest): Promise<CreateReleaseResponse> {
    return handle<CreateReleaseResponse>(
      await apiFetch('/api/shadow-accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },
  async restoreEntity(
    releaseName: string,
    target: { type: string; slug: string },
  ): Promise<RestoreEntityResponse> {
    return handle<RestoreEntityResponse>(
      await apiFetch(`/api/releases/${encodeURIComponent(releaseName)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'entity', target }),
      }),
    );
  },
  async restorePage(
    releaseName: string,
    target: { path: string },
  ): Promise<RestorePageResponse> {
    return handle<RestorePageResponse>(
      await apiFetch(`/api/releases/${encodeURIComponent(releaseName)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'page', target }),
      }),
    );
  },
  async restoreSpec(releaseName: string): Promise<RestoreSpecResponse> {
    return handle<RestoreSpecResponse>(
      await apiFetch(`/api/releases/${encodeURIComponent(releaseName)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'spec' }),
      }),
    );
  },
};
