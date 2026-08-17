import type { BackendModule, MountContext } from '../../src/server/core/plugin-host/types.js';
import type { DataDeclaration } from '../../src/shared/plugin-host/data-schema.js';
import type { SlugPattern } from '../../src/shared/plugin-host/slug-pattern.js';

export interface FixtureModuleOpts {
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
 * The schema every fixture type declares unless it says otherwise: the reserved
 * `title`, which is also what its slug pattern reads. Minimal on purpose — a
 * fixture exists to prove the host treats a plugin-contributed type exactly like
 * a built-in one, so the less it declares the stronger that claim is.
 *
 * 0.2.22 — this was a required `name`. It could not stay: `title` is required on
 * every registered type, so a fixture without one no longer registers, and
 * keeping an unused `name` beside it would have the fixture declaring a field no
 * built-in type has.
 */
export const FIXTURE_DATA: DataDeclaration = {
  schema: {
    // `default` so a fixture's write payloads stay about whatever they are
    // testing: `title` is required on every type now, and threading a label
    // through a hundred collection/projection assertions would say nothing.
    title: { type: 'string', required: true, maxLength: 200, default: 'Untitled' },
  },
};

export const FIXTURE_SLUG_PATTERN: SlugPattern = [{ op: 'slugify', field: 'title' }];

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
    // 0.2.24 — no serialization slot at all. `payloadVersion: 1` above is the
    // whole contribution a type with no diff and no migrations makes.
    systemPrompt: {
      roleNoun: type,
      mcpToolsLine: `${type}-tools: ...`,
    },
    backend: {
      ...(opts.withEntityService
        ? {
            // A.8: `ctx.db` is gone — the reader is what a mount gets to read
            // with, and it is all this stub ever needed.
            mount(ctx: MountContext) {
              ctx.registerEntityService(type, {
                getBySlug: (slug: string) => ctx.reader.getEntity(type, slug),
              });
            },
          }
        : {}),
    },
  };
}
