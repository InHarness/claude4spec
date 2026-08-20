import { describe, expect, it } from 'vitest';
import {
  applyTextEdits,
  FindNotFoundError,
  MatchCountMismatchError,
  type PositionResolver,
} from './text-edits.js';

const SOURCE = ['# Title', '', 'alpha beta alpha', '', 'gamma delta', ''].join('\n');

describe('applyTextEdits — literal substitution', () => {
  it('substitutes a single hit and reports the count', () => {
    const res = applyTextEdits(SOURCE, [{ find: 'gamma', replaceWith: 'GAMMA' }]);
    expect(res.text).toContain('GAMMA delta');
    expect(res.replacements).toBe(1);
    expect(res.matchRanges).toHaveLength(1);
  });

  it('deletes the matched text when replaceWith is empty', () => {
    const res = applyTextEdits(SOURCE, [{ find: ' delta', replaceWith: '' }]);
    expect(res.text).toContain('gamma\n');
    expect(res.text).not.toContain('delta');
  });

  /**
   * The invisible default is the one thing a caller cannot read off the shape,
   * so it gets its own case: two hits under an omitted declaration is a refusal,
   * not a silent "both".
   */
  it('an omitted expectedMatches means exactly one — two hits is a mismatch', () => {
    expect(() => applyTextEdits(SOURCE, [{ find: 'alpha', replaceWith: 'x' }])).toThrow(
      MatchCountMismatchError,
    );
  });

  it('expectedMatches: "all" substitutes every hit without declaring a count', () => {
    const res = applyTextEdits(SOURCE, [{ find: 'alpha', replaceWith: 'x', expectedMatches: 'all' }]);
    expect(res.replacements).toBe(2);
    expect(res.text).toContain('x beta x');
  });

  it('an explicit count must match exactly', () => {
    expect(
      applyTextEdits(SOURCE, [{ find: 'alpha', replaceWith: 'x', expectedMatches: 2 }]).replacements,
    ).toBe(2);
    expect(() =>
      applyTextEdits(SOURCE, [{ find: 'alpha', replaceWith: 'x', expectedMatches: 3 }]),
    ).toThrow(MatchCountMismatchError);
  });

  /**
   * The batch is a SET: were it a sequence, the second pattern would find the
   * text the first one produced and the result would depend on the order.
   */
  it('counts every find against the text as it stood BEFORE the call', () => {
    const res = applyTextEdits('one two', [
      { find: 'one', replaceWith: 'two' },
      { find: 'two', replaceWith: 'three' },
    ]);
    expect(res.text).toBe('two three');
    expect(res.replacements).toBe(2);
  });

  it('is not idempotent — replaying a successful substitution finds nothing', () => {
    const once = applyTextEdits(SOURCE, [{ find: 'gamma', replaceWith: 'GAMMA' }]);
    expect(() => applyTextEdits(once.text, [{ find: 'gamma', replaceWith: 'GAMMA' }])).toThrow(
      FindNotFoundError,
    );
  });
});

describe('applyTextEdits — the refusals', () => {
  it('an empty batch is INVALID_ARGUMENT, not an empty write', () => {
    expect(() => applyTextEdits(SOURCE, [])).toThrow(/non-empty array/);
  });

  it('an empty find is INVALID_ARGUMENT — it would match everywhere', () => {
    expect(() => applyTextEdits(SOURCE, [{ find: '', replaceWith: 'x' }])).toThrow(/non-empty `find`/);
  });

  it('expectedMatches must be an integer >= 1 or "all"', () => {
    expect(() =>
      applyTextEdits(SOURCE, [{ find: 'gamma', replaceWith: 'x', expectedMatches: 0 }]),
    ).toThrow(/integer >= 1/);
  });

  it('overlapping matches are refused rather than given a precedence rule', () => {
    expect(() =>
      applyTextEdits('abcd', [
        { find: 'abc', replaceWith: 'X' },
        { find: 'cd', replaceWith: 'Y' },
      ]),
    ).toThrow(/overlap/);
  });

  it('a match nested inside another is refused on the same grounds', () => {
    expect(() =>
      applyTextEdits('alpha beta gamma', [
        { find: 'alpha beta gamma', replaceWith: 'X' },
        { find: 'beta', replaceWith: 'Y' },
      ]),
    ).toThrow(/overlap/);
  });

  /**
   * The single highest-value part of the refusal: a caller whose indentation is
   * off is told so, instead of concluding the text is not there.
   */
  it('FIND_NOT_FOUND carries the whitespace-normalization diagnosis', () => {
    try {
      applyTextEdits('  gamma   delta', [{ find: 'gamma delta', replaceWith: 'x' }]);
      expect.unreachable('should have refused');
    } catch (err) {
      expect(err).toBeInstanceOf(FindNotFoundError);
      const e = err as FindNotFoundError;
      expect(e.code).toBe('FIND_NOT_FOUND');
      expect(e.details[0]!.matchesAfterWhitespaceNormalization).toBe(1);
      expect(e.hint).toMatch(/whitespace/i);
    }
  });

  it('reports every missing pattern in one answer, not one round-trip each', () => {
    try {
      applyTextEdits(SOURCE, [
        { find: 'nope', replaceWith: 'x' },
        { find: 'also-nope', replaceWith: 'y' },
      ]);
      expect.unreachable('should have refused');
    } catch (err) {
      expect((err as FindNotFoundError).details.map((d) => d.find)).toEqual(['nope', 'also-nope']);
    }
  });

  /** Positions are somewhere a caller can go and look — never a byte offset. */
  it('MATCH_COUNT_MISMATCH reports positions as anchor + line', () => {
    const resolver: PositionResolver = (offset, text) => ({
      anchor: 'abcd1234',
      line: text.slice(0, offset).split('\n').length,
    });
    try {
      applyTextEdits(SOURCE, [{ find: 'alpha', replaceWith: 'x' }], resolver);
      expect.unreachable('should have refused');
    } catch (err) {
      const e = err as MatchCountMismatchError;
      expect(e.code).toBe('MATCH_COUNT_MISMATCH');
      expect(e.details[0]).toMatchObject({ expectedMatches: 1, actualMatches: 2 });
      expect(e.details[0]!.positions).toEqual([
        { anchor: 'abcd1234', line: 3 },
        { anchor: 'abcd1234', line: 3 },
      ]);
      expect(JSON.stringify(e.details)).not.toMatch(/offset/);
    }
  });
});
