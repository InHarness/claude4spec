import type { BackendModule, MountContext } from '../../src/server/core/plugin-host/types.js';

export interface FixtureModuleOpts {
  /** Makes `serializer.snapshot` throw — for testing capture error handling. */
  snapshotThrows?: boolean;
  /**
   * Registers a `getBySlug`-capable entity service at mount time, so
   * `host.entityExists()` (and thus `entitiesRouter`'s `assertExists`)
   * resolves this type. Needed for anything driven through the HTTP router;
   * not needed for tests that call `VersionService` directly.
   */
  withEntityService?: boolean;
}

/**
 * A minimal, real (non-core) plugin module — distinct from every
 * `RawEntityType` — with its own migrated table and a real serializer.
 * Shared by `versions.test.ts` and `entities-router-generic-versions.test.ts`
 * to prove M17 capture/versions work generically for a plugin-contributed
 * type, not just the 7 hardcoded core ones.
 */
export function fixtureModule(type: string, opts: FixtureModuleOpts = {}): BackendModule {
  return {
    type,
    table: type,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 999,
    slugFrom: (d: unknown) => String((d as { slug?: string }).slug ?? ''),
    pathPrefix: `/${type}s`,
    serializer: {
      type,
      version: '1.0.0',
      snapshot: (entity: unknown) => {
        if (opts.snapshotThrows) throw new Error('boom: no snapshot support');
        const e = entity as { slug: string; data: Record<string, unknown> };
        return { slug: e.slug, ...e.data };
      },
    } as BackendModule['serializer'],
    systemPrompt: {
      roleNoun: type,
      countStat: { placeholder: `${type}Count`, sqlQuery: 'SELECT 0 AS count', label: type },
      mcpToolsLine: `${type}-tools: ...`,
    },
    backend: {
      migrations: [
        { version: 1, name: `create_${type}`, up: `CREATE TABLE ${type} (slug TEXT PRIMARY KEY NOT NULL, name TEXT);` },
      ],
      ...(opts.withEntityService
        ? {
            mount(ctx: MountContext) {
              ctx.registerEntityService(type, {
                getBySlug: (slug: string) => ctx.db.prepare(`SELECT * FROM ${type} WHERE slug = ?`).get(slug) ?? null,
              });
            },
          }
        : {}),
    },
  };
}
