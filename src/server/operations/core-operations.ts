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
 * ## M39 read core — 14 operations, full four-channel parity
 *
 * All 14 are `project` scope, `direct` mediation, `direct` in all four channels,
 * ZERO `n/a` cells. Three of them (`check_consistency`, `search_entities`,
 * `resolve_identity`) had no `rest` rendering before 0.2.13; this release adds
 * it, which is what makes the parity claim true rather than aspirational.
 *
 * The `cli` cells say `direct` because M11 renders the whole catalog as CLI
 * commands. Parity there is OPERATIONAL, not nominal: five XML-tag reader
 * commands may front one `get_entities` operation, exactly as MCP fronts it with
 * one tool and a `view` parameter. Note the CLI's own migration to
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

/** Shared by every operation that projects an entity through the serialization layer. */
const viewParam = {
  view: z
    .enum(['inline_mention', 'single_element', 'element_list_item', 'detail', 'full'])
    .optional()
    .describe('Projection kind. Defaults to the operation\'s natural view.'),
};

/** Shared paging vocabulary — same names in every channel. */
const paging = {
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
};

/** Every M39 read operation can answer with these. */
const READ_CODES = ['INVALID_TYPE', 'INVALID_VIEW', 'INVALID_ARGUMENT', 'INDEX_NOT_MATERIALIZED'] as const;

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

  // ── M39 read core (14) ────────────────────────────────────────────────────

  CATALOG.register(
    coreRead('overview', 'Entry point to a specification: page roots with their properties, active entity types with counts and payload versions, tag count, claude4spec version.', {
      ...viewParam,
    }),
  );

  CATALOG.register(
    // The summary deliberately says "activation set" rather than naming the
    // config field: an architecture gate asserts that only the plugin host reads
    // `config.entities`, and it greps string literals too.
    coreRead('describe_types', "Schemas of the active entity types. Without a type argument, all of them; a type outside the project's activation set is INVALID_TYPE, never a silent fallback.", {
      types: z.array(z.string()).optional().describe('Restrict to these type ids. Omit for every active type.'),
      ...viewParam,
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
    coreRead('search_entities', 'Ranked search over one entity type. Returns `searchedFields`, so an empty result is distinguishable from a field that was never searched.', {
      type: z.string(),
      query: z.string(),
      fields: z.array(z.string()).optional(),
      ...viewParam,
      ...paging,
    }),
  );

  CATALOG.register(
    coreRead('list_entities', 'Entities of one type in the reader\'s order, paged.', {
      type: z.string(),
      ...viewParam,
      ...paging,
    }),
  );

  CATALOG.register(
    coreRead('get_entities', 'Several entities of one type by slug, in ONE call.', {
      type: z.string(),
      slugs: z.array(z.string()).min(1),
      ...viewParam,
    }, ['ENTITY_NOT_FOUND', 'AMBIGUOUS_ENTITY']),
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
      mode: z.enum(['replace', 'append', 'insert_after_section']).optional(),
      content: z.string(),
    },
    errorCodes: ['NOT_FOUND', 'MISSING_TITLE', 'PLAN_CONFLICT', 'VALIDATION'],
    sideEffects: ['file', 'db', 'ui-notify'],
    idempotent: false,
    channels: fullParity(),
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
      expectedHash: z.string().optional(),
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

  CATALOG.register({
    name: 'abort_turn',
    summary: 'Abort the running turn of a thread, addressed BY THREAD. Idempotent: aborting a thread with no live turn is a no-op, not an error. An unknown thread is THREAD_NOT_FOUND.',
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
}
