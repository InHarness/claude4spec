/**
 * The generated write path, checked against the generated READ path.
 *
 * WHY THIS FILE EXISTS, stated plainly: `projection-write.test.ts` asserts what
 * lands in the columns, and every one of its assertions was written by the same
 * author, at the same time, as the code it checks. That is enough to catch a
 * typo and useless against a wrong belief — and a review found several, the worst
 * being that an `object` column round-tripped as `[]` because
 * `RawEntityReader.hydrate` funnelled every `{`-leading string through a helper
 * whose last line was `Array.isArray(parsed) ? parsed : []`. Column-level tests
 * could never have seen it: the value written was correct, and the value read
 * back was wrong.
 *
 * So these tests never assert on a column. They write through
 * `upsertProjectionRow` and read back through the real `RawEntityReader`, which
 * is what `EntityStore.persist` uses to regenerate the entity FILE. The
 * invariant under test is the one the whole release rests on: what comes out of
 * the index is what went in, so `file → index → file` converges.
 */

import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyProjection } from './projection.js';
import { upsertProjectionRow, removeProjectionRow, type WritableModule } from './projection-write.js';
import { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

const WRITE_OPTS = { capture: false, writeFile: false };

const widget: WritableModule = {
  type: 'widget',
  payloadVersion: 1,
  data: {
    schema: {
      title: { kind: 'string', required: true, maxLength: 200, default: 'Untitled' },
      label: { kind: 'string', required: true },
      size: { kind: 'enum', values: ['s', 'm', 'l'], default: 'm' },
      active: { kind: 'boolean', default: true },
      // The shape the review found broken: a top-level object field.
      meta: { kind: 'object', fields: { note: { kind: 'string' }, rank: { kind: 'number' } } },
      // And a record, which hydrate treats identically.
      labels: { kind: 'record', key: { kind: 'string' }, value: { kind: 'string' } },
      notes: { kind: 'collection', collection: 'value', item: { kind: 'string' } },
      rows: {
        kind: 'collection',
        collection: 'value',
        item: { kind: 'object', fields: { name: { kind: 'string' }, n: { kind: 'number' } } },
      },
      createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
      updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
    },
  },
};

/** A host that knows exactly one module — enough for `resolveTable`. */
function hostFor(module: WritableModule): ProjectPluginHost {
  return {
    getEntity: (t: string) => (t === module.type ? module : null),
    getAvailable: (t: string) => (t === module.type ? module : null),
    listEntities: () => [module],
    listAvailable: () => [module],
  } as unknown as ProjectPluginHost;
}

function setup(module: WritableModule = widget) {
  const db = new Database(':memory:');
  // Copied from `000_baseline.sql`, not invented: the reader joins `tag.name`,
  // and a hand-rolled stand-in that omits it fails for a reason that has nothing
  // to do with what is under test.
  db.exec(`
    CREATE TABLE tag (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE entity_tag (
      entity_type TEXT NOT NULL, entity_slug TEXT NOT NULL,
      tag_slug TEXT NOT NULL REFERENCES tag(slug) ON DELETE CASCADE ON UPDATE CASCADE,
      UNIQUE(entity_type, entity_slug, tag_slug)
    );
  `);
  applyProjection(db, [module]);
  const host = hostFor(module);
  return { db, host, reader: new RawEntityReader(db, host), deps: { db, versions: null } };
}

describe('generated write → generated read: the value survives', () => {
  it('round-trips every declared kind through RawEntityReader', () => {
    const { deps, reader } = setup();
    const written = {
      label: 'hello',
      size: 'l' as const,
      active: false,
      meta: { note: 'n', rank: 3 },
      labels: { en: 'Hello', pl: 'Czesc' },
      notes: ['a', 'b'],
      rows: [{ name: 'x', n: 1 }],
    };
    upsertProjectionRow(deps, widget, 'w1', written, 'user', WRITE_OPTS);

    const back = reader.getEntity('widget', 'w1');
    expect(back).not.toBeNull();
    expect(back!.data.label).toBe('hello');
    expect(back!.data.size).toBe('l');
    expect(back!.data.notes).toEqual(['a', 'b']);
    expect(back!.data.rows).toEqual([{ name: 'x', n: 1 }]);
  });

  it('an object field comes back as the OBJECT, not as []', () => {
    // The regression this file was created for. `hydrate` returned `[]` for any
    // non-array JSON, and `EntityStore.persist` then wrote that `[]` into the
    // entity file — silent, permanent loss of the field at its source.
    const { deps, reader } = setup();
    upsertProjectionRow(deps, widget, 'w1', {
      label: 'x', meta: { note: 'keep me', rank: 7 },
    }, 'user', WRITE_OPTS);

    expect(reader.getEntity('widget', 'w1')!.data.meta).toEqual({ note: 'keep me', rank: 7 });
  });

  it('a record field comes back as the MAP, not as []', () => {
    const { deps, reader } = setup();
    upsertProjectionRow(deps, widget, 'w1', {
      label: 'x', labels: { en: 'Hello', pl: 'Czesc' },
    }, 'user', WRITE_OPTS);

    expect(reader.getEntity('widget', 'w1')!.data.labels).toEqual({ en: 'Hello', pl: 'Czesc' });
  });

  it('is a fixpoint: writing what was read back changes nothing', () => {
    // The `file → index → file` claim, reduced to what a unit test can hold.
    const { deps, reader } = setup();
    const original = {
      label: 'hello', size: 'l' as const, active: false,
      meta: { note: 'n', rank: 3 }, labels: { en: 'Hello' },
      notes: ['a'], rows: [{ name: 'x', n: 1 }],
    };
    const stamp = { createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-02T00:00:00.000Z' };
    upsertProjectionRow(deps, widget, 'w1', original, 'user', { ...WRITE_OPTS, stamp });
    const first = reader.getEntity('widget', 'w1')!;

    upsertProjectionRow(deps, widget, 'w1', first.data, 'user', { ...WRITE_OPTS, stamp });
    const second = reader.getEntity('widget', 'w1')!;

    expect(second.data).toEqual(first.data);
    expect(second.system).toEqual(first.system);
  });
});

describe('the write path agrees with the DDL generator', () => {
  it('fills a computedDefault field the payload omits, rather than binding NULL', () => {
    // `isNotNull` counts `computedDefault` as NOT NULL, so the column is
    // `NOT NULL DEFAULT (datetime('now'))` — and an explicit NULL DEFEATS a
    // column default rather than falling back to it. Every entity of such a type
    // was skipped by the rebuild with `NOT NULL constraint failed`.
    const withComputed: WritableModule = {
      type: 'widget', payloadVersion: 1,
      data: { schema: {
        title: { kind: 'string', required: true, maxLength: 200, default: 'Untitled' },
        label: { kind: 'string', required: true },
        lastSeenAt: { kind: 'string', computedDefault: 'now' },
      } },
    };
    const { deps, reader } = setup(withComputed);
    expect(() =>
      upsertProjectionRow(deps, withComputed, 'w1', { label: 'x' }, 'user', WRITE_OPTS),
    ).not.toThrow();
    // Keyed by COLUMN, not by field — see the asymmetry test below.
    expect(reader.getEntity('widget', 'w1')!.data.last_seen_at).toEqual(expect.any(String));
  });

  it('DOCUMENTS the field-name/column-name asymmetry the reader still has', () => {
    // Worth stating outright rather than discovering later: the write door takes
    // a payload keyed by FIELD name (`lastSeenAt`), and `hydrate` hands back a
    // row keyed by COLUMN name (`last_seen_at`). So `hydrate` output is NOT a
    // legal input to the door for any field whose name differs from its column,
    // and the "fixpoint" test above holds only because every `widget` field name
    // happens to equal its column.
    //
    // This is not a live bug: nothing feeds hydrate output back into the door.
    // Restore passes the SNAPSHOT payload (field names), and the per-type
    // serializer is what bridges column → payload naming on the read side.
    // It becomes load-bearing in tier B half one, where the generated snapshot
    // replaces those serializers and has to do the mapping itself.
    const camel: WritableModule = {
      type: 'widget', payloadVersion: 1,
      data: { schema: {
        title: { kind: 'string', required: true, maxLength: 200, default: 'Untitled' },
        label: { kind: 'string', required: true },
        designSystemSlug: { kind: 'string' },
      } },
    };
    const { deps, reader } = setup(camel);
    upsertProjectionRow(deps, camel, 'w1', { label: 'x', designSystemSlug: 'ds-1' }, 'user', WRITE_OPTS);

    const back = reader.getEntity('widget', 'w1')!;
    expect(back.data.design_system_slug).toBe('ds-1');
    expect(back.data.designSystemSlug).toBeUndefined();
  });

  it('treats an explicit null as absence for a NOT NULL column', () => {
    // `null !== undefined`, so "present" used to mean "bind the payload value",
    // and a serializer passing an optional field straight through killed the
    // write on a column the declaration says can never be null.
    const { deps, reader } = setup();
    expect(() =>
      upsertProjectionRow(deps, widget, 'w1', {
        label: 'x', notes: null, size: null, active: null,
      }, 'user', WRITE_OPTS),
    ).not.toThrow();

    const back = reader.getEntity('widget', 'w1')!;
    expect(back.data.notes).toEqual([]);
    expect(back.data.size).toBe('m');
  });

  it('still writes NULL for an explicit null on a NULLABLE column', () => {
    // The complement: where the column really is nullable, an explicit null is
    // a real value and `clearable` depends on it surviving.
    const nullable: WritableModule = {
      type: 'widget', payloadVersion: 1,
      data: { schema: {
        title: { kind: 'string', required: true, maxLength: 200, default: 'Untitled' },
        label: { kind: 'string', required: true },
        note: { kind: 'string', clearable: true },
      } },
    };
    const { deps, reader } = setup(nullable);
    upsertProjectionRow(deps, nullable, 'w1', { label: 'x', note: 'hi' }, 'user', WRITE_OPTS);
    upsertProjectionRow(deps, nullable, 'w1', { label: 'x', note: null }, 'user', WRITE_OPTS);
    expect(reader.getEntity('widget', 'w1')!.data.note).toBeNull();
  });
});

describe('system fields', () => {
  it('honours a systemManaged field whose column is renamed', () => {
    // Matching audit fields by COLUMN name meant a declaration using any other
    // column was skipped by the payload loop (it is systemManaged) AND missed by
    // the stamp loop — so nobody wrote it and it silently kept its DDL default.
    const renamed: WritableModule = {
      type: 'widget', payloadVersion: 1,
      data: { schema: {
        title: { kind: 'string', required: true, maxLength: 200, default: 'Untitled' },
        label: { kind: 'string', required: true },
        createdAt: { kind: 'string', column: 'made_at', systemManaged: true, computedDefault: 'now' },
        updatedAt: { kind: 'string', column: 'touched_at', systemManaged: true, computedDefault: 'now' },
      } },
    };
    const { db, deps } = setup(renamed);
    const stamp = { createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-02T00:00:00.000Z' };
    upsertProjectionRow(deps, renamed, 'w1', { label: 'x' }, 'user', { ...WRITE_OPTS, stamp });

    expect(db.prepare('SELECT made_at, touched_at FROM widget WHERE slug = ?').get('w1')).toEqual({
      made_at: stamp.createdAt,
      touched_at: stamp.updatedAt,
    });
  });

  it('prefers the FILE over the row for the pre-update createdAt', () => {
    // 0.2.7's rule. Reading it off the row alone inverts the direction of flow:
    // a drifted row would be written back, and `persist` regenerates the file
    // FROM that row — pushing the divergence into the source of truth.
    const { db, deps } = setup();
    upsertProjectionRow(deps, widget, 'w1', { label: 'x' }, 'user', {
      ...WRITE_OPTS, stamp: { createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
    });
    // Simulate the drift `existingStampFromFile` exists to correct.
    db.prepare(`UPDATE widget SET created_at = ? WHERE slug = ?`).run('1999-01-01T00:00:00.000Z', 'w1');

    const store = {
      exists: () => true,
      read: () => ({ createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' }),
    };
    upsertProjectionRow({ ...deps, store }, widget, 'w1', { label: 'y' }, 'user', WRITE_OPTS);

    expect(
      (db.prepare('SELECT created_at FROM widget WHERE slug = ?').get('w1') as { created_at: string })
        .created_at,
    ).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('dangling refs warn, they do not abort', () => {
  const linker: WritableModule = {
    type: 'widget', payloadVersion: 1,
    data: { schema: {
      title: { kind: 'string', required: true, maxLength: 200, default: 'Untitled' },
      label: { kind: 'string', required: true },
      links: {
        kind: 'collection', collection: 'value', keyFields: ['target'],
        item: { kind: 'object', fields: {
          target: { kind: 'string', required: true, ref: 'widget', onMissing: 'warn', onDelete: 'leave-dangling' },
        } },
      },
    } },
  };

  it('skips a dangling row with a warning and still writes the parent', () => {
    // The generated FK plus `PRAGMA foreign_keys = ON` made a broken ref abort
    // the whole transaction, taking the parent row with it — directly against
    // `onMissing: 'warn'` ("a broken ref never blocks a write") and against what
    // the per-type code it replaces did.
    const { db, deps, reader } = setup(linker);
    db.pragma('foreign_keys = ON');
    upsertProjectionRow(deps, linker, 'target-1', { label: 'target' }, 'user', WRITE_OPTS);

    const result = upsertProjectionRow(deps, linker, 'w1', {
      label: 'x', links: [{ target: 'target-1' }, { target: 'gone' }],
    }, 'user', WRITE_OPTS);

    expect(reader.getEntity('widget', 'w1')).not.toBeNull();
    expect(result.warnings?.join(' ')).toMatch(/references widget 'gone'/);
    expect(db.prepare('SELECT target FROM widget_links ORDER BY target').all()).toEqual([
      { target: 'target-1' },
    ]);
  });
});

describe('the delete door', () => {
  it('removes the row, its projection rows and its tags', () => {
    // Without a serviceless delete door, release restore's delete branch reported
    // a clean `noop` while the entity survived — telling the user a restore
    // succeeded that had not.
    const { db, deps, reader } = setup();
    upsertProjectionRow(deps, widget, 'w1', { label: 'x', notes: ['a'] }, 'user', WRITE_OPTS);
    db.prepare(`INSERT INTO tag (slug, name) VALUES ('t1', 'T1')`).run();
    db.prepare(`INSERT INTO entity_tag (entity_type, entity_slug, tag_slug) VALUES (?,?,?)`)
      .run('widget', 'w1', 't1');

    expect(removeProjectionRow(deps, widget, 'w1', 'user', WRITE_OPTS)).toEqual({ deleted: true });
    expect(reader.getEntity('widget', 'w1')).toBeNull();
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM entity_tag WHERE entity_type='widget' AND entity_slug='w1'`).get(),
    ).toEqual({ c: 0 });
  });

  it('reports deleted:false for a row that is not there', () => {
    const { deps } = setup();
    expect(removeProjectionRow(deps, widget, 'ghost', 'user', WRITE_OPTS)).toEqual({ deleted: false });
  });
});
