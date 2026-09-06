import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { z } from 'zod';
import { toolError } from '../operations/envelope.js';
import type Database from 'better-sqlite3';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import { isDiscoveryError, MAX_ANCHORS_PER_CALL, type DiscoveryCore } from '../discovery/index.js';
import { GET_PAGE_OUTLINE_RETURN, GET_PAGE_RETURN } from './tool-contract-text.js';

/**
 * `c4s-reader` — the external stdio transport over the M39 discovery core.
 *
 * Fifteen tools, named 1:1 with the core operations, and nothing else. This
 * file maps the MCP protocol onto the core and core error codes onto
 * `tool_result`; it does not decide what pagination means, which types exist,
 * how an entity is serialized, or what an error should suggest next.
 *
 * 0.2.3 replaced the previous nine tools, and the new set is not a superset of
 * the old one. The old set reached only six of the core operations, and did
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

/**
 * The tool names this server exposes, in the order the brief lists the
 * operations. Exported so the architecture gate can assert the set instead of
 * trusting the prose above it.
 */
export const C4S_READER_TOOL_NAMES = [
  'overview',
  'describe_types',
  'list_pages',
  'get_page_outline',
  'get_sections',
  'get_page',
  'search_pages',
  'search_entities',
  'list_entities',
  'get_entities',
  'get_field_content',
  'list_tags',
  'find_references',
  'check_consistency',
  'resolve_identity',
] as const;

export function createC4sReaderServer(deps: C4sReaderDeps): CapturedMcpServer {
  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  });
  /**
   * The shared envelope. This file emitted the NESTED `{ error: { code, message } }`
   * shape while `reference-tools` — mounted on the same connection — emitted the
   * flat `{ error, code }`, which is precisely the divergence
   * `operations/envelope.ts` was written to end and item 3 of the brief
   * specifies away: the error envelope is `{ error, code }`, declared once.
   */
  const fail = toolError;

  const requireProject = ():
    | { ok: true; discovery: DiscoveryCore }
    | { ok: false; response: ReturnType<typeof fail> } => {
    if (!deps.reader || !deps.db || !deps.projectDir || !deps.discovery) {
      return {
        ok: false,
        response: fail(
          'PROJECT_NOT_FOUND',
          'no claude4spec project loaded',
          // 0.2.13: the old hint said "pass --project <path> when starting
          // c4s-mcp". That flag no longer exists — the project is written into
          // the mount address, so an unaddressed connection is not a state this
          // surface can be in. The mount point is what a caller can actually fix.
          'address a project in the mount URL: /api/projects/<projectId>/mcp',
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
   * 0.2.13 dropped the `SCHEMA_OUT_OF_DATE` special case that used to sit here.
   * It existed because this server ran in a SEPARATE process holding a readonly
   * handle on a slot the main process might not have migrated yet, and its hint
   * told the caller to start the server. Both halves of that are now false: the
   * surface runs inside the server, which migrates before it serves, so a
   * pending migration cannot reach this line — and advising someone to start a
   * server that is demonstrably running is worse than no advice. `SCHEMA_OUT_OF_DATE`
   * and `INDEX_NOT_MATERIALIZED` left this surface's error catalog with it; they
   * describe internal state of the server process, which is not this channel's
   * business. What arrived instead — `PROJECT_NOT_IN_WORKSPACE` and
   * `PROJECT_BUILD_FAILED` — is produced by `projectDispatchMiddleware`, above
   * this file.
   */
  const wrapCall = async <T>(
    fn: () => T | Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; response: ReturnType<typeof fail> }> => {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      if (isDiscoveryError(err)) return { ok: false, response: fail(err.code, err.message, err.hint) };
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, response: fail('INTERNAL', message) };
    }
  };

  /**
   * Coerce an incoming `type` argument to a string. Deliberately NOT a gate: an
   * unrecognized type falls through to the core, whose `INVALID_TYPE` lists the
   * types that ARE active. Refusing it here would answer with strictly less.
   *
   * 0.2.11: this used to also rewrite `database_table` → `database-table`, and
   * was named `normalizeType` for it. A type id is always kebab-case, so that
   * was not an alternative spelling but a malformed one — and no other type
   * received the courtesy, which is precisely what made `database-table`
   * privileged. Nothing is left to normalize, so the name no longer claims to.
   */
  const asTypeId = (raw: unknown): string => String(raw);

  const optionalString = (value: unknown): string | undefined =>
    value === undefined || value === null ? undefined : String(value);
  const optionalNumber = (value: unknown): number | undefined =>
    value === undefined || value === null ? undefined : Number(value);

  /** Every list operation takes these; the core owns their defaults and caps. */
  const pageShape = {
    limit: z.number().int().positive().optional().describe('Page size; the core applies a default and a cap'),
    offset: z.number().int().nonnegative().optional().describe('Rows to skip; a stable sort makes it meaningful'),
  };

  /**
   * The field projection — 0.2.22's replacement for `view`.
   *
   * The old parameter named one of five shapes the TYPE declared. This one names
   * FIELDS, and the host computes the shape from the schema, so a caller no
   * longer has to know a type's view repertoire to ask a narrow question.
   */
  const selectShape = z
    .array(z.string())
    .optional()
    .describe(
      'Top-level field names to return; slug, title and tags always come back. Omit for every ' +
        'field except content-bearing ones; [] for the identity skeleton alone. See ' +
        'describe_types.selectableFields.',
    );

  /**
   * One handler shape for all fifteen: guard the project, call the operation,
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
    'ENTRY POINT. One call that says what this specification contains: page roots with their properties (sectionIndexed / referenceValidated / pageCount), the active entity types with a row count and payload version each, the tag count, and the claude4spec version. Root properties are part of the payload because they decide how a hit is addressed — a section-indexed root answers with an `anchor`, a plain one with (rootId, path, line). Cheap: no schemas, no views; call describe_types for those.',
    {},
    (discovery) => discovery.overview(),
  );

  const describeTypes = op(
    'describe_types',
    'The JSON Schema of each entity type\'s read record, plus what you need before a read: `constraints` (per-field value rules), `contentFields` (fields withheld from every record, each with the operation that issues its content), `selectableFields` (the names legal in `get_entities`\' `select`) and `searchableFields` (the paths a search_entities call would actually cover). Omit `types` for every active type. ONE schema per type, DERIVED from the type\'s declared data schema — a type contributes no read code, so there is nothing else it could be. A type deactivated in config answers INVALID_TYPE with the active list, never a raw-JSON fallback.',
    {
      types: z.array(z.string()).optional().describe('Restrict to these types; omit for all active types'),
    },
    (discovery, args) =>
      discovery.describeTypes({
        types: (args.types as string[] | undefined)?.map(asTypeId),
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

  const getPageOutline = op(
    'get_page_outline',
    "One page's headings as a TREE in document order — a table of contents, and the cheap step between locating a page and paying for any of its text. Takes the page key and NOTHING else: no `by` discriminator, no anchor variant, no fuzzy heading search (a heading substring is not an identity — to find a section by text, call search_pages, whose hit ALREADY carries the anchor), no limit/offset, no depth cap. Every node carries its section's anchor and the `size` of its body, so you can measure a page and pick exactly the anchors worth fetching with get_sections before spending anything on prose. It emits no content. It refuses as a WHOLE, not per item, because it is keyed by ONE page: an unknown path on a known root is PAGE_NOT_FOUND, and a root with no section index is refused with a pointer at get_page. " +
      GET_PAGE_OUTLINE_RETURN,
    {
      rootId: z.string().describe('Which page root. Required — the same relative path can exist in several roots.'),
      path: z.string().describe('Page path relative to the root.'),
    },
    (discovery, args) =>
      discovery.getPageOutline({ rootId: String(args.rootId), path: String(args.path) }),
  );

  const getSections = op(
    'get_sections',
    `Read sections BY ANCHOR — pass every anchor you need in ONE call; one anchor is simply a list of one. Search hits, a reference sweep and a page outline all hand you a LIST of anchors, and fetching them one per call is the cost this operation exists to remove. Each comes back as its own item in \`results\`, in the order asked for (duplicates silently collapsed), carrying the heading, the coordinates and the body as authored — XML tags left untouched, because a tag is an edge and expanding it would paste the payload in and destroy the edge. The item is \`{ anchor, rootId, page_path, heading_text, heading_level, line_start, line_end, body, truncated?, edges? }\`. \`edges\` accompanies an item IF AND ONLY IF it carries \`truncated: true\`: a full body already contains its own edges as authored tags and links, so parsing them out a second time would spend the budget on a copy. When they are there, they are the parsed outgoing edges of the WHOLE section — \`edges.sectionRefs: [{ anchor }]\`, \`edges.entityEmbeds: [{ tagType, type, slug?, slugs?, tags?, filter? }]\`, \`edges.pageLinks: [{ rootId, path, anchor? }]\` — identifiers only, in order of occurrence, so a truncated item still reports everything its section points at; to follow an embed, call get_entities with the slug it carries. There is no \`content_hash\`: the response carries the content itself, so there is nothing left for a version of it to settle. An anchor that is not addressable comes back as \`{ anchor, error, code: "SECTION_NOT_FOUND" }\` in its own slot rather than failing the batch, and that happens two ways with two different remedies: the anchor is unknown (the message points at search_pages / get_page_outline), or it resolves onto a root that carries no section index (the message points at get_page). \`anchors\` has a hard length limit of ${MAX_ANCHORS_PER_CALL} (exceeding it, or passing none, is INVALID_ARGUMENT stating the limit) and the response has a size budget: past it, items keep their coordinates, GAIN \`edges\` and lose \`body\`, and are marked \`truncated: true\` — never dropped in silence, and the envelope's \`message\` says how to retry. The remedy is not the same batch again: pick the anchors actually needed out of the \`edges\` handed back and call again, narrower. The FIRST item never degrades that way: if its body alone exceeds the budget it comes back shortened as text with \`truncated: true\` AND with \`edges\` (its tail is invisible, so the edges are the only view of it), because a one-anchor call is already the smallest retry and "ask for fewer" would otherwise be unfollowable. \`includeSubtree\` adds the lower headings beneath each anchor — it is an option for reading CONTENT, NOT a cheap listing of a subtree; for that, get_page_outline is the call, and the \`size\` it reports per node is exactly the granularity this operation yields WITHOUT \`includeSubtree\`. An anchor already covered by another one's subtree comes back as \`{ anchor, coveredBy }\` instead of repeating the body. An anchor names exactly ONE section. If a duplicate anchor slips into the pages anyway, the read is still deterministic rather than a coin flip on directory order: the occurrence with the lowest (rootId, page_path) owns the anchor, and within one page the first (lowest line) occurrence wins. \`check_consistency\` rule 13 reports the collision with every location so it gets fixed.`,
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
    'Read one page as authored — XML tags untouched — addressed by the FULL key (rootId, path). A bare path is ambiguous across roots, so a call without `rootId` returns INVALID_ARGUMENT with the root list rather than guessing the built-in one. `range` is a line window and is allowed only on roots WITHOUT a section index; on an indexed root it is refused with a pointer to get_page_outline + get_sections, which is a better window in every way. Embeds are never expanded — fetch the entity by slug instead. ' + GET_PAGE_RETURN,
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
    'Search the prose of the pages, by phrase (`query`) or by regex (`regex`) — the replacement for grepping the specification, and the one search the entity graph cannot stand in for, because it looks for exactly what fell OUT of the graph (a bare HTTP path, a DTO name mentioned in running text). THREE MODES, a ladder of cost: "count" returns only the totals; "map" (DEFAULT) returns identity rows `{ rootId, path, anchor, heading, headingPath, matchCount }` with no prose; "hits" adds `hunks[]` + `omittedChars`. There is no fourth rung and no "pages" mode — to read a section, take the `anchor` from a map row and call get_sections. A HIT IS A SECTION, a MATCH is a line: several matches in one section collapse into ONE hit carrying `matchCount`, and no two hits share an `anchor`. A hit carries an `anchor` IF AND ONLY IF `kind` is "section"; a `kind: "page"` hit has none, which happens on a root with no section index AND on an indexed root when the match falls outside every section (text above the first heading, or under a heading the indexer gave no anchor). Branch on `kind`, never on the root. Results enumerate in `(rootId, path, line_start)` order with a declared tie-break, so paging with `limit`/`offset` returns every hit exactly once. There is no `score` and no line number. THREE COST VALVES, coarse to sharp: `rootId`, then `pathInclude`/`pathExclude` (regexes over the page path, applied BEFORE the file is opened), then `anchors` (scan only these sections). A `regex` that could only match across a line boundary (`\\n`, `[\\s\\S]`, an inline flag group) is refused with INVALID_ARGUMENT rather than answered with zero hits — a silent false negative is worse than an error; within-line idioms are fine, `[^\\n]` included.',
    {
      query: z.string().optional().describe('Phrase to look for; case-insensitive substring, matches inside words too. A UI-grade instrument — prefer `regex` for precision.'),
      regex: z.string().optional().describe('Regular expression; the DEFAULT instrument here, not a fallback. Matched per line, case-insensitively.'),
      rootId: z.string().optional().describe('Valve 1 — restrict to one root; omit to search all of them'),
      mode: z
        .enum(['count', 'map', 'hits'])
        .optional()
        .describe('Shape of the answer; default "map". Pass "hits" explicitly when you need the prose.'),
      pathInclude: z.string().optional().describe('Valve 2 — regex over the page path; non-matching pages are rejected before being opened'),
      pathExclude: z.string().optional().describe('Valve 2 — regex over the page path; matching pages are rejected before being opened'),
      anchors: z.array(z.string()).optional().describe('Valve 3, sharpest — limit the scan to these sections'),
      context: z.number().int().nonnegative().optional().describe('Lines of context around each match in "hits" mode. Overlapping windows merge into one block; no line is emitted twice.'),
      ...pageShape,
    },
    (discovery, args) =>
      discovery.searchPages({
        query: optionalString(args.query),
        regex: optionalString(args.regex),
        rootId: optionalString(args.rootId),
        mode: args.mode as 'count' | 'map' | 'hits' | undefined,
        pathInclude: optionalString(args.pathInclude),
        pathExclude: optionalString(args.pathExclude),
        anchors: args.anchors as string[] | undefined,
        context: optionalNumber(args.context),
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
      mode: z.enum(['hits', 'count']).optional().describe('Shape of the answer; default "hits"'),
      ...pageShape,
    },
    (discovery, args) =>
      discovery.searchEntities({
        type: asTypeId(args.type),
        query: String(args.query),
        fields: args.fields as string[] | undefined,
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
      tagFilter: z.enum(['and', 'or']).optional().describe('How to combine tags; default "and"'),
      sort: z
        .enum(['createdAt', 'title', 'slug'])
        .optional()
        .describe('Row order; default "createdAt", the only one whose offset window is write-stable'),
      dir: z.enum(['asc', 'desc']).optional().describe('Direction; default "asc"'),
      mode: z.enum(['items', 'count']).optional().describe('Shape of the answer; default "items"'),
      ...pageShape,
    },
    (discovery, args) =>
      discovery.listEntities({
        type: asTypeId(args.type),
        tags: args.tags as string[] | undefined,
        tagFilter: args.tagFilter as 'and' | 'or' | undefined,
        sort: args.sort as 'createdAt' | 'title' | 'slug' | undefined,
        dir: args.dir as 'asc' | 'desc' | undefined,
        mode: args.mode as 'items' | 'count' | undefined,
        limit: optionalNumber(args.limit),
        offset: optionalNumber(args.offset),
      }),
  );

  const getEntities = op(
    'get_entities',
    'Fetch entities of one type by slug list — one slug is simply a list of one. Resolves <single_element type="..." slug="..."/>, <inline_mention .../> and <element_list type="..." slugs="a,b,c"/>; `select` decides how wide the answer is, and the same call answers all three. Omit `select` for the full record, pass [] for the identity skeleton a chip or a list row needs, or name the fields you will actually render. `slugs` has a hard length limit (exceeding it is INVALID_ARGUMENT stating the limit), and the response has a size budget: nothing you named is ever dropped, but an item past the budget comes back with `entity: null` AND `truncated: true`, and the envelope\'s `message` says how to retry. The FIRST item never degrades that way — a one-slug call is already the smallest retry, so it is emitted whole. A slug that does not exist comes back as `entity: null` WITHOUT `truncated`, which is how "no such entity" stays distinguishable from "cut for size". The response echoes the fields it used as `selectedFields`, and that list can be handed straight back as a `select`.',
    {
      type: z.string().describe('Entity type'),
      slugs: z.array(z.string()).describe('Slugs to fetch, in order'),
      select: selectShape,
    },
    (discovery, args) =>
      discovery.getEntities({
        type: asTypeId(args.type),
        slugs: (args.slugs as string[]).map(String),
        select: args.select as string[] | undefined,
      }),
  );

  const getFieldContent = op(
    'get_field_content',
    'The content of ONE content-bearing field of one entity, addressed by (type, slug, field). A content-bearing field is carried by NO generic read — get_entities answers with `has<Field>`, `<field>Bytes` and this operation\'s name — so this is the only way to read one. `describe_types` lists each type\'s `contentFields` with the operation that issues them. A field that is not content-bearing is INVALID_ARGUMENT with the covered fields attached; an unknown slug is ENTITY_NOT_FOUND.',
    {
      type: z.string().describe('Entity type'),
      slug: z.string().describe('Entity slug'),
      field: z.string().describe('A content-bearing field of that type'),
    },
    (discovery, args) =>
      discovery.getFieldContent({
        type: asTypeId(args.type),
        slug: String(args.slug),
        field: String(args.field),
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
        type: args.type === undefined ? undefined : asTypeId(args.type),
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
    'Run the consistency rules over every reference-validated root and every active type: broken embeds by category, unreferenced entities, invalid tag references, broken section refs, broken AC verifies, coverage rules, duplicate anchors (rule 13 — one anchor comment on two headings; the row lists every location), tags no embed consumes (rule 14 — config-flagged). Filter with `severity` ("error" | "warning"), `rule` (number or name) or `limit` (a per-section cap) — `summary` always carries the FULL counts, so a filtered report still says what it hid. This is also the right home for disk-versus-index drift; that is not a mode of a page-listing tool.',
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
        types: (args.types as string[] | undefined)?.map(asTypeId),
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
      getPageOutline,
      getSections,
      getPage,
      searchPages,
      searchEntities,
      listEntities,
      getEntities,
      getFieldContent,
      listTags,
      findReferences,
      checkConsistency,
      resolveIdentity,
    ],
  });
}
