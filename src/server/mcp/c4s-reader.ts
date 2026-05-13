import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import {
  isRawEntityType,
  type RawEntity,
  type RawEntityReader,
  type RawEntityType,
} from '../domain/raw-entity-reader.js';
import { serializationEngine } from '../core/plugin-host/serialization-engine.js';
import { resolvePageContent } from '../serialization/resolve-page.js';
import type { SerializeResult, ViewKind } from '../serialization/types.js';
import fs from 'node:fs';
import path from 'node:path';

export interface C4sReaderDeps {
  reader: RawEntityReader | null;
  registry: typeof serializationEngine;
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
    | { ok: true; reader: RawEntityReader; db: Database.Database; projectDir: string }
    | { ok: false; response: ReturnType<typeof fail> } => {
    if (!deps.reader || !deps.db || !deps.projectDir) {
      return {
        ok: false,
        response: fail(
          'PROJECT_NOT_FOUND',
          'no claude4spec project loaded',
          'pass --project <path> when starting c4s-mcp',
        ),
      };
    }
    return { ok: true, reader: deps.reader, db: deps.db, projectDir: deps.projectDir };
  };

  const wrapDb = <T>(fn: () => T): { ok: true; value: T } | { ok: false; response: ReturnType<typeof fail> } => {
    try {
      return { ok: true, value: fn() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = /no such table|no such column/i.test(message) ? 'SCHEMA_OUT_OF_DATE' : 'INTERNAL';
      const hint = code === 'SCHEMA_OUT_OF_DATE' ? 'run `npx claude4spec` to migrate' : undefined;
      return { ok: false, response: fail(code, message, hint) };
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
      const lookup = wrapDb(() => ctx.reader.getEntity(type, slug));
      if (!lookup.ok) return lookup.response;
      if (!lookup.value) return fail('ENTITY_NOT_FOUND', `${type}/${slug} not found`);
      const serialized = deps.registry.serializeEntity(type, view, lookup.value, ctx.reader);
      return ok({ type, slug, view, ...envelope(serialized) });
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
      const lookup = wrapDb(() => ctx.reader.getEntities(type, slugs));
      if (!lookup.ok) return lookup.response;
      const items = lookup.value.items.map((entity) => ({
        slug: entity.slug,
        ...envelope(deps.registry.serializeEntity(type, view, entity, ctx.reader)),
      }));
      return ok({ type, view, items, missing: lookup.value.missing });
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
        const lookup = wrapDb(() => ctx.reader.findByTag({ type: typeArg, tags, filter }));
        if (!lookup.ok) return lookup.response;
        const items = lookup.value.map((entity: RawEntity) => ({
          slug: entity.slug,
          ...envelope(deps.registry.serializeEntity(typeArg, view, entity, ctx.reader)),
        }));
        return ok({ type: typeArg, view, query: { tags, filter }, items });
      }

      const lookup = wrapDb(() => ctx.reader.findByTag({ tags, filter }));
      if (!lookup.ok) return lookup.response;
      const groups: Record<string, unknown[]> = {
        endpoints: [],
        dtos: [],
        'database-tables': [],
        'ui-views': [],
        acs: [],
      };
      const bucket: Record<RawEntityType, string> = {
        endpoint: 'endpoints',
        dto: 'dtos',
        'database-table': 'database-tables',
        'ui-view': 'ui-views',
        ac: 'acs',
      };
      for (const entity of lookup.value) {
        const item = {
          slug: entity.slug,
          ...envelope(deps.registry.serializeEntity(entity.type, view, entity, ctx.reader)),
        };
        groups[bucket[entity.type]]!.push(item);
      }
      return ok({ view, query: { tags, filter }, ...groups });
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
      const view: ViewKind = (args.view as ViewKind | undefined) ?? 'single_element';
      const lookup = wrapDb(() => ctx.reader.getSection(anchor));
      if (!lookup.ok) return lookup.response;
      if (!lookup.value) return fail('SECTION_NOT_FOUND', `section '${anchor}' not found`);
      const serialized = deps.registry.serializeSection(view, lookup.value, ctx.reader);
      return ok({
        anchor,
        view,
        ...envelope(serialized),
      });
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
        resolvePageContent(md, { reader: ctx.reader, registry: deps.registry }),
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
    'Discover all entity types, their available views, JSON Schemas per view, and per-type version. Returns { types: { [type]: { version, views, schemas } }, claude4spec }. Use this to learn what get_entity/get_entities can return.',
    {},
    async () => {
      const ctx = requireProject();
      if (!ctx.ok) return ctx.response;
      const result = wrapDb(() => deps.registry.catalog(ctx.reader, ctx.db));
      if (!result.ok) return result.response;
      return ok({ ...result.value, claude4spec: deps.packageVersion });
    },
  );

  const listTags = mcpTool(
    'list_tags',
    'List all tags in the project with per-type usage counts. Returns { tags: [{ slug, name, color, description, counts }] }.',
    {},
    async () => {
      const ctx = requireProject();
      if (!ctx.ok) return ctx.response;
      const result = wrapDb(() => ctx.reader.listTags());
      if (!result.ok) return result.response;
      return ok({ tags: result.value });
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
      if (filterTag) {
        const lookup = wrapDb(() => ctx.reader.findByTag({ type, tags: [filterTag], filter: 'and' }));
        if (!lookup.ok) return lookup.response;
        return ok({ type, filterTag, slugs: lookup.value.map((e) => e.slug) });
      }
      const lookup = wrapDb(() => ctx.reader.listSlugs(type));
      if (!lookup.ok) return lookup.response;
      return ok({ type, slugs: lookup.value });
    },
  );

  return createMcpServer({
    name: 'c4s-reader',
    version: deps.packageVersion,
    tools: [getEntity, getEntities, findByTag, getSection, resolvePage, catalog, listTags, listSlugs],
  });
}

function envelope(result: SerializeResult): Record<string, unknown> {
  const data = result.data;
  if (typeof data === 'object' && data !== null) {
    return {
      data,
      ...(result.fallback ? { fallback: true } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.brokenRefs ? { brokenRefs: result.brokenRefs } : {}),
    };
  }
  return {
    data,
    ...(result.fallback ? { fallback: true } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}
