import { describe, expect, it } from 'vitest';
import { visibleGroups } from './GroupedEntityList.js';

const g = (key: string, items: string[]) => ({ key, label: key, items });

describe('visibleGroups', () => {
  it('skips an empty group when the caller supplies nothing to draw inside one', () => {
    expect(visibleGroups([g('a', ['x']), g('b', [])], undefined).map((x) => x.key)).toEqual(['a']);
  });

  it('keeps an empty group once the caller supplies a state for it', () => {
    expect(visibleGroups([g('a', ['x']), g('b', [])], 'none yet').map((x) => x.key)).toEqual([
      'a',
      'b',
    ]);
  });

  /**
   * The empty string is a legitimate thing to render and must not be read as
   * "not supplied" — `undefined` is the only absence. A truthiness check here
   * would silently drop every empty group for a caller passing `''`.
   */
  it('treats an empty-string state as supplied, not as absent', () => {
    expect(visibleGroups([g('b', [])], '')).toHaveLength(1);
  });

  it('preserves the order the caller formed the groups in', () => {
    const out = visibleGroups([g('z', ['1']), g('a', ['2']), g('m', ['3'])], undefined);
    expect(out.map((x) => x.key)).toEqual(['z', 'a', 'm']);
  });
});
