import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
import { describe, expect, it, vi } from 'vitest';
import {
  assertSerializationContribution,
  lowerEntityContribution,
  PluginManifestError,
  synthesizeMount,
} from './manifest-adapter.js';
import type { EntityContribution } from '../../../shared/plugin-host/manifest.js';
import type { MountContext } from './types.js';

function base(over: Partial<EntityContribution> = {}): EntityContribution {
  return {
    type: 'glossary',
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: 'Glossary',
    labelPlural: 'Glossary',
    displayOrder: 100,
    pathPrefix: '/glossary',
    systemPrompt: {
      roleNoun: 'Glossary',
      mcpToolsLine: 'glossary-tools: ...',
    },
    ...over,
  };
}

describe('lowerEntityContribution', () => {
  it('passes through an explicit mount hook', () => {
    const mount = vi.fn();
    const mod = lowerEntityContribution(base({ backend: { mount } }));
    expect(mod.backend?.mount).toBe(mount);
  });

  it('copies the manifest fields and serializer/systemPrompt', () => {
    const mod = lowerEntityContribution(base());
    expect(mod.type).toBe('glossary');
    expect(mod.pathPrefix).toBe('/glossary');
    expect(mod.payloadVersion).toBeDefined();
    expect(mod.systemPrompt.roleNoun).toBe('Glossary');
  });

  it('[ac:ac-kazdy-typ-deklaruje-payloadversion-pl] throws PluginManifestError on a missing required field', () => {
    for (const field of ['data', 'slugPattern', 'payloadVersion'] as const) {
      expect(() => lowerEntityContribution(base({ [field]: undefined })), field).toThrow(
        PluginManifestError,
      );
    }
  });

  /**
   * A 1.x manifest is REJECTED, not tolerated. Its DDL, its slug function and
   * its snapshot all describe a contract the host no longer honours, so loading
   * it would produce a type whose table is never created and whose slugs are
   * never generated. The semver gate catches the well-behaved case — a declared
   * `hostApiVersion` range — and this catches the manifest that lies about its
   * range, with the same migration line `plugins doctor` prints.
   */
  it.each([
    ['slugFrom', { slugFrom: (() => 'x') as never }, /slugPattern/],
    ['table', { table: 'thing' as never }, /data\.schema/],
    ['composition', { composition: {} as never }, /data\.schema/],
  ])('rejects the removed 1.x slot %s and names its successor', (_slot, extra, successor) => {
    expect(() => lowerEntityContribution(base(extra))).toThrow(successor);
  });

  it.each([
    ['migrations', { migrations: [] }, /data\.schema/],
    ['auxTables', { auxTables: ['thing_tag'] }, /data\.schema/],
    // 2.0.0 (tier D): a manifest that migrated its projection and left the rename
    // hook behind READS as migrated. Dropping the slot silently would leave that
    // plugin's references rotting on every rename, and if the reference is not
    // expressible as a `ref` flag the author has to hear it now.
    ['onEntityRenamed', { onEntityRenamed: () => {} }, /ref: '<type>'/],
  ])('rejects the removed backend slot %s and names its successor', (_slot, extra, successor) => {
    expect(() => lowerEntityContribution(base({ backend: extra as never }))).toThrow(successor);
  });
});

/**
 * The closed list of imperative envelope callbacks is EMPTY: `snapshot` and
 * `restore` are not authorable slots, the host generates both from the type's
 * logical `data.schema`. `REMOVED_SERIALIZER_SLOTS` has carried them since tier
 * B PR2, but nothing fed it those keys — and a rejection nobody exercises is a
 * rejection that survives exactly until someone reorders the list.
 *
 * Rejected rather than ignored on purpose: a package still shipping `snapshot`
 * believes it owns its file format, so silently dropping the slot would leave
 * the host writing a payload that package's own read path disagrees with.
 */
describe('assertSerializationContribution — snapshot/restore are not authorable', () => {
  it.each([
    ['snapshot', { snapshot: () => ({}) }],
    ['restore', { restore: () => {} }],
  ])(
    '[ac:ac-snapshot-i-restore-nie-sa-slotami-aut] rejects an authored `%s` slot, naming data.schema as its successor',
    (slot, serializer) => {
      const module = { serializer };
      expect(() => assertSerializationContribution('widget', module, 1)).toThrow(PluginManifestError);
      expect(() => assertSerializationContribution('widget', module, 1)).toThrow(
        new RegExp(`serializer\\.${slot}\`? was removed in Host API 2\\.0\\.0`),
      );
      expect(() => assertSerializationContribution('widget', module, 1)).toThrow(
        /generated from data\.schema/,
      );
    },
  );

  /**
   * The assertion this replaces said the opposite: `views` was the one read slot
   * a plugin COULD author, so a serializer carrying nothing else was accepted.
   *
   * 0.2.23 removed the slot, and rejecting it matters more here than the other
   * removals rather than less — because the baseline stays at `2.0.0`. A package
   * written against 2.0.0 legitimately declares `^2.0.0`, so semver alone lets it
   * through; without this rejection it would register clean and have its read
   * code silently ignored, serving records missing the fields its own UI reads.
   */
  it('[ac:ac-snapshot-i-restore-nie-sa-slotami-aut] rejects an authored `views` map — a 2.0.0 plugin passes the semver gate, so the slot check is the only thing standing between it and a silently ignored read path', () => {
    const module = { serializer: { views: { detail: () => ({}) }, payloadUpgrades: [] } };
    expect(() => assertSerializationContribution('widget', module, 1)).toThrow(PluginManifestError);
    expect(() => assertSerializationContribution('widget', module, 1)).toThrow(
      /the record is derived from data\.schema, narrowed by select/,
    );
  });

  /**
   * 0.2.24 — the CONTAINER is a removed slot in its own right.
   *
   * The failure it prevents is `payloadUpgrades` sitting one level too deep: the
   * host would see a type at `payloadVersion` 1 with no chain, and read every
   * file that plugin ever wrote at the wrong shape without a word.
   */
  it('rejects the `serializer` container itself, pointing at the flat slot', () => {
    const module = { serializer: { payloadUpgrades: [] } };
    expect(() => assertSerializationContribution('widget', module, 1)).toThrow(PluginManifestError);
    expect(() => assertSerializationContribution('widget', module, 1)).toThrow(
      /the `serializer` slot was removed in Host API 2\.0\.0/,
    );
    expect(() => assertSerializationContribution('widget', module, 1)).toThrow(
      /declare `payloadUpgrades` directly on the type/,
    );
  });

  /**
   * An enclosed slot is reported ahead of the container. Telling this author to
   * "unwrap the object" would be telling them to hoist a callback the host
   * stopped honouring two releases ago — the answer for `snapshot` is not a
   * move, and the message has to keep saying so.
   */
  it('names the enclosed slot rather than the container when both are wrong', () => {
    expect(() =>
      assertSerializationContribution('widget', { serializer: { snapshot: () => ({}) } }, 1),
    ).toThrow(/serializer\.snapshot/);
  });

  it('accepts a type declaring no serialization at all', () => {
    expect(() => assertSerializationContribution('widget', {}, 1)).not.toThrow();
  });

  /**
   * 0.2.31 — a flat `diff` is REJECTED, where it used to be the one thing this
   * contribution was for.
   *
   * Rejected rather than ignored on the same reasoning as every other removed
   * slot, and more sharply: an ignored `diff` would sit in the author's source
   * looking honoured while every delta on every surface came from the host's
   * schema walk. The author would have no way to notice, because the deltas
   * would be perfectly reasonable — just not theirs.
   */
  it('rejects a flat `diff` — the host generates the delta from data.schema', () => {
    expect(() => assertSerializationContribution('widget', { diff: () => ({}) }, 1)).toThrow(
      PluginManifestError,
    );
    expect(() => assertSerializationContribution('widget', { diff: () => ({}) }, 1)).toThrow(
      /the `diff` slot was removed in 0\.2\.31/,
    );
  });

  it('rejects a non-function `diff` for the same reason — the key is what is refused', () => {
    expect(() => assertSerializationContribution('widget', { diff: 'nope' }, 1)).toThrow(
      /the `diff` slot was removed in 0\.2\.31/,
    );
  });
});

// M13: declarative backend slots → synthesized mount (manifest-adapter.ts#synthesizeMount).
describe('synthesizeMount', () => {
  function fakeCtx(overrides: Partial<MountContext> = {}): MountContext {
    return {
      app: { use: vi.fn() },
      reader: {} as MountContext['reader'],
      crud: {} as MountContext['crud'],
      host: {} as MountContext['host'],
      cwd: '/tmp',
      ws: { broadcast: vi.fn() },
      tagsService: {} as MountContext['tagsService'],
      versionService: {} as MountContext['versionService'],
      referencesService: {} as MountContext['referencesService'],
      entityStore: {} as MountContext['entityStore'],
      registerMcpServer: vi.fn(),
      registerEntityService: vi.fn(),
      ...overrides,
    } as MountContext;
  }

  it('leaves an explicit backend.mount untouched (escape hatch wins)', () => {
    const mount = vi.fn();
    const service = vi.fn();
    const mod = lowerEntityContribution(base({ backend: { mount, service } }));
    const synthesized = synthesizeMount(mod);
    expect(synthesized.backend?.mount).toBe(mount);
    expect(synthesized).toBe(mod); // no-op: unchanged reference when mount already present
  });

  it('is a no-op when no declarative slots are present', () => {
    const mod = lowerEntityContribution(base());
    expect(synthesizeMount(mod)).toBe(mod);
  });

  it('drops a pre-2.0.0 `crud` slot instead of honouring it', () => {
    /**
     * `backend.crud` was REMOVED in 2.0.0 tier K — the input schemas are
     * generated from `data.schema`. A manifest still declaring one must not
     * resurrect it: `lowerEntityContribution` narrows the slots it knows, and an
     * unknown one is not carried onto the module where `entity-tools` might read
     * it back and validate against a description of a shape nothing writes.
     */
    const mod = lowerEntityContribution(
      base({ backend: { crud: { createSchema: {} } } } as never),
    );
    expect((mod.backend as Record<string, unknown> | undefined)?.crud).toBeUndefined();
  });

  /**
   * 2.0.0 tier K — the inverse of what this asserted. `mcpServer` without
   * `service` used to be a manifest error, because a custom MCP server was
   * assumed to be a wrapper over that type's CRUD service. With CRUD generated,
   * the common case is a tool that needs no service at all: `diagram`'s
   * `validate_diagram` parses a raw string, and the old rule forced that type to
   * declare a service purely to satisfy the check.
   */
  it('accepts mcpServer with no service, and passes the factory an undefined instance', () => {
    const mcpServer = vi.fn(() => ({ __server: true }) as never);
    const synthesized = synthesizeMount(lowerEntityContribution(base({ backend: { mcpServer } })));
    expect(typeof synthesized.backend?.mount).toBe('function');

    const ctx = fakeCtx();
    synthesized.backend!.mount!(ctx);
    expect(ctx.registerEntityService).not.toHaveBeenCalled();

    // The server is registered as a per-turn thunk; invoking it is what reaches
    // the slot factory, and the service argument it gets is `undefined`.
    expect(ctx.registerMcpServer).toHaveBeenCalledWith('glossary-tools', expect.any(Function));
    vi.mocked(ctx.registerMcpServer).mock.calls[0][1]();
    expect(mcpServer).toHaveBeenCalledWith(undefined, ctx);
  });

  // A manifest still written against the pre-M13 "bare Router" sugar
  // (backend.routes = someRouterInstance) must fail fast and readably here,
  // not with a raw "routes.router is not a function" TypeError deep inside
  // mountBackend (which would fail the whole project load) — regression
  // coverage for a gap found by code review.
  it('throws PluginManifestError when routes.router is not a function (pre-M13 bare Router sugar)', () => {
    const service = vi.fn();
    const bareRouterSugar = { router: { __isExpressRouterInstance: true } as unknown };
    const mod = lowerEntityContribution(base({ backend: { service, routes: bareRouterSugar } }));
    expect(() => synthesizeMount(mod)).toThrow(PluginManifestError);
    expect(() => synthesizeMount(mod)).toThrow(/routes\.router must be a function/);
  });

  it('synthesizes a mount wiring service → DI, routes factory, and custom mcpServer with referential identity', () => {
    const fakeService = { kind: 'fake-service' };
    const service = vi.fn(() => fakeService);
    const routerFactory = vi.fn(() => ({ __router: true }) as never);
    // 0.1.133: the slot returns the MCP server HANDLE directly (not a thunk).
    const mcpFactory = vi.fn(() => ({ __server: true }) as never);

    const mod = lowerEntityContribution(
      base({
        backend: {
          service,
          crud: { createSchema: {} },
          routes: { router: routerFactory },
          mcpServer: mcpFactory,
        },
      }),
    );
    const synthesized = synthesizeMount(mod);
    expect(typeof synthesized.backend?.mount).toBe('function');

    const ctx = fakeCtx();
    synthesized.backend!.mount!(ctx);

    // Referential identity: the SAME service instance flows into DI and the
    // routes factory (brief AC (e)).
    expect(ctx.registerEntityService).toHaveBeenCalledWith('glossary', fakeService);
    expect(routerFactory).toHaveBeenCalledWith(fakeService, ctx);
    expect(ctx.app.use).toHaveBeenCalledWith('/glossary', { __router: true });

    // 0.1.133: the mcpServer slot factory is registered as a per-turn thunk —
    // it is NOT invoked at mount time (host-owned per-turn freshness). It runs
    // only when the host rebuilds servers for a turn, and still receives the
    // SAME service instance (referential identity preserved through the wrap).
    expect(ctx.registerMcpServer).toHaveBeenCalledWith('glossary-tools', expect.any(Function));
    expect(mcpFactory).not.toHaveBeenCalled();
    const perTurnThunk = vi.mocked(ctx.registerMcpServer).mock.calls[0][1];
    const server = perTurnThunk();
    expect(mcpFactory).toHaveBeenCalledWith(fakeService, ctx);
    expect(server).toEqual({ __server: true });
  });
});
