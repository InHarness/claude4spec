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
 *   PUT  /spec-skills/uses-confirmation → 200 { data: SkillUsesConfirmationResponse }
 *
 * 2.1.67 (M52 `uluzymnm`, `qtq9iusb`; endpoint `put-api-spec-skills-uses-confirmation`):
 * the machine-local confirmation of the project's attachment NAMES. Body
 * `SkillUsesConfirmationRequest` `{ names }` replaces the stored list whole
 * (`[]` withdraws all); the write delegates to M31's `setSkillUsesConfirmation`
 * (the registry record, never the repository). Names the project's `skill.uses`
 * does not carry are accepted and returned apart (`notInSkillUses`). `names` not
 * an array of strings in the `skill.name` syntax is `INVALID_ARGUMENT` 400.
 */

import express, { Router } from 'express';
import type {
  ExposedProjectRow,
  ForkWritingStyleRequest,
  ForkWritingStyleResponse,
  SkillUsesConfirmationRequest,
  SkillUsesConfirmationResponse,
} from '../../shared/spec-skills.js';
import { SkillNameSyntaxError } from '../services/skill-name.js';
import { DomainError } from '../services/tags.js';
import { errorHandler } from './errors.js';

export interface SpecSkillsRouterDeps {
  /** The operation, bound to the current project (its id and its `skill.uses`, read per call). */
  listExposedProjects: () => ExposedProjectRow[];
  /** `fork_writing_style`, bound to the current project (its registry and its `skills` root). */
  forkWritingStyle?: (input: Partial<ForkWritingStyleRequest>) => Promise<ForkWritingStyleResponse>;
  /**
   * 2.1.67: write the current project's confirmed attachment names
   * (M31 `setSkillUsesConfirmation`, bound to this project and its workspace).
   */
  confirmSkillUses?: (names: string[]) => SkillUsesConfirmationResponse;
}

/** The request DTO's rule: `names` is an array of strings (their syntax: the core's). */
function parseConfirmationRequest(body: unknown): SkillUsesConfirmationRequest {
  const names = (body as Partial<SkillUsesConfirmationRequest> | undefined)?.names;
  if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) {
    throw new DomainError('INVALID_ARGUMENT', 'names must be an array of skill names');
  }
  // The `skill.name` syntax of each name is the core's check (M31 `naxqsfra`,
  // 2.1.69): `setSkillUsesConfirmation` refuses the whole write with
  // `SkillNameSyntaxError`, which this channel reports as `INVALID_ARGUMENT`.
  return { names: names as string[] };
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

  if (deps.confirmSkillUses) {
    const confirm = deps.confirmSkillUses;
    router.put('/uses-confirmation', express.json(), (req, res, next) => {
      try {
        const { names } = parseConfirmationRequest(req.body);
        let result: SkillUsesConfirmationResponse;
        try {
          result = confirm(names);
        } catch (err) {
          if (err instanceof SkillNameSyntaxError) throw new DomainError('INVALID_ARGUMENT', err.message);
          throw err;
        }
        const data: SkillUsesConfirmationResponse = {
          confirmedSkillUses: result.confirmedSkillUses,
          notInSkillUses: result.notInSkillUses,
        };
        res.json({ data });
      } catch (err) {
        next(err);
      }
    });
  }

  router.use(errorHandler);
  return router;
}
