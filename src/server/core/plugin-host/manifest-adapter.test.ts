import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
import { describe, expect, it, vi } from 'vitest';
import { lowerEntityContribution, PluginManifestError, synthesizeMount } from './manifest-adapter.js';
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
    serializer: {},
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
    expect(mod.serializer).toBeDefined();
    expect(mod.systemPrompt.roleNoun).toBe('Glossary');
  });

  it('throws PluginManifestError on a missing required field', () => {
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

// M13: declarative backend slots → synthesized mount (manifest-adapter.ts#synthesizeMount).
describe('synthesizeMount', () => {
  function fakeCtx(overrides: Partial<MountContext> = {}): MountContext {
    return {
      app: { use: vi.fn() },
      db: {} as MountContext['db'],
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

  it('throws PluginManifestError when crud is declared without service', () => {
    const mod = lowerEntityContribution(
      base({ backend: { crud: { createSchema: {} } } }),
    );
    expect(() => synthesizeMount(mod)).toThrow(PluginManifestError);
  });

  it('throws PluginManifestError when mcpServer is declared without service', () => {
    const mod = lowerEntityContribution(base({ backend: { mcpServer: () => ({}) as never } }));
    expect(() => synthesizeMount(mod)).toThrow(PluginManifestError);
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
