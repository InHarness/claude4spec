import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import {
  isRawEntityType,
  type RawEntity,
  type RawEntityReader,
  type RawEntityType,
} from '../discovery/raw-entity-reader.js';
import type { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { isDiscoveryError, type DiscoveryCore, type SerializedMeta } from '../discovery/index.js';
import { resolvePageContent } from '../serialization/resolve-page.js';
import type { SerializeResult, ViewKind } from '../serialization/types.js';
import fs from 'node:fs';
import path from 'node:path';

export interface C4sReaderDeps {
  reader: RawEntityReader | null;
  registry: SerializationEngine;
  /**
   * M39: the discovery core, already bound to a resolved project. Null on a
   * degraded start (no project) — the tools then answer `PROJECT_NOT_FOUND`
   * rather than the process exiting, because an stdio server that dies hands
   * the agent an EOF where it needed a diagnosis.
   *
   * This server is a TRANSPORT: it maps tool names and the MCP protocol onto
   * core operations, and core error codes onto `tool_result`. It does not
   * serialize entities, iterate types, or decide what pagination means.
   */
  discovery: DiscoveryCore | null;
  db: Database.Database | null;
  projectDir: string | null;
  packageVersion: string;
}

const VIEW_KINDS = [
  'inline_mention',
  'single_element',
  'element_list_item',
  'tagged_list_item',
  'detail',
] as const;

const ENTITY_TYPE_VALUES = ['endpoint', 'dto', 'database-table', 'ui-view'] as const;

export function createC4sReaderServer(deps: C4sReaderDeps): McpServerInstance {
  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  });
  const fail = (code: string, message: string, hint?: string) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: { code, message, ...(hint ? { hint } : {}) } }, null, 2),
      },
    ],
    isError: true,
  });

  const requireProject = ():
    | { ok: true; reader: RawEntityReader; db: Database.Database; projectDir: string; discovery: DiscoveryCore }
    | { ok: false; response: ReturnType<typeof fail> } => {
    if (!deps.reader || !deps.db || !deps.projectDir || !deps.discovery) {
      return {
        ok: false,
        response: fail(
          'PROJECT_NOT_FOUND',
          'no claude4spec project loaded',
          'pass --project <path> when starting c4s-mcp',
        ),
      };
    }
    return { ok: true, reader: deps.reader, db: deps.db, projectDir: deps.projectDir, discovery: deps.discovery };
  };

  const wrapDb = <T>(fn: () => T): { ok: true; value: T } | { ok: false; response: ReturnType<typeof fail> } => {
    try {
      return { ok: true, value: fn() };
    } catch (err) {
      // M39: a core error already carries its own code and its navigation —
      // the transport RE-FRAMES it, it does not re-invent it.
      if (isDiscoveryError(err)) {
        return { ok: false, response: fail(err.code, err.message, err.hint) };
      }
      const message = err instanceof Error ? err.message : String(err);
      const code = /no such table|no such column/i.test(message) ? 'SCHEMA_OUT_OF_DATE' : 'INTERNAL';
      const hint = code === 'SCHEMA_OUT_OF_DATE' ? 'run `npx @inharness-ai/claude4spec` to migrate' : undefined;
      return { ok: false, response: fail(code, message, hint) };
    }
  };

  /** Same mapping as `wrapDb`, for the operations that touch the filesystem. */
  const wrapDbAsync = async <T>(
    fn: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; response: ReturnType<typeof fail> }> => {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      if (isDiscoveryError(err)) return { ok: false, response: fail(err.code, err.message, err.hint) };
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, response: fail('INTERNAL', message) };
    }
  };

  const normalizeType = (raw: string): RawEntityType | null => {
    const normalized = raw === 'database_table' ? 'database-table' : raw;
    return isRawEntityType(normalized) ? normalized : null;
  };

  const getEntity = mcpTool(
    'get_entity',
    'Get a single entity (endpoint / dto / database-table / ui-view) by type+slug. Use this to resolve <single_element type="..." slug="..."/> and <inline_mention type="..." slug="..."/>. The view parameter selects the response shape: single_element (default), inline_mention, detail.',
    {
      type: z.enum(ENTITY_TYPE_VALUES).describe('Entity type'),
      slug: z.string().describe('Entity slug'),
      view: z
        .enum(VIEW_KINDS)
        .optional()
        .describe('Response shape; default: single_element'),
    },
    async (args) => {
      const ctx = requireProject();
      if (!ctx.ok) return ctx.response;
      const type = normalizeType(String(args.type));
      if (!type) return fail('INVALID_TYPE', `unknown entity type '${args.type}'`);
      const view: ViewKind = (args.view as ViewKind | undefined) ?? 'single_element';
      const slug = String(args.slug);
      const lookup = wrapDb(() => ctx.discovery.getEntities({ type, slugs: [slug], view }));
      if (!lookup.ok) return lookup.response;
      const record = lookup.value.results[0];
      if (!record || record.entity === null) return fail('ENTITY_NOT_FOUND', `${type}/${slug} not found`);
      return ok({ type, slug, view, ...envelope(record.entity, record) });
    },
  );

  const getEntities = mcpTool(
    'get_entities',
    'Get multiple entities of the same type by slug list. Use this to resolve <element_list type="..." slugs="a,b,c"/>. Default view: element_list_item. Returns { items, missing }.',
    {
      type: z.enum(ENTITY_TYPE_VALUES).describe('Entity type'),
      slugs: z.array(z.string()).describe('List of slugs to fetch in order'),
      view: z
        .enum(VIEW_KINDS)
        .optional()
        .describe('Response shape; default: element_list_item'),
    },
    async (args) => {
      const ctx = requireProject();
      if (!ctx.ok) return ctx.response;
      const type = normalizeType(String(args.type));
      if (!type) return fail('INVALID_TYPE', `unknown entity type '${args.type}'`);
      const view: ViewKind = (args.view as ViewKind | undefined) ?? 'element_list_item';
      const slugs = (args.slugs as string[]).map(String);
      const lookup = wrapDb(() => ctx.discovery.getEntities({ type, slugs, view }));
      if (!lookup.ok) return lookup.response;
      const found = lookup.value.results.filter((r) => r.entity !== null);
      return ok({
        type,
        view,
        items: found.map((r) => ({ slug: r.slug, ...envelope(r.entity, r) })),
        missing: lookup.value.results.filter((r) => r.entity === null).map((r) => r.slug),
        ...(lookup.value.truncated
          ? { truncated: true, truncationHint: lookup.value.truncationHint }
          : {}),
      });
    },
  );

  const findByTag = mcpTool(
    'find_by_tag',
    'Find entities by tags. Use this to resolve <tagged_list type="..." tags="a,b" filter="and"/> and <tagged_list_mixed tags="..."/>. When type is omitted, results are grouped by type ({ endpoints, dtos, "database-tables", "ui-views" }). Default view: tagged_list_item.',
    {
      type: z
        .enum(ENTITY_TYPE_VALUES)
        .optional()
        .describe('Restrict to one entity type; omit for grouped mixed result'),
      tags: z.array(z.string()).describe('Tag slugs to match'),
      filter: z.enum(['and', 'or']).optional().describe('Tag filter mode; default: or'),
      view: z
        .enum(VIEW_KINDS)
        .optional()
        .describe('Response shape; default: tagged_list_item'),
    },
    async (args) => {
      const ctx = requireProject();
      if (!ctx.ok) return ctx.response;
      const tags = (args.tags as string[]).map(String);
      const filter = ((args.filter as 'and' | 'or' | undefined) ?? 'or') as 'and' | 'or';
      const view: ViewKind = (args.view as ViewKind | undefined) ?? 'tagged_list_item';
      const typeArg = args.type ? normalizeType(String(args.type)) : null;
      if (args.type && !typeArg) return fail('INVALID_TYPE', `unknown entity type '${args.type}'`);

      if (typeArg) {
        const lookup = wrapDb(() => ctx.discovery.listEntities({ type: typeArg, tags, filter, view, limit: 1000 }));
        if (!lookup.ok) return lookup.response;
        const items =
          lookup.value.mode === 'items'
            ? lookup.value.items.map((item) => ({ slug: item.slug, ...envelope(item.data, item) }))
            : [];
        return ok({ type: typeArg, view, query: { tags, filter }, items });
      }

      // The mixed grouping is a TRANSPORT composition over the per-type
      // operation. Its bucket key was a hardcoded seven-type map that a
      // plugin-contributed type indexed straight into `undefined`; every one of
      // those keys was the type name plus an `s`, so deriving it keeps the same
      // output and stops dropping the rest.
      const grouped = wrapDb(() => {
        const groups: Record<string, unknown[]> = {};
        for (const t of ctx.reader.listTypes()) {
          const result = ctx.discovery.listEntities({ type: t, tags, filter, view, limit: 1000 });
          groups[`${t}s`] =
            result.mode === 'items'
              ? result.items.map((item) => ({ slug: item.slug, ...envelope(item.data, item) }))
              : [];
        }
        return groups;
      });
      if (!grouped.ok) return grouped.response;
      return ok({ view, query: { tags, filter }, ...grouped.value });
    },
  );

  const getSection = mcpTool(
    'get_section',
    'Get a documentation section by anchor.',
    {
      anchor: z.string().describe('Section anchor (8-char id)'),
      view: z.enum(VIEW_KINDS).optional().describe('Response shape; default: single_element'),
    },
    async (args) => {
      const ctx = requireProject();
      if (!ctx.ok) return ctx.response;
      const anchor = String(args.anchor);
      // M39: the section arrives with its BODY and its outgoing document edges
      // — returning coordinates alone was one of the three gaps that motivated
      // the core. The `view` parameter is accepted for compatibility and no
      // longer selects a narrower shape.
      const result = await wrapDbAsync(() => ctx.discovery.getSection({ anchor }));
      if (!result.ok) return result.response;
      return ok(result.value);
    },
  );

  const resolvePage = mcpTool(
    'resolve_page',
    'Resolve all XML tags in a markdown file. Returns either { content } with tags expanded inline (format: inline) or { content, resolved: [...] } with the original markdown plus a sidecar of structured resolutions (format: json). Path is resolved relative to the project dir if relative; absolute paths are used as-is.',
    {
      path: z.string().describe('File path; absolute or relative to the project dir'),
      format: z.enum(['inline', 'json']).optional().describe('Output format; default: inline'),
    },
    async (args) => {
      const ctx = requireProject();
      if (!ctx.ok) return ctx.response;
      const rel = String(args.path);
      const abs = path.isAbsolute(rel) ? rel : path.resolve(ctx.projectDir, rel);
      if (!fs.existsSync(abs)) return fail('FILE_NOT_FOUND', `file not found: ${abs}`);
      const md = fs.readFileSync(abs, 'utf8');
      const result = wrapDb(() =>
        resolvePageContent(md, {
          discovery: ctx.discovery,
          activeTypes: ctx.reader.listTypes(),
        }),
      );
      if (!result.ok) return result.response;
      const format = (args.format as 'inline' | 'json' | undefined) ?? 'inline';
      if (format === 'json') {
        const sidecar = result.value.resolved.map(({ inline: _inline, ...rest }) => rest);
        return ok({ path: abs, content: md, resolved: sidecar });
      }
      return ok({ path: abs, content: result.value.inlineContent });
    },
  );

  const catalog = mcpTool(
    'catalog',
    'Smoke test: discover active entity types with a row count, serializer version, one-line description, role noun, and MCP tools line each. Returns { types: { [type]: { count, version, description, roleNoun, mcpToolsLine } }, claude4spec }. Cheap — does not return schemas; call `describe` for the JSON Schema of a specific type.',
    {},
    async () => {
      const ctx = requireProject();
      if (!ctx.ok) return ctx.response;
      const result = await wrapDbAsync(() => ctx.discovery.overview());
      if (!result.ok) return result.response;
      return ok(result.value);
    },
  );

  const describe = mcpTool(
    'describe',
    'Get JSON Schemas for one entity type, per view, on demand. Returns { type, version, views, schemas }. Omit view for all of the type\'s views; pass view to narrow to one. Schemas are custom (from the serializer) or auto-derived from schema reflection (flagged "_auto").',
    {
      type: z.enum(ENTITY_TYPE_VALUES).describe('Entity type'),
      view: z
        .string()
        .optional()
        .describe('Narrow to one view; omit for all views of the type'),
    },
    async (args) => {
      const ctx = requireProject();
      if (!ctx.ok) return ctx.response;
      const type = normalizeType(String(args.type));
      if (!type) return fail('INVALID_TYPE', `unknown entity type '${args.type}'`);
      let view: ViewKind | undefined;
      if (args.view !== undefined) {
        if (!VIEW_KINDS.includes(String(args.view) as ViewKind)) {
          return fail('INVALID_VIEW', `unknown view '${args.view}'`);
        }
        view = String(args.view) as ViewKind;
      }
      const result = wrapDb(() => ctx.discovery.describeTypes({ types: [type], view }));
      if (!result.ok) return result.response;
      const described = result.value.types[0];
      if (!described) return fail('INVALID_TYPE', `entity type '${type}' is not active`);
      return ok(described);
    },
  );

  const listTags = mcpTool(
    'list_tags',
    'List all tags in the project with per-type usage counts. Returns { tags: [{ slug, name, color, description, counts }] }.',
    {},
    async () => {
      const ctx = requireProject();
      if (!ctx.ok) return ctx.response;
      // Counts stay ON for this tool: its documented contract is per-type
      // counts, and the opt-in default belongs to the new surface, not to a
      // tool whose consumers already depend on the field being there.
      const result = wrapDb(() => ctx.discovery.listTags({ withCounts: true }));
      if (!result.ok) return result.response;
      return ok({ tags: result.value.items, total: result.value.total, hasMore: result.value.hasMore });
    },
  );

  const listSlugs = mcpTool(
    'list_slugs',
    'List all entity slugs of a given type (fast autocomplete for agents). Returns { type, slugs }. The optional filterTag parameter restricts results to entities tagged with that tag slug.',
    {
      type: z.enum(ENTITY_TYPE_VALUES).describe('Entity type'),
      filterTag: z.string().optional().describe('Restrict to entities tagged with this tag slug'),
    },
    async (args) => {
      const ctx = requireProject();
      if (!ctx.ok) return ctx.response;
      const type = normalizeType(String(args.type));
      if (!type) return fail('INVALID_TYPE', `unknown entity type '${args.type}'`);
      const filterTag = args.filterTag ? String(args.filterTag) : undefined;
      const lookup = wrapDb(() =>
        ctx.discovery.listEntities({
          type,
          ...(filterTag ? { tags: [filterTag], filter: 'and' as const } : {}),
          view: 'inline_mention',
          limit: 1000,
        }),
      );
      if (!lookup.ok) return lookup.response;
      const slugs = lookup.value.mode === 'items' ? lookup.value.items.map((i) => i.slug) : [];
      return ok({ type, ...(filterTag ? { filterTag } : {}), slugs });
    },
  );

  return createMcpServer({
    name: 'c4s-reader',
    version: deps.packageVersion,
    tools: [
      getEntity,
      getEntities,
      findByTag,
      getSection,
      resolvePage,
      catalog,
      describe,
      listTags,
      listSlugs,
    ],
  });
}

/**
 * The tool-result envelope: the payload plus the serializer's own outcome.
 *
 * M39 — the outcome now travels FROM the core rather than being read off a
 * `SerializeResult` this file produced. A consumer that cannot tell a real
 * record from a fallback will present a degraded one as the truth.
 */
function envelope(data: unknown, meta: SerializedMeta): Record<string, unknown> {
  return {
    data,
    ...(meta.fallback ? { fallback: true } : {}),
    ...(meta.error ? { error: meta.error } : {}),
    ...(meta.brokenRefs && typeof data === 'object' && data !== null
      ? { brokenRefs: meta.brokenRefs }
      : {}),
  };
}
