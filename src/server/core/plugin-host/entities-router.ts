import { Router, type RequestHandler } from 'express';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { EntityStore } from '../../services/entity-store.js';
import { type RawEntityReader } from '../../discovery/raw-entity-reader.js';
import type { EntityCountsResponse } from '../../../shared/entities.js';
import type { EntityType } from '../../../shared/entities.js';
import { z } from 'zod';
import { DomainError } from '../../services/tags.js';
import { invalidType } from '../../discovery/errors.js';
import { httpStatusForCode } from '../../operations/error-codes.js';
import { errorHandler } from '../../routes/errors.js';
import { commaList, nonNegativeInt, positiveInt } from '../../routes/query-params.js';
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
 * 0.2.13 — the type guard for the CATALOG routes below (`/:type/search`,
 * `/:type/tools`), distinct from `assertType` above on two counts that matter.
 *
 * It demands an ACTIVE type, not merely an available one: a type switched off
 * for this project has no operations, and answering as if it did would make it
 * look half-alive. And it refuses with `INVALID_TYPE` carrying the active list,
 * which is the code the same refusal already uses in the MCP and CLI channels —
 * a catalog operation must not answer differently depending on how it was
 * reached.
 *
 * `assertType` keeps its own contract: the version/tag/collection routes it
 * guards accept the non-entity `section` pseudo-type and have answered
 * `VALIDATION` since before the catalog existed.
 */
function assertActiveType(host: ProjectPluginHost, type: string): EntityType {
  if (host.isActive(type)) return type as EntityType;
  throw invalidType(
    type,
    host.listEntities().map((m) => m.type),
  );
}


/**
 * Project a zod RAW SHAPE into JSON Schema for the tool listing.
 *
 * `z.toJSONSchema` is a zod v4 walker over each node's internal `.def`, so it
 * only works on schemas built with the HOST's zod — which is exactly what the
 * `@c4s/plugin-runtime` facade's re-exported `z` guarantees. A plugin that
 * bundled its own zod throws here instead of walking; that is a real
 * misconfiguration, but it must not turn a request for a NAME LIST into a 500.
 * The tool still lists, with its schema reported as absent.
 */
function toJsonSchema(shape: unknown): unknown {
  try {
    return z.toJSONSchema(z.object(shape as z.ZodRawShape), { io: 'input' });
  } catch {
    return undefined;
  }
}

/**
 * Pull `{ code, message }` out of a failed MCP tool envelope.
 *
 * The payload is a JSON string inside a text block, and the shape of what tools
 * put there is not uniform — `entity-tools` writes `{error:{code,message}}`
 * while the `operations/envelope.ts` helper writes `{error,code}`. Both are read
 * here rather than one being declared correct, because a transport that lost the
 * code on the spelling it did not expect would answer 500 for a refusal that
 * named itself perfectly well.
 */
function decodeToolFailure(result: unknown): { code: string; message: string } {
  const text = (result as { content?: Array<{ text?: unknown }> } | null)?.content?.[0]?.text;
  if (typeof text === 'string') {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const nested = parsed.error as { code?: unknown; message?: unknown } | undefined;
      if (nested && typeof nested === 'object') {
        return {
          code: typeof nested.code === 'string' ? nested.code : 'INTERNAL',
          message: typeof nested.message === 'string' ? nested.message : text,
        };
      }
      if (typeof parsed.code === 'string') {
        return { code: parsed.code, message: typeof parsed.error === 'string' ? parsed.error : text };
      }
    } catch {
      /* not JSON — fall through to the opaque form below */
    }
  }
  // The tool said it failed but not why in any shape we recognise. Reporting
  // INTERNAL is honest: the caller learns the operation failed, which is the part
  // that was being lost.
  return { code: 'INTERNAL', message: typeof text === 'string' ? text : 'tool reported an error' };
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
   * 0.2.13 — the `rest` rendering of the `search_entities` core operation.
   *
   * NOT a duplicate of `?search=` on the entity list route. That one stays what
   * it is: a filter on a UI list, defaulting to a page size chosen for list
   * pages and returning the projection those pages render. This is the CATALOG
   * operation — the core's own paging, response budget and sort determinism,
   * reachable identically from all four channels.
   *
   * `searchedFields` is part of the answer, not a debugging extra: without it an
   * empty result cannot be told apart from a field that was never searched, and
   * those two call for opposite next moves by the caller.
   *
   * Registered above `/:type/:slug/...` — `/:type/search` is two segments and
   * cannot be captured by them — and after the static `/counts`.
   */
  router.get('/:type/search', (req, res, next) => {
    try {
      const type = assertActiveType(host, req.params.type);
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = positiveInt(req.query.limit);
      // `offset` is read with the non-negative parser: 0 is a legitimate offset
      // and a meaningless limit, and the exhaustive sweeps page from 0.
      const offset = nonNegativeInt(req.query.offset);
      /**
       * 0.2.13 (tier C) — `fields` and `mode` joined the wire.
       *
       * The core has taken both since M39 and this route took neither, which
       * only stopped mattering when `c4s search-entities` started delegating
       * here: it has spelled them `--fields` and `--mode` since 0.2.6, so the
       * two channels would have answered differently for the same call —
       * `--mode count` paying for a full listing, `--fields` searching
       * everything. Dropping a narrowing silently is the failure this release
       * exists to end.
       */
      const fields = commaList(req.query.fields);
      const mode = req.query.mode === 'count' ? 'count' : req.query.mode === 'hits' ? 'hits' : undefined;
      const result = discovery.searchEntities({
        type,
        query: q,
        ...(fields ? { fields } : {}),
        ...(mode ? { mode } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {}),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * 0.2.13 (tier C) — the `rest` rendering of `list_entities`.
   *
   * NOT the entity list route the UI calls. `generatedCrudRouter` answers
   * `GET /api/<type>` with the projection a list page renders and a page size
   * chosen for it; this is the CATALOG operation, with the core's own `mode`,
   * paging and sort determinism, identical in all four channels. The row is
   * frozen to `{ slug, title }` — there is no width parameter to pass on.
   *
   * `filters`/`applyDefaultPredicate` are deliberately NOT on the wire here.
   * The first is a nested object with no settled query-string spelling, and the
   * second is opt-in precisely so that "who is asking" stays visible at the call
   * site — a transport that turned it on by URL would erase that. Neither is
   * reachable from the `cli` channel either, so the two stay in step.
   */
  router.get('/:type/list', (req, res, next) => {
    try {
      const type = assertActiveType(host, req.params.type);
      const tags = commaList(req.query.tags);
      // 0.2.22 — `tagFilter`, the spelling every other surface already used.
      const tagFilter =
        req.query.tagFilter === 'and' ? 'and' : req.query.tagFilter === 'or' ? 'or' : undefined;
      const sort =
        req.query.sort === 'title' ? 'title' : req.query.sort === 'slug' ? 'slug' : req.query.sort === 'createdAt' ? 'createdAt' : undefined;
      const dir = req.query.dir === 'desc' ? 'desc' : req.query.dir === 'asc' ? 'asc' : undefined;
      const mode = req.query.mode === 'count' ? 'count' : req.query.mode === 'items' ? 'items' : undefined;
      const limit = positiveInt(req.query.limit);
      const offset = nonNegativeInt(req.query.offset);
      res.json(
        discovery.listEntities({
          type,
          ...(tags ? { tags } : {}),
          ...(tagFilter ? { tagFilter } : {}),
          ...(sort ? { sort } : {}),
          ...(dir ? { dir } : {}),
          ...(mode ? { mode } : {}),
          ...(limit !== undefined ? { limit } : {}),
          ...(offset !== undefined ? { offset } : {}),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  /**
   * 0.2.13 (tier C) — the `rest` rendering of `get_entities`: fetch by key,
   * several slugs in one call, width chosen by `select`.
   *
   * Takes no `limit`/`offset` — the caller already named the rows, so the valve
   * is the input length plus the core's response budget, not a window. A slug
   * that names nothing comes back as a null row inside the result rather than as
   * an error, because the other slugs in the call are real answers.
   */
  router.get('/:type/get', (req, res, next) => {
    try {
      const type = assertActiveType(host, req.params.type);
      const slugs = commaList(req.query.slugs);
      if (!slugs || slugs.length === 0) {
        throw new DomainError('VALIDATION', 'slugs query param required (comma-separated)');
      }
      // 0.2.22 — `view` off the wire, `select` on it. Absent means the full
      // record minus content-bearing fields; an empty `select=` means the
      // identity skeleton, which is why this distinguishes the two rather than
      // folding an empty string into `undefined`.
      const select = typeof req.query.select === 'string' ? commaList(req.query.select) ?? [] : undefined;
      res.json(discovery.getEntities({ type, slugs, ...(select ? { select } : {}) }));
    } catch (err) {
      next(err);
    }
  });

  /**
   * 0.2.13 — the generic host proxy (M13), giving a type's non-CRUD operations a
   * `rest` rendering without the plugin contributing a router.
   *
   * ONE DECLARATION, THREE RENDERINGS. A plugin declares a type-specific
   * operation once, as a tool in its `backend.mcpServer` slot. The host is
   * responsible for exposing it in every channel — so these two routes read the
   * SAME registry the MCP servers are mounted from (`host.listTypeTools`, over
   * the very map `buildMcpServers()` iterates). They cannot drift from it, and
   * deactivating a type removes its operations from all renderings at once.
   *
   * Read-only listing. Names, LLM-facing descriptions and input schemas, in the
   * same form the agent sees them in the tool channel.
   *
   * A type with no custom operations answers with an EMPTY LIST, not an error:
   * `dto`, `ui-view` and `design-system` all legitimately declare none.
   */
  router.get('/:type/tools', (req, res, next) => {
    try {
      const type = assertActiveType(host, req.params.type);
      const tools = host.listTypeTools(type).map((t) => ({
        name: t.name,
        description: t.description,
        // The zod RAW SHAPE is not JSON — project it the same way the host
        // introspects plugin schemas elsewhere. A shape that cannot be walked
        // (a plugin bundling its own zod, the failure the runtime facade exists
        // to prevent) degrades to an absent schema rather than a 500 on a route
        // that is only trying to list names.
        inputSchema: toJsonSchema(t.inputSchema),
      }));
      res.json({ tools });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Execute one type-specific operation.
   *
   * The body IS the operation's arguments, validated by the SAME schema the tool
   * channel validates against, and the response has the SAME shape the tool
   * channel returns. This is a packing layer, not a second semantics: it calls
   * the owning core's function and forwards what comes back.
   *
   * Side effects and idempotency therefore belong to the invoked operation, not
   * to this route — `set_cell` is idempotent here because `set_cell` is
   * idempotent, and `insert_row` is not because it reindexes.
   *
   * Operations with a natural URL shape keep their own resource routes —
   * `link_dto`/`unlink_dto` live at `POST /api/endpoints/:slug/dtos` and its
   * symmetric unlink. This proxy is the fallback for the ones that have none.
   */
  const invokeTypeTool: RequestHandler = async (req, res, next) => {
    try {
      const type = assertActiveType(host, req.params.type!);
      const declared = host.listTypeTools(type);
      const tool = declared.find((t) => t.name === req.params.tool);
      if (!tool) {
        throw new DomainError(
          'NOT_FOUND',
          `type '${type}' declares no operation '${req.params.tool}' — available: ${
            declared.length > 0 ? declared.map((t) => t.name).join(', ') : '(none)'
          }`,
        );
      }
      const parsed = z.object(tool.inputSchema as z.ZodRawShape).safeParse(req.body ?? {});
      if (!parsed.success) {
        // The repair path, not just the refusal: which field, and what it wanted.
        throw new DomainError('VALIDATION', parsed.error.message);
      }
      /**
       * The handler off the declaration this route ALREADY resolved, rather than
       * `host.callTypeTool(type, name, …)`.
       *
       * Not a shortcut around the host: `tool` came out of `host.listTypeTools`,
       * so this is the same registry object and the same handler the MCP channel
       * invokes. What it avoids is the second lookup — `callTypeTool` calls
       * `listTypeTools` again, and `listTypeTools` runs the plugin's registered
       * factory, i.e. a full `createMcpServer` with every tool's zod shape
       * registered. Two of those were constructed and discarded per request, so
       * a spreadsheet driven through `POST /tools/set_cell` in a cell-write loop
       * paid for two throwaway `spreadsheet-tools` servers per cell.
       */
      const result = await tool.handler(parsed.data as Record<string, unknown>, {});
      /**
       * A tool that FAILED must not arrive as `200 OK`.
       *
       * An MCP handler reports failure in-band: `{ content: [...], isError: true }`,
       * with the code inside the text payload. Forwarding that verbatim made every
       * refusal — `NOT_FOUND`, `VALIDATION`, a plugin's `INTERNAL` — a 200, so a
       * REST client branching on `response.ok` recorded a failed operation as a
       * success and carried on with an empty result. The tool channel surfaces the
       * same failure as an error; the two channels must agree.
       *
       * So the envelope is unwrapped here and re-rendered through the SHARED
       * taxonomy: the code the tool chose picks the status, exactly as it would
       * had the handler thrown. A success is still forwarded untouched.
       */
      const failed = (result as { isError?: unknown } | null)?.isError === true;
      if (failed) {
        const { code, message } = decodeToolFailure(result);
        return res.status(httpStatusForCode(code)).json({ error: { code, message } });
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

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
      // 0.2.11: the `isRawEntityType` gate that stood here rejected every
      // plugin-contributed type as "not restorable" — a restriction with no
      // basis beyond the seven literals the predicate happened to list.
      // `assertType` above has already resolved the type through the host, so
      // reaching this line IS the proof that it is restorable.
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
      store.persist(type, slug);
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
      store.persist(type, slug);
      res.json({ tags: remaining });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  /**
   * Registered HERE, below every pre-existing `/:type/:slug/...` route, and not
   * up beside its `GET` sibling.
   *
   * `POST /:type/tools/:tool` and `POST /:type/:slug/tags` are both three
   * segments, so Express decides between them purely by registration order.
   * Declared first, the proxy swallowed `POST /api/entities/ui-view/tools/tags`
   * — tagging the entity whose slug is literally `tools` — and answered "type
   * 'ui-view' declares no operation 'tags'", which is both wrong and confusing.
   * Declared last, the tag route claims the requests that end in `/tags` and the
   * proxy claims everything else, which is the right split: `tags` is a real
   * resource on every type, while an operation NAMED `tags` on a type whose
   * entity is SLUGGED `tools` is a collision no ordering can resolve.
   */
  router.post('/:type/tools/:tool', invokeTypeTool);

  return router;
}
