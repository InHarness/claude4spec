/**
 * M17/L11: `releasesService` — READ-ONLY plugin-facing mirror of the host's
 * release labels, fronting the backend `releaseService.listReleases()`.
 * Re-exported through `@c4s/plugin-runtime` alongside `useReleases`
 * (`../hooks/useReleases.js`), which binds it to the host's single shared
 * `queryClient` — this object is a thin fetch wrapper, not a second data layer.
 *
 * Deliberately read-only: a plugin never creates, updates or assigns releases.
 * The write side (`createRelease` / `updateRelease` / restore-to-release) stays
 * in M17 behind the host's MCP / REST / UI. For the same reason the backend
 * `releaseService` is NOT added to the plugin `MountContext`.
 */

import { releasesApi } from '../lib/releases-api.js';
import type { Release } from '../../shared/entities.js';

export const releasesService = {
  listReleases(): Promise<Release[]> {
    return releasesApi.list();
  },
};

export type ReleasesServiceSingleton = typeof releasesService;
