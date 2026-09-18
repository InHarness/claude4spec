/**
 * M39 — response budget.
 *
 * Pagination bounds the HEIGHT of a result (how many rows); a budget bounds its
 * WIDTH (how big a row is allowed to get). `detail` × N is the case that needs
 * both: fifty rows is a reasonable page and fifty full entities is not a
 * reasonable payload.
 *
 * The rule is never a silent loss. Anything cut sets `truncated: true` and says
 * how to fetch the rest, because a consumer that cannot tell truncation from
 * absence will confidently report the missing part as non-existent.
 */

/** Characters of serialized JSON, not tokens — the core cannot see a tokenizer. */
export const DEFAULT_BUDGET_CHARS = 120_000;

/** `get_entities` refuses a slug list longer than this outright, rather than half-answering it. */
export const MAX_SLUGS_PER_CALL = 50;

/**
 * The same cap for `get_sections`, deliberately the same NUMBER.
 *
 * Both are "fetch by key" operations — the caller names the rows, so the height
 * of the result is its choice rather than the collection's, and neither
 * paginates. Two caps that disagreed would make one of them arbitrary, and an
 * agent that learned the limit from one would guess wrong at the other.
 */
export const MAX_ANCHORS_PER_CALL = 50;

/**
 * 0.2.84 — the ceiling on ITEMS a `get_sections` response carries, applied
 * AFTER `includeSubtree` has expanded the anchor list into one item per section
 * and BEFORE any body is read.
 *
 * The same number as `MAX_ANCHORS_PER_CALL`, and deliberately a different
 * constant: at the input the number is a REFUSAL (the caller can shorten the
 * list), after expansion it is a CUT (the caller cannot know which sections a
 * subtree holds, so "ask for fewer" would be unfollowable — the remedy is
 * `get_page_outline`). It is a property of `get_sections` only: `get_entities`
 * has no expansion, so it has no third valve.
 */
export const MAX_SECTION_ITEMS_PER_RESPONSE = 50;

/**
 * 0.2.95 — the regex LENGTH ceiling, shared by both search operations.
 *
 * A cost valve of a different kind from the ones above: they bound the answer,
 * this one bounds the QUESTION. Catastrophic backtracking grows exponentially in
 * the pattern, and a megabyte of alternation is paid for at COMPILE time, where
 * no time budget can interrupt it — so an over-long pattern is refused before it
 * is compiled rather than stopped while it runs.
 */
export const MAX_PATTERN_CHARS = 1_000;

/**
 * 0.2.95 — wall clock for ONE search run, checked between match units.
 *
 * The companion to the ceiling above, for the patterns short enough to accept
 * and slow enough to matter. "One match per line" is not itself a protection:
 * backtracking within a single line is already unbounded.
 */
export const SEARCH_TIME_BUDGET_MS = 5_000;

/**
 * 0.2.95 — the RADIUS, in characters, of the window a hunk shows around one
 * match on the entity side.
 *
 * A character count rather than a line count, and a core constant rather than a
 * parameter, because a field value has no line structure to count: there is no
 * `context` on `search_entities`. A caller who wants the whole value asks
 * `get_entities({ select: [field] })` — the hunk's `field` is exactly that key.
 */
export const HUNK_WINDOW_CHARS = 160;

/**
 * The character ceiling on ONE hunk, and therefore on one contiguous run of
 * context. Applied per block rather than per hit so a hit with three separate
 * matches shows all three, instead of spending its whole allowance on the first.
 *
 * 0.2.95 moved this here from `search/page-search.ts`: both search operations
 * now build hunks, and two ceilings that disagreed would make one arbitrary.
 */
export const MAX_HUNK_CHARS = 600;

/**
 * 0.2.95 — the ceiling on WINDOWS in one entity hit.
 *
 * `search_pages` needs no such cap: a section is small and its hunks are bounded
 * by it. A field value is not — one array field can hold two hundred matches
 * spread over forty kilobytes, and that hit, arriving first, is kept whole by
 * `fitToBudget` whatever it costs, so a single row would become the entire
 * response. Windows past this count are dropped into `omittedChars`, which is
 * what keeps the drop visible instead of silent.
 */
export const MAX_HUNKS_PER_HIT = 5;

export interface Budgeted<T> {
  items: T[];
  truncated: boolean;
  /** Set only when something was cut: how to fetch what is missing. */
  truncationHint?: string;
}

/**
 * Budget over items that must all be ANSWERED, even when they cannot all be
 * carried — the ONE branch behind both fetch-by-key operations, `get_sections`
 * and `get_entities`.
 *
 * 0.2.6 removed the alternative. There used to be a second function that DROPPED
 * what it could not afford, and `get_entities` used it: the caller named forty
 * slugs and got back thirty, with the missing ten indistinguishable from
 * entities that do not exist — the one confusion the whole error catalogue
 * exists to prevent. Dropping is right for a page the collection chose; it is
 * never right for keys the caller listed. So every item survives; the ones past
 * the line lose only their expensive half via `degrade`.
 *
 * The cut is positional and therefore deterministic: the same input order always
 * produces the same set of degraded items, which is what lets a caller retry
 * with a smaller subset and predict what it will get.
 *
 * The FIRST item is never degraded. A single-key call whose one payload exceeds
 * the budget would otherwise come back empty with no smaller subset left to ask
 * for — a dead end rather than an answer, and the retry instruction ("come back
 * with fewer keys") would be unfollowable. `get_sections` shortens that one body
 * as TEXT instead; `get_entities` keeps it whole, because half a serialized
 * entity is not a smaller entity, it is malformed data presented as a record.
 */
export function applyItemBudget<T>(
  items: readonly T[],
  degrade: (item: T) => T,
  hint: string,
  budgetChars = DEFAULT_BUDGET_CHARS,
): Budgeted<T> {
  const kept: T[] = [];
  let spent = 0;
  let cut = false;
  for (const item of items) {
    if (cut) {
      kept.push(degrade(item));
      continue;
    }
    const cost = JSON.stringify(item)?.length ?? 0;
    if (kept.length && spent + cost > budgetChars) {
      cut = true;
      kept.push(degrade(item));
      continue;
    }
    kept.push(item);
    spent += cost;
  }
  return cut ? { items: kept, truncated: true, truncationHint: hint } : { items: kept, truncated: false };
}

/**
 * Budget over items the COLLECTION chose, where dropping a row is honest —
 * `paginate`'s width cut, and the same cut over a window some other operation
 * sliced itself.
 *
 * The opposite half of `applyItemBudget`: there the caller named the keys, so
 * every one must be answered and the overflow loses only its expensive half.
 * Here the caller asked for "a window", and a shorter window is a truthful
 * answer to that — provided the operation SAYS the window was shortened, which
 * is the returned count's job.
 *
 * The FIRST item is kept whatever it costs, for the same reason as everywhere
 * else in this module: an empty answer identifies nothing and leaves no smaller
 * request to make.
 */
export function fitToBudget<T>(items: readonly T[], budgetChars = DEFAULT_BUDGET_CHARS): T[] {
  const kept: T[] = [];
  let spent = 0;
  for (const item of items) {
    const cost = JSON.stringify(item)?.length ?? 0;
    if (kept.length && spent + cost > budgetChars) break;
    kept.push(item);
    spent += cost;
  }
  return kept;
}

/** Same rule for one long string (a page body, a section body). */
export function truncateText(
  text: string,
  hint: string,
  budgetChars = DEFAULT_BUDGET_CHARS,
): { text: string; truncated: boolean; truncationHint?: string } {
  if (text.length <= budgetChars) return { text, truncated: false };
  return { text: text.slice(0, budgetChars), truncated: true, truncationHint: hint };
}
