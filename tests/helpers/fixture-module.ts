import type { BackendModule, MountContext } from '../../src/server/core/plugin-host/types.js';
import type { DataDeclaration } from '../../src/shared/plugin-host/data-schema.js';
import type { SlugPattern } from '../../src/shared/plugin-host/slug-pattern.js';

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
  /** Override the declared schema — for validator tests that need a specific shape. */
  data?: DataDeclaration;
  /** Override the declared slug pattern. */
  slugPattern?: SlugPattern;
}

/**
 * The schema every fixture type declares unless it says otherwise: one required
 * `name`, which is also what its slug pattern reads. Minimal on purpose — a
 * fixture exists to prove the host treats a plugin-contributed type exactly like
 * a built-in one, so the less it declares the stronger that claim is.
 */
export const FIXTURE_DATA: DataDeclaration = {
  schema: { name: { kind: 'string', required: true } },
};

export const FIXTURE_SLUG_PATTERN: SlugPattern = [{ op: 'slugify', field: 'name' }];

/**
 * A minimal, real (non-core) plugin module — distinct from every
 * `RawEntityType` — with a generated projection and a real serializer.
 *
 * Host API 2.0.0: it no longer ships `backend.migrations`; the table comes from
 * `data.schema` through `applyProjection`, the same path the built-in types take.
 * That is the point of the fixture — a type the host has never heard of gets its
 * table, its slug rule and its counts from the same machinery.
 */
export function fixtureModule(type: string, opts: FixtureModuleOpts = {}): BackendModule {
  return {
    type,
    data: opts.data ?? FIXTURE_DATA,
    slugPattern: opts.slugPattern ?? FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 999,
    pathPrefix: `/${type}s`,
    serializer: {
      payloadVersion: 1,
      snapshot: (entity: unknown) => {
        if (opts.snapshotThrows) throw new Error('boom: no snapshot support');
        const e = entity as { slug: string; data: Record<string, unknown> };
        return { slug: e.slug, ...e.data };
      },
    } as BackendModule['serializer'],
    systemPrompt: {
      roleNoun: type,
      mcpToolsLine: `${type}-tools: ...`,
    },
    backend: {
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
