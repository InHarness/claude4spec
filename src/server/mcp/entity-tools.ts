/**
 * M13 — the generic write-side CRUD MCP server. Write-side mirror of the
 * read-only `c4s-reader` (M12): "one server, `type` param, delegate to host."
 * Registered once per `ProjectContext` (see `project-context.ts`) — NOT per
 * entity type, NOT by a plugin. Agents see tools as `mcp__entity-tools__*`.
 *
 * CRUD for an entity type flows entirely through its `EntityCrudService`
 * (`host.getEntityService(type)`) + the Zod schemas it declared via
 * `backend.crud` — no per-type branches here. Batched mutations are
 * non-transactional: each item is applied independently and gets its own
 * `{ slug } | { error, code }` envelope, in input order.
 */

import {
  createMcpServer,
  mcpTool,
  type McpServerInstance,
  type McpToolDefinition,
} from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { EntityType } from '../../shared/entities.js';
import { DomainError } from '../services/tags.js';
import type { ReferencesService } from '../services/references.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { RawEntityReader, RawEntityType } from '../discovery/raw-entity-reader.js';
import type { EntityCrudService } from '../core/plugin-host/entity-crud-service.js';
import type { BackendModule, ProjectPluginHost } from '../core/plugin-host/types.js';
import { getEntitiesAll, type DiscoveryCore } from '../discovery/index.js';
import { resolveSearchFields } from '../discovery/search/fields.js';

export interface EntityToolsDeps {
  host: ProjectPluginHost;
  reader: RawEntityReader;
  /**
   * M39: reads go through the discovery core. This server keeps the WRITE path
   * — create/update/delete are the substance of M13 and stay here — while its
   * read tools become adapters, so the chat agent sees exactly the semantics
   * the CLI and the external MCP server see.
   */
  discovery: DiscoveryCore;
  db: Database.Database;
  ws: WsEmitter;
  referencesService: ReferencesService;
}

type FailResponse = { content: [{ type: 'text'; text: string }]; isError: true };
type ItemResult<T extends Record<string, unknown>> = (T & { error?: never; code?: never }) | { error: string; code: string };

/**
 * Build the raw tool definitions (name/description/inputSchema/handler) without
 * wrapping them in an MCP server instance — `mcpTool()` handlers are directly
 * callable, so this is the seam `entity-tools.test.ts` uses to exercise
 * `create_entities`/etc. without going through the MCP/SDK protocol layer.
 * `createEntityToolsServer` (below) is the real entry point used at runtime.
 */
export function buildEntityTools(deps: EntityToolsDeps): McpToolDefinition[] {
  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });
  const fail = (code: string, message: string): FailResponse => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: { code, message } }) }],
    isError: true,
  });

  /** Per-item error envelope. `VALIDATION` (bare DomainError code) normalizes to the brief's `VALIDATION_ERROR`. */
  const itemError = (err: unknown): { error: string; code: string } => {
    if (err instanceof DomainError) {
      return { error: err.message, code: err.code === 'VALIDATION' ? 'VALIDATION_ERROR' : err.code };
    }
    return { error: err instanceof Error ? err.message : String(err), code: 'INTERNAL' };
  };

  /** Full type resolution for CRUD tools (create/get/update/delete/list/search). */
  const resolveType = (
    type: string,
  ):
    | { ok: true; module: BackendModule; service: EntityCrudService }
    | { ok: false; response: FailResponse } => {
    const available = deps.host.getAvailable(type);
    if (!available) return { ok: false, response: fail('INVALID_TYPE', `unknown entity type '${type}'`) };
    if (!deps.host.isActive(type)) {
      return { ok: false, response: fail('INACTIVE_TYPE', `entity type '${type}' is not active in this project`) };
    }
    const module = deps.host.getEntity(type)!;
    const service = deps.host.getEntityService(type) as EntityCrudService | null;
    if (!module.backend?.crud || !service) {
      return { ok: false, response: fail('CRUD_NOT_SUPPORTED', `entity type '${type}' does not support CRUD via entity-tools`) };
    }
    return { ok: true, module, service };
  };

  /** Light resolution for describe_entity_type: any active type, CRUD or not. */
  const resolveActiveType = (
    type: string,
  ): { ok: true; module: BackendModule } | { ok: false; response: FailResponse } => {
    const available = deps.host.getAvailable(type);
    if (!available) return { ok: false, response: fail('INVALID_TYPE', `unknown entity type '${type}'`) };
    if (!deps.host.isActive(type)) {
      return { ok: false, response: fail('INACTIVE_TYPE', `entity type '${type}' is not active in this project`) };
    }
    return { ok: true, module: deps.host.getEntity(type)! };
  };

  const createSchemaOf = (module: BackendModule) => z.object(module.backend!.crud!.createSchema);
  const updateSchemaOf = (module: BackendModule) => {
    const raw = module.backend!.crud!.updateSchema;
    return raw ? z.object(raw) : createSchemaOf(module).partial();
  };
  const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  // Per-type guard: a schema that can't be serialized (e.g. a foreign/undefined zod
  // node) must degrade to a labelled placeholder for THAT type instead of throwing out
  // of the whole describe_entity_type handler. Wraps both the zod-object build and the
  // toJSONSchema call, since either can throw for a malformed schema.
  const safeToJsonSchema = (type: string, build: () => z.core.$ZodType): object => {
    try {
      return z.toJSONSchema(build());
    } catch (err) {
      return { __error: `${type}: ${errMessage(err)}` };
    }
  };

  const broadcastChanged = (type: string, slug: string): void => {
    deps.ws.broadcast({ kind: 'entity:changed', entityType: type, slug });
  };

  // ─── create_entities ──────────────────────────────────────────────────────
  const createEntities = mcpTool(
    'create_entities',
    'Create one or more entities of the given type in a single batch. Each item is validated against the type\'s createSchema (see describe_entity_type). Non-transactional: one item failing (e.g. duplicate slug) does not roll back the others. Returns { results: [{ slug } | { error, code }] } in input order.',
    {
      type: z.string().describe('Entity type, e.g. "endpoint"'),
      items: z.array(z.record(z.string(), z.unknown())).describe('Items to create, each matching the type\'s createSchema'),
    },
    async (args) => {
      const type = String(args.type);
      const resolved = resolveType(type);
      if (!resolved.ok) return resolved.response;
      const { service } = resolved;
      const schema = createSchemaOf(resolved.module);
      const items = args.items as Array<Record<string, unknown>>;

      const results: ItemResult<{ slug: string; warnings?: string[] }>[] = [];
      for (const item of items) {
        const parsed = schema.safeParse(item);
        if (!parsed.success) {
          results.push({ error: parsed.error.message, code: 'VALIDATION_ERROR' });
          continue;
        }
        try {
          const created = await service.create(parsed.data);
          broadcastChanged(type, created.slug);
          results.push(created.warnings?.length ? created : { slug: created.slug });
        } catch (err) {
          results.push(itemError(err));
        }
      }
      return ok({ results });
    },
  );

  // ─── get_entities ─────────────────────────────────────────────────────────
  const getEntities = mcpTool(
    'get_entities',
    'Fetch multiple entities of the same type by slug. Missing slugs come back as { slug, entity: null } WITHOUT `truncated`, not an error. The response has a size budget: nothing you named is dropped, but an item past the budget comes back with `entity: null` AND `truncated: true` — which is what keeps "no such entity" distinguishable from "cut for size" — while the envelope\'s `message` says how to retry. The FIRST item is never degraded that way; a one-slug call is already the smallest retry, so it is emitted whole. Returns the full L9 detail view per entity.',
    {
      type: z.string().describe('Entity type, e.g. "endpoint"'),
      slugs: z.array(z.string()),
    },
    async (args) => {
      const type = String(args.type);
      const resolved = resolveType(type);
      if (!resolved.ok) return resolved.response;
      const slugs = (args.slugs as string[]).map(String);

      // M39: the read goes through the discovery core, which owns the slug-list
      // limit and the response budget. A missing slug still comes back as
      // `{ slug, entity: null }` rather than an error — absence is an answer.
      const results = getEntitiesAll(deps.discovery, { type, slugs, view: 'detail' });
      return ok({ type, results: results.map((r) => ({ slug: r.slug, entity: r.entity })) });
    },
  );

  // ─── update_entities ──────────────────────────────────────────────────────
  const updateEntities = mcpTool(
    'update_entities',
    'Update one or more entities in a single batch. `data` is validated against the type\'s updateSchema (partial by default). The slug is stable — pass an explicit `newSlug` to rename (collision → SLUG_CONFLICT); a rename propagates to every markdown reference. Non-transactional. Returns { results: [{ slug } | { error, code }] } in input order (slug is the NEW slug if renamed).',
    {
      type: z.string(),
      updates: z.array(
        z.object({
          slug: z.string(),
          data: z.record(z.string(), z.unknown()),
          newSlug: z.string().optional(),
        }),
      ),
    },
    async (args) => {
      const type = String(args.type);
      const resolved = resolveType(type);
      if (!resolved.ok) return resolved.response;
      const { service } = resolved;
      const schema = updateSchemaOf(resolved.module);
      const updates = args.updates as Array<{ slug: string; data: Record<string, unknown>; newSlug?: string }>;

      const results: ItemResult<{ slug: string; warnings?: string[] }>[] = [];
      for (const u of updates) {
        const parsed = schema.safeParse(u.data);
        if (!parsed.success) {
          results.push({ error: parsed.error.message, code: 'VALIDATION_ERROR' });
          continue;
        }
        try {
          const data = u.newSlug !== undefined ? { ...parsed.data, newSlug: u.newSlug } : parsed.data;
          const updated = await service.update(u.slug, data);
          if (updated.slug !== u.slug) {
            await deps.referencesService.propagateSlugChange(type as EntityType, u.slug, updated.slug);
          }
          broadcastChanged(type, updated.slug);
          results.push(updated.warnings?.length ? updated : { slug: updated.slug });
        } catch (err) {
          results.push(itemError(err));
        }
      }
      return ok({ results });
    },
  );

  // ─── delete_entities ──────────────────────────────────────────────────────
  const deleteEntities = mcpTool(
    'delete_entities',
    'Delete one or more entities in a single batch. Returns broken markdown references per deleted item. Non-transactional. Returns { results: [{ deleted: true, brokenReferences } | { error, code }] } in input order.',
    {
      type: z.string(),
      slugs: z.array(z.string()),
    },
    async (args) => {
      const type = String(args.type);
      const resolved = resolveType(type);
      if (!resolved.ok) return resolved.response;
      const { service } = resolved;
      const slugs = (args.slugs as string[]).map(String);

      const results: ItemResult<{ deleted: true; brokenReferences: Array<{ pagePath: string; count: number }> }>[] = [];
      for (const slug of slugs) {
        try {
          const hits = await deps.referencesService.findReferences(type as EntityType, slug);
          const counts = new Map<string, number>();
          for (const h of hits) counts.set(h.pagePath, (counts.get(h.pagePath) ?? 0) + 1);
          service.delete(slug);
          broadcastChanged(type, slug);
          results.push({
            deleted: true,
            brokenReferences: Array.from(counts, ([pagePath, count]) => ({ pagePath, count })),
          });
        } catch (err) {
          results.push(itemError(err));
        }
      }
      return ok({ results });
    },
  );

  /**
   * Batch slug list → L9 `element_list_item` views.
   *
   * M39: the projection is the discovery core's, not this server's. The service
   * still decides WHICH slugs (its own filters, its own ranking); the core
   * decides what a serialized record looks like.
   */
  const serializeSlugs = (type: string, slugs: string[]) =>
    // getEntitiesAll: the service decided how many slugs this page has (the
    // caller's own `limit`), so refusing to serialize them past 50 would turn a
    // documented `list_entities({ limit: 100 })` into a thrown error.
    getEntitiesAll(deps.discovery, { type, slugs, view: 'element_list_item' })
      .filter((r) => r.entity !== null)
      .map((r) => r.entity);

  // ─── list_entities ────────────────────────────────────────────────────────
  const listEntities = mcpTool(
    'list_entities',
    'List entities of a type with optional tag filtering and pagination. Returns { items, total, hasMore } (L9 list view per item), or { total } with mode: "count" — which answers "how many entities match" without walking them. `filters` is a type-specific escape hatch (e.g. ac: { status: "all", kind: "edge-case" }) — see describe_entity_type for what a type accepts; unrecognized keys are ignored by types that don\'t support them.',
    {
      type: z.string(),
      tags: z.array(z.string()).optional(),
      tagFilter: z.enum(['and', 'or']).optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
      mode: z.enum(['items', 'count']).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async (args) => {
      const type = String(args.type);
      const resolved = resolveType(type);
      if (!resolved.ok) return resolved.response;
      const { service } = resolved;
      const offset = (args.offset as number | undefined) ?? 0;
      const opts = {
        tags: args.tags as string[] | undefined,
        tagFilter: (args.tagFilter as 'and' | 'or' | undefined) ?? 'and',
        filters: args.filters as Record<string, unknown> | undefined,
        limit: (args.limit as number | undefined) ?? 50,
        offset,
      };
      // `count` still asks the service, not the core: the service owns `filters`
      // and therefore owns what "matching" means for this type. Asking the core
      // instead would count a different set whenever a filter is in play.
      if (args.mode === 'count') return ok({ type, mode: 'count', total: service.list(opts).total });
      const page = service.list(opts);
      const slugs = page.items.map((item) => (item as { slug: string }).slug);
      return ok({
        type,
        mode: 'items',
        items: serializeSlugs(type, slugs),
        total: page.total,
        hasMore: offset + page.items.length < page.total,
      });
    },
  );

  // ─── search_entities ──────────────────────────────────────────────────────
  const searchEntities = mcpTool(
    'search_entities',
    'Plain text search within exactly ONE entity type — `type` is required. A cross-type search federated its rankings badly and let one call return hundreds of rows; to find an entity across types by name or slug, use resolve_identity. EVERY active type is searchable: the scope is `fields` if you pass it, else every text path derived from the type\'s createSchema — that derivation is the ONLY source of scope, with no per-type declaration or per-type ranking behind it, so the same type ranks identically on every surface. The response always carries `searchedFields` — the paths actually consulted, so an empty result is distinguishable from a field that was never in scope. This tool has NO `filters` parameter: use list_entities for type-specific filtering. Returns { type, items, total, hasMore, searchedFields } — or { total, searchedFields } with mode: "count".',
    {
      type: z.string(),
      query: z.string(),
      fields: z.array(z.string()).optional(),
      mode: z.enum(['hits', 'count']).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async (args) => {
      const type = String(args.type);
      const query = String(args.query);
      const fields = args.fields as string[] | undefined;
      const limit = (args.limit as number | undefined) ?? 50;
      const offset = (args.offset as number | undefined) ?? 0;
      const mode = (args.mode as 'hits' | 'count' | undefined) ?? 'hits';

      /**
       * `filters` is REFUSED rather than ignored. It was advertised here as "the
       * same escape hatch as list_entities", but no type has ever honoured it on
       * this path: the core takes no filters, and the one service with a custom
       * `search` drops the argument. Silently returning unfiltered rows under a
       * parameter that promises filtering is how an agent acts on deprecated ACs
       * it explicitly excluded.
       */
      if (args.filters !== undefined) {
        return fail(
          'INVALID_ARGUMENT',
          'search_entities does not support `filters` — no entity type applies them on the search path',
          );
      }

      /**
       * ANY active type, CRUD or not. Searching is not writing: gating it behind
       * `backend.crud` (as `resolveType` does, correctly, for the mutations)
       * would keep excluding types from search for a reason that has nothing to
       * do with reading them — the same class of exclusion this release removed.
       */
      const resolved = resolveActiveType(type);
      if (!resolved.ok) return resolved.response;
      const { module } = resolved;

      /*
       * 0.2.4 — the per-type `search` escape hatch is GONE, along with the
       * `searchableFields` declaration that gated it. `searchedFields` is a
       * promise about what was consulted, and a service ranking over columns
       * the host cannot see could only ever keep that promise by echoing a
       * second declaration back. One derivation, one ranking, one answer.
       */
      const page = deps.discovery.searchEntities({ type, query, fields, mode, limit, offset });
      if (page.mode === 'count') return ok({ type, mode: 'count', total: page.total, searchedFields: page.searchedFields });
      return ok({
        type,
        mode: 'hits',
        items: page.items.map((item) => item.data),
        total: page.total,
        hasMore: page.hasMore,
        searchedFields: page.searchedFields,
      });
    },
  );

  // ─── describe_entity_type ─────────────────────────────────────────────────
  const describeEntityType = mcpTool(
    'describe_entity_type',
    'Introspect one or all active entity types: createSchema/updateSchema (JSON Schema), whether CRUD is supported, the paths search covers (`searchableFields`), L9 views, and the custom server\'s tool line (if any). `searchableFields` is DERIVED from createSchema, not declared by the type — it is what a search_entities call would actually consult, and it is never empty for an active type. Omit `type` for all active types.',
    {
      type: z.string().optional(),
    },
    async (args) => {
      const modules = args.type ? [resolveActiveType(String(args.type))] : deps.host.listEntities().map((m) => ({ ok: true as const, module: m }));
      for (const m of modules) {
        if (!m.ok) return m.response;
      }
      /**
       * ONE core call for the whole batch.
       *
       * It used to run per type inside the map below, deriving five JSON Schemas
       * per type and discarding all of them to read `views` — which is now the
       * same five kinds for everyone, so the field carried no information at all.
       * The distinction that DOES matter moved into the schemas: `x-computed`
       * marks a view the type builds itself, as opposed to one the host projects
       * from the row. That is what `computedViews` reports.
       */
      type Described = { type: string; views?: string[]; schemas?: Record<string, unknown> };
      const describedByType = new Map<string, Described>();
      let batched = true;
      try {
        for (const d of deps.discovery.describeTypes({}).types as Described[]) describedByType.set(d.type, d);
      } catch {
        /**
         * One bad type must not cost every other type its answer. The batch is
         * the fast path; when it throws we fall back to per-type calls inside
         * the per-type guard below, where a single failure degrades to that
         * type's own `__error` placeholder and the healthy types are unaffected.
         */
        batched = false;
      }
      const described = (modules as Array<{ ok: true; module: BackendModule }>).map(({ module }) => {
        // Outer per-type guard: schema serialization is already isolated by
        // safeToJsonSchema, but the rest of the entry (the describe call, service
        // lookup) can also throw for a malformed type — contain that too so one bad
        // type never aborts the whole describe-all batch.
        try {
          const crudSupported = module.backend?.crud != null;
          // 0.2.9 (item 15): through the discovery core, not the serialization
          // engine — a transport reaching into L9 directly is what the item
          // forbids, and the grep it names came back clean only because this
          // call had been spelled `registry`.
          const described = batched
            ? describedByType.get(module.type)
            : (deps.discovery.describeTypes({ types: [module.type] }).types[0] as Described | undefined);
          const schemas = (described?.schemas ?? {}) as Record<string, { 'x-computed'?: boolean }>;
          return {
            type: module.type,
            label: module.label,
            createSchema: crudSupported ? safeToJsonSchema(module.type, () => createSchemaOf(module)) : undefined,
            updateSchema: crudSupported ? safeToJsonSchema(module.type, () => updateSchemaOf(module)) : undefined,
            /**
             * 0.2.4 — `searchSupported` was REMOVED from this output. With a
             * non-empty scope mandatory for every active type it was always
             * `true`, and with the declaration layer gone there is nothing left
             * for it to report. `searchableFields` stays, but as a DERIVED
             * field: the paths the core would consult, not an echo of a
             * manifest slot that no longer exists.
             */
            searchableFields: resolveSearchFields(module, undefined).map((f) => f.path),
            crudSupported,
            views: described?.views ?? [],
            /**
             * The subset the TYPE builds itself. Asking for a view a type does
             * not compute is not an error — the host projects the row — but it
             * returns nothing the cheaper list view would not, which is exactly
             * what a caller deciding whether `detail` is worth fetching needs to
             * know.
             */
            computedViews: Object.entries(schemas)
              .filter(([, schema]) => schema?.['x-computed'] === true)
              .map(([view]) => view),
            customToolsLine: module.systemPrompt.mcpToolsLine,
          };
        } catch (err) {
          return { type: module.type, label: module.label, __error: `${module.type}: ${errMessage(err)}` };
        }
      });
      return ok({ types: described });
    },
  );

  return [
    createEntities,
    getEntities,
    updateEntities,
    deleteEntities,
    listEntities,
    searchEntities,
    describeEntityType,
  ];
}

export function createEntityToolsServer(deps: EntityToolsDeps): McpServerInstance {
  return createMcpServer({ name: 'entity-tools', tools: buildEntityTools(deps) });
}
