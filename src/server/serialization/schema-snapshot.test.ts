/**
 * The generator's rules, one at a time.
 *
 * `snapshot-parity` proves the six real types still emit what they emitted, and
 * that is the gate. This is the complement: the rules stated on their own, so a
 * future type that exercises a combination none of the six happens to use is
 * covered by something other than luck.
 */

import { describe, expect, it, vi } from 'vitest';
import { restoreFromSchema, snapshotFromSchema, type SnapshottableModule } from './schema-snapshot.js';
import type { RawEntity } from '../discovery/raw-entity-reader.js';
import type { FieldNode } from '../../shared/plugin-host/data-schema.js';
import type { RestoreContext } from './types.js';

const SCHEMA: Record<string, FieldNode> = {
  // Payload name and column name diverge — the case the whole mapping exists for.
  designSystemSlug: { kind: 'string', column: 'design_system_slug', clearable: true, ref: 'design-system' },
  title: { kind: 'string', required: true },
  status: { kind: 'enum', values: ['on', 'off'], default: 'on' },
  note: { kind: 'string' },
  params: { kind: 'collection', collection: 'value', item: { kind: 'string' } },
  // Unordered, with an object item — sorted by declaration order (`type`, then
  // `slug`), which is the `ac.verifies` rule.
  refs: {
    kind: 'collection',
    collection: 'value',
    unordered: true,
    item: {
      kind: 'object',
      fields: { type: { kind: 'string' }, slug: { kind: 'string' } },
    },
  },
  // Lives in its own table, so it is read through the reader, not off the row.
  links: {
    kind: 'collection',
    collection: 'value',
    unordered: true,
    keyFields: ['target'],
    projectionTable: 'widget_link',
    item: { kind: 'object', fields: { target: { kind: 'string' } } },
  },
  // The three exclusions.
  caption: { kind: 'string', transientInput: true },
  id: { kind: 'number', localSurrogate: true },
  createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
  updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
};

const widget: SnapshottableModule = { type: 'widget', data: { schema: SCHEMA } };

function entity(data: Record<string, unknown>, tags: string[] = []): RawEntity {
  return { type: 'widget', slug: 'w1', data, tags };
}

const readerWith = (links: unknown[] = []) => ({ readCollection: () => links }) as never;

const snap = (data: Record<string, unknown>, tags: string[] = [], links: unknown[] = []) =>
  snapshotFromSchema(widget, entity(data, tags), readerWith(links)) as Record<string, unknown>;

describe('snapshotFromSchema', () => {
  it('emits declared FIELD names, reading from the declared COLUMN', () => {
    // The asymmetry `projection-roundtrip` documented: the row is column-keyed,
    // the snapshot is field-keyed, and restore hands the latter to a
    // field-keyed writer. Getting this backwards loses the field on every write.
    expect(snap({ design_system_slug: 'brand', title: 'T' }).designSystemSlug).toBe('brand');
  });

  it('excludes systemManaged, transientInput and localSurrogate fields', () => {
    const out = snap({
      title: 'T',
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      caption: 'seeds the slug',
      id: 7,
    });
    // Timestamps travel in the envelope attached one layer up; emitting them
    // here would write them twice and let the two copies disagree.
    expect(out.createdAt).toBeUndefined();
    expect(out.updatedAt).toBeUndefined();
    expect(out.caption).toBeUndefined();
    expect(out.id).toBeUndefined();
  });

  it('fills an absent field from its declared default, or null, or []', () => {
    const out = snap({ title: 'T' });
    expect(out.status).toBe('on');
    expect(out.note).toBeNull();
    expect(out.params).toEqual([]);
  });

  it('keeps the key set constant across entities of the same type', () => {
    // A snapshot whose keys vary by which fields happen to be set produces a
    // diff on every field that was merely never filled in.
    const sparse = Object.keys(snap({ title: 'T' })).sort();
    const full = Object.keys(
      snap({ title: 'T', note: 'n', design_system_slug: 'b', status: 'off', params: ['a'] }),
    ).sort();
    expect(sparse).toEqual(full);
  });

  it('sorts an unordered collection by its item fields in DECLARATION order', () => {
    const out = snap({
      title: 'T',
      refs: [
        { type: 'endpoint', slug: 'a' },
        { type: 'dto', slug: 'z' },
        { type: 'dto', slug: 'b' },
      ],
    });
    // `type` before `slug`. Alphabetical key order would compare `slug` first
    // and produce a/b/z, reordering every existing file.
    expect(out.refs).toEqual([
      { type: 'dto', slug: 'b' },
      { type: 'dto', slug: 'z' },
      { type: 'endpoint', slug: 'a' },
    ]);
  });

  it('leaves an ORDERED collection exactly as authored', () => {
    // `params` is not `unordered`, and a scale or a parameter list is content.
    expect(snap({ title: 'T', params: ['z', 'a', 'm'] }).params).toEqual(['z', 'a', 'm']);
  });

  it('reads a collection that projects to its own table through the reader', () => {
    const out = snap({ title: 'T' }, [], [{ target: 'z' }, { target: 'a' }]);
    // Read through the reader AND sorted, since it is declared unordered.
    expect(out.links).toEqual([{ target: 'a' }, { target: 'z' }]);
  });

  it('always sorts tags, which are host-owned rather than declared', () => {
    expect(snap({ title: 'T' }, ['zeta', 'alpha']).tags).toEqual(['alpha', 'zeta']);
  });

  it('refuses a type with no declaration rather than emitting an empty snapshot', () => {
    expect(() => snapshotFromSchema({ type: 'ghost' }, entity({}), readerWith())).toThrow(
      /declares no data\.schema/,
    );
  });
});

describe('restoreFromSchema', () => {
  function ctxWith(upsert: RestoreContext['writer']['upsert']) {
    const syncTags = vi.fn();
    return {
      ctx: { reader: {}, writer: { upsert, syncTags }, releaseId: null, actor: 'user' } as unknown as RestoreContext,
      syncTags,
    };
  }

  it('hands the writer a field-keyed payload and syncs tags separately', () => {
    const upsert = vi.fn(() => ({ op: 'created' as const, entity: {} }));
    const { ctx, syncTags } = ctxWith(upsert);
    restoreFromSchema(widget, { slug: 'w1', title: 'T', designSystemSlug: 'brand', tags: ['b', 'a'] }, ctx);

    expect(upsert).toHaveBeenCalledWith('widget', 'w1', expect.objectContaining({
      title: 'T',
      designSystemSlug: 'brand',
    }), 'user');
    // `tags` is not a declared field — it must not reach the payload.
    expect((upsert.mock.calls[0]![2] as Record<string, unknown>).tags).toBeUndefined();
    expect(syncTags).toHaveBeenCalledWith('widget', 'w1', ['b', 'a']);
  });

  it('omits a key the snapshot does not carry, rather than sending undefined', () => {
    // The difference between "no change" and "clear" for a partial payload.
    const upsert = vi.fn(() => ({ op: 'updated' as const, entity: {} }));
    const { ctx } = ctxWith(upsert);
    restoreFromSchema(widget, { slug: 'w1', title: 'T' }, ctx);
    expect(upsert.mock.calls[0]![2]).not.toHaveProperty('note');
  });

  it('reports a skip, not a throw, when the type is not active', () => {
    // A deactivated type must not abort a whole restore.
    const { ctx } = ctxWith(vi.fn(() => null));
    const result = restoreFromSchema(widget, { slug: 'w1', title: 'T' }, ctx);
    expect(result.op).toBe('noop');
    expect(result.warnings?.join()).toMatch(/not available/);
  });
});

/**
 * A keyed collection's snapshot (tier C, items 11 and 19).
 *
 * Both normalizations exist so the snapshot is a function of the STATE rather
 * than of the storage — two equivalent grids must produce a byte-identical
 * capture, or every release diff reports edits nobody made.
 */
describe('snapshotFromSchema — keyed collections', () => {
  const gridSchema: Record<string, FieldNode> = {
    name: { kind: 'string', required: true },
    nRows: { kind: 'number', column: 'n_rows' },
    nCols: { kind: 'number', column: 'n_cols' },
    cells: {
      kind: 'collection',
      collection: 'keyed',
      keyFields: ['r', 'c'],
      axes: [
        { key: 'r', extent: 'nRows' },
        { key: 'c', extent: 'nCols' },
      ],
      item: {
        kind: 'object',
        fields: {
          r: { kind: 'number', required: true },
          c: { kind: 'number', required: true },
          value: { kind: 'string' },
        },
      },
    },
  };
  const grid: SnapshottableModule = { type: 'grid', data: { schema: gridSchema } };

  const gridSnap = (cells: unknown[]) =>
    snapshotFromSchema(
      grid,
      { type: 'grid', slug: 'g1', data: { name: 'G' }, tags: [] },
      { readCollection: () => cells } as never,
    ) as Record<string, unknown>;

  it('sorts by the key tuple NUMERICALLY, not as strings', () => {
    // `String(10).localeCompare(String(2))` puts row 10 before row 2, so a
    // string sort is not a sort at all past nine rows — and the "equivalent
    // states diff identically" guarantee would hold only for tiny grids.
    const out = gridSnap([
      { r: 10, c: 1, value: 'j' },
      { r: 2, c: 1, value: 'b' },
      { r: 1, c: 2, value: 'a2' },
      { r: 1, c: 1, value: 'a1' },
    ]);
    expect(out.cells).toEqual([
      { r: 1, c: 1, value: 'a1' },
      { r: 1, c: 2, value: 'a2' },
      { r: 2, c: 1, value: 'b' },
      { r: 10, c: 1, value: 'j' },
    ]);
  });

  it('never emits an empty item (item 19)', () => {
    // The store holds no row for one, but a restore payload or a hand-edited
    // file can carry it — and emitting it writes a cell into the entity file
    // that the next rebuild refuses to store, so the file stops round-tripping
    // through its own index.
    const out = gridSnap([
      { r: 1, c: 1, value: '' },
      { r: 1, c: 2, value: null },
      { r: 2, c: 1, value: 'b' },
    ]);
    expect(out.cells).toEqual([{ r: 2, c: 1, value: 'b' }]);
  });

  it('sorts without the `unordered` opt-in a value collection needs', () => {
    // There is no authored order to protect: a keyed collection's order IS its
    // key, so sorting is a normalization rather than a silent edit to content.
    expect(gridSnap([{ r: 2, c: 1, value: 'b' }, { r: 1, c: 1, value: 'a' }]).cells).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 2, c: 1, value: 'b' },
    ]);
  });

  it('produces an identical capture for two equivalent states', () => {
    const dense = gridSnap([{ r: 1, c: 1, value: 'a' }, { r: 2, c: 2, value: 'b' }]);
    const shuffledWithEmpties = gridSnap([
      { r: 2, c: 2, value: 'b' },
      { r: 5, c: 5, value: '' },
      { r: 1, c: 1, value: 'a' },
    ]);
    expect(JSON.stringify(shuffledWithEmpties)).toBe(JSON.stringify(dense));
  });
});
