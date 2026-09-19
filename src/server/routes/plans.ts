import { Router } from 'express';
import type { PlanService } from '../services/plan.js';
import type { PlanCreateRequest, PlanResponse } from '../../shared/entities.js';
import { DomainError } from '../services/tags.js';

/**
 * 0.1.127 M10: plan CRUD/versioning/blame moved to the generic
 * `/api/artifacts/plan/*` family (routes/artifacts.ts) — `GET /api/plans`,
 * `GET/PUT/PATCH /api/plans/:planId`, `GET /api/plans/:planId/versions[/:version]`,
 * `GET /api/plans/:planId/blame` are all GONE. What stays here is plan's
 * bespoke thread-binding behavior (`binding.mode: 'attach'`):
 * `create-thread` attaches the plan by `plan_path` (the generic
 * `POST .../threads` has no such binding), and `last-thread`/`by-thread`/
 * `by-anchor` are plan-specific queries with no generic-family equivalent.
 * Note `CreateThreadFromPlanRequest.initialMessage` is part of the documented
 * wire shape but is deliberately NOT acted on here — the backend sends no
 * message on the caller's behalf.
 *
 * 0.2.13: the path parameter of `last-thread`/`create-thread` is spelled
 * `:planId` again. It is NOT the old integer id — the VALUE is unchanged, still
 * the plan file's path relative to `plansDir`. Only the parameter's NAME
 * changed, so no URL and no caller moved; `:planId` is simply what L4 calls a
 * plan's identifier now that "the id of a plan" means its path, and the two
 * routes had been the last places still calling it `:slug`.
 *
 * 0.1.139: `GET /:slug/threads` is GONE — listing an artifact's threads is now
 * generic (`GET /api/artifacts/plan/:path/threads`, one query for brief/patch/
 * plan alike). `last-thread` stays: it is a single-row shortcut, not a listing.
 *
 * 0.1.138: `POST /:slug/execute` (modes `new-session`/`continue`) is GONE —
 * running a plan is now a pure chat workflow: `create-thread` attaches the
 * plan, and the execution prompt lives client-side as an editable composer
 * draft the user sends themselves (no server-generated `firstMessage`, no
 * server-side `plan_mode` toggle).
 */
export function plansRouter(plan: PlanService): Router {
  const router = Router();

  /**
   * 0.2.98 — `create_plan` over REST. Slice-specific ON PURPOSE rather than a
   * `POST /api/artifacts/plan`: that family reads and writes an artifact that
   * already exists, and teaching it to found one would change it for every
   * kind. No `threadId` in the body — the carrier thread is founded here too.
   *
   * Only the TYPES are checked in the route; the blank-title / blank-content
   * refusals live in `PlanService.create`, next to the write they guard.
   */
  router.post('/', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Partial<Record<keyof PlanCreateRequest, unknown>>;
      if (typeof body.title !== 'string') {
        throw new DomainError('INVALID_ARGUMENT', 'title is required and must be a string');
      }
      if (body.content !== undefined && typeof body.content !== 'string') {
        throw new DomainError('INVALID_ARGUMENT', 'content must be a string');
      }
      const result = await plan.create({
        title: body.title,
        ...(body.content !== undefined ? { content: body.content as string } : {}),
        changedBy: 'user',
      });
      const data: PlanResponse = result;
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/by-thread/:threadId', async (req, res, next) => {
    try {
      const row = await plan.getByThread(req.params.threadId);
      res.json({ data: row });
    } catch (err) {
      next(err);
    }
  });

  // Resolve a plan heading anchor to its plan, mirroring GET /api/sections/:anchor.
  // Returns the raw { planPath, threadId } (no data envelope) or 404, so the client
  // chip can fall back from a page-section miss to a plan lookup.
  router.get('/by-anchor/:anchor', async (req, res, next) => {
    try {
      const row = await plan.getByAnchor(req.params.anchor);
      if (!row)
        return res
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'plan anchor not found' } });
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:planId/last-thread', (req, res, next) => {
    try {
      const threadId = plan.findLastThreadIdForPlan(req.params.planId);
      res.json({ data: { threadId } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:planId/create-thread', async (req, res, next) => {
    try {
      const result = await plan.attachThreadToPlan(req.params.planId);
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
