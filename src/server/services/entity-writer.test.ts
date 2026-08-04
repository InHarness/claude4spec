/**
 * 0.2.2 (brief items 7/8) collapsed seven per-type methods into ONE generic
 * `upsert(type, …)` dispatched by `host.getEntityService(type)` and driven by
 * shape. 0.2.9 (brief item 6) finishes the job: the service dispatch becomes a
 * PREFERENCE rather than the contract, and a type that declares `data.schema`
 * but ships no service is written by the host itself.
 *
 * What these tests pin, in order of how much they matter:
 *   - a serviceless type is WRITTEN, not skipped — 0.2.2's "active but
 *     unwritable" state is gone;
 *   - a type WITH a service still goes through it, because a service knows
 *     things the declaration does not;
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
  db.exec(`CREATE TABLE widget (slug TEXT NOT NULL PRIMARY KEY, label TEXT NOT NULL);`);
  return db;
}

function hostWith(services: Record<string, unknown>): PluginHost {
  return {
    // No modules by default: these cases are about SERVICE resolution, so the
    // serviceless door must stay out of the way. `hostWithModules` below opts in.
    getEntity: () => null,
    getEntityService: (type: string) => (services[type] ?? null) as never,
    requireService: (type: string) => {
      const s = services[type];
      if (!s) throw new Error(`entity service for type '${type}' not registered`);
      return s as never;
    },
    entityExists: (type: string, slug: string) => {
      const s = services[type] as { getBySlug?: (s: string) => unknown } | undefined;
      return s?.getBySlug ? s.getBySlug(slug) != null : false;
    },
  } as unknown as PluginHost;
}

const tags = { assignTags: vi.fn() } as unknown as TagsService;

describe('HostEntityWriter.upsert — generic dispatch', () => {
  it('drives the resolved service by shape and normalizes the canonical `entity` key', () => {
    const upsert = vi.fn(() => ({ entity: { slug: 'a' }, op: 'created' as const }));
    const writer = new HostEntityWriter(hostWith({ widget: { upsert } }), tags);

    expect(writer.upsert('widget', 'a', { x: 1 }, 'user')).toEqual({
      entity: { slug: 'a' },
      op: 'created',
    });
    // The write-path options are the writer's, not the caller's.
    expect(upsert).toHaveBeenCalledWith('a', { x: 1 }, 'user', { capture: true, writeFile: false });
  });

  it('gives a type the host has never heard of the same write door as a built-in', () => {
    // The pre-0.2.2 limitation this removes: a plugin type outside the hardcoded
    // seven had NO restore path at all.
    const upsert = vi.fn(() => ({ entity: { slug: 's1' }, op: 'updated' as const }));
    const writer = new HostEntityWriter(hostWith({ spreadsheet: { upsert } }), tags);
    expect(writer.upsert('spreadsheet', 's1', {}, 'agent')?.op).toBe('updated');
  });

  it('normalizes a legacy per-type payload key structurally, without naming it', () => {
    // `database-table` ships externally and still returns `.dbTable`. The rule is
    // "the single key that is not op/warnings", not an allowlist of key names.
    const upsert = vi.fn(() => ({ dbTable: { slug: 'users' }, op: 'created' as const }));
    const writer = new HostEntityWriter(hostWith({ 'database-table': { upsert } }), tags);
    expect(writer.upsert('database-table', 'users', {}, 'user')).toEqual({
      entity: { slug: 'users' },
      op: 'created',
    });
  });

  it('passes warnings through', () => {
    const upsert = () => ({ uiView: { slug: 'v' }, op: 'updated' as const, warnings: ['dangling'] });
    const writer = new HostEntityWriter(hostWith({ 'ui-view': { upsert } }), tags);
    expect(writer.upsert('ui-view', 'v', {}, 'user')).toEqual({
      entity: { slug: 'v' },
      op: 'updated',
      warnings: ['dangling'],
    });
  });

  it('surfaces the whole object when the payload key is ambiguous — and WARNS', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const upsert = () => ({ a: 1, b: 2, op: 'created' as const });
    const writer = new HostEntityWriter(hostWith({ odd: { upsert } }), tags);
    const result = writer.upsert('odd', 'x', {}, 'user');
    // Better an inspectable object than a silently-wrong arbitrary pick — but
    // returning a WRAPPER silently is no better than a wrong pick: downstream
    // serializers read fields off `.entity` to sync junctions and write files.
    expect(result?.entity).toEqual({ a: 1, b: 2, op: 'created' });
    expect(result?.warnings?.join(' ')).toMatch(/ambiguous \(a, b\).*no 'entity' alias/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("type 'odd'"));
    warn.mockRestore();
  });

  it('honours capture: false on the index-rebuild path', () => {
    const upsert = vi.fn(() => ({ entity: {}, op: 'created' as const }));
    const writer = new HostEntityWriter(hostWith({ ac: { upsert } }), tags, { capture: false });
    writer.upsert('ac', 'a', {}, 'user');
    expect(upsert).toHaveBeenCalledWith('a', {}, 'user', { capture: false, writeFile: false });
  });

  it('returns null — a reported SKIP, not a throw — when the type has no service', () => {
    const writer = new HostEntityWriter(hostWith({}), tags);
    expect(writer.upsert('ghost', 'g', {}, 'user')).toBeNull();
  });

  it('returns null when the service exists but exposes no upsert facade', () => {
    const writer = new HostEntityWriter(hostWith({ readonly: { getBySlug: () => null } }), tags);
    expect(writer.upsert('readonly', 'r', {}, 'user')).toBeNull();
  });
});

describe('HostEntityWriter.upsert — the serviceless door (0.2.9, brief item 6)', () => {
  const widgetModule = {
    type: 'widget',
    payloadVersion: 1,
    data: { schema: { label: { kind: 'string' as const, required: true } } },
  };

  function hostWithModules(
    services: Record<string, unknown>,
    modules: Record<string, unknown>,
  ): PluginHost {
    const base = hostWith(services) as unknown as Record<string, unknown>;
    return { ...base, getEntity: (type: string) => modules[type] ?? null } as unknown as PluginHost;
  }

  it('writes a type that declares data but contributes NO service', () => {
    // The state this removes: 0.2.2 made "active but unwritable" reachable. Such
    // a type could be read, indexed, searched and diffed, then silently dropped
    // by restore — the one operation that puts data back.
    const db = makeDb();
    const writer = new HostEntityWriter(
      hostWithModules({}, { widget: widgetModule }),
      tags,
      {},
      { db, versions: null },
    );

    const result = writer.upsert('widget', 'w1', { label: 'hello' }, 'user');
    expect(result?.op).toBe('created');
    expect(db.prepare('SELECT label FROM widget WHERE slug = ?').get('w1')).toEqual({
      label: 'hello',
    });
  });

  it('PREFERS the service when the type has one — the door is a fallback, not an override', () => {
    // Not merely an ordering preference: a service owns domain validation and
    // derived fields the declaration does not describe, so bypassing it where it
    // exists would write a row the type itself would never have written.
    const db = makeDb();
    const upsert = vi.fn(() => ({ entity: { slug: 'w1' }, op: 'updated' as const }));
    const writer = new HostEntityWriter(
      hostWithModules({ widget: { upsert } }, { widget: widgetModule }),
      tags,
      {},
      { db, versions: null },
    );

    expect(writer.upsert('widget', 'w1', { label: 'x' }, 'user')?.op).toBe('updated');
    expect(upsert).toHaveBeenCalledOnce();
    expect(db.prepare('SELECT COUNT(*) AS c FROM widget').get()).toEqual({ c: 0 });
  });

  it('still reports a SKIP for a type that is not active at all', () => {
    // The one surviving null case. "Deactivated, or carried by a bundle this
    // installation never had" must degrade to "not restored", never to "the
    // whole restore died".
    const writer = new HostEntityWriter(hostWithModules({}, {}), tags, {}, {
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
    const writer = new HostEntityWriter(hostWithModules({}, { widget: widgetModule }), tags);
    expect(writer.upsert('widget', 'w1', { label: 'x' }, 'user')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('without projection deps'));
    warn.mockRestore();
  });

  it('rejects a payload the declaration forbids instead of writing a broken row', () => {
    const db = makeDb();
    const writer = new HostEntityWriter(
      hostWithModules({}, { widget: widgetModule }),
      tags,
      {},
      { db, versions: null },
    );
    expect(() => writer.upsert('widget', 'w1', {}, 'user')).toThrow(DomainError);
    expect(db.prepare('SELECT COUNT(*) AS c FROM widget').get()).toEqual({ c: 0 });
  });
});

describe('HostEntityWriter.delete — generic, no per-type switch', () => {
  it('deletes through the resolved service', () => {
    const remove = vi.fn();
    const writer = new HostEntityWriter(
      hostWith({ widget: { getBySlug: () => ({ slug: 'a' }), remove } }),
      tags,
    );
    expect(writer.delete('widget' as never, 'a', 'user')).toEqual({ deleted: true });
    expect(remove).toHaveBeenCalledWith('a', 'user');
  });

  it('reports deleted:false for an absent row', () => {
    const writer = new HostEntityWriter(
      hostWith({ widget: { getBySlug: () => null, remove: vi.fn() } }),
      tags,
    );
    expect(writer.delete('widget' as never, 'missing', 'user')).toEqual({ deleted: false });
  });

  it('reports deleted:false — never throws — for a type with no service, but WARNS', () => {
    // deleted:false is ambiguous between "no delete door" and "nothing to
    // delete". Only the first is a problem, and pre-0.2.2 it threw and became a
    // `delete-restore failed: …` warning in the restore report. Without the
    // console warning a restore that should have deleted an entity reports a
    // clean noop while the entity survives.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const writer = new HostEntityWriter(hostWith({}), tags);
    expect(writer.delete('ghost' as never, 'g', 'user')).toEqual({ deleted: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot delete ghost/g'));
    warn.mockRestore();
  });

  it('does NOT warn for the benign case — service present, row simply absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const writer = new HostEntityWriter(
      hostWith({ widget: { getBySlug: () => null, remove: vi.fn() } }),
      tags,
    );
    expect(writer.delete('widget' as never, 'gone', 'user')).toEqual({ deleted: false });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

