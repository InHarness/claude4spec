/**
 * M39 — `list_entities`, `get_entities`, `search_entities`, `resolve_identity`.
 *
 * `list_entities` is the load-bearing one: a complete, paginated traversal per
 * type is what AUTHORIZES search to be best-effort. An entity with no tags is
 * still reachable by enumeration — tags are an accelerator, not a closure.
 *
 * `get_entities` treats one slug as the degenerate case of a list, so there is
 * one operation instead of two with drifting semantics. `search_entities`
 * requires exactly one type: a cross-type full-text index federates rankings
 * badly and lets one call return hundreds of rows. `resolve_identity` is the
 * compensation — a FAÇADE over the per-type indexes, matching identity fields
 * only, which is a different thing from a cross-type index.
 */

import { applyItemBudget, MAX_SLUGS_PER_CALL } from '../budget.js';
import { invalidArgument, invalidType } from '../errors.js';
import { DEFAULT_LIMITS, paginate } from '../pagination.js';
import { compareRanked, relevance } from '../ranking.js';
import { resolveSearchFields, valuesAtPath } from '../search/fields.js';
import type { RawEntity } from '../raw-entity-reader.js';
import { columnOf, RESERVED_TITLE_FIELD } from '../../../shared/plugin-host/data-schema.js';
import type { ViewKind } from '../../serialization/types.js';
import { project, selectedFieldsOf, validateSelect } from '../project.js';
import type {
  DiscoveryDeps,
  EntityRow,
  GetEntitiesInput,
  GetEntitiesResult,
  ListEntitiesInput,
  ListEntitiesResult,
  ResolveIdentityInput,
  ResolveIdentityResult,
  SearchEntitiesInput,
  SearchEntitiesResult,
} from '../types.js';

function requireActiveType(deps: DiscoveryDeps, type: string) {
  const module = deps.host.getEntity(type);
  if (!module) throw invalidType(type, deps.host.listEntities().map((m) => m.type));
  return module;
}

export function listEntities(deps: DiscoveryDeps, input: ListEntitiesInput): ListEntitiesResult {
  requireActiveType(deps, input.type);
  const tagFilter = input.tagFilter ?? 'and';

  /**
   * An ABSENT `tags` is "no tag filter"; an EMPTY `tags` is "filter by nothing",
   * which matches nothing. Collapsing the two is how `<tagged_list tags=""/>`
   * would render the entire type instead of an empty list — `reader.findByTag`
   * has always returned `[]` for an empty tag set, and this is the surface that
   * replaced it.
   */
  const slugs =
    input.tags === undefined
      ? deps.reader.listSlugs(input.type)
      : input.tags.length === 0
        ? []
        : deps.reader
            .findByTag({ type: input.type, tags: input.tags, filter: tagFilter })
            .map((e) => e.slug);
  /**
   * 0.2.4 — NO re-sort here. The reader owns the order (`created_at, slug`,
   * `RawEntityReader.orderClause`) and it is the same order the REST and UI
   * paths get. Re-sorting by slug meant this transport alone disagreed with
   * every other one about what "the list of X" looks like, which is exactly the
   * discrepancy the unified order removes. Paging still works because the
   * reader's order is total: `slug` breaks ties.
   */
  /**
   * The declarative field filter, ANDed with the tag filter. Applied by
   * intersection rather than by a combined query so the reader's order survives
   * it — the whole point of the `sorted` note above.
   */
  const matching = deps.reader.slugsMatching(input.type, input.filters ?? {}, {
    applyDefaultPredicate: input.applyDefaultPredicate ?? false,
  });
  const sorted = matching ? slugs.filter((s) => matching.has(s)) : slugs;

  // "How many entities carry tag X" without walking them: the count mode exists
  // so measurement never costs a full traversal.
  if (input.mode === 'count') return { mode: 'count', type: input.type, total: sorted.length };

  const ordered = applySort(deps, input, sorted);
  const page = paginate(ordered, input, DEFAULT_LIMITS.listEntities);
  /**
   * The row is built HERE, off the raw entity, and never serialized.
   *
   * 0.2.22 froze it to `{ slug, title }`, which means the type's own view
   * functions have nothing left to contribute to a list — and that is a
   * robustness gain as much as a contract one: a throwing per-type view can no
   * longer take down an enumeration, which is the operation everything else
   * falls back to when search or tags come up empty.
   */
  const items = page.items.map((slug) => rowFor(deps, input.type, slug));
  return { mode: 'items', type: input.type, items, total: page.total, hasMore: page.hasMore };
}

/** The frozen discovery row. `title` is reserved, so every type has one. */
function rowFor(deps: DiscoveryDeps, type: string, slug: string): EntityRow {
  const raw = deps.reader.getEntity(type, slug);
  return { slug, title: titleOf(deps, type, raw) };
}

/**
 * An entity's label, read straight off the row.
 *
 * Falls back to the slug rather than to an empty string: a row read while the
 * index is mid-rebuild may not carry `title` yet, and a list of blank labels is
 * a worse answer than a list of slugs — which is what this all looked like
 * before the reserved field existed.
 */
function titleOf(deps: DiscoveryDeps, type: string, raw: RawEntity | null | undefined): string {
  if (!raw) return '';
  const column = columnOf(RESERVED_TITLE_FIELD, deps.host.getEntity(type)?.data?.schema?.title ?? { kind: 'string' });
  const value = raw.data[RESERVED_TITLE_FIELD] ?? raw.data[column];
  return typeof value === 'string' && value !== '' ? value : raw.slug;
}

/**
 * Order the slug list.
 *
 * The default is the READER's order (`created_at, slug`) and is left completely
 * alone — no re-sort, not even a stable one — because that order is what every
 * other surface sees and what makes an `offset` window survive a concurrent
 * write: a new entity lands at the end rather than displacing a page boundary.
 *
 * `title` and `slug` re-sort the whole set and carry no such promise. `slug`
 * breaks ties in both, so paging is at least deterministic in the absence of
 * writes.
 */
function applySort(deps: DiscoveryDeps, input: ListEntitiesInput, slugs: string[]): string[] {
  const dir = input.dir === 'desc' ? -1 : 1;
  if (!input.sort || input.sort === 'createdAt') return dir === 1 ? slugs : [...slugs].reverse();
  if (input.sort === 'slug') return [...slugs].sort((a, b) => a.localeCompare(b) * dir);
  const byTitle = new Map(slugs.map((slug) => [slug, rowFor(deps, input.type, slug).title]));
  return [...slugs].sort(
    (a, b) =>
      ((byTitle.get(a) ?? '').localeCompare(byTitle.get(b) ?? '') || a.localeCompare(b)) * dir,
  );
}

/**
 * The ONE place the serialization registry is called from for entities.
 *
 * Takes the ENTITY, not a slug: the caller has already read the row, and reading
 * it twice was the only reason this needed the reader.
 *
 * The outcome flags travel with the payload rather than being flattened away: a
 * consumer that cannot tell "the type computed this" from "the host generated
 * it, because the type's own view threw" will present the second as the first.
 * `generic` is a plain boolean here — every record has an answer — while the
 * wire shape (`SerializedMeta`) keeps it optional, so an unremarkable record is
 * not fattened by `generic: false` on every row of a list.
 */
function serialize(
  deps: DiscoveryDeps,
  type: string,
  view: ViewKind,
  entity: RawEntity,
): { data: unknown; generic: boolean; error?: string; brokenRefs?: string[] } {
  const result = deps.serialization.serializeEntity(type, view, entity, deps.reader);
  return {
    data: result.data,
    generic: result.generic,
    ...(result.error ? { error: result.error } : {}),
    ...(result.brokenRefs ? { brokenRefs: result.brokenRefs } : {}),
  };
}

/** `serialize` for a slug that may not resolve — the list/get/search shape. */
function serializeSlug(
  deps: DiscoveryDeps,
  type: string,
  view: ViewKind,
  slug: string,
): { data: unknown; generic?: boolean; error?: string; brokenRefs?: string[] } {
  const raw = deps.reader.getEntity(type, slug);
  if (!raw) return { data: null };
  const { generic, ...rest } = serialize(deps, type, view, raw);
  return { ...rest, ...(generic ? { generic: true } : {}) };
}

export function getEntities(deps: DiscoveryDeps, input: GetEntitiesInput): GetEntitiesResult {
  const module = requireActiveType(deps, input.type);
  if (input.slugs.length > MAX_SLUGS_PER_CALL) {
    throw invalidArgument(
      `get_entities accepts at most ${MAX_SLUGS_PER_CALL} slugs (got ${input.slugs.length})`,
      `split the call, or use list_entities({ type: "${input.type}" }) which paginates`,
    );
  }
  // Silent de-duplication, first occurrence wins its position — the same rule
  // `get_sections` applies to `anchors[]`. Repeating a key is a caller mistake
  // with an obvious intent, and the two halves of "fetch by key" must not
  // disagree about it.
  const slugs = [...new Set(input.slugs)];

  /**
   * ONE internal view, then a projection.
   *
   * The width of the answer used to depend on how many slugs you asked for —
   * one slug meant `single_element`, several meant the narrower
   * `element_list_item` — which made `["order"]` and `["order","cart"]` return
   * different shapes for `order`. Width is now the caller's to state, so this
   * always serializes the WIDEST view (`detail`, the only one guaranteed to be a
   * superset of the declared fields) and lets `project` cut it down.
   *
   * `project` runs even when `select` is absent, so there is exactly one rule
   * rather than a rule and an exception: the record is always `f(schema,
   * select)`, and a field a computed view invented but the schema never declared
   * does not travel under either.
   */
  const schema = module.data?.schema ?? {};
  validateSelect(input.select, schema);

  const results: GetEntitiesResult['results'] = slugs.map((slug) => {
    const { data, ...meta } = serializeSlug(deps, input.type, 'detail', slug);
    // The stored row goes in beside the serialized one, so a content-bearing
    // field's SIZE is knowable even for a type whose own views (correctly) do
    // not carry it. See `project`.
    const stored = deps.reader.getEntity(input.type, slug)?.data;
    return {
      slug,
      entity: data === null ? null : project(data, input.select, schema, stored),
      ...meta,
    };
  });

  /**
   * `detail` × N cannot be unbounded — but nothing the caller NAMED may vanish.
   *
   * 0.2.6 moved this off `applyBudget`, which drops the tail. Dropping is right
   * for a page the collection chose; here the caller listed these slugs, so a
   * missing one reads as "that entity does not exist" — the one confusion the
   * error catalogue exists to prevent. `applyItemBudget` is the SAME branch
   * `get_sections` uses: every key is answered, and the ones past the line come
   * back meta-only. The first item is never degraded, because a single-slug call
   * is already the smallest possible retry.
   */
  // AFTER the projection, deliberately: the budget's promise is about the bytes
  // the caller receives, and a `select: []` call that fits comfortably would
  // otherwise be cut on the strength of a payload nobody was ever going to see.
  const budgeted = applyItemBudget(results, metaOnly, RETRY_HINT);
  return {
    type: input.type,
    selectedFields: selectedFieldsOf(input.select, schema),
    results: budgeted.items,
    ...(budgeted.truncated ? { truncated: true, message: budgeted.truncationHint ?? RETRY_HINT } : {}),
  };
}

const RETRY_HINT =
  'response budget reached — every entity after the first oversized one came back without its `entity` payload (`truncated: true`). Re-request those slugs as a smaller subset.';

/**
 * Strips the expensive half, keeping everything that says what was cut.
 *
 * An entity payload is a serialized OBJECT, not a string, so there is no
 * text-truncation counterpart to `get_sections`' oversized-body cut: half an
 * entity is not a smaller entity, it is malformed data presented as a record.
 * The first item is therefore kept whole rather than shortened.
 */
function metaOnly(item: GetEntitiesResult['results'][number]): GetEntitiesResult['results'][number] {
  return { ...item, entity: null, truncated: true };
}

export function searchEntities(deps: DiscoveryDeps, input: SearchEntitiesInput): SearchEntitiesResult {
  const module = requireActiveType(deps, input.type);
  const fields = resolveSearchFields(module, input.fields);
  const searchedFields = fields.map((f) => f.path);

  /**
   * The same declarative filter `list_entities` applies, ANDed with the ranking.
   *
   * Tier E left search unfiltered because nothing could filter it generically;
   * tier K's `slugsMatching` can, and leaving it out would have made a type's
   * `defaultPredicate` hold for "list the ACs" but not for "search the ACs" —
   * the AC list page combines a search box with its status/kind dropdowns, so
   * the two questions must narrow the same way. Applied BEFORE scoring, so
   * `total` counts matching hits rather than all hits.
   */
  const matching = deps.reader.slugsMatching(input.type, input.filters ?? {}, {
    applyDefaultPredicate: input.applyDefaultPredicate ?? false,
  });

  /**
   * The TAG filter, ANDed with the ranking for the same reason.
   *
   * Search and tag-filter are different core operations — one ranks, one
   * enumerates — but "the ACs tagged `auth`, matching `checkout`" is one
   * question a user asks by leaving a tag chip selected and then typing. Every
   * entity list page sends `tags` and `search` in the SAME request, so a search
   * path that ignored `tags` made the selected chip stop applying the moment
   * you typed, while still rendering as selected. The retired per-type SQL
   * ANDed them; what it got wrong was folding the ranking into that one WHERE,
   * not the AND itself.
   */
  const tagged =
    input.tags === undefined
      ? null
      : new Set(
          input.tags.length === 0
            ? []
            : deps.reader
                .findByTag({ type: input.type, tags: input.tags, filter: input.tagFilter ?? 'and' })
                .map((e) => e.slug),
        );

  const scored: Array<{ slug: string; score: number; key: string }> = [];
  for (const slug of deps.reader.listSlugs(input.type)) {
    if (matching && !matching.has(slug)) continue;
    if (tagged && !tagged.has(slug)) continue;
    const raw = deps.reader.getEntity(input.type, slug);
    if (!raw) continue;
    const record = { ...raw.data, slug: raw.slug, tags: raw.tags };
    let best = 0;
    for (const field of fields) {
      best = Math.max(best, relevance(input.query, valuesAtPath(record, field.path), field.weight ?? 1));
    }
    if (best > 0) scored.push({ slug, score: best, key: slug });
  }
  scored.sort(compareRanked);

  if (input.mode === 'count') return { mode: 'count', total: scored.length, searchedFields };

  const page = paginate(scored, input, DEFAULT_LIMITS.searchEntities);
  return {
    ...page,
    // The frozen row plus its score — search is discovery, and discovery
    // answers with keys. A caller who wants content follows up with
    // `get_entities` and states a projection.
    items: page.items.map((hit) => ({ ...rowFor(deps, input.type, hit.slug), score: hit.score })),
    mode: 'hits',
    searchedFields,
  };
}

/**
 * The only cross-type operation, and deliberately a façade: it iterates the
 * per-type indexes rather than consulting a cross-type full-text index. The
 * prohibition is on the INDEX, not on the façade — matching identity fields
 * (slug, name, label) over N small lookups federates cleanly, where a shared
 * full-text ranking does not.
 */
export function resolveIdentity(deps: DiscoveryDeps, input: ResolveIdentityInput): ResolveIdentityResult {
  const active = deps.host.listEntities().map((m) => m.type);
  const types = input.types?.length ? input.types : active;
  for (const type of types) if (!active.includes(type)) throw invalidType(type, active);

  const candidates: Array<{ type: string; slug: string; title: string; score: number; key: string }> = [];
  for (const type of types) {
    for (const slug of deps.reader.listSlugs(type)) {
      const raw = deps.reader.getEntity(type, slug);
      if (!raw) continue;
      // 0.2.22 — one field, not a `name ?? label ?? title` guess across three
      // spellings none of which every type declared.
      const title = titleOf(deps, type, raw);
      const score = relevance(input.query, [slug, title]);
      if (score > 0) candidates.push({ type, slug, title, score, key: `${type}/${slug}` });
    }
  }
  candidates.sort(compareRanked);
  /**
   * `limit` ONLY — no `offset`, no `total`, no `hasMore`, and that is a third
   * kind of exemption rather than an oversight.
   *
   * The first two are fetch-by-key (the caller names the rows) and bounded by
   * construction (`overview`, `describe_types`). This is the third: an output
   * bounded by its own nature. `resolve_identity` is a top-N RANKING over a
   * fuzzy query — "what is this called?" — and paging deeper into a similarity
   * ranking asks for the answers the ranking already judged worse. There is
   * nothing on page two a caller wants.
   */
  const limit = input.limit ?? DEFAULT_LIMITS.resolveIdentity;
  return {
    candidates: candidates.slice(0, limit).map(({ type, slug, title, score }) => ({ type, slug, title, score })),
    truncated: candidates.length > limit,
  };
}
