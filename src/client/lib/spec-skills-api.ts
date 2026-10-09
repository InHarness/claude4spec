import { apiFetch, handle, unwrap } from './api-core.js';
import type { ExposedProjectRow, ForkWritingStyleRequest, ForkWritingStyleResponse } from '../../shared/spec-skills.js';

/**
 * M52 — client for `GET /api/spec-skills/exposed-projects` (operation
 * `list_exposed_projects`): the workspace's projects exposed as a skill, with the
 * status of this project's attachments, in `{ data }`.
 */
export const specSkillsApi = {
  async exposedProjects(): Promise<ExposedProjectRow[]> {
    return unwrap<ExposedProjectRow[]>(await apiFetch('/api/spec-skills/exposed-projects'));
  },
  /**
   * `POST /api/spec-skills/style-forks` (operation `fork_writing_style`): copy the
   * active plugin writing style into the project's `skills` root. 201 `{ slug, path }`;
   * a taken slug rejects with `ApiError` code `SKILL_ALREADY_EXISTS`.
   */
  async forkWritingStyle(slug: string): Promise<ForkWritingStyleResponse> {
    const body: ForkWritingStyleRequest = { slug };
    return handle<ForkWritingStyleResponse>(
      await apiFetch('/api/spec-skills/style-forks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  },
};

/** The react-query key of that list — invalidated after a save of `skill.uses`. */
export const EXPOSED_PROJECTS_QUERY_KEY = ['spec-skills', 'exposed-projects'] as const;
