import { describe, expect, it } from 'vitest';
import { normalizeHunks, pairRows } from './DiffView.js';

// The PUBLIC L12 vocabulary (`add`/`del`/`ctx` + `line`), not the host-internal
// `LineDiffLite` shape — see `DiffViewLine`.
const keep = (line: string) => ({ op: 'ctx' as const, line });
const added = (line: string) => ({ op: 'add' as const, line });
const removed = (line: string) => ({ op: 'del' as const, line });

describe('pairRows', () => {
  it('pairs a keep line onto the same row on both sides', () => {
    expect(pairRows([keep('a')])).toEqual([{ left: keep('a'), right: keep('a') }]);
  });

  it('pads the shorter side of a change block with null instead of shifting rows', () => {
    const rows = pairRows([added('x'), added('y'), keep('z')]);
    expect(rows).toEqual([
      { left: null, right: added('x') },
      { left: null, right: added('y') },
      { left: keep('z'), right: keep('z') },
    ]);
  });

  it('does not cross-pair lines from separate change blocks (the misalignment bug)', () => {
    // removed+keep+added, each in its own block — independently filtering
    // (drop 'added' on the left / 'removed' on the right) would previously
    // put 'removed' and 'keep' on row 0 and 'keep' and 'added' on row 1,
    // silently pairing unrelated lines. Pairing by block keeps them apart.
    const rows = pairRows([removed('old'), keep('same'), added('new')]);
    expect(rows).toEqual([
      { left: removed('old'), right: null },
      { left: keep('same'), right: keep('same') },
      { left: null, right: added('new') },
    ]);
  });

  it('zips a mixed change block row-by-row in original order, padding the shorter side', () => {
    const rows = pairRows([removed('r1'), added('a1'), added('a2'), keep('k')]);
    expect(rows).toEqual([
      { left: removed('r1'), right: added('a1') },
      { left: null, right: added('a2') },
      { left: keep('k'), right: keep('k') },
    ]);
  });

  it('returns an empty array for an empty hunk list', () => {
    expect(pairRows([])).toEqual([]);
  });
});

describe('normalizeHunks — pre-0.1.143 compatibility', () => {
  it('translates the legacy LineDiffLite vocabulary instead of rendering nonsense', () => {
    // What a plugin compiled against the old `.d.ts` still passes at runtime.
    const legacy = [
      { op: 'keep' as const, content: 'same' },
      { op: 'removed' as const, content: 'old' },
      { op: 'added' as const, content: 'new' },
    ];

    expect(normalizeHunks(legacy)).toEqual([
      { op: 'ctx', line: 'same' },
      { op: 'del', line: 'old' },
      { op: 'add', line: 'new' },
    ]);
  });

  it('passes current-vocabulary hunks through untouched', () => {
    const current = [
      { op: 'ctx' as const, line: 'same' },
      { op: 'add' as const, line: 'new' },
    ];
    expect(normalizeHunks(current)).toEqual(current);
  });

  it('keeps an unchanged legacy diff all-context (the silent-corruption case)', () => {
    // Untranslated, every line would fall through `pairRows` as a change and
    // render as a blank green addition.
    const rows = pairRows(normalizeHunks([{ op: 'keep' as const, content: 'a' }]));
    expect(rows).toEqual([{ left: { op: 'ctx', line: 'a' }, right: { op: 'ctx', line: 'a' } }]);
  });
});
