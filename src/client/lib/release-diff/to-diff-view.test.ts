import { describe, expect, it } from 'vitest';
import { toDiffViewHunks } from './to-diff-view.js';

describe('toDiffViewHunks — M17 line-diff adapter (M34/L12)', () => {
  it('[ac:ac-line-diff-w-c4s-ma-jedna-implementacje-r] maps the M17 hunk dictionary onto the catalog one', () => {
    expect(
      toDiffViewHunks({
        lines: [
          { op: 'keep', content: 'unchanged' },
          { op: 'added', content: 'new line' },
          { op: 'removed', content: 'gone' },
        ],
      }),
    ).toEqual([
      { op: 'ctx', line: 'unchanged' },
      { op: 'add', line: 'new line' },
      { op: 'del', line: 'gone' },
    ]);
  });

  it('preserves order and empty lines rather than filtering them', () => {
    const hunks = toDiffViewHunks({
      lines: [
        { op: 'removed', content: '' },
        { op: 'keep', content: '' },
        { op: 'added', content: 'x' },
      ],
    });
    expect(hunks.map((h) => h.op)).toEqual(['del', 'ctx', 'add']);
    expect(hunks.map((h) => h.line)).toEqual(['', '', 'x']);
  });

  it('maps an empty diff to an empty hunk list', () => {
    expect(toDiffViewHunks({ lines: [] })).toEqual([]);
  });
});
