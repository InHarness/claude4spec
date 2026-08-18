/**
 * The host's delta engine (0.2.31).
 *
 * Written against SYNTHETIC schemas rather than through a shipped type, on
 * purpose: the guarantee is that the eight operations come out of the
 * DECLARATION, for every type at once and for types not written yet. The
 * per-type cases live next to each plugin (`endpoint-payload`, `ui-view-mockup`,
 * `design-system-serializer`, `diagram/serializer`), where they check that a
 * specific declaration produces the distinctions that type cares about.
 */

import { describe, expect, it } from 'vitest';
import { diffFromSchema } from './schema-diff.js';
import type { FieldNode } from '../../shared/plugin-host/data-schema.js';

const identified: Record<string, FieldNode> = {
  title: { type: 'string' },
  items: {
    type: 'collection',
    collection: { kind: 'value', identity: ['name'] },
    item: {
      type: 'object',
      fields: { name: { type: 'string' }, size: { type: 'number' } },
    },
  },
};

/** No identity — the `database-table.columns` case: order IS the content. */
const positional: Record<string, FieldNode> = {
  columns: {
    type: 'collection',
    collection: 'value',
    item: {
      type: 'object',
      fields: { name: { type: 'string' }, type: { type: 'string' } },
    },
  },
};

describe('scalars', () => {
  it('reports one field_changed per changed field, at its schema path', () => {
    expect(diffFromSchema(identified, { title: 'A', items: [] }, { title: 'B', items: [] })).toEqual([
      { op: 'field_changed', path: 'title', from: 'A', to: 'B' },
    ]);
  });

  it('produces nothing at all for two equal snapshots — noop is structural', () => {
    const snap = { title: 'A', items: [{ name: 'x', size: 1 }] };
    expect(diffFromSchema(identified, snap, snap)).toEqual([]);
  });
});

describe('a value collection WITH a declared identity', () => {
  it('matches on the identity, so a pure reshuffle is no change', () => {
    const items = [
      { name: 'a', size: 1 },
      { name: 'b', size: 2 },
    ];
    const a = { title: 'T', items };
    const b = { title: 'T', items: [...items].reverse() };
    expect(diffFromSchema(identified, a, b)).toEqual([]);
  });

  it('reports an edit to a matched item as item_modified with a NESTED list', () => {
    const a = { title: 'T', items: [{ name: 'a', size: 1 }] };
    const b = { title: 'T', items: [{ name: 'a', size: 9 }] };
    expect(diffFromSchema(identified, a, b)).toEqual([
      {
        op: 'item_modified',
        path: 'items',
        identity: { name: 'a' },
        // A LIST, never a count. The old per-type diffs reported
        // `override_changes: 3` and the reader had no way to learn which three.
        changes: [{ op: 'field_changed', path: 'items[].size', from: 1, to: 9 }],
      },
    ]);
  });

  it('reports an unmatched item on either side as added / removed', () => {
    const a = { title: 'T', items: [{ name: 'a', size: 1 }] };
    const b = { title: 'T', items: [{ name: 'b', size: 1 }] };
    expect(diffFromSchema(identified, a, b)).toEqual([
      { op: 'item_removed', path: 'items', identity: { name: 'a' }, item: { name: 'a', size: 1 } },
      { op: 'item_added', path: 'items', identity: { name: 'b' }, item: { name: 'b', size: 1 } },
    ]);
  });
});

describe('a declared identity that the data does NOT make unique', () => {
  /**
   * `identity` is a claim about the data, and nothing enforces it. The live case
   * is `endpoint.linkedDtos`: it keys on `dto` + `relation` while the join table
   * also discriminates on `statusCode`, so a 404 and a 500 response to the same
   * DTO legitimately share one identity. Pairing the first of each side would
   * report an ARRIVAL as an edit of its neighbour — a delta that is not merely
   * imprecise but false.
   */
  const contested: Record<string, FieldNode> = {
    links: {
      type: 'collection',
      collection: { kind: 'value', identity: ['dto'] },
      item: {
        type: 'object',
        fields: { dto: { type: 'string' }, status: { type: 'number' } },
      },
    },
  };

  it('reports an arrival under a contested key as item_added, not as an edit', () => {
    const a = { links: [{ dto: 'err', status: 404 }] };
    const b = { links: [{ dto: 'err', status: 404 }, { dto: 'err', status: 500 }] };
    expect(diffFromSchema(contested, a, b)).toEqual([
      { op: 'item_added', path: 'links', identity: { dto: 'err' }, item: { dto: 'err', status: 500 } },
    ]);
  });

  it('reports a departure under a contested key as item_removed', () => {
    const a = { links: [{ dto: 'err', status: 404 }, { dto: 'err', status: 500 }] };
    const b = { links: [{ dto: 'err', status: 404 }] };
    expect(diffFromSchema(contested, a, b)).toEqual([
      { op: 'item_removed', path: 'links', identity: { dto: 'err' }, item: { dto: 'err', status: 500 } },
    ]);
  });

  it('stays silent when nothing under the contested key changed', () => {
    const links = [{ dto: 'err', status: 404 }, { dto: 'err', status: 500 }];
    expect(diffFromSchema(contested, { links }, { links: [...links] })).toEqual([]);
  });
});

describe('the rekey pass', () => {
  const rekeyed: Record<string, FieldNode> = {
    params: {
      type: 'collection',
      collection: { kind: 'value', identity: ['name', 'in'], rekeyOn: ['name'] },
      item: {
        type: 'object',
        fields: { name: { type: 'string' }, in: { type: 'string' }, note: { type: 'string' } },
      },
    },
  };

  it('recovers a key-field edit as a move rather than a remove/add pair', () => {
    const a = { params: [{ name: 'id', in: 'path' }] };
    const b = { params: [{ name: 'id', in: 'query' }] };
    expect(diffFromSchema(rekeyed, a, b)).toEqual([
      {
        op: 'item_rekeyed',
        path: 'params',
        identity: { name: 'id', in: 'query' },
        field: 'in',
        from: 'path',
        to: 'query',
      },
    ]);
  });

  it('reports a move AND an edit as two operations — one fact each', () => {
    const a = { params: [{ name: 'id', in: 'path', note: 'old' }] };
    const b = { params: [{ name: 'id', in: 'query', note: 'new' }] };
    const changes = diffFromSchema(rekeyed, a, b);
    expect(changes.map((c) => c.op)).toEqual(['item_rekeyed', 'item_modified']);
    // The moved field is NOT repeated inside the edit — it is already the rekey.
    expect(changes[1]).toEqual({
      op: 'item_modified',
      path: 'params',
      identity: { name: 'id', in: 'query' },
      changes: [{ op: 'field_changed', path: 'params[].note', from: 'old', to: 'new' }],
    });
  });

  it('degrades SILENTLY to remove + add when the move would be a guess', () => {
    // Two orphans a side sharing the `rekeyOn` key: no fact says which moved
    // into which, so no move is asserted — and no warning is raised either,
    // because there is nothing unusual about the data.
    const a = { params: [{ name: 'id', in: 'path' }, { name: 'id', in: 'hash' }] };
    const b = { params: [{ name: 'id', in: 'query' }, { name: 'id', in: 'header' }] };
    const ops = diffFromSchema(rekeyed, a, b).map((c) => c.op);
    expect(ops).not.toContain('item_rekeyed');
    expect(ops.filter((o) => o === 'item_removed')).toHaveLength(2);
    expect(ops.filter((o) => o === 'item_added')).toHaveLength(2);
  });
});

describe('a value collection with NO declared identity', () => {
  /**
   * The absence is a DECISION. `database-table.columns` declares nothing because
   * a table's column order is part of the table, so swapping two columns has to
   * read as a change to both positions — which is exactly what index matching
   * says, and exactly what an identity would have hidden.
   */
  it('matches by index, so a reshuffle IS a change', () => {
    const a = { columns: [{ name: 'id', type: 'int' }, { name: 'email', type: 'text' }] };
    const b = { columns: [{ name: 'email', type: 'text' }, { name: 'id', type: 'int' }] };
    const changes = diffFromSchema(positional, a, b);
    expect(changes).toHaveLength(2);
    expect(changes.every((c) => c.op === 'item_modified')).toBe(true);
    expect(changes[0]).toMatchObject({ identity: { index: 0 } });
    expect(changes[1]).toMatchObject({ identity: { index: 1 } });
  });

  it('reports a trailing arrival as item_added at its index', () => {
    const a = { columns: [{ name: 'id', type: 'int' }] };
    const b = { columns: [{ name: 'id', type: 'int' }, { name: 'email', type: 'text' }] };
    expect(diffFromSchema(positional, a, b)).toEqual([
      {
        op: 'item_added',
        path: 'columns',
        identity: { index: 1 },
        item: { name: 'email', type: 'text' },
      },
    ]);
  });
});

describe('a keyed collection', () => {
  const keyed: Record<string, FieldNode> = {
    cells: {
      type: 'collection',
      collection: 'keyed',
      keyFields: ['r', 'c'],
      item: {
        type: 'object',
        fields: { r: { type: 'number' }, c: { type: 'number' }, value: { type: 'string' } },
      },
    },
  };

  it('matches on keyFields — the key IS the address, so no identity is declared', () => {
    const a = { cells: [{ r: 0, c: 0, value: 'x' }] };
    const b = { cells: [{ r: 0, c: 0, value: 'y' }, { r: 1, c: 0, value: 'z' }] };
    expect(diffFromSchema(keyed, a, b)).toEqual([
      {
        op: 'item_modified',
        path: 'cells',
        identity: { r: 0, c: 0 },
        changes: [{ op: 'field_changed', path: 'cells[].value', from: 'x', to: 'y' }],
      },
      {
        op: 'item_added',
        path: 'cells',
        identity: { r: 1, c: 0 },
        item: { r: 1, c: 0, value: 'z' },
      },
    ]);
  });
});

describe('the opaque class', () => {
  const opaque: Record<string, FieldNode> = {
    body: { type: 'string', contentBearing: true },
    // A free-JSON node has no schema to compare against, so it is opaque too —
    // `design-system` token values and `dto.examples[].value` are both this.
    payload: { type: 'json' },
  };

  it('reports bytes for both a contentBearing and a free-JSON field', () => {
    const a = { body: 'hello', payload: { a: 1 } };
    const b = { body: 'hello world', payload: { a: 2 } };
    expect(diffFromSchema(opaque, a, b)).toEqual([
      { op: 'field_changed_opaque', path: 'body', fromBytes: 5, toBytes: 11 },
      { op: 'field_changed_opaque', path: 'payload', fromBytes: 7, toBytes: 7 },
    ]);
  });

  it('never emits a boolean and never the value itself', () => {
    const changes = diffFromSchema(opaque, { body: 'a' }, { body: 'SECRET' });
    expect(JSON.stringify(changes)).not.toContain('SECRET');
  });
});

describe('systemManaged fields', () => {
  it('are out of the delta by DECLARATION, not by a hard-coded list of two', () => {
    const schema: Record<string, FieldNode> = {
      title: { type: 'string' },
      updatedAt: { type: 'string', systemManaged: true },
      lastSeenAt: { type: 'string', systemManaged: true },
    };
    const a = { title: 'T', updatedAt: '2026-01-01', lastSeenAt: '2026-01-01' };
    const b = { title: 'T', updatedAt: '2026-08-18', lastSeenAt: '2026-08-18' };
    expect(diffFromSchema(schema, a, b)).toEqual([]);
  });
});

describe('tags', () => {
  /**
   * Tags are not a `data.schema` field — they ride the entity envelope — so
   * these are the only two operations without a `path`.
   */
  it('are diffed as a set, sorted, and carry no path', () => {
    const changes = diffFromSchema(
      { title: { type: 'string' } },
      { title: 'T', tags: ['b', 'a', 'gone'] },
      { title: 'T', tags: ['a', 'b', 'zed', 'new'] },
    );
    expect(changes).toEqual([
      { op: 'tag_added', tag: 'new' },
      { op: 'tag_added', tag: 'zed' },
      { op: 'tag_removed', tag: 'gone' },
    ]);
  });

  it('come after every field operation, so the order is deterministic', () => {
    const changes = diffFromSchema(
      { title: { type: 'string' } },
      { title: 'A', tags: [] },
      { title: 'B', tags: ['x'] },
    );
    expect(changes.map((c) => c.op)).toEqual(['field_changed', 'tag_added']);
  });
});
