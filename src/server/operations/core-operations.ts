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
 * ## M39 read core — 15 operations, full four-channel parity
 *
 * All 15 are `project` scope, `direct` mediation, `direct` in all four channels,
 * ZERO `n/a` cells. Three of them (`check_consistency`, `search_entities`,
 * `resolve_identity`) had no `rest` rendering before 0.2.13; this release adds
 * it, which is what makes the parity claim true rather than aspirational.
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
import { CATALOG, direct, na, via, type OperationDeclaration } from './catalog.js';

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

  CATALOG.register(
    coreRead('list_sections', 'Section index over page content, optionally narrowed to one page.', {
      pagePath: z.string().optional(),
      ...paging,
    }),
  );

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
    coreRead('search_pages', 'Full-text search within one page root, indexed and paged.', {
      rootId: z.string(),
      query: z.string(),
      ...paging,
    }, ['ROOT_NOT_FOUND']),
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
    }, ['ENTITY_NOT_FOUND', 'MISSING_TARGET']),
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
      idempotent,
      channels: fullParity(),
    });

  tagWrite('create_tag', 'Create a tag in the registry.', { slug: z.string(), name: z.string().optional() }, false);
  tagWrite('update_tag', 'Rename or restyle a tag; a slug change propagates through references.', { slug: z.string(), name: z.string().optional() }, true);
  tagWrite('delete_tag', 'Remove a tag from the registry and every entity carrying it.', { slug: z.string() }, true);
  tagWrite('tag_entity', 'Attach tags to an entity. Idempotent — re-attaching is a no-op.', { type: z.string(), slug: z.string(), tagSlugs: z.array(z.string()) }, true);
  tagWrite('untag_entity', 'Detach tags from an entity. Idempotent.', { type: z.string(), slug: z.string(), tagSlugs: z.array(z.string()) }, true);

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

  CATALOG.register(
    pageWrite(
      'create_page',
      'Create a page that does not exist yet. Refuses PAGE_EXISTS rather than overwriting — the distinction update_page deliberately does not make.',
      { rootId: z.string(), path: z.string(), content: z.string().optional() },
      // A second call with the same address is PAGE_EXISTS, not a no-op.
      false,
      ['PAGE_EXISTS', 'ROOT_NOT_FOUND'],
    ),
  );

  CATALOG.register(
    pageWrite(
      'update_page',
      'Write a page in full — body plus optional frontmatter. Create-or-replace: absent pages are created, which is how the editor saves a new one.',
      { rootId: z.string(), path: z.string(), body: z.string(), frontmatter: z.record(z.string(), z.unknown()).optional(), ...expectedHash },
      true,
      ['PAGE_CONFLICT', 'ROOT_NOT_FOUND', 'INVALID_ARGUMENT'],
    ),
  );

  CATALOG.register(
    pageWrite(
      'delete_page',
      'Delete a page. The content stays recoverable through file_version — the delete authors a tombstone rather than dropping the history.',
      { rootId: z.string(), path: z.string() },
      true,
      ['ROOT_NOT_FOUND'],
    ),
  );

  CATALOG.register(
    pageWrite(
      'update_sections',
      'Edit one or more sections of ONE page, addressed by anchor. A convenience over update_page — read-modify-write of the whole page with the same primitive — not a separate store, and not a structural gap in the model. TRANSACTIONAL: the single exception to the partial-success rule, because every edit rewrites the same file. Applied bottom-up whatever order they arrive in.',
      {
        ...expectedHash,
        edits: z.array(
          z.object({
            anchor: z.string(),
            action: z.enum(['replace', 'append', 'insert_after', 'delete']),
            content: z.string().optional(),
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
      ['SECTION_NOT_FOUND', 'PAGE_CONFLICT', 'ROOT_NOT_FOUND', 'INVALID_ARGUMENT', 'ANCHOR_LOSS'],
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
    summary: 'Edit a plan — replace, append, or insert after a section. The first update in a thread with no plan requires `title` and creates the file; the slug is slugify(title) and immutable thereafter.',
    scope: 'project',
    mediation: 'direct',
    opClass: 'plan',
    inputSchema: {
      path: z.string().optional(),
      title: z.string().optional().describe('Required when the thread has no plan yet — this call creates it.'),
      // 0.2.15: named `action`, matching every rendering. The row said `mode`,
      // which no channel ever accepted.
      action: z.enum(['replace', 'append', 'insert_after_section']),
      content: z.string(),
      /**
       * 0.2.15 — required by the operation on every call EXCEPT the first one in
       * a thread, which creates the plan and has nothing to be stale against.
       * A zod shape cannot say "required unless", so the enforcement lives in
       * `PlanService.update`; `.optional()` here would otherwise read as the
       * guard being optional, which it is not.
       */
      expectedHash: z.string().optional().describe('REQUIRED except on the call that creates the plan.'),
      changeSummary: z.string(),
    },
    errorCodes: ['NOT_FOUND', 'MISSING_TITLE', 'PLAN_CONFLICT', 'VALIDATION', 'INVALID_ARGUMENT'],
    sideEffects: ['file', 'db', 'ui-notify'],
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
    inputSchema: { path: z.string().optional().describe('Brief path relative to briefsDir. Required on an external connection.') },
    errorCodes: ['BRIEF_NOT_FOUND', 'VALIDATION'],
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
