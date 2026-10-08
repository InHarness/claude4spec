import { apiFetch, unwrap } from './api-core.js';
import type { ExposedProjectRow } from '../../shared/spec-skills.js';

/**
 * M52 — client for `GET /api/spec-skills/exposed-projects` (operation
 * `list_exposed_projects`): the workspace's projects exposed as a skill, with the
 * status of this project's attachments, in `{ data }`.
 */
export const specSkillsApi = {
  async exposedProjects(): Promise<ExposedProjectRow[]> {
    return unwrap<ExposedProjectRow[]>(await apiFetch('/api/spec-skills/exposed-projects'));
  },
};

/** The react-query key of that list — invalidated after a save of `skill.uses`. */
export const EXPOSED_PROJECTS_QUERY_KEY = ['spec-skills', 'exposed-projects'] as const;
