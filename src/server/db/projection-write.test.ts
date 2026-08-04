/**
 * The write half of the generated projection (0.2.9, brief item 6).
 *
 * `projection.golden.test.ts` pins the DDL a declaration produces. This pins the
 * other direction: that a row written from the same declaration reads back as
 * what went in. The two together are what let a type declare its data and get a
 * working store, so the cases worth having here are the ones where a naive
 * implementation would quietly disagree with `generateProjectionDDL`:
 *
 *   - an absent embedded collection must be `'[]'`, not NULL, because the DDL
 *     says `DEFAULT '[]'` and a reader with two empty cases is a bug waiting;
 *   - a column DEFAULT covers the INSERT but NOT the UPDATE arm of an upsert,
 *     which names every column unconditionally;
 *   - `systemManaged` columns come from the stamp and never from the payload;
 *   - a value collection with `keyFields` REPLACES its projection rows, because
 *     "the collection IS the field".
 */

import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyProjection } from './projection.js';
import { upsertProjectionRow, type WritableModule } from './projection-write.js';
import { DomainError } from '../services/tags.js';

const WRITE_OPTS = { capture: false, writeFile: false };

const widget: WritableModule = {
  type: 'widget',
  payloadVersion: 1,
  data: {
    schema: {
      label: { kind: 'string', required: true },
      size: { kind: 'enum', values: ['s', 'm', 'l'], default: 'm' },
      active: { kind: 'boolean', default: true },
      meta: { kind: 'object', fields: { note: { kind: 'string' } } },
      notes: { kind: 'collection', collection: 'value', item: { kind: 'string' } },
      links: {
        kind: 'collection',
        collection: 'value',
        keyFields: ['target'],
        item: {
          kind: 'object',
          fields: {
            target: { kind: 'string', required: true },
            rank: { kind: 'number' },
          },
        },
      },
      createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
      updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
    },
  },
};

function projected(module: WritableModule = widget): Database.Database {
  const db = new Database(':memory:');
  applyProjection(db, [module]);
  return db;
}

function row(db: Database.Database, slug = 'w1'): Record<string, unknown> {
  return db.prepare('SELECT * FROM widget WHERE slug = ?').get(slug) as Record<string, unknown>;
}

describe('upsertProjectionRow — round trip through the generated projection', () => {
  it('writes every declared kind in the shape hydrate reads back', () => {
    const db = projected();
    upsertProjectionRow({ db, versions: null }, widget, 'w1', {
      label: 'hello',
      size: 'l',
      active: false,
      meta: { note: 'n' },
      notes: ['a', 'b'],
    }, 'user', WRITE_OPTS);

    const r = row(db);
    expect(r.label).toBe('hello');
    expect(r.size).toBe('l');
    // Booleans are 0/1 — SQLite has no boolean storage class.
    expect(r.active).toBe(0);
    // Objects and embedded collections are JSON text, which is what `hydrate`
    // parses back by probing for a leading `{` or `[`.
    expect(JSON.parse(r.meta as string)).toEqual({ note: 'n' });
    expect(JSON.parse(r.notes as string)).toEqual(['a', 'b']);
  });

  it('fills a declared default rather than NULL when the payload omits the field', () => {
    const db = projected();
    upsertProjectionRow({ db, versions: null }, widget, 'w1', { label: 'x' }, 'user', WRITE_OPTS);
    const r = row(db);
    expect(r.size).toBe('m');
    expect(r.active).toBe(1);
  });

  it('stores an absent embedded collection as [] — never NULL', () => {
    // The DDL says `DEFAULT '[]'` for exactly this reason. A NULL here would give
    // every reader two different empty cases to handle.
    const db = projected();
    upsertProjectionRow({ db, versions: null }, widget, 'w1', { label: 'x' }, 'user', WRITE_OPTS);
    expect(row(db).notes).toBe('[]');
  });

  it('applies defaults on the UPDATE arm too, where the column DEFAULT cannot reach', () => {
    // The trap this pins: a column DEFAULT fires on INSERT only. The upsert's
    // UPDATE arm names every column, so a field dropped from the payload on the
    // second write would carry the FIRST write's value forward if the code
    // trusted the DDL to fill it.
    const db = projected();
    const deps = { db, versions: null };
    upsertProjectionRow(deps, widget, 'w1', { label: 'x', size: 'l', notes: ['a'] }, 'user', WRITE_OPTS);
    upsertProjectionRow(deps, widget, 'w1', { label: 'x' }, 'user', WRITE_OPTS);

    const r = row(db);
    expect(r.size).toBe('m');
    expect(r.notes).toBe('[]');
  });

  it('reports created then updated for the same slug', () => {
    const db = projected();
    const deps = { db, versions: null };
    expect(upsertProjectionRow(deps, widget, 'w1', { label: 'a' }, 'user', WRITE_OPTS).op).toBe('created');
    expect(upsertProjectionRow(deps, widget, 'w1', { label: 'b' }, 'user', WRITE_OPTS).op).toBe('updated');
    expect(db.prepare('SELECT COUNT(*) AS c FROM widget').get()).toEqual({ c: 1 });
  });
});

describe('upsertProjectionRow — system fields belong to the host', () => {
  it('writes the audit columns from the stamp, ignoring any payload value', () => {
    const db = projected();
    const stamp = { createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-02T00:00:00.000Z' };
    upsertProjectionRow({ db, versions: null }, widget, 'w1', {
      label: 'x',
      createdAt: '1999-12-31T00:00:00.000Z',
      updatedAt: '1999-12-31T00:00:00.000Z',
    }, 'user', { ...WRITE_OPTS, stamp });

    const r = row(db);
    expect(r.created_at).toBe(stamp.createdAt);
    expect(r.updated_at).toBe(stamp.updatedAt);
  });

  it('writes a type that declares NO audit columns at all', () => {
    // The six built-ins all opt into `systemManaged` timestamps, but the flag is
    // an opt-in. Probing for `created_at` unconditionally would turn a leaner
    // declaration into a `no such column` write failure.
    const bare: WritableModule = {
      type: 'widget',
      payloadVersion: 1,
      data: { schema: { label: { kind: 'string', required: true } } },
    };
    const db = projected(bare);
    expect(() =>
      upsertProjectionRow({ db, versions: null }, bare, 'w1', { label: 'x' }, 'user', WRITE_OPTS),
    ).not.toThrow();
    expect(row(db).label).toBe('x');
  });
});

describe('upsertProjectionRow — the declaration is enforced, not advisory', () => {
  it('rejects a missing required field instead of writing a broken row', () => {
    const db = projected();
    expect(() =>
      upsertProjectionRow({ db, versions: null }, widget, 'w1', {}, 'user', WRITE_OPTS),
    ).toThrow(DomainError);
    expect(db.prepare('SELECT COUNT(*) AS c FROM widget').get()).toEqual({ c: 0 });
  });

  it('rejects an out-of-range enum rather than coercing it', () => {
    // The retired per-type code mapped an unknown `diagram.format` onto
    // `mermaid` silently, turning a typo into a wrong diagram that rendered
    // fine. A declared enum exists to make that impossible.
    const db = projected();
    expect(() =>
      upsertProjectionRow({ db, versions: null }, widget, 'w1', { label: 'x', size: 'xl' }, 'user', WRITE_OPTS),
    ).toThrow(/expected one of s, m, l/);
  });

  it('refuses to write a keyed collection through the value path', () => {
    // Keyed collections reconcile per key (tier C); a value write replaces
    // wholesale. They differ in exactly the case that matters — a key absent
    // from the payload — so falling through would silently delete data.
    const keyed: WritableModule = {
      type: 'widget',
      payloadVersion: 1,
      data: {
        schema: {
          label: { kind: 'string', required: true },
          cells: {
            kind: 'collection',
            collection: 'keyed',
            keyFields: ['row', 'col'],
            item: {
              kind: 'object',
              fields: {
                row: { kind: 'number', required: true },
                col: { kind: 'number', required: true },
                value: { kind: 'string' },
              },
            },
          },
        },
      },
    };
    const db = projected(keyed);
    expect(() =>
      upsertProjectionRow({ db, versions: null }, keyed, 'w1', { label: 'x', cells: [] }, 'user', WRITE_OPTS),
    ).toThrow(/keyed collection/);
  });
});

describe('upsertProjectionRow — projection tables', () => {
  const links = (db: Database.Database): unknown[] =>
    db.prepare('SELECT target, rank FROM widget_links ORDER BY target').all();

  it('writes a value collection that has its own table', () => {
    const db = projected();
    upsertProjectionRow({ db, versions: null }, widget, 'w1', {
      label: 'x',
      links: [{ target: 'b', rank: 2 }, { target: 'a', rank: 1 }],
    }, 'user', WRITE_OPTS);

    expect(links(db)).toEqual([
      { target: 'a', rank: 1 },
      { target: 'b', rank: 2 },
    ]);
  });

  it('REPLACES the rows wholesale on rewrite — the collection IS the field', () => {
    const db = projected();
    const deps = { db, versions: null };
    upsertProjectionRow(deps, widget, 'w1', {
      label: 'x',
      links: [{ target: 'a', rank: 1 }, { target: 'b', rank: 2 }],
    }, 'user', WRITE_OPTS);
    upsertProjectionRow(deps, widget, 'w1', {
      label: 'x',
      links: [{ target: 'c', rank: 3 }],
    }, 'user', WRITE_OPTS);

    expect(links(db)).toEqual([{ target: 'c', rank: 3 }]);
  });

  it('clears the rows when the collection is omitted entirely', () => {
    // For a value collection, "the payload said nothing" and "the collection is
    // empty" are the same statement — the field IS the collection.
    const db = projected();
    const deps = { db, versions: null };
    upsertProjectionRow(deps, widget, 'w1', { label: 'x', links: [{ target: 'a' }] }, 'user', WRITE_OPTS);
    upsertProjectionRow(deps, widget, 'w1', { label: 'x' }, 'user', WRITE_OPTS);
    expect(links(db)).toEqual([]);
  });
});

describe('upsertProjectionRow — version capture', () => {
  it('captures through the same door every other write path uses', () => {
    const captureEntitySnapshot = vi.fn();
    const db = projected();
    upsertProjectionRow(
      { db, versions: { captureEntitySnapshot } },
      { ...widget, serializer: { version: '1.1.0' } },
      'w1', { label: 'x' }, 'user',
      { capture: true, writeFile: false },
    );
    // The SERIALIZER's semver, not the module's `payloadVersion`. Writing '1'
    // here made consecutive rows for the same entity disagree as soon as any
    // other path captured one — the signal consumers read as a serializer
    // migration. `payloadVersion` takes over this column in tier B item 13, for
    // every writer at once.
    expect(captureEntitySnapshot).toHaveBeenCalledWith('widget', 'w1', 'create', 'user', 'Created', '1.1.0');
  });

  it('rolls the row back when the capture throws', () => {
    // Every service captures INSIDE its transaction, and `captureEntitySnapshot`
    // rethrows precisely "so the caller's transaction rolls back and the failure
    // surfaces". Capturing after the commit left a committed row with no version
    // row attributing it — invisible to history and to the next release diff.
    const db = projected();
    const captureEntitySnapshot = vi.fn(() => { throw new Error('capture exploded'); });
    expect(() =>
      upsertProjectionRow({ db, versions: { captureEntitySnapshot } }, widget, 'w1', { label: 'x' }, 'user', {
        capture: true, writeFile: false,
      }),
    ).toThrow(/capture exploded/);
    expect(db.prepare('SELECT COUNT(*) AS c FROM widget').get()).toEqual({ c: 0 });
  });

  it('captures nothing on the rebuild path', () => {
    // `indexAll()` reconstructs the index from files it already trusts. A capture
    // there would mint a version row per entity on every boot.
    const captureEntitySnapshot = vi.fn();
    const db = projected();
    upsertProjectionRow({ db, versions: { captureEntitySnapshot } }, widget, 'w1', { label: 'x' }, 'user', WRITE_OPTS);
    expect(captureEntitySnapshot).not.toHaveBeenCalled();
  });
});
