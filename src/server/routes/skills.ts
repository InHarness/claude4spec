/**
 * L4 — the `rest` rendering of the M37 skills registry: `list_skills` and
 * `load_skill_file` (0.2.99).
 *
 *   GET /skills          ?contextType   → SkillListingResponse
 *   GET /skills/:slug    ?file          → SkillPackageResponse
 *
 * `file` is a QUERY parameter, never a wildcard route segment. A subfile's
 * address is the pair (skill name, file in the registry), not a disk path, and a
 * wildcard segment would invite the router to normalize `..` and absolute paths
 * on its own — splitting the validation the operation already performs.
 *
 * Thin on purpose, like `meta.ts`: parse the query, call the core, return what it
 * got. No error taxonomy of its own — `DomainError` codes map through
 * `routes/errors.ts`, and `truncated`/`truncationHint` pass through untouched
 * (REST is not exempt from signalling truncation). No request DTO, no error DTO.
 * The active writing style is reported by slug only; its selection metadata is
 * `GET /writing-styles`, which never serves content.
 */

import { Router } from 'express';
import { listSkills, loadSkillFile } from '../services/skill-operations.js';
import type { SkillRegistry, SkillResolver } from '../services/skill-registry.js';
import { errorHandler } from './errors.js';

export interface SkillsRouterDeps {
  skillRegistry: SkillRegistry;
  skillResolver: SkillResolver;
}

/** A repeated query param (`?file=a&file=b`) is not a string; hand the core what it can refuse. */
function queryString(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  return typeof raw === 'string' ? raw : String(raw);
}

export function skillsRouter(deps: SkillsRouterDeps): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      res.json(listSkills(deps.skillResolver, queryString(req.query.contextType)));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:slug', (req, res, next) => {
    try {
      res.json(loadSkillFile(deps.skillRegistry, req.params.slug, queryString(req.query.file)));
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
