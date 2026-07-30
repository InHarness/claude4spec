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

import { applyBudget, MAX_SLUGS_PER_CALL } from '../budget.js';
import { invalidArgument, invalidType, invalidView } from '../errors.js';
import { DEFAULT_LIMITS, paginate } from '../pagination.js';
import { compareRanked, relevance } from '../ranking.js';
import { resolveSearchFields, valuesAtPath } from '../search/fields.js';
import type { ViewKind } from '../../serialization/types.js';
import type {
  DiscoveryDeps,
  GetEntitiesInput,
  GetEntitiesResult,
  ListEntitiesInput,
  ListEntitiesResult,
  ResolveIdentityInput,
  ResolveIdentityResult,
  SearchEntitiesInput,
  SearchEntitiesResult,
} from '../types.js';

const VIEW_KINDS: ViewKind[] = [
  'inline_mention',
  'single_element',
  'element_list_item',
  'tagged_list_item',
  'detail',
];

function requireActiveType(deps: DiscoveryDeps, type: string) {
  const module = deps.host.getEntity(type);
  if (!module) throw invalidType(type, deps.host.listEntities().map((m) => m.type));
  return module;
}

function requireView(view: string | undefined, fallback: ViewKind): ViewKind {
  if (view === undefined) return fallback;
  if (!VIEW_KINDS.includes(view as ViewKind)) throw invalidView(view, VIEW_KINDS);
  return view as ViewKind;
}

export function listEntities(deps: DiscoveryDeps, input: ListEntitiesInput): ListEntitiesResult {
  requireActiveType(deps, input.type);
  const filter = input.filter ?? 'and';

  const slugs = input.tags?.length
    ? deps.reader.findByTag({ type: input.type, tags: input.tags, filter }).map((e) => e.slug)
    : deps.reader.listSlugs(input.type);
  const sorted = [...slugs].sort((a, b) => a.localeCompare(b));

  // "How many entities carry tag X" without walking them: the count mode exists
  // so measurement never costs a full traversal.
  if (input.mode === 'count') return { mode: 'count', total: sorted.length };

  // The minimal view is the default on purpose — it kills both the bare-slug
  // list and the N+1 that followed it, since `detail` carries `tags[]` and so
  // the tag↔entity relation needs no second call.
  const view = requireView(input.view, 'element_list_item');
  const page = paginate(sorted, input, DEFAULT_LIMITS.listEntities);
  const items = page.items.map((slug) => ({ slug, ...serialize(deps, input.type, view, slug) }));
  return { ...page, items, mode: 'items' };
}

/**
 * The ONE place the serialization registry is called from for entities.
 *
 * The serializer's own outcome flags travel with the payload rather than being
 * flattened away: a consumer that cannot tell "this is the entity" from "this
 * is a fallback because the serializer threw" will present a degraded record as
 * the real one.
 */
function serialize(
  deps: DiscoveryDeps,
  type: string,
  view: ViewKind,
  slug: string,
): { data: unknown; fallback?: boolean; error?: string; brokenRefs?: string[] } {
  const raw = deps.reader.getEntity(type, slug);
  if (!raw) return { data: null };
  const result = deps.serialization.serializeEntity(type, view, raw, deps.reader);
  return {
    data: result.data,
    ...(result.fallback ? { fallback: true } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.brokenRefs ? { brokenRefs: result.brokenRefs } : {}),
  };
}

export function getEntities(deps: DiscoveryDeps, input: GetEntitiesInput): GetEntitiesResult {
  requireActiveType(deps, input.type);
  if (input.slugs.length > MAX_SLUGS_PER_CALL) {
    throw invalidArgument(
      `get_entities accepts at most ${MAX_SLUGS_PER_CALL} slugs (got ${input.slugs.length})`,
      `split the call, or use list_entities({ type: "${input.type}" }) which paginates`,
    );
  }
  const view = requireView(input.view, 'single_element');

  const results = input.slugs.map((slug) => {
    const { data, ...meta } = serialize(deps, input.type, view, slug);
    return { slug, entity: data, ...meta };
  });
  // `detail` × N cannot be unbounded. Truncation is SIGNALLED, never silent —
  // a consumer that cannot tell a cut from an absence will report the missing
  // entities as non-existent.
  const budgeted = applyBudget(
    results,
    `response truncated by budget — re-request the remaining slugs in a second get_entities call`,
  );
  return {
    type: input.type,
    view,
    results: budgeted.items,
    ...(budgeted.truncated ? { truncated: true, truncationHint: budgeted.truncationHint } : {}),
  };
}

export function searchEntities(deps: DiscoveryDeps, input: SearchEntitiesInput): SearchEntitiesResult {
  const module = requireActiveType(deps, input.type);
  const fields = resolveSearchFields(module, input.fields);
  const searchedFields = fields.map((f) => f.path);

  const scored: Array<{ slug: string; score: number; key: string }> = [];
  for (const slug of deps.reader.listSlugs(input.type)) {
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

  const view = requireView(input.view, 'element_list_item');
  const page = paginate(scored, input, DEFAULT_LIMITS.searchEntities);
  return {
    ...page,
    items: page.items.map((hit) => ({
      slug: hit.slug,
      score: hit.score,
      ...serialize(deps, input.type, view, hit.slug),
    })),
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

  const candidates: Array<{ type: string; slug: string; label: string; score: number; key: string }> = [];
  for (const type of types) {
    for (const slug of deps.reader.listSlugs(type)) {
      const raw = deps.reader.getEntity(type, slug);
      if (!raw) continue;
      const label = String(raw.data.name ?? raw.data.label ?? raw.data.title ?? slug);
      const score = relevance(input.query, [slug, label]);
      if (score > 0) candidates.push({ type, slug, label, score, key: `${type}/${slug}` });
    }
  }
  candidates.sort(compareRanked);
  const limit = input.limit ?? DEFAULT_LIMITS.resolveIdentity;
  return {
    candidates: candidates.slice(0, limit).map(({ type, slug, label, score }) => ({ type, slug, label, score })),
  };
}
