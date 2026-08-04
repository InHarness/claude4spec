/**
 * The read half of a projected collection, checked against the WRITE half.
 *
 * `projection-read.ts` is the mirror of `syncProjectionTable`, and the only
 * thing that makes it correct is that the mirroring is exact. So these tests do
 * not assert on SQL: they write through the real generic write path and read
 * back through the real reader, which is the pair the generated snapshot sits
 * between. A column mapping that disagrees in one direction is a collection that
 * silently loses a field on every rebuild.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyProjection } from './projection.js';
import { readProjectionCollection } from './projection-read.js';
import { upsertProjectionRow, type WritableModule } from './projection-write.js';
import { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { CollectionNode } from '../../shared/plugin-host/data-schema.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

const WRITE_OPTS = { capture: false, writeFile: false };

/**
 * Modelled on `endpoint`: a value collection that declares `keyFields`, so it
 * gets a table of its own, whose item carries a `column` alias (`dto` →
 * `dto_slug`) and a nullable number (`statusCode` → `status_code`). Both are the
 * cases where field name and column name diverge, which is the whole point.
 */
const widget: WritableModule = {
  type: 'widget',
  payloadVersion: 1,
  data: {
    schema: {
      label: { kind: 'string', required: true },
      links: {
        kind: 'collection',
        collection: 'value',
        projectionTable: 'widget_link',
        keyFields: ['target', 'relation'],
        item: {
          kind: 'object',
          fields: {
            target: { kind: 'string', column: 'target_slug', required: true },
            relation: { kind: 'enum', values: ['a', 'b'], required: true },
            statusCode: { kind: 'number', column: 'status_code' },
            enabled: { kind: 'boolean' },
          },
        },
      },
      // A scalar item: one synthetic `value` column, and it must read back as a
      // bare list rather than a list of one-key objects.
      notes: {
        kind: 'collection',
        collection: 'value',
        keyFields: ['value'],
        item: { kind: 'string' },
      },
      createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
      updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
    },
  },
};

function hostFor(module: WritableModule): ProjectPluginHost {
  return {
    getEntity: (t: string) => (t === module.type ? module : null),
    getAvailable: (t: string) => (t === module.type ? module : null),
    listEntities: () => [module],
    listAvailable: () => [module],
    isActive: () => true,
  } as unknown as ProjectPluginHost;
}

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tag (slug TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE entity_tag (entity_type TEXT, entity_slug TEXT, tag_slug TEXT);
  `);
  applyProjection(db, [widget]);
});
afterEach(() => db.close());

function write(payload: Record<string, unknown>): void {
  upsertProjectionRow({ db, versions: null }, widget, 'w1', payload, 'user', WRITE_OPTS);
}

const links = () =>
  readProjectionCollection(db, widget, 'links', widget.data!.schema.links as CollectionNode, 'w1');
const notes = () =>
  readProjectionCollection(db, widget, 'notes', widget.data!.schema.notes as CollectionNode, 'w1');

describe('readProjectionCollection', () => {
  it('reads items back keyed by FIELD name, not by column name', () => {
    write({
      label: 'w',
      links: [{ target: 'x', relation: 'a', statusCode: 200, enabled: true }],
    });
    // `target_slug`/`status_code` are what SQLite holds; a snapshot is keyed by
    // what the type declared, so this is the mapping the generator depends on.
    expect(links()).toEqual([{ target: 'x', relation: 'a', statusCode: 200, enabled: true }]);
  });

  it('keeps a NULL optional field as null rather than inventing a zero value', () => {
    // The endpoint case: `status_code` is nullable and part of the sort key, so
    // a coercion to 0 would both fabricate content and reorder the snapshot.
    write({ label: 'w', links: [{ target: 'x', relation: 'a' }] });
    expect(links()).toEqual([{ target: 'x', relation: 'a', statusCode: null, enabled: null }]);
  });

  it('decodes a boolean back from the 0/1 the writer stored', () => {
    write({ label: 'w', links: [{ target: 'x', relation: 'a', enabled: false }] });
    expect(links()[0]).toMatchObject({ enabled: false });
  });

  it('reads a scalar-item collection as bare values, the shape that was written', () => {
    write({ label: 'w', notes: ['beta', 'alpha'] });
    expect(notes()).toEqual(['beta', 'alpha']);
  });

  it('preserves insertion order, so an ordered collection keeps its authored order', () => {
    // Sorting belongs to the snapshot generator (and only for `unordered`
    // collections), not to SQL — otherwise there are two places deciding what
    // "sorted" means and they get to disagree.
    write({
      label: 'w',
      links: [
        { target: 'z', relation: 'a' },
        { target: 'a', relation: 'b' },
      ],
    });
    expect(links().map((l) => (l as { target: string }).target)).toEqual(['z', 'a']);
  });

  it('answers [] for a table that does not exist instead of throwing', () => {
    // A type can be active with its projection unapplied — an envelope that
    // failed to build, a database predating the type. A snapshot that 500s on
    // that takes a whole release restore down with it.
    const ghost = { ...widget, type: 'ghost' } as WritableModule;
    expect(
      readProjectionCollection(db, ghost, 'links', widget.data!.schema.links as CollectionNode, 'w1'),
    ).toEqual([]);
  });

  it('answers [] through the reader for an unknown type or an undeclared field', () => {
    const reader = new RawEntityReader(db, hostFor(widget));
    expect(reader.readCollection('ghost', 'w1', 'links')).toEqual([]);
    expect(reader.readCollection('widget', 'w1', 'nope')).toEqual([]);
    // `label` is a scalar, not a collection — asking for it as one is a caller
    // bug, and answering [] keeps it from becoming a crash in a restore loop.
    expect(reader.readCollection('widget', 'w1', 'label')).toEqual([]);
  });
});
