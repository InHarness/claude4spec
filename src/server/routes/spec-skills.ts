/**
 * L4 — M52 Spec Skills, own router mounted at `/api/spec-skills` (behind the
 * project prefix).
 *
 *   GET /spec-skills/exposed-projects   → { data: ExposedProjectRow[] }
 *
 * The `rest` rendering of `list_exposed_projects` (sheet `katalog-operacji-m52`,
 * row 4): every project of the workspace exposed as a skill, plus every
 * `skill.uses` attachment of the current project, the dangling ones included.
 * Read-only; no error code of its own. `POST /spec-skills/style-forks` belongs to
 * the writing-style fork and is not built here.
 */

import { Router } from 'express';
import type { ExposedProjectRow } from '../../shared/spec-skills.js';
import { errorHandler } from './errors.js';

export interface SpecSkillsRouterDeps {
  /** The operation, bound to the current project (its id and its `skill.uses`, read per call). */
  listExposedProjects: () => ExposedProjectRow[];
}

export function specSkillsRouter(deps: SpecSkillsRouterDeps): Router {
  const router = Router();

  router.get('/exposed-projects', (_req, res, next) => {
    try {
      res.json({ data: deps.listExposedProjects() });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
