import { describe, expect, it } from 'vitest';
import { groupByType } from './group-by-type.js';

const TYPES = [
  { slug: 'spec', name: 'Specification', description: 'd' },
  { slug: 'writing-style', name: 'Writing Style', description: 'd' },
  { slug: 'skill', name: 'Skill', description: 'd' },
];

type Item = { id: string; type?: string };
const byType = (i: Item) => i.type;

describe('groupByType (2.1.86, M31 / M52)', () => {
  it('orders the known groups by the type list, never re-sorting it, headed by the type name', () => {
    const items: Item[] = [
      { id: 'a', type: 'skill' },
      { id: 'b', type: 'spec' },
      { id: 'c', type: 'writing-style' },
      { id: 'd', type: 'spec' },
    ];
    const g = groupByType(items, byType, TYPES);
    expect(g.known.map((k) => [k.name, k.items.map((i) => i.id)])).toEqual([
      ['Specification', ['b', 'd']],
      ['Writing Style', ['c']],
      ['Skill', ['a']],
    ]);
    // The array order is the order — a reversed list reverses the groups.
    expect(groupByType(items, byType, [...TYPES].reverse()).known.map((k) => k.slug)).toEqual([
      'skill',
      'writing-style',
      'spec',
    ]);
  });

  it('gives a type with no item no group', () => {
    const g = groupByType([{ id: 'a', type: 'skill' }], byType, TYPES);
    expect(g.known.map((k) => k.slug)).toEqual(['skill']);
  });

  it('puts unknown slugs after the known groups, one group per slug, alphabetically, headed by the slug', () => {
    const g = groupByType(
      [
        { id: 'a', type: 'zeta-type' },
        { id: 'b', type: 'spec' },
        { id: 'c', type: 'alpha-type' },
        { id: 'd', type: 'zeta-type' },
      ],
      byType,
      TYPES,
    );
    expect(g.known.map((k) => k.slug)).toEqual(['spec']);
    expect(g.unknown).toEqual([
      { slug: 'alpha-type', items: [{ id: 'c', type: 'alpha-type' }] },
      {
        slug: 'zeta-type',
        items: [
          { id: 'a', type: 'zeta-type' },
          { id: 'd', type: 'zeta-type' },
        ],
      },
    ]);
  });

  it('collects the items with no type apart, in their order', () => {
    const g = groupByType([{ id: 'a' }, { id: 'b', type: 'skill' }, { id: 'c' }], byType, TYPES);
    expect(g.untyped.map((i) => i.id)).toEqual(['a', 'c']);
    expect(g.known.map((k) => k.slug)).toEqual(['skill']);
    expect(g.unknown).toEqual([]);
  });
});
