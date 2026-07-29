/**
 * 0.2.2 (brief item 9) — restore/index order is DECLARED by the module that knows
 * the constraint, not hardcoded by the host.
 *
 * The regression this closes: `ReleaseService.restoreSpec` and
 * `EntityIndexerService.indexAll` each carried their own literal array, and the two
 * had drifted — the restore list named four types and omitted `ac`,
 * `design-system` and `diagram` entirely, so a full-spec restore silently never
 * touched them.
 */

import { describe, expect, it, vi } from 'vitest';
import { topoSortModules, topoSortTypes } from './entity-order.js';

function mod(type: string, displayOrder = 10, dependsOn?: string[]) {
  return { type, displayOrder, ...(dependsOn ? { dependsOn } : {}) };
}

const before = (types: string[], a: string, b: string) => types.indexOf(a) < types.indexOf(b);

describe('topoSortModules', () => {
  it('places a dependency before its dependent', () => {
    const out = topoSortTypes([mod('endpoint', 1, ['dto']), mod('dto', 2)]);
    expect(before(out, 'dto', 'endpoint')).toBe(true);
  });

  it('derives "DTO before Endpoint" from the declaration, beating displayOrder', () => {
    // endpoint sorts first by displayOrder; the declared dependency must win.
    const out = topoSortTypes([mod('endpoint', 1, ['dto']), mod('dto', 99)]);
    expect(out).toEqual(['dto', 'endpoint']);
  });

  it('keeps every module — including the three the old restore array dropped', () => {
    const out = topoSortTypes([
      mod('endpoint', 1, ['dto']),
      mod('dto', 2),
      mod('ui-view', 3, ['design-system']),
      mod('design-system', 4),
      mod('ac', 5),
      mod('diagram', 6),
      mod('database-table', 7),
    ]);
    expect(out.sort()).toEqual(
      ['ac', 'database-table', 'design-system', 'diagram', 'dto', 'endpoint', 'ui-view'].sort(),
    );
  });

  it('honours a chain of dependencies', () => {
    const out = topoSortTypes([mod('c', 1, ['b']), mod('b', 2, ['a']), mod('a', 3)]);
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('is stable: equal-constraint modules order by displayOrder then type', () => {
    const out = topoSortTypes([mod('zeta', 5), mod('alpha', 5), mod('first', 1)]);
    expect(out).toEqual(['first', 'alpha', 'zeta']);
  });

  it('ignores a dependency on a type that is absent (unknown or deactivated)', () => {
    // Deactivating design-system must not strand ui-view — dependsOn is an
    // ordering hint, not referential integrity.
    const out = topoSortTypes([mod('ui-view', 1, ['design-system'])]);
    expect(out).toEqual(['ui-view']);
  });

  it('supports a plugin type the host has never heard of declaring a constraint', () => {
    const out = topoSortTypes([mod('spreadsheet', 1, ['database-table']), mod('database-table', 2)]);
    expect(out).toEqual(['database-table', 'spreadsheet']);
  });

  it('reports a cycle and still emits every module rather than dropping them', () => {
    const onCycle = vi.fn();
    const out = topoSortModules([mod('a', 1, ['b']), mod('b', 2, ['a'])], onCycle).map((m) => m.type);
    expect(onCycle).toHaveBeenCalledWith(expect.arrayContaining(['a', 'b']));
    // A misdeclared plugin degrades to "possibly wrong order", never to
    // "these entities vanish from restore".
    expect(out.sort()).toEqual(['a', 'b']);
  });

  it('emits the acyclic part correctly even when another pair cycles', () => {
    const out = topoSortModules(
      [mod('x', 1), mod('a', 2, ['b']), mod('b', 3, ['a'])],
      () => {},
    ).map((m) => m.type);
    expect(out[0]).toBe('x');
    expect(out.sort()).toEqual(['a', 'b', 'x']);
  });

  it('handles an empty list', () => {
    expect(topoSortTypes([])).toEqual([]);
  });
});
