import { Router } from 'express';
import type { AgentCredentialService } from '../services/agent-credential.js';
import { errorHandler } from './errors.js';

/**
 * M05 — `/api/agent/credentials`: the user's own ANTHROPIC API key. Write-only API
 * (GET/PUT/DELETE return only `{ isSet, last4 }`, never the raw key). The Settings →
 * Agent section (M26) is the only consumer. There is no toggle: a stored key always
 * wins over the local Claude Code login; clearing it restores the local login.
 */
export function agentRouter(credentials: AgentCredentialService): Router {
  const router = Router();

  // GET /api/agent/credentials — key state for the Agent section.
  router.get('/credentials', (_req, res, next) => {
    try {
      res.json(credentials.getStatus());
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/agent/credentials — set/replace the key. `set` throws
  // DomainError('VALIDATION') (→ 400, shown inline) on empty / bad prefix.
  router.put('/credentials', (req, res, next) => {
    try {
      const rawKey = typeof req.body?.anthropicApiKey === 'string' ? req.body.anthropicApiKey : '';
      res.json(credentials.set(rawKey));
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/agent/credentials — back to the local login. Idempotent.
  router.delete('/credentials', (_req, res, next) => {
    try {
      res.json(credentials.clear());
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
