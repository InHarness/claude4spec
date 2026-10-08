import { handle, apiFetch } from './api-core.js';

/**
 * M37 / M52 — client for `GET /api/skills?contextType=…` (the skill listing of
 * one context type, `SkillListingResponse` on the server). The browser reads
 * only the listing: the `spec-skills` command source lists its rows and
 * `SkillRefChip` checks a slug against them.
 */

/** Where the winning entry of a slug comes from (`SkillSource` on the server). */
export type SkillOrigin = 'user' | 'plugin' | 'project-rooted' | 'project-exposed';

export interface SkillListingRow {
  slug: string;
  description: string;
  origin: SkillOrigin;
  /** The provider project's registry id — only beside `origin: 'project-exposed'`. */
  project?: string;
}

export interface SkillListing {
  listing: SkillListingRow[];
  writingStyle: { slug: string; title: string } | null;
}

export const skillsApi = {
  async listForContext(contextType: string): Promise<SkillListing> {
    return handle<SkillListing>(await apiFetch(`/api/skills?contextType=${encodeURIComponent(contextType)}`));
  },
};
