/**
 * 2.1.20 (M33 `ywud56l6`) — the host repo's internal test setup, in process.
 *
 * `createPluginTestApp` builds the runtime's own `ProjectContext` on a throwaway
 * project (it needs the built envelope bundles, like every test that loads them —
 * `pretest`). Until 2.1.20 this module was published as
 * `@inharness-ai/claude4spec/plugin-testing`; it no longer is (M33 `m33l11sc`:
 * the harness is an intent, not a contract), so the cases that pinned the
 * published subpath — the external-package probe, the bare-import resolution
 * through it, the loader-parity rejection — left with it.
 *
 * ASSUMPTION:dev-2002 — `ac-autor-pluginu-typuje-test-przez-d-ts` and
 * `ac-test-integracyjny-pakietu-pluginu-spo` are still active at 2.1.20 but name
 * the published `…/plugin-testing` subpath, which the page withdraws; their
 * tests went with the subpath and no test carries their slugs.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { PluginManifest } from '../../src/shared/plugin-host/manifest.js';
import { createPluginTestApp, type PluginTestApp } from '../helpers/plugin-test-setup.js';

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
          pathPrefix: '/gadgets',
          systemPrompt: { roleNoun: 'gadget', mcpToolsLine: 'gadget-tools: ...' },
          ...(mount ? { backend: { mount } } : {}),
        },
      ],
    },
  };
}

describe('createPluginTestApp (internal test setup) — a real host in process', () => {
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
    // …next to the built-in envelopes' types (here `diagram`, from the prebuilt
    // envelope), which keep their default activation.
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

  it('cleanup right after creation leaves nothing running: no background indexer logs after cleanup resolved, nothing left on disk', async () => {
    // The context's boot passes (section/todos/link indexers, file-version and
    // frontmatter baselines) run in the background of `buildProjectContext`. A
    // cleanup that removed the directory under them made them log ENOENT after
    // the test file ended — vitest's "Closing rpc while onUserConsoleLog was
    // pending" teardown error, a red suite for every harness user.
    const errors = vi.spyOn(console, 'error');
    const warns = vi.spyOn(console, 'warn');
    try {
      const t = await createPluginTestApp([gadgetManifest()]);
      const tmp = path.dirname(t.cwd);
      await t.cleanup();
      expect(fs.existsSync(tmp)).toBe(false);

      // Flush: microtasks, I/O callbacks and timers that a still-running boot
      // pass would need to reach its catch-and-log.
      for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setTimeout(r, 250));

      const logged = [...errors.mock.calls, ...warns.mock.calls].map((args) => args.map(String).join(' '));
      expect(logged.filter((line) => /indexer|file-version|sidebar accordions|ENOENT/.test(line))).toEqual([]);
      expect(logged.filter((line) => line.includes(tmp))).toEqual([]);
    } finally {
      errors.mockRestore();
      warns.mockRestore();
    }
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
