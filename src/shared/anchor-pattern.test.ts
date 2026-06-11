import { describe, expect, it } from 'vitest';
import { ANCHOR_PATTERN_SOURCE } from './anchor-pattern.js';

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
