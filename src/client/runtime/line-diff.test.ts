import { describe, expect, it } from 'vitest';
import { lineDiffHunks } from './line-diff.js';

describe('lineDiffHunks (M13/L11)', () => {
  it('[ac:ac-util-line-diff-wystawiony-przez-powierzc] emits the public L12 vocabulary, never the internal LineDiffLite shape', () => {
    const hunks = lineDiffHunks({ name: 'a' }, { name: 'b' });

    expect(hunks.length).toBeGreaterThan(0);
    for (const h of hunks) {
      expect(['add', 'del', 'ctx']).toContain(h.op);
      expect(typeof h.line).toBe('string');
      // The host-internal `{ op: 'keep'|'added'|'removed'; content }` must not leak.
      expect(h).not.toHaveProperty('content');
    }
  });

  it('marks every line as context when the two snapshots are identical', () => {
    const snapshot = { method: 'GET', path: '/things' };
    const hunks = lineDiffHunks(snapshot, snapshot);

    expect(hunks.every((h) => h.op === 'ctx')).toBe(true);
  });

  it('maps removed → del and added → add for a changed field', () => {
    const hunks = lineDiffHunks({ method: 'GET' }, { method: 'POST' });

    expect(hunks.filter((h) => h.op === 'del').map((h) => h.line)).toEqual([
      expect.stringContaining('GET'),
    ]);
    expect(hunks.filter((h) => h.op === 'add').map((h) => h.line)).toEqual([
      expect.stringContaining('POST'),
    ]);
  });

  it('accepts pre-stringified text as well as JSON snapshots', () => {
    expect(lineDiffHunks('one\ntwo', 'one\nthree')).toEqual([
      { op: 'ctx', line: 'one' },
      { op: 'del', line: 'two' },
      { op: 'add', line: 'three' },
    ]);
  });

  it('treats a missing snapshot as empty rather than throwing', () => {
    expect(() => lineDiffHunks(undefined, { a: 1 })).not.toThrow();
    expect(lineDiffHunks(undefined, undefined)).toEqual([]);
  });
});

describe('lineDiffHunks — markdown-noise filter is off', () => {
  it('reports an added blank line instead of silently dropping it', () => {
    // `computeLineDiffClient` drops blank/anchor-only added lines for markdown
    // PAGES. Over a snapshot every line is content, so dropping one would
    // report "no changes" for a change that happened.
    const hunks = lineDiffHunks('a\nb', 'a\n\nb');
    expect(hunks.some((h) => h.op === 'add' && h.line === '')).toBe(true);
  });

  it('reports an added anchor-only line', () => {
    const hunks = lineDiffHunks('# Title', '# Title\n<!-- anchor: abcd1234 -->');
    expect(hunks.some((h) => h.op === 'add' && h.line.includes('anchor: abcd1234'))).toBe(true);
  });
});
