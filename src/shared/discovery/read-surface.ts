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
  query: string;
  fields?: string[];
  mode?: 'hits' | 'count';
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
 * A hit: the discovery row plus its score. Frozen for the same reason
 * `EntityRow` is — search is discovery, and discovery answers with keys.
 */
export type SearchEntitiesResult =
  | (Page<EntityRow & { score: number }> & {
      mode: 'hits';
      /** Mandatory: without it an empty result is indistinguishable from an out-of-scope field. */
      searchedFields: string[];
    })
  | { mode: 'count'; total: number; searchedFields: string[] };

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
