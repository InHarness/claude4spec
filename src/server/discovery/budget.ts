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
