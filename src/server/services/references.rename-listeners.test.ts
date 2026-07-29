/**
 * 0.2.2 — a rename fans out to the modules that declared `backend.onEntityRenamed`.
 *
 * Before this, ReferencesService carried three hardcoded branches, each naming
 * another module's table: `type === 'dto'` re-persisted endpoint files,
 * `type === 'design-system'` repointed `ui_view.design_system_slug`, and any
 * rename rewrote `ac.verifies[]`. The host now knows only that a rename
 * happened.
 */

import { describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { PluginRegistryImpl } from '../core/plugin-host/registry.js';
import { synthesizeMount } from '../core/plugin-host/manifest-adapter.js';
import type { BackendModule, EntityRenamedEvent, MountContext } from '../core/plugin-host/types.js';

/** A module that does nothing but record the renames it is told about. */
function listenerModule(type: string, onRenamed: (ev: EntityRenamedEvent) => void): BackendModule {
  return synthesizeMount({
    type,
    table: type.replace(/-/g, '_'),
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 900,
    pathPrefix: `/${type}s`,
    slugFrom: () => 'x',
    serializer: {} as BackendModule['serializer'],
    systemPrompt: { roleNoun: type },
    backend: { onEntityRenamed: onRenamed },
  } as BackendModule);
}

function mountWith(modules: BackendModule[]) {
  const registry = new PluginRegistryImpl();
  for (const m of modules) registry.registerEntityModule(m);
  const host = registry.consolidate(null);
  const db = createTestDb();
  const ctx = {
    db,
    host,
    registerRenameListener: (fn: (ev: EntityRenamedEvent) => void) => host.registerRenameListener(fn),
    registerMcpServer: () => {},
    registerEntityService: () => {},
  } as unknown as MountContext;
  for (const m of modules) m.backend?.mount?.(ctx);
  return { host, db };
}

describe('rename listeners', () => {
  it('registers a module’s onEntityRenamed through synthesizeMount', () => {
    const seen: EntityRenamedEvent[] = [];
    const { host, db } = mountWith([listenerModule('widget', (ev) => seen.push(ev))]);
    try {
      expect(host.listRenameListeners()).toHaveLength(1);
      for (const fn of host.listRenameListeners()) fn({ type: 'dto', oldSlug: 'a', newSlug: 'b' });
      expect(seen).toEqual([{ type: 'dto', oldSlug: 'a', newSlug: 'b' }]);
    } finally {
      db.close();
    }
  });

  it('tells every module about every rename — filtering is the module’s job', () => {
    const a: string[] = [];
    const b: string[] = [];
    const { host, db } = mountWith([
      listenerModule('widget', (ev) => a.push(ev.type)),
      listenerModule('gadget', (ev) => b.push(ev.type)),
    ]);
    try {
      for (const fn of host.listRenameListeners()) fn({ type: 'dto', oldSlug: 'a', newSlug: 'b' });
      expect(a).toEqual(['dto']);
      expect(b).toEqual(['dto']);
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
      const dto = app.host.requireService('dto') as {
        upsert(slug: string, input: unknown, actor: string): { entity: { slug: string } };
      };
      dto.upsert('user-dto', { name: 'UserDto', fields: [] }, 'user');

      const endpoint = app.host.requireService('endpoint') as {
        upsert(slug: string, input: unknown, actor: string): { entity: { slug: string } };
        linkDto(endpointSlug: string, dtoSlug: string, relation: string, statusCode?: number | null): void;
      };
      endpoint.upsert('get-users', { method: 'GET', path: '/users', summary: 'list' }, 'user');
      endpoint.linkDto('get-users', 'user-dto', 'response', 200);

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
