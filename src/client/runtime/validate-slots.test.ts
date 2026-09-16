// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { FrontendModule } from '../core/plugin-host/types.js';
import { chipSmokeTest } from './validate-slots.js';

/**
 * 0.2.88 — the browser-side smoke test renders `renderChip` once with
 * `entity: null` and rejects the SLOT that throws — not the module. Cards and
 * rows are not rendered (a card with no injected entity fetches its own, a
 * row's contract is a non-null entity).
 */
const okSlot = ({ slug }: { slug: string }) => createElement('span', null, slug);
const throwingSlot = () => {
  throw new Error('needs an editor');
};

function moduleWith(slots: Partial<Pick<FrontendModule, 'renderChip' | 'renderCard' | 'renderRow'>>): FrontendModule {
  return {
    type: 'thing',
    renderChip: okSlot,
    renderCard: okSlot,
    ...slots,
  } as unknown as FrontendModule;
}

describe('chipSmokeTest', () => {
  it('passes a module whose chip renders with a null entity', () => {
    expect(chipSmokeTest(moduleWith({}))).toEqual({ rejected: [] });
  });

  it('rejects only the slot that threw, naming it and the reason', () => {
    const result = chipSmokeTest(moduleWith({ renderChip: throwingSlot as never }));
    expect(result.rejected).toEqual([
      { slot: 'renderChip', reason: expect.stringContaining('needs an editor') },
    ]);
  });

  it('does not render renderCard or renderRow — a throwing card or row is not a rejection here', () => {
    const result = chipSmokeTest(moduleWith({ renderCard: throwingSlot as never, renderRow: throwingSlot as never }));
    expect(result.rejected).toEqual([]);
  });
});
