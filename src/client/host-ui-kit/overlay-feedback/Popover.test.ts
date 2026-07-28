import { describe, expect, it } from 'vitest';
import { clampToViewport } from './Popover.js';

const VIEWPORT = { width: 1000, height: 800 };

/**
 * Clamping belongs to the catalog component — the host facade passes raw
 * coordinates straight through — so it is tested here rather than at any of the
 * call sites that used to own a copy of this arithmetic.
 */
describe('Popover clampToViewport (M34/L12)', () => {
  it('leaves a position that already fits untouched', () => {
    expect(clampToViewport(100, 200, 320, 180, VIEWPORT)).toEqual({ left: 100, top: 200 });
  });

  it('pulls a panel overflowing the right/bottom edges back inside, with 8px to spare', () => {
    expect(clampToViewport(900, 700, 320, 180, VIEWPORT)).toEqual({
      left: 1000 - 320 - 8,
      top: 800 - 180 - 8,
    });
  });

  it('keeps the 8px pad on the left/top edges for negative coordinates', () => {
    expect(clampToViewport(-50, -20, 320, 180, VIEWPORT)).toEqual({ left: 8, top: 8 });
  });

  it('prefers the near edge when the panel is larger than the viewport', () => {
    // Both bounds cross; the lower bound wins, so the panel stays reachable
    // from the top-left rather than being pushed off-screen entirely.
    expect(clampToViewport(0, 0, 2000, 2000, VIEWPORT)).toEqual({ left: 8, top: 8 });
  });
});
