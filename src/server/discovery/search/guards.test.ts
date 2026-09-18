/**
 * 0.2.95 — the two barriers both search operations share.
 *
 * Tested here rather than through either operation because they belong to
 * NEITHER: a pattern's cost has nothing to do with whether the unit of matching
 * is a line or a field value. The end-to-end halves — that `search_pages` and
 * `search_entities` actually consult them — live with each operation's contract.
 */

import { describe, expect, it } from 'vitest';

import { MAX_PATTERN_CHARS, SEARCH_TIME_BUDGET_MS } from '../budget.js';
import { isDiscoveryError } from '../errors.js';
import { assertPatternWithinLimit, startSearchBudget } from './guards.js';

function refusal(fn: () => void): { code: string; message: string; hint: string } {
  try {
    fn();
  } catch (err) {
    if (!isDiscoveryError(err)) throw err;
    return { code: err.code, message: err.message, hint: err.hint };
  }
  throw new Error('expected a refusal');
}

describe('search guards: the pattern-length ceiling', () => {
  it('[ac:ac-wzorzec-regex-dluzszy-niz-limit-dlugo] accepts a pattern AT the limit and refuses the one past it', () => {
    // The boundary itself, from both sides: an off-by-one here is a valve that
    // either rejects legitimate patterns or lets the pathological one through.
    expect(() => assertPatternWithinLimit('a'.repeat(MAX_PATTERN_CHARS), 'search_pages')).not.toThrow();
    const err = refusal(() => assertPatternWithinLimit('a'.repeat(MAX_PATTERN_CHARS + 1), 'search_pages'));
    expect(err.code).toBe('INVALID_ARGUMENT');
    // The BOUNDARY in the message, not just "too long": without the number the
    // caller shortens by guesswork.
    expect(err.message).toContain(String(MAX_PATTERN_CHARS));
    expect(err.message).toContain(String(MAX_PATTERN_CHARS + 1));
  });

  it('[ac:ac-wzorzec-regex-dluzszy-niz-limit-dlugo] refuses identically for both operations, naming the one it refused for', () => {
    for (const operation of ['search_pages', 'search_entities'] as const) {
      const err = refusal(() => assertPatternWithinLimit('a'.repeat(MAX_PATTERN_CHARS + 1), operation));
      expect(err.code).toBe('INVALID_ARGUMENT');
      expect(err.message).toContain(operation);
      expect(err.message).toContain(String(MAX_PATTERN_CHARS));
    }
  });
});

describe('search guards: the time budget', () => {
  /** A clock the test drives, so tripping the budget costs no wall time. */
  function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
    let t = start;
    return { now: () => t, advance: (ms) => void (t += ms) };
  }

  it('stays quiet while the budget holds', () => {
    const c = clock();
    const budget = startSearchBudget('search_entities', 100, c.now);
    c.advance(99);
    expect(() => budget.assertNotExhausted()).not.toThrow();
  });

  it('[ac:ac-przebieg-wyszukiwania-ktory-wyczerpie] answers SEARCH_BUDGET_EXCEEDED, never INVALID_ARGUMENT', () => {
    const c = clock();
    const budget = startSearchBudget('search_entities', 100, c.now);
    c.advance(100);
    const err = refusal(() => budget.assertNotExhausted());
    // The distinction the code exists for: the pattern was VALID, so an argument
    // error would send the caller to fix the one thing that was right.
    expect(err.code).toBe('SEARCH_BUDGET_EXCEEDED');
    expect(err.code).not.toBe('INVALID_ARGUMENT');
  });

  it('[ac:ac-przebieg-wyszukiwania-ktory-wyczerpie] names the narrowing valves of the operation that ran', () => {
    const c = clock();
    const entities = startSearchBudget('search_entities', 0, c.now);
    const entityErr = refusal(() => entities.assertNotExhausted());
    expect(entityErr.message).toContain('--type');
    expect(entityErr.message).toContain('--fields');

    const pages = startSearchBudget('search_pages', 0, c.now);
    const pageErr = refusal(() => pages.assertNotExhausted());
    expect(pageErr.message).toContain('--root-id');
    expect(pageErr.message).toContain('--path-include');

    // Every refusal in this catalogue owes navigation, and a budget error's
    // navigation is the narrower CALL — not a restatement of the refusal.
    expect(entityErr.hint).toContain('search_entities({');
    expect(pageErr.hint).toContain('search_pages({');
  });

  it('defaults to the core constant when no override is passed', () => {
    const c = clock();
    const budget = startSearchBudget('search_pages', undefined, c.now);
    c.advance(SEARCH_TIME_BUDGET_MS - 1);
    expect(() => budget.assertNotExhausted()).not.toThrow();
    c.advance(1);
    expect(refusal(() => budget.assertNotExhausted()).code).toBe('SEARCH_BUDGET_EXCEEDED');
  });
});
