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
import type { RawEntityReader, RawEntityType } from '../domain/raw-entity-reader.js';
import type { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import type { EntityCrudService } from '../core/plugin-host/entity-crud-service.js';
import type { BackendModule, ProjectPluginHost } from '../core/plugin-host/types.js';

export interface EntityToolsDeps {
  host: ProjectPluginHost;
  registry: SerializationEngine;
  reader: RawEntityReader;
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
    'Fetch multiple entities of the same type by slug. Missing slugs come back as { slug, entity: null }, not an error. Returns the full L9 detail view per entity.',
    {
      type: z.string().describe('Entity type, e.g. "endpoint"'),
      slugs: z.array(z.string()),
    },
    async (args) => {
      const type = String(args.type);
      const resolved = resolveType(type);
      if (!resolved.ok) return resolved.response;
      const slugs = (args.slugs as string[]).map(String);

      const results = slugs.map((slug) => {
        const raw = deps.reader.getEntity(type as RawEntityType, slug);
        if (!raw) return { slug, entity: null };
        const serialized = deps.registry.serializeEntity(type, 'detail', raw, deps.reader);
        return { slug, entity: serialized.data };
      });
      return ok({ type, results });
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

  // ─── list_entities ────────────────────────────────────────────────────────
  const listEntities = mcpTool(
    'list_entities',
    'List entities of a type with optional tag filtering and pagination. Returns { items, total } (L9 list view per item).',
    {
      type: z.string(),
      tags: z.array(z.string()).optional(),
      tagFilter: z.enum(['and', 'or']).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async (args) => {
      const type = String(args.type);
      const resolved = resolveType(type);
      if (!resolved.ok) return resolved.response;
      const { service } = resolved;
      const opts = {
        tags: args.tags as string[] | undefined,
        tagFilter: (args.tagFilter as 'and' | 'or' | undefined) ?? 'and',
        limit: (args.limit as number | undefined) ?? 50,
        offset: (args.offset as number | undefined) ?? 0,
      };
      const page = service.list(opts);
      const items = page.items
        .map((item) => (item as { slug: string }).slug)
        .map((slug) => deps.reader.getEntity(type as RawEntityType, slug))
        .filter((e): e is NonNullable<typeof e> => e != null)
        .map((raw) => deps.registry.serializeEntity(type, 'element_list_item', raw, deps.reader).data);
      return ok({ type, items, total: page.total });
    },
  );

  // ─── search_entities ──────────────────────────────────────────────────────
  const searchEntities = mcpTool(
    'search_entities',
    'Plain text search across one or all active entity types that support search (see describe_entity_type.searchSupported). Omit `type` to search every searchable active type, grouped by type in the response. Returns { results: [{ type, items, total }] }.',
    {
      type: z.string().optional(),
      query: z.string(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async (args) => {
      const query = String(args.query);
      const limit = (args.limit as number | undefined) ?? 50;
      const offset = (args.offset as number | undefined) ?? 0;

      const types: string[] = args.type
        ? [String(args.type)]
        : deps.host.listEntities().map((m) => m.type);

      const results: Array<{ type: string; items: unknown[]; total: number }> = [];
      for (const type of types) {
        const resolved = resolveType(type);
        if (!resolved.ok) {
          if (args.type) return resolved.response; // explicit single type: surface the type-level error
          continue; // omitted type: skip types that aren't CRUD-active
        }
        const { service } = resolved;
        if (typeof service.search !== 'function') continue; // searchSupported: false — silently skipped, per brief
        const page = service.search(query, { limit, offset });
        const items = page.items
          .map((item) => (item as { slug: string }).slug)
          .map((slug) => deps.reader.getEntity(type as RawEntityType, slug))
          .filter((e): e is NonNullable<typeof e> => e != null)
          .map((raw) => deps.registry.serializeEntity(type, 'element_list_item', raw, deps.reader).data);
        results.push({ type, items, total: page.total });
      }
      return ok({ results });
    },
  );

  // ─── describe_entity_type ─────────────────────────────────────────────────
  const describeEntityType = mcpTool(
    'describe_entity_type',
    'Introspect one or all active entity types: createSchema/updateSchema (JSON Schema), whether CRUD/search is supported, L9 views, and the custom server\'s tool line (if any). Omit `type` for all active types.',
    {
      type: z.string().optional(),
    },
    async (args) => {
      const modules = args.type ? [resolveActiveType(String(args.type))] : deps.host.listEntities().map((m) => ({ ok: true as const, module: m }));
      for (const m of modules) {
        if (!m.ok) return m.response;
      }
      const described = (modules as Array<{ ok: true; module: BackendModule }>).map(({ module }) => {
        const crudSupported = module.backend?.crud != null;
        const service = deps.host.getEntityService(module.type) as EntityCrudService | null;
        const searchSupported = typeof service?.search === 'function';
        const views = deps.registry.describe(module.type, undefined, deps.db);
        return {
          type: module.type,
          label: module.label,
          createSchema: crudSupported ? z.toJSONSchema(createSchemaOf(module)) : undefined,
          updateSchema: crudSupported ? z.toJSONSchema(updateSchemaOf(module)) : undefined,
          searchSupported,
          crudSupported,
          views: views?.views ?? [],
          customToolsLine: module.systemPrompt.mcpToolsLine,
        };
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
