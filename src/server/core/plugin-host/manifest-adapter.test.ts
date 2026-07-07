import { describe, expect, it, vi } from 'vitest';
import { lowerEntityContribution, PluginManifestError, synthesizeMount } from './manifest-adapter.js';
import type { EntityContribution } from '../../../shared/plugin-host/manifest.js';
import type { MountContext } from './types.js';

function base(over: Partial<EntityContribution> = {}): EntityContribution {
  return {
    type: 'glossary',
    table: 'glossary',
    label: 'Glossary',
    labelPlural: 'Glossary',
    displayOrder: 100,
    slugFrom: () => 'x',
    pathPrefix: '/glossary',
    serializer: {},
    systemPrompt: {
      roleNoun: 'Glossary',
      countStat: { placeholder: 'glossaryCount', sqlQuery: 'SELECT 0 AS count', label: 'terms' },
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
    expect(() => lowerEntityContribution(base({ table: undefined as unknown as string }))).toThrow(
      PluginManifestError,
    );
  });

  it('throws when slugFrom is not a function', () => {
    expect(() =>
      lowerEntityContribution(base({ slugFrom: 'nope' as unknown as () => string })),
    ).toThrow(PluginManifestError);
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
    const mod = lowerEntityContribution(base({ backend: { mcpServer: () => () => ({}) as never } }));
    expect(() => synthesizeMount(mod)).toThrow(PluginManifestError);
  });

  it('synthesizes a mount wiring service → DI, routes factory, and custom mcpServer with referential identity', () => {
    const fakeService = { kind: 'fake-service' };
    const service = vi.fn(() => fakeService);
    const routerFactory = vi.fn(() => ({ __router: true }) as never);
    const mcpFactory = vi.fn(() => (() => ({ __server: true }) as never));

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

    // Referential identity: the SAME service instance flows into DI, the
    // routes factory, and the mcpServer factory (brief AC (e)).
    expect(ctx.registerEntityService).toHaveBeenCalledWith('glossary', fakeService);
    expect(routerFactory).toHaveBeenCalledWith(fakeService, ctx);
    expect(mcpFactory).toHaveBeenCalledWith(fakeService, ctx);
    expect(ctx.app.use).toHaveBeenCalledWith('/glossary', { __router: true });
    expect(ctx.registerMcpServer).toHaveBeenCalledWith('glossary-tools', expect.any(Function));
  });
});
