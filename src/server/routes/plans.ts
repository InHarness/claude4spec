import { Router } from 'express';
import type { PlanExecuteMode } from '../../shared/entities.js';
import type { PlanService } from '../services/plan.js';
import { DomainError } from '../services/tags.js';

export function plansRouter(plan: PlanService): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : undefined;
      const offset = req.query.offset ? Math.max(0, Number(req.query.offset)) : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const result = plan.listPlans({ limit, offset, search });
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.get('/by-thread/:threadId', (req, res, next) => {
    try {
      const row = plan.getByThread(req.params.threadId);
      res.json({ data: row });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:planId', (req, res, next) => {
    try {
      const planId = Number(req.params.planId);
      if (!Number.isInteger(planId)) {
        throw new DomainError('VALIDATION', 'planId must be an integer');
      }
      const row = plan.getById(planId);
      const { versions, total } = plan.listVersions(planId);
      const threadCount = plan.threadCount(planId);
      const lastThreadId = plan.findLastThreadIdForPlan(planId);
      res.json({
        data: {
          ...row,
          versions,
          versionsTotal: total,
          threadCount,
          lastThreadId,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:planId/versions', (req, res, next) => {
    try {
      const planId = Number(req.params.planId);
      if (!Number.isInteger(planId)) {
        throw new DomainError('VALIDATION', 'planId must be an integer');
      }
      const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : undefined;
      const offset = req.query.offset ? Math.max(0, Number(req.query.offset)) : undefined;
      plan.getById(planId);
      const result = plan.listVersions(planId, { limit, offset });
      res.json({ data: result.versions, total: result.total });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:planId/versions/:version', (req, res, next) => {
    try {
      const planId = Number(req.params.planId);
      const version = Number(req.params.version);
      if (!Number.isInteger(planId) || !Number.isInteger(version)) {
        throw new DomainError('VALIDATION', 'planId and version must be integers');
      }
      const row = plan.getVersion(planId, version);
      res.json({ data: row });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:planId/blame', (req, res, next) => {
    try {
      const planId = Number(req.params.planId);
      if (!Number.isInteger(planId)) {
        throw new DomainError('VALIDATION', 'planId must be an integer');
      }
      const blocks = plan.blame(planId);
      res.json({ data: blocks });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:planId/last-thread', (req, res, next) => {
    try {
      const planId = Number(req.params.planId);
      if (!Number.isInteger(planId)) {
        throw new DomainError('VALIDATION', 'planId must be an integer');
      }
      plan.getById(planId);
      const threadId = plan.findLastThreadIdForPlan(planId);
      res.json({ data: { threadId } });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:planId', (req, res, next) => {
    try {
      const planId = Number(req.params.planId);
      if (!Number.isInteger(planId)) {
        throw new DomainError('VALIDATION', 'planId must be an integer');
      }
      const titleRaw = req.body?.title;
      if (typeof titleRaw !== 'string' && titleRaw !== null) {
        throw new DomainError('VALIDATION', 'title must be a string or null');
      }
      const updated = plan.updatePlanTitle(planId, titleRaw);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:planId', (req, res, next) => {
    try {
      const planId = Number(req.params.planId);
      if (!Number.isInteger(planId)) {
        throw new DomainError('VALIDATION', 'planId must be an integer');
      }
      const content = req.body?.content;
      if (typeof content !== 'string') {
        throw new DomainError('VALIDATION', 'content (string) required');
      }
      const changeSummary =
        typeof req.body?.changeSummary === 'string' ? req.body.changeSummary : 'User edit';
      const explicitThreadId =
        typeof req.body?.threadId === 'string' ? req.body.threadId : null;

      plan.getById(planId);
      const threadId = explicitThreadId ?? plan.findLastThreadIdForPlan(planId);
      if (!threadId) {
        throw new DomainError(
          'VALIDATION',
          'plan has no attached thread; cannot record user_edit (pass `threadId` in body)'
        );
      }

      const result = plan.update({
        threadId,
        action: 'user_edit',
        content,
        changeSummary,
        changedBy: 'user',
      });
      res.json({
        data: {
          plan: result.plan,
          version: result.version,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:planId/create-thread', (req, res, next) => {
    try {
      const planId = Number(req.params.planId);
      if (!Number.isInteger(planId)) {
        throw new DomainError('VALIDATION', 'planId must be an integer');
      }
      const result = plan.attachThreadToPlan(planId);
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:planId/execute', (req, res, next) => {
    try {
      const planId = Number(req.params.planId);
      if (!Number.isInteger(planId)) {
        throw new DomainError('VALIDATION', 'planId must be an integer');
      }
      const mode = req.body?.mode as PlanExecuteMode | undefined;
      if (mode !== 'new-session' && mode !== 'continue') {
        throw new DomainError(
          'VALIDATION',
          "mode must be 'new-session' or 'continue'"
        );
      }
      const threadId =
        typeof req.body?.threadId === 'string' ? req.body.threadId : undefined;
      const result = plan.execute(planId, mode, { threadId });
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
