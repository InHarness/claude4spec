import { describe, expect, it } from 'vitest';
import { paginate, DEFAULT_LIMITS } from './pagination.js';
import { DEFAULT_BUDGET_CHARS } from './budget.js';

/**
 * 0.2.15 (M39) — the response budget covers EVERY collection operation, not only
 * the three fetch-by-key ones, and a cut is announced rather than deduced.
 *
 * The rule these pin: a caller must be able to tell "that is all of it" from
 * "that is what fitted". Before this, the only signal a list had was `hasMore`,
 * which answers a different question — whether a LARGER SET exists past the
 * window — and is false for a window that was itself cut short by size.
 */
describe('paginate — the row budget', () => {
  const small = Array.from({ length: 10 }, (_, i) => ({ id: i, text: 'x' }));

  it('reports truncated: false when the whole window fitted', () => {
    const page = paginate(small, { limit: 5 }, 100);
    expect(page.items).toHaveLength(5);
    expect(page.truncated).toBe(false);
    // …and `hasMore` is still true, because five more rows exist. The two are
    // independent facts and this is the case that separates them.
    expect(page.hasMore).toBe(true);
  });

  it('cuts the window at the character budget and says so', () => {
    // Rows big enough that three of them exceed the budget: the count limit is
    // satisfiable and the SIZE limit is not, which is the whole reason the
    // budget is stated in characters rather than in rows.
    const fat = Array.from({ length: 3 }, (_, i) => ({ id: i, blob: 'z'.repeat(DEFAULT_BUDGET_CHARS / 2) }));
    const page = paginate(fat, { limit: 3 }, 10);

    expect(page.items.length).toBeLessThan(3);
    expect(page.truncated).toBe(true);
    // `total` still describes the whole set — the cut narrows the window, never
    // the count, so a caller can see how much it did not get.
    expect(page.total).toBe(3);
  });

  it('never drops the FIRST row, however large it is', () => {
    /**
     * An empty list plus a flag tells the caller nothing and gives it nowhere to
     * go: it cannot even name the row that blew the budget. One oversized row
     * plus `truncated: true` at least identifies it. Same rule as
     * `applyItemBudget`.
     */
    const huge = [{ id: 1, blob: 'z'.repeat(DEFAULT_BUDGET_CHARS * 3) }, { id: 2, blob: 'small' }];
    const page = paginate(huge, { limit: 2 }, 10);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.id).toBe(1);
    expect(page.truncated).toBe(true);
  });

  it('every list operation shares this one implementation, so none can forget the flag', () => {
    // The defaults exist per operation; the budget does not. A second budget
    // implementation is how `check_consistency` ended up cutting silently while
    // `get_sections` announced it.
    for (const limit of Object.values(DEFAULT_LIMITS)) {
      expect(paginate(small, {}, limit).truncated).toBe(false);
    }
  });
});
