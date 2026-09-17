/**
 * M39 — `search_entities`, the entity twin of `search_pages`.
 *
 * 0.2.95 brought the two operations to one shape: a second input (`regex`
 * beside the phrase), a three-rung cost ladder (`count` → `map` → `hits`) with
 * `map` as the rung you land on by not choosing, `matchCount` as the strength of
 * a hit, and `hunks[]` as evidence. It also took `score` away — relevance cannot
 * be computed without a content index, so the number ranked honestly by accident
 * at best and could not be compared between two calls. What ranks the answer now
 * is the ORDER, which is a declared contract rather than a derived float.
 *
 * WHERE THE TWO OPERATIONS DIVERGE, and it is one thing with consequences
 * everywhere: the unit of matching. `search_pages` matches a LINE, so a pattern
 * reaching across a newline could only ever match nothing and is refused
 * (`assertMatchableWithinOneLine` in `page-search.ts`). This operation matches
 * the FULL VALUE of a field, so `\n` and `[\s\S]` are not merely allowed, they
 * are the point — a field value crossing a line is ordinary. Hence no import of
 * that guard, and no line concept anywhere below: hunk windows are measured in
 * characters, and there is no `context` parameter to count lines with.
 *
 * What the two DO share lives in `./guards.ts` — the pattern-length refusal and
 * the time budget, both properties of a hostile pattern rather than of either
 * unit of matching.
 */

import {
  fitToBudget,
  HUNK_WINDOW_CHARS,
  MAX_HUNK_CHARS,
  MAX_HUNKS_PER_HIT,
} from '../budget.js';
import { invalidArgument } from '../errors.js';
import { DEFAULT_LIMITS, resolvePageRequest } from '../pagination.js';
import { compareRanked, relevance } from '../ranking.js';
import { resolveSearchFields, valuesAtPath, type SearchableField } from './fields.js';
import { assertPatternWithinLimit, startSearchBudget } from './guards.js';
import { requireActiveType, titleOf } from '../ops/entities.js';
import {
  columnOf,
  contentFieldsOf,
  IDENTITY_FIELDS,
  selectableFieldsOf,
  type FieldNode,
} from '../../../shared/plugin-host/data-schema.js';
import type { RawEntity } from '../raw-entity-reader.js';
import type {
  DiscoveryDeps,
  SearchEntitiesInput,
  SearchEntitiesResult,
  SearchEntityHit,
  SearchEntityHunk,
} from '../types.js';

export function searchEntities(
  deps: DiscoveryDeps,
  input: SearchEntitiesInput,
): SearchEntitiesResult {
  const module = requireActiveType(deps, input.type);
  const fields = resolveSearchFields(module, input.fields);
  const searchedFields = fields.map((f) => f.path);
  /**
   * 0.2.95 — `map`, not `hits`, for the reason `search_pages` adopted it in
   * 0.2.40: the rung a caller lands on by NOT choosing should answer "which
   * entities" without paying to carry their prose. Defaulting to `hits` meant
   * every incidental search shipped field text into a context that wanted a list
   * of slugs to feed `get_entities`.
   */
  const mode = input.mode ?? 'map';
  const matcher = buildEntityMatcher(input);
  const budget = startSearchBudget('search_entities', deps.searchBudgetMs);

  /**
   * The same declarative filter `list_entities` applies, ANDed with the search.
   *
   * Tier E left search unfiltered because nothing could filter it generically;
   * tier K's `slugsMatching` can, and leaving it out would have made a type's
   * `defaultPredicate` hold for "list the ACs" but not for "search the ACs" —
   * the AC list page combines a search box with its status/kind dropdowns, so
   * the two questions must narrow the same way. Applied BEFORE the scan, so
   * `total` counts matching hits rather than all hits.
   */
  const matching = deps.reader.slugsMatching(input.type, input.filters ?? {}, {
    applyDefaultPredicate: input.applyDefaultPredicate ?? false,
  });

  /**
   * The TAG filter, ANDed for the same reason.
   *
   * Search and tag-filter are different core operations — one ranks, one
   * enumerates — but "the ACs tagged `auth`, matching `checkout`" is one
   * question a user asks by leaving a tag chip selected and then typing. Every
   * entity list page sends `tags` and `search` in the SAME request, so a search
   * path that ignored `tags` made the selected chip stop applying the moment
   * you typed, while still rendering as selected.
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

  /**
   * An empty `query` is zero hits, not a refusal — the one place this operation
   * deliberately parts company with `search_pages`, which refuses `''`.
   *
   * "An empty query yields zero hits, never everything" is a semantic
   * `search_entities` has carried since 0.2.4 and which 0.2.95 explicitly left
   * unchanged, so turning it into an error would be a second breaking change
   * smuggled in beside the intended one. Note that `''` still counts as PRESENT
   * for the exclusive choice above: `{ query: '', regex: 'x' }` is two inputs,
   * and refused as two.
   */
  if (matcher === null) return emptyResult(mode, searchedFields);

  /**
   * The accumulator implements `Ranked`, so `compareRanked` orders it and the
   * relation is not restated here. `score` is a PRIVATE ordering key: it is
   * computed only when there is a phrase to rank by, and it is dropped by the
   * render step below. Nothing leaves this module carrying it.
   */
  interface Accum {
    slug: string;
    matchCount: number;
    score: number;
    key: string;
  }
  const hits: Accum[] = [];
  let matches = 0;

  for (const slug of deps.reader.listSlugs(input.type)) {
    /*
     * BETWEEN entities — the interruption point the brief names, and the reason
     * this loop is in the host rather than in SQL. Checked before any work on
     * this entity, so a run that spends all its time being filtered still stops.
     */
    budget.assertNotExhausted();
    if (matching && !matching.has(slug)) continue;
    if (tagged && !tagged.has(slug)) continue;
    const raw = deps.reader.getEntity(input.type, slug);
    if (!raw) continue;
    const record = recordOf(raw);

    let matchCount = 0;
    let score = 0;
    for (const field of fields) {
      const values = valuesAtPath(record, field.path);
      for (const value of values) matchCount += matcher.count(value);
      // Only a phrase has a relevance relation to realise; a pattern hit is
      // binary, and ordering it by anything would invent a gradation.
      if (matcher.kind === 'query') {
        score = Math.max(score, relevance(input.query ?? '', values, field.weight ?? 1));
      }
    }
    // ONE row per slug, by construction: the entity is the unit of a hit, and
    // both matches of an entity matched twice land in this one counter.
    if (matchCount === 0) continue;
    matches += matchCount;
    hits.push({ slug, matchCount, score, key: slug });
  }

  /*
   * Two relations, both with a full tie-break so `offset` neither drops nor
   * duplicates a row between pages:
   *
   *   query → exact > prefix > substring position > slug ascending
   *   regex → slug ascending, and nothing else
   *
   * The first is `compareRanked` over `relevance`, unchanged and shared with
   * `resolve_identity` — which legitimately still PUBLISHES its score, being a
   * different operation with a different contract.
   */
  hits.sort(matcher.kind === 'query' ? compareRanked : (a, b) => a.slug.localeCompare(b.slug));

  if (mode === 'count') {
    /*
     * Both sums, because they answer different questions: `total` is how many
     * ENTITIES a full traversal would enumerate (so it agrees with how `map` and
     * `hits` paginate), `matches` is how many occurrences were found.
     */
    return { mode: 'count', total: hits.length, matches, searchedFields };
  }

  /*
   * Slice BEFORE rendering, which is why this does not call `paginate`.
   *
   * `paginate` takes an already-rendered array, and rendering is the expensive
   * half here: a row read per hit, and in `hits` mode span-finding and window
   * merging over every field in scope. A query matching two thousand ACs would
   * build two thousand rows and throw all but fifty away. It is also why the
   * accumulator above holds no TEXT — keeping every matched value alive would
   * hold the whole matching corpus in memory, where only the window is ever
   * read. The budget rule is unchanged: `fitToBudget` is the same width cut
   * `paginate` applies, over the same window it would have produced.
   */
  const { limit, offset } = resolvePageRequest(input, DEFAULT_LIMITS.searchEntities);
  const window = hits.slice(offset, offset + limit);
  const evidence = mode === 'hits' ? makeEvidenceBuilder(deps, input.type, fields, matcher) : null;
  const rows: SearchEntityHit[] = window.map((hit) => {
    const raw = deps.reader.getEntity(input.type, hit.slug);
    const row: SearchEntityHit = {
      slug: hit.slug,
      title: titleOf(deps, input.type, raw),
      matchCount: hit.matchCount,
    };
    return evidence ? { ...row, ...evidence(raw) } : row;
  });
  const items = fitToBudget(rows);
  const page = {
    items,
    total: hits.length,
    hasMore: offset + items.length < hits.length,
    truncated: items.length < rows.length,
  };
  return mode === 'hits'
    ? { ...page, mode: 'hits', searchedFields }
    : { ...page, mode: 'map', searchedFields };
}

function recordOf(raw: RawEntity): Record<string, unknown> {
  return { ...raw.data, slug: raw.slug, tags: raw.tags };
}

function emptyResult(
  mode: 'count' | 'map' | 'hits',
  searchedFields: string[],
): SearchEntitiesResult {
  if (mode === 'count') return { mode: 'count', total: 0, matches: 0, searchedFields };
  const page = { items: [], total: 0, hasMore: false, truncated: false };
  return mode === 'hits'
    ? { ...page, mode: 'hits', searchedFields }
    : { ...page, mode: 'map', searchedFields };
}

// ── Matching ────────────────────────────────────────────────────────────────

interface Span {
  start: number;
  end: number;
}

interface EntityMatcher {
  kind: 'query' | 'regex';
  count(value: string): number;
  spans(value: string): Span[];
}

/**
 * One engine for both inputs, and it is always a `gi` RegExp — including for a
 * phrase.
 *
 * Compiling an escaped phrase rather than running `indexOf` over a lowercased
 * copy is deliberate: `String.prototype.toLowerCase` is not length-preserving
 * for every codepoint, so an index taken against a lowered copy can slip against
 * the original, and the hunk builder below slices the ORIGINAL. The semantics are
 * exactly the documented ones either way — a case-insensitive substring after
 * `trim`, a multi-word value as one exact phrase, no tokenization.
 *
 * Returns `null` for an empty phrase, which the caller answers with zero hits.
 */
function buildEntityMatcher(input: SearchEntitiesInput): EntityMatcher | null {
  const hasQuery = input.query !== undefined;
  const hasRegex = input.regex !== undefined;
  if (hasQuery && hasRegex) {
    throw invalidArgument(
      'search_entities takes either query or regex, not both',
      'search_entities({ type: "ac", query: "kaucja" }) for a phrase, ' +
        'search_entities({ type: "ac", regex: "kaucj\\\\w*" }) for a pattern',
    );
  }
  if (!hasQuery && !hasRegex) {
    throw invalidArgument(
      'search_entities requires query or regex',
      'search_entities({ type: "ac", query: "kaucja" }) or ' +
        'search_entities({ type: "ac", regex: "kaucj\\\\w*" })',
    );
  }
  if (hasRegex) {
    const pattern = input.regex ?? '';
    // Length BEFORE compilation: for a big enough pattern the compile is itself
    // the unbounded step, so a check after it has already paid the cost.
    assertPatternWithinLimit(pattern, 'search_entities');
    return matcherFor(compile(pattern, 'regex'), 'regex');
  }
  const phrase = (input.query ?? '').trim();
  if (!phrase) return null;
  return matcherFor(compile(escapeRegExp(phrase), 'query'), 'query');
}

function compile(source: string, kind: 'query' | 'regex'): RegExp {
  try {
    return new RegExp(source, 'gi');
  } catch (err) {
    throw invalidArgument(
      `invalid ${kind}: ${(err as Error).message}`,
      'pass a JavaScript regular expression body without delimiters, e.g. "^## M\\\\d+"',
    );
  }
}

function matcherFor(re: RegExp, kind: 'query' | 'regex'): EntityMatcher {
  return {
    kind,
    count: (value) => spansOf(re, value).length,
    spans: (value) => spansOf(re, value),
  };
}

/**
 * Non-overlapping matches, left to right, which is what makes `matchCount`
 * reproducible across calls.
 *
 * The `lastIndex` bump guards a pattern that can match the empty string (`x*`,
 * `(?:)`): without it the regex matches at every position without advancing and
 * the loop never ends — a hang introduced by the caller's pattern, which is
 * exactly what the barriers in `./guards.ts` exist to keep out.
 */
function spansOf(re: RegExp, value: string): Span[] {
  re.lastIndex = 0;
  const spans: Span[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
    if (match[0] === '') re.lastIndex += 1;
  }
  return spans;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Evidence ────────────────────────────────────────────────────────────────

/**
 * The `hits` rung: windows of the matched field values, addressed by field.
 *
 * "A fragment is an address, not a sample" — every hunk carries the name of the
 * field it came from, and that name is a legal `select` value for
 * `get_entities`, so a caller can always go back for the whole value. It is the
 * entity-side equivalent of a section anchor, which is why there is no line
 * number and no `context`: a field value has no line structure to count.
 */
function makeEvidenceBuilder(
  deps: DiscoveryDeps,
  type: string,
  fields: readonly SearchableField[],
  matcher: EntityMatcher,
): (raw: RawEntity | null | undefined) => { hunks: SearchEntityHunk[]; omittedChars: number } {
  const schema: Readonly<Record<string, FieldNode>> = safeSchema(deps, type);
  /**
   * The search path's first segment is the COLUMN name (`fields.ts` derives it
   * with `columnOf`), while `select` takes the PAYLOAD name. There is no inverse
   * of `columnOf`, so build one per call — `design_system_slug` → `designSystemSlug`.
   */
  const payloadNameOf = new Map(
    Object.entries(schema).map(([name, node]) => [columnOf(name, node), name] as const),
  );
  const selectable = new Set<string>([...IDENTITY_FIELDS, ...selectableFieldsOf(schema)]);
  /**
   * `contentBearing` fields are out of the EVIDENCE as of 0.2.95, not only out
   * of the default scan scope, so `hits` never issues content a plain
   * `get_entities` would withhold on the same entity.
   *
   * Enforced here rather than in `resolveSearchFields`, and that is the only
   * place it can be: an explicitly requested `fields` is taken verbatim (so the
   * echo in `searchedFields` cannot lie), which means a caller CAN name `body`.
   * `textPathsOfSchema` already keeps such a field out of the host default, so
   * the default path is guarded twice and the explicit path is guarded here. A
   * match in such a field still counts toward `matchCount`; in practice it
   * counts nothing at all, because the value does not live on the entity row
   * and `valuesAtPath` finds it absent. Do not "fix" that asymmetry — it is the
   * projection's boundary, not a bug in this function.
   */
  const contentBearing = new Set(contentFieldsOf(schema).map((f) => f.field));

  return (raw) => {
    if (!raw) return { hunks: [], omittedChars: 0 };
    const record = recordOf(raw);
    const hunks: SearchEntityHunk[] = [];
    let omittedChars = 0;

    for (const field of fields) {
      const name = selectNameOf(field.path, payloadNameOf, selectable);
      if (name === null || contentBearing.has(name)) continue;
      for (const value of valuesAtPath(record, field.path)) {
        for (const window of windowsOf(matcher.spans(value), value.length)) {
          const text = value.slice(window.start, window.end);
          if (hunks.length >= MAX_HUNKS_PER_HIT) {
            // Dropped, but never silently: the characters land in `omittedChars`.
            omittedChars += text.length;
            continue;
          }
          if (text.length > MAX_HUNK_CHARS) {
            omittedChars += text.length - MAX_HUNK_CHARS;
            hunks.push({ field: name, text: text.slice(0, MAX_HUNK_CHARS), matches: window.matches });
          } else {
            hunks.push({ field: name, text, matches: window.matches });
          }
        }
      }
    }
    return { hunks, omittedChars };
  };
}

/**
 * Character windows around each match, MERGED where they overlap or touch.
 *
 * No character is ever emitted twice: two matches 200 characters apart with a
 * 160-character radius are one window, not two windows sharing 120 characters.
 * Emitting them twice would spend the ceiling on a copy and make `omittedChars`
 * a lie about how much of the field the caller has actually seen. The `+ 1` in
 * the merge predicate joins ADJACENT windows too — a one-character gap between
 * two blocks is noise, not structure.
 */
function windowsOf(
  spans: readonly Span[],
  length: number,
): Array<{ start: number; end: number; matches: number }> {
  const windows: Array<{ start: number; end: number; matches: number }> = [];
  for (const span of spans) {
    const start = Math.max(span.start - HUNK_WINDOW_CHARS, 0);
    const end = Math.min(span.end + HUNK_WINDOW_CHARS, length);
    const last = windows[windows.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
      last.matches += 1;
    } else {
      windows.push({ start, end, matches: 1 });
    }
  }
  return windows;
}

/**
 * The field name a hunk publishes, or `null` when there is none to publish.
 *
 * A path whose head resolves to nothing selectable (`fields: ['nope.not_a_field']`,
 * taken verbatim by `resolveSearchFields`) yields NO hunk rather than a hunk
 * naming a key `get_entities` would reject — the contract is that the name works
 * as a `select` value. The path still appears in `searchedFields`: that echo is a
 * statement about what was consulted, and repairing it is what would make it lie.
 *
 * A nested path collapses to its top-level name (`fields[].description` →
 * `fields`), so several hunks of one hit may share a `field`. The shape is pinned
 * to exactly `{ field, text, matches }`, so there is no second key to carry the
 * rest of the path, and the hunk text shows which item matched.
 */
function selectNameOf(
  path: string,
  payloadNameOf: ReadonlyMap<string, string>,
  selectable: ReadonlySet<string>,
): string | null {
  const head = (path.split('.')[0] ?? '').replace(/\[\]$/, '');
  if (!head) return null;
  const name = payloadNameOf.get(head) ?? head;
  return selectable.has(name) ? name : null;
}

/**
 * Guarded like `hostDefaultFields` guards the same read: a manifest may expose
 * `data` as a throwing getter, and a broken type must degrade its evidence, not
 * fail the whole answer.
 */
function safeSchema(deps: DiscoveryDeps, type: string): Readonly<Record<string, FieldNode>> {
  try {
    return deps.host.getEntity(type)?.data?.schema ?? {};
  } catch {
    return {};
  }
}
