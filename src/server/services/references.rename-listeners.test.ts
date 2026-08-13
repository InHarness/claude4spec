import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
/**
 * A rename fans out to one listener per module, and since 2.0.0 the host GENERATES
 * those listeners from the modules' `ref` flags.
 *
 * Two rounds of removing per-type knowledge got here. 0.2.2 took three hardcoded
 * branches out of ReferencesService, each naming another module's table
 * (`type === 'dto'` re-persisted endpoint files, `type === 'design-system'`
 * repointed `ui_view.design_system_slug`, any rename rewrote `ac.verifies[]`),
 * and gave each module a `backend.onEntityRenamed` hook instead. 2.0.0 removes
 * the hook too: the three hooks were three spellings of one rule, and
 * `data.schema` already says which fields hold a reference.
 */

import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { applyProjection } from '../db/projection.js';
import { PluginRegistryImpl } from '../core/plugin-host/registry.js';
import { registerRefRewriteListeners, synthesizeMount } from '../core/plugin-host/manifest-adapter.js';
import type { EntityStore } from './entity-store.js';
import type { DataDeclaration } from '../../shared/plugin-host/data-schema.js';
import type { BackendModule, EntityRenamedEvent, MountContext } from '../core/plugin-host/types.js';

/** `FIXTURE_DATA` plus one scalar reference to `dto` — the minimum that earns a listener. */
const REFERENCING_DATA: DataDeclaration = {
  schema: {
    title: { kind: 'string', required: true, maxLength: 200, default: 'Untitled' },
...FIXTURE_DATA.schema,
    dtoSlug: { kind: 'string', ref: 'dto', onMissing: 'warn', onDelete: 'leave-dangling' },
  },
};

function fixture(type: string, data: DataDeclaration): BackendModule {
  return synthesizeMount({
    type,
    data,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 900,
    pathPrefix: `/${type}s`,
    serializer: {} as BackendModule['serializer'],
    systemPrompt: { roleNoun: type },
  } as BackendModule);
}

function mountWith(modules: BackendModule[]) {
  const registry = new PluginRegistryImpl();
  for (const m of modules) registry.registerEntityModule(m);
  const host = registry.consolidate(null);
  const db = createTestDb();
  applyProjection(db, modules);
  // The generated listener re-persists the files of whatever it changed; these
  // fixture types have no directory in the file store, so the store is a spy.
  const entityStore = { persist: () => {} } as unknown as EntityStore;
  const ctx = {
    host,
    entityStore,
    registerRenameListener: (fn: (ev: EntityRenamedEvent) => void) => host.registerRenameListener(fn),
    registerMcpServer: () => {},
    registerEntityService: () => {},
  } as unknown as MountContext;
  for (const m of modules) m.backend?.mount?.(ctx);
  /**
   * 2.0.0 (A.8) — the rename listeners are registered HERE, once over every
   * module, not from inside each type's synthesized `mount`. Mirrors what
   * `ProjectContext` does immediately after `mountBackend`.
   */
  registerRefRewriteListeners(host, db, entityStore);
  return { host, db };
}

describe('rename listeners', () => {
  it('generates a listener for a module that declares a ref, and repoints it', () => {
    const { host, db } = mountWith([fixture('widget', REFERENCING_DATA)]);
    try {
      expect(host.listRenameListeners()).toHaveLength(1);
      db.prepare('INSERT INTO widget (slug, name, dto_slug) VALUES (?, ?, ?)').run('w1', 'W', 'user-dto');

      for (const fn of host.listRenameListeners()) fn({ type: 'dto', oldSlug: 'user-dto', newSlug: 'account-dto' });

      expect(db.prepare('SELECT dto_slug FROM widget WHERE slug = ?').get('w1')).toEqual({
        dto_slug: 'account-dto',
      });
    } finally {
      db.close();
    }
  });

  it('still generates the listener for a module with its own backend.mount', () => {
    // The escape hatch replaces the slots `synthesizeMount` synthesizes. Rename
    // propagation is not one of them — it is derived from `data.schema`, which a
    // hand-written `mount` does not override, and there is no `onEntityRenamed`
    // slot left to opt back in with.
    //
    // 2.0.0 (A.8): this used to be true only because `synthesizeMount` COMPOSED
    // a closure around the hand-written mount to bolt the listener on. Now that
    // registration is a separate pass over every module, a `mount` module gets
    // it by the same path as everything else — and this test proves the escape
    // hatch still runs alongside it rather than instead of it.
    let ownMountRan = false;
    const withMount = synthesizeMount({
      type: 'widget',
      data: REFERENCING_DATA,
      slugPattern: FIXTURE_SLUG_PATTERN,
      payloadVersion: 1,
      label: 'widget',
      labelPlural: 'widgets',
      displayOrder: 900,
      pathPrefix: '/widgets',
      serializer: {} as BackendModule['serializer'],
      systemPrompt: { roleNoun: 'widget' },
      backend: {
        mount: () => {
          ownMountRan = true;
        },
      },
    } as BackendModule);

    const { host, db } = mountWith([withMount]);
    try {
      expect(ownMountRan).toBe(true);
      expect(host.listRenameListeners()).toHaveLength(1);
      db.prepare('INSERT INTO widget (slug, name, dto_slug) VALUES (?, ?, ?)').run('w1', 'W', 'user-dto');

      for (const fn of host.listRenameListeners()) fn({ type: 'dto', oldSlug: 'user-dto', newSlug: 'account-dto' });

      expect(db.prepare('SELECT dto_slug FROM widget WHERE slug = ?').get('w1')).toEqual({
        dto_slug: 'account-dto',
      });
    } finally {
      db.close();
    }
  });

  it('generates NO listener for a module that references nothing', () => {
    // The declaration is the whole condition. A type with no `ref` has nothing to
    // repoint, and registering a listener that can only ever no-op would put every
    // active type on the path of every rename.
    const { host, db } = mountWith([fixture('gadget', FIXTURE_DATA)]);
    try {
      expect(host.listRenameListeners()).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('tells every referencing module about every rename — the ref flag does the filtering', () => {
    const { host, db } = mountWith([
      fixture('widget', REFERENCING_DATA),
      fixture('gadget', REFERENCING_DATA),
    ]);
    try {
      expect(host.listRenameListeners()).toHaveLength(2);
      db.prepare('INSERT INTO widget (slug, name, dto_slug) VALUES (?, ?, ?)').run('w1', 'W', 'user-dto');
      db.prepare('INSERT INTO gadget (slug, name, dto_slug) VALUES (?, ?, ?)').run('g1', 'G', 'user-dto');

      // A rename of a type NEITHER module references must leave both alone —
      // that filtering used to be an `if (type !== 'dto') return;` in each hook.
      for (const fn of host.listRenameListeners()) fn({ type: 'ac', oldSlug: 'user-dto', newSlug: 'account-dto' });
      expect(db.prepare('SELECT dto_slug FROM widget WHERE slug = ?').get('w1')).toEqual({ dto_slug: 'user-dto' });

      for (const fn of host.listRenameListeners()) fn({ type: 'dto', oldSlug: 'user-dto', newSlug: 'account-dto' });
      expect(db.prepare('SELECT dto_slug FROM widget WHERE slug = ?').get('w1')).toEqual({ dto_slug: 'account-dto' });
      expect(db.prepare('SELECT dto_slug FROM gadget WHERE slug = ?').get('g1')).toEqual({ dto_slug: 'account-dto' });
    } finally {
      db.close();
    }
  });
});

describe('ReferencesService fan-out', () => {
  it('propagates a dto rename into endpoint files, without naming the pair', async () => {
    // End-to-end through the real modules: the endpoint module's listener is what
    // re-persists the file, and the host never mentions dto, endpoint or the
    // junction. Asserted on the effect, not on the branch that used to exist.
    const app = await createTestApp();
    try {
      // 2.0.0 tier K: written through the REST surface rather than through
      // `requireService`, which no longer hands back a write door for either
      // type. Same production path a client takes.
      await request(app.app).post('/api/dtos').send({ name: 'UserDto', fields: [] }).expect(201);
      await request(app.app)
        .post('/api/endpoints')
        .send({ method: 'GET', path: '/users', summary: 'list' })
        .expect(201);
      await request(app.app)
        .post('/api/endpoints/get-users/dtos')
        .send({ dtoSlug: 'user-dto', relation: 'response', statusCode: 200 })
        .expect(201);

      // Production order: the row rename lands first (the junction follows it
      // through ON UPDATE CASCADE), and only then is the change propagated into
      // other entities' FILES — which still embed the old slug.
      app.db.prepare('UPDATE dto SET slug = ? WHERE slug = ?').run('account-dto', 'user-dto');
      expect(
        app.db.prepare("SELECT dto_slug FROM endpoint_dto WHERE endpoint_slug = 'get-users'").get(),
      ).toEqual({ dto_slug: 'account-dto' });

      const persist = vi.spyOn(app.entityStore, 'persist');
      await app.referencesService.propagateSlugChange('dto', 'user-dto', 'account-dto');

      // If nothing else, the endpoint file must have been rewritten — that is
      // the whole point of the listener.
      const persisted = persist.mock.calls.map((c) => `${String(c[0])}:${String(c[1])}`);
      expect(persisted).toContain('endpoint:get-users');
      persist.mockRestore();
    } finally {
      app.cleanup();
    }
  });
});
