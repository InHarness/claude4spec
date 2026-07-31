/**
 * 0.2.4 pins search ranking as a fixed ORDER RELATION rather than a set of
 * magic constants:
 *
 *     exact hit > prefix > earlier substring position > slug ascending
 *
 * The numbers in `relevance` exist only to realise it. These tests assert the
 * relation, so a future re-tuning of the constants is free as long as the order
 * survives — and caught the moment it does not.
 */

import { describe, expect, it } from 'vitest';
import { compareRanked, relevance, sortRanked } from './ranking.js';

const score = (query: string, text: string, weight?: number) => relevance(query, [text], weight);

describe('search ranking — the order relation', () => {
  it('ranks exact above prefix above later position', () => {
    const exact = score('user', 'user');
    const prefix = score('user', 'user profile');
    const early = score('user', 'a user profile');
    const late = score('user', 'the record describing one user');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(early);
    expect(early).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(0);
  });

  it('matches on a substring after trim + lowercase on BOTH sides', () => {
    expect(score('USER', 'the user record')).toBeGreaterThan(0);
    expect(score('  user  ', 'User')).toBe(score('user', 'user'));
    // The haystack is trimmed too, so leading whitespace does not demote a hit
    // to "position 3" — that would rank a padded exact match below a prefix.
    expect(score('user', '   user')).toBe(score('user', 'user'));
  });

  it('returns zero hits for an empty query rather than everything', () => {
    expect(score('', 'anything at all')).toBe(0);
    expect(score('   ', 'anything at all')).toBe(0);
  });

  /**
   * A multi-word query works ONLY as an exact phrase. There is no tokenization
   * in the core and there will not be until there is a content index to
   * tokenize against — so this is a recorded limit, not a bug.
   */
  it('treats a multi-word query as a phrase, never as separate terms', () => {
    expect(score('user profile', 'the user profile page')).toBeGreaterThan(0);
    expect(score('user profile', 'profile of the user')).toBe(0);
  });

  /**
   * The tie-break is what keeps `offset` honest: without it, two equally-scored
   * hits can swap between calls, so page 2 re-serves a row page 1 delivered and
   * silently drops another.
   */
  it('breaks ties by key ascending, so paging never loses or repeats a row', () => {
    const hits = [
      { score: 10, key: 'charlie' },
      { score: 10, key: 'alpha' },
      { score: 10, key: 'bravo' },
    ];
    expect(sortRanked([...hits]).map((h) => h.key)).toEqual(['alpha', 'bravo', 'charlie']);
    // Deterministic across a shuffle: the same input set always yields the same
    // page boundaries.
    expect(sortRanked([...hits].reverse()).map((h) => h.key)).toEqual(['alpha', 'bravo', 'charlie']);
    expect(compareRanked({ score: 5, key: 'z' }, { score: 4, key: 'a' })).toBeLessThan(0);
  });

  it('applies the identity weight as a multiplier over the relation', () => {
    // The boost is per-field by design: matching `user` in a name should beat
    // matching it in paragraph nine of a description.
    expect(score('user', 'a user profile', 3)).toBeGreaterThan(score('user', 'a user profile', 1));
  });
});
