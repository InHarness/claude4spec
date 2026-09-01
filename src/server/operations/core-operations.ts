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
 * ## M39 read core — 15 operations, four-channel parity for fourteen
 *
 * All 15 are `project` scope, `direct` mediation and `direct` internally. Three of
 * them (`check_consistency`, `search_entities`, `resolve_identity`) had no `rest`
 * rendering before 0.2.13; adding it is what made the parity claim true rather than
 * aspirational.
 *
 * 0.2.59 leaves exactly ONE `n/a` cell in the set: `get_page_outline` has no `rest`
 * rendering, and that is a decision with a recorded reason (see its declaration),
 * not a gap awaiting a route.
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
import { CATALOG, direct, na, via, type ContentInputMode, type OperationDeclaration } from './catalog.js';

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
 * Every M39 read operation can answer with these — and this is the COMPLETE set.
 *
 * `INVALID_VIEW` left the list in 0.2.22, when no read operation took a view
 * from a caller any more, and left the taxonomy entirely in 0.2.23 along with
 * the internal surfaces that could still name one. `SERIALIZER_THREW` went the
 * same way: it reported a type's own read code failing, and there is none.
 * A type that is unknown or deactivated answers `INVALID_TYPE`; an illegal name
 * in `select` answers `INVALID_ARGUMENT`. There is no third code, because a
 * type that is active always yields a record derived from its logical schema.
 */
const READ_CODES = ['INVALID_TYPE', 'INVALID_ARGUMENT', 'INDEX_NOT_MATERIALIZED'] as const;

/** All four channels render it themselves — the M39 parity shape. */
const fullParity = () => ({
  internal: direct(),
  cli: direct(),
  mcp: direct(),
  rest: direct(),
});

/** A read operation of the M39 core: project scope, direct, no side effects, idempotent. */
function coreRead(
  name: string,
  summary: string,
  inputSchema: z.ZodRawShape,
  extraCodes: readonly string[] = [],
): OperationDeclaration {
  return {
    name,
    summary,
    scope: 'project',
    mediation: 'direct',
    opClass: 'read',
    inputSchema,
    errorCodes: [...READ_CODES, ...extraCodes],
    sideEffects: ['none'],
    idempotent: true,
    channels: fullParity(),
  };
}

let seeded = false;

/**
 * Idempotent — the process-wide {@link CATALOG} is seeded once, but the server
 * builds a `ProjectContext` per project and tests build several per file.
 */
export function registerCoreOperations(): void {
  if (seeded) return;
  seeded = true;

  // ── M39 read core (15) ────────────────────────────────────────────────────

  CATALOG.register(
    coreRead('overview', 'Entry point to a specification: page roots with their properties, active entity types with counts and payload versions, tag count, claude4spec version.', {}),
  );

  CATALOG.register(
    // The summary deliberately says "activation set" rather than naming the
    // config field: an architecture gate asserts that only the plugin host reads
    // `config.entities`, and it greps string literals too.
    coreRead('describe_types', "Schemas of the active entity types. Without a type argument, all of them; a type outside the project's activation set is INVALID_TYPE, never a silent fallback.", {
      types: z.array(z.string()).optional().describe('Restrict to these type ids. Omit for every active type.'),
    }),
  );

  CATALOG.register(
    coreRead('list_pages', 'Pages of one root. A page\'s identity is (rootId, relPath), so the root is part of the address, not a filter.', {
      rootId: z.string(),
      ...paging,
    }, ['ROOT_NOT_FOUND']),
  );

  /**
   * 0.2.59 — `get_page_outline` replaces `list_sections`, and it is the one M39 read
   * that does NOT declare four-channel parity.
   *
   * Declared through the object literal rather than `coreRead`, because `coreRead`
   * hard-codes `fullParity()` and this operation's `rest` cell is `n/a` with a
   * recorded reason. The reason is semantic, not a backlog item: `GET /api/sections`
   * is NOT a rendering of this operation — without `pagePath` it answers a flat
   * global list across every page, feeding the editor's fuzzy autocomplete, and the
   * outline has no such mode and will not get one, being keyed by ONE page. That
   * route stays M06's own semantics rather than becoming a transport over the core.
   */
  CATALOG.register({
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
    errorCodes: [...READ_CODES, 'PAGE_NOT_FOUND', 'ROOT_NOT_FOUND'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: direct(),
      cli: direct(),
      mcp: direct(),
      rest: na(
        '`GET /api/sections` is NOT a rendering of this operation: without `pagePath` it returns a flat global list across every page, feeding the editor fuzzy-autocomplete (`/section`, `<SectionRefChip />`) — a mode the outline does not have and will not get, being keyed by ONE page. The route stays M06 semantics, not a transport over the core.',
      ),
    },
  });

  CATALOG.register(
    coreRead('get_sections', 'Content of several sections addressed by anchor, in ONE call. The singular `get_section` was removed without a transition period: N sections cost N model turns, which was not acceptable.', {
      anchors: z.array(z.string()).min(1),
    }, ['SECTION_NOT_FOUND', 'AMBIGUOUS_ANCHOR']),
  );

  CATALOG.register(
    coreRead('get_page', 'One page addressed by (rootId, path). Replaced `resolve_page({ path })` — the same relPath in several roots was ambiguous.', {
      rootId: z.string(),
      path: z.string(),
    }, ['PAGE_NOT_FOUND', 'ROOT_NOT_FOUND', 'AMBIGUOUS_PAGE']),
  );

  CATALOG.register(
    coreRead(
      'search_pages',
      'Search the prose of the pages by phrase (`query`) or regex (`regex`) — cross-root by default; `rootId` only NARROWS. A hit is a SECTION (a page, on a root with no section index), carrying `matchCount`; matches are lines. Modes are a cost ladder: `count` (totals), `map` (identity rows, the DEFAULT), `hits` (adds `hunks[]` + `omittedChars`). Enumeration order is `(rootId, path, line_start)` with a declared tie-break, so a full `limit`/`offset` traversal returns each hit exactly once.',
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
      ['ROOT_NOT_FOUND', 'INVALID_ARGUMENT'],
    ),
  );

  CATALOG.register(
    coreRead('search_entities', 'Ranked search over one entity type. Hits are `{slug, title, score}`. Returns `searchedFields`, so an empty result is distinguishable from a field that was never searched. Content-bearing fields are outside the scanning scope.', {
      type: z.string(),
      query: z.string(),
      fields: z.array(z.string()).optional(),
      ...paging,
    }),
  );

  CATALOG.register(
    coreRead('list_entities', 'Entities of one type, paged. Rows are `{slug, title}` — discovery answers with keys; ask `get_entities` for content. The `createdAt` order is the only one whose offset window is stable under concurrent writes.', {
      type: z.string(),
      tagFilter: z.enum(['and', 'or']).optional().describe("How to combine `tags`. Default 'and'."),
      sort: z.enum(['createdAt', 'title', 'slug']).optional(),
      dir: z.enum(['asc', 'desc']).optional(),
      ...paging,
    }),
  );

  CATALOG.register(
    coreRead('get_entities', 'Several entities of one type by slug, in ONE call. Width is the caller\'s: see `select`.', {
      type: z.string(),
      slugs: z.array(z.string()).min(1),
      ...selectParam,
    }, ['ENTITY_NOT_FOUND', 'AMBIGUOUS_ENTITY', 'INVALID_ARGUMENT']),
  );

  CATALOG.register(
    coreRead('get_field_content', 'The content of ONE content-bearing field, by (type, slug, field). Such a field is issued by no generic read; this is how it is fetched — on every channel, including the REST layer behind the UI.', {
      type: z.string(),
      slug: z.string(),
      field: z.string(),
    }, ['ENTITY_NOT_FOUND', 'INVALID_ARGUMENT']),
  );

  CATALOG.register(
    coreRead('list_tags', 'The tag registry, paged, optionally with usage counts.', {
      withCounts: z.boolean().optional(),
      minCount: z.number().int().nonnegative().optional(),
      coOccurringWith: z.string().optional(),
      ...paging,
    }),
  );

  CATALOG.register(
    coreRead('find_references', 'Who points at this entity, section or page. `includeTagMatches` additionally folds in dynamic `<tagged_list/>` matches, so one call answers both halves of "what breaks if I rename this".', {
      target: z.enum(['entity', 'section', 'page']),
      type: z.string().optional(),
      slug: z.string().optional(),
      anchor: z.string().optional(),
      rootId: z.string().optional(),
      path: z.string().optional(),
      includeTagMatches: z.boolean().optional().describe('Default false. Merges `<tagged_list/>` / `<tagged_list_mixed/>` matches into the result.'),
      ...paging,
      /**
       * No extra error codes: the base `READ_CODES` already name everything
       * `discovery/ops/references.ts` can raise. This used to declare
       * `ENTITY_NOT_FOUND` and `MISSING_TARGET` on top, and neither is
       * reachable — a missing `target`, a missing page key and an unknown
       * `rootId` are all `INVALID_ARGUMENT`, an unknown entity type is
       * `INVALID_TYPE`, and a target nothing cites is a SUCCESS with
       * `total: 0`. Declaring a `*_NOT_FOUND` told an agent to expect an
       * error exactly where it gets an empty list.
       */
    }),
  );

  CATALOG.register(
    coreRead('check_consistency', 'M19 consistency rules over the specification. Read-only — the report fixes nothing. `summary` always carries FULL counts, so a truncated findings list stays visibly truncated.', {
      severity: z.enum(['error', 'warning']).optional(),
      rule: z.union([z.string(), z.number()]).optional(),
      limit: z.number().int().positive().optional(),
    }),
  );

  CATALOG.register(
    coreRead('resolve_identity', 'Candidates for a name/slug fragment ACROSS every active type, as a discriminated union — a cross-type facade over the per-type indexes, so the caller need not know the type before asking.', {
      query: z.string(),
      types: z.array(z.string()).optional(),
      limit: z.number().int().positive().optional(),
    }),
  );

  // ── M31 Workspace ─────────────────────────────────────────────────────────

  CATALOG.register({
    name: 'list_projects',
    summary: 'Projects of the workspace: id, slug, name, path. A conscious navigational exception in a catalog otherwise about specification content — without it a project-scoped catalog is unreachable from outside.',
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
      cli: direct(),
      mcp: direct(),
      // Maps under the existing `/api/workspace/*` family, but the concrete route
      // is deferred (phase 2, not built) — the brief says so explicitly.
      rest: na('deferred to phase 2 — no route built yet; the workspace registry is reachable over `GET /api/workspace`'),
    },
  });

  // ── M23 Patches ───────────────────────────────────────────────────────────

  CATALOG.register({
    name: 'file_patch',
    summary: 'File a patch against a brief: which brief, what class of deviation, what drifted. Takes the INTENT, not a finished file — the server writes it.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'brief',
    inputSchema: {
      brief: z.string().describe('Brief path relative to briefsDir. Must name a real file.'),
      desc: z.string().min(1).describe('Short description of the drift. Drives the file slug and the body heading.'),
      patchKind: z.enum(['drift', 'missing', 'incorrect', 'clarification']).optional().describe('Default `drift`.'),
      body: z.string().describe('The patch body — what drifted and what the spec author should consider.'),
      createdBy: z.string().optional().describe('Reporter identity. Defaults to the calling channel.'),
    },
    errorCodes: ['BRIEF_NOT_FOUND', 'VALIDATION', 'PATCH_WRITE_FAILED'],
    sideEffects: ['file', 'db'],
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
      // `direct` in `internal` is an ALIGNMENT, not a change of semantics: the
      // built-in chat agent still only ever APPLIES patches, never files them.
      internal: direct(),
      cli: direct(),
      mcp: direct(),
      rest: direct(),
    },
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

  const entityWrite = (
    name: string,
    summary: string,
    inputSchema: z.ZodRawShape,
    idempotent: boolean,
    extraCodes: readonly string[] = [],
  ): OperationDeclaration => ({
    name,
    summary,
    scope: 'project',
    mediation: 'direct',
    opClass: 'write',
    inputSchema,
    errorCodes: ['INVALID_TYPE', 'VALIDATION', ...extraCodes],
    sideEffects: ['file', 'db', 'ui-notify'],
    /**
     * 0.2.37 — `data` carries the FULL VALUE of every field it changes,
     * `contentBearing` fields with long text payloads included. The partial
     * update an entity mutation offers is partial BY FIELD, never inside a
     * field's content, so there is nothing differential about it. A natural
     * extension, but a separate change with its own owner.
     */
    contentInput: 'literal',
    idempotent,
    channels: fullParity(),
  });

  CATALOG.register(
    entityWrite(
      'create_entities',
      'Create several entities of one type. Per-item, non-transactional: a duplicate slug fails that item with SLUG_CONFLICT and leaves the rest applied.',
      { type: z.string(), items: z.array(z.record(z.string(), z.unknown())).min(1) },
      false,
      ['SLUG_CONFLICT'],
    ),
  );

  CATALOG.register(
    entityWrite(
      'update_entities',
      'Update several entities of one type. Idempotent per element.',
      { type: z.string(), items: z.array(z.record(z.string(), z.unknown())).min(1) },
      true,
      ['ENTITY_NOT_FOUND'],
    ),
  );

  CATALOG.register(
    entityWrite(
      'delete_entities',
      'Delete several entities of one type. Idempotent per element.',
      { type: z.string(), slugs: z.array(z.string()).min(1) },
      true,
      ['ENTITY_NOT_FOUND'],
    ),
  );

  // ── M18 tags ──────────────────────────────────────────────────────────────

  const tagWrite = (name: string, summary: string, inputSchema: z.ZodRawShape, idempotent: boolean) =>
    CATALOG.register({
      name,
      summary,
      scope: 'project',
      mediation: 'direct',
      opClass: 'write',
      inputSchema,
      errorCodes: ['VALIDATION', 'NOT_FOUND'],
      sideEffects: ['file', 'db', 'ui-notify'],
      // A tag is a name and a colour; there is no content to describe either way.
      contentInput: 'n/a',
      idempotent,
      channels: fullParity(),
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
  tagWrite('create_tag', 'Create a tag in the registry. The slug is derived from `name` and returned.', { name: z.string(), color: z.string().optional(), description: z.string().optional() }, false);
  // `update_tag` nests its mutable fields under `data` because `reference-tools`
  // does, and for the same reason the four rows around it were corrected: the row
  // is a DECLARATION of the operation that runs, not a second design of it. Left
  // flat, this was the one tag row still carrying the divergence the comment
  // above claims to have closed.
  tagWrite('update_tag', 'Rename or restyle a tag; a slug change propagates through references.', { slug: z.string(), data: z.object({ name: z.string().optional(), color: z.string().nullable().optional(), description: z.string().nullable().optional() }) }, true);
  tagWrite('delete_tag', 'Remove a tag from the registry and every entity carrying it.', { slug: z.string() }, true);
  tagWrite('tag_entity', 'Attach tags to an entity. Idempotent — the entity ends up with the UNION of its existing tags and these. Tags that do not exist yet are created.', { type: z.string(), slug: z.string(), tags: z.array(z.string()) }, true);
  tagWrite('untag_entity', 'Detach tags from an entity. Idempotent.', { type: z.string(), slug: z.string(), tags: z.array(z.string()) }, true);

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

  const pageWrite = (
    name: string,
    summary: string,
    inputSchema: z.ZodRawShape,
    idempotent: boolean,
    extraCodes: readonly string[],
    contentInput: ContentInputMode,
  ): OperationDeclaration => ({
    name,
    summary,
    scope: 'project',
    mediation: 'direct',
    opClass: 'write',
    inputSchema,
    errorCodes: ['VALIDATION', ...extraCodes],
    // `ui-notify` is not decoration: the write is labelled through M40's write
    // token and its reactions are driven to completion before the caller is
    // answered, which is what re-indexes the page and pushes it to open editors.
    sideEffects: ['file', 'db', 'ui-notify'],
    contentInput,
    idempotent,
    channels: fullParity(),
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

  CATALOG.register(
    pageWrite(
      'create_page',
      'Create a page that does not exist yet. Refuses PAGE_EXISTS rather than overwriting — the distinction update_page deliberately does not make.',
      { rootId: z.string(), path: z.string(), content: z.string().optional() },
      // A second call with the same address is PAGE_EXISTS, not a no-op.
      false,
      ['PAGE_EXISTS', 'ROOT_NOT_FOUND'],
      // There is nothing on the page yet to substitute fragments of.
      'literal',
    ),
  );

  /**
   * 0.2.37 — TWO modes, and the row has to carry both.
   *
   * `idempotent` stays `true` and is now a half-truth the summary has to
   * repair: the literal branch is idempotent, the differential branch is not
   * (replaying it answers `FIND_NOT_FOUND`, the `delete` class of behaviour).
   * The field is one boolean per operation and the honest reading of it is "the
   * operation as declared can be repeated", which the default mode can. The
   * asymmetry is spelt out in the summary and in every channel's description
   * rather than hidden behind a flag that has no third value.
   *
   * This is also the first row whose `rest` cell renders onto TWO routes —
   * `PUT` for the literal mode, `PATCH` for the differential one. See the
   * `ChannelCell` doc in `catalog.ts` for the conditions that permits.
   */
  CATALOG.register(
    pageWrite(
      'update_page',
      'Write a page: EITHER in full (`body` plus optional `frontmatter`) OR differentially (`textEdits` — literal find/replaceWith substitutions over the whole file, frontmatter included). Exactly one of the two per call; both or neither is INVALID_ARGUMENT. Create-or-replace in the literal mode, which is how the editor saves a new page. The differential mode is NOT idempotent — replaying it answers FIND_NOT_FOUND — and inherits M06\'s ANCHOR_LOSS guard, overridable with `dropAnchors`.',
      {
        rootId: z.string(),
        path: z.string(),
        body: z.string().optional(),
        frontmatter: z.record(z.string(), z.unknown()).optional(),
        textEdits: textEdit.array().min(1).optional(),
        dropAnchors: z.array(z.string()).optional(),
        ...expectedHash,
      },
      true,
      ['PAGE_CONFLICT', 'ROOT_NOT_FOUND', 'INVALID_ARGUMENT', 'FIND_NOT_FOUND', 'MATCH_COUNT_MISMATCH', 'ANCHOR_LOSS'],
      'literal+diff',
    ),
  );

  CATALOG.register(
    pageWrite(
      'delete_page',
      'Delete a page. The content stays recoverable through file_version — the delete authors a tombstone rather than dropping the history.',
      { rootId: z.string(), path: z.string() },
      true,
      ['ROOT_NOT_FOUND'],
      // A delete names a page and carries no content at all.
      'n/a',
    ),
  );

  CATALOG.register(
    pageWrite(
      'update_sections',
      'Edit one or more sections of ONE page, addressed by anchor. A convenience over update_page — read-modify-write of the whole page with the same primitive — not a separate store, and not a structural gap in the model. Five actions: `replace`/`append`/`insert_after` take `content`, `delete` takes neither, and `edit` (0.2.37) takes `textEdits` — literal substitutions inside the addressed subtree. TRANSACTIONAL: the single exception to the partial-success rule, because every edit rewrites the same file. Applied bottom-up whatever order they arrive in.',
      {
        ...expectedHash,
        edits: z.array(
          z.object({
            anchor: z.string(),
            action: z.enum(['replace', 'append', 'insert_after', 'delete', 'edit']),
            content: z.string().optional(),
            textEdits: textEdit.array().min(1).optional(),
          }),
        ).min(1),
        dropAnchors: z.array(z.string()).optional(),
      },
      // `replace` and `delete` are idempotent; `append` and `insert_after` are
      // not, so the operation as a whole cannot claim to be.
      //
      // `dropAnchors` does not change that: a superset of what a repeat call
      // actually drops is legal precisely so the idempotent actions stay
      // idempotent when the declaration is replayed verbatim.
      false,
      [
        'SECTION_NOT_FOUND',
        'PAGE_CONFLICT',
        'ROOT_NOT_FOUND',
        'INVALID_ARGUMENT',
        'ANCHOR_LOSS',
        'FIND_NOT_FOUND',
        'MATCH_COUNT_MISMATCH',
      ],
      'literal+diff',
    ),
  );

  // ── M10 Plans / M21 Briefs / M11 peer consult ─────────────────────────────
  //
  // Registered for the gate's sake; the classes match what the coarse server
  // dimensions already mount, so no profile's reach changes here.

  CATALOG.register({
    name: 'get_plan',
    summary: 'Read a plan: content, frontmatter and version number.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'plan',
    inputSchema: { path: z.string().optional().describe('Plan path relative to plansDir. Defaulted from the thread only in the `internal` channel.') },
    errorCodes: ['NOT_FOUND'],
    sideEffects: ['none'],
    idempotent: true,
    channels: fullParity(),
  });

  CATALOG.register({
    name: 'update_plan',
    summary:
      "Edit a plan through EXACTLY ONE of three input variants: `content` (the whole plan, literally), `textEdits` (literal substitutions counted over the whole plan), or `edits` (a transactional section batch addressed by anchor, with the same five actions as update_sections). More than one variant, or none, is INVALID_ARGUMENT. The first update in a thread with no plan requires `title` and creates the file; the slug is slugify(title) and immutable thereafter.",
    scope: 'project',
    mediation: 'direct',
    opClass: 'plan',
    inputSchema: {
      path: z.string().optional(),
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
            action: z.enum(['replace', 'append', 'insert_after', 'delete', 'edit']),
            content: z.string().optional(),
            textEdits: textEdit.array().min(1).optional(),
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
    errorCodes: [
      'PLAN_NOT_FOUND',
      'MISSING_TITLE',
      'PLAN_CONFLICT',
      'VALIDATION',
      'INVALID_ARGUMENT',
      'SECTION_NOT_FOUND',
      'AMBIGUOUS_ANCHOR',
      'FIND_NOT_FOUND',
      'MATCH_COUNT_MISMATCH',
      // The create branch attaches the new plan to the calling thread, and a
      // thread that does not exist is this operation's own NOT_FOUND. Not
      // IMMUTABLE_FIELD: that one is thrown by the editor's save route
      // (`updateContent`), which is a different operation.
      'NOT_FOUND',
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
     * `content` and a batch `replace` repeat harmlessly; `delete`, `edit` and
     * `textEdits` do not, so the operation as a whole cannot claim to be — the
     * same half-truth `update_page` carries, spelt out in the summary and in
     * every channel's description rather than hidden behind a boolean.
     */
    idempotent: false,
    channels: fullParity(),
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
  CATALOG.register({
    name: 'mark_plan_applied',
    summary:
      "Declare a plan applied to the specification. One-way from the agent channel — `applied: false` is INVALID_ARGUMENT; only the user unsets it. Idempotent: a repeat at the same value writes nothing.",
    scope: 'project',
    mediation: 'direct',
    opClass: 'plan',
    inputSchema: {
      path: z.string().optional().describe('Plan path relative to plansDir. Defaulted from the thread only in the `internal` channel.'),
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
    errorCodes: ['NOT_FOUND', 'INVALID_ARGUMENT', 'VALIDATION'],
    // No `db`: a frontmatter-only plan write deliberately records no
    // `file_version` row, so the plan's version history is untouched.
    sideEffects: ['file', 'ui-notify'],
    // A boolean flag in frontmatter — the caller supplies no content at all.
    contentInput: 'n/a',
    idempotent: true,
    channels: {
      internal: direct(),
      // Deliberately no `c4s` command — M10 has no CLI section, and the flag is
      // declared by the agent that ran the plan, which is never the terminal.
      cli: na('no c4s command: the declarant is the in-thread agent, not a terminal'),
      mcp: direct(),
      // Rendered by the generic artifact family rather than a route of its own:
      // PATCH /api/artifacts/plan/:path/frontmatter with { applied }.
      rest: via('update_artifact_frontmatter', 'generic artifact-family endpoint — M10 adds no dedicated route'),
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
   * `internal` is `na`: the built-in agent working on a brief already has one,
   * addressed by the thread. Listing the others is a navigation question a
   * consultant asks, not something a brief-scoped turn needs.
   */
  CATALOG.register({
    name: 'list_briefs',
    summary: 'Briefs of the project, newest release first, optionally narrowed to implemented or pending.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'brief',
    inputSchema: {
      implemented: z
        .boolean()
        .optional()
        .describe('Narrow to implemented (true) or pending (false). Omit for all.'),
    },
    errorCodes: ['VALIDATION'],
    sideEffects: ['none'],
    idempotent: true,
    channels: {
      internal: na('a brief-scoped turn is already addressed at its brief; listing the others is a navigation question, not part of the work'),
      cli: direct(),
      mcp: direct(),
      rest: direct(),
    },
  });

  CATALOG.register({
    name: 'get_brief',
    summary: 'Read a brief: frontmatter and body.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'brief',
    // The `brief` profile makes this REQUIRED — see `profiles.ts`. An external
    // connection has no ambient brief, and silently defaulting to "the" brief is
    // how a patch gets filed against the wrong one.
    inputSchema: {
      path: z.string().optional().describe('Brief path relative to briefsDir. Required on an external connection.'),
      range: z
        .object({ start: z.number().int().positive(), end: z.number().int().positive() })
        .optional()
        .describe(
          '0.2.40 — 1-based inclusive line window. Unconditionally allowed: an artifact never enters `section_index`, so there is no `sectionIndexed` gate and no second way to resume a large read. A `start` past the end of the file is INVALID_ARGUMENT stating the size.',
        ),
    },
    errorCodes: ['BRIEF_NOT_FOUND', 'VALIDATION', 'INVALID_ARGUMENT'],
    sideEffects: ['none'],
    idempotent: true,
    channels: fullParity(),
  });

  CATALOG.register({
    name: 'update_brief',
    summary: 'Write a brief body, guarded by `expectedHash`.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'brief',
    inputSchema: {
      path: z.string().optional(),
      content: z.string(),
      // Required, not optional: a guard the caller may omit is not a guard. The
      // catalog is what the channel listings read, so leaving it optional here
      // would re-advertise the contract the renderings no longer honour.
      expectedHash: z.string(),
    },
    errorCodes: ['BRIEF_NOT_FOUND', 'BRIEF_CONFLICT', 'VALIDATION'],
    sideEffects: ['file', 'db', 'ui-notify'],
    /**
     * 0.2.37 — full content in `content`; no differential mode in this version.
     * A brief is, alongside a plan, the obvious second consumer of the pattern —
     * same action vocabulary, same read-modify-write shape — but adopting it is
     * a change of its own, and this row now says so out loud instead of leaving
     * the absence to be inferred.
     */
    contentInput: 'literal',
    idempotent: false,
    channels: fullParity(),
  });

  CATALOG.register({
    name: 'ask',
    summary: 'Consult another claude4spec specification synchronously. The peer runs read-only and returns { threadId, answer }.',
    scope: 'workspace',
    mediation: 'direct',
    opClass: 'peer',
    inputSchema: {
      message: z.string(),
      projectSlug: z.string().optional(),
      projectPath: z.string().optional(),
      workspace: z.string().optional().describe("Workspace selector; required when the project path or slug belongs to N>1 workspaces."),
      server: z.string().optional(),
      threadId: z.string().optional(),
      model: z.string().optional(),
      effort: z.enum(['low', 'medium', 'high']).optional(),
    },
    // Inherits the CLI's 14 codes in three groups rather than defining its own.
    errorCodes: ['PROJECT_SLUG_NOT_FOUND', 'AMBIGUOUS_WORKSPACE', 'RESUME_CONFIG_LOCKED', 'AGENT_ERROR'],
    sideEffects: ['db'],
    idempotent: false,
    channels: fullParity(),
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
  ) =>
    CATALOG.register({
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
    });

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

  // endpoint — both idempotent; unlink without a statusCode removes every
  // binding matching (endpoint, dto, relation).
  typeOp('link_dto', 'Bind a DTO to an endpoint. Idempotent — a duplicate binding is a no-op.', 'write', true);
  typeOp('unlink_dto', 'Remove a DTO binding. Idempotent.', 'write', true);

  // ac / diagram — read-only analysis. `analyze_ac_against_entities` is
  // idempotent in STATE but not in content: its answer comes from an LLM.
  typeOp('analyze_ac_against_entities', 'Analyse acceptance criteria against the entity graph. Unanalysable input lands in `skipped_reasons[]`, not in an error.', 'read', true);
  typeOp('validate_diagram', 'Validate diagram source. Pure; bad syntax is a warning, not an error.', 'read', true);

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
   * The concurrency guard is STATEFUL, not hash-based: at most ONE child per
   * turn, because the tool call blocks until the child finishes, and a second
   * turn on a live thread is refused with `STREAM_IN_PROGRESS` rather than
   * queued. Batch spawn is unsupported.
   */
  CATALOG.register({
    name: 'run_turn',
    summary:
      'Delegate a unit of work to a hidden CHILD turn of this specification, in a chosen contextType. Returns { threadId, summary } — a concise summary, never the transcript. At most one child per turn; the call blocks until the child finishes.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'turn',
    inputSchema: {
      contextType: z.enum(['brief', 'chat', 'patch']),
      message: z.string(),
      payload: z.record(z.string(), z.unknown()).optional(),
      planMode: z
        .boolean()
        .optional()
        .describe(
          'Open the child in plan mode (read-only builtins). Top-level, not a payload key — payload is per-contextType, plan_mode is a generic chat_thread column. Not inherited from the parent thread; ignored when continuing via threadId.',
        ),
      threadId: z.string().optional().describe('Continue an existing child rather than spawning one.'),
    },
    errorCodes: ['AGENT_ERROR', 'STREAM_IN_PROGRESS'],
    sideEffects: ['file', 'db', 'ui-notify'],
    /**
     * A turn writes files, but its caller hands over an instruction, not
     * content — whatever lands on disk is the child's doing, through the write
     * operations' own rows. There is nothing here for a `find` to address.
     */
    contentInput: 'n/a',
    idempotent: false,
    channels: {
      internal: via('runTransagent', 'the tool of the M05 `transagent-tools` server — the spec names the operation `run_turn`, the code names its rendering `runTransagent`'),
      mcp: via('runTransagent', 'same server, mounted for context_type ∈ {chat, patch} and stripped inside a child turn (recursion depth 1)'),
      cli: na('no CLI surface — a child turn is spawned from within a turn'),
      rest: na('no REST surface — the parent turn is the only caller'),
    },
  });

  CATALOG.register({
    name: 'abort_turn',
    summary:
      'Abort the running turn of a thread, addressed BY THREAD. Answers a CONFIRMATION of the interruption — { aborted } — not the thread\'s state, which the caller can read if it wants it. Idempotent: aborting a thread with no live turn is a no-op, not an error. An unknown thread is THREAD_NOT_FOUND.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'turn',
    inputSchema: {
      threadId: z.string(),
    },
    errorCodes: ['THREAD_NOT_FOUND'],
    sideEffects: ['db', 'ui-notify'],
    idempotent: true,
    channels: fullParity(),
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
   * the `mcp.json` claude4spec generates for every project, so that peer is now
   * every editor the user opens.
   *
   * `read`/`write` here is the whole payload of these rows. The three readers
   * stay reachable from every profile, which is what they were; the two writers
   * become reachable only from a profile that admits `write` (`chat`, `patch`),
   * which is what they always should have been.
   */
  const releaseOp = (
    name: string,
    summary: string,
    opClass: 'read' | 'write',
    inputSchema: Record<string, z.ZodTypeAny>,
    sideEffects: Array<'none' | 'file' | 'db' | 'ui-notify'>,
  ): void => {
    CATALOG.register({
      name,
      summary,
      scope: 'project',
      mediation: 'direct',
      opClass,
      inputSchema,
      errorCodes: ['VALIDATION', 'NOT_FOUND'],
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
        // No `c4s release-*` command exists, and this release deliberately does
        // not add one: M11 became a read client of the specification, and a
        // shell-invocable release mutation is a different risk profile from one
        // behind an agent turn or the UI's own button.
        cli: na('bin `c4s` is a read and diagnostics client; release state is mutated through mcp/rest/internal'),
        mcp: direct(),
        rest: direct(),
      },
    });
  };

  releaseOp('release_list', 'Releases newest-first, paginated. Answers `{ releases, total }` where `total` precedes limit/offset.', 'read', { ...paging }, ['none']);
  releaseOp('release_show', 'One release by numeric id or name, with its snapshot counts.', 'read', { idOrName: z.union([z.string(), z.number()]) }, ['none']);
  releaseOp('release_diff', 'What changed between two releases, per entity type and page root.', 'read', { from: z.union([z.string(), z.number()]), to: z.union([z.string(), z.number()]) }, ['none']);
  releaseOp(
    'release_create',
    'Create a named release: assigns every unreleased entity_version and file_version row to it in one transaction, then commits to git when git sync is on. Always manual.',
    'write',
    { name: z.string(), description: z.string() },
    ['db', 'file', 'ui-notify'],
  );
  releaseOp(
    'release_update',
    'Rename or re-describe the LATEST release, optionally sweeping the unreleased queue into it. Older releases are frozen.',
    'write',
    {
      idOrName: z.union([z.string(), z.number()]),
      name: z.string().optional(),
      description: z.string().optional(),
      assignUnreleased: z.boolean().optional(),
    },
    ['db', 'ui-notify'],
  );
}
