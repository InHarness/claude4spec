/**
 * The catalog's seed: every operation this release renders.
 *
 * ## Declaration here, binding at the rendering
 *
 * A declaration is static — name, schema, codes, side effects, channel cells.
 * The OWNER FUNCTION is not named here, because it is per-`ProjectContext`
 * (a `DiscoveryCore` belongs to one project). The "one function per operation"
 * invariant is upheld at the rendering instead: every channel calls the same
 * `DiscoveryCore` method, and none of them re-derives its behaviour. Where that
 * is checkable it is checked — see `catalog.test.ts`.
 *
 * ## M39 read core — 15 operations, four-channel parity for twelve of fourteen
 *
 * All 15 are `project` scope and `direct` mediation. Three of
 * them (`check_consistency`, `search_entities`, `resolve_identity`) had no `rest`
 * rendering before 0.2.13; adding it is what made the parity claim true rather than
 * aspirational.
 *
 * 0.2.59 left exactly ONE `n/a` cell in the set: `get_page_outline` has no `rest`
 * rendering, and that is a decision with a recorded reason (see its declaration),
 * not a gap awaiting a route. 0.2.92 adds the second, with a disjoint reason:
 * `overview` has no `internal` rendering (see its declaration).
 *
 * ## `direct` is an expectation, not an exemption (0.2.92)
 *
 * For `cli` and `rest` the default `direct` fills the cell. For `internal` and
 * `mcp` it holds only with a pointable rendering — a tool that renders the
 * operation in that channel; without one the row is INVALID and owes an `n/a`
 * with a reason. `catalog.test.ts` checks it against the declared tool names.
 *
 * The `cli` cells say `direct` because M11 renders the whole catalog as CLI
 * commands. Parity there is OPERATIONAL, not nominal: five XML-tag reader
 * commands may front one `get_entities` operation, exactly as MCP fronts it with
 * one tool and a `select` parameter. Note the CLI's own migration to
 * server-delegating execution is a later tier — the cell describes the contract,
 * and the command's execution mode is a separate property of L14.
 *
 * ## A cell states the CONTRACT, not the current build
 *
 * Two places where this release's code does not yet meet the declaration, both
 * deliberate and both flagged rather than papered over by weakening the cell:
 *
 *   - `cli` — the `c4s` process still reads SQLite directly and renders these as
 *     local commands. Converting it to a server-delegating HTTP client is a
 *     later tier of this same brief.
 *   - `search_pages` in `rest` — `GET /api/pages/:rootId/search` is NOT a
 *     faithful rendering. It matches on page PATH as well as content
 *     (`matchesPath`) and returns `{path, line, snippet, matchesPath}`, where
 *     the core operation searches content only and answers with ranked
 *     `{kind, anchor|path, line, fragment, score}` hits. Routing the existing
 *     endpoint at the core would silently drop path matching from the UI's page
 *     finder, so it was left alone; the release's claim that these three gain
 *     paging "without losing anything" does not hold for this one. Raised as a
 *     patch against the brief.
 */

import { z } from 'zod';
import { PATCH_KINDS } from '../../core/briefs/types.js';
import { CATALOG, direct, na, via, type ContentInputMode, type OperationDeclaration } from './catalog.js';
import { OPERATION_RULES } from './operation-rules.js';

/**
 * 2.1.26 — every row is registered with its record's `reguly` (`rules`), from
 * {@link OPERATION_RULES}: the citation list is a field of the record like the
 * others, kept as one table because it is the same handful of identifiers on
 * every row. A row the table has no entry for (a plugin row the window carries
 * no record for) is registered without `rules`.
 */
function registerRow(op: OperationDeclaration): OperationDeclaration {
  const rules = op.rules ?? OPERATION_RULES[op.name];
  return CATALOG.register(rules ? { ...op, rules } : op);
}

/**
 * The field projection, on the operations that return whole records.
 *
 * 0.2.22 — this replaces `viewParam`, and the difference is who decides. A view
 * was a shape the TYPE declared and the caller picked from; a projection is a
 * shape the CALLER states and the host computes from the schema. Which is why
 * the parameter appears on `get_entities` alone: the discovery operations
 * (`list_entities`, `search_entities`) have frozen rows, and page operations
 * have no logical schema to project from at all.
 */
const selectParam = {
  select: z
    .array(z.string())
    .optional()
    .describe(
      'Top-level field names to return, plus slug/title/tags always. Omit for every field except ' +
        'content-bearing ones; [] for the identity skeleton alone.',
    ),
};

/** Shared paging vocabulary — same names in every channel. */
const paging = {
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
};

/**
 * The error codes a read operation's row declares are the record's `kodyBledow`
 * — and nothing else (2.1.26, M39 `m3s1nq7s`).
 *
 * `kodyBledow` does not declare a taxonomy of its own: it CHOOSES from the one
 * that stands (`7dad4wt0`), and the subset is the codes the operation actually
 * answers with, not the ones its address would suggest. A missing entity in
 * `get_entities` is an item with an empty record, not a refusal; a read that does
 * not pass the freshness gate (`discovery/index.ts`) does not answer
 * `INDEX_STALE`; `overview` answers with no code at all (`n/d`). So the rows
 * below each carry their own list rather than a shared base plus extras — a
 * shared base declared `INDEX_STALE` on `get_page` and `INVALID_TYPE` on
 * `list_pages`, which neither can raise.
 *
 * History that still holds: `INVALID_VIEW` and `SERIALIZER_THREW` left the
 * taxonomy in 0.2.22/0.2.23; `INDEX_NOT_MATERIALIZED` is in the catalogue but no
 * operation returns it (the server builds the projection before it serves; a
 * caller without a server gets `SERVER_NOT_RUNNING` from the CLI); and 2.1.26
 * removed `AMBIGUOUS_ENTITY` / `AMBIGUOUS_PAGE` — ambiguity has no code.
 *
 * `READ_CODES` survives only as the base of `get_field_content`, whose record
 * keeps exactly that set plus its own code; the two search rows (2.1.26) list
 * their records' codes like the others.
 */
const READ_CODES = [
  'INVALID_TYPE',
  'INVALID_ARGUMENT',
  'INDEX_STALE',
] as const;

/** All four channels render it themselves — the M39 parity shape. */
const fullParity = () => ({
  internal: direct(),
  cli: direct(),
  mcp: direct(),
  rest: direct(),
});

/**
 * 2.1.43 — the `cli` cell of operations no `c4s` command renders. The reasons are
 * the records' `powody.cli`, verbatim (backticks and Polish characters included):
 * the catalog test compares them literally.
 */
const CLI_NA_ENTITY = 'Komendy nie zaprojektowano: generyczne komendy encji `c4s` są wyłącznie odczytem.';
const CLI_NA_PAGES = 'Komendy nie zaprojektowano: rejestr komend `c4s` nie ma kontrybucji zapisu stron.';
const CLI_NA_TAGS = 'Komendy nie zaprojektowano: rejestr komend `c4s` nie ma kontrybucji zapisu tagów.';
const CLI_NA_BRIEF = 'Komendy nie zaprojektowano: komendy briefu tworzą, czytają i oznaczają brief, ale go nie edytują.';
const CLI_NA_SECTION = 'Komendy punktowej edycji sekcji nie zaprojektowano; rejestr komend jej nie zna.';
const CLI_NA_PROJ = "Komendy nie zaprojektowano; `c4s list-workspaces` czyta rejestr workspace'ów, a nie listę projektów serwera.";
const CLI_NA_ABORT = 'Komendy nie zaprojektowano: przerwanie tury z terminala nie ma kontrybucji w rejestrze komend.';

/** A read operation of the M39 core: project scope, direct, no side effects, idempotent. */
function coreRead(
  name: string,
  summary: string,
  inputSchema: z.ZodRawShape,
  errorCodes: readonly string[],
): OperationDeclaration {
  return {
    name,
    summary,
    scope: 'project',
    mediation: 'direct',
    opClass: 'read',
    inputSchema,
    errorCodes,
    sideEffects: ['none'],
    idempotent: true,
    channels: fullParity(),
  };
}

/**
 * 2.1.9 (M52, entity `spec-skill-tools-update-skill-file`) — the input of
 * `update_skill_file`, declared ONCE: the catalog row below and the `internal`
 * rendering (`mcp/spec-skill-tools.ts`) both take this shape, so the one channel
 * that renders the operation cannot drift from its row. Parameter descriptions
 * are the entity's, verbatim.
 */
export const UPDATE_SKILL_FILE_INPUT = {
  slug: z.string().describe('Slug of the skill package to write — the package directory name.'),
  file: z
    .string()
    .optional()
    .describe('Package-relative POSIX path of the file to write. No absolute path, no `..`.'),
  content: z
    .string()
    .optional()
    .describe('The whole new content of the file. Pass exactly one of `content` and `textEdits`.'),
  textEdits: z
    .array(
      z.object({
        find: z.string().min(1),
        replaceWith: z.string(),
        expectedMatches: z.union([z.number().int().min(1), z.literal('all')]).optional(),
      }),
    )
    .min(1)
    .optional()
    .describe(
      'Literal substitutions, each { find, replaceWith, expectedMatches }: `find` is matched byte for byte, `expectedMatches` defaults to exactly 1. Pass exactly one of `content` and `textEdits`.',
    ),
  expectedHash: z
    .string()
    .describe('The file\'s `hash` as you last read it with load_skill_file. Pass "" when the file must not exist yet.'),
};

let seeded = false;

/**
 * Idempotent — the process-wide {@link CATALOG} is seeded once, but the server
 * builds a `ProjectContext` per project and tests build several per file.
 */
export function registerCoreOperations(): void {
  if (seeded) return;
  seeded = true;

  // ── M39 read core (15) ────────────────────────────────────────────────────
  //
  // 2.1.26 — each row below matches its `spec-operation` record (`overview`,
  // `describe-types`, `list-pages`, `get-page-outline`, `get-sections`,
  // `get-page`, `list-entities`, `get-entities`, `list-tags`, `find-references`,
  // `check-consistency`, `resolve-identity`): `errorCodes` is the record's
  // `kodyBledow`, each code once, a channel `n/a` carries the record's `powody`
  // entry, and `renderings` is its `narzedzia`.

  registerRow({
    ...coreRead('overview', 'Entry point to a specification: page roots with their properties, active entity types with counts and payload versions, tag count, claude4spec version.', {}, []),
    channels: {
      ...fullParity(),
      // 0.2.92 — a decision, not a backlog item: the built-in agent's prompt
      // carries all of it statically, and the one part that goes stale mid-turn
      // has its own operation.
      internal: na(
        "kanał wewnętrzny nie ma renderowania tej operacji i nie potrzebuje go: prompt niesie rooty, aktywne typy i tooling statycznie, a liczności rekordów odświeża `list_entities({ mode: 'count' })`",
      ),
    },
    renderings: { mcp: ['c4s-reader.overview'] },
  });

  registerRow({
    // The summary deliberately says "activation set" rather than naming the
    // config field: an architecture gate asserts that only the plugin host reads
    // `config.entities`, and it greps string literals too.
    ...coreRead('describe_types', "Schemas of the active entity types. Without a type argument, all of them; a type outside the project's activation set is INVALID_TYPE, never a silent fallback.", {
      types: z.array(z.string()).optional().describe('Restrict to these type ids. Omit for every active type.'),
    }, ['INVALID_TYPE']),
    /**
     * Two renderings in `mcp` under two names and two contracts — the record says
     * so, and it is not drift: the external reader's own `describe_types`, and
     * `entity-tools`' `describe_entity_type`, which is also the `internal` one.
     */
    renderings: {
      internal: ['entity-tools.describe_entity_type'],
      mcp: ['c4s-reader.describe_types', 'entity-tools.describe_entity_type'],
    },
  });

  registerRow({
    ...coreRead('list_pages', 'Pages of one root. A page\'s identity is (rootId, relPath), so the root is part of the address, not a filter.', {
      rootId: z.string(),
      ...paging,
    }, ['INVALID_ARGUMENT']),
    renderings: { internal: ['reference-tools.list_pages'], mcp: ['c4s-reader.list_pages'] },
  });

  /**
   * 0.2.59 — `get_page_outline` replaces `list_sections`, and it is one of the M39
   * reads that does NOT declare four-channel parity.
   *
   * Declared through the object literal rather than `coreRead`, because `coreRead`
   * hard-codes `fullParity()` and this operation's `rest` cell is `n/a` with a
   * recorded reason. The reason is semantic, not a backlog item: `GET /api/sections`
   * is NOT a rendering of this operation — without `pagePath` it answers a flat
   * global list across every page, feeding the editor's fuzzy autocomplete, and the
   * outline has no such mode and will not get one, being keyed by ONE page. That
   * route stays M06's own semantics rather than becoming a transport over the core.
   */
  registerRow({
    name: 'get_page_outline',
    summary:
      "One page's headings as a TREE in document order — a table of contents. Keyed by (rootId, path) alone: no `by` discriminator, no anchor variant, no fuzzy `query`, no limit/offset, no depth cap. Each node carries `anchor`, `heading`, `level` and the `size` of its body, with `children` present only when it has any; the envelope carries the file `hash` that `update_sections` takes as `expectedHash`. It emits no content — bodies come from `get_sections`.",
    scope: 'project',
    mediation: 'direct',
    opClass: 'read',
    inputSchema: {
      rootId: z.string(),
      path: z.string(),
    },
    /**
     * No `...paging`, and that absence is the declaration.
     *
     * This is the THIRD category of exemption from the rule that every operation
     * returning a list paginates, beside "bounded by construction" (`overview`,
     * `describe_types`, whose valve is a projection) and "fetch by key"
     * (`get_entities`, `get_sections`, whose valve is an input-length cap plus the
     * budget). A response keyed by ONE resource has the budget and nothing else:
     * there is no narrowing parameter to offer, because a window into a tree yields
     * nodes whose parents are absent. Which category an operation falls into has to
     * be decidable from its declaration alone, without reading the implementation —
     * so it is decidable from right here.
     */
    errorCodes: ['PAGE_NOT_FOUND', 'INVALID_ARGUMENT', 'INDEX_STALE'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: direct(),
      cli: direct(),
      mcp: direct(),
      rest: na(
        '`GET /api/sections` nie jest renderowaniem tej operacji: bez `pagePath` zwraca płaską listę globalną przez wszystkie strony, a outline jest z definicji kluczowany jedną stroną. Doprowadzenie trasy do parytetu jest osobną zmianą o własnym uzasadnieniu',
      ),
    },
    renderings: { internal: ['reference-tools.get_page_outline'], mcp: ['c4s-reader.get_page_outline'] },
  });

  registerRow({
    ...coreRead('get_sections', 'Content of several sections addressed by anchor, in ONE call. The singular `get_section` was removed without a transition period: N sections cost N model turns, which was not acceptable.', {
      anchors: z.array(z.string()).min(1),
      includeSubtree: z.boolean().optional(),
    }, ['SECTION_NOT_FOUND', 'PAGE_NOT_FOUND', 'INVALID_ARGUMENT', 'INDEX_STALE']),
    renderings: { internal: ['reference-tools.get_sections'], mcp: ['c4s-reader.get_sections'] },
  });

  {
    const getPage = coreRead(
      'get_page',
      'One WHOLE page addressed by (rootId, path), as a collection of sections: frontmatter and preamble are envelope fields, each section an item keyed by its anchor. Computed from the file, not the index, so it never answers INDEX_STALE. No line window (2.1.8): a cut read resumes through get_page_outline + get_sections. Replaced `resolve_page({ path })`, which took a relPath without its root.',
      {
        rootId: z.string(),
        path: z.string(),
      },
      ['PAGE_NOT_FOUND', 'INVALID_ARGUMENT'],
    );
    registerRow({
      ...getPage,
      channels: {
        ...getPage.channels,
        /**
         * 2.1.6 — the structured read has no REST rendering. `GET /api/pages/:rootId/*`
         * is M02's own raw read for the editor (DTO `page-detail`: the file byte for
         * byte plus its hash), not a transport over this operation.
         */
        rest: na(
          'odczyt pliku dla edytora należy do M02: `GET /api/pages/:rootId/*` wydaje surowy plik bajt w bajt z `hash`, a nie strukturę tej operacji, więc renderowaniem `get_page` nie jest',
        ),
      },
      renderings: { internal: ['reference-tools.get_page'], mcp: ['c4s-reader.get_page'] },
    });
  }

  /**
   * 2.1.26 — `search_pages` against its record: `kodyBledow` is INVALID_ARGUMENT,
   * INDEX_STALE and SEARCH_BUDGET_EXCEEDED. An unknown `rootId` is the core's
   * INVALID_ARGUMENT, so `ROOT_NOT_FOUND` left the row, and so did `INVALID_TYPE`
   * (no type in the address) and the second `INVALID_ARGUMENT` the shared base
   * plus extras produced. INDEX_STALE is any mark of the sections projection,
   * a search narrowed to one root included (the freshness gate checks the
   * projection without an artifact key).
   */
  registerRow({
    ...coreRead(
      'search_pages',
      'Search the prose of the pages by phrase (`query`) or regex (`regex`) — cross-root by default; `rootId` only NARROWS. A hit is a SECTION (a page only when the match falls outside every section — then `rootId` + `path` with the match count, no anchor and no line number, readable through `get_page`), carrying `matchCount`; matches are lines. Modes are a cost ladder: `count` (totals), `map` (identity rows, the DEFAULT), `hits` (adds `hunks[]` + `omittedChars`). Enumeration order is `(rootId, path, line_start)` with a declared tie-break, so a full `limit`/`offset` traversal returns each hit exactly once.',
      {
        rootId: z.string().optional(),
        query: z.string().optional(),
        regex: z.string().optional(),
        mode: z.enum(['count', 'map', 'hits']).optional(),
        pathInclude: z.string().optional(),
        pathExclude: z.string().optional(),
        anchors: z.array(z.string()).optional(),
        context: z.number().int().nonnegative().optional(),
        ...paging,
      },
      ['INVALID_ARGUMENT', 'INDEX_STALE', 'SEARCH_BUDGET_EXCEEDED'],
    ),
    renderings: { internal: ['reference-tools.search_pages'], mcp: ['c4s-reader.search_pages'] },
  });

  /**
   * 2.1.26 — `search_entities` against its record: `kodyBledow` is INVALID_TYPE,
   * INVALID_ARGUMENT, SEARCH_BUDGET_EXCEEDED and INDEX_STALE (the type marked in
   * the entity projection). The address is the query plus `type`; `filters`
   * narrows by the type's declared scalar fields exactly as on `list_entities`,
   * which is what the `internal` rendering forwards to the core.
   */
  registerRow({
    ...coreRead(
      'search_entities',
      'Search over one entity type by phrase (`query`) or regex (`regex`) — exactly one of the two. A hit is an ENTITY carrying `matchCount`; matches are occurrences, so an entity matched twice is one row with `matchCount: 2`. Modes are a cost ladder: `count` (totals), `map` (`{slug, title, matchCount}`, the DEFAULT, no entity content at all), `hits` (adds `hunks[]` + `omittedChars`). No mode carries a `score`: order is the contract instead — relevance under `query`, slug ascending under `regex`, both fully tie-broken. A hunk`s `field` is a legal `select` value for `get_entities` and never a content-bearing field, which stay outside both the scan scope and the evidence. Unlike `search_pages`, a pattern may cross a line: matching runs against the whole field value. Returns `searchedFields`, so an empty result is distinguishable from a field that was never searched.',
      {
        type: z.string(),
        query: z.string().optional(),
        regex: z.string().optional(),
        fields: z.array(z.string()).optional(),
        filters: z.record(z.string(), z.unknown()).optional(),
        mode: z.enum(['count', 'map', 'hits']).optional(),
        ...paging,
      },
      ['INVALID_TYPE', 'INVALID_ARGUMENT', 'SEARCH_BUDGET_EXCEEDED', 'INDEX_STALE'],
    ),
    renderings: { internal: ['entity-tools.search_entities'], mcp: ['c4s-reader.search_entities'] },
  });

  registerRow({
    ...coreRead('list_entities', 'Entities of one type, paged, narrowed by tags and by the type\'s own declared scalar fields, or only counted (`mode: count`). Rows are `{slug, title}` — discovery answers with keys; ask `get_entities` for content.', {
      type: z.string(),
      tags: z.array(z.string()).optional(),
      tagFilter: z.enum(['and', 'or']).optional().describe("How to combine `tags`. Default 'and'."),
      filters: z.record(z.string(), z.unknown()).optional(),
      mode: z.enum(['items', 'count']).optional(),
      ...paging,
    }, ['INVALID_TYPE', 'INVALID_ARGUMENT', 'INDEX_STALE']),
    renderings: { internal: ['entity-tools.list_entities'], mcp: ['c4s-reader.list_entities'] },
  });

  /**
   * A slug with no entity is an ITEM with an empty record, never a refusal — so
   * no `ENTITY_NOT_FOUND` here, and (2.1.26) no `AMBIGUOUS_ENTITY` either: the
   * type beside every slug is the key that does not admit ambiguity.
   */
  registerRow({
    ...coreRead('get_entities', 'Several entities of one type by slug, in ONE call. Width is the caller\'s: see `select`.', {
      type: z.string(),
      slugs: z.array(z.string()).min(1),
      ...selectParam,
    }, ['INVALID_TYPE', 'INVALID_ARGUMENT', 'INDEX_STALE']),
    renderings: { internal: ['entity-tools.get_entities'], mcp: ['c4s-reader.get_entities'] },
  });

  /**
   * 2.1.26 (M39 `v0fldrd8`, record `get-field-content`) — ONE generic core
   * operation, not a surface generated per type: a field enters its domain by
   * the `contentBearing` flag alone, so the number of these operations does not
   * depend on which plugins are installed. Codes are the record's
   * `kodyBledow` — `INVALID_TYPE`, `INVALID_ARGUMENT`, `INDEX_STALE` from the
   * read base plus `ENTITY_NOT_FOUND` — each declared once (`error-code-once`):
   * `INVALID_ARGUMENT` used to be listed a second time here.
   */
  registerRow({
    ...coreRead('get_field_content', 'The content of ONE content-bearing field, by (type, slug, field). Such a field is issued by no generic read; this is how it is fetched — on every channel, including the REST layer behind the UI.', {
      type: z.string(),
      slug: z.string(),
      field: z.string(),
    }, [...READ_CODES, 'ENTITY_NOT_FOUND']),
    // `narzedzia`: internal → `entity-tools-get-field-content`, mcp → `c4s-reader-get-field-content`.
    renderings: { internal: ['entity-tools.get_field_content'], mcp: ['c4s-reader.get_field_content'] },
  });

  registerRow({
    ...coreRead('list_tags', 'The tag registry, paged, optionally with usage counts.', {
      withCounts: z.boolean().optional(),
      minCount: z.number().int().nonnegative().optional(),
      coOccurringWith: z.string().optional(),
      ...paging,
    }, ['INVALID_ARGUMENT', 'INDEX_STALE']),
    renderings: { internal: ['reference-tools.list_tags'], mcp: ['c4s-reader.list_tags'] },
  });

  registerRow({
    ...coreRead('find_references', 'Who points at this entity, section or page. `includeTagMatches` additionally folds in dynamic `<tagged_list/>` matches, so one call answers both halves of "what breaks if I rename this".', {
      /**
       * Optional in the schema although every call needs it: a call WITHOUT
       * `target` must reach the core, whose `INVALID_ARGUMENT` lists the
       * variants — a schema refusal would answer with strictly less.
       */
      target: z.enum(['entity', 'section', 'page']).optional(),
      type: z.string().optional(),
      slug: z.string().optional(),
      anchor: z.string().optional(),
      rootId: z.string().optional(),
      path: z.string().optional(),
      includeTagMatches: z.boolean().optional().describe('Default false. Merges `<tagged_list/>` / `<tagged_list_mixed/>` matches into the result.'),
      ...paging,
      /**
       * Exactly what `discovery/ops/references.ts` can raise. This used to
       * declare `ENTITY_NOT_FOUND` and `MISSING_TARGET` on top, and neither is
       * reachable — a missing `target`, a missing page key and an unknown
       * `rootId` are all `INVALID_ARGUMENT`, an unknown entity type is
       * `INVALID_TYPE`, and a target nothing cites is a SUCCESS with
       * `total: 0`. Declaring a `*_NOT_FOUND` told an agent to expect an
       * error exactly where it gets an empty list.
       */
    }, ['INVALID_ARGUMENT', 'INVALID_TYPE', 'INDEX_STALE']),
    renderings: { internal: ['reference-tools.find_references'], mcp: ['c4s-reader.find_references'] },
  });

  /** Ungated (no freshness check), so no `INDEX_STALE`; an unknown `rule` is the one refusal. */
  registerRow({
    ...coreRead('check_consistency', 'M19 consistency rules over the specification. Read-only — the report fixes nothing. `summary` always carries FULL counts, so a truncated findings list stays visibly truncated.', {
      severity: z.enum(['error', 'warning']).optional(),
      rule: z.union([z.string(), z.number()]).optional(),
      limit: z.number().int().positive().optional(),
    }, ['INVALID_ARGUMENT']),
    renderings: { internal: ['reference-tools.check_consistency'], mcp: ['c4s-reader.check_consistency'] },
  });

  /**
   * 2.1.26 — ambiguity is not an error here, it is the answer: a phrase several
   * entities match comes back as a ranked candidate list with a `score` each.
   */
  registerRow({
    ...coreRead('resolve_identity', 'Candidates for a name/slug fragment ACROSS every active type, ranked with a score each — a cross-type facade over the per-type indexes, so the caller need not know the type before asking. An ambiguous phrase is answered with the candidates, never refused.', {
      query: z.string(),
      types: z.array(z.string()).optional(),
      limit: z.number().int().positive().optional(),
    }, ['INVALID_TYPE', 'INDEX_STALE']),
    renderings: { internal: ['entity-tools.resolve_identity'], mcp: ['c4s-reader.resolve_identity'] },
  });

  // ── M31 Workspace ─────────────────────────────────────────────────────────

  registerRow({
    name: 'list_projects',
    summary: 'Projects of the workspace: { workspace, projects: [{ id, name?, description? }] } — never a directory. A conscious navigational exception in a catalog otherwise about specification content — without it a project-scoped catalog is unreachable from outside.',
    scope: 'workspace',
    mediation: 'direct',
    opClass: 'read',
    inputSchema: {},
    // No pagination, no error codes: an unreadable config.json yields an entry
    // WITHOUT `name` rather than a failure. One bad project must not make the
    // workspace unlistable.
    errorCodes: [],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: direct(),
      cli: na(CLI_NA_PROJ),
      mcp: direct(),
      // 2.1.26 — the reason is the record's `powody.rest`, verbatim.
      rest: na('odłożone do fazy 2 — trasy tej operacji jeszcze nie zbudowano'),
    },
    // 2.1.26 — the record's `narzedzia`: one tool renders it in both agentic channels.
    renderings: { internal: ['workspace-tools.list_projects'], mcp: ['workspace-tools.list_projects'] },
  });

  // ── M37 Internal Skills Registry ─────────────────────────────────────────

  /**
   * 0.2.99 — the instruction exception. The subject of these two is not
   * specification content but the instruction governing how it is written (the
   * active writing style and its methodology). They are in the catalog because
   * without them the write operations are unusable CONVENTIONALLY from outside:
   * a caller can invoke them, but not invoke them correctly. The test is one
   * sentence — "can an outside caller use the catalog correctly without it?".
   *
   * Semantics in `services/skill-operations.ts`; every channel only wraps it.
   */
  registerRow({
    name: 'list_skills',
    summary: 'Skills of the project registry as { slug, description, origin, project? } rows (`origin` = the `source` of the winning entry; `project` only for origin project-exposed), plus the active writing style ({ slug, title } or null) reported beside them, never as a row. `contextType` narrows to the resolver set of that conversation type; omitted, it addresses the whole registry.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'read',
    inputSchema: {
      contextType: z
        .string()
        .optional()
        .describe('One of chat, brief, patch, ask (owned by the context type registry). Omit for the whole registry.'),
    },
    errorCodes: ['INVALID_ARGUMENT'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      // Mounting is per-server: a `list_skills` tool on the turn's `skill-tools`
      // would appear in all four context types at once, and the turn already has
      // the listing as the `<available_skills>` block before its first tool call.
      // 2.1.26 — the reason is the record's `powody.internal`, verbatim.
      internal: na(
        'tura dostaje listing jako blok `<available_skills>` promptu systemowego; montowanie MCP jest per serwer, więc narzędzie w tym kanale trafiłoby naraz do wszystkich czterech typów kontekstu',
      ),
      cli: direct(),
      mcp: direct(),
      rest: direct(),
    },
    // 2.1.26 — the record's `narzedzia`: the external reader's `list_skills` only.
    renderings: { mcp: ['c4s-reader.list_skills'] },
  });

  registerRow({
    name: 'load_skill_file',
    summary: 'Open a skill of the project registry (SKILL.md in the form its source serves it, the entry\'s `source`, `hash` from a writable source, and the manifest of the package files — cut to the source\'s manifest limit if it declares one) or read one package subfile by (slug, file). Serves the precedence winner of the whole registry, not a context-filtered subset; never a disk path. A slug the registry does not resolve is refused with its reason.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'read',
    inputSchema: {
      slug: z.string().describe('Skill slug from the registry (as returned by list_skills).'),
      file: z
        .string()
        .optional()
        .describe('Package-relative POSIX path from the manifest. Defaults to "SKILL.md".'),
    },
    errorCodes: ['SKILL_NOT_FOUND', 'SKILL_FILE_NOT_FOUND', 'NOT_TEXT', 'INVALID_ARGUMENT'],
    sideEffects: ['none'],
    idempotent: true,
    channels: fullParity(),
    // 2.1.26 — the record's `narzedzia`: the turn's `skill-tools` (internal) and the
    // external reader (mcp), both built by `buildSkillToolsServer`.
    renderings: { internal: ['skill-tools.load_skill_file'], mcp: ['c4s-reader.load_skill_file'] },
  });

  // ── M52 Spec Skills (2.1.9) ──────────────────────────────────────────────

  /**
   * 2.1.9 — `update_skill_file`, sheet `katalog-operacji-m52` row 2. Admitted by
   * the BASIC test of M43 `l3admit0`, not by the instruction exception: its
   * subject is a file of the project's `skills` root, i.e. specification content
   * (reading instructions stays under the instruction exception).
   *
   * The sheet's columns this declaration has no field for are honoured by the
   * implementation (`services/skill-write.ts`) and stated here so the row reads
   * whole: addressing `(slug, file)`; guard REQUIRED (`expectedHash`, `""`
   * creates a file that must not exist); multiplicity single-target — one
   * package file, header validation concerns a single `SKILL.md`; rules
   * `echo-free` (the answer carries the address and the new hash, never the
   * file), `error-code-once`, `literal-match`, `match-count-declared`,
   * `edit-set-not-procedure`, `diff-field-names`; WITHOUT
   * `replacements-returned` (the answer carries no substitution count) and
   * WITHOUT `operation-only-write` (a write by the built-in file tools into the
   * `skills` root is accepted and versioned).
   *
   * `SKILL_READ_ONLY`: a slug outside the project's `skills` root that the
   * registry resolves to an exposed project (`project-exposed` winner) is refused
   * as read-only, pointing at `ask` on the provider (`SkillWriteDeps.readOnlyReason`,
   * wired in the project context).
   */
  registerRow({
    name: 'update_skill_file',
    summary:
      'Write one file of a skill package of the current project, addressed by (slug, file) with `file` defaulting to SKILL.md, through the project\'s `skills` root. Exactly one of `content` (the whole new file) and `textEdits` (literal substitutions). `expectedHash` is REQUIRED: the file\'s current hash, or "" to create a file that must not exist yet; any other mismatch is PAGE_CONFLICT. A SKILL.md left without a non-empty `description` in its frontmatter is refused. Answers { slug, file, hash }.',
    scope: 'project',
    mediation: 'agent-mediated',
    opClass: 'write',
    inputSchema: UPDATE_SKILL_FILE_INPUT,
    errorCodes: ['SKILL_READ_ONLY', 'INVALID_ARGUMENT', 'PAGE_CONFLICT', 'FIND_NOT_FOUND', 'MATCH_COUNT_MISMATCH'],
    sideEffects: ['file'],
    contentInput: 'literal+diff',
    idempotent: true,
    // 2.1.26 — the `n/a` reasons are the record's `powody`, verbatim.
    channels: {
      internal: direct(),
      cli: na('zapis skilli z zewnątrz poza v1'),
      mcp: na('zapis skilli z zewnątrz poza v1'),
      rest: na('człowiek pisze trasami zapisu stron przez fasadę korzenia `skills`'),
    },
    renderings: { internal: ['spec-skill-tools.update_skill_file'] },
  });

  /**
   * 2.1.9 — `fork_writing_style`, sheet `katalog-operacji-m52` row 3: a local copy
   * of a writing style that comes from a plugin (2.1.17: any such style, not only
   * the active one). Human-mediated — an
   * action of the `#skills` settings card ("Fork writing style locally"), so it is
   * rendered on `rest` alone (`POST /api/spec-skills/style-forks`).
   *
   * The sheet's columns without a field here, honoured by the implementation
   * (`services/style-fork.ts`): addressing by the slug of a writing style from a
   * plugin — any, not only the active one; the operation never checks it against
   * `config.writingStyle`; content description `n/d` (nothing is sent — the
   * package is copied); guard `n/d` — an existing package of that slug is a
   * refusal (`SKILL_ALREADY_EXISTS`), never an overwrite; single-target (one
   * style per call); rules `echo-free` (the
   * answer is the copy's address, never its content), `error-code-once`.
   * `INVALID_ARGUMENT` also covers a style that does not come from a plugin.
   * `config.writingStyle` is never changed.
   */
  registerRow({
    name: 'fork_writing_style',
    summary:
      'Copy the package of a writing style that comes from a plugin — any such style, named by its slug, not only the active one — into a package of the same slug in the project\'s `skills` root. The slug is not compared with `config.writingStyle`, which stays unchanged. The copy records its origin as `forkedFrom: plugin:<slug>@<version>` in its SKILL.md frontmatter, and its own `version` is capped at the highest one the skill registry supports. An existing package of that slug is refused, never overwritten. Answers { slug, path }.',
    scope: 'project',
    mediation: 'human-mediated',
    opClass: 'write',
    inputSchema: {
      slug: z
        .string()
        .describe(
          'Slug of the writing style from a plugin to copy; the local package gets the same slug. It need not equal `config.writingStyle` — the operation does not compare it with the active style.',
        ),
    },
    errorCodes: ['SKILL_NOT_FOUND', 'SKILL_ALREADY_EXISTS', 'INVALID_ARGUMENT'],
    sideEffects: ['file', 'ui-notify'],
    contentInput: 'n/a',
    idempotent: false,
    // 2.1.26 — the `n/a` reasons are the record's `powody`, verbatim.
    channels: {
      internal: na('akcja karty ustawień'),
      cli: na('akcja karty ustawień'),
      mcp: na('akcja karty ustawień'),
      rest: direct(),
    },
  });

  /**
   * 2.1.9 — `list_exposed_projects`, sheet `katalog-operacji-m52` row 4: the
   * projects of the workspace exposed as a skill, with the status of the current
   * project's attachments (`ok` / `unavailable` / `ambiguous`). Workspace-scoped
   * (its subject is the workspace's projects), addressed by the current project
   * (whose `skill.uses` it reports). It feeds only the `#skills` settings card,
   * so it is rendered on `rest` alone. Read: no guard, no error code of its own
   * (`n/d`), `echo-free`, `error-code-once`; single-target — the workspace list
   * is one answer, no paging: it is short by nature, and an incomplete one would
   * be useless for choosing attachments.
   */
  registerRow({
    name: 'list_exposed_projects',
    summary:
      'Projects of the workspace exposed as a skill, seen from the current project: one row per skill name with the provider\'s description and project id, whether the current project attaches it (`uses`), and the attachment status — ok, unavailable (no project exposes the name) or ambiguous (several do). The current project has no row.',
    scope: 'workspace',
    mediation: 'direct',
    opClass: 'read',
    inputSchema: {},
    errorCodes: [],
    sideEffects: ['none'],
    idempotent: true,
    // 2.1.26 — the `n/a` reasons are the record's `powody`, verbatim.
    channels: {
      internal: na('zasila wyłącznie kartę ustawień'),
      cli: na('zasila wyłącznie kartę ustawień'),
      mcp: na('zasila wyłącznie kartę ustawień'),
      rest: direct(),
    },
  });

  // ── M23 Patches ───────────────────────────────────────────────────────────

  registerRow({
    name: 'create_patch',
    summary: 'File a patch against a brief: which brief, what class of deviation, what drifted. Takes the INTENT, not a finished file — the server writes it.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'brief',
    inputSchema: {
      brief: z.string().describe('Brief path relative to the briefs root (.claude4spec/briefs). Must name a real file.'),
      desc: z.string().min(1).describe('Short description of the drift. Drives the file slug and the body heading.'),
      patchKind: z.enum(PATCH_KINDS).optional().describe('Default `drift`.'),
      body: z.string().describe('The patch body — what drifted and what the spec author should consider.'),
      createdBy: z.string().optional().describe('Reporter identity. Defaults to the calling channel.'),
    },
    errorCodes: ['BRIEF_NOT_FOUND', 'VALIDATION', 'PATCH_WRITE_FAILED'],
    // 2.1.26 — the `create-patch` record's `efekty`: the in-band M42 chain
    // (`writePatchRecord`) ends in the frontmatter indexer's `patches:changed`.
    sideEffects: ['file', 'db', 'ui-notify'],
    /**
     * 0.2.37 — `literal`, and a differential mode is not merely absent here, it
     * is out of the question. A patch PROPOSES A NEW ARTEFACT; the server
     * authors the file. There is no prior text for a `find` to match, so the
     * question the field asks has only one answer this operation can give.
     */
    contentInput: 'literal',
    // Two filings of the same drift produce two files — `desc` drives the slug.
    idempotent: false,
    channels: {
      // 2.1.4: a patch has ONE producer — the implementer, in its terminal (and
      // REST under it). The patch thread applies a patch, it never files one, and
      // no agent channel renders this operation. 2.1.26 — the `create-patch`
      // record's `powody`, verbatim; `narzedzia` is empty, so no `renderings`.
      internal: na('producentem patcha jest terminalowy agent-implementer, a wątek `patch` patch **stosuje**, zamiast go zgłaszać'),
      cli: direct(),
      mcp: na('zgłoszenie driftu ma jednego producenta, implementera pracującego kanałem `cli`'),
      rest: direct(),
    },
  });

  /**
   * 2.1.4 — the patch thread's read. `internal` is `direct` now (it was `n/a`:
   * the body used to ride in the system prompt); the prompt carries only the
   * patch's address and frontmatter. Rendered by `patch-tools`, mounted only for
   * `context_type='patch'`, where `path` defaults to `chat_thread.patch_path`.
   *
   * `opClass: 'read'` (not `brief`): the patch profile does not admit `brief`,
   * and a `brief` row here would make the gate drop the thread's own tool.
   */
  registerRow({
    name: 'get_patch',
    summary:
      'Read a patch: path, frontmatter (patch_kind, applied, brief), markdown content and sha256 hash, optionally through a 1-based inclusive line window (`range`). A patch over the response budget comes back `truncated: true` with a `truncationHint` pointing at `range`.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'read',
    inputSchema: {
      path: z.string().optional().describe('Patch path relative to the patches root (.claude4spec/patches). Defaulted from the thread only in the `internal` channel.'),
      range: z
        .object({ start: z.number().int().positive(), end: z.number().int().positive() })
        .optional()
        .describe('1-based inclusive line window; no `sectionIndexed` gate. A `start` past the end of the file is INVALID_ARGUMENT stating the size.'),
    },
    /**
     * 2.1.26 — the `get-patch` record's three codes: PATCH_NOT_FOUND for an
     * unknown path, INVALID_ARGUMENT for a window starting past the end (stating
     * the size), PATCH_INVALID_FRONTMATTER for a file in the patches root whose
     * frontmatter does not mark a patch (`PatchService.getPatch`).
     */
    errorCodes: ['PATCH_NOT_FOUND', 'INVALID_ARGUMENT', 'PATCH_INVALID_FRONTMATTER'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: direct(),
      // 2.1.26 — the record's `powody`, verbatim. 2.1.48: `rest` is direct, rendered
      // by the artifact detail route with `view=operation`
      // (GET /api/artifacts/patch/<path>?view=operation) — no reason, no `via`.
      cli: na('żadna komenda `c4s` nie renderuje jeszcze odczytu patcha'),
      mcp: na('odczyt patcha istnieje dla wątku, który ten patch stosuje; kanał `mcp` nie ma wątku zakotwiczonego w patchu'),
      rest: direct(),
    },
    // 2.1.26 — the record's `narzedzia`: `patch-tools-get-patch` (internal).
    renderings: { internal: ['patch-tools.get_patch'] },
  });

  /**
   * 2.1.4 — the patch thread's declaration that the patch is folded into the
   * spec. One-way from the agent channel (`applied: false` is INVALID_ARGUMENT —
   * reverting is the user's, in the UI) and idempotent (a repeat writes no file
   * and notifies no client). No concurrency guard: one boolean flipped in one
   * direction converges to the same value.
   */
  registerRow({
    name: 'mark_patch_applied',
    summary:
      'Declare a patch applied to the specification. One-way from the agent channel — `applied: false` is INVALID_ARGUMENT; only the user unsets it. Idempotent: a repeat writes nothing.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'write',
    inputSchema: {
      applied: z.boolean().describe('Only true is accepted from the agent channel.'),
      path: z.string().optional().describe('Patch path relative to the patches root (.claude4spec/patches). Defaulted from the thread only in the `internal` channel.'),
    },
    // 2.1.26 — the `mark-patch-applied` record's three codes; PATCH_INVALID_FRONTMATTER
    // comes from the shared loader (`getPatch`) on a file that is not a patch.
    errorCodes: ['PATCH_NOT_FOUND', 'INVALID_ARGUMENT', 'PATCH_INVALID_FRONTMATTER'],
    sideEffects: ['file', 'db', 'ui-notify'],
    contentInput: 'n/a',
    idempotent: true,
    channels: {
      internal: direct(),
      // 2.1.26 — the record's `powody`, verbatim. `rest` is
      // PATCH /api/artifacts/patch/:path/frontmatter with { applied }.
      cli: na('jedyny realny wołający kończy wdrożenie patcha w wątku, nie w terminalu'),
      mcp: na('deklarację wdrożenia składa wątek, który patch stosuje; kanał `mcp` nie ma wątku zakotwiczonego w patchu'),
      rest: direct(),
    },
    // 2.1.26 — the record's `narzedzia`: `patch-tools-mark-patch-applied` (internal).
    renderings: { internal: ['patch-tools.mark_patch_applied'] },
  });

  /**
   * 2.1.26 (M23 `m23mcp01`) — `list_patches`, the read family's list position:
   * the project's patch set, optionally narrowed to one brief (`brief`, a path
   * relative to the briefs root) or to the applied state (`applied`). Its one
   * rendering is `transagent-tools · list_patches` (internal), mounted only on a
   * top-level `chat` thread — the orchestrator plans a patch series from it and
   * re-checks the flag after every banka. A `patch` thread, closed on one patch,
   * never has it. `rest` is `GET /api/artifacts/patch` (`?brief`, `?applied`).
   *
   * The order is the domain's (`PatchService.listPatches`: `created_at`
   * ascending, ties by `path`, undated last by `path`); the window is M39's
   * implicit matrix. A brief in the filter that does not exist yields an empty
   * list, not a refusal; an invalid `applied` value is VALIDATION (the REST
   * query parser — the internal rendering's schema admits a boolean only).
   *
   * Class `read`, as `list_briefs` / `list_plans`: `chat` admits it, and the
   * operation never mutates.
   */
  registerRow({
    name: 'list_patches',
    summary:
      "The project's patches — path, title, brief, kind, applied flag and creation time, never content — optionally narrowed to one brief or to the applied state.",
    scope: 'project',
    mediation: 'direct',
    opClass: 'read',
    inputSchema: {
      brief: z
        .string()
        .optional()
        .describe('Brief path relative to the briefs root (.claude4spec/briefs). Omit for every brief.'),
      applied: z
        .boolean()
        .optional()
        .describe('Narrow to applied (true) or not yet applied (false). Omit for all.'),
      ...paging,
    },
    errorCodes: ['VALIDATION'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: direct(),
      // The record's `powody`, verbatim.
      cli: na('brak komendy `c4s`: jedynym realnym wołającym jest agent w wątku albo użytkownik w UI, nie człowiek w terminalu'),
      mcp: na('przegląd zbioru zgłoszeń należy do UI i REST; klient kanału `mcp` nie ma intencji, której obiektem byłby zbiór patchy'),
      rest: direct(),
    },
    renderings: { internal: ['transagent-tools.list_patches'] },
  });

  // ── M13 entity writes ─────────────────────────────────────────────────────
  //
  // Declared so the profile gate can SEE them. This is what turns the `ask`
  // profile from a posture into a gate: a consulted peer used to be handed these
  // tools and merely discouraged from using them by forced plan mode — but MCP
  // tools are not subject to the built-in read-only filter, so the discouragement
  // was the only thing standing between a peer and a write to the spec it was
  // consulted about. Now they are absent from its `tools/list`.
  //
  // Batch semantics are per-item and NON-TRANSACTIONAL: each element gets its own
  // result envelope, and a duplicate slug fails that element with SLUG_CONFLICT
  // rather than rolling back its siblings.

  /**
   * 2.1.26 — the three rows are the M13 records `create-entities`,
   * `update-entities` and `delete-entities`: project scope, direct mediation,
   * direct in all four channels, effects file/db/ui-notify, `errorCodes` exactly
   * the record's `kodyBledow`, and `renderings` the record's `narzedzia` (one
   * `entity-tools` tool per operation, in both agentic channels).
   *
   * ASSUMPTION:dev-2602 — `update_entities` / `delete_entities` declare
   * `ENTITY_NOT_FOUND` as their records do, while their `entity-tools` renderings
   * answer an absent slug with the per-item code `NOT_FOUND`, as the re-rendered
   * `mcp-tool` records state. The row follows the operation record; the tool
   * follows its own.
   */
  const entityWrite = (
    name: string,
    summary: string,
    inputSchema: z.ZodRawShape,
    idempotent: boolean,
    errorCodes: readonly string[],
    contentInput: ContentInputMode,
  ): OperationDeclaration => ({
    name,
    summary,
    scope: 'project',
    mediation: 'direct',
    opClass: 'write',
    inputSchema,
    errorCodes,
    sideEffects: ['file', 'db', 'ui-notify'],
    /**
     * 0.2.37 — `data` carries the FULL VALUE of every field it changes,
     * `contentBearing` fields with long text payloads included. The partial
     * update an entity mutation offers is partial BY FIELD, never inside a
     * field's content, so there is nothing differential about it (`literal`;
     * the record's `dosłowny`). A delete takes no content at all (`n/a`).
     */
    contentInput,
    idempotent,
    channels: { ...fullParity(), cli: na(CLI_NA_ENTITY) },
    renderings: { internal: [`entity-tools.${name}`], mcp: [`entity-tools.${name}`] },
  });

  registerRow(
    entityWrite(
      'create_entities',
      'Create several entities of one type. Per-item, non-transactional: a duplicate slug fails that item with SLUG_CONFLICT and leaves the rest applied; an item whose write raised warnings reports them beside its slug.',
      { type: z.string(), items: z.array(z.record(z.string(), z.unknown())).min(1) },
      false,
      ['INVALID_TYPE', 'SLUG_CONFLICT', 'VALIDATION'],
      'literal',
    ),
  );

  /**
   * Addressed by `(type, slug)` per element: `updates[]` carries `slug`, the
   * partial `data` and an optional explicit `newSlug` — the shape the rendering
   * takes. (This row named the list `items`, a second spelling of the input the
   * tool has never accepted.)
   */
  registerRow(
    entityWrite(
      'update_entities',
      'Update several entities of one type, partial by field (each changed field gets its full value). Idempotent per element; an absent slug fails that item with ENTITY_NOT_FOUND; an item whose write raised warnings reports them beside its slug.',
      {
        type: z.string(),
        updates: z
          .array(z.object({ slug: z.string(), data: z.record(z.string(), z.unknown()), newSlug: z.string().optional() }))
          .min(1),
      },
      true,
      ['INVALID_TYPE', 'ENTITY_NOT_FOUND', 'VALIDATION'],
      'literal',
    ),
  );

  /**
   * 0.2.86 — two corrections to this row, both from reading the handler.
   *
   * `idempotent: false`: a repeat is NOT a no-op. An absent slug fails that
   * item, deliberately — `entity-tools.ts` states the reason (the generic door
   * answers `{ deleted: false }`, and reporting that as `{ deleted: true }`
   * would tell an agent it removed something that was never there).
   *
   * And the summary names `brokenReferences`, because M43 `echo-free` makes it
   * the substance of the answer rather than a detail: the address of the effect
   * is the slug, and the part the caller could not have predicted is which
   * pages now point at nothing. It is counted BEFORE the delete (afterwards
   * there is nothing left to find), does not block the delete, and rewrites
   * nothing — the soft FK is the author's to repair in prose.
   */
  registerRow(
    entityWrite(
      'delete_entities',
      'Delete several entities of one type. Per-item, non-transactional: an absent slug fails that item with ENTITY_NOT_FOUND and leaves the rest applied, so a repeat is not a no-op. Each deleted item answers with `brokenReferences` — the pages that referenced it, counted before the delete; references neither block the delete nor get rewritten.',
      { type: z.string(), slugs: z.array(z.string()).min(1) },
      false,
      ['INVALID_TYPE', 'ENTITY_NOT_FOUND', 'VALIDATION'],
      'n/a',
    ),
  );

  /**
   * 2.1.26 — M13 record `restore-entity-version`: bring an entity back to an
   * earlier `entity_version` on an explicit decision of the user in the UI.
   *
   * Human-mediated, and rendered in `rest` alone
   * (`POST /api/entities/:type/:slug/versions/:version/restore`, owner
   * `VersionService.restore`). The three other cells are `n/a` with the record's
   * reasons: the act undoes someone else's work, so it is user-initiated, and
   * letting it into the agentic channels first needs a meaning of "restore" for a
   * caller that does not see the history (M13 `m13mcp00`). No `renderings`.
   *
   * Behaviour (the owner's): restoring a version that is a delete tombstone
   * deletes the entity; a deleted entity cannot be restored — no entity or no
   * such version is `NOT_FOUND`; an inactive type is `INVALID_TYPE`; an unknown
   * type, a boot in progress or a missing payload migration is `VALIDATION`.
   * Idempotent: restoring the same version twice leaves the same state. The
   * restored snapshot is written whole (`literal`).
   */
  const RESTORE_NA_REASON = 'akt user-initiated, bo cofa cudzą pracę; przegląd klasyfikacji otwarty';
  registerRow({
    name: 'restore_entity_version',
    summary: 'Restore an entity to an earlier version, on an explicit decision of the user in the UI. Restoring a delete tombstone deletes the entity; a deleted entity cannot be restored.',
    scope: 'project',
    mediation: 'human-mediated',
    opClass: 'write',
    inputSchema: { type: z.string(), slug: z.string(), version: z.number().int().positive() },
    errorCodes: ['INVALID_TYPE', 'VALIDATION', 'NOT_FOUND', 'INTERNAL'],
    sideEffects: ['file', 'db', 'ui-notify'],
    contentInput: 'literal',
    idempotent: true,
    channels: {
      internal: na(RESTORE_NA_REASON),
      cli: na(RESTORE_NA_REASON),
      mcp: na(RESTORE_NA_REASON),
      rest: direct(),
    },
  });

  // ── M18 tags ──────────────────────────────────────────────────────────────

  /**
   * 2.1.26 — each row carries its record's `kodyBledow` and its `narzedzia`.
   *
   * The codes are per operation, not one pair for all five: `create_tag` cannot
   * miss a target (it addresses nothing) but can collide (`SLUG_CONFLICT`),
   * `update_tag` can do both, and the three that address an existing tag or
   * entity answer `NOT_FOUND`. A type unknown or inactive is `VALIDATION` — the
   * dedicated `INACTIVE_TYPE` / `ENTITY_NOT_FOUND` of the tag doors are gone.
   * Every row is rendered by its namesake on `reference-tools`, in both agentic
   * channels.
   */
  const tagWrite = (
    name: string,
    summary: string,
    inputSchema: z.ZodRawShape,
    idempotent: boolean,
    errorCodes: string[],
  ) =>
    registerRow({
      name,
      summary,
      scope: 'project',
      mediation: 'direct',
      opClass: 'write',
      inputSchema,
      errorCodes,
      sideEffects: ['file', 'db', 'ui-notify'],
      // A tag is a name and a colour; there is no content to describe either way.
      contentInput: 'n/a',
      idempotent,
      channels: { ...fullParity(), cli: na(CLI_NA_TAGS) },
      renderings: { internal: [`reference-tools.${name}`], mcp: [`reference-tools.${name}`] },
    });

  /**
   * 0.2.50 — these five rows are RE-DECLARED to match `reference-tools`, which
   * is what actually runs. They had drifted in a way the catalog's own opening
   * claim ("ONE declaration per operation, RENDERED into four channels") rules
   * out: `create_tag` required `slug` here and `name` there — DISJOINT required
   * fields, so a caller obeying this row failed validation at the MCP boundary
   * and vice versa — and `tag_entity` named its list `tagSlugs` here and `tags`
   * there. Since `inputSchema` is what the REST and CLI channels validate
   * against, the divergence meant one operation with two contracts depending on
   * which door you came through. The MCP shape wins because it is the one in
   * use: a tag is created by NAME (the slug is derived and returned), colour and
   * description are optional, and a tag is not identified by a colour.
   */
  tagWrite('create_tag', 'Create a tag in the registry. The slug is derived from `name` and returned.', { name: z.string(), color: z.string().optional(), description: z.string().optional() }, false, ['VALIDATION', 'SLUG_CONFLICT']);
  // `update_tag` nests its mutable fields under `data` because `reference-tools`
  // does, and for the same reason the four rows around it were corrected: the row
  // is a DECLARATION of the operation that runs, not a second design of it. Left
  // flat, this was the one tag row still carrying the divergence the comment
  // above claims to have closed.
  tagWrite('update_tag', 'Rename or restyle a tag; a slug change propagates through references.', { slug: z.string(), data: z.object({ name: z.string().optional(), color: z.string().nullable().optional(), description: z.string().nullable().optional() }) }, true, ['VALIDATION', 'NOT_FOUND', 'SLUG_CONFLICT']);
  tagWrite('delete_tag', 'Remove a tag from the registry and every entity carrying it.', { slug: z.string() }, true, ['VALIDATION', 'NOT_FOUND']);
  tagWrite('tag_entity', 'Attach tags to an entity. Idempotent — the entity ends up with the UNION of its existing tags and these. Tags that do not exist yet are created.', { type: z.string(), slug: z.string(), tags: z.array(z.string()) }, true, ['VALIDATION', 'NOT_FOUND']);
  tagWrite('untag_entity', 'Detach tags from an entity. Idempotent.', { type: z.string(), slug: z.string(), tags: z.array(z.string()) }, true, ['VALIDATION', 'NOT_FOUND']);

  // ── M02 Pages / M06 Sections — the page WRITE path (item 28) ──────────────
  //
  // The operations the brief names as the sanctioned way to write a page, in
  // place of the agent's built-in `Write`/`Edit`. Declared here for the same
  // reason the entity writes are: a declaration is what the profile gate SEES,
  // and without a row these four would pass through to every profile on the
  // strength of living on a host-owned server.
  //
  // Addressing is `(rootId, relPath)` — a root is part of a page's identity,
  // not a filter over one namespace — except `update_sections`, which addresses
  // by anchor because an anchor is globally unique and already carries its root.
  //
  // The `cli` cells say `direct` with no `c4s` command behind them, and that is
  // the declared contract rather than an oversight: a cell states the mediation
  // class of a channel, not a promise that a command exists. Fifteen other
  // operations are in the same position, and 0.2.13's L14 command surface is
  // read-only by design.
  //
  // 2.1.26 — each row matches its `spec-operation` record (`create-page`,
  // `update-page`, `delete-page`, `move-page`, `update-sections`): `errorCodes`
  // is the record's `kodyBledow`, each code once (no shared base plus extras),
  // `idempotent` its `idempotencja` (`warunkowa` → `'conditional'`), and
  // `renderings` its `narzedzia` — the `page-tools` tool of the same name in
  // both agentic channels.

  const pageWrite = (
    name: string,
    summary: string,
    inputSchema: z.ZodRawShape,
    idempotent: boolean | 'conditional',
    errorCodes: readonly string[],
    contentInput: ContentInputMode,
  ): OperationDeclaration => ({
    name,
    summary,
    scope: 'project',
    mediation: 'direct',
    opClass: 'write',
    inputSchema,
    errorCodes,
    // `ui-notify` is not decoration: the write is labelled through M40's write
    // token and its reactions are driven to completion before the caller is
    // answered, which is what re-indexes the page and pushes it to open editors.
    sideEffects: ['file', 'db', 'ui-notify'],
    contentInput,
    idempotent,
    channels: { ...fullParity(), cli: na(name === 'update_sections' ? CLI_NA_SECTION : CLI_NA_PAGES) },
    renderings: { internal: [`page-tools.${name}`], mcp: [`page-tools.${name}`] },
  });

  /**
   * `expectedHash` — REQUIRED as of 0.2.15, honoured identically by all four
   * channels.
   *
   * It was optional here, with a note that requiring it would break page saving
   * because the editor did not send one. That was true and is no longer: the
   * editor could not send one because `GET /api/pages/:rootId/*` did not return
   * a hash at all. It does now, so the reason the guard was optional is gone
   * and the guard is mandatory — enforced in `services/page-write.ts` rather
   * than per channel, since a guard only some doors apply is not a guard.
   */
  const expectedHash = {
    expectedHash: z
      .string()
      .describe(
        'REQUIRED. sha256 of the file as last read. Missing → INVALID_ARGUMENT; mismatch → PAGE_CONFLICT carrying the current hash.',
      ),
  };

  /**
   * 0.2.37 — the differential payload, declared ONCE and shared by both
   * operations that take it. The naming is locked at this layer and binds every
   * future differential operation: `replaceWith` (not `replace`, already a
   * section action), `textEdits` (not `edits`, already the section batch), and
   * `expectedMatches` (not `expect`, an echo of `expectedHash`).
   */
  const textEdit = z.object({
    find: z.string().min(1).describe('Matched literally, byte for byte. No regex, no whitespace normalization.'),
    replaceWith: z.string().describe('Inserted in place of every hit; "" deletes the matched text.'),
    expectedMatches: z
      .union([z.number().int().min(1), z.literal('all')])
      .optional()
      .describe('Omitted means EXACTLY ONE. "all" substitutes every hit without declaring a count.'),
  });

  registerRow(
    pageWrite(
      'create_page',
      'Create a page that does not exist yet. Refuses PAGE_EXISTS rather than overwriting — the distinction update_page deliberately does not make.',
      // CreatePageRequest; REST answers CreatePageResponse { rootId, path, hash, version, anchors } (2.1.23),
      // the `create_page` tool the same plus the settled `content` (2.1.26).
      { rootId: z.string(), path: z.string(), content: z.string().optional(), title: z.string().optional() },
      // A second call with the same address is PAGE_EXISTS, not a no-op.
      false,
      // 2.1.27 — a path that leaves the root is INVALID_ARGUMENT, its own code
      // beside the empty path's VALIDATION.
      ['PAGE_EXISTS', 'ROOT_NOT_FOUND', 'INVALID_ARGUMENT', 'VALIDATION'],
      // There is nothing on the page yet to substitute fragments of.
      'literal',
    ),
  );

  /**
   * 0.2.37 — TWO modes, and the row has to carry both.
   *
   * 2.1.26 — `idempotent: 'conditional'`, the record's `warunkowa`: the literal
   * branch is idempotent by content, the differential branch is not (replaying
   * it answers `FIND_NOT_FOUND`, the `delete` class of behaviour). Until the
   * field had a third value this row said `true` and left the summary to repair
   * the half-truth.
   *
   * This is also the first row whose `rest` cell renders onto TWO routes —
   * `PUT` for the literal mode, `PATCH` for the differential one. See the
   * `ChannelCell` doc in `catalog.ts` for the conditions that permits.
   */
  registerRow(
    pageWrite(
      'update_page',
      'Write a page — create or replace: EITHER in full (`body` plus optional `frontmatter`, which replaces the page\'s frontmatter wholesale) OR differentially (`textEdits` — literal find/replaceWith substitutions over the whole file, frontmatter included). Exactly one of the two per call; both or neither is INVALID_ARGUMENT. The literal mode creates a page missing from a known root rather than answering NOT_FOUND (the `update-page` record) — which is how the editor saves a new page. The differential mode is NOT idempotent — replaying it answers FIND_NOT_FOUND. Both modes carry M06\'s ANCHOR_LOSS guard, overridable with `dropAnchors`; the returned `hash` is taken after the in-band anchor injection.',
      {
        rootId: z.string(),
        path: z.string(),
        body: z.string().optional(),
        frontmatter: z.record(z.string(), z.unknown()).optional(),
        textEdits: textEdit.array().min(1).optional(),
        dropAnchors: z.array(z.string()).optional(),
        ...expectedHash,
      },
      'conditional',
      // ASSUMPTION:dev-0101 — an unknown root is ROOT_NOT_FOUND (the row: NOT_FOUND).
      // ASSUMPTION:m02u-dev-0001 — the row's ROOT_NOT_WRITABLE has no producer in the page write path.
      // No NOT_FOUND for a missing page: the literal mode creates it (2.1.14; the record's `zachowanie` since 2.1.27).
      ['PAGE_CONFLICT', 'ROOT_NOT_FOUND', 'INVALID_ARGUMENT', 'FIND_NOT_FOUND', 'MATCH_COUNT_MISMATCH', 'ANCHOR_LOSS', 'VALIDATION'],
      'literal+diff',
    ),
  );

  /**
   * 2.1.26 — the record's guard is `opcjonalny`, and the row carries it as an
   * optional `expectedHash`: the REST rendering takes it (query or body) and a
   * mismatch is `PAGE_CONFLICT`. The `delete_page` tool withdrew the parameter
   * this window, so in the agentic channels the guard does not run — a property
   * of the rendering, not of the operation. A page that is not there is a
   * success with `deleted: false`, never a refusal, hence `idempotent: true`.
   */
  registerRow(
    pageWrite(
      'delete_page',
      'Delete a page. The content stays recoverable through file_version — the delete authors a tombstone rather than dropping the history.',
      {
        rootId: z.string(),
        path: z.string(),
        expectedHash: z
          .string()
          .optional()
          .describe('Optional. sha256 of the file as last read; a mismatch → PAGE_CONFLICT carrying the current hash.'),
      },
      true,
      ['ROOT_NOT_FOUND', 'PAGE_CONFLICT', 'VALIDATION'],
      // A delete names a page and carries no content at all.
      'n/a',
    ),
  );

  /**
   * 0.2.78 — a move is its own operation, not a create plus a delete.
   *
   * `contentInput: 'n/a'` because it never sees the content: the bytes are
   * relocated by an atomic rename and the format adapter is not invoked at all.
   * `idempotent: false` for the reason `create_page` is — a replay names a
   * source that no longer exists and answers `NOT_FOUND`, which puts it in the
   * `delete` class rather than the `replace` class.
   *
   * `rest` renders it as `POST /api/pages/:rootId/move`, with both paths in the
   * body; the route's own comment carries why the URL cannot hold them.
   */
  registerRow(
    pageWrite(
      'move_page',
      'Move a page to another path within the SAME root — one call covers both renaming a file and moving it to a different directory. The content is never read or re-serialized, so the hash is unchanged; citations of the old path are rewritten afterwards, each as its own write. NOT idempotent: a replay answers NOT_FOUND.',
      { rootId: z.string(), from: z.string(), to: z.string(), ...expectedHash },
      false,
      // 2.1.27 — the record declares NOT_IMPLEMENTED (a root without a record
      // store) and no longer VALIDATION: an empty `from`/`to` is INVALID_ARGUMENT.
      ['PAGE_CONFLICT', 'PAGE_EXISTS', 'NOT_FOUND', 'ROOT_NOT_FOUND', 'INVALID_ARGUMENT', 'NOT_IMPLEMENTED'],
      'n/a',
    ),
  );

  registerRow(
    pageWrite(
      'update_sections',
      'Edit one or more sections of ONE page, addressed by anchor. A convenience over update_page — read-modify-write of the whole page with the same primitive — not a separate store, and not a structural gap in the model. Six actions: `replace`/`append`/`insert_after` take `content` (2.1.7: `replace` and `append` act on the section\'s OWN body — below the heading, before its first subsection — and refuse a heading at or above the section\'s level), `delete` takes neither, `edit` (0.2.37) takes `textEdits` — literal substitutions inside the addressed subtree — and `rename` (0.2.100) takes `heading`, rewriting the heading line alone with its level and its anchor kept. TRANSACTIONAL: the single exception to the partial-success rule, because every edit rewrites the same file. One anchor may carry several actions; elements whose claims on the page (as it was before the write) collide refuse the batch, and `results[]` has one row per element.',
      {
        ...expectedHash,
        edits: z.array(
          z.object({
            anchor: z.string(),
            action: z.enum(['replace', 'append', 'insert_after', 'delete', 'edit', 'rename']),
            content: z.string().optional(),
            textEdits: textEdit.array().min(1).optional(),
            heading: z.string().optional(),
          }),
        ).min(1),
        dropAnchors: z.array(z.string()).optional(),
      },
      // 2.1.26 — `'conditional'` (the record's `warunkowa`): `replace` is
      // idempotent by content, `rename` by heading text, `delete` with
      // SECTION_NOT_FOUND on a repeat; `append`, `insert_after` and `edit` are
      // not, and a batch is as idempotent as the product of its edits.
      //
      // `dropAnchors` does not change that: a superset of what a repeat call
      // actually drops is legal precisely so the idempotent actions stay
      // idempotent when the declaration is replayed verbatim.
      'conditional',
      [
        'SECTION_NOT_FOUND',
        'INVALID_ARGUMENT',
        'FIND_NOT_FOUND',
        'MATCH_COUNT_MISMATCH',
        'ANCHOR_LOSS',
        'ANCHOR_DUPLICATE',
        // 0.2.77 — the whole batch is refused before any edit reaches the file
        // when the addressed page's section projection is marked stale. A write
        // that takes its coordinates from a projection that did not recompute
        // lands in the wrong place, which is the one outcome worth refusing for.
        'INDEX_STALE',
        'PAGE_CONFLICT',
        'ROOT_NOT_FOUND',
        'VALIDATION',
      ],
      'literal+diff',
    ),
  );

  // ── M08 TODOs / M14 Page Links / M30 Static HTML — the UI's read routes ────
  //
  // 2.1.26 — five operations whose only rendering is a REST route the UI calls
  // (`GET /api/todos`, `/api/todos/counts`, `/api/page-links`,
  // `/api/page-links/counts`, `GET /api/static/:rootId/*`), plus the `@`
  // autocomplete, which the agentic channels and the CLI reach through
  // `search_pages`. Each row is its `spec-operation` record: project, direct,
  // no side effects, idempotent, `rest: direct`, the other three cells `n/a` or
  // `via` with the record's `powody` verbatim, `errorCodes` its `kodyBledow`
  // (`n/d` → none), no `renderings` (`narzedzia: []`). Declared as `read`, so no
  // profile is admitted anything new: no MCP tool carries any of these names.

  /** A read rendered by the UI's REST route alone, with the record's three reasons. */
  const restOnlyRead = (
    name: string,
    summary: string,
    inputSchema: z.ZodRawShape,
    errorCodes: readonly string[],
    reasons: { internal: string; cli: string; mcp: string },
  ): OperationDeclaration => ({
    ...coreRead(name, summary, inputSchema, errorCodes),
    channels: { internal: na(reasons.internal), cli: na(reasons.cli), mcp: na(reasons.mcp), rest: direct() },
  });

  /**
   * The reasons M08 and M14 give for the three cells a UI route leaves empty —
   * verbatim, although "the code's operation catalogue does not declare it"
   * stops being true with these very rows. ASSUMPTION:dev-2606
   */
  const uiRouteOnly = {
    internal: 'kod renderuje operację wyłącznie trasą REST interfejsu, a katalog operacji kodu jej nie deklaruje',
    cli: 'brak komendy `c4s`; kod renderuje operację wyłącznie trasą REST interfejsu',
    mcp: 'kod renderuje operację wyłącznie trasą REST interfejsu, a katalog operacji kodu jej nie deklaruje',
  };

  // M08 — `GET /api/todos/counts`: `{ byPath, total }`, keyed `${rootId}:${relPath}`.
  registerRow(
    restOnlyRead(
      'get_todo_counts',
      'Count the TODO markers per root and per page, for the page-tree badges.',
      {},
      [],
      uiRouteOnly,
    ),
  );

  // M08 — `GET /api/todos`: every marker of the project at once, each with the
  // anchor of the section it stands in — a write address for M06's operations.
  registerRow(
    restOnlyRead(
      'list_todos',
      'List every TODO marker of the specification pages, each with the address of the section it stands in — all at once, no window, no response budget.',
      {},
      [],
      uiRouteOnly,
    ),
  );

  // M14 — `GET /api/page-links/counts`: the counters alone, cheap on purpose
  // (badge, invalidation on `pageLinks:changed`); the list is `list_page_links`.
  registerRow(
    restOnlyRead(
      'get_page_link_counts',
      'Counts of broken links, unresolved mentions and all links between pages — the counters alone, never the list.',
      {},
      [],
      uiRouteOnly,
    ),
  );

  // M14 — `GET /api/page-links`: the whole project's link maps at once, keys
  // composite `${rootId}:${relPath}`; never page content.
  registerRow(
    restOnlyRead(
      'list_page_links',
      'The link map between pages with reverse links and unresolved mentions, for the whole project at once — no window, no response budget, never page content.',
      {},
      [],
      uiRouteOnly,
    ),
  );

  /**
   * M14 — `GET /api/page-links/autocomplete`: top-N candidates for an `@` prefix,
   * 10 by default and 50 at most, over self ∪ the source root's `linkTargets`;
   * an unknown source root is skipped, not refused. The agentic channels and the
   * CLI reach the same need through `search_pages` with `pathInclude`.
   */
  registerRow({
    ...coreRead(
      'search_link_targets',
      'Suggest link targets for the path prefix typed after `@` in the editor — the top N candidates (10 by default, at most 50), never the whole map.',
      {
        q: z.string().optional().describe('The path prefix typed after `@`.'),
        limit: z.number().int().positive().max(50).optional().describe('How many candidates — 10 when omitted, at most 50.'),
        root: z.string().optional().describe('The source page\'s root, searched first; an unknown one is skipped, not refused.'),
      },
      [],
    ),
    channels: {
      internal: via('search_pages', 'podpowiadanie pod kursor jest potrzebą edytora, a agent adresuje strony pełną ścieżką i sięga po `pathInclude`'),
      cli: via('search_pages', 'podpowiadanie pod kursor jest potrzebą edytora; w terminalu stronę znajduje się wyszukiwaniem stron zawężonym po ścieżce (`pathInclude`)'),
      mcp: via('search_pages', 'podpowiadanie pod kursor jest potrzebą edytora, a agent adresuje strony pełną ścieżką i sięga po `pathInclude`'),
      rest: direct(),
    },
  });

  /**
   * M30 — `GET /api/static/:rootId/*`: the raw bytes of a file inside a root with
   * a facade, for an iframe. A root outside that set (unknown, or `sidebar:
   * hidden`) is ROOT_NOT_FOUND with no fallback to `pages`; an empty path, one
   * that leaves the root's `dir`, and a missing file are refused without a code.
   */
  registerRow(
    restOnlyRead(
      'get_static_file',
      'The raw bytes of a file inside a root with a facade, so the UI can render it in an iframe.',
      { rootId: z.string(), path: z.string() },
      ['ROOT_NOT_FOUND'],
      {
        internal: 'wynikiem są bajty pod render w iframe; treść spec agent czyta operacjami rdzenia M39',
        cli: 'plik jest adresowalny wprost URL-em, więc komenda nie dodaje nic ponad pobranie bajtów',
        mcp: 'wynikiem są bajty pod render w iframe; treść spec agent czyta operacjami rdzenia M39',
      },
    ),
  );

  // ── M10 Plans / M21 Briefs / M11 peer consult ─────────────────────────────
  //
  // Registered for the gate's sake; the classes match what the coarse server
  // dimensions already mount, so no profile's reach changes here.

  /**
   * 0.2.98 — `create_plan` moved from `agent-mediated` (via `update_plan` / via
   * `run_turn`) to `direct` in every channel: one call founds the plan file,
   * its first version and a top-level carrier thread, and starts no turn.
   * Same deliberate exception to "from outside you pass intent, not shape" as
   * `create_brief`. A taken slug is a refusal, not a suffixed variant.
   */
  registerRow({
    name: 'create_plan',
    summary:
      'Create a plan file together with its carrier thread (top-level, `context_type = chat`, `plan_path` set) from a `title` and the full `content`. Never runs a turn. A slug that is taken is PLAN_ALREADY_EXISTS; empty content is INVALID_ARGUMENT. Answers `{ planPath, hash, threads }`.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'plan',
    inputSchema: {
      title: z
        .string()
        .describe('Derives the plan slug once (slugify(title)); immutable afterwards. A taken slug is refused, not suffixed.'),
      content: z
        .string()
        .optional()
        .describe('The full plan markdown, verbatim — the first version. Empty after trim is INVALID_ARGUMENT, and nothing is created.'),
    },
    errorCodes: ['PLAN_ALREADY_EXISTS', 'INVALID_ARGUMENT'],
    sideEffects: ['file', 'db'],
    contentInput: 'literal',
    // A second identical call hits the slug the first one took.
    idempotent: false,
    channels: fullParity(),
    // 2.1.26 — the `create-plan` record's `narzedzia`: one `create_plan` per mount.
    renderings: { internal: ['plan-tools.create_plan'], mcp: ['plan-tools.create_plan'] },
  });

  /**
   * 2.1.13 — M10 thread isolation (`m10mcp00`): the plan operations' `path` is
   * REQUIRED externally and ABSENT in `internal` (M43 `explicit-addressing`,
   * isolation exception — `OWNER_THREAD_ISOLATION.plan`). The raw shape below is
   * the superset; each rendering shapes it through `addressing.ts`. No thread
   * default for an optional `path` exists any more. A thread with nothing pinned
   * reads `plan: null`; PLAN_NOT_FOUND is the code of an unknown `path` only.
   * Read, edit and the version axis have no `cli` command.
   */
  const PLAN_PATH_DESC = 'Plan path relative to the plans root (.claude4spec/plans). Required on every external channel; ABSENT in `internal`, where M10 declares thread isolation and the plan is the one pinned to the thread (`chat_thread.plan_path`).';
  /**
   * 2.1.26 — the records' `powody.cli`, verbatim (Polish, as the other rows'
   * `n/a` reasons taken from records): `get_plan`, `update_plan`,
   * `list_plan_versions`, `get_plan_version`.
   */
  const PLAN_NO_CLI = 'jedynym realnym wołającym jest agent w wątku albo użytkownik w UI, nie człowiek w terminalu';
  /** 2.1.48 — the `get-plan` record's own `powody.cli` (the UI reads the detail route's editor projection, not this operation). */
  const GET_PLAN_NO_CLI = 'jedynym realnym wołającym jest agent w wątku, nie człowiek w terminalu';
  /** Both mounts of `plan-tools` render the operation under its own name. */
  const planRenderings = (tool: string) => ({ internal: [`plan-tools.${tool}`], mcp: [`plan-tools.${tool}`] });

  registerRow({
    name: 'get_plan',
    summary:
      "Read a plan: content, frontmatter, version number and hash, optionally through a 1-based inclusive line window (`range`). A thread with no plan pinned reads `plan: null`; an unknown `path` is PLAN_NOT_FOUND. A plan over the response budget comes back `truncated: true` with a `truncationHint` pointing at `range`.",
    scope: 'project',
    mediation: 'direct',
    opClass: 'plan',
    inputSchema: {
      path: z.string().optional().describe(PLAN_PATH_DESC),
      range: z
        .object({ start: z.number().int().positive(), end: z.number().int().positive() })
        .optional()
        .describe(
          '1-based inclusive line window. Unconditionally allowed — a plan never enters `section_index`. A `start` past the end of the file is INVALID_ARGUMENT stating the size.',
        ),
    },
    /**
     * 2.1.26 — the `get-plan` record's four codes: PLAN_NOT_FOUND for an unknown
     * explicit `path`, NOT_FOUND for a pinned plan whose file is gone,
     * PLAN_INVALID_FRONTMATTER for a file that is not a plan, INVALID_ARGUMENT for
     * a malformed window or one starting past the end.
     */
    errorCodes: ['PLAN_NOT_FOUND', 'INVALID_ARGUMENT', 'NOT_FOUND', 'PLAN_INVALID_FRONTMATTER'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: direct(),
      cli: na(GET_PLAN_NO_CLI),
      mcp: direct(),
      rest: direct(),
    },
    renderings: planRenderings('get_plan'),
  });

  /**
   * 2.1.26 (M10 `m10mcp00`) — `list_plans`, the eighth plan operation: the
   * project's plan set, from which a caller picks a plan to read, change or hand
   * to a child thread. Rendered internally by `transagent-tools · list_plans`
   * (top-level `chat` thread only — `created_at` ascending, `applied` filter,
   * M39 window) and externally by `plan-tools · list_plans` on the threadless
   * mount, where the caller names the plan by `path` anyway. The thread mount of
   * `plan-tools` carries no list (M10 thread isolation). `rest` is
   * `GET /api/artifacts/plan` (the `/plans` page's list, M10 `m10api00`). The
   * record declares no codes (`n/d`).
   *
   * 2.1.27 — the record's `zachowanie` states the behaviour of the core
   * (`PlanService.listPlans({ order: 'created' })`): the `applied` filter (a
   * plan with no key counts as `false`), `created_at` ascending — immutable in
   * the plan's frontmatter (`q1txzrf0`) — ties by `path`, and the M39
   * implicit-matrix window (`8suur17i`). The rest rendering answers in that
   * order; the `/plans` page arranges the rows for display itself.
   *
   * Class `read`, as `list_briefs`: the gate matches by name and `chat` admits
   * no `brief`-like class for a read, and the operation never mutates. The input
   * is the operation's — the `applied` filter and the window; the external
   * rendering's `search` is a shape of that channel.
   */
  registerRow({
    name: 'list_plans',
    summary:
      "The project's plans — path, title and dates, never content (`get_plan` reads that) — to pick one to read, change or hand to a child thread. Filter with `applied`.",
    scope: 'project',
    mediation: 'direct',
    opClass: 'read',
    inputSchema: {
      applied: z
        .boolean()
        .optional()
        .describe('Narrow to applied (true) or not yet applied (false). Omit for all.'),
      ...paging,
    },
    errorCodes: [],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: direct(),
      cli: na('brak komendy `c4s`: jedynym realnym wołającym jest agent w wątku albo użytkownik w UI, nie człowiek w terminalu'),
      mcp: direct(),
      rest: direct(),
    },
    renderings: { internal: ['transagent-tools.list_plans'], mcp: ['plan-tools.list_plans'] },
  });

  registerRow({
    name: 'update_plan',
    summary:
      "Edit a plan through EXACTLY ONE of three input variants: `content` (the whole plan, literally), `textEdits` (literal substitutions counted over the whole plan), or `edits` (a transactional section batch addressed by anchor, with the same six actions and the same collision rules as update_sections). More than one variant, or none, is INVALID_ARGUMENT. The first update in a thread with no plan requires `title` and creates the file; the slug is slugify(title) and immutable thereafter.",
    scope: 'project',
    mediation: 'direct',
    opClass: 'plan',
    inputSchema: {
      path: z.string().optional().describe(PLAN_PATH_DESC),
      title: z.string().optional().describe('Required when the thread has no plan yet — this call creates it.'),
      /**
       * 0.2.43 — the top-level `action` is GONE, and so are `anchor` and
       * `heading`. A call names a VARIANT instead, and the action dictionary
       * moved inside `edits[]` where it grew from three values to five.
       *
       * All three are `.optional()` here for the reason `expectedHash` is: "one
       * of three, and exactly one" is not a zod shape. The enforcement is
       * `selectPlanVariant`, run before any I/O, so no channel can be laxer.
       */
      content: z.string().optional(),
      textEdits: textEdit.array().min(1).optional(),
      edits: z
        .array(
          z.object({
            anchor: z.string(),
            action: z.enum(['replace', 'append', 'insert_after', 'delete', 'edit', 'rename']),
            content: z.string().optional(),
            textEdits: textEdit.array().min(1).optional(),
            heading: z.string().optional(),
          }),
        )
        .min(1)
        .optional(),
      /**
       * 0.2.15 — required by the operation on every call EXCEPT the first one in
       * a thread, which creates the plan and has nothing to be stale against.
       * A zod shape cannot say "required unless", so the enforcement lives in
       * `PlanService.update`; `.optional()` here would otherwise read as the
       * guard being optional, which it is not.
       *
       * 0.2.43 — computed over the WHOLE plan in every variant, a batch touching
       * a single section included. The hash is never narrowed to a subtree.
       */
      expectedHash: z.string().optional().describe('REQUIRED except on the call that creates the plan.'),
      changeSummary: z.string(),
    },
    /**
     * 2.1.13 — the row's nine codes (`katalog-operacji-m10`). `IMMUTABLE_FIELD`
     * is the `rest` rendering's (the editor save, `PUT /api/artifacts/plan/<path>/content`
     * → `updateContent`); `VALIDATION` / `NOT_FOUND` left: the internal mount has
     * no `path` to validate and always runs in an existing thread, and a missing
     * external `path` is INVALID_ARGUMENT.
     */
    /*
     * 2.1.26 — the `update-plan` record's thirteen codes. Beyond the nine above:
     * `NOT_FOUND` (a pinned plan whose file is gone) and `PLAN_INVALID_FRONTMATTER`
     * (a file that is not a plan) from the shared loader; `VALIDATION` and
     * `UNKNOWN_ARTIFACT_KIND` from the `rest` rendering (the M36 artifact route's
     * body validation and its kind lookup).
     */
    errorCodes: [
      'PLAN_CONFLICT',
      'PLAN_NOT_FOUND',
      'SECTION_NOT_FOUND',
      'AMBIGUOUS_ANCHOR',
      'FIND_NOT_FOUND',
      'MATCH_COUNT_MISMATCH',
      'MISSING_TITLE',
      'IMMUTABLE_FIELD',
      'INVALID_ARGUMENT',
      'VALIDATION',
      'PLAN_INVALID_FRONTMATTER',
      'NOT_FOUND',
      'UNKNOWN_ARTIFACT_KIND',
    ],
    sideEffects: ['file', 'db', 'ui-notify'],
    /**
     * 0.2.43 — the differential mode the 0.2.37 row said was "a separate change
     * with its own owner". This is that change: `textEdits` at the top level and
     * inside an `edits[]` entry, with the same engine and the same naming as the
     * page tools.
     */
    contentInput: 'literal+diff',
    /**
     * 2.1.26 — `idempotencja: warunkowa` (the record's `powody.idempotencja`):
     * `content`, `replace` and `rename` are idempotent by content; `delete`
     * answers SECTION_NOT_FOUND on a repeat, `edit` / `textEdits` FIND_NOT_FOUND,
     * and `append` / `insert_after` duplicate.
     */
    idempotent: 'conditional',
    channels: {
      internal: direct(),
      cli: na(PLAN_NO_CLI),
      mcp: direct(),
      rest: direct(),
    },
    renderings: planRenderings('update_plan'),
  });

  /** 2.1.13 — the plan's version axis (`file_version`, rootId `plans`): metadata only, oldest first. */
  registerRow({
    name: 'list_plan_versions',
    summary:
      "A plan's version history from `file_version` — metadata without content, oldest first (offset 0 is version 1), windowed by `limit` / `offset`. A thread with no plan pinned lists nothing; an unknown `path` is PLAN_NOT_FOUND.",
    scope: 'project',
    mediation: 'direct',
    opClass: 'plan',
    inputSchema: {
      path: z.string().optional().describe(PLAN_PATH_DESC),
      ...paging,
    },
    // 2.1.26 — the `list-plan-versions` record's four codes (as `get_plan`'s).
    errorCodes: ['PLAN_NOT_FOUND', 'INVALID_ARGUMENT', 'NOT_FOUND', 'PLAN_INVALID_FRONTMATTER'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: direct(),
      cli: na(PLAN_NO_CLI),
      mcp: direct(),
      // GET /api/artifacts/plan/<path>/versions — the plan adapter's `listVersions`
      // (routes/artifacts.ts): PLAN_NOT_FOUND for an unknown path.
      rest: direct(),
    },
    renderings: planRenderings('list_plan_versions'),
  });

  registerRow({
    name: 'get_plan_version',
    summary:
      'One version snapshot of a plan, with its content, addressed by `(path, version)`. An unknown `path` is PLAN_NOT_FOUND; a version off the plan\'s axis is INVALID_ARGUMENT.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'plan',
    inputSchema: {
      path: z.string().optional().describe(PLAN_PATH_DESC),
      version: z.number().int(),
    },
    errorCodes: ['PLAN_NOT_FOUND', 'INVALID_ARGUMENT'],
    sideEffects: ['none'],
    // A version snapshot is immutable.
    idempotent: true,
    channels: {
      internal: direct(),
      cli: na(PLAN_NO_CLI),
      mcp: direct(),
      // GET /api/artifacts/plan/<path>/versions/:version — the plan adapter's
      // `getVersion`: PLAN_NOT_FOUND / INVALID_ARGUMENT, as on mcp.
      rest: direct(),
    },
    renderings: planRenderings('get_plan_version'),
  });

  /**
   * 0.2.14 — the plan's execution flag, declared because it is an operation the
   * catalog would otherwise not classify (`toolAdmittedByProfile` takes the
   * permissive branch for anything unknown on the host's own surface, which
   * makes an omission indistinguishable from a decision).
   *
   * `opClass: 'plan'` matches `get_plan`/`update_plan`, so no profile's reach
   * changes: every profile that already mounts `plan-tools` gets this tool too.
   * That is the intent — the posture gate deliberately does not cover it.
   */
  registerRow({
    name: 'mark_plan_applied',
    summary:
      "Declare a plan applied to the specification. One-way from the agent channel — `applied: false` is INVALID_ARGUMENT; only the user unsets it. Idempotent: a repeat at the same value writes nothing.",
    scope: 'project',
    mediation: 'direct',
    opClass: 'plan',
    inputSchema: {
      path: z.string().optional().describe(PLAN_PATH_DESC),
      applied: z.boolean().describe('Must be true from a non-user channel.'),
    },
    /**
     * 0.2.15 — `IMMUTABLE_FIELD` is GONE from this row: it was unreachable.
     * The shape accepts only `path` and `applied`, and `updateFrontmatter`
     * copies only `title`/`applied` forward, so no argument to this operation
     * can reach the immutability guard. A code no parameter can provoke is a
     * code to delete or a missing parameter to add — here it is the former; the
     * guard stays reachable through the generic REST frontmatter route, which
     * has its own row.
     */
    // 2.1.13 — PLAN_NOT_FOUND for an unknown external `path`; INVALID_ARGUMENT
    // for `applied: false` and for a thread with no plan pinned
    // (ASSUMPTION:dev-0002). 2.1.26 — the `mark-plan-applied` record adds the
    // loader's two: NOT_FOUND (a pinned plan whose file is gone) and
    // PLAN_INVALID_FRONTMATTER (a file that is not a plan).
    errorCodes: ['PLAN_NOT_FOUND', 'INVALID_ARGUMENT', 'NOT_FOUND', 'PLAN_INVALID_FRONTMATTER'],
    // No `db`: a frontmatter-only plan write deliberately records no
    // `file_version` row, so the plan's version history is untouched.
    sideEffects: ['file', 'ui-notify'],
    // A boolean flag in frontmatter — the caller supplies no content at all.
    contentInput: 'n/a',
    idempotent: true,
    channels: {
      internal: direct(),
      // Deliberately no `c4s` command — the flag is declared by the agent that
      // ran the plan, which is never the terminal.
      // 2.1.26 — the record's `powody.cli`, verbatim.
      cli: na('jedyny realny wołający kończy wykonanie planu w wątku, nie w terminalu'),
      mcp: direct(),
      // 2.1.13 — the row says `direct`: the rendering is
      // PATCH /api/artifacts/plan/<path>/frontmatter with { applied }, which calls
      // PlanService.updateFrontmatter — the same core function, not a proxy
      // operation (`update_artifact_frontmatter` is not a catalog row).
      rest: direct(),
    },
    renderings: planRenderings('mark_plan_applied'),
  });

  /**
   * 2.1.13 — `execute_plan`, sheet `katalog-operacji-m10` row 8: handing control
   * back to the user is a decision, not the execution of someone else's, so the
   * row is `human-mediated` and renders on `rest` only —
   * `POST /api/plans/:planId/create-thread` (`attachThreadToPlan`): a new thread
   * with the plan pinned, the execution prompt landing in the composer as an
   * editable draft. No tool renders it, so no profile's reach changes.
   */
  const EXECUTE_PLAN_NA = 'akt user-initiated; przegląd tej klasyfikacji jest otwarty';
  registerRow({
    name: 'execute_plan',
    summary:
      'Open a new thread over a plan, with the plan pinned to it; the execution prompt lands in the composer as an editable draft. User-initiated. An unknown plan is PLAN_NOT_FOUND.',
    scope: 'project',
    mediation: 'human-mediated',
    opClass: 'plan',
    inputSchema: {
      planId: z.string().describe('The plan the thread opens over (its path relative to the plans root).'),
    },
    errorCodes: ['PLAN_NOT_FOUND', 'INVALID_ARGUMENT'],
    sideEffects: ['db', 'ui-notify'],
    // Every trigger opens a new thread.
    idempotent: false,
    channels: {
      // 2.1.26 — the `execute-plan` record's `powody`, verbatim; `narzedzia` is empty.
      internal: na(EXECUTE_PLAN_NA),
      cli: na(EXECUTE_PLAN_NA),
      mcp: na(EXECUTE_PLAN_NA),
      rest: direct(),
    },
  });

  /**
   * 0.2.94 — brief creation, and the release that stops mediating it.
   *
   * Until 0.2.93 the row read `agent-mediated`: every channel but `rest` went
   * `via run_turn` with a `brief` context, because the BODY was the turn's
   * output. That is the right shape for a caller who has a release window and
   * no text. It is exactly wrong for the opposite caller — an external coding
   * agent that has read the repository and the specification, knows the drift,
   * and needs only a durable artifact. `content` makes the body an INPUT, so
   * the mediation has nothing left to do and the row becomes `direct`.
   *
   * `internal` is `na`, and not for want of a rendering: a turn in a `brief`
   * thread is anchored in ONE artifact and writes that artifact's text. Minting
   * a second brief is not an act of the brief's author.
   *
   * `mcp` is `direct` with no tool behind it yet — a declaration ahead of its
   * rendering, deliberately. The M39 parity assertion covers the external
   * reader's rows; this one sits with `create_patch`, outside that set.
   *
   * 2.1.26 — the `create-brief` record: `narzedzia` is empty, so no rendering
   * is named; the `mcp` cell stays `direct` as the record declares it (M21
   * `01ytpznn` records the missing external tool as an open item). The
   * `internal` reason is the record's `powody.internal`, verbatim. The service
   * answers the path, the hash and both ends of the window as resolved.
   *
   * 2.1.27 — the record's `zachowanie` drops the initial thread and the thread
   * list from the operation: `create_brief` writes the brief file only, and
   * answers no thread list. The top-level initial thread is opened by the
   * REST route that composes this write with `createThreadForBrief`.
   */
  registerRow({
    name: 'create_brief',
    summary:
      'Mint a brief file — with a ready-made body (`content`, stored verbatim), or empty for a release window. Writes the file only: never runs an agent turn, opens no thread. Answers `{ briefPath, hash, fromReleaseName, toReleaseName }`.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'brief',
    inputSchema: {
      fromReleaseName: z
        .string()
        .nullable()
        .optional()
        .describe('Start of the window. `null` = open at the start. Omitted = the latest release.'),
      toReleaseName: z
        .string()
        .nullable()
        .optional()
        .describe(
          'End of the window. `null`/omitted = open to the current state. Non-null must differ from `fromReleaseName`.',
        ),
      content: z
        .string()
        .optional()
        .describe(
          'The full brief body, stored verbatim under the generated frontmatter. Omitted leaves a heading-only file. Empty after trim is VALIDATION, and no file is written.',
        ),
      roots: z
        .string()
        .array()
        .optional()
        .describe(
          "Page root ids to scope the brief to. Not allowed when the window's `to` end is open.",
        ),
      suffix: z.string().optional().describe('Appended to the generated file slug; settles a collision.'),
    },
    /**
     * 2.1.13 — the row's two codes. An end of the window naming no release is
     * `VALIDATION` (`BriefService.requireWindowRelease`): the window is an input,
     * not a resource the operation reads — it used to leak the release store's
     * own code, undeclared here.
     */
    errorCodes: ['VALIDATION', 'BRIEF_SAME_RELEASE'],
    sideEffects: ['file', 'db', 'ui-notify'],
    /**
     * `literal`: the caller hands over finished text, exactly as `create_patch`
     * does. There is no prior body for a differential mode to match against —
     * the operation is what brings the artifact into being.
     */
    contentInput: 'literal',
    // Every call mints a NEW brief file; `suffix` is how a caller settles the
    // slug collision that follows. 2.1.27 — the operation opens no thread: the
    // initial thread is the REST route's composition (`POST /api/briefs`,
    // M21 `47opytlw`), not part of `create_brief`.
    idempotent: false,
    channels: {
      internal: na(
        'tura wątku `brief` jest zakotwiczona w jednym artefakcie i pisze jego treść; powołanie kolejnego briefu nie jest czynnością autora briefu',
      ),
      cli: direct(),
      mcp: na(
        'serwer zewnętrzny nie niesie narzędzia: powołanie briefu jest powierzchnią użytkownika (UI, `c4s create-brief`, trasa REST), a połączenie zewnętrzne w profilu `brief` widzi tylko operacje na istniejącym briefie',
      ),
      rest: direct(),
    },
  });

  /**
   * 0.2.13 (tier C) — `list_briefs` was missing from the catalog.
   *
   * It is reachable in three channels and has been for releases: `c4s
   * list-briefs`, `GET /api/artifacts/brief`, and the briefs list in the UI. It
   * was simply never declared, so nothing gated it and nothing checked its
   * parity — the exact gap the catalog exists to make visible. It surfaced when
   * item 23 moved `c4s list-briefs` onto its server route and the command had no
   * operation to name.
   *
   * 2.1.13 — `internal` is `direct`, as the M21 row declares it, and it is a
   * declaration WITHOUT a rendering: `brief-tools` does not render it, and M21
   * says so in writing ("jej komórka `internal` jest dziś deklaracją bez
   * pokrycia", `01ytpznn`) — it waits for the routing rule, like `create_brief`'s
   * `mcp`. (Until 2.1.12 the code wrote `na` here, a value the row never had.)
   *
   * Paging is the row's: `limit` / `offset`, with `total` counted AFTER the
   * `implemented` filter and before the window (`c4s list-briefs`; REST pages on
   * `?limit` / `?offset` the same way).
   *
   * 2.1.18 (M21 `01ytpznn`, M44 `3f5ej79s`) — the `internal` cell stays `direct`
   * and now HAS a rendering: `list_briefs` on `transagent-tools`, mounted only on
   * a top-level `chat` thread, never in a `brief` thread (`brief-tools` keeps its
   * four tools). The class moves `brief` → `read` for that reason: the gate
   * matches by name and `chat` admits no `brief` class, so a `brief`-class row
   * would withhold the rendering from the only thread it exists for (and plan
   * mode would list a read as mutating). The operation reads and never mutates
   * — `sideEffects: ['none']` — which is what `read` means.
   *
   * 2.1.26 — the `list-briefs` record names its one rendering
   * (`transagent-tools-list-briefs`, internal); `mcp` stays `direct` with none,
   * as the record declares it (an open item of M21 `01ytpznn`).
   */
  registerRow({
    name: 'list_briefs',
    summary: 'Briefs of the project on the release axis (newest cycle first, unknown releases last), optionally narrowed to implemented or pending.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'read',
    inputSchema: {
      implemented: z
        .boolean()
        .optional()
        .describe('Narrow to implemented (true) or pending (false). Omit for all.'),
      ...paging,
    },
    errorCodes: ['VALIDATION'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: direct(),
      cli: direct(),
      mcp: na(
        'serwer zewnętrzny nie niesie narzędzia: lista briefów jest powierzchnią użytkownika (UI, `c4s list-briefs`, trasa REST), a agentowo renderuje ją wyłącznie `transagent-tools` orkiestratora wątku `chat`',
      ),
      rest: direct(),
    },
    renderings: { internal: ['transagent-tools.list_briefs'] },
  });

  registerRow({
    name: 'get_brief',
    summary:
      'Read a brief: frontmatter, body and hash, optionally through a 1-based inclusive line window (`range`). A brief over the response budget comes back `truncated: true` with a `truncationHint` pointing at `range`.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'brief',
    /**
     * 2.1.13 — addressing is `path` (+ the read window `range?`), under the
     * `explicit-addressing` rule (M43, `addressing.ts`): the row no longer
     * declares an `internal` default from `chat_thread.brief_path` — binding the
     * brief through the thread is a rendering of the `internal` channel
     * (`brief-tools`' thread mount), not a contract of the operation. Every
     * external rendering requires `path` (the `brief` profile, `profiles.ts`).
     *
     * 2.1.14 — M21 declares thread isolation (`01ytpznn`,
     * `OWNER_THREAD_ISOLATION.brief`): the `internal` rendering of every
     * addressed brief operation carries NO `path` — absent, not optional.
     *
     * Codes: `BRIEF_NOT_FOUND` for an unknown path, `INVALID_ARGUMENT` for a
     * window starting past the end of the file (stating its size) or malformed,
     * and (2.1.26, the `get-brief` record) `BRIEF_INVALID_FRONTMATTER` for a file
     * of the briefs root whose frontmatter is not a brief's. Renderings: the
     * thread mount (`brief-tools-get-brief`, internal) and the threadless one
     * (`brief-tools-get-brief-explicit`, mcp) — both `brief-tools · get_brief`.
     */
    inputSchema: {
      path: z.string().optional().describe('Brief path relative to the briefs root (.claude4spec/briefs). Required on every external channel; absent from the internal rendering (isolation).'),
      range: z
        .object({ start: z.number().int().positive(), end: z.number().int().positive() })
        .optional()
        .describe(
          '0.2.40 — 1-based inclusive line window. Unconditionally allowed: an artifact never enters `section_index`, so there is no `sectionIndexed` gate and no second way to resume a large read. A `start` past the end of the file is INVALID_ARGUMENT stating the size.',
        ),
    },
    errorCodes: ['BRIEF_NOT_FOUND', 'INVALID_ARGUMENT', 'BRIEF_INVALID_FRONTMATTER'],
    sideEffects: ['none'],
    idempotent: true,
    channels: fullParity(),
    renderings: { internal: ['brief-tools.get_brief'], mcp: ['brief-tools.get_brief'] },
  });

  registerRow({
    name: 'update_brief',
    summary:
      'Write a brief body through EXACTLY ONE of two input shapes — `action` + `content` (replace / append / insert_after_section) or `textEdits` (literal substitutions counted over the whole body) — guarded by a REQUIRED `expectedHash`. Answers `{ newHash, replacements?, warning? }` — `warning` when an `insert_after_section` target is missing (appended at the end) or ambiguous (after the first match).',
    scope: 'project',
    mediation: 'direct',
    opClass: 'brief',
    inputSchema: {
      path: z.string().optional().describe('Brief path relative to the briefs root (.claude4spec/briefs). Required on every external channel; absent from the internal rendering (isolation).'),
      action: z.enum(['replace', 'append', 'insert_after_section']).optional(),
      content: z.string().optional(),
      anchor: z.string().optional(),
      heading: z.string().optional(),
      textEdits: textEdit.array().min(1).optional(),
      // Required, not optional: a guard the caller may omit is not a guard. The
      // catalog is what the channel listings read, so leaving it optional here
      // would re-advertise the contract the renderings no longer honour.
      expectedHash: z.string(),
      changeSummary: z.string().optional(),
    },
    /**
     * 0.2.86 — the codes the renderings actually raise. 2.1.13 — the row's four
     * (`BRIEF_NOT_FOUND`, `BRIEF_CONFLICT`, `IMMUTABLE_FIELD`, `VALIDATION`):
     * the service now answers an unknown path with `BRIEF_NOT_FOUND` itself
     * instead of the generic `NOT_FOUND` the CLI used to rename. 2.1.14 — a
     * malformed input shape (both `action`/`content` and `textEdits`, neither,
     * or half of the action shape) is the row's `VALIDATION`.
     *
     * ASSUMPTION:m21-dev-0001 — plus the codes the M43 differential engine and
     * `insert_after_section` raise, which the row's code cell does not list
     * (`INVALID_ARGUMENT` for overlapping matches, `FIND_NOT_FOUND`,
     * `MATCH_COUNT_MISMATCH`, `MISSING_TARGET`).
     *
     * 2.1.26 — the `update-brief` record lists exactly these, plus
     * `BRIEF_INVALID_FRONTMATTER` (the write reads the brief first).
     */
    errorCodes: [
      'BRIEF_NOT_FOUND',
      'BRIEF_CONFLICT',
      'VALIDATION',
      'INVALID_ARGUMENT',
      'IMMUTABLE_FIELD',
      'MISSING_TARGET',
      'FIND_NOT_FOUND',
      'MATCH_COUNT_MISMATCH',
      'BRIEF_INVALID_FRONTMATTER',
    ],
    sideEffects: ['file', 'db', 'ui-notify'],
    /**
     * 0.2.86 — the differential mode the 0.2.37 row deferred: `textEdits`, same
     * engine and field names as `update_page` / `update_sections` / `update_plan`.
     * 2.1.14 — the row's `opis treści` is `obydwa`: exactly one shape per call.
     */
    contentInput: 'literal+diff',
    /**
     * 2.1.26 — the record's `idempotencja: warunkowa`: `replace` is idempotent
     * by content; `append`, `insert_after_section` and `textEdits` are not.
     */
    idempotent: 'conditional',
    channels: { ...fullParity(), cli: na(CLI_NA_BRIEF) },
    renderings: { internal: ['brief-tools.update_brief'], mcp: ['brief-tools.update_brief'] },
  });

  /**
   * 2.1.13 — `mark_brief_implemented`, the M21 row that had no catalog entry.
   *
   * Sets the one mutable frontmatter field, `implemented`. Addressing is `path`
   * (`explicit-addressing`; the row no longer declares an `internal` default
   * from the thread). Renderings: `c4s mark-brief-implemented` (cli, true only)
   * and `PATCH /api/artifacts/brief/<path>/frontmatter { implemented }` (rest,
   * the UI's two-way toggle). `internal` is `direct` with NO `brief-tools` tool:
   * the `brief` context profile does not expose it (M21 `01ytpznn` — "zawężenie
   * na poziomie profilu, a nie wartość komórki"; `implemented` is the
   * implementer's or the human's fact, not the brief author's). `mcp` is a
   * declaration ahead of its rendering, as `create_brief`'s is.
   *
   * Idempotent: a repeat at the value the file already holds writes nothing
   * (`BriefService.updateFrontmatter`). Codes: `BRIEF_NOT_FOUND` for an unknown path,
   * `IMMUTABLE_FIELD` for any other frontmatter key (the M36 family guard).
   *
   * 2.1.26 — the `mark-brief-implemented` record: `internal` is `n/a` with the
   * record's reason (the operation states a fact about code the thread does not
   * see), no rendering is named, and `BRIEF_INVALID_FRONTMATTER` joins the codes
   * (the flag write reads the brief first).
   */
  registerRow({
    name: 'mark_brief_implemented',
    summary: "Set a brief's `implemented` frontmatter flag — the only mutable field of a brief. Answers the brief's path, frontmatter and hash.",
    scope: 'project',
    mediation: 'direct',
    opClass: 'brief',
    inputSchema: {
      path: z.string().describe('Brief path relative to the briefs root (.claude4spec/briefs).'),
      implemented: z
        .boolean()
        .optional()
        .describe('The value to set. Omitted = true (the terminal implementer\'s "done"); the UI may set false.'),
    },
    errorCodes: ['BRIEF_NOT_FOUND', 'IMMUTABLE_FIELD', 'BRIEF_INVALID_FRONTMATTER'],
    sideEffects: ['file', 'db', 'ui-notify'],
    contentInput: 'n/a',
    idempotent: true,
    channels: {
      internal: na(
        'operacja deklaruje fakt o kodzie w repozytorium docelowym, którego wątek nie widzi, więc serwer briefu celowo jej nie niesie; znacznik ustawia implementer w terminalu albo użytkownik w UI',
      ),
      cli: direct(),
      mcp: na(
        'serwer zewnętrzny nie niesie narzędzia: znacznik ustawia implementer w terminalu (`c4s mark-brief-implemented`) albo użytkownik w UI, a połączenie zewnętrzne w profilu `brief` widzi tylko odczyt, edycję i wersje briefu',
      ),
      rest: direct(),
    },
  });

  registerRow({
    name: 'list_brief_versions',
    summary: "A brief's version history (metadata only), oldest first.",
    scope: 'project',
    mediation: 'direct',
    opClass: 'brief',
    inputSchema: {
      path: z.string().optional().describe('Brief path relative to the briefs root (.claude4spec/briefs). Required on an external connection; absent from the internal rendering (isolation).'),
      ...paging,
    },
    // 2.1.13 — the row's one code: an unknown path is BRIEF_NOT_FOUND, never an
    // empty list (`BriefService.listVersionsAddressed`, behind every rendering).
    errorCodes: ['BRIEF_NOT_FOUND'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: direct(),
      // 2.1.26 — the `list-brief-versions` record's `cli: n/a`, its reason
      // verbatim (M21 L14 `xqksf67f` names no brief-history command).
      cli: na('brak komendy `c4s` historii briefu: implementer w terminalu czyta bieżący brief, nie jego historię'),
      mcp: direct(),
      rest: direct(),
    },
    renderings: { internal: ['brief-tools.list_brief_versions'], mcp: ['brief-tools.list_brief_versions'] },
  });

  registerRow({
    name: 'get_brief_version',
    summary: 'One version snapshot of a brief, with its content.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'brief',
    inputSchema: {
      path: z.string().optional().describe('Brief path relative to the briefs root (.claude4spec/briefs). Required on an external connection; absent from the internal rendering (isolation).'),
      version: z.number().int().positive(),
    },
    // 2.1.13 — BRIEF_NOT_FOUND for an unknown path (the row's code).
    // ASSUMPTION:dev-0003 — plus INVALID_ARGUMENT for a version off the history
    // (stating 1..N), the "validation error" the mcp-tool entity names; it
    // replaces the undeclared VERSION_NOT_FOUND / VALIDATION.
    errorCodes: ['BRIEF_NOT_FOUND', 'INVALID_ARGUMENT'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: direct(),
      // 2.1.26 — the `get-brief-version` record's `cli: n/a`, its reason verbatim.
      cli: na('brak komendy `c4s` historii briefu: implementer w terminalu czyta bieżący brief, nie jego historię'),
      mcp: direct(),
      rest: direct(),
    },
    renderings: { internal: ['brief-tools.get_brief_version'], mcp: ['brief-tools.get_brief_version'] },
  });

  registerRow({
    name: 'ask',
    summary: 'Consult another claude4spec specification synchronously. The peer runs read-only and returns { threadId, answer }.',
    scope: 'workspace',
    // 2.1.26 — the `ask` record: `agent-mediated`, because the call costs a
    // turn of the PEER's agent.
    mediation: 'agent-mediated',
    opClass: 'peer',
    inputSchema: {
      message: z.string(),
      project: z.string().describe('Registry `id` of the peer project (required in the mcp channel; the CLI falls back to cwd walk-up).'),
      workspace: z.string().optional().describe('Workspace selector; needed only when the id exists in N>1 workspaces.'),
      server: z.string().optional().describe('Address override; valid only together with `project`.'),
      threadId: z.string().optional(),
      model: z.string().optional(),
      effort: z.enum(['low', 'medium', 'high']).optional(),
    },
    // The record's fifteen codes (M11 `m11dcore`), in three groups by the moment
    // the error arises: local validation, the peer endpoint's HTTP status
    // (2.1.26 adds RESUME_CONFIG_LOCKED, its 409), and the turn body.
    errorCodes: [
      'PROJECT_NOT_FOUND',
      'PROJECT_ID_NOT_FOUND',
      'AMBIGUOUS_WORKSPACE',
      'AMBIGUOUS_PROJECT',
      'SERVER_NOT_RUNNING',
      'SERVER_NOT_RECOGNIZED',
      'INVALID_ARGS',
      'PROJECT_NOT_IN_WORKSPACE',
      'NOT_FOUND',
      'STREAM_IN_PROGRESS',
      'AGENT_UNAVAILABLE',
      'AGENT_ERROR',
      'TIMEOUT',
      'ABORTED',
      'RESUME_CONFIG_LOCKED',
    ],
    /**
     * 2.1.26 — `plik` + `db`: the peer writes a `chat_thread` + `chat_message`
     * and possibly a plan file; its pages and entities stay untouched. A file
     * effect with no content from the caller — the question is not content — so
     * `contentInput` is `n/a`.
     */
    sideEffects: ['file', 'db'],
    contentInput: 'n/a',
    idempotent: false,
    channels: fullParity(),
    // The record's `narzedzia`: `c4s-tools-ask` in both agentic channels.
    renderings: { internal: ['c4s-tools.ask'], mcp: ['c4s-tools.ask'] },
  });

  // ── M13 type-specific operations (per §7 of the release) ──────────────────
  //
  // The operations entity plugins declare in their `backend.mcpServer` slot.
  // Declared here for the same reason as the entity writes above: the profile
  // gate can only withhold what the catalog can classify, and `spreadsheet`'s
  // eight operations include six that mutate a specification.
  //
  // These live on `${type}-tools` servers, which for a restrictive profile are
  // additionally FAIL-CLOSED in `profile-gate.ts` — this list makes the reads
  // reachable again rather than being swept up with the writes.

  const typeOp = (
    name: string,
    summary: string,
    opClass: 'read' | 'write',
    idempotent: boolean,
    inputSchema: z.ZodRawShape = {},
    overrides: Partial<Pick<OperationDeclaration, 'contentInput' | 'channels' | 'renderings'>> = {},
  ) =>
    registerRow({
      name,
      summary,
      scope: 'project',
      mediation: 'direct',
      opClass,
      // These names belong to plugin `${type}-tools` servers, so the gate may
      // honour them ONLY for a tool arriving from such a server. Without the
      // marker, a plugin shipping a tool named after a host operation would
      // inherit that operation's class — see `contributedBy` in `catalog.ts`.
      contributedBy: 'plugin',
      inputSchema,
      errorCodes: opClass === 'write' ? ['NOT_FOUND', 'VALIDATION'] : ['NOT_FOUND'],
      sideEffects: opClass === 'write' ? ['file', 'db', 'ui-notify'] : ['none'],
      /**
       * 0.2.37 — `literal`, declared on the host's behalf for the rows a plugin
       * contributes. A plugin's write takes the full value of what it sets (a
       * cell, a column, a row); the differential vocabulary is M02/M06's and is
       * not offered here. A plugin that wanted to offer one would need a row of
       * its own saying so, which is exactly what this field is for.
       */
      contentInput: 'literal',
      idempotent,
      channels: {
        internal: direct(),
        cli: direct(),
        mcp: direct(),
        // Reachable over REST through the generic host proxy
        // (`POST /api/entities/:type/tools/:tool`) rather than a route of its own.
        rest: via('call_type_tool', 'generic host proxy — the plugin contributes no router'),
      },
      ...overrides,
    });

  /**
   * 2.1.26 — a plugin row the window carries no `spec-operation` record for
   * names no `renderings`: its agentic `direct` cells are rendered by the
   * `${type}-tools` server of the plugin that contributes it, which the plugin
   * host mounts at runtime. The host core does not know plugin servers by name
   * (plugin ↔ core boundary), so the row stays silent about which one.
   */

  // spreadsheet — sheet by slug, cells 1-based inclusive (r1,c1)-(r2,c2).
  typeOp('get_overview', 'Shape of a spreadsheet: sheets, dimensions, populated ranges.', 'read', true);
  typeOp('get_range', 'Read a rectangular window of cells.', 'read', true);
  typeOp('set_cell', 'Write one cell. Idempotent; an empty string removes it from the index.', 'write', true);
  typeOp('set_range', 'Write a rectangle of cells. Idempotent.', 'write', true);
  // Not idempotent: these shift every index past the insertion/removal point, so
  // cell coordinates are not stable across them.
  typeOp('insert_row', 'Insert a row, reindexing every row past it.', 'write', false);
  typeOp('insert_column', 'Insert a column, reindexing every column past it.', 'write', false);
  typeOp('delete_row', 'Delete a row, reindexing every row past it.', 'write', false);
  typeOp('delete_column', 'Delete a column, reindexing every column past it.', 'write', false);

  /**
   * endpoint — 2.1.26, the M13 records `link-dto` / `unlink-dto`. Both idempotent
   * (a repeated link or unlink is a no-op, not a refusal); unlink without a
   * statusCode removes every binding of the pair in that relation. Addressed by
   * `(endpoint, dto)` with the relation; no content input (`n/a`) — the binding
   * is fully determined by the identifiers. 2.1.27 — `rest` is `direct`: the
   * endpoint plugin's own resource routes `POST|DELETE /api/endpoints/:slug/dtos`
   * reach the same functions, so the generic proxy is not their only road;
   * `internal` and `mcp` render through the plugin's `endpoint-tools` server
   * (`narzedzia`).
   */
  const DTO_LINK_SHAPE = {
    endpointSlug: z.string(),
    dtoSlug: z.string(),
    relation: z.enum(['request', 'response', 'error']),
    statusCode: z.number().optional(),
  };
  const dtoLinkOverrides = (tool: string) => ({
    contentInput: 'n/a' as const,
    channels: {
      internal: direct(),
      cli: na(CLI_NA_ENTITY),
      mcp: direct(),
      rest: direct(),
    },
    renderings: { internal: [`endpoint-tools.${tool}`], mcp: [`endpoint-tools.${tool}`] },
  });
  typeOp('link_dto', 'Bind a DTO to an endpoint in one relation role. Idempotent — an identical binding already present is a no-op.', 'write', true, DTO_LINK_SHAPE, dtoLinkOverrides('link_dto'));
  typeOp('unlink_dto', 'Remove a DTO binding from an endpoint; without statusCode every binding of the pair in that relation. Idempotent — nothing to remove is a no-op.', 'write', true, DTO_LINK_SHAPE, dtoLinkOverrides('unlink_dto'));

  // ac / diagram — read-only analysis. `analyze_ac_against_entities` is
  // idempotent in STATE but not in content: its answer comes from an LLM.
  typeOp('analyze_ac_against_entities', 'Analyse acceptance criteria against the entity graph. Unanalysable input lands in `skipped_reasons[]`, not in an error.', 'read', true);
  typeOp('validate_diagram', 'Validate diagram source. Pure; bad syntax is a warning, not an error.', 'read', true);

  /**
   * 2.1.28 (c4s-plugin-host-ui-kit-components `6o1rfh21`) — the one operation of
   * `ui-kit-component`. Read-only and idempotent: it reports violations of the
   * cross-field and cross-record rules and writes nothing. `cli` is n/a — a
   * type-specific surface with no sense in the command surface; `rest` reaches
   * it through the generic host proxy.
   */
  typeOp(
    'audit_ui_kit_components',
    'Check ui-kit-component records against the cross-field and cross-record rules the schema cannot express. Reports, never fixes.',
    'read',
    true,
    { slugs: z.array(z.string()).optional(), rules: z.array(z.string()).optional() },
    {
      contentInput: 'n/a',
      channels: {
        internal: direct(),
        cli: na('powierzchnia typo-specyficzna, brak sensu w powierzchni komendowej'),
        mcp: direct(),
        rest: via('call_type_tool', 'generic host proxy — the plugin contributes no router'),
      },
    },
  );

  // ── M05 Agent turn ────────────────────────────────────────────────────────

  /**
   * 0.2.15 — `run_turn` is declared, and its MCP rendering is `runTransagent`.
   *
   * The spec has always named this operation `run_turn`; the code has always
   * called its one rendering `runTransagent`, and the catalog knew neither — so
   * `toolAdmittedByProfile` took the permissive branch for it, which makes an
   * omission indistinguishable from a decision. The row closes that, and the
   * `via` cell records the naming gap explicitly instead of leaving two names
   * for one thing scattered across two repositories.
   *
   * `{ threadId, summary }` is the whole answer, on purpose: the child turn's
   * full transcript stays in the child's own context. Echoing it upward would
   * spend the parent's context on text the parent never asked to read, which is
   * the entire reason the child is a separate turn.
   *
   * The concurrency guard is STATEFUL, not hash-based: at most ONE child in
   * flight at a time, because the tool call blocks until the child finishes
   * (2.1.18: further calls in the same turn go through once the previous one has
   * returned — a series is the caller's loop, not an operation), and a second
   * turn on a live session is refused with `STREAM_IN_PROGRESS` rather than
   * queued. Batch spawn is unsupported.
   */
  registerRow({
    name: 'run_turn',
    summary:
      'Delegate a unit of work to a hidden CHILD turn of this specification, in a chosen contextType. Returns { threadId, summary } — a concise summary, never the transcript. At most one child in flight at a time; the call blocks until the child finishes, and further calls in the same turn are allowed once the previous one has returned.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'turn',
    inputSchema: {
      contextType: z
        .enum(['brief', 'chat', 'patch'])
        .describe("For a continuation it must equal the referenced banka's context type."),
      message: z.string(),
      payload: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Ignored on continuation, where the binding comes from the referenced banka.'),
      planMode: z
        .boolean()
        .optional()
        .describe(
          'Open the child in plan mode (read-only builtins). Top-level, not a payload key — payload is per-contextType, plan_mode is a generic chat_thread column. Ignored on continuation, where the new child takes plan mode from the referenced banka, and never inherited from the parent thread.',
        ),
      threadId: z
        .string()
        .optional()
        .describe(
          "Id of an existing banka whose session to resume. The call creates a new child thread of the current thread, which inherits the banka's binding: context type, artifact path, plan mode and locked session config. The referenced thread is not modified. Omit to spawn a fresh banka.",
        ),
    },
    // 2.1.26 — the `run-turn` record adds NOT_FOUND: a continuation thread
    // that does not exist.
    errorCodes: ['AGENT_ERROR', 'STREAM_IN_PROGRESS', 'RESUME_CONFIG_LOCKED', 'NOT_FOUND'],
    sideEffects: ['file', 'db', 'ui-notify'],
    /**
     * A turn writes files, but its caller hands over an instruction, not
     * content — whatever lands on disk is the child's doing, through the write
     * operations' own rows. There is nothing here for a `find` to address.
     */
    contentInput: 'n/a',
    idempotent: false,
    /**
     * 2.1.26 — the four cells and their reasons are the `run-turn` record's
     * `powody`, verbatim. `mcp` is `n/a`, no longer `via runTransagent`: an
     * external connection is not a turn, and `runTransagent` renders
     * `spawn_child_turn` (its `narzedzia`), which `internal` reaches `via`.
     * The record names no tool of its own, so the row carries no `renderings`.
     */
    channels: {
      internal: via(
        'spawn_child_turn',
        'agent wbudowany osiąga bieg tury wyłącznie zakładając wątek podrzędny; tury najwyższego poziomu z wnętrza własnej tury nie zleca',
      ),
      cli: na('brak powierzchni CLI — turę-dziecko zakłada się wyłącznie z wnętrza tury'),
      mcp: na(
        'połączenie zewnętrzne nie jest turą: serwer zakładający turę-dziecko montuje się tylko w wątku czatu najwyższego poziomu, nigdy na zewnątrz',
      ),
      rest: na('brak powierzchni REST — jedynym wołającym jest tura-rodzic'),
    },
  });

  /**
   * 0.2.87 (M46) — the child-thread spawn behind `run_turn`'s internal channel.
   *
   * Agent-mediated: it costs a turn of the built-in agent (the child's). Internal only —
   * the dispatcher (`TransagentDispatcher`) is the one caller; no CLI, MCP or REST door.
   *
   * 0.2.111: NOT idempotent — every call founds a new child thread of the caller and
   * runs a turn in it, a continuation included. A call with `threadId` addresses the
   * banka whose session and binding the new row takes over (the referenced row is not
   * modified); without it the binding comes from `contextType` and the artifact address
   * from `payload` (2.1.18): `patch` requires `patchPath`, `chat` takes an optional
   * `planPath` (without it the banka founds a new plan), `brief` always founds a new
   * brief. No guard token: session exclusivity is enforced by the dispatcher's refusals
   * (`STREAM_IN_PROGRESS`, `RESUME_CONFIG_LOCKED`). Single-target: one child per call and
   * at most one child in flight at a time; further calls in the same parent turn are
   * allowed once the previous one has returned (2.1.18 — the dispatcher serializes
   * them; a batch spawn would be a promise the depth guard cannot keep). The rules the spec lists for this row — echo-free (only
   * `summary` returns), error-code-once (a child failure surfaces once, as the parent's
   * `tool_result.isError`), explicit-addressing (a continuation names its `threadId`,
   * never "the last child") — have no catalog field; they are upheld by the dispatcher.
   */
  registerRow({
    name: 'spawn_child_turn',
    summary:
      'Found a new hidden child thread of this specification on every call and run one turn in it: sets parent_thread_id and spawned_by_tool_use_id; a spawn binds the per-contextType artifact addressed by payload (patchPath required for patch, planPath optional for chat, a new brief for brief) and plan_mode, a continuation (threadId) copies the referenced banka\'s binding, plan_mode, config snapshot and session and resumes it. At most one child in flight at a time; sequential calls in one parent turn are allowed. Returns only { threadId } of the new row and a summary.',
    scope: 'project',
    mediation: 'agent-mediated',
    opClass: 'turn',
    inputSchema: {
      contextType: z.enum(['brief', 'chat', 'patch']),
      message: z.string(),
      payload: z.record(z.string(), z.unknown()).optional(),
      planMode: z.boolean().optional(),
      threadId: z.string().optional(),
    },
    errorCodes: [
      'AGENT_ERROR',
      'TIMEOUT',
      'IDLE_TIMEOUT',
      'ABORTED',
      'INVALID_ARGS',
      'NOT_FOUND',
      'STREAM_IN_PROGRESS',
      'RESUME_CONFIG_LOCKED',
    ],
    sideEffects: ['file', 'db', 'ui-notify'],
    contentInput: 'n/a',
    idempotent: false,
    // 2.1.26 — the `spawn-child-turn` record's `powody`, verbatim, and its one
    // rendering (`narzedzia`: `transagent-tools-runtransagent`, internal).
    channels: {
      internal: direct(),
      cli: na('operacja wewnętrzna — osiągalna wyłącznie przez `run_turn` z wnętrza tury'),
      mcp: na('operacja wewnętrzna; połączenie zewnętrzne nie jest turą, więc nie ma tury, której wątek byłby dzieckiem'),
      rest: na(
        'operacja wewnętrzna bez powierzchni REST; wątek-dziecko jest wykluczony z listy wątków, więc z zewnątrz nie ma adresu',
      ),
    },
    renderings: { internal: ['transagent-tools.runTransagent'] },
  });

  /**
   * 2.1.26 — the `abort-turn` record. Addressed by the thread's `threadId` OR by
   * the request id of the running turn (`POST /api/chat/abort/:threadId` and
   * `POST /api/chat/abort`): by thread, an idle thread is a no-op success and an
   * unknown one `THREAD_NOT_FOUND`; by request id, a missing id is `VALIDATION`
   * and an id with nothing running a no-op success. Either way the abort
   * cascades to child turns and clears the thread's queue, and the answer is a
   * confirmation — `aborted` plus `clearedTexts` — not the thread's state.
   *
   * 2.1.43 — the record resolves the gap the earlier `direct` cells left (an
   * agentic `direct` with no rendering): only `rest` renders the operation
   * (`POST /api/chat/abort`, `POST /api/chat/abort/:threadId`); the three other
   * cells are `n/a` with the record's reasons. The row names no rendering.
   */
  registerRow({
    name: 'abort_turn',
    summary:
      'Abort the running turn of a thread, addressed by threadId or by the running turn\'s request id. Answers a CONFIRMATION — { aborted, clearedTexts } — not the thread\'s state. Idempotent: nothing running is a no-op, not an error; an unknown thread is THREAD_NOT_FOUND, a request-id abort without the id VALIDATION. Cascades to child turns and clears the queue.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'turn',
    inputSchema: {
      threadId: z.string().optional().describe('The thread whose running turn to abort.'),
      requestId: z.string().optional().describe('The request id of the running turn, instead of the thread.'),
    },
    errorCodes: ['THREAD_NOT_FOUND', 'VALIDATION'],
    sideEffects: ['db', 'ui-notify'],
    idempotent: true,
    channels: {
      internal: na(
        'moduł tury nie wnosi narzędzia agentowego: przerwanie zleca wołający spoza tury, który zna jej adres (UI albo klient trasy REST), a nie agent wewnątrz biegnącej tury',
      ),
      cli: na(CLI_NA_ABORT),
      mcp: na(
        'moduł tury nie wnosi narzędzia MCP; przerwanie z zewnątrz renderuje wyłącznie trasa REST, którą woła klient zlecający turę',
      ),
      rest: direct(),
    },
  });

  /**
   * 2.1.26 — the three M05 thread-catalogue rows (`create-thread`,
   * `delete-thread`, `list-threads`). Each is a human act in the UI rendered
   * only as its REST route under `/api/threads`; `internal`, `cli` and `mcp` are
   * `n/a` with the records' shared reason, and no tool renders them. Owners:
   * `ChatService.createThread` / `deleteThread` / `listThreads` behind
   * `routes/threads.ts`.
   */
  const THREAD_CATALOGUE_REASON = 'katalog wątków jest wewnętrzną sprawą interfejsu';
  const threadCatalogueChannels = {
    internal: na(THREAD_CATALOGUE_REASON),
    cli: na(THREAD_CATALOGUE_REASON),
    mcp: na(THREAD_CATALOGUE_REASON),
    rest: direct(),
  };

  registerRow({
    name: 'create_thread',
    summary:
      'Found a new conversation thread with the agent, at the user\'s request in the UI. A context other than chat or ask is refused with VALIDATION: brief and patch threads are founded with their artifact.',
    scope: 'project',
    mediation: 'human-mediated',
    opClass: 'turn',
    inputSchema: {
      title: z.string().optional(),
      context_type: z.string().optional().describe("'chat' (default) or 'ask'; any other value is VALIDATION."),
    },
    errorCodes: ['VALIDATION'],
    sideEffects: ['db', 'ui-notify'],
    idempotent: false,
    channels: threadCatalogueChannels,
  });

  registerRow({
    name: 'delete_thread',
    summary:
      'Delete the named conversation thread, at the user\'s request in the UI. A repeat hits a thread that no longer exists and is NOT_FOUND. Deleting a thread does not stop a turn running in it — abort_turn does.',
    scope: 'project',
    mediation: 'human-mediated',
    opClass: 'turn',
    inputSchema: {
      threadId: z.string(),
    },
    errorCodes: ['NOT_FOUND'],
    sideEffects: ['db', 'ui-notify'],
    idempotent: true,
    channels: threadCatalogueChannels,
  });

  registerRow({
    name: 'list_threads',
    summary:
      'The project\'s threads for the user in the UI, most recently changed first. Without a window the list has 20 rows, so it never returns every thread at once.',
    scope: 'project',
    mediation: 'human-mediated',
    opClass: 'turn',
    inputSchema: {
      limit: z.number().int().positive().optional().describe('Default 20.'),
      offset: z.number().int().nonnegative().optional(),
    },
    // The record's `kodyBledow: ["n/d"]` — the operation has no codes of its own.
    errorCodes: [],
    sideEffects: ['none'],
    idempotent: true,
    channels: threadCatalogueChannels,
  });

  // ── M17 Releases ──────────────────────────────────────────────────────────

  /**
   * Declared because of what "undeclared" costs on THIS server.
   *
   * `release-tools` is host-owned, so `toolAdmittedByProfile` takes the
   * permissive branch for anything the catalog does not know — the branch whose
   * stated reasoning is that an omission on this repo's own surface "means
   * nobody has written the catalog row yet, not that it is unknown". True, and
   * it is exactly why the row has to be written: until it is, the omission is
   * indistinguishable from a decision.
   *
   * What it cost: `release-tools` mounts on `ask` (`pluginServers: 'all'`) AND
   * on `brief` (`BRIEF_ALLOWED_PLUGIN_MCP`), the two profiles built to be unable
   * to mutate the specification. `release_create` writes a release row, stamps
   * every unreleased `entity_version`/`file_version` with its id, broadcasts,
   * and makes a git commit; `release_update` renames the latest release and can
   * sweep the unreleased queue into it. Both were reachable from a consulted
   * peer and from a brief-authoring turn — and 0.2.13 put `?profile=ask` into
   * the MCP config entry claude4spec generates for every project, so that peer is now
   * every editor the user opens.
   *
   * `read`/`write` here is the whole payload of these rows. The three readers
   * stay reachable from every profile, which is what they were; the two writers
   * become reachable only from a profile that admits `write` (`chat`, `patch`),
   * which is what they always should have been.
   *
   * 2.1.26 — each row follows its `spec-operation` record (`release-list`,
   * `release-show`, `release-diff`, `release-create`, `release-update`):
   * `errorCodes` is exactly the record's `kodyBledow` (the shared base
   * VALIDATION + RELEASE_NOT_FOUND opens every one of them), and `renderings`
   * is its `narzedzia` — `release-tools.<tool>` in both agentic channels.
   *
   * ASSUMPTION:dev-2610 — `release_create` and `release_update` also raise
   * RELEASE_SLUG_CONFLICT (two names that slugify alike), which their tool
   * records' `logic` names but the operation records' `kodyBledow` omit. The
   * rows declare the records' lists; the service behaviour is unchanged.
   */
  const releaseOp = (
    name: string,
    summary: string,
    opClass: 'read' | 'write',
    inputSchema: Record<string, z.ZodTypeAny>,
    sideEffects: Array<'none' | 'file' | 'db' | 'ui-notify'>,
    extraCodes: readonly string[] = [],
  ): void => {
    registerRow({
      name,
      summary,
      scope: 'project',
      mediation: 'direct',
      opClass,
      inputSchema,
      errorCodes: ['VALIDATION', 'RELEASE_NOT_FOUND', ...extraCodes],
      sideEffects,
      /**
       * 0.2.37 — a release write names and freezes a snapshot; the content it
       * captures comes off the specification, never out of the request. Nothing
       * for a caller to describe either way.
       */
      contentInput: 'n/a',
      idempotent: opClass === 'read',
      channels: {
        internal: direct(),
        // 2.1.11 — the three READERS render 1:1 as `c4s release-list` /
        // `release-show` / `release-diff` (server-delegating, through the REST
        // route's `view=operation`). The writers stay off the CLI: M11 is a read
        // client of the specification, and a shell-invocable release mutation is
        // a different risk profile from one behind an agent turn or the UI's own
        // button. 2.1.26: the reason is the records' `powody.cli`, verbatim.
        cli:
          opClass === 'read'
            ? direct()
            : na('bin `c4s` jest klientem odczytu i diagnostyki; stan release\'ów zmienia się przez kanały `mcp`, `rest` i `internal`'),
        mcp: direct(),
        rest: direct(),
      },
      renderings: { internal: [`release-tools.${name}`], mcp: [`release-tools.${name}`] },
    });
  };

  releaseOp('release_list', 'Releases newest-first, paginated. Answers `{ releases, total }` where `total` precedes limit/offset.', 'read', { ...paging }, ['none'], ['INVALID_PAGINATION']);
  releaseOp(
    'release_show',
    'One release by name (2.1.11: the only input identifier; a literal `current` / `initial` / `null` is RELEASE_NOT_FOUND): its identification surface (entity slugs and page paths present at the release), windowed per dimension.',
    'read',
    {
      releaseName: z.string(),
      include: z.array(z.enum(['pages', 'entities'])).optional(),
      entityTypes: z.array(z.string()).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    ['none'],
    ['INVALID_INCLUDE_FILTER', 'INVALID_ENTITY_TYPES_FILTER', 'CONFLICTING_FILTERS', 'INVALID_PAGINATION'],
  );
  /**
   * 0.2.86 — the row names the parameters the renderings actually take and the
   * M17 codes they raise. It used to declare `{ from, to }` and two generic
   * codes, which taught a reader of the catalog a call no channel accepts.
   * `roots` narrows the PAGES dimension only — asymmetric by design.
   * 0.2.102: `paths` (full page keys `<rootId>/<relPath>`) narrows it to single
   * pages; both filters refuse ids that are not page roots, and the page
   * entries carry `rootId` next to `path`.
   * 2.1.5: the sections of ONE page are addressed positionally by the section
   * window `sectionOffset` / `sectionLimit`, not by anchor — legal only with
   * exactly one element in `paths`, otherwise refused.
   */
  releaseOp(
    'release_diff',
    'What changed between two releases — or, with `toReleaseName: "current"`, between a release and the live not-yet-released state — per entity type and page root; a page entry carries `rootId` next to `path`. `paths` narrows the pages to single pages by full key `<rootId>/<relPath>`; with exactly one path, the sections of that page are addressed positionally by the section window `sectionOffset` / `sectionLimit`, not by anchor (a window without exactly one path is refused). The light map (`summaryOnly`) carries `sections` and `size` per page. An item cut by the response budget comes back `truncated: true` (an entity without `before`/`after`, a section with `content` cut as text) and the envelope carries `truncationHint`.',
    'read',
    {
      fromReleaseName: z.union([z.string(), z.null()]),
      toReleaseName: z.string(),
      include: z.array(z.enum(['pages', 'entities'])).optional(),
      entityTypes: z.array(z.string()).optional(),
      slugs: z
        .array(z.string())
        .optional()
        .describe('2.1.11 — bare slugs of the ONE type in `entityTypes`; narrows the entities dimension (the response, not the computation).'),
      roots: z.array(z.string()).optional().describe('Narrows the pages dimension only; never entities.'),
      paths: z
        .array(z.string())
        .optional()
        .describe(
          "Single pages by FULL key `<rootId>/<relPath>` — one page file per element, no directory prefix. Pages dimension only; mutually exclusive with `roots`; requires 'pages' in `include`.",
        ),
      summaryOnly: z.boolean().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      sectionOffset: z.number().optional().describe('Section window start in the ONE page named by `paths`; positional.'),
      sectionLimit: z.number().optional().describe('Section window size; requires exactly one element in `paths`.'),
    },
    ['none'],
    [
      'INVALID_INCLUDE_FILTER',
      'INVALID_ENTITY_TYPES_FILTER',
      'INVALID_SLUGS_FILTER',
      'CONFLICTING_FILTERS',
      'INVALID_PAGINATION',
      'INVALID_DIFF_RANGE',
      'INVALID_PATHS_FILTER',
      'INVALID_ROOTS_FILTER',
    ],
  );
  releaseOp(
    'release_create',
    'Create a named release: assigns every unreleased entity_version and file_version row to it in one transaction, then commits to git when git sync is on. Always manual.',
    'write',
    { name: z.string(), description: z.string() },
    ['db', 'file', 'ui-notify'],
    ['RELEASE_NAME_CONFLICT', 'RELEASE_NAME_RESERVED', 'RELEASE_DESCRIPTION_REQUIRED', 'RELEASE_DESCRIPTION_TOO_LONG'],
  );
  releaseOp(
    'release_update',
    'Rename or re-describe the LATEST release, optionally sweeping the unreleased queue into it. Older releases are frozen.',
    'write',
    {
      releaseName: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      assignUnreleased: z.boolean().optional(),
    },
    ['db', 'ui-notify'],
    [
      'RELEASE_FROZEN',
      'RELEASE_NAME_CONFLICT',
      'RELEASE_NAME_RESERVED',
      'RELEASE_DESCRIPTION_REQUIRED',
      'RELEASE_DESCRIPTION_TOO_LONG',
    ],
  );

  /**
   * 2.1.26 — `release_restore` (record `release-restore`): the REST route
   * `POST /api/releases/:name/restore`, triggered by the user in the UI. No
   * agent tool and no `c4s` command renders it — the record's reasons, verbatim.
   * The default scope restores the whole specification from the release's
   * snapshot; repeating it changes nothing but captures new `file_version`s.
   *
   * ASSUMPTION:dev-2611 — the record's only code is RELEASE_NOT_FOUND; the
   * route's partial scopes (`entity` / `page` without a target) also answer
   * VALIDATION, which the record does not list. Declared as the record says.
   */
  registerRow({
    name: 'release_restore',
    summary:
      "Restore the specification from the snapshot of the named release, on the user's decision. A repeated restore of the same release yields the same state.",
    scope: 'project',
    mediation: 'human-mediated',
    opClass: 'write',
    inputSchema: { releaseName: z.string() },
    errorCodes: ['RELEASE_NOT_FOUND'],
    sideEffects: ['file', 'db'],
    // The restored content comes off the release's snapshot, never out of the request.
    contentInput: 'n/a',
    idempotent: true,
    channels: {
      internal: na(
        'user-initiated: operacja nadpisuje bieżącą specyfikację cudzą, zamrożoną wersją, więc jej wyzwolenie samo w sobie jest decyzją (przegląd otwarty)',
      ),
      cli: na(
        'user-initiated: operacja nadpisuje bieżącą specyfikację cudzą, zamrożoną wersją, więc jej wyzwolenie samo w sobie jest decyzją (przegląd otwarty)',
      ),
      mcp: na(
        "narzędzie agentowe restore'u świadomie nie istnieje: nie było use case'u, który uzasadniałby oddanie tej decyzji agentowi (przegląd otwarty)",
      ),
      rest: direct(),
    },
  });

  /**
   * 2.1.46 — `shadow_diff` (record `shadow-diff`, M17 `jssreefn`): the
   * comparison of a shadow with the master, rendered only as the REST route
   * `GET /api/shadow-diff` (its own M17 router) for the Shadows tab of the
   * releases screen. Owning core: `ReleaseService.shadowDiff` →
   * `computeShadowDiff` (`release-shadow-diff.ts`). Read-only, no repository
   * lock, no budget; the `n/a` reasons are the record's `powody`, verbatim.
   */
  const SHADOW_DIFF_UI_ONLY = 'w tej iteracji wyłącznie podgląd w interfejsie; renderowanie agentowe odłożone (przegląd otwarty)';
  registerRow({
    name: 'shadow_diff',
    summary:
      "What the master's specification becomes once a shadow is accepted — the delta of the trial merge (`merge`), or `merge-base..tip` with the conflicted paths (`shadow-only`).",
    scope: 'project',
    mediation: 'direct',
    opClass: 'read',
    inputSchema: { ref: z.string().describe('The shadow id — the ref name without the refs/runs/ prefix, e.g. `<runId>/spec`.') },
    errorCodes: ['SHADOW_NOT_FOUND', 'GIT_UNAVAILABLE', 'VALIDATION'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: na(SHADOW_DIFF_UI_ONLY),
      cli: na(SHADOW_DIFF_UI_ONLY),
      mcp: na(SHADOW_DIFF_UI_ONLY),
      rest: direct(),
    },
  });

  /**
   * 2.1.47 — `accept_shadow` (record `accept-shadow`, M17 `aae2vgem`): a shadow
   * merged into the master and ended as a new release in one step, rendered
   * only as the REST route `POST /api/shadow-accept` (M17's third own router)
   * for the accept window of the Shadows tab. Owning core:
   * `ReleaseService.acceptShadow` → `acceptShadow` (`release-accept-shadow.ts`).
   * Not idempotent: a repeated call meets an accepted shadow (an ancestor of
   * HEAD) or a moved HEAD and is refused. The `n/a` reasons are the record's
   * `powody`, verbatim.
   */
  const ACCEPT_SHADOW_UI_ONLY = 'w tej iteracji wyłącznie interfejs; kanał agenta i wiersz poleceń odłożone (przegląd otwarty)';
  registerRow({
    name: 'accept_shadow',
    summary:
      'Accept a shadow into the master: merge the previewed tip SHA and end with a new release in one step — every failure before the release transaction commits rolls the repository and the version log back.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'write',
    inputSchema: {
      ref: z.string().describe('The shadow id — the ref name without the refs/runs/ prefix, e.g. `<runId>/spec`.'),
      name: z.string().describe('The name of the release accepting the shadow — non-empty, unique, not reserved.'),
      description: z.string().describe('The description of the release — non-empty, at most 500 characters after trim.'),
      expectedTipSha: z.string().describe('The shadow tip SHA the preview was computed on — the SHA that is merged.'),
      expectedHeadSha: z.string().describe('The HEAD SHA the preview was computed on.'),
    },
    errorCodes: [
      'VALIDATION',
      'RELEASE_NAME_CONFLICT',
      'RELEASE_NAME_RESERVED',
      'RELEASE_DESCRIPTION_REQUIRED',
      'RELEASE_DESCRIPTION_TOO_LONG',
      'GIT_UNAVAILABLE',
      'SHADOW_NOT_FOUND',
      'ACCEPT_NO_BRANCH',
      'ACCEPT_TARGET_NOT_CURRENT',
      'ACCEPT_BUSY',
      'ACCEPT_STALE',
      'ACCEPT_DIRTY',
      'ACCEPT_OUTSIDE_SPEC',
      'ACCEPT_RELEASES_IN_SHADOW',
      'ACCEPT_CONFLICTS',
      'ACCEPT_FAILED',
      'ACCEPT_ABORT_FAILED',
    ],
    sideEffects: ['file', 'db', 'ui-notify'],
    idempotent: false,
    contentInput: 'n/a',
    channels: {
      internal: na(ACCEPT_SHADOW_UI_ONLY),
      cli: na(ACCEPT_SHADOW_UI_ONLY),
      mcp: na(ACCEPT_SHADOW_UI_ONLY),
      rest: direct(),
    },
  });

  // ── M25 Release Push ──────────────────────────────────────────────────────

  /**
   * 2.1.26 — the three M25 rows (records `push-release`, `list-release-pushes`,
   * `get-release-push`). Each renders only as its REST route under
   * `/api/release-pushes` over `ReleasePushService`; the `n/a` reasons are the
   * records' `powody`, verbatim.
   */
  const RELEASE_PUSH_UI_ONLY = 'kod renderuje operację wyłącznie trasą REST interfejsu, a katalog operacji kodu jej nie deklaruje';
  const RELEASE_PUSH_NO_CLI = 'brak komendy `c4s`; kod renderuje operację wyłącznie trasą REST interfejsu';
  const PUSH_USER_INITIATED =
    'akt user-initiated: push wyprowadza bajty specyfikacji poza maszynę pod tożsamością zalogowanego użytkownika; przegląd klasyfikacji otwarty';

  registerRow({
    name: 'push_release',
    summary:
      "Send the named release's bundle to the remote project on behalf of the signed-in user. Blocking: it answers with the finished transport, and every call that reaches the transport appends an audit row.",
    scope: 'project',
    mediation: 'human-mediated',
    opClass: 'write',
    inputSchema: { releaseName: z.string() },
    errorCodes: ['NOT_CONNECTED', 'ACCOUNT_NOT_ACTIVE', 'SESSION_EXPIRED', 'PUSH_FAILED', 'RELEASE_NOT_FOUND', 'VALIDATION'],
    sideEffects: ['file', 'db', 'ui-notify'],
    // The bundle is built from the release's history, never out of the request.
    contentInput: 'n/a',
    idempotent: false,
    channels: {
      internal: na(PUSH_USER_INITIATED),
      cli: na(PUSH_USER_INITIATED),
      mcp: na(PUSH_USER_INITIATED),
      rest: direct(),
    },
  });

  registerRow({
    name: 'list_release_pushes',
    summary:
      "The local audit of release pushes, newest first — all of it, or one release's history by name (an unknown name is an empty list). No paging.",
    scope: 'project',
    mediation: 'direct',
    opClass: 'read',
    inputSchema: { releaseName: z.string().optional() },
    errorCodes: ['VALIDATION'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: na(RELEASE_PUSH_UI_ONLY),
      cli: na(RELEASE_PUSH_NO_CLI),
      mcp: na(RELEASE_PUSH_UI_ONLY),
      rest: direct(),
    },
  });

  registerRow({
    name: 'get_release_push',
    summary: 'One entry of the local release-push audit, by its id.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'read',
    inputSchema: { id: z.number().int() },
    errorCodes: ['VALIDATION', 'RELEASE_PUSH_NOT_FOUND'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: na(RELEASE_PUSH_UI_ONLY),
      cli: na(RELEASE_PUSH_NO_CLI),
      mcp: na(RELEASE_PUSH_UI_ONLY),
      rest: direct(),
    },
  });
}
