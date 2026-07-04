/**
 * M34/L11: `referencesService` — read-only plugin-facing mirror of entity
 * referrers (owned by M19), fronting `GET /api/references` over
 * `src/core/references/`. Deliberately read-only: reference mutations stay
 * agent-only via Edit/Write. Re-exported through `@c4s/plugin-runtime`
 * alongside `useReferences` (`../hooks/useReferences.js`).
 */

import { referencesApi } from '../lib/api.js';
import type { EntityType, ReferenceHit } from '../../shared/entities.js';

export const referencesService = {
  findReferrers(type: EntityType, slug: string): Promise<ReferenceHit[]> {
    return referencesApi.find(type, slug);
  },
};

export type ReferencesServiceSingleton = typeof referencesService;
