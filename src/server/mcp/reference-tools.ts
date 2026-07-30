import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import type { TagsService } from '../services/tags.js';
import type { ReferencesService } from '../services/references.js';
import type { PagesService } from '../services/pages.js';
import type { SectionsService } from '../services/sections.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import { DomainError } from '../services/tags.js';
import { RawEntityReader, isRawEntityType, type RawEntityType } from '../discovery/raw-entity-reader.js';
import { parseXmlTagsExcludingCode, taggedListVia } from '../../shared/xml-tags.js';
import { findReferences as findReferencesCore } from '../../core/references/index.js';
import { pagesServiceSource } from '../services/references.js';
import { getExtensionReferenceType } from '../../shared/reference-extensions.js';
import type { Ac, AcBrokenVerify, AcListQuery, AcVerifyRef, EntityType } from '../../shared/entities.js';
import { readConfig, type ConsistencySeverity } from '../config.js';
import type { EntityStore } from '../services/entity-store.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import type { DiscoveryCore } from '../discovery/index.js';

/**
 * 0.2.2 — the two AC-specific methods consistency rules 9/10/11 need, named
 * STRUCTURALLY rather than by importing `AcService`.
 *
 * The rules are host-level (they run over every entity type), but their AC half
 * needs `listRaw`/`classifyVerifies`, which no generic service contract names.
 * Importing the concrete class to get them would put a plugin service back in the
 * host's compile graph — exactly what the 0.2.2 Single Abstraction Rule test
 * (`grep "import .*Service.*from '.*entities/"` outside `entities/` → 0) forbids.
 * The `Ac*` types below are host-owned shared types, so naming them is fine; it is
 * the SERVICE that must stay resolved by shape through `getEntityService('ac')`.
 */
interface AcConsistencyService {
  listRaw(query?: AcListQuery): Ac[];
  classifyVerifies(verifies: AcVerifyRef[]): AcBrokenVerify[];
}

export interface ReferenceToolsDeps {
  /** M31: per-project host (was the process singleton). */
  pluginHost: ProjectPluginHost;
  tagsService: TagsService;
  referencesService: ReferencesService;
  pagesService: PagesService;
  /**
   * M39: the read tools on this server (`list_sections`, `find_references`,
   * `check_consistency`) are adapters over the discovery core. Tag CRUD stays
   * the substance of this module; reading does not.
   */
  discovery: DiscoveryCore;
  sectionsService: SectionsService;
  ws: WsEmitter;
  db: Database;
  cwd: string;
  /** M29: persist an entity file after a tag_entity/untag_entity mutation. */
  entityStore: EntityStore;
}

interface BrokenReferenceRow {
  pagePath: string;
  tagType: string;
  type: string;
  slug: string;
  line: number;
  /** broken-reference | inactive-plugin | unknown-type — Phase 5 categorisation. */
  category: 'broken-reference' | 'inactive-plugin' | 'unknown-type';
}

export function createReferenceToolsServer(deps: ReferenceToolsDeps): McpServerInstance {
  const pluginHost = deps.pluginHost;
  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });
  const fail = (err: unknown) => {
    const code = err instanceof DomainError ? err.code : 'INTERNAL';
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: message, code }) }],
      isError: true,
    };
  };

  // entityType is open-ended now — runtime validation against the host's
  // available manifests, not a literal-union schema. Keeps the tool schema
  // stable when plugins are added/removed.
  const entityTypeSchema = z.string();

  const validateActiveType = (type: string): EntityType => {
    if (!pluginHost.getEntity(type)) {
      const known = pluginHost.listAvailable().map((m) => m.type);
      throw new DomainError(
        'VALIDATION',
        `unsupported or inactive entity type '${type}'. Active: [${known.join(', ')}]`,
      );
    }
    // Cast: EntityType is a literal union pinned to the four core plugins.
    // Runtime validation is via pluginHost.getEntity(); the narrowing exists
    // only to satisfy TagsService / ReferencesService signatures until
    // EntityType is relaxed to `string` (Phase 4 follow-up).
    return type as EntityType;
  };

  const createTag = mcpTool(
    'create_tag',
    'Create a new tag for classifying entities.',
    {
      name: z.string().describe('Display name'),
      color: z.string().optional().describe('Hex color (e.g. #4A90D9)'),
      description: z.string().optional(),
    },
    async (args) => {
      try {
        const tag = deps.tagsService.create({
          name: String(args.name),
          color: args.color as string | undefined,
          description: args.description as string | undefined,
        });
        deps.ws.broadcast({ kind: 'tag:changed', slug: tag.slug });
        return ok({ slug: tag.slug, name: tag.name });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const updateTag = mcpTool(
    'update_tag',
    'Update tag properties (name, color, description). If name changes, slug is regenerated and references in pages are updated.',
    {
      slug: z.string(),
      data: z.object({
        name: z.string().optional(),
        color: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      }),
    },
    async (args) => {
      try {
        const data = args.data as Record<string, unknown>;
        const oldSlug = String(args.slug);
        const tag = deps.tagsService.update(oldSlug, {
          name: data.name as string | undefined,
          color: data.color as string | null | undefined,
          description: data.description as string | null | undefined,
        });
        if (tag.slug !== oldSlug) {
          await deps.referencesService.propagateTagSlugChange(oldSlug, tag.slug);
        }
        deps.ws.broadcast({ kind: 'tag:changed', slug: tag.slug });
        return ok({ slug: tag.slug, updated: true });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const deleteTag = mcpTool(
    'delete_tag',
    'Delete a tag. Removes all entity-tag assignments (CASCADE).',
    { slug: z.string() },
    async (args) => {
      try {
        const result = deps.tagsService.remove(String(args.slug));
        deps.ws.broadcast({ kind: 'tag:changed', slug: String(args.slug) });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  const listTags = mcpTool(
    'list_tags',
    'List all tags with usage counts (per active plugin entity type).',
    {},
    async () => {
      try {
        const tags = deps.tagsService.list();
        return ok({
          tags: tags.map((t) => ({
            slug: t.slug,
            name: t.name,
            color: t.color,
            description: t.description,
            counts: t.counts,
          })),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const tagEntity = mcpTool(
    'tag_entity',
    'Add tags to an entity. Idempotent — already assigned tags are skipped. Creates tags if they do not exist. Replaces the entity tag set with the union of existing + new.',
    {
      type: entityTypeSchema,
      slug: z.string(),
      tags: z.array(z.string()),
    },
    async (args) => {
      try {
        const type = validateActiveType(String(args.type));
        const slug = String(args.slug);
        const newTags = args.tags as string[];
        if (!pluginHost.entityExists(type, slug)) throw new DomainError('NOT_FOUND', `${type} '${slug}' not found`);
        const existing = deps.tagsService.getEntityTagSlugs(type, slug);
        const union = [...new Set([...existing, ...newTags])];
        deps.tagsService.assignTags(type, slug, union);
        if (isRawEntityType(type)) deps.entityStore.persist(type, slug);
        deps.ws.broadcast({ kind: 'entity:changed', entityType: type, slug });
        return ok({ tagged: true, addedCount: union.length - existing.length });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const untagEntity = mcpTool(
    'untag_entity',
    'Remove tags from an entity.',
    {
      type: entityTypeSchema,
      slug: z.string(),
      tags: z.array(z.string()),
    },
    async (args) => {
      try {
        const type = validateActiveType(String(args.type));
        const slug = String(args.slug);
        const toRemove = new Set(args.tags as string[]);
        if (!pluginHost.entityExists(type, slug)) throw new DomainError('NOT_FOUND', `${type} '${slug}' not found`);
        const existing = deps.tagsService.getEntityTagSlugs(type, slug);
        const remaining = existing.filter((s) => !toRemove.has(s));
        deps.tagsService.assignTags(type, slug, remaining);
        if (isRawEntityType(type)) deps.entityStore.persist(type, slug);
        deps.ws.broadcast({ kind: 'entity:changed', entityType: type, slug });
        return ok({ untagged: true, removedCount: existing.length - remaining.length });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const findReferences = mcpTool(
    'find_references',
    'Find all pages that reference a specific entity. Static refs match by (type, slug); when `includeTagMatches` is true, dynamic refs are also reported — pages with <tagged_list/> or <tagged_list_mixed/> whose `tags` attribute intersects the entity\'s tag set (rows include `via: string[]` listing matched tags). Use to understand where an entity is used before modifying or deleting it.',
    {
      type: entityTypeSchema,
      slug: z.string(),
      includeTagMatches: z.boolean().optional(),
    },
    async (args) => {
      try {
        const type = validateActiveType(String(args.type));
        const slug = String(args.slug);
        const includeTagMatches = args.includeTagMatches === true;

        // Delegate to the serverless core (M19). Project the superset onto the
        // MCP shape: keep `via`, drop `raw`. Byte-identical to the pre-refactor
        // output (static rows first, then tag-driven rows).
        const hits = await findReferencesCore(
          {
            pages: pagesServiceSource(deps.pagesService),
            host: pluginHost,
            getEntityTagSlugs: (t, s) => deps.tagsService.getEntityTagSlugs(t as EntityType, s),
          },
          type,
          slug,
          { includeTagMatches },
        );
        const references = hits.map((h) =>
          h.via
            ? { pagePath: h.pagePath, tagType: h.tagType, line: h.line, via: h.via }
            : { pagePath: h.pagePath, tagType: h.tagType, line: h.line },
        );

        return ok({ references });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const checkConsistency = mcpTool(
    'check_consistency',
    'Run a full consistency check across pages, entities, and tags. Reports broken references in 3 categories (broken-reference / inactive-plugin / unknown-type) — including for extension tags with no `type` attr whose registered type carries an `entityType`, e.g. <diagram/> (rule 12) — plus unreferenced entities, invalid tag references, broken extension references (rule 8 — e.g. <section_ref/> with unknown anchor), broken AC verifies (rule 9), entity-without-AC-coverage (rule 10 — config-flagged via config.consistency.requireAcCoverage), module-without-AC (rule 11 — config-flagged via config.consistency.requireModuleAc). Optional filters: `severity` ("error" | "warning"), `rule` (number or name), `limit` (per-section cap; `summary` always carries full counts so a cut stays visible).',
    {
      severity: z.enum(['error', 'warning']).optional(),
      rule: z.union([z.string(), z.number()]).optional(),
      limit: z.number().int().positive().optional(),
    },
    async (args) => {
      try {
        // M39: the rules live in the discovery core, which sweeps every
        // reference-validated root. This server used to own them and could only
        // ever see the one page root it happened to hold.
        return ok(
          await deps.discovery.checkConsistency({
            severity: args.severity as 'error' | 'warning' | undefined,
            rule: args.rule as string | number | undefined,
            limit: args.limit as number | undefined,
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  /**
   * Deliberately NOT migrated to the core in this tier.
   *
   * The core's `list_sections` is a discriminated union (`by: "page" | "anchor"`)
   * with renamed rows and no fuzzy `query`. Putting that on this tool here would
   * have broken every existing caller — `list_sections({ pagePath })` fails zod
   * validation on the new required discriminator, and rows lose `pagePath` /
   * `headingText` / `lineStart` — which is exactly the kind of change this tier
   * promised not to make. An earlier revision of this branch did make it; this
   * is the revert.
   *
   * The union, the `size` measurement and the `search_pages`-then-anchor
   * replacement for `query` all land with the rest of the new tool surface in
   * Tier B, where the break is declared rather than smuggled in.
   */
  const listSections = mcpTool(
    'list_sections',
    'List sections from the section index. Filter by `anchor` (exact match), `query` (substring match on heading_text/heading_path), or `pagePath` (sections of a single page). Thin proxy over SectionsService — `section_index` is owned by M06.',
    {
      anchor: z.string().optional(),
      query: z.string().optional(),
      pagePath: z.string().optional(),
      limit: z.number().int().positive().max(2000).optional(),
    },
    async (args) => {
      try {
        const anchor = args.anchor ? String(args.anchor) : undefined;
        if (anchor) {
          const entry = deps.sectionsService.getByAnchor(anchor);
          return ok({
            sections: entry
              ? [
                  {
                    anchor: entry.anchor,
                    pagePath: entry.pagePath,
                    headingText: entry.headingText,
                    headingPath: entry.headingPath,
                    headingLevel: entry.headingLevel,
                    lineStart: entry.lineStart,
                    lineEnd: entry.lineEnd,
                  },
                ]
              : [],
          });
        }
        const entries = deps.sectionsService.list({
          pagePath: args.pagePath ? String(args.pagePath) : undefined,
          search: args.query ? String(args.query) : undefined,
          limit: args.limit as number | undefined,
        });
        return ok({
          sections: entries.map((e) => ({
            anchor: e.anchor,
            pagePath: e.pagePath,
            headingText: e.headingText,
            headingPath: e.headingPath,
            headingLevel: e.headingLevel,
            lineStart: e.lineStart,
            lineEnd: e.lineEnd,
          })),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  return createMcpServer({
    name: 'reference-tools',
    tools: [
      createTag,
      updateTag,
      deleteTag,
      listTags,
      tagEntity,
      untagEntity,
      findReferences,
      checkConsistency,
      listSections,
    ],
  });
}
