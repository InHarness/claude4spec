import { Router } from 'express';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { EntityStore } from '../../services/entity-store.js';
import { isRawEntityType, type RawEntityReader } from '../../discovery/raw-entity-reader.js';
import type { EntityCountsResponse } from '../../../shared/entities.js';
import type { EntityType } from '../../../shared/entities.js';
import { DomainError } from '../../services/tags.js';
import { errorHandler } from '../../routes/errors.js';
import type { ProjectPluginHost } from './types.js';
import type { DiscoveryCore } from '../../discovery/types.js';
import { payloadVersionOfCapture, samePayloadVersion } from '../../serialization/payload-version.js';
import { upgradeCapture } from '../../serialization/payload-upgrade.js';
import { toRawDeltaEntityChange } from '../../serialization/snapshot.js';

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
export function entitiesRouter(host: ProjectPluginHost, tags: TagsService, versions: VersionService, store: EntityStore, reader: RawEntityReader, discovery: DiscoveryCore): Router {
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

  /**
   * M39 L2 over HTTP (item 18) — the generic read surface for a keyed
   * collection, per type, per collection.
   *
   * Host-owned and cross-cutting, which is why it lives on this router rather
   * than under a type's own `pathPrefix`: the shape is derived entirely from
   * `data.schema`, so a type that declares a keyed collection gets these two
   * routes without contributing a line of routing — the same bargain the
   * projection and the write path already make.
   *
   * READ-ONLY, deliberately. Writes are domain mutations that stamp the parent
   * and capture a version (items 21–22), and they belong on the write path where
   * every other mutation is; a REST verb that quietly did that would be a second
   * write door with none of the guarantees.
   *
   * Errors come from the discovery core's catalogue rather than being re-derived
   * here — `entityNotFound` and `invalidArgument` already carry the navigation
   * ("known slugs", "the call that would have worked"), and re-phrasing them at
   * the transport is how two surfaces start disagreeing about the same refusal.
   */
  router.get('/:type/:slug/collections/:field/overview', (req, res, next) => {
    try {
      res.json(
        discovery.collectionOverview({
          type: assertType(host, req.params.type),
          slug: req.params.slug,
          field: req.params.field,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.get('/:type/:slug/collections/:field/window', (req, res, next) => {
    try {
      // `Number(undefined)` is NaN and `Number('')` is 0 — both fail the core's
      // integer check, which is where the message with the corrected call lives.
      const coord = (raw: unknown): number => Number(raw ?? NaN);
      res.json(
        discovery.collectionWindow({
          type: assertType(host, req.params.type),
          slug: req.params.slug,
          field: req.params.field,
          a1: coord(req.query.a1),
          b1: coord(req.query.b1),
          a2: coord(req.query.a2),
          b2: coord(req.query.b2),
        }),
      );
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
   * Response is shaped by the same `toRawDeltaEntityChange` helper release
   * diffing uses, including the `_serializerVersionMismatch` flag when the
   * two captured versions span a serializer upgrade.
   */
  router.get('/:type/:slug/versions/:from/diff/:to', (req, res, next) => {
    try {
      const type = assertType(host, req.params.type);
      const slug = req.params.slug;
      assertExists(host, type, slug);
      const from = versions.getVersion(type, slug, Number(req.params.from));
      const to = versions.getVersion(type, slug, Number(req.params.to));
      if (!from || !to) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'version not found' } });
      const fromVer = from.serializerVersion ?? null;
      const toVer = to.serializerVersion ?? null;
      /**
       * 0.2.9 — both captures are brought to the CURRENT payload shape first.
       *
       * The fourth reader of `entity_version.data`, and the one a review found
       * had been missed: `ReleaseService` (restore and diff) and `VersionService`
       * all upgrade their captures, this route fed raw ones straight to
       * `host.diff`. Two captures either side of a `payloadVersion` bump describe
       * the same entity in different spellings, so the diff reported edits nobody
       * made — and `samePayloadVersion` below deliberately suppresses the
       * "schema bump" badge across the vocabulary change, so nothing on screen
       * explained where they came from.
       *
       * Degrades to the raw payload on failure rather than 500ing: this is a
       * read, and a diff computed on the old shape is still more useful than an
       * error page. The WRITE side makes the opposite call for the same reason.
       */
      const module = host.getEntity(type);
      const fromData = upgradeCapture(module, from.data, payloadVersionOfCapture(fromVer)).data;
      const toData = upgradeCapture(module, to.data, payloadVersionOfCapture(toVer)).data;
      const diff = host.diff(type, fromData, toData, slug);
      // 0.2.9: compared as PAYLOAD VERSIONS, not as strings. The column changed
      // vocabulary (semver → integer `payloadVersion`) without migrating old
      // rows, so a raw comparison flags a bump on every diff that spans the
      // upgrade. See `serialization/payload-version.ts`.
      res.json(
        toRawDeltaEntityChange(
          diff,
          samePayloadVersion(fromVer, toVer) ? null : { type, from: fromVer, to: toVer }
        )
      );
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
