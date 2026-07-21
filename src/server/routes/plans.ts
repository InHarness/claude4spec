import { Router } from 'express';
import type { PlanService } from '../services/plan.js';

/**
 * 0.1.127 M10: plan CRUD/versioning/blame moved to the generic
 * `/api/artifacts/plan/*` family (routes/artifacts.ts) — `GET /api/plans`,
 * `GET/PUT/PATCH /api/plans/:planId`, `GET /api/plans/:planId/versions[/:version]`,
 * `GET /api/plans/:planId/blame` are all GONE. What stays here is plan's
 * bespoke thread-binding behavior (`binding.mode: 'attach'`), re-pathed
 * `:planId` (integer) → `:slug` (string, the file path relative to plansDir):
 * `create-thread` carries `initialMessage` semantics the generic
 * `POST .../threads` doesn't, and `last-thread`/`by-thread`/`by-anchor`/
 * `threads` are plan-specific queries with no generic-family equivalent.
 *
 * 0.1.138: `POST /:slug/execute` (modes `new-session`/`continue`) is GONE —
 * running a plan is now a pure chat workflow: `create-thread` attaches the
 * plan, and the execution prompt lives client-side as an editable composer
 * draft the user sends themselves (no server-generated `firstMessage`, no
 * server-side `plan_mode` toggle).
 */
export function plansRouter(plan: PlanService): Router {
  const router = Router();

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

  router.get('/:slug/threads', (req, res, next) => {
    try {
      res.json({ data: plan.listThreadsForPlan(req.params.slug) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:slug/last-thread', (req, res, next) => {
    try {
      const threadId = plan.findLastThreadIdForPlan(req.params.slug);
      res.json({ data: { threadId } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:slug/create-thread', async (req, res, next) => {
    try {
      const result = await plan.attachThreadToPlan(req.params.slug);
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
