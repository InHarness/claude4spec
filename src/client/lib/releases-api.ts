import type {
  CreateReleaseResponse,
  RawDelta,
  Release,
  ReleaseDetail,
  SpecSnapshot,
  UpdateReleaseResponse,
} from '../../shared/entities.js';
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
  /** Count of unreleased captures at HEAD (drives the M25 banner on the latest release). */
  async unreleasedCount(): Promise<number> {
    const data = await handle<{ count: number }>(await apiFetch('/api/releases/unreleased-count'));
    return data.count;
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
