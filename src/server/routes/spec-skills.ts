/**
 * L4 — M52 Spec Skills, own router mounted at `/api/spec-skills` (behind the
 * project prefix).
 *
 *   GET  /spec-skills/exposed-projects  → { data: ExposedProjectRow[] }
 *   POST /spec-skills/style-forks       → 201 ForkWritingStyleResponse
 *
 * The `rest` rendering of `list_exposed_projects` (sheet `katalog-operacji-m52`,
 * row 4): every project of the workspace exposed as a skill, plus every
 * `skill.uses` attachment of the current project, the dangling ones included.
 * Read-only; no error code of its own.
 *
 * `POST /style-forks` is the `rest` rendering of `fork_writing_style` (row 3):
 * body `ForkWritingStyleRequest` `{ slug }`, answer 201 `ForkWritingStyleResponse`
 * `{ slug, path }`; refusals through the shared error handler —
 * `SKILL_ALREADY_EXISTS` 409, `SKILL_NOT_FOUND` 404, `INVALID_ARGUMENT` 400.
 *
 *   GET  /spec-skills/hook-trust  → SpecSkillHookTrust
 *   PUT  /spec-skills/hook-trust  → SpecSkillHookTrust (body `{ trusted: boolean }`)
 *
 * 2.1.57 (M52 `ybbal0vf`, M31 `44viw74p`): the machine-local confirmation of the
 * attachments the project's committed config carries, read and set by the
 * `#skills` card. A non-boolean `trusted` is `INVALID_ARGUMENT` 400.
 * ASSUMPTION:dev-0002 — one confirmation for the whole attachment list.
 */

import express, { Router } from 'express';
import type {
  ExposedProjectRow,
  ForkWritingStyleRequest,
  ForkWritingStyleResponse,
  SpecSkillHookTrust,
} from '../../shared/spec-skills.js';
import { DomainError } from '../services/tags.js';
import { errorHandler } from './errors.js';

export interface SpecSkillsRouterDeps {
  /** The operation, bound to the current project (its id and its `skill.uses`, read per call). */
  listExposedProjects: () => ExposedProjectRow[];
  /** `fork_writing_style`, bound to the current project (its registry and its `skills` root). */
  forkWritingStyle?: (input: Partial<ForkWritingStyleRequest>) => Promise<ForkWritingStyleResponse>;
  /** The machine-local confirmation of the current project's committed attachments (ASSUMPTION:dev-0002). */
  hookTrust?: { get(): boolean; set(value: boolean): void };
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

  if (deps.forkWritingStyle) {
    const fork = deps.forkWritingStyle;
    router.post('/style-forks', express.json(), async (req, res, next) => {
      try {
        const body = (req.body ?? {}) as Partial<ForkWritingStyleRequest>;
        const created: ForkWritingStyleResponse = await fork({ slug: body.slug });
        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    });
  }

  if (deps.hookTrust) {
    const trust = deps.hookTrust;
    router.get('/hook-trust', (_req, res, next) => {
      try {
        const body: SpecSkillHookTrust = { trusted: trust.get() };
        res.json(body);
      } catch (err) {
        next(err);
      }
    });
    router.put('/hook-trust', express.json(), (req, res, next) => {
      try {
        const value = (req.body as Partial<SpecSkillHookTrust> | undefined)?.trusted;
        if (typeof value !== 'boolean') {
          throw new DomainError('INVALID_ARGUMENT', 'trusted must be a boolean');
        }
        trust.set(value);
        const body: SpecSkillHookTrust = { trusted: value };
        res.json(body);
      } catch (err) {
        next(err);
      }
    });
  }

  router.use(errorHandler);
  return router;
}
