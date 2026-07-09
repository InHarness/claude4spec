import { describe, expect, it } from 'vitest';
import { pairRows } from './DiffView.js';

const keep = (content: string) => ({ op: 'keep' as const, content });
const added = (content: string) => ({ op: 'added' as const, content });
const removed = (content: string) => ({ op: 'removed' as const, content });

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
