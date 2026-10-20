import { describe, expect, it } from 'vitest';
import { collectRefFields, honouredRefNodes, refTargetsOf } from './ref-fields.js';
import type { FieldNode } from './data-schema.js';

const ref = (target: string): FieldNode => ({ type: 'string', ref: target, onMissing: 'warn', onDelete: 'leave-dangling' });

/** The shipped shapes: ui-view, endpoint, database-table, ac — all in allowed places. */
const SHIPPED: Record<string, FieldNode> = {
  designSystemSlug: ref('design-system'),
  linkedDtos: {
    type: 'collection',
    collection: 'value',
    keyFields: ['dto'],
    item: { type: 'object', fields: { dto: ref('dto'), relation: { type: 'enum', values: ['request'] } } },
  },
  columns: {
    type: 'collection',
    collection: 'value',
    item: {
      type: 'object',
      fields: { name: { type: 'string' }, fk: { type: 'object', fields: { table: ref('database-table'), column: { type: 'string' } } } },
    },
  },
  verifies: {
    type: 'collection',
    collection: { kind: 'value', identity: ['type', 'slug'] },
    item: { type: 'object', fields: { type: { type: 'string' }, slug: ref('$type') } },
  },
};

describe('collectRefFields — the one walk over ref flags (2.1.41)', () => {
  it('honours a top-level scalar and a scalar of a value-collection element, nested objects inside it included', () => {
    const walk = collectRefFields(SHIPPED);
    expect(walk.refs.map((s) => [s.path, s.target])).toEqual([
      ['designSystemSlug', 'design-system'],
      ['linkedDtos[].dto', 'dto'],
      ['columns[].fk.table', 'database-table'],
    ]);
    expect(walk.misplaced).toEqual([]);
  });

  it('reports ac.verifies[] as the polymorphic exception, not as a ref and not as misplaced', () => {
    const walk = collectRefFields(SHIPPED);
    expect(walk.polymorphic.map((s) => s.path)).toEqual(['verifies[].slug']);
    expect(walk.refs.map((s) => s.target)).not.toContain('$type');
  });

  it('marks the four forbidden places as misplaced, and honours none of them', () => {
    const schema: Record<string, FieldNode> = {
      nested: { type: 'object', fields: { target: ref('x') } },
      aliases: { type: 'collection', collection: 'value', item: ref('x') },
      byKey: { type: 'record', key: { type: 'string' }, value: ref('x') },
      cells: {
        type: 'collection',
        collection: 'keyed',
        item: { type: 'object', fields: { r: { type: 'number' }, target: ref('x') } },
      },
    };
    const walk = collectRefFields(schema);
    expect(walk.refs).toEqual([]);
    expect(walk.misplaced.map((m) => [m.path, m.issue])).toEqual([
      ['nested.target', 'nested-object'],
      ['aliases[]', 'scalar-item'],
      ['byKey.$value', 'record'],
      ['cells[].target', 'keyed-collection'],
    ]);
    expect(honouredRefNodes(schema).size).toBe(0);
  });
});

describe('refTargetsOf', () => {
  it('collects (type, slug) pairs from every honoured field, without duplicates, skipping empty and polymorphic values', () => {
    const entities = [
      {
        designSystemSlug: 'paper',
        linkedDtos: [{ dto: 'user' }, { dto: 'user' }],
        columns: [{ name: 'a', fk: { table: 'orders', column: 'id' } }, { name: 'b' }],
        verifies: [{ type: 'endpoint', slug: 'get-users' }],
      },
      { designSystemSlug: 'paper', linkedDtos: [{ dto: 'order' }], columns: [] },
      { designSystemSlug: null },
    ];
    expect(refTargetsOf(SHIPPED, entities)).toEqual([
      { type: 'design-system', slug: 'paper' },
      { type: 'dto', slug: 'user' },
      { type: 'database-table', slug: 'orders' },
      { type: 'dto', slug: 'order' },
    ]);
  });

  it('is empty for a schema without refs', () => {
    expect(refTargetsOf({ title: { type: 'string' } }, [{ title: 'x' }])).toEqual([]);
    expect(refTargetsOf(undefined, [{}])).toEqual([]);
  });
});
