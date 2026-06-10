import { Router } from 'express';
import type { ReferencesService } from '../services/references.js';
import type { EntityType } from '../../shared/entities.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { errorHandler } from './errors.js';

/**
 * Validate `type` URL param against the plugin host registry; `section` is
 * accepted as a special non-entity case used by the references service.
 */
function assertType(host: ProjectPluginHost, type: string): EntityType {
  if (type === 'section') return type;
  if (host.getAvailable(type)) return type as EntityType;
  throw new Error(`unsupported entity type '${type}'`);
}

export function referencesRouter(host: ProjectPluginHost, references: ReferencesService): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const type = typeof req.query.type === 'string' ? assertType(host, req.query.type) : null;
      const slug = typeof req.query.slug === 'string' ? req.query.slug : null;
      if (!type || !slug) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'type and slug query params required' } });
      }
      const hits = await references.findReferences(type, slug);
      res.json({ references: hits });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
