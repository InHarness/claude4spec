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
 * Keeps whole items until the budget is spent. Items are never partially
 * serialized — half an entity looks like a complete entity that is missing
 * fields, which is worse than a smaller page.
 */
export function applyBudget<T>(
  items: readonly T[],
  hint: string,
  budgetChars = DEFAULT_BUDGET_CHARS,
): Budgeted<T> {
  const kept: T[] = [];
  let spent = 0;
  for (const item of items) {
    const cost = JSON.stringify(item)?.length ?? 0;
    // The first item always goes in: a single item over budget still has to be
    // answerable, or the operation degenerates to "no" with no way forward.
    if (kept.length && spent + cost > budgetChars) {
      return {
        items: kept,
        truncated: true,
        truncationHint: hint,
      };
    }
    kept.push(item);
    spent += cost;
  }
  return { items: kept, truncated: false };
}

/**
 * Budget over items that must all be ANSWERED, even when they cannot all be
 * carried — `get_sections`.
 *
 * `applyBudget` drops what it cannot afford, which is right when the caller
 * chose a page and the tail is fetchable by asking for the next one. It is wrong
 * here: the caller named these anchors, so a dropped item reads as "that anchor
 * does not exist" — the one confusion the whole error catalogue exists to
 * prevent. So every item survives; the ones past the line lose only their
 * expensive half via `degrade`.
 *
 * The cut is positional and therefore deterministic: the same input order always
 * produces the same set of degraded items, which is what lets a caller retry
 * with a smaller subset and predict what it will get.
 *
 * The FIRST item is never degraded — `applyBudget` makes the same exception, for
 * the same reason. A single-anchor call whose one body exceeds the budget would
 * otherwise come back with no body at all and no smaller subset left to ask for:
 * a dead end rather than an answer. Its caller truncates that one body instead.
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

/** Same rule for one long string (a page body, a section body). */
export function truncateText(
  text: string,
  hint: string,
  budgetChars = DEFAULT_BUDGET_CHARS,
): { text: string; truncated: boolean; truncationHint?: string } {
  if (text.length <= budgetChars) return { text, truncated: false };
  return { text: text.slice(0, budgetChars), truncated: true, truncationHint: hint };
}
