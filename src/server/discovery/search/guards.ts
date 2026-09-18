/**
 * M39 — the two barriers every scanning operation shares, and the reason they
 * are a module rather than two lines in each search.
 *
 * `search_pages` and `search_entities` disagree about almost everything: one
 * matches a line, the other a whole field value; one refuses a pattern that
 * crosses a newline, the other accepts it as the point. What they have in common
 * is the COST of a hostile pattern, and that has nothing to do with either's unit
 * of matching — so it lives here, imported by both, and neither search module
 * imports the other.
 *
 * The rule "one match per line" was doing duty as a protection before 0.2.95 and
 * never was one: backtracking within a single line is already unbounded, and it
 * grows exponentially in the PATTERN, which no per-line rule bounds.
 */

import { MAX_PATTERN_CHARS, SEARCH_TIME_BUDGET_MS } from '../budget.js';
import { invalidArgument, searchBudgetExceeded } from '../errors.js';

/** The two operations that scan, so an error can key its navigation off one. */
export type SearchOperation = 'search_pages' | 'search_entities';

/**
 * Barrier 1 — the pattern LENGTH ceiling, and it must run before the pattern is
 * compiled.
 *
 * Compilation is itself the unbounded step for a big enough pattern, so a check
 * placed after it would be a guard that has already paid the cost it exists to
 * refuse. `message` quotes the boundary, because "too long" without the number
 * leaves the caller shortening by guesswork.
 */
export function assertPatternWithinLimit(pattern: string, operation: SearchOperation): void {
  if (pattern.length <= MAX_PATTERN_CHARS) return;
  throw invalidArgument(
    `regex is ${pattern.length} characters; ${operation} accepts at most ${MAX_PATTERN_CHARS}`,
    'shorten the pattern — a long alternation is almost always several narrower calls, ' +
      `e.g. ${operation}({ regex: "^(GET|POST) /v1/" }) rather than one branch per route`,
  );
}

export interface SearchBudget {
  /**
   * Throws `SEARCH_BUDGET_EXCEEDED` once the budget is spent.
   *
   * Call it BETWEEN match units — never inside the match of a single unit, where
   * there is no interruption point to take.
   */
  assertNotExhausted(): void;
}

/**
 * Barrier 2 — the wall clock on one run, for the patterns short enough to accept
 * and slow enough to matter.
 *
 * `now` is injectable for one reason only: a test must be able to trip the budget
 * without spending five seconds of the suite doing it. Nothing in production
 * passes it, and no transport exposes `budgetMs` — the caller's valves are the
 * scope (`--type`/`--fields`, `--root-id`/`--path-include`), never the clock. A
 * caller who could raise its own budget would just move the hang further out.
 */
export function startSearchBudget(
  operation: SearchOperation,
  budgetMs: number = SEARCH_TIME_BUDGET_MS,
  now: () => number = () => Date.now(),
): SearchBudget {
  const deadline = now() + budgetMs;
  return {
    assertNotExhausted() {
      if (now() >= deadline) throw searchBudgetExceeded(operation, budgetMs);
    },
  };
}
