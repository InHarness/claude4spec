import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { isDiscoveryError, MAX_ANCHORS_PER_CALL, type DiscoveryCore } from '../discovery/index.js';
import type { ViewKind } from '../serialization/types.js';

/**
 * `c4s-reader` — the external stdio transport over the M39 discovery core.
 *
 * Fourteen tools, named 1:1 with the core operations, and nothing else. This
 * file maps the MCP protocol onto the core and core error codes onto
 * `tool_result`; it does not decide what pagination means, which types exist,
 * how an entity is serialized, or what an error should suggest next.
 *
 * 0.2.3 replaced the previous nine tools, and the new set is not a superset of
 * the old one. The old set reached only six of the fourteen operations, and did
 * so through a hardcoded four-value type enum, so a plugin-contributed type was
 * unreachable from here even when the core could answer for it. Five names went
 * away because the operation they fronted was renamed or absorbed —
 * `catalog`→`overview`, `describe`→`describe_types`, `get_entity`→`get_entities`
 * (one slug is the degenerate list), `find_by_tag`→`list_entities`,
 * `list_slugs`→`list_entities` with the minimal view — and `resolve_page` went
 * away because expanding embeds is a RENDER concern rather than a read
 * contract: a tag is an edge, and pasting the payload in destroys the edge. The
 * surviving surface for expansion is `c4s resolve` in the CLI.
 *
 * Every tool here is read-only, and structurally so rather than by review: the
 * core exposes no mutating operation, so there is no path from this process to
 * a write.
 */
export interface C4sReaderDeps {
  reader: RawEntityReader | null;
  /**
   * Held only so a caller can construct this server the same way it constructs
   * the core. Serialization is reached exclusively THROUGH the core (M39's
   * registry rule), so nothing in this file touches it.
   */
  registry: SerializationEngine;
  /**
   * M39: the discovery core, already bound to a resolved project. Null on a
   * degraded start (no project) — the tools then answer `PROJECT_NOT_FOUND`
   * rather than the process exiting, because an stdio server that dies hands
   * the agent an EOF where it needed a diagnosis.
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

/**
 * The tool names this server exposes, in the order the brief lists the
 * operations. Exported so the architecture gate can assert the set instead of
 * trusting the prose above it.
 */
export const C4S_READER_TOOL_NAMES = [
  'overview',
  'describe_types',
  'list_pages',
  'list_sections',
  'get_sections',
  'get_page',
  'search_pages',
  'search_entities',
  'list_entities',
  'get_entities',
  'list_tags',
  'find_references',
  'check_consistency',
  'resolve_identity',
] as const;

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
    | { ok: true; discovery: DiscoveryCore }
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
    return { ok: true, discovery: deps.discovery };
  };

  /**
   * The one error mapping. A core error already carries its code, its message
   * and its navigation — the transport RE-FRAMES it, it does not re-invent it,
   * and it never drops the hint.
   *
   * `no such table` / `no such column` is the shape a pending migration takes
   * when it reaches a readonly reader. This server deliberately does NOT
   * migrate, so the hint names the process that does. Sync and async operations
   * share this path: they used to differ, and the async half reported a pending
   * migration as a bare `INTERNAL`.
   */
  const wrapCall = async <T>(
    fn: () => T | Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; response: ReturnType<typeof fail> }> => {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      if (isDiscoveryError(err)) return { ok: false, response: fail(err.code, err.message, err.hint) };
      const message = err instanceof Error ? err.message : String(err);
      if (/no such table|no such column/i.test(message)) {
        return {
          ok: false,
          response: fail('SCHEMA_OUT_OF_DATE', message, 'run `npx @inharness-ai/claude4spec` to migrate'),
        };
      }
      return { ok: false, response: fail('INTERNAL', message) };
    }
  };

  /**
   * `database_table` → `database-table`. A normalization, not a gate: an
   * unrecognized type falls through to the core, whose `INVALID_TYPE` lists the
   * types that ARE active. Refusing it here would answer with strictly less.
   */
  const normalizeType = (raw: unknown): string => {
    const value = String(raw);
    return value === 'database_table' ? 'database-table' : value;
  };

  const optionalString = (value: unknown): string | undefined =>
    value === undefined || value === null ? undefined : String(value);
  const optionalNumber = (value: unknown): number | undefined =>
    value === undefined || value === null ? undefined : Number(value);

  /** Every list operation takes these; the core owns their defaults and caps. */
  const pageShape = {
    limit: z.number().int().positive().optional().describe('Page size; the core applies a default and a cap'),
    offset: z.number().int().nonnegative().optional().describe('Rows to skip; a stable sort makes it meaningful'),
  };

  const viewShape = z
    .enum(VIEW_KINDS)
    .optional()
    .describe('Record shape — the width of a row, independent of how many rows come back');

  /**
   * One handler shape for all fourteen: guard the project, call the operation,
   * return what it returned. A tool that reshapes the result is a tool that has
   * started to own behaviour.
   */
  const op = <T>(
    name: (typeof C4S_READER_TOOL_NAMES)[number],
    description: string,
    inputSchema: Record<string, unknown>,
    call: (discovery: DiscoveryCore, args: Record<string, unknown>) => T | Promise<T>,
  ) =>
    mcpTool(name, description, inputSchema, async (args) => {
      const ctx = requireProject();
      if (!ctx.ok) return ctx.response;
      const result = await wrapCall(() => call(ctx.discovery, args));
      if (!result.ok) return result.response;
      return ok(result.value);
    });

  // ── Meta ──────────────────────────────────────────────────────────────────

  const overview = op(
    'overview',
    'ENTRY POINT. One call that says what this specification contains: page roots with their properties (sectionIndexed / referenceValidated / pageCount), the active entity types with a row count and serializer version each, the tag count, and the claude4spec version. Root properties are part of the payload because they decide how a hit is addressed — a section-indexed root answers with an `anchor`, a plain one with (rootId, path, line). Cheap: no schemas, no views; call describe_types for those.',
    {},
    (discovery) => discovery.overview(),
  );

  const describeTypes = op(
    'describe_types',
    'JSON Schemas and views per entity type, plus `searchableFields` — the paths a search_entities call would actually cover for that type, so one call answers both "what shape is this" and "what would search see". Omit `types` for every active type. Schemas come from the type\'s serializer, or are derived by index reflection and flagged "_auto". A type deactivated in config answers INVALID_TYPE with the active list, never a raw-JSON fallback.',
    {
      types: z.array(z.string()).optional().describe('Restrict to these types; omit for all active types'),
      // An enum, not a free string: an unrecognized view used to be forwarded to
      // the serializer, which answered with whatever its if-chain fell through
      // to. The tool then reported a view that does not exist, and the LATER
      // call using it was the one that failed.
      view: viewShape,
    },
    (discovery, args) =>
      discovery.describeTypes({
        types: (args.types as string[] | undefined)?.map(normalizeType),
        view: optionalString(args.view) as ViewKind | undefined,
      }),
  );

  // ── Pages and sections ────────────────────────────────────────────────────

  const listPages = op(
    'list_pages',
    'List the pages of one root, paginated, each with a title, section count, byte size and mtime. This is the full replacement for globbing the specification: `rootId` is required because the same relative path can exist in several roots, `sort` is an explicit parameter ("path" by default and deterministic, or "modified"), and the root list holds page roots only — there is no way to name a brief, a patch or the entity catalogue from here.',
    {
      rootId: z.string().describe('Which page root — see overview().roots'),
      prefix: z.string().optional().describe('Restrict to paths starting with this prefix'),
      sort: z.enum(['path', 'modified']).optional().describe('Order; default "path" (deterministic)'),
      ...pageShape,
    },
    (discovery, args) =>
      discovery.listPages({
        rootId: String(args.rootId),
        prefix: optionalString(args.prefix),
        sort: args.sort as 'path' | 'modified' | undefined,
        limit: optionalNumber(args.limit),
        offset: optionalNumber(args.offset),
      }),
  );

  const listSections = op(
    'list_sections',
    'List sections, either of one page — { by: "page", rootId, path } — or the single section an anchor names — { by: "anchor", anchor }. Every row carries its `size`, so the volume of a section is knowable BEFORE fetching it. There is no fuzzy heading search here: to find a section by text, call search_pages and then list_sections({ by: "anchor" }) on the hit. Calling without `by` returns INVALID_ARGUMENT listing both variants.',
    {
      by: z.enum(['page', 'anchor']).optional().describe('Identity regime; required'),
      rootId: z.string().optional().describe('With by:"page" — which root'),
      path: z.string().optional().describe('With by:"page" — page path relative to the root'),
      anchor: z.string().optional().describe('With by:"anchor" — 6-12 lowercase alphanumerics'),
      ...pageShape,
    },
    (discovery, args) =>
      discovery.listSections({
        by: args.by,
        rootId: optionalString(args.rootId),
        path: optionalString(args.path),
        anchor: optionalString(args.anchor),
        limit: optionalNumber(args.limit),
        offset: optionalNumber(args.offset),
      } as Parameters<DiscoveryCore['listSections']>[0]),
  );

  const getSections = op(
    'get_sections',
    `Read sections BY ANCHOR — pass every anchor you need in ONE call; one anchor is simply a list of one. Search hits, a reference sweep and a section listing all hand you a LIST of anchors, and fetching them one per call is the cost this operation exists to remove. Each comes back as its own item in \`results\`, in the order asked for (duplicates silently collapsed), carrying the heading, the coordinates and the body as authored — XML tags left untouched, because a tag is an edge and expanding it would paste the payload in and destroy the edge. The outgoing edges arrive parsed alongside the body (\`edges.sectionRefs\` / \`entityEmbeds\` / \`pageLinks\`), so a consumer never parses markdown itself; to follow an embed, call get_entities with the slug it carries. The item is \`{ anchor, rootId, page_path, heading_text, heading_level, line_start, line_end, body, truncated?, edges }\` — there is no \`content_hash\`: the response carries the content itself, so there is nothing left for a version of it to settle. An anchor that is not addressable comes back as \`{ anchor, error, code: "SECTION_NOT_FOUND" }\` in its own slot rather than failing the batch, and that happens two ways with two different remedies: the anchor is unknown (the message points at search_pages / list_sections), or it resolves onto a root that carries no section index (the message points at get_page). \`anchors\` has a hard length limit of ${MAX_ANCHORS_PER_CALL} (exceeding it, or passing none, is INVALID_ARGUMENT stating the limit) and the response has a size budget: past it, items keep their coordinates and edges but lose \`body\` and are marked \`truncated: true\` — never dropped in silence, and the envelope's \`message\` says how to retry. The FIRST item never degrades that way: if its body alone exceeds the budget it comes back shortened as text with \`truncated: true\`, because a one-anchor call is already the smallest retry and "ask for fewer" would otherwise be unfollowable. \`includeSubtree\` adds the lower headings beneath each anchor; an anchor already covered by another one's subtree comes back as \`{ anchor, coveredBy }\` instead of repeating the body.`,
    {
      anchors: z
        .array(z.string())
        .describe('Section anchors (6-12 lowercase alphanumerics each), in order'),
      includeSubtree: z.boolean().optional().describe('Include the subtree of lower headings'),
    },
    (discovery, args) =>
      discovery.getSections({
        anchors: (args.anchors as string[]).map(String),
        includeSubtree: args.includeSubtree === true,
      }),
  );

  const getPage = op(
    'get_page',
    'Read one page as authored — XML tags untouched — addressed by the FULL key (rootId, path). A bare path is ambiguous across roots, so a call without `rootId` returns INVALID_ARGUMENT with the root list rather than guessing the built-in one. `range` is a line window and is allowed only on roots WITHOUT a section index; on an indexed root it is refused with a pointer to list_sections + get_sections, which is a better window in every way. Embeds are never expanded — fetch the entity by slug instead.',
    {
      rootId: z.string().optional().describe('Which page root — required; see overview().roots'),
      path: z.string().optional().describe('Page path relative to the root'),
      range: z
        .object({ start: z.number().int().positive(), end: z.number().int().positive() })
        .optional()
        .describe('1-based inclusive line window; only on roots without a section index'),
    },
    (discovery, args) =>
      discovery.getPage({
        rootId: optionalString(args.rootId),
        path: optionalString(args.path),
        range: args.range as { start: number; end: number } | undefined,
      } as Parameters<DiscoveryCore['getPage']>[0]),
  );

  // ── Search ────────────────────────────────────────────────────────────────

  const searchPages = op(
    'search_pages',
    'Search the prose of the pages, by phrase (`query`) or by regex (`regex`) — the replacement for grepping the specification, and the one search the entity graph cannot stand in for, because it looks for exactly what fell OUT of the graph (a bare HTTP path, a DTO name mentioned in running text). Three modes: "hits" (default) returns matches, "pages" returns which pages match and how often, "count" returns only a total. A hit on a section-indexed root comes back as an `anchor`; on a plain root as (rootId, path, line).',
    {
      query: z.string().optional().describe('Phrase to look for'),
      regex: z.string().optional().describe('Regular expression; first-class, not a fallback'),
      rootId: z.string().optional().describe('Restrict to one root; omit to search all of them'),
      mode: z.enum(['hits', 'pages', 'count']).optional().describe('Shape of the answer; default "hits"'),
      ...pageShape,
    },
    (discovery, args) =>
      discovery.searchPages({
        query: optionalString(args.query),
        regex: optionalString(args.regex),
        rootId: optionalString(args.rootId),
        mode: args.mode as 'hits' | 'pages' | 'count' | undefined,
        limit: optionalNumber(args.limit),
        offset: optionalNumber(args.offset),
      }),
  );

  const searchEntities = op(
    'search_entities',
    'Text search within exactly ONE entity type — `type` is required, because a cross-type ranking federates badly and lets a single call return hundreds of rows; use resolve_identity to search identities across types. The scope is layered: your `fields` beats the type\'s own declaration, which beats the host default over every text path of the type\'s schema, so every active type is searchable. The response always carries `searchedFields`: without it an empty result is indistinguishable from a field that was never in scope.',
    {
      type: z.string().describe('Exactly one entity type'),
      query: z.string().describe('Text to look for'),
      fields: z
        .array(z.string())
        .optional()
        .describe('Dotted paths to search, e.g. fields[].description; overrides the type and host scope'),
      view: viewShape,
      mode: z.enum(['hits', 'count']).optional().describe('Shape of the answer; default "hits"'),
      ...pageShape,
    },
    (discovery, args) =>
      discovery.searchEntities({
        type: normalizeType(args.type),
        query: String(args.query),
        fields: args.fields as string[] | undefined,
        view: args.view as ViewKind | undefined,
        mode: args.mode as 'hits' | 'count' | undefined,
        limit: optionalNumber(args.limit),
        offset: optionalNumber(args.offset),
      }),
  );

  // ── Graph ─────────────────────────────────────────────────────────────────

  const listEntities = op(
    'list_entities',
    'Complete, paginated traversal of one entity type, optionally narrowed to tags. This is what lets search be best-effort rather than load-bearing: an entity with no tags is still reachable by enumeration, so tags are an accelerator and not a closure. Resolves <tagged_list type="..." tags="a,b" filter="and"/>. `mode: "count"` answers "how many entities carry tag X" without walking them. An EMPTY tags array filters by nothing and so matches nothing; omit it for no tag filter.',
    {
      type: z.string().describe('Entity type'),
      tags: z.array(z.string()).optional().describe('Tag slugs; omit for no filter'),
      filter: z.enum(['and', 'or']).optional().describe('How to combine tags; default "and"'),
      view: viewShape,
      mode: z.enum(['items', 'count']).optional().describe('Shape of the answer; default "items"'),
      ...pageShape,
    },
    (discovery, args) =>
      discovery.listEntities({
        type: normalizeType(args.type),
        tags: args.tags as string[] | undefined,
        filter: args.filter as 'and' | 'or' | undefined,
        view: args.view as ViewKind | undefined,
        mode: args.mode as 'items' | 'count' | undefined,
        limit: optionalNumber(args.limit),
        offset: optionalNumber(args.offset),
      }),
  );

  const getEntities = op(
    'get_entities',
    'Fetch entities of one type by slug list — one slug is simply a list of one. Resolves <single_element type="..." slug="..."/>, <inline_mention .../> and <element_list type="..." slugs="a,b,c"/>; `view` picks which of those shapes comes back. Without `view`, one slug defaults to `single_element` and several default to `element_list_item`, matching the tags each resolves. `slugs` has a hard length limit (exceeding it is INVALID_ARGUMENT stating the limit), and the response has a size budget: nothing you named is ever dropped, but an item past the budget comes back with `entity: null` AND `truncated: true`, and the envelope\'s `message` says how to retry. The FIRST item never degrades that way — a one-slug call is already the smallest retry, so it is emitted whole. A slug that does not exist comes back as `entity: null` WITHOUT `truncated`, which is how "no such entity" stays distinguishable from "cut for size". The response echoes the `view` it used.',
    {
      type: z.string().describe('Entity type'),
      slugs: z.array(z.string()).describe('Slugs to fetch, in order'),
      view: viewShape,
    },
    (discovery, args) =>
      discovery.getEntities({
        type: normalizeType(args.type),
        slugs: (args.slugs as string[]).map(String),
        view: args.view as ViewKind | undefined,
      }),
  );

  const listTags = op(
    'list_tags',
    'List the project tags, paginated. `withCounts` is OFF by default because full counts are a cartesian product of tags by active types — turn it on when you need them, or use `minCount` to keep only tags used at least N times. `coOccurringWith` takes a tag slug and returns the tags sharing entities with it, with multiplicity: the only way to discover a taxonomy without already knowing it.',
    {
      withCounts: z.boolean().optional().describe('Include per-type usage counts; default false'),
      minCount: z.number().int().nonnegative().optional().describe('Only tags used at least this many times'),
      coOccurringWith: z.string().optional().describe('Tag slug — return the tags sharing entities with it'),
      ...pageShape,
    },
    (discovery, args) =>
      discovery.listTags({
        withCounts: args.withCounts === true,
        minCount: optionalNumber(args.minCount),
        coOccurringWith: optionalString(args.coOccurringWith),
        limit: optionalNumber(args.limit),
        offset: optionalNumber(args.offset),
      }),
  );

  const findReferences = op(
    'find_references',
    'Who points at this? Three targets: { target: "entity", type, slug } — which pages embed it, and with includeTagMatches also the <tagged_list/> pages whose tags intersect the entity\'s; { target: "section", anchor } — who cites this section; { target: "page", rootId, path } — who links this page, full key required. Calling without `target` returns INVALID_ARGUMENT listing the variants. A target with no references is a SUCCESS with an empty list and total: 0. Scope is document edges — entity-to-entity links specific to a type (ac.verifies, foreign keys) are entity data, and check_consistency rule 9 reports their integrity.',
    {
      target: z.enum(['entity', 'section', 'page']).optional().describe('Identity regime of the target; required'),
      type: z.string().optional().describe('With target:"entity" — entity type'),
      slug: z.string().optional().describe('With target:"entity" — entity slug'),
      anchor: z.string().optional().describe('With target:"section" — section anchor'),
      rootId: z.string().optional().describe('With target:"page" — which root'),
      path: z.string().optional().describe('With target:"page" — page path relative to the root'),
      includeTagMatches: z.boolean().optional().describe('Also report tag-driven (dynamic) references'),
      ...pageShape,
    },
    (discovery, args) =>
      discovery.findReferences({
        target: args.target,
        type: args.type === undefined ? undefined : normalizeType(args.type),
        slug: optionalString(args.slug),
        anchor: optionalString(args.anchor),
        rootId: optionalString(args.rootId),
        path: optionalString(args.path),
        includeTagMatches: args.includeTagMatches === true,
        limit: optionalNumber(args.limit),
        offset: optionalNumber(args.offset),
      } as Parameters<DiscoveryCore['findReferences']>[0]),
  );

  const checkConsistency = op(
    'check_consistency',
    'Run the consistency rules over every reference-validated root and every active type: broken embeds by category, unreferenced entities, invalid tag references, broken section refs, broken AC verifies, coverage rules. Filter with `severity` ("error" | "warning"), `rule` (number or name) or `limit` (a per-section cap) — `summary` always carries the FULL counts, so a filtered report still says what it hid. This is also the right home for disk-versus-index drift; that is not a mode of a page-listing tool.',
    {
      severity: z.enum(['error', 'warning']).optional().describe('Keep only rows of this severity'),
      rule: z.union([z.string(), z.number()]).optional().describe('Rule number or name'),
      limit: z.number().int().positive().optional().describe('Per-section cap; summary still counts everything'),
    },
    (discovery, args) =>
      discovery.checkConsistency({
        severity: args.severity as 'error' | 'warning' | undefined,
        rule: args.rule as string | number | undefined,
        limit: optionalNumber(args.limit),
      }),
  );

  const resolveIdentity = op(
    'resolve_identity',
    'The one cross-type operation: given a fragment of a name or a slug, which entities could you have meant? It matches IDENTITY fields (slug, name, label) across types and returns ranked candidates — a façade over the per-type indexes rather than a cross-type full-text index, so it will not find a phrase buried in a description. This is the compensation for search_entities requiring a single type; once you know the type and slug, go to get_entities.',
    {
      query: z.string().describe('Name or slug fragment'),
      types: z.array(z.string()).optional().describe('Restrict to these types; omit for all active types'),
      limit: z.number().int().positive().optional().describe('Max candidates'),
    },
    (discovery, args) =>
      discovery.resolveIdentity({
        query: String(args.query),
        types: (args.types as string[] | undefined)?.map(normalizeType),
        limit: optionalNumber(args.limit),
      }),
  );

  return createMcpServer({
    name: 'c4s-reader',
    version: deps.packageVersion,
    tools: [
      overview,
      describeTypes,
      listPages,
      listSections,
      getSections,
      getPage,
      searchPages,
      searchEntities,
      listEntities,
      getEntities,
      listTags,
      findReferences,
      checkConsistency,
      resolveIdentity,
    ],
  });
}
