import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { z } from 'zod';
import { toolFailure } from '../operations/envelope.js';
import type { TagsService } from '../services/tags.js';
import type { ReferencesService } from '../services/references.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import { DomainError } from '../services/tags.js';

import type { EntityType } from '../../shared/entities.js';
import type { EntityStore } from '../services/entity-store.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { isDiscoveryError, MAX_ANCHORS_PER_CALL, type DiscoveryCore } from '../discovery/index.js';

/**
 * `reference-tools` — tag CRUD, and the in-process transport over the M39
 * discovery core's read side.
 *
 * Two ownerships in one server, deliberately. Writing a tag is the substance of
 * this module. READING — sections, pages, references, consistency, tags — is
 * the core's, and every read tool here is a thin adapter over it, so the chat
 * agent sees exactly the semantics the CLI and the external `c4s-reader` see.
 * The asymmetry where the built-in agent reached for the filesystem while an
 * external one got operations is gone at the level of the contract.
 *
 * 0.2.3 moved the last read tools across: `list_sections` takes the core's
 * discriminated union, `find_references` its target union and full sweep,
 * `list_tags` its opt-in counts — and `list_pages` / `search_pages` /
 * `get_page` / `get_sections` arrived, which is what makes `Glob` / `Grep` /
 * `Read` replaceable at all.
 */
export interface ReferenceToolsDeps {
  /** M31: per-project host (was the process singleton). */
  pluginHost: ProjectPluginHost;
  tagsService: TagsService;
  referencesService: ReferencesService;
  /**
   * M39: every read tool on this server is an adapter over the discovery core.
   * Tag CRUD stays the substance of this module; reading does not.
   */
  discovery: DiscoveryCore;
  ws: WsEmitter;
  /** M29: persist an entity file after a tag_entity/untag_entity mutation. */
  entityStore: EntityStore;
}

export function createReferenceToolsServer(deps: ReferenceToolsDeps): CapturedMcpServer {
  const pluginHost = deps.pluginHost;
  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });
  const fail = (err: unknown) => {
    /**
     * A core error already carries its code, its message AND its navigation —
     * every `*_NOT_FOUND` lists alternatives, every `INVALID_ARGUMENT` states
     * the call that would have worked. Collapsing it to `INTERNAL` here would
     * throw away the half that tells the agent what to do next, which is the
     * whole point of the core's error catalogue.
     */
    // The shared envelope. `toolFailure` reads `code`/`hint` structurally, so a
    // discovery error and a domain error come out the same shape — which is what
    // the branch below used to spell twice, differently.
    return toolFailure(err);
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
    'List the project tags, paginated. `withCounts` is OFF by default because full per-type counts are a cartesian product of tags by active types — ask for them when you need them, or use `minCount` to keep only tags used at least N times. `coOccurringWith` takes a tag slug and returns the tags sharing entities with it, with multiplicity: the way to discover a taxonomy without already knowing it. Returns { items, total, hasMore }.',
    {
      withCounts: z.boolean().optional().describe('Include per-type usage counts; default false'),
      minCount: z.number().int().nonnegative().optional().describe('Only tags used at least this many times'),
      coOccurringWith: z.string().optional().describe('Tag slug — return the tags sharing entities with it'),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (args) => {
      try {
        return ok(
          deps.discovery.listTags({
            withCounts: args.withCounts === true,
            minCount: args.minCount as number | undefined,
            coOccurringWith: args.coOccurringWith as string | undefined,
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
          }),
        );
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
        deps.entityStore.persist(type, slug);
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
        deps.entityStore.persist(type, slug);
        deps.ws.broadcast({ kind: 'entity:changed', entityType: type, slug });
        return ok({ untagged: true, removedCount: existing.length - remaining.length });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const findReferences = mcpTool(
    'find_references',
    'Who points at this? Three targets: { target: "entity", type, slug } — which pages embed it, and with `includeTagMatches` also the <tagged_list/> / <tagged_list_mixed/> pages whose `tags` intersect the entity\'s (those rows carry `via: string[]`); { target: "section", anchor } — who cites this section; { target: "page", rootId, path } — who links this page, full key required. Calling without `target` returns INVALID_ARGUMENT listing the variants. A target with no references is a SUCCESS with an empty list and total: 0. Rows carry `rootId`, and the sweep covers every reference-validated root. Scope is document edges — entity-to-entity links specific to a type (ac.verifies, foreign keys) are entity data, and check_consistency rule 9 reports their integrity. Use it to see where something is used before modifying or deleting it.',
    {
      target: z.enum(['entity', 'section', 'page']).optional().describe('Identity regime of the target; required'),
      type: entityTypeSchema.optional().describe('With target:"entity" — entity type'),
      slug: z.string().optional().describe('With target:"entity" — entity slug'),
      anchor: z.string().optional().describe('With target:"section" — section anchor'),
      rootId: z.string().optional().describe('With target:"page" — which page root'),
      path: z.string().optional().describe('With target:"page" — page path relative to the root'),
      includeTagMatches: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (args) => {
      try {
        // M39: the sweep is the core's. This tool used to call the M19 core
        // directly over ONE page source — the one `PagesService` it happened to
        // hold — so a reference from any other root was invisible to it.
        return ok(
          await deps.discovery.findReferences({
            target: args.target,
            type: args.type === undefined ? undefined : String(args.type),
            slug: args.slug === undefined ? undefined : String(args.slug),
            anchor: args.anchor === undefined ? undefined : String(args.anchor),
            rootId: args.rootId === undefined ? undefined : String(args.rootId),
            path: args.path === undefined ? undefined : String(args.path),
            includeTagMatches: args.includeTagMatches === true,
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
          } as Parameters<DiscoveryCore['findReferences']>[0]),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const checkConsistency = mcpTool(
    'check_consistency',
    'Run a full consistency check across pages, entities, and tags. Reports broken references in 3 categories (broken-reference / inactive-plugin / unknown-type) — always resolved from the tag\'s `type` attribute, for every entity type including hidden ones like `diagram` (rule 12) — plus unreferenced entities, invalid tag references, broken extension references (rule 8 — e.g. <section_ref/> with unknown anchor), broken AC verifies (rule 9), entity-without-AC-coverage (rule 10 — config-flagged via config.consistency.requireAcCoverage), module-without-AC (rule 11 — config-flagged via config.consistency.requireModuleAc), duplicate anchors (rule 13 — one anchor comment on two headings, which makes every <section_ref/> to it ambiguous; the row lists EVERY location so you can tell which copy to re-anchor). Optional filters: `severity` ("error" | "warning"), `rule` (number or name), `limit` (per-bucket cap). The envelope carries `truncated: true` whenever `limit` actually cut a bucket — `summary` always counts the WHOLE project, before any filter, so it is not a way to tell how much you were given.',
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

  const listSections = mcpTool(
    'list_sections',
    'List sections, either of one page — { by: "page", rootId, path } — or the single section an anchor names — { by: "anchor", anchor }, which also reports `is_known` for an anchor that does not exist. Every row carries its `size`, so the volume of a section is knowable BEFORE fetching them with get_sections. There is no fuzzy heading search: a heading substring is not an identity, so to find a section by text call search_pages and then list_sections({ by: "anchor" }) on the hit. Calling without `by` returns INVALID_ARGUMENT listing both variants.',
    {
      by: z.enum(['page', 'anchor']).optional().describe('Identity regime; required'),
      rootId: z.string().optional().describe('With by:"page" — which page root'),
      path: z.string().optional().describe('With by:"page" — page path relative to the root'),
      anchor: z.string().optional().describe('With by:"anchor" — 6-12 lowercase alphanumerics'),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (args) => {
      try {
        return ok(
          await deps.discovery.listSections({
            by: args.by,
            rootId: args.rootId === undefined ? undefined : String(args.rootId),
            path: args.path === undefined ? undefined : String(args.path),
            anchor: args.anchor === undefined ? undefined : String(args.anchor),
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
          } as Parameters<DiscoveryCore['listSections']>[0]),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  /**
   * 0.2.3 item 14, stage one: operational parity.
   *
   * Reading the specification used to be something this agent did with `Glob`,
   * `Grep` and `Read` — an undocumented fourth transport with no pagination, no
   * measurement, and no notion of a page root, which is why `Glob **\/*.md`
   * could see briefs, patches and the entity catalogue. These four tools are
   * the domain replacement: they address pages as `(rootId, relPath)` over
   * `config.roots[]`, so there is no value of any parameter that names those
   * directories. The barrier is the absence of an address, not a rule in a
   * prompt.
   *
   * Stage one is parity ONLY. The built-ins stay available and the prompt does
   * not yet prefer these; that call belongs to the next release and to turn
   * telemetry, not to this diff.
   */
  const listPages = mcpTool(
    'list_pages',
    'List the pages of one root, paginated, each with a title, section count, byte size and mtime — the domain replacement for globbing the specification. `rootId` is required because the same relative path can exist in several roots; `sort` is an explicit parameter ("path" by default and deterministic, or "modified"). The root list holds page roots only, so no call here can name a brief, a patch or the entity catalogue.',
    {
      rootId: z.string().describe('Which page root'),
      prefix: z.string().optional().describe('Restrict to paths starting with this prefix'),
      sort: z.enum(['path', 'modified']).optional().describe('Order; default "path"'),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (args) => {
      try {
        return ok(
          await deps.discovery.listPages({
            rootId: String(args.rootId),
            prefix: args.prefix === undefined ? undefined : String(args.prefix),
            sort: args.sort as 'path' | 'modified' | undefined,
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const searchPages = mcpTool(
    'search_pages',
    'Search the prose of the pages by phrase (`query`) or regex (`regex`) — the domain replacement for grepping the specification, and the one search the entity graph cannot stand in for, because it looks for exactly what fell OUT of the graph (a bare HTTP path, a DTO name mentioned in running text). Three modes: "hits" (default) returns matches, "pages" returns which pages match and how often, "count" returns only a total. A hit on a section-indexed root comes back as an `anchor` — collect the anchors and feed them to get_sections in one call; on a plain root as (rootId, path, line).',
    {
      query: z.string().optional().describe('Phrase to look for'),
      regex: z.string().optional().describe('Regular expression; first-class, not a fallback'),
      rootId: z.string().optional().describe('Restrict to one root; omit to search all of them'),
      mode: z.enum(['hits', 'pages', 'count']).optional().describe('Shape of the answer; default "hits"'),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (args) => {
      try {
        return ok(
          await deps.discovery.searchPages({
            query: args.query === undefined ? undefined : String(args.query),
            regex: args.regex === undefined ? undefined : String(args.regex),
            rootId: args.rootId === undefined ? undefined : String(args.rootId),
            mode: args.mode as 'hits' | 'pages' | 'count' | undefined,
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const getSections = mcpTool(
    'get_sections',
    `Read sections BY ANCHOR — pass every anchor you need in ONE call; one anchor is simply a list of one. Search hits, a reference sweep and a section listing all hand you a LIST of anchors, and fetching them one per call is the cost this tool exists to remove. Each comes back as its own item in \`results\`, in the order asked for (duplicates silently collapsed), carrying the heading, the coordinates and the body as authored — XML tags left untouched, because a tag is an edge and expanding it would paste the payload in and destroy the edge. The outgoing edges arrive parsed alongside the body (\`edges.sectionRefs\` / \`entityEmbeds\` / \`pageLinks\`), so you never parse markdown yourself; to follow an embed, call get_entities with the slug it carries. The item is \`{ anchor, rootId, page_path, heading_text, heading_level, line_start, line_end, body, truncated?, edges }\` — there is no \`content_hash\`: the response carries the content itself, so there is nothing left for a version of it to settle. An anchor that is not addressable comes back as \`{ anchor, error, code: "SECTION_NOT_FOUND" }\` in its own slot rather than failing the batch, and that happens two ways with two different remedies: the anchor is unknown (the message points at search_pages / list_sections), or it resolves onto a root that carries no section index (the message points at get_page). \`anchors\` has a hard length limit of ${MAX_ANCHORS_PER_CALL} (exceeding it, or passing none, is INVALID_ARGUMENT stating the limit) and the response has a size budget: past it, items keep their coordinates and edges but lose \`body\` and are marked \`truncated: true\` — never dropped in silence, and the envelope's \`message\` says how to retry. The FIRST item never degrades that way: if its body alone exceeds the budget it comes back shortened as text with \`truncated: true\`, because a one-anchor call is already the smallest retry and "ask for fewer" would otherwise be unfollowable. \`includeSubtree\` adds the lower headings beneath each anchor; an anchor already covered by another one's subtree comes back as \`{ anchor, coveredBy }\` instead of repeating the body. An anchor names exactly ONE section. If a duplicate anchor slips into the pages anyway, the read is still deterministic rather than a coin flip on directory order: the occurrence with the lowest (rootId, page_path) owns the anchor, and within one page the first (lowest line) occurrence wins. \`check_consistency\` rule 13 reports the collision with every location so it gets fixed.`,
    {
      anchors: z
        .array(z.string())
        .describe('Section anchors (6-12 lowercase alphanumerics each), in order'),
      includeSubtree: z.boolean().optional().describe('Include the subtree of lower headings'),
    },
    async (args) => {
      try {
        return ok(
          await deps.discovery.getSections({
            anchors: (args.anchors as string[]).map(String),
            includeSubtree: args.includeSubtree === true,
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const getPage = mcpTool(
    'get_page',
    'Read one page as authored — XML tags untouched — addressed by the FULL key (rootId, path). A bare path is ambiguous across roots, so a call without `rootId` returns INVALID_ARGUMENT with the root list rather than guessing the built-in one. `range` is a line window and is allowed only on roots WITHOUT a section index; on an indexed root it is refused with a pointer to list_sections + get_sections, which is semantic, measurable up front and carries its own edges. Embeds are never expanded — fetch the entity by slug instead.',
    {
      rootId: z.string().optional().describe('Which page root — required'),
      path: z.string().optional().describe('Page path relative to the root'),
      range: z
        .object({ start: z.number().int().positive(), end: z.number().int().positive() })
        .optional()
        .describe('1-based inclusive line window; only on roots without a section index'),
    },
    async (args) => {
      try {
        return ok(
          await deps.discovery.getPage({
            rootId: args.rootId === undefined ? undefined : String(args.rootId),
            path: args.path === undefined ? undefined : String(args.path),
            range: args.range as { start: number; end: number } | undefined,
          } as Parameters<DiscoveryCore['getPage']>[0]),
        );
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
      listPages,
      searchPages,
      getSections,
      getPage,
    ],
  });
}
