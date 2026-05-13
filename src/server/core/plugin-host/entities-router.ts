import { Router } from 'express';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { EntityType } from '../../../shared/entities.js';
import { DomainError } from '../../services/tags.js';
import { errorHandler } from '../../routes/errors.js';
import { pluginHost } from './host.js';

/**
 * Resolve `(type, slug) → id` via the plugin host's runtime resolver registry.
 * Throws DomainError('NOT_FOUND') if the entity does not exist.
 */
function resolveEntityId(type: EntityType, slug: string): number {
  const id = pluginHost.resolveEntityId(type, slug);
  if (id == null) throw new DomainError('NOT_FOUND', `${type} '${slug}' not found`);
  return id;
}

/**
 * Validate that the `type` URL parameter names a known plugin (or the special
 * `section` non-entity type used by versioning). Throws on unknown types.
 */
function assertType(type: string): EntityType {
  if (type === 'section') return type;
  if (pluginHost.getAvailable(type)) return type as EntityType;
  throw new DomainError('VALIDATION', `unsupported entity type '${type}'`);
}

/**
 * Cross-cutting host-owned router for /api/entities/:type/:slug/...:
 *   - GET    versions, GET version detail
 *   - POST   tags assign
 * Lives under core/plugin-host/ because the URL spans all plugins; per-plugin
 * routes (CRUD) stay inside their own vertical slice.
 */
export function entitiesRouter(tags: TagsService, versions: VersionService): Router {
  const router = Router();

  router.get('/:type/:slug/versions', (req, res, next) => {
    try {
      const type = assertType(req.params.type);
      const id = resolveEntityId(type, req.params.slug);
      res.json({ versions: versions.listVersions(type, id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:type/:slug/versions/:version', (req, res, next) => {
    try {
      const type = assertType(req.params.type);
      const id = resolveEntityId(type, req.params.slug);
      const version = Number(req.params.version);
      const detail = versions.getVersion(type, id, version);
      if (!detail) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'version not found' } });
      res.json(detail);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:type/:slug/tags', (req, res, next) => {
    try {
      const type = assertType(req.params.type);
      const id = resolveEntityId(type, req.params.slug);
      const body = req.body as { tags?: string[] };
      if (!Array.isArray(body.tags)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'tags[] required' } });
      }
      const assigned = tags.assignTags(type, id, body.tags);
      res.json({ tags: assigned });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
