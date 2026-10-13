/**
 * 2.1.17 (M33 L11 `m33l11sc`) — the plugin test harness, in process.
 *
 * `createPluginTestApp` builds the runtime's own `ProjectContext` on a throwaway
 * project (it needs the built envelope bundles, like every test that loads them —
 * `pretest`). The real-runtime half — a package outside the host repo, its bare
 * `@c4s/plugin-runtime` import, the published subpath — is
 * `plugin-testing.subprocess.test.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { PluginManifest } from '../../shared/plugin-host/manifest.js';
import { PluginManifestError } from '../core/plugin-host/manifest-adapter.js';
import { PluginRegistryImpl } from '../core/plugin-host/registry.js';
import { loadWorkspacePlugins } from '../core/plugin-host/loader.js';
import { createPluginTestApp, type PluginTestApp } from './index.js';

/** A plugin contributing one entity type the host has never heard of. */
function gadgetManifest(mount?: (ctx: Record<string, unknown>) => void): PluginManifest {
  return {
    name: '@acme/c4s-plugin-gadgets',
    version: '1.0.0',
    hostApiVersion: '^2.0.0',
    contributes: {
      entities: [
        {
          type: 'gadget',
          data: { schema: { title: { type: 'string', required: true, maxLength: 200 } } },
          slugPattern: [{ op: 'slugify', field: 'title' }],
          payloadVersion: 1,
          label: 'Gadget',
          labelPlural: 'Gadgets',
          displayOrder: 900,
          pathPrefix: '/gadgets',
          systemPrompt: { roleNoun: 'gadget', mcpToolsLine: 'gadget-tools: ...' },
          ...(mount ? { backend: { mount } } : {}),
        },
      ],
    },
  };
}

describe('createPluginTestApp — a real host in process', () => {
  const opened: PluginTestApp[] = [];
  afterEach(async () => {
    for (const t of opened.splice(0)) await t.cleanup();
  });
  async function open(manifests: PluginManifest[]): Promise<PluginTestApp> {
    const t = await createPluginTestApp(manifests);
    opened.push(t);
    return t;
  }

  it('[ac:ac-typ-encji-z-manifestu-przekazanego-do] a type from a passed manifest is active in the temporary project with no configuration', async () => {
    const t = await open([gadgetManifest()]);

    // No configuration: the temporary project's config.json carries no
    // `entities` whitelist, and nothing else was written to activate the type.
    const config = JSON.parse(fs.readFileSync(path.join(t.cwd, '.claude4spec', 'config.json'), 'utf8'));
    expect(config).not.toHaveProperty('entities');

    // Active on the host facade…
    expect(t.host.isActive('gadget')).toBe(true);
    expect(t.host.partition().active).toContain('gadget');
    // …next to the directly built-in types, which keep their default activation.
    expect(t.host.isActive('diagram')).toBe(true);

    // …and served: the generated CRUD route of an active type answers over HTTP.
    const created = await request(t.app).post(`${t.baseUrl}/gadgets`).send({ title: 'First gadget' });
    expect(created.status).toBe(201);
    expect(created.body.data.slug).toBe('first-gadget');
    const partition = await request(t.app).get(`${t.baseUrl}/_meta/entities`);
    expect(partition.status).toBe(200);
    expect(partition.body.active).toContain('gadget');
    expect(partition.body.inactive).not.toContain('gadget');
  }, 60_000);

  it('hands back the HTTP app, entity CRUD, host facade, working directory, db handle, captured broadcasts and cleanup', async () => {
    const t = await open([gadgetManifest()]);

    expect(t.baseUrl).toBe(`/api/projects/${t.projectId}`);
    expect(fs.existsSync(t.cwd)).toBe(true);

    t.broadcasts.length = 0;
    const result = await t.crud.create('gadget', { title: 'Via crud' }, 'user');
    expect(result.slug).toBe('via-crud');
    // The crud door broadcasts like the plugin's own `ctx.crud` does…
    expect(t.broadcasts).toContainEqual({ kind: 'entity:changed', entityType: 'gadget', slug: 'via-crud', action: 'create' });
    // …and the db handle sees the row, for assertions.
    const row = t.db.prepare('SELECT slug FROM gadget WHERE slug = ?').get('via-crud') as { slug: string } | undefined;
    expect(row?.slug).toBe('via-crud');

    const cwd = t.cwd;
    await t.cleanup();
    opened.splice(opened.indexOf(t), 1);
    // Cleanup removes the temporary directory (project + registry home).
    expect(fs.existsSync(cwd)).toBe(false);
    expect(fs.existsSync(path.dirname(cwd))).toBe(false);
  }, 60_000);

  it('[ac:ac-manifest-ktory-punkt-rejestracji-odrz] a manifest the registration point rejects under the loader is rejected with the same error', async () => {
    // Passes the loader's shape check and its version gate; the registration
    // point (`registerPlugin`) is what refuses it.
    const broken = { ...gadgetManifest(), name: '@acme/c4s-plugin-broken', contributes: 'nope' } as unknown as PluginManifest;

    const { records } = await loadWorkspacePlugins(new PluginRegistryImpl(), ['broken-pkg'], async () => ({ manifest: broken }));
    expect(records[0]).toMatchObject({ status: 'failed', code: 'PLUGIN_INVALID_MANIFEST' });
    const loaderReason = records[0]!.reason!;

    const rejection = await createPluginTestApp([broken]).then(
      (t) => {
        opened.push(t);
        return null;
      },
      (err: unknown) => err,
    );
    expect(rejection).toBeInstanceOf(PluginManifestError);
    expect((rejection as Error).message).toBe(loaderReason);
  }, 60_000);

  it('[ac:ac-mountcontext-pluginu-uruchomionego-pr] the MountContext of a plugin started by the harness does not carry the db handle the harness returns', async () => {
    let seen: Record<string, unknown> | null = null;
    const t = await open([gadgetManifest((ctx) => void (seen = ctx))]);

    // The plugin was mounted by the harness's context build…
    expect(seen).not.toBeNull();
    const ctx = seen as unknown as Record<string, unknown>;
    // …with no `db` slot (removed in Host API 2.0.0), and no slot holding the
    // handle the harness hands the test author. ASSUMPTION:dev-1701 — "contains"
    // is read as the context's own slots: the legacy `reader.db` escape hatch
    // (`HostEntityReader.db`, published and documented as the last one) is the
    // reader's, predates the harness and is not added by it.
    expect(ctx).not.toHaveProperty('db');
    for (const [key, value] of Object.entries(ctx)) {
      expect(value, `MountContext.${key}`).not.toBe(t.db);
    }
    // The handle is a real, working database — the test author's, not the plugin's.
    expect(t.db.prepare('SELECT 1 AS one').get()).toEqual({ one: 1 });
  }, 60_000);
});
