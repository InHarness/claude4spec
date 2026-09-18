/**
 * The M39 read core's dep-free DTOs — the shapes of the five operations bound
 * onto `MountContext` as the plugin read surface (0.2.79).
 *
 * They live in `shared/` for one reason: as of 0.2.79 these signatures, TOGETHER
 * WITH the shape of the record they issue, count toward the surface versioned by
 * `hostApiVersion`, so the published mirror in `plugin-types/plugin-runtime.ts`
 * has to state them exactly. `server/discovery/types.ts` cannot be that source —
 * it imports better-sqlite3, the project host and the serialization engine, none
 * of which may leak into the published surface. Re-exporting from HERE keeps one
 * definition instead of a hand-copied twin that drifts on the first edit.
 *
 * `server/discovery/types.ts` re-exports every name below, so the core and its
 * transports keep importing from where they always did.
 *
 * Nothing in this file may import a host internal. That constraint is the whole
 * point of the file, not an accident of its current contents.
 */

/**
 * One window of a listing, and the two facts a caller cannot deduce for itself.
 *
 * Defined here rather than imported from `discovery/pagination.ts` because that
 * module carries runtime code (the budget fitter, the error catalogue) and this
 * one must stay type-only. `pagination.ts` re-exports it, so the core's own
 * imports are unchanged.
 */
export interface Page<T> {
  items: T[];
  total: number;
  /** More rows exist past this window — a fact about PAGING. */
  hasMore: boolean;
  /**
   * The window was cut SHORT of the requested `limit` because the response
   * budget ran out. Distinct from `hasMore`, and both can be true at once.
   */
  truncated: boolean;
}

// ── Meta ────────────────────────────────────────────────────────────────────


export interface DescribeTypesInput {
  types?: string[];
}

/**
 * What a type IS, as the host describes it.
 *
 * `views` is gone as of 0.2.22. The caller no longer picks one — record width is
 * `select`'s business — so publishing the type's repertoire of computed views
 * advertised a choice nobody can make. The three lists that replace it are all
 * DERIVED by the host from `data.schema`, never declared by the type, which is
 * what keeps what a type advertises and what the host enforces the same thing.
 *
 * The description of `describe_entity_type` changes with it: it is no longer a
 * thing you call before a WRITE, it is a thing you call before a read too, to
 * learn what you may project.
 */
export interface DescribedType {
  type: string;
  label: string;
  payloadVersion: number;
  schemas: Record<string, unknown>;
  /** Value constraints per field: `enum` + `values`, and `maxLength`. */
  constraints: unknown[];
  /** Content-bearing fields, each with the operation that issues its content. */
  contentFields: Array<{ field: string; operation: string }>;
  /** The flat list of names legal in `get_entities`' `select`. */
  selectableFields: string[];
  /** The paths a `search_entities` call would actually cover for this type. */
  searchableFields: string[];
}

export interface DescribeTypesResult {
  types: DescribedType[];
}

// ── Search ──────────────────────────────────────────────────────────────────

export interface SearchEntitiesInput {
  type: string;
  /**
   * 0.2.95 — OPTIONAL, and one half of an exclusive choice: EXACTLY ONE of
   * `query` / `regex`, with both or neither an `INVALID_ARGUMENT`.
   *
   * Unchanged semantics: a case-insensitive SUBSTRING after `trim` on both
   * sides, a multi-word value matching only as an exact PHRASE, and an empty
   * value yielding zero hits rather than everything. The absence of tokenization
   * is a settled non-goal, not a backlog item — a caller who wants word order or
   * inflection to flex builds it in `regex` (`kaucj\w*`).
   */
  query?: string;
  /**
   * 0.2.95 — a JavaScript regular expression body, matched case-insensitively
   * against the FULL VALUE of each field in scope.
   *
   * Because the unit of matching is the whole value and not a line, `\n` and
   * `[\s\S]` are LEGAL here and return hits on fields whose value really does
   * cross a line. `search_pages` refuses exactly those patterns, because there
   * the unit is the line and such a pattern could only ever match nothing. The
   * asymmetry is the contract, not an oversight on either side.
   */
  regex?: string;
  fields?: string[];
  /**
   * The cost ladder, default `map` since 0.2.95: `count` says how much, `map`
   * says where, `hits` says what it says. The rung a caller lands on by NOT
   * choosing is the one that answers "which entities" without paying to carry
   * their prose.
   */
  mode?: 'count' | 'map' | 'hits';
  limit?: number;
  offset?: number;
  /** Same declarative field filter as `ListEntitiesInput.filters`, ANDed with the ranking. */
  filters?: Record<string, unknown>;
  /** Tag filter, ANDed with the ranking — same semantics as on `ListEntitiesInput`. */
  tags?: string[];
  tagFilter?: 'and' | 'or';
  /** See `ListEntitiesInput.applyDefaultPredicate`. */
  applyDefaultPredicate?: boolean;
}

/**
 * One contiguous window of one field's value, carrying how many matches fell
 * inside it. `hits` mode only.
 */
export interface SearchEntityHunk {
  /**
   * The field the window came from — and a LEGAL `select` value for
   * `get_entities`, which is what makes a hunk an ADDRESS rather than a sample:
   * the caller can go back for the full value. Never a `contentBearing` field.
   */
  field: string;
  text: string;
  /** Matches inside this window, which is why merged windows do not lose count. */
  matches: number;
}

/**
 * A hit: the discovery row plus how strongly it matched. Frozen for the same
 * reason `EntityRow` is — search is discovery, and discovery answers with keys.
 *
 * The unit of a HIT is the ENTITY. No two rows ever share a `slug`: an entity
 * matched twice comes back once with `matchCount: 2`, whether both matches fell
 * in one field or in two different ones.
 *
 * 0.2.95 removed `score`. Relevance cannot be computed without a content index,
 * so the number was a ranking artefact the caller could neither interpret nor
 * compare between calls; `matchCount` is a fact. What ranks the answer is the
 * ORDER, which is a declared contract — see `searchEntities`.
 */
export interface SearchEntityHit extends EntityRow {
  matchCount: number;
  /** `hits` mode only, and never present in `count` or `map`. */
  hunks?: SearchEntityHunk[];
  /**
   * `hits` mode only: characters of the SELECTED windows that were not
   * delivered — a window cut to the per-hunk ceiling, or a window dropped past
   * the per-hit cap. Deliberately not "the rest of the field", which would be a
   * measure of the entity's size rather than of what this answer withheld.
   */
  omittedChars?: number;
}

export type SearchEntitiesResult =
  | (Page<SearchEntityHit> & {
      mode: 'hits';
      /** Mandatory: without it an empty result is indistinguishable from an out-of-scope field. */
      searchedFields: string[];
    })
  | (Page<SearchEntityHit> & { mode: 'map'; searchedFields: string[] })
  /** `total` counts ENTITIES, so it agrees with the two rungs above; `matches` counts occurrences. */
  | { mode: 'count'; total: number; matches: number; searchedFields: string[] };

export interface ResolveIdentityInput {
  query: string;
  types?: string[];
  /** Top-N of a ranking — see the note in `resolveIdentity`. There is no `offset`. */
  limit?: number;
}

export interface ResolveIdentityResult {
  /**
   * `title`, not `label` — 0.2.22. The old name described the ROLE the value
   * played here while saying nothing about where it came from, which is exactly
   * the gap the reserved field closes: it came from a `name ?? label ?? title`
   * guess, and now it comes from the field every type declares.
   */
  candidates: Array<{ type: string; slug: string; title: string; score: number }>;
  /**
   * 0.2.15 — true when the ranking was cut to `limit`.
   *
   * This operation carries no `total`/`hasMore` on purpose (paging deeper into a
   * similarity ranking asks for the answers the ranking already judged worse),
   * but "there were more candidates than you saw" is still a fact the caller
   * cannot deduce from a list whose length equals a limit it may have defaulted.
   */
  truncated: boolean;
}

// ── Graph ───────────────────────────────────────────────────────────────────

export interface ListEntitiesInput {
  type: string;
  tags?: string[];
  /**
   * How to combine `tags`. Spelled `tagFilter` on every surface since 0.2.22 —
   * it used to be `filter` here and on REST/CLI while `entity-tools` already
   * said `tagFilter`, so one parameter had two names depending on the door you
   * came through. Both defaulted to `'and'`; the rename changes no behaviour.
   */
  tagFilter?: 'and' | 'or';
  /**
   * 2.0.0 tier K — declarative field filter, `{ field: value | value[] }`,
   * ANDed with the tag filter. Equality / set membership over the type's own
   * declared scalar fields; see `RawEntityReader.slugsMatching` for the
   * vocabulary and why it is derived from the declaration rather than left to a
   * per-type service.
   */
  filters?: Record<string, unknown>;
  /**
   * Apply the type's declared `defaultPredicate` for fields this call does not
   * name. OFF by default, and that asymmetry is deliberate.
   *
   * A TRANSPORT asking "list the ACs" inherits the default `AcService.list`
   * used to apply (`status: 'active'`). PAGE RENDERING asking the same core the
   * same question must not: `<tagged_list type="ac" tags="x"/>` has always shown
   * deprecated ACs, a page author has no attribute to ask for them back, and a
   * release snapshot taken with the default on would silently lose rows. Making
   * it opt-in is what keeps "who is asking" visible at the call site.
   */
  applyDefaultPredicate?: boolean;
  /**
   * Row order. `createdAt` is the default and the ONLY one whose offset window
   * is stable under concurrent writes: it is the reader's own total order
   * (`created_at, slug`), so an entity appearing mid-traversal lands at the end
   * rather than shifting a page boundary. `title` and `slug` re-sort the whole
   * set, so a concurrent write can move a row across a page boundary and the
   * caller can see it twice or not at all.
   */
  sort?: 'createdAt' | 'title' | 'slug';
  dir?: 'asc' | 'desc';
  mode?: 'items' | 'count';
  limit?: number;
  offset?: number;
}

/**
 * The FROZEN discovery row: a key and a label, and nothing else.
 *
 * `list_entities` has no width parameter at all since 0.2.22. Discovery answers
 * "what is here"; a caller who then wants content asks `get_entities` with a
 * `select`. Two consequences worth stating, because both were once the opposite:
 *   - `tags` are NOT here. `get_entities(select: [])` returns them, and putting
 *     them on every list row made the cheap operation carry a join nobody asked
 *     for.
 *   - `type` is on the ENVELOPE, not repeated on every row of a list that can
 *     only ever hold one type.
 */
export interface EntityRow {
  slug: string;
  title: string;
}

export type ListEntitiesResult =
  | { mode: 'items'; type: string; items: EntityRow[]; total: number; hasMore: boolean }
  | { mode: 'count'; type: string; total: number };

export interface GetEntitiesInput {
  type: string;
  slugs: string[];
  /**
   * The field projection. Absent means "every schema field except the
   * content-bearing ones"; `[]` means the identity skeleton. See
   * `discovery/project.ts` for the full contract.
   */
  select?: string[];
}

export interface GetEntitiesResult {
  type: string;
  /** The fields the records actually carry — symmetric to `searchedFields`. */
  selectedFields: string[];
  results: Array<{ slug: string; entity: unknown | null; truncated?: boolean } >;
  truncated?: boolean;
  /**
   * 0.2.6 — the instruction lives HERE, not on the item.
   *
   * `get_sections` already carried its retry instruction on the envelope while
   * `get_entities` carried a `truncationHint` on its own result, so the two
   * halves of one category ("fetch by key") disagreed about where a consumer
   * should look. The item now says only THAT it was cut (`truncated: true`);
   * what to do about it is said once, for the whole call.
   */
  message?: string;
}

/**
 * `(type, slug, field)` — the single coordinate a content-bearing field is read
 * by. See `discovery/ops/content.ts` for why one axis rather than two.
 *
 * 0.2.79 — moved here from `server/discovery/types.ts` when `getFieldContent`
 * joined the plugin surface. A read record answers a content-bearing field with
 * a DESCRIPTOR (`<field>Has` / `<field>Bytes` / `<field>Operation`) and never
 * with the value, so an envelope auditing entities of other types — which is the
 * whole job of `c4s-plugin-ac` — has the descriptor from `describeTypes` and,
 * without this, nothing that follows it. Widening the surface is allowed;
 * narrowing it is not.
 */
export interface GetFieldContentInput {
  type: string;
  slug: string;
  field: string;
}

export interface GetFieldContentResult {
  type: string;
  slug: string;
  field: string;
  content: string;
  bytes: number;
}
