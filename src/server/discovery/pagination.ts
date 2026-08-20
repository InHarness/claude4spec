/**
 * M39 — one pagination semantic for every listing operation.
 *
 * The rule the brief states as an implicit matrix: any operation returning a
 * list takes `limit`/`offset` and answers with `total` + `hasMore`, over a
 * STABLE sort. `total` is the count before slicing, so "there are more" is a
 * fact rather than an inference from a full page.
 *
 * The default limit is deliberately not infinity. Three of five failures in the
 * session that motivated this module were an unbounded response, not a wrong
 * one.
 */

import { fitToBudget } from './budget.js';
import { invalidArgument } from './errors.js';

/** Applied when a caller passes no `limit`. Per-operation, never global-∞. */
export const DEFAULT_LIMITS = {
  listPages: 100,
  listSections: 100,
  listEntities: 50,
  listTags: 200,
  /**
   * The tightest default in the core, deliberately. Every other operation here
   * pages over something already materialized — rows in a table, slugs in a
   * list. `search_pages` stands on no index at all: each call rereads the
   * markdown of every root in scope, line by line, with no cache between calls,
   * so its cost grows with the size of the corpus rather than with the size of
   * the answer. `rootId` is the only lever a caller has on that cost, and a
   * conservative default is the only one the core has.
   */
  searchPages: 20,
  searchEntities: 50,
  findReferences: 100,
  resolveIdentity: 20,
} as const;

/** The ceiling a caller may ask for, whatever it passes. */
export const MAX_LIMIT = 1000;

export interface PageRequest {
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  /** More rows exist past this window — a fact about PAGING. */
  hasMore: boolean;
  /**
   * 0.2.15 — the window was cut SHORT of the requested `limit` because the
   * response budget ran out.
   *
   * Distinct from `hasMore`, and both can be true at once. `hasMore` answers
   * "did you ask for a window of a larger set", which the caller usually knows;
   * `truncated` answers "did you get less than you asked for", which it cannot
   * know without being told — the alternative is a caller comparing
   * `items.length` against a `limit` it may have left defaulted.
   */
  truncated: boolean;
}

export function resolvePageRequest(
  req: PageRequest,
  defaultLimit: number,
): { limit: number; offset: number } {
  const limit = req.limit ?? defaultLimit;
  const offset = req.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1) {
    throw invalidArgument(
      `limit must be a positive integer (got ${String(req.limit)})`,
      `omit limit for the default of ${defaultLimit}, or pass 1..${MAX_LIMIT}`,
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw invalidArgument(
      `offset must be a non-negative integer (got ${String(req.offset)})`,
      'omit offset to start at 0',
    );
  }
  return { limit: Math.min(limit, MAX_LIMIT), offset };
}

/**
 * Slices an ALREADY-SORTED array. Sorting is the caller's job precisely because
 * a stable order is what makes `offset` meaningful — paginating an unsorted
 * list silently drops and repeats rows, so the sort cannot be an afterthought
 * hidden in here.
 *
 * 0.2.15 — the response BUDGET applies here too, not only to the fetch-by-key
 * operations.
 *
 * `limit` bounds the row COUNT, which is not the same as bounding the response:
 * 50 entities is a different size depending on what an entity carries, and the
 * budget is stated in characters precisely because the count does not predict
 * it. So the window is additionally cut at `DEFAULT_BUDGET_CHARS` of serialized
 * items, and `truncated` says so.
 *
 * The FIRST item is never dropped, matching `applyItemBudget`: answering with an
 * empty list because one row is enormous tells the caller nothing and gives it
 * nowhere to go. One oversized row plus `truncated: true` at least identifies
 * the row.
 *
 * 0.2.40 — the width cut itself lives in `fitToBudget`, so the release
 * projection can apply the identical rule to a window it slices itself without
 * re-deriving this loop (and drifting from it).
 */
export function paginate<T>(sorted: readonly T[], req: PageRequest, defaultLimit: number): Page<T> {
  const { limit, offset } = resolvePageRequest(req, defaultLimit);
  const requested = sorted.slice(offset, offset + limit);
  const items = fitToBudget(requested);

  return {
    items,
    total: sorted.length,
    hasMore: offset + items.length < sorted.length,
    truncated: items.length < requested.length,
  };
}
