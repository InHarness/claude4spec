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
  async update(
    idOrName: string | number,
    input: { name?: string; description?: string; assignUnreleased?: boolean },
  ): Promise<UpdateReleaseResponse> {
    return handle<UpdateReleaseResponse>(
      await apiFetch(`/api/releases/${encodeURIComponent(String(idOrName))}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },
  async get(idOrName: string | number): Promise<ReleaseDetail> {
    return handle<ReleaseDetail>(
      await apiFetch(`/api/releases/${encodeURIComponent(String(idOrName))}`),
    );
  },
  async snapshot(idOrName: string | number): Promise<SpecSnapshot> {
    return handle<SpecSnapshot>(
      await apiFetch(`/api/releases/${encodeURIComponent(String(idOrName))}/snapshot`),
    );
  },
  async diff(from: string | number | null, to: string | number): Promise<RawDelta> {
    const fromSegment = from === null ? '__INITIAL__' : encodeURIComponent(String(from));
    return handle<RawDelta>(
      await apiFetch(
        `/api/releases/${fromSegment}/diff/${encodeURIComponent(String(to))}`,
      ),
    );
  },
  async restoreEntity(
    releaseIdOrName: string | number,
    target: { type: string; slug: string },
  ): Promise<RestoreEntityResponse> {
    return handle<RestoreEntityResponse>(
      await apiFetch(`/api/releases/${encodeURIComponent(String(releaseIdOrName))}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'entity', target }),
      }),
    );
  },
  async restorePage(
    releaseIdOrName: string | number,
    target: { path: string },
  ): Promise<RestorePageResponse> {
    return handle<RestorePageResponse>(
      await apiFetch(`/api/releases/${encodeURIComponent(String(releaseIdOrName))}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'page', target }),
      }),
    );
  },
  async restoreSpec(releaseIdOrName: string | number): Promise<RestoreSpecResponse> {
    return handle<RestoreSpecResponse>(
      await apiFetch(`/api/releases/${encodeURIComponent(String(releaseIdOrName))}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'spec' }),
      }),
    );
  },
};
