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
  type CapturedMcpServer,
  type McpToolDefinition,
} from '../plugin-runtime/index.js';
import { z } from 'zod';
import { toolError } from '../operations/envelope.js';
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
import { buildCreateShape, buildUpdateShape } from '../core/plugin-host/crud-schema-gen.js';
import {
  genericCreate,
  genericDelete,
  genericUpdate,
  type GenericCrudDeps,
} from '../core/plugin-host/generic-crud.js';
import type { TagsService } from '../services/tags.js';
import type { EntityStore } from '../services/entity-store.js';
import type { VersionService } from '../services/versions.js';

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
  /**
   * 2.0.0 (item 28) — what the host needs to write a SERVICELESS type: tags and
   * the file store are the two things a per-type service used to own alongside
   * its row. Optional so the existing hand-built test rigs keep compiling; a
   * serviceless type reaching a write without them is reported, not guessed at.
   */
  tagsService?: TagsService;
  entityStore?: EntityStore;
  versionService?: VersionService;
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
  // The shared envelope — flat `{ error, code }`, per item 3. This file emitted
  // the nested shape while `page-tools` and `reference-tools`, on the same
  // connection, emitted the flat one.
  const fail = (code: string, message: string): FailResponse => toolError(code, message) as FailResponse;

  /** Per-item error envelope. `VALIDATION` (bare DomainError code) normalizes to the brief's `VALIDATION_ERROR`. */
  const itemError = (err: unknown): { error: string; code: string } => {
    if (err instanceof DomainError) {
      return { error: err.message, code: err.code === 'VALIDATION' ? 'VALIDATION_ERROR' : err.code };
    }
    return { error: err instanceof Error ? err.message : String(err), code: 'INTERNAL' };
  };

  /**
   * Full type resolution for CRUD tools (create/get/update/delete/list/search).
   *
   * 2.0.0 (item 28) — `CRUD_NOT_SUPPORTED` is GONE. Every active type has CRUD
   * by construction: it declares `data.schema`, so the host can generate its
   * input schemas and write its projection.
   *
   * The code was not only obsolete, it was wrong on the read side: `get_entities`
   * resolves through this same function, so a type with no `backend.crud` — the
   * shape every declaratively-authored plugin has — could not be READ either.
   *
   * Tier K: the resolved `service` is gone too. Every type writes through the
   * generic door now; there is nothing left to dispatch to.
   */
  const resolveType = (
    type: string,
  ): { ok: true; module: BackendModule } | { ok: false; response: FailResponse } => {
    const available = deps.host.getAvailable(type);
    if (!available) return { ok: false, response: fail('INVALID_TYPE', `unknown entity type '${type}'`) };
    if (!deps.host.isActive(type)) {
      return { ok: false, response: fail('INACTIVE_TYPE', `entity type '${type}' is not active in this project`) };
    }
    return { ok: true, module: deps.host.getEntity(type)! };
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

  /**
   * 2.0.0 (item 27) — generated from `data.schema`, the one source there is.
   *
   * Tier E staged this behind a declared `backend.crud`, because the six
   * built-ins still wrote through services that only honoured the fields their
   * hand-written schemas named, and publishing the wider generated schema over a
   * narrower service advertises `endpoint.linkedDtos` and an explicit `slug` to
   * an agent, accepts both, and drops them with no error. Tier K deleted the
   * services and the slot; what is described is now what the write path does.
   */
  const createSchemaOf = (module: BackendModule) =>
    z.object(buildCreateShape(module.data!, module.slugPattern));
  const updateSchemaOf = (module: BackendModule) =>
    z.object(buildUpdateShape(module.data!, module.slugPattern));

  /**
   * The generic write door — the only one.
   *
   * Throws when this server was constructed without the tag/file/version deps —
   * only the hand-built test rigs do that. Reported as a DomainError rather
   * than silently degrading, because "the host was not given what it needs to
   * write" is a wiring bug and must not read like a validation failure of the
   * caller's payload.
   */
  const genericDeps = (): GenericCrudDeps => {
    if (!deps.tagsService || !deps.entityStore) {
      throw new DomainError(
        'INTERNAL',
        'entity-tools was constructed without tagsService/entityStore — a serviceless type has no write door here',
      );
    }
    return {
      host: deps.host,
      reader: deps.reader,
      tags: deps.tagsService,
      store: deps.entityStore,
      references: deps.referencesService,
      projection: { db: deps.db, store: deps.entityStore, versions: deps.versionService ?? null },
    };
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

  /** The M39 core's enumeration — the only one, since tier K. */
  const coreList = (
    type: string,
    tags: string[] | undefined,
    tagFilter: 'and' | 'or',
    limit: number,
    offset: number,
    filters?: Record<string, unknown>,
  ): { items: Array<{ slug: string; title: string }>; total: number } => {
    const page = deps.discovery.listEntities({
      type,
      ...(tags?.length ? { tags, tagFilter } : {}),
      ...(filters ? { filters } : {}),
      // The transports inherit a type's declared default (`ac` → active only);
      // page rendering does not. See `ListEntitiesInput.applyDefaultPredicate`.
      applyDefaultPredicate: true,
      limit,
      offset,
    });
    if (page.mode !== 'items') return { items: [], total: page.total };
    // The core's frozen row, carried through unchanged. Narrowing it to `{ slug }`
    // here is what forced the re-hydration below and cost this tool its row shape.
    return { items: page.items.map((i) => ({ slug: i.slug, title: i.title })), total: page.total };
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
          const created = genericCreate(genericDeps(), type, parsed.data, 'agent');
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
    'Fetch multiple entities of the same type by slug. Missing slugs come back as { slug, entity: null } WITHOUT `truncated`, not an error. The response has a size budget: nothing you named is dropped, but an item past the budget comes back with `entity: null` AND `truncated: true` — which is what keeps "no such entity" distinguishable from "cut for size" — while the envelope\'s `message` says how to retry. The FIRST item is never degraded that way; a one-slug call is already the smallest retry, so it is emitted whole. Record width is yours to choose with `select`; the envelope echoes `selectedFields`, so a narrow record is distinguishable from an entity holding little data. Content-bearing fields never travel here — fetch them with get_field_content. Does NOT expand embedded mentions and does NOT take a view.',
    {
      type: z.string().describe('Entity type, e.g. "endpoint"'),
      slugs: z.array(z.string()),
      select: z
        .array(z.string())
        .optional()
        .describe(
          'Top-level field names to return; slug, title and tags always come back. Omit for every ' +
            'field except content-bearing ones. [] for the identity skeleton alone. A dotted path, ' +
            'a [] suffix or an unknown name is INVALID_ARGUMENT with the legal names attached. ' +
            'Naming a content-bearing field is allowed and answers with its descriptor plus the ' +
            'operation that issues the content. Call describe_entity_type for selectableFields.',
        ),
    },
    async (args) => {
      const type = String(args.type);
      const resolved = resolveType(type);
      if (!resolved.ok) return resolved.response;
      const slugs = (args.slugs as string[]).map(String);
      const select = args.select === undefined ? undefined : (args.select as string[]).map(String);

      // M39: the read goes through the discovery core, which owns the slug-list
      // limit and the response budget. A missing slug still comes back as
      // `{ slug, entity: null }` rather than an error — absence is an answer.
      const { results, selectedFields } = getEntitiesAll(deps.discovery, {
        type,
        slugs,
        ...(select ? { select } : {}),
      });
      return ok({
        type,
        selectedFields,
        results: results.map((r) => ({ slug: r.slug, entity: r.entity })),
      });
    },
  );

  // ─── get_field_content ────────────────────────────────────────────────────
  const getFieldContent = mcpTool(
    'get_field_content',
    'Fetch the content of ONE content-bearing field of one entity. Such a field never travels in get_entities or list_entities — you get `has<Field>`/`<field>Bytes` and this operation\'s name instead — so this is how you read a diagram body or any other field measured in kilobytes. Call describe_entity_type for the type\'s `contentFields`. A field that is not content-bearing is INVALID_ARGUMENT with the covered fields listed; an unknown slug is NOT_FOUND. No side effects; write the field with update_entities as usual.',
    {
      type: z.string().describe('Entity type, e.g. "diagram"'),
      slug: z.string(),
      field: z.string().describe('A content-bearing field of that type, e.g. "source"'),
    },
    async (args) => {
      const type = String(args.type);
      const resolved = resolveType(type);
      if (!resolved.ok) return resolved.response;
      return ok(
        deps.discovery.getFieldContent({
          type,
          slug: String(args.slug),
          field: String(args.field),
        }),
      );
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
          const updated = genericUpdate(genericDeps(), type, u.slug, data, 'agent');
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
      const slugs = (args.slugs as string[]).map(String);

      const results: ItemResult<{ deleted: true; brokenReferences: Array<{ pagePath: string; count: number }> }>[] = [];
      for (const slug of slugs) {
        try {
          const hits = await deps.referencesService.findReferences(type as EntityType, slug);
          const counts = new Map<string, number>();
          for (const h of hits) counts.set(h.pagePath, (counts.get(h.pagePath) ?? 0) + 1);
          /**
           * An absent slug is an ERROR for this item, not a silent success.
           *
           * The retired services threw `NOT_FOUND` from `.delete()`; the generic
           * door reports `{ deleted: false }` instead, which the batch envelope
           * would otherwise have relabelled `{ deleted: true }` — telling an
           * agent it removed something that was never there.
           */
          const removed = genericDelete(genericDeps(), type, slug, 'agent');
          if (!removed.deleted) throw new DomainError('NOT_FOUND', `${type} '${slug}' not found`);
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

  // ─── list_entities ────────────────────────────────────────────────────────
  const listEntities = mcpTool(
    'list_entities',
    'List entities of a type with optional tag filtering and pagination. Returns { items, total, hasMore } where each item is the frozen row { slug, title } — this operation takes no `select` and has no width to ask for; call get_entities with an explicit `select` when you need fields. Or { total } with mode: "count" — which answers "how many entities match" without walking them. `filters` matches on the type\'s own declared scalar fields: { field: value } or { field: [v1, v2] } for set membership, ANDed together and with the tag filter (e.g. ac: { status: "active", kind: "edge-case" }). See describe_entity_type\'s createSchema for the fields a type declares; a key naming no declared field is ignored. NOTE: a type may declare a DEFAULT filter that applies when you name no value for that field — `ac` lists only active ACs unless you ask for { status: ["active", "deprecated"] }.',
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
      const offset = (args.offset as number | undefined) ?? 0;
      const opts = {
        tags: args.tags as string[] | undefined,
        tagFilter: (args.tagFilter as 'and' | 'or' | undefined) ?? 'and',
        filters: args.filters as Record<string, unknown> | undefined,
        limit: (args.limit as number | undefined) ?? 50,
        offset,
      };
      /**
       * 2.0.0 tier K — one enumeration, the core's, filters included.
       *
       * `filters` used to be a per-type escape hatch implemented by whichever
       * service felt like it, which meant `count` had to ask the service too or
       * the two halves would count different sets. It is derived from
       * `data.schema` now (`RawEntityReader.slugsMatching`), so both halves are
       * the same query and every type supports it — including the ones that
       * never shipped a service to implement it with.
       */
      const page = coreList(type, opts.tags, opts.tagFilter, opts.limit, offset, opts.filters);
      if (args.mode === 'count') return ok({ type, mode: 'count', total: page.total });
      /**
       * The frozen row, `{ slug, title }` — the same one `c4s-reader`'s
       * `list_entities` and `GET /:type/list` answer with.
       *
       * This tool used to re-hydrate every slug into a full record, so the SAME
       * operation had two widths depending on which MCP server you asked. That
       * also handed back `columns[]`/`indexes[]`-sized payloads for a listing
       * nobody asked to be wide. Width is `get_entities`' job and its alone:
       * a caller who needs fields makes a second call with an explicit `select`.
       */
      return ok({
        type,
        mode: 'items',
        items: page.items,
        total: page.total,
        hasMore: offset + page.items.length < page.total,
      });
    },
  );

  // ─── search_entities ──────────────────────────────────────────────────────
  const searchEntities = mcpTool(
    'search_entities',
    'Plain text search within exactly ONE entity type — `type` is required. A cross-type search federated its rankings badly and let one call return hundreds of rows; to find an entity across types by name or slug, use resolve_identity. EVERY active type is searchable: the scope is `fields` if you pass it, else every text path derived from the type\'s declared data schema — that derivation is the ONLY source of scope, with no per-type declaration or per-type ranking behind it, so the same type ranks identically on every surface. The response always carries `searchedFields` — the paths actually consulted, so an empty result is distinguishable from a field that was never in scope. `filters` narrows the ranking by the type\'s own declared scalar fields, exactly as in list_entities — and, exactly as there, a type with a declared default applies it unless you name that field (`ac` ranks only active ACs unless you ask for { status: ["active","deprecated"] }). Returns { type, items, total, hasMore, searchedFields } — or { total, searchedFields } with mode: "count".',
    {
      type: z.string(),
      query: z.string(),
      fields: z.array(z.string()).optional(),
      mode: z.enum(['hits', 'count']).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
    },
    async (args) => {
      const type = String(args.type);
      const query = String(args.query);
      const fields = args.fields as string[] | undefined;
      const limit = (args.limit as number | undefined) ?? 50;
      const offset = (args.offset as number | undefined) ?? 0;
      const mode = (args.mode as 'hits' | 'count' | undefined) ?? 'hits';
      /**
       * 2.0.0 tier K — `filters` is ACCEPTED here, where tier E refused it.
       *
       * The refusal was right for its premise: nothing could apply them on this
       * path, and returning unfiltered rows under a parameter that promises
       * filtering is how an agent acts on deprecated ACs it explicitly excluded.
       * `slugsMatching` is that missing implementation, and it is generic — so
       * the honest fix is to apply them rather than to keep declining. It also
       * closes the asymmetry the refusal created: "the active ACs" now means the
       * same set whether you list them, count them or search them.
       */
      const filters = args.filters as Record<string, unknown> | undefined;

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
      const page = deps.discovery.searchEntities({
        type,
        query,
        fields,
        mode,
        limit,
        offset,
        applyDefaultPredicate: true,
        ...(filters ? { filters } : {}),
      });
      if (page.mode === 'count') return ok({ type, mode: 'count', total: page.total, searchedFields: page.searchedFields });
      return ok({
        type,
        mode: 'hits',
        items: page.items,
        total: page.total,
        hasMore: page.hasMore,
        searchedFields: page.searchedFields,
      });
    },
  );

  // ─── describe_entity_type ─────────────────────────────────────────────────
  const describeEntityType = mcpTool(
    'describe_entity_type',
    'Introspect one or all active entity types. Call it before a WRITE to learn createSchema/updateSchema and the value `constraints` a write must satisfy — and before a READ to learn `selectableFields` (the names get_entities `select` accepts), `contentFields` (fields no generic read carries, each with the operation that issues its content) and `searchableFields` (the dotted paths search consults). All four are DERIVED from the type\'s declared data schema rather than declared by the type, so what a type advertises and what the host enforces cannot drift. Omit `type` for all active types.',
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
       * per type and discarding all of them to read `views`. What the batch is
       * read for now are the three derived lists this release replaced `views`
       * with — `constraints`, `contentFields` and `selectableFields`.
       */
      type Described = {
        type: string;
        schemas?: Record<string, unknown>;
        constraints?: unknown[];
        contentFields?: Array<{ field: string; operation: string }>;
        selectableFields?: string[];
      };
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
          /**
           * 2.0.0 (item 28) — `true` for every active type, without exception.
           *
           * It used to report whether the type had shipped a `backend.crud`
           * slot, which made CRUD a thing a type opted into; `database-table`
           * was the standing counterexample the brief names. The schemas are
           * generated from `data.schema` now, so an active type HAS crud by
           * construction — the field survives only so an older client reading
           * it does not have to change.
           */
          const crudSupported = true;
          // 0.2.9 (item 15): through the discovery core, not the serialization
          // engine — a transport reaching into L9 directly is what the item
          // forbids, and the grep it names came back clean only because this
          // call had been spelled `registry`.
          const described = batched
            ? describedByType.get(module.type)
            : (deps.discovery.describeTypes({ types: [module.type] }).types[0] as Described | undefined);
          return {
            type: module.type,
            label: module.label,
            createSchema: safeToJsonSchema(module.type, () => createSchemaOf(module)),
            updateSchema: safeToJsonSchema(module.type, () => updateSchemaOf(module)),
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
            /**
             * 0.2.22 — `views` and `computedViews` are GONE from this output.
             *
             * They told a caller which of five shapes a type built itself, so
             * that it could decide whether asking for `detail` was worth it.
             * There is no such decision left to make: width is `select`'s, and
             * these three lists are what a caller now needs before a read.
             */
            constraints: described?.constraints ?? [],
            contentFields: described?.contentFields ?? [],
            selectableFields: described?.selectableFields ?? [],
            customToolsLine: module.systemPrompt.mcpToolsLine,
          };
        } catch (err) {
          return { type: module.type, label: module.label, __error: `${module.type}: ${errMessage(err)}` };
        }
      });
      return ok({ types: described });
    },
  );

  /**
   * Order is the reading order of the surface rather than an accident: create,
   * read, read-the-content-a-read-will-not-carry, then the mutations, then
   * discovery, then introspection. `getFieldContent` sits beside `getEntities`
   * because the two are halves of one contract — the second hands over exactly
   * what the first deliberately withholds.
   */
  return [
    createEntities,
    getEntities,
    getFieldContent,
    updateEntities,
    deleteEntities,
    listEntities,
    searchEntities,
    describeEntityType,
  ];
}

export function createEntityToolsServer(deps: EntityToolsDeps): CapturedMcpServer {
  return createMcpServer({ name: 'entity-tools', tools: buildEntityTools(deps) });
}
