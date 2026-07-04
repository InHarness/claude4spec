/**
 * M34/L11: `versionService` — read-only plugin-facing mirror of the host's
 * entity versioning endpoints (owned by M13). Re-exported through
 * `@c4s/plugin-runtime` alongside `useVersions`/`useVersionDetail`/
 * `useRestoreVersion` (`../hooks/useVersions.js`), all bound to the host's
 * single shared `queryClient` — this object is a thin fetch wrapper, not a
 * second data layer.
 */

import { versionsApi } from '../lib/api.js';
import type { EntityType, VersionDetail, VersionListItem } from '../../shared/entities.js';

export const versionService = {
  listVersions(type: EntityType, slug: string): Promise<VersionListItem[]> {
    return versionsApi.list(type, slug);
  },
  getVersion(type: EntityType, slug: string, version: number): Promise<VersionDetail> {
    return versionsApi.get(type, slug, version);
  },
  restore(type: EntityType, slug: string, version: number): Promise<VersionListItem> {
    return versionsApi.restore(type, slug, version);
  },
};

export type VersionServiceSingleton = typeof versionService;
