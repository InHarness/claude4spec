/**
 * Cross-cutting routes owned by the plugin host (M13). Currently exposes the
 * activation diagnostic endpoint. Phase 4 moves /api/entities/:type/:slug/versions
 * here too.
 */

import { Router } from 'express';
import type { PluginHost } from './types.js';

export function pluginHostRouter(host: PluginHost): Router {
  const router = Router();

  router.get('/_meta/entities', (_req, res) => {
    res.json(host.partition());
  });

  return router;
}
