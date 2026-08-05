/**
 * 0.2.2 (brief items 7/8) collapsed seven per-type methods into ONE generic
 * `upsert(type, …)` dispatched by `host.getEntityService(type)` and driven by
 * shape. 0.2.9 item 6 made that dispatch a preference rather than the contract;
 * **tier K removes it entirely** — there are no per-type CRUD services left.
 *
 * What these tests pin, in order of how much they matter:
 *   - every active type that declares `data.schema` is WRITTEN by the host —
 *     0.2.2's "active but unwritable" state is gone;
 *   - a registered `backend.service` is NOT consulted, even when it happens to
 *     expose an `upsert`-shaped method. After tier K that slot carries domain
 *     helpers (`ac`'s analysis service, `design-system`'s `resolve`), and
 *     by-shape probing is exactly how a helper would get mistaken for a write
 *     door;
 *   - the one surviving `null` means "type not active here", and nothing else;
 *   - a type the host has never heard of gets the same door as a built-in.
 */

import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { HostEntityWriter } from './entity-writer.js';
import { DomainError } from './tags.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { TagsService } from './tags.js';

/** The projection `generateProjectionDDL` would emit for the `widget` fixture. */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE widget (slug TEXT NOT NULL PRIMARY KEY, label TEXT NOT NULL);
    CREATE TABLE entity_tag (
      entity_type TEXT NOT NULL, entity_slug TEXT NOT NULL, tag_slug TEXT NOT NULL,
      UNIQUE(entity_type, entity_slug, tag_slug)
    );
  `);
  return db;
}

const widgetModule = {
  type: 'widget',
  payloadVersion: 1,
  data: { schema: { label: { kind: 'string' as const, required: true } } },
};

function hostWith(
  modules: Record<string, unknown>,
  services: Record<string, unknown> = {},
): PluginHost {
  return {
    getEntity: (type: string) => modules[type] ?? null,
    getEntityService: (type: string) => (services[type] ?? null) as never,
    requireService: (type: string) => {
      const s = services[type];
      if (!s) throw new Error(`entity service for type '${type}' not registered`);
      return s as never;
    },
    entityExists: () => false,
  } as unknown as PluginHost;
}

const tags = { assignTags: vi.fn() } as unknown as TagsService;

describe('HostEntityWriter.upsert — one door, the projection', () => {
  it('writes a type that declares data and contributes no service at all', () => {
    // The state this removes: 0.2.2 made "active but unwritable" reachable. Such
    // a type could be read, indexed, searched and diffed, then silently dropped
    // by restore — the one operation that puts data back.
    const db = makeDb();
    const writer = new HostEntityWriter(hostWith({ widget: widgetModule }), tags, {}, {
      db,
      versions: null,
    });

    const result = writer.upsert('widget', 'w1', { label: 'hello' }, 'user');
    expect(result?.op).toBe('created');
    expect(db.prepare('SELECT label FROM widget WHERE slug = ?').get('w1')).toEqual({
      label: 'hello',
    });
  });

  it('IGNORES a registered domain helper, even one shaped like a write door', () => {
    /**
     * The inverse of the test tier E shipped ("PREFERS the service when the type
     * has one"). That preference was correct while `backend.service` meant a CRUD
     * service; tier K deleted the six that were, and the slot now carries
     * `ac`'s analysis service and `design-system`'s `resolve`. Probing it for an
     * `upsert` method — which is how the old dispatch found it — would hand the
     * write path an object that never promised to be one.
     */
    const db = makeDb();
    const upsert = vi.fn(() => ({ entity: { slug: 'w1' }, op: 'updated' as const }));
    const writer = new HostEntityWriter(
      hostWith({ widget: widgetModule }, { widget: { upsert } }),
      tags,
      {},
      { db, versions: null },
    );

    expect(writer.upsert('widget', 'w1', { label: 'x' }, 'user')?.op).toBe('created');
    expect(upsert).not.toHaveBeenCalled();
    expect(db.prepare('SELECT label FROM widget WHERE slug = ?').get('w1')).toEqual({ label: 'x' });
  });

  it('gives a type the host has never heard of the same write door as a built-in', () => {
    // The pre-0.2.2 limitation this removes: a plugin type outside the hardcoded
    // seven had NO restore path at all.
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE spreadsheet (slug TEXT NOT NULL PRIMARY KEY, label TEXT NOT NULL);`);
    const writer = new HostEntityWriter(
      hostWith({ spreadsheet: { ...widgetModule, type: 'spreadsheet' } }),
      tags,
      {},
      { db, versions: null },
    );
    expect(writer.upsert('spreadsheet', 's1', { label: 'x' }, 'agent')?.op).toBe('created');
  });

  it('still reports a SKIP for a type that is not active at all', () => {
    // The one surviving null case. "Deactivated, or carried by a bundle this
    // installation never had" must degrade to "not restored", never to "the
    // whole restore died".
    const writer = new HostEntityWriter(hostWith({}), tags, {}, {
      db: makeDb(),
      versions: null,
    });
    expect(writer.upsert('ghost', 'g', {}, 'user')).toBeNull();
  });

  it('WARNS rather than silently skipping when the writer has no projection deps', () => {
    // An active, schema-declaring type reaching the null branch is a wiring bug,
    // not a data condition — and it would otherwise read exactly like a
    // deactivated type.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const writer = new HostEntityWriter(hostWith({ widget: widgetModule }), tags);
    expect(writer.upsert('widget', 'w1', { label: 'x' }, 'user')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('without projection deps'));
    warn.mockRestore();
  });

  it('assigns tags — existence is asked of the ROW', () => {
    // `host.entityExists` answered through the entity-SERVICE registry, so for a
    // serviceless type it said `false` no matter what was in the table, and
    // `syncTags` returned without assigning. Every such entity came out of the
    // rebuild with zero tags (the rebuild clears `entity_tag` for the types it
    // is about to refill), and the next `persist` wrote that empty list back
    // into the file — destroying the tags at their source. Tier K removed the
    // service fast path entirely, so the row is the only answer there is.
    const db = makeDb();
    const assignTags = vi.fn();
    const writer = new HostEntityWriter(
      hostWith({ widget: widgetModule }),
      { assignTags } as unknown as TagsService,
      {},
      { db, versions: null },
    );

    writer.upsert('widget', 'w1', { label: 'x' }, 'user');
    writer.syncTags('widget' as never, 'w1', ['t1', 't2']);
    expect(assignTags).toHaveBeenCalledWith('widget', 'w1', ['t1', 't2']);
  });

  it('still declines to tag an entity that was never written', () => {
    const assignTags = vi.fn();
    const writer = new HostEntityWriter(
      hostWith({ widget: widgetModule }),
      { assignTags } as unknown as TagsService,
      {},
      { db: makeDb(), versions: null },
    );
    writer.syncTags('widget' as never, 'ghost', ['t1']);
    expect(assignTags).not.toHaveBeenCalled();
  });

  it('rejects a payload the declaration forbids instead of writing a broken row', () => {
    const db = makeDb();
    const writer = new HostEntityWriter(hostWith({ widget: widgetModule }), tags, {}, {
      db,
      versions: null,
    });
    expect(() => writer.upsert('widget', 'w1', {}, 'user')).toThrow(DomainError);
    expect(db.prepare('SELECT COUNT(*) AS c FROM widget').get()).toEqual({ c: 0 });
  });
});

describe('HostEntityWriter.delete — generic, no per-type switch', () => {
  it('deletes through the host projection door', () => {
    // Item 6 closed the silent drop on the create/update half; without this it
    // stayed wide open on the delete half, so release restore reported `noop`
    // while the entity survived.
    const db = makeDb();
    const writer = new HostEntityWriter(hostWith({ widget: widgetModule }), tags, {}, {
      db,
      versions: null,
    });
    writer.upsert('widget', 'w1', { label: 'x' }, 'user');
    expect(writer.delete('widget' as never, 'w1', 'user')).toEqual({ deleted: true });
    expect(db.prepare('SELECT COUNT(*) AS c FROM widget').get()).toEqual({ c: 0 });
  });

  it('reports deleted:false for an absent row, without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const writer = new HostEntityWriter(hostWith({ widget: widgetModule }), tags, {}, {
      db: makeDb(),
      versions: null,
    });
    expect(writer.delete('widget' as never, 'missing', 'user')).toEqual({ deleted: false });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reports deleted:false — never throws — for an inactive type, but WARNS', () => {
    // deleted:false is ambiguous between "no delete door" and "nothing to
    // delete". Only the first is a problem, and pre-0.2.2 it threw and became a
    // `delete-restore failed: …` warning in the restore report. Without the
    // console warning a restore that should have deleted an entity reports a
    // clean noop while the entity survives.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const writer = new HostEntityWriter(hostWith({}), tags, {}, { db: makeDb(), versions: null });
    expect(writer.delete('ghost' as never, 'g', 'user')).toEqual({ deleted: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot delete ghost/g'));
    warn.mockRestore();
  });
});
