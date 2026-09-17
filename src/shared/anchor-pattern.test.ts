import { describe, expect, it } from 'vitest';
import { ANCHOR_LINE_RE, ANCHOR_PATTERN_SOURCE } from './anchor-pattern.js';

function matchAnchor(input: string): RegExpExecArray | null {
  return new RegExp(ANCHOR_PATTERN_SOURCE).exec(input);
}

describe('ANCHOR_PATTERN_SOURCE', () => {
  it('matches an anchor comment with a 6-char slug and captures the slug', () => {
    const m = matchAnchor('<!-- anchor: abc123 -->');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('abc123');
  });

  it('matches a 12-char slug', () => {
    const m = matchAnchor('<!-- anchor: abcdef123456 -->');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('abcdef123456');
  });

  it('tolerates whitespace variants around the keyword and slug', () => {
    expect(matchAnchor('<!--anchor:kkz1e7d6-->')![1]).toBe('kkz1e7d6');
    expect(matchAnchor('<!--   anchor:   kkz1e7d6   -->')![1]).toBe('kkz1e7d6');
    expect(matchAnchor('<!--\tanchor:\tkkz1e7d6\t-->')![1]).toBe('kkz1e7d6');
  });

  it('rejects slugs shorter than 6 or longer than 12 characters', () => {
    expect(matchAnchor('<!-- anchor: abc12 -->')).toBeNull(); // 5 chars
    expect(matchAnchor('<!-- anchor: abcdef1234567 -->')).toBeNull(); // 13 chars
  });

  it('rejects uppercase letters and hyphens in the slug', () => {
    expect(matchAnchor('<!-- anchor: ABC123 -->')).toBeNull();
    expect(matchAnchor('<!-- anchor: abc-def -->')).toBeNull();
  });
});

describe('ANCHOR_LINE_RE', () => {
  it('matches a line that is only the anchor comment, surrounding whitespace allowed', () => {
    expect(ANCHOR_LINE_RE.exec('<!-- anchor: x7k2m9p4 -->')![1]).toBe('x7k2m9p4');
    expect(ANCHOR_LINE_RE.test('  <!-- anchor: x7k2m9p4 -->\t')).toBe(true);
  });

  it('rejects a line that carries anything besides the comment', () => {
    expect(ANCHOR_LINE_RE.test('see <!-- anchor: x7k2m9p4 -->')).toBe(false);
    expect(ANCHOR_LINE_RE.test('<!-- anchor: x7k2m9p4 --> ## Heading')).toBe(false);
  });

  it('agrees with the literal spec regex on the same inputs', () => {
    const spec = /^\s*<!--\s*anchor:\s*[a-z0-9]{6,12}\s*-->\s*$/;
    for (const line of ['<!-- anchor: abc123 -->', ' <!--anchor:abcdef123456--> ', '<!-- anchor: ABC123 -->', 'x <!-- anchor: abc123 -->', '<!-- anchor: abc12 -->']) {
      expect(ANCHOR_LINE_RE.test(line)).toBe(spec.test(line));
    }
  });
});
