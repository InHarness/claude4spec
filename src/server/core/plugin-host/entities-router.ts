import { Router } from 'express';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { EntityStore } from '../../services/entity-store.js';
import { isRawEntityType, type RawEntityReader } from '../../domain/raw-entity-reader.js';
import type { EntityCountsResponse } from '../../../shared/entities.js';
import type { EntityType } from '../../../shared/entities.js';
import { DomainError } from '../../services/tags.js';
import { errorHandler } from '../../routes/errors.js';
import type { ProjectPluginHost } from './types.js';

/**
 * M29: assert `(type, slug)` names an existing entity (slug is the sole
 * identity). Throws DomainError('NOT_FOUND') otherwise.
 */
function assertExists(host: ProjectPluginHost, type: EntityType, slug: string): void {
  if (!host.entityExists(type, slug)) {
    throw new DomainError('NOT_FOUND', `${type} '${slug}' not found`);
  }
}

/**
 * Validate that the `type` URL parameter names a known plugin (or the special
 * `section` non-entity type used by versioning). Throws on unknown types.
 */
function assertType(host: ProjectPluginHost, type: string): EntityType {
  if (type === 'section') return type;
  if (host.getAvailable(type)) return type as EntityType;
  throw new DomainError('VALIDATION', `unsupported entity type '${type}'`);
}

/**
 * Cross-cutting host-owned router for /api/entities/:type/:slug/...:
 *   - GET    versions, GET version detail
 *   - POST   version restore (M34/L11)
 *   - GET    entity tag slugs (M34/L11)
 *   - POST   tags assign
 *   - DELETE tags remove one (M34/L11)
 * Lives under core/plugin-host/ because the URL spans all plugins; per-plugin
 * routes (CRUD) stay inside their own vertical slice.
 */
export function entitiesRouter(host: ProjectPluginHost, tags: TagsService, versions: VersionService, store: EntityStore, reader: RawEntityReader): Router {
  const router = Router();

  // Aggregate per-type entity counts (cheap COUNT(*) per table). One round-trip
  // feeds the sidebar ELEMENTS badges, so a plain page view no longer pulls full
  // entity lists just to read their `.length`. Static `/counts` segment, declared
  // before `/:type/...` so it can never be captured as a `:type` param.
  router.get('/counts', (_req, res, next) => {
    try {
      const counts: EntityCountsResponse = {};
      for (const type of reader.listTypes()) counts[type] = reader.count(type);
      res.json(counts);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:type/:slug/versions', (req, res, next) => {
    try {
      const type = assertType(host, req.params.type);
      const slug = req.params.slug;
      assertExists(host, type, slug);
      res.json({ versions: versions.listVersions(type, slug) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:type/:slug/versions/:version', (req, res, next) => {
    try {
      const type = assertType(host, req.params.type);
      const slug = req.params.slug;
      assertExists(host, type, slug);
      const version = Number(req.params.version);
      const detail = versions.getVersion(type, slug, version);
      if (!detail) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'version not found' } });
      res.json(detail);
    } catch (err) {
      next(err);
    }
  });

  /**
   * M13/M34: version-to-version diff for the plugin-facing `useVersionDiff`
   * hook. `entity_version.data` is already the M17 snapshot (captured via
   * `host.snapshot` at write time), so it's fed straight into `host.diff`
   * unchanged — the same L9 `EntitySerializer.diff`/JSON-deep-diff-fallback
   * path `ReleaseService.getReleaseDiff` uses for release-to-release diffs.
   * Response shape matches `RawDeltaEntityChange` (shared/entities.ts).
   */
  router.get('/:type/:slug/versions/:from/diff/:to', (req, res, next) => {
    try {
      const type = assertType(host, req.params.type);
      const slug = req.params.slug;
      assertExists(host, type, slug);
      const from = versions.getVersion(type, slug, Number(req.params.from));
      const to = versions.getVersion(type, slug, Number(req.params.to));
      if (!from || !to) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'version not found' } });
      const diff = host.diff(type, from.data, to.data, slug);
      res.json({
        type: diff.type,
        slug: diff.slug,
        op: diff.op,
        ...(diff.changes ? { changes: diff.changes } : {}),
        ...(diff.raw ? { raw: diff.raw } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:type/:slug/versions/:version/restore', (req, res, next) => {
    try {
      const type = assertType(host, req.params.type);
      const slug = req.params.slug;
      assertExists(host, type, slug);
      if (!isRawEntityType(type)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: `type '${type}' is not restorable` } });
      }
      const version = Number(req.params.version);
      const restored = versions.restore(type, slug, version, 'user');
      res.json(restored);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:type/:slug/tags', (req, res, next) => {
    try {
      const type = assertType(host, req.params.type);
      const slug = req.params.slug;
      assertExists(host, type, slug);
      res.json({ tags: tags.getEntityTagSlugs(type, slug) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:type/:slug/tags', (req, res, next) => {
    try {
      const type = assertType(host, req.params.type);
      const slug = req.params.slug;
      assertExists(host, type, slug);
      const body = req.body as { tags?: string[] };
      if (!Array.isArray(body.tags)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'tags[] required' } });
      }
      const assigned = tags.assignTags(type, slug, body.tags);
      // M29: tag set changed → re-persist the entity file (its tags[]).
      if (isRawEntityType(type)) store.persist(type, slug);
      res.json({ tags: assigned });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:type/:slug/tags/:tagSlug', (req, res, next) => {
    try {
      const type = assertType(host, req.params.type);
      const slug = req.params.slug;
      assertExists(host, type, slug);
      const remaining = tags.removeEntityTag(type, slug, req.params.tagSlug);
      // M29: tag set changed → re-persist the entity file (its tags[]).
      if (isRawEntityType(type)) store.persist(type, slug);
      res.json({ tags: remaining });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
