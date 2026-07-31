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
  hasMore: boolean;
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
 */
export function paginate<T>(sorted: readonly T[], req: PageRequest, defaultLimit: number): Page<T> {
  const { limit, offset } = resolvePageRequest(req, defaultLimit);
  const items = sorted.slice(offset, offset + limit);
  return { items, total: sorted.length, hasMore: offset + items.length < sorted.length };
}
