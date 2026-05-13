import type {
  RawDelta,
  Release,
  ReleaseDetail,
  SpecSnapshot,
} from '../../shared/entities.js';
import { handle } from './api-core.js';

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
    const data = await handle<{ releases: Release[] }>(await fetch('/api/releases'));
    return data.releases;
  },
  async create(input: { name: string; description: string }): Promise<ReleaseDetail> {
    return handle<ReleaseDetail>(
      await fetch('/api/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },
  async update(
    idOrName: string | number,
    input: { name?: string; description?: string; assignUnreleased?: boolean },
  ): Promise<ReleaseDetail> {
    return handle<ReleaseDetail>(
      await fetch(`/api/releases/${encodeURIComponent(String(idOrName))}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },
  async get(idOrName: string | number): Promise<ReleaseDetail> {
    return handle<ReleaseDetail>(
      await fetch(`/api/releases/${encodeURIComponent(String(idOrName))}`),
    );
  },
  async snapshot(idOrName: string | number): Promise<SpecSnapshot> {
    return handle<SpecSnapshot>(
      await fetch(`/api/releases/${encodeURIComponent(String(idOrName))}/snapshot`),
    );
  },
  async diff(from: string | number | null, to: string | number): Promise<RawDelta> {
    const fromSegment = from === null ? '__INITIAL__' : encodeURIComponent(String(from));
    return handle<RawDelta>(
      await fetch(
        `/api/releases/${fromSegment}/diff/${encodeURIComponent(String(to))}`,
      ),
    );
  },
  async restoreEntity(
    releaseIdOrName: string | number,
    target: { type: string; slug: string },
  ): Promise<RestoreEntityResponse> {
    return handle<RestoreEntityResponse>(
      await fetch(`/api/releases/${encodeURIComponent(String(releaseIdOrName))}/restore`, {
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
      await fetch(`/api/releases/${encodeURIComponent(String(releaseIdOrName))}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'page', target }),
      }),
    );
  },
  async restoreSpec(releaseIdOrName: string | number): Promise<RestoreSpecResponse> {
    return handle<RestoreSpecResponse>(
      await fetch(`/api/releases/${encodeURIComponent(String(releaseIdOrName))}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'spec' }),
      }),
    );
  },
};
