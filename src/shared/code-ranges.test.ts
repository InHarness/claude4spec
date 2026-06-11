import { describe, expect, it } from 'vitest';
import {
  computeCodeRanges,
  findInlineCodeSpans,
  intersectsCode,
  scanFences,
} from './code-ranges.js';

describe('scanFences', () => {
  it('detects a closed backtick fence and the surrounding gaps', () => {
    const text = 'before\n```\ncode here\n```\nafter';
    const { fenced, gaps } = scanFences(text);
    expect(fenced).toHaveLength(1);
    const [start, end] = fenced[0]!;
    expect(text.slice(start, end)).toBe('```\ncode here\n```');
    expect(gaps).toHaveLength(2);
    expect(text.slice(...gaps[0]!)).toBe('before\n');
    expect(text.slice(...gaps[1]!)).toBe('after');
  });

  it('detects tilde fences', () => {
    const text = '~~~\ntilde code\n~~~\ntail';
    const { fenced, gaps } = scanFences(text);
    expect(fenced).toHaveLength(1);
    expect(text.slice(...fenced[0]!)).toBe('~~~\ntilde code\n~~~');
    expect(gaps).toHaveLength(1);
    expect(text.slice(...gaps[0]!)).toBe('tail');
  });

  it('requires the closing run to be at least as long as the opening run', () => {
    // ``` cannot close a ```` fence, but ````` can.
    const text = '````\ncode\n```\nstill code\n`````\nout';
    const { fenced } = scanFences(text);
    expect(fenced).toHaveLength(1);
    expect(text.slice(...fenced[0]!)).toBe('````\ncode\n```\nstill code\n`````');
  });

  it('extends an unclosed fence to the end of the input', () => {
    const text = 'intro\n```\nnever closed';
    const { fenced, gaps } = scanFences(text);
    expect(fenced).toEqual([[text.indexOf('```'), text.length]]);
    expect(gaps).toHaveLength(1);
    expect(text.slice(...gaps[0]!)).toBe('intro\n');
  });
});

describe('findInlineCodeSpans', () => {
  it('matches a backtick run only with a closing run of the same length', () => {
    // Double-backtick delimiters let a single backtick live inside the span.
    const text = 'a `` x ` y `` b';
    const spans = findInlineCodeSpans(text, [[0, text.length]]);
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(text.slice(span.start, span.end)).toBe('`` x ` y ``');
    expect(text.slice(span.innerStart, span.innerEnd)).toBe(' x ` y ');
  });

  it('treats unmatched backtick runs as literal text', () => {
    const text = 'lonely `` run without partner';
    expect(findInlineCodeSpans(text, [[0, text.length]])).toEqual([]);
  });
});

describe('computeCodeRanges + intersectsCode', () => {
  it('combines fences and inline spans into sorted ranges', () => {
    const text = '`inline`\n```\nfence\n```';
    const ranges = computeCodeRanges(text);
    expect(ranges).toHaveLength(2);
    expect(text.slice(...ranges[0]!)).toBe('`inline`');
    expect(text.slice(...ranges[1]!)).toBe('```\nfence\n```');
  });

  it('uses half-open interval semantics for overlap checks', () => {
    const ranges: Array<[number, number]> = [[5, 10]];
    // Touching at the boundaries does not overlap.
    expect(intersectsCode(0, 5, ranges)).toBe(false);
    expect(intersectsCode(10, 15, ranges)).toBe(false);
    // Crossing a boundary by one char overlaps.
    expect(intersectsCode(0, 6, ranges)).toBe(true);
    expect(intersectsCode(9, 15, ranges)).toBe(true);
    // Fully inside overlaps.
    expect(intersectsCode(6, 9, ranges)).toBe(true);
  });
});
