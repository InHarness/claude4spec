import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import type { TagsService } from '../services/tags.js';
import type { ReferencesService } from '../services/references.js';
import type { PagesService } from '../services/pages.js';
import type { SectionsService } from '../services/sections.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import { DomainError } from '../services/tags.js';
import { RawEntityReader, isRawEntityType, type RawEntityType } from '../domain/raw-entity-reader.js';
import { parseXmlTagsExcludingCode, taggedListVia } from '../../shared/xml-tags.js';
import { findReferences as findReferencesCore } from '../../core/references/index.js';
import { pagesServiceSource } from '../services/references.js';
import { listExtensionReferenceTypes } from '../../shared/reference-extensions.js';
import type { EntityType } from '../../shared/entities.js';
import { readConfig, type ConsistencySeverity } from '../config.js';
import type { AcService } from '../entities/ac/services.js';
import type { EntityStore } from '../services/entity-store.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

export interface ReferenceToolsDeps {
  /** M31: per-project host (was the process singleton). */
  pluginHost: ProjectPluginHost;
  tagsService: TagsService;
  referencesService: ReferencesService;
  pagesService: PagesService;
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
    'Run a full consistency check across pages, entities, and tags. Reports broken references in 3 categories (broken-reference / inactive-plugin / unknown-type), plus orphaned entity_tag rows, unreferenced entities, broken extension references (rule 8 — e.g. <section_ref/> with unknown anchor), broken AC verifies (rule 9 — always on when AC plugin active), entity-without-AC-coverage (rule 10 — config-flagged via config.consistency.requireAcCoverage), module-without-AC (rule 11 — config-flagged via config.consistency.requireModuleAc).',
    {},
    async () => {
      try {
        // Build slug sets generically — iterate the host's available plugins and
        // pull rows from SQLite via the shared RawEntityReader. Active vs.
        // inactive distinction comes from `pluginHost.getEntity(type)`.
        // Listed types stay in scope for unreferenced-entity reporting below.
        const reader = new RawEntityReader(deps.db);

        const slugSetsByType: Record<string, Set<string>> = {};
        const referencedByType: Record<string, Set<string>> = {};
        const entitiesByType: Record<string, Array<{ slug: string }>> = {};
        // Per-entity tag sets, used by rule 3 to mark tag-driven references
        // (<tagged_list>/<tagged_list_mixed>) via the shared taggedListVia predicate.
        const entityTagsByType: Record<string, Map<string, Set<string>>> = {};
        for (const m of pluginHost.listEntities()) {
          if (!isRawEntityType(m.type)) continue;
          const slugs = reader.listSlugs(m.type as RawEntityType);
          entitiesByType[m.type] = slugs.map((s) => ({ slug: s }));
          slugSetsByType[m.type] = new Set(slugs);
          referencedByType[m.type] = new Set<string>();
          const tagMap = new Map<string, Set<string>>();
          for (const s of slugs) {
            tagMap.set(s, new Set(deps.tagsService.getEntityTagSlugs(m.type, s)));
          }
          entityTagsByType[m.type] = tagMap;
        }
        const tagSlugs = new Set(deps.tagsService.list().map((t) => t.slug));

        const brokenReferences: BrokenReferenceRow[] = [];
        const invalidTagReferences: Array<{ pagePath: string; tagType: string; tag: string; line: number }> = [];
        const brokenExtensionReferences: Array<{
          pagePath: string;
          tagType: string;
          attrs: Record<string, string>;
          line: number;
          category: string;
        }> = [];

        // M30: only .md pages carry references; .html previews are excluded
        // here (read() rejects non-.md paths via resolveSafe).
        const pagePaths = await deps.pagesService.listMarkdownFiles();

        // 0.1.96: section-based checks (rule 8 <section_ref/> anchor validation)
        // only apply to SECTION-INDEXED roots. Gated on the root PROPERTY, never
        // on `rootId === 'pages'`. This context scans a single page root
        // (deps.pagesService); look up its `sectionIndexed` flag from config.
        const scanRootId = deps.pagesService.rootId;
        const scanRoot = readConfig(deps.cwd).roots.find((r) => r.id === scanRootId);
        const sectionIndexed = scanRoot?.sectionIndexed ?? false;

        const categorise = (type: string): BrokenReferenceRow['category'] | 'active' => {
          if (pluginHost.getEntity(type)) return 'active';
          if (pluginHost.getAvailable(type)) return 'inactive-plugin';
          return 'unknown-type';
        };

        for (const p of pagePaths) {
          const page = await deps.pagesService.read(p);
          for (const tag of parseXmlTagsExcludingCode(page.body)) {
            const tagType = tag.attrs.type;
            if (tag.kind !== 'tagged_list_mixed' && tagType) {
              const cat = categorise(tagType);
              const slugs =
                tag.kind === 'element_list'
                  ? (tag.attrs.slugs ?? '').split(',').map((s) => s.trim()).filter(Boolean)
                  : tag.attrs.slug
                  ? [tag.attrs.slug]
                  : [];
              if (cat !== 'active') {
                // Whole tag is broken because the type itself is not addressable.
                for (const s of slugs) {
                  brokenReferences.push({
                    pagePath: p,
                    tagType: tag.kind,
                    type: tagType,
                    slug: s,
                    line: tag.line,
                    category: cat,
                  });
                }
                continue;
              }
              const set = slugSetsByType[tagType];
              const referenced = referencedByType[tagType];
              if (!set) continue; // Active plugin but not raw-readable (shouldn't happen).
              for (const s of slugs) {
                if (set.has(s)) {
                  referenced?.add(s);
                } else {
                  brokenReferences.push({
                    pagePath: p,
                    tagType: tag.kind,
                    type: tagType,
                    slug: s,
                    line: tag.line,
                    category: 'broken-reference',
                  });
                }
              }
            }
            if (tag.kind === 'tagged_list' || tag.kind === 'tagged_list_mixed') {
              for (const t of (tag.attrs.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
                if (!tagSlugs.has(t)) invalidTagReferences.push({ pagePath: p, tagType: tag.kind, tag: t, line: tag.line });
              }
              // Rule 3 — tag-driven references: mark every entity whose tag set intersects
              // this tagged_list/tagged_list_mixed, via the shared taggedListVia predicate.
              const candidateTypes =
                tag.kind === 'tagged_list'
                  ? (tag.attrs.type ? [tag.attrs.type] : [])
                  : Object.keys(entityTagsByType);
              for (const t of candidateTypes) {
                const tagMap = entityTagsByType[t];
                const referenced = referencedByType[t];
                if (!tagMap || !referenced) continue;
                for (const [slug, etags] of tagMap) {
                  if (taggedListVia(tag, t, etags).length > 0) referenced.add(slug);
                }
              }
            }
            // Rule 8 — broken extension reference (e.g. <section_ref/> with unknown anchor).
            // M31: section_ref anchors validate against THIS context's
            // SectionsService (the process-global registry can no longer hold a
            // per-project validate closure — it would leak across workspace
            // projects). Other extensions keep the registered `validate` slot.
            if (tag.source === 'extension') {
              if (tag.kind === 'section_ref') {
                // Section rules are scoped to section-indexed roots; a non-indexed
                // root has no anchor space to validate against. anchor lookup stays
                // global (anchors are unique across roots) — no rootId to thread.
                if (!sectionIndexed) continue;
                const anchor = tag.attrs.anchor ?? '';
                if (!anchor || !deps.sectionsService.has(anchor)) {
                  brokenExtensionReferences.push({
                    pagePath: p,
                    tagType: tag.kind,
                    attrs: tag.attrs,
                    line: tag.line,
                    category: 'unknown-anchor',
                  });
                }
              } else {
                const ext = listExtensionReferenceTypes().find((e) => e.tag === tag.kind);
                if (ext?.validate) {
                  const result = ext.validate(tag.attrs);
                  if (!result.ok) {
                    brokenExtensionReferences.push({
                      pagePath: p,
                      tagType: tag.kind,
                      attrs: tag.attrs,
                      line: tag.line,
                      category: result.category,
                    });
                  }
                }
              }
            }
          }
        }

        const unreferencedEntities: Array<{ type: string; slug: string }> = [];
        for (const [type, list] of Object.entries(entitiesByType)) {
          const referenced = referencedByType[type];
          if (!referenced) continue;
          for (const e of list) if (!referenced.has(e.slug)) unreferencedEntities.push({ type, slug: e.slug });
        }

        // Rules 9/10/11 — AC-specific. Silent skip when AC plugin is not active
        // (host.getEntity('ac') === null) so projects without AC don't crash.
        const brokenAcVerifies: Array<{
          acSlug: string;
          verifyType: string;
          verifySlug: string;
          category: 'missing' | 'inactive' | 'unknown';
        }> = [];
        const entitiesWithoutAcCoverage: Array<{
          type: string;
          slug: string;
          severity: ConsistencySeverity;
        }> = [];
        const modulesWithoutAc: Array<{ module: string; severity: ConsistencySeverity }> = [];

        const acActive = pluginHost.getEntity('ac');
        if (acActive) {
          const acService = pluginHost.getEntityService('ac') as AcService | undefined;
          const config = readConfig(deps.cwd);
          const requireAcCoverage = config.consistency?.requireAcCoverage ?? 'off';
          const requireModuleAc = config.consistency?.requireModuleAc ?? 'off';

          if (acService) {
            const activeAcs = acService.list({ status: 'active' });

            // Rule 9 — broken AC verifies. AcService.classifyVerifies already
            // categorises into missing|inactive|unknown via the plugin host.
            for (const ac of activeAcs) {
              const broken = acService.classifyVerifies(ac.verifies);
              for (const b of broken) {
                brokenAcVerifies.push({
                  acSlug: ac.slug,
                  verifyType: b.type,
                  verifySlug: b.slug,
                  category: b.reason,
                });
              }
            }

            // Rule 10 — entity-without-AC-coverage. Coverage = at least one AC
            // either lists the entity in `verifies[]` or carries an `entity-{slug}` tag.
            if (requireAcCoverage !== 'off') {
              const coveredByVerifies = new Set<string>();
              const coveredByTag = new Set<string>();
              for (const ac of activeAcs) {
                for (const v of ac.verifies) {
                  coveredByVerifies.add(`${v.type}:${v.slug}`);
                }
                for (const t of ac.tags) {
                  if (t.startsWith('entity-')) {
                    coveredByTag.add(t.slice('entity-'.length));
                  }
                }
              }
              for (const [type, list] of Object.entries(entitiesByType)) {
                if (type === 'ac') continue;
                for (const e of list) {
                  const key = `${type}:${e.slug}`;
                  if (coveredByVerifies.has(key)) continue;
                  if (coveredByTag.has(e.slug)) continue;
                  entitiesWithoutAcCoverage.push({
                    type,
                    slug: e.slug,
                    severity: requireAcCoverage,
                  });
                }
              }
            }

            // Rule 11 — module-without-AC. Module = `mNN` derived from a
            // `modules/mNN-…\.md` page path. Coverage = AC carrying that mNN tag.
            if (requireModuleAc !== 'off') {
              const moduleRe = /modules\/(m\d{2})-[^/]+\.md$/;
              const modules = new Set<string>();
              for (const p of pagePaths) {
                const m = moduleRe.exec(p);
                if (m && m[1]) modules.add(m[1]);
              }
              const taggedModules = new Set<string>();
              for (const ac of activeAcs) {
                for (const t of ac.tags) {
                  if (/^m\d{2}$/.test(t)) taggedModules.add(t);
                }
              }
              for (const mod of modules) {
                if (!taggedModules.has(mod)) {
                  modulesWithoutAc.push({ module: mod, severity: requireModuleAc });
                }
              }
            }
          }
        }

        const acErrorRows =
          brokenAcVerifies.length +
          entitiesWithoutAcCoverage.filter((e) => e.severity === 'error').length +
          modulesWithoutAc.filter((m) => m.severity === 'error').length;
        const acWarningRows =
          entitiesWithoutAcCoverage.filter((e) => e.severity === 'warn').length +
          modulesWithoutAc.filter((m) => m.severity === 'warn').length;

        const errors =
          brokenReferences.length +
          invalidTagReferences.length +
          brokenExtensionReferences.length +
          acErrorRows;
        const warnings = unreferencedEntities.length + acWarningRows;
        const counts = brokenReferences.reduce<Record<string, number>>((acc, r) => {
          acc[r.category] = (acc[r.category] ?? 0) + 1;
          return acc;
        }, {});
        const extensionCounts = brokenExtensionReferences.reduce<Record<string, number>>((acc, r) => {
          const key = `${r.tagType}:${r.category}`;
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
        const acVerifyCounts = brokenAcVerifies.reduce<Record<string, number>>((acc, r) => {
          acc[r.category] = (acc[r.category] ?? 0) + 1;
          return acc;
        }, {});
        return ok({
          brokenReferences,
          brokenReferenceCounts: counts,
          orphanedEntityTags: [],
          unreferencedEntities,
          invalidTagReferences,
          brokenExtensionReferences,
          brokenExtensionReferenceCounts: extensionCounts,
          brokenAcVerifies,
          brokenAcVerifyCounts: acVerifyCounts,
          entitiesWithoutAcCoverage,
          modulesWithoutAc,
          summary: { total: errors + warnings, errors, warnings },
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

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
