// @vitest-environment happy-dom
/**
 * 2.1.57 (M13 `m13actv0`, M33 `j1jk3ykt`) — `config.entities` is one activation
 * gate for the backend and the frontend: the client gets the project's active
 * types (`seedPluginActivation` ← `GET /api/_meta/entities`) and `mountFrontend`
 * mounts only their modules. A partly disabled plugin is announced and imported,
 * but the module of its disabled type is not mounted, even though the bundle is
 * there.
 *
 * The real client plugin host runs here; the API, the mount step and the entry
 * import are the seams.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrontendManifestResponse } from '../../shared/plugin-host/frontend-manifest.js';
import type { PluginActivationState } from '../../shared/plugin-host/types.js';
import type { FrontendModule } from '../core/plugin-host/types.js';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';

const server = vi.hoisted(() => ({
  manifest: null as unknown as FrontendManifestResponse,
  entities: null as unknown as () => Promise<PluginActivationState>,
}));
const mountFrontend = vi.hoisted(() => vi.fn());

vi.mock('../lib/api.js', () => ({
  pluginsApi: { frontendManifest: async () => server.manifest },
  metaApi: { pluginCommands: async () => ({ commands: [] }), entities: () => server.entities() },
}));
vi.mock('../lib/api-core.js', () => ({ PROJECT_ID: 'test-project' }));
vi.mock('../tiptap/mountFrontend.js', () => ({ mountFrontend: (...a: unknown[]) => mountFrontend(...a) }));
vi.mock('../tiptap/pluginCommands.js', () => ({ registerPluginCommands: () => {} }));
vi.mock('./shared-runtime.js', () => ({ sharedRuntimeReady: Promise.resolve() }));

const router = {} as never;
const ENTRY = '/api/plugins/@acme%2Fc4s-plugin-contracts/frontend.js';

/** A frontend module of `type`, the shape a plugin entry registers. */
function moduleOf(type: string): FrontendModule {
  return {
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    pathPrefix: `/${type}s`,
    renderChip: () => null,
    renderCard: () => null,
    renderOverlay: () => null,
    useGetBySlug: () => ({ data: null, isLoading: false }),
    listByTags: async () => [],
  } as unknown as FrontendModule;
}

/** Fresh loader + host; the plugin's entry registers BOTH of its types when imported. */
async function load() {
  vi.resetModules();
  const boot = await import('./boot-plugins.js');
  const { clientPluginHost } = await import('../core/plugin-host/host.js');
  const imports: string[] = [];
  boot.__setPluginEntryImporter(async (entry) => {
    imports.push(entry);
    clientPluginHost.registerFrontendModule(moduleOf('lgx-endpoint'));
    clientPluginHost.registerFrontendModule(moduleOf('lgx-dto'));
  });
  return { boot, host: clientPluginHost, imports };
}

/** The types of the modules passed to the last `mountFrontend` call. */
const mountedTypes = (): string[] =>
  ((mountFrontend.mock.calls.at(-1)?.[1] ?? []) as FrontendModule[]).map((m) => m.type).sort();

/** Let every pending microtask and the macrotask queue drain. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mountFrontend.mockReset();
  server.manifest = {
    hostApiVersion: '2.1.0',
    importMap: {},
    plugins: [{ name: '@acme/c4s-plugin-contracts', version: '1.0.0', entry: ENTRY }],
  };
});

describe('one activation gate for the backend and the frontend (client)', () => {
  it('[section:m13actv0] the frontend gets the project\'s active types and mountFrontend mounts only their modules — the boot waits for the list even when the manifest answers first', async () => {
    let release!: (state: PluginActivationState) => void;
    server.entities = () => new Promise((r) => (release = r));
    const { boot, host } = await load();

    boot.seedPluginActivation();
    const running = boot.bootFrontendPlugins(router);
    await settle();

    // The manifest answered and the entry registered its modules…
    expect(host.getAvailable('lgx-endpoint')).not.toBeNull();
    expect(host.getAvailable('lgx-dto')).not.toBeNull();
    // …but nothing is mounted before the activation list is in.
    expect(mountFrontend).not.toHaveBeenCalled();
    expect(boot.pluginBootPending()).toBe(true);

    release({ active: ['lgx-endpoint'], inactive: ['lgx-dto'], unknown: [] });
    await running;

    expect(mountFrontend).toHaveBeenCalledTimes(1);
    expect(mountedTypes()).toEqual(['lgx-endpoint']);
    expect(host.isActive('lgx-dto')).toBe(false);
    expect(boot.pluginBootPending()).toBe(false);
  });

  it('[section:j1jk3ykt] a type disabled in config.entities is not mounted on the frontend, even though its plugin has a bundle that the manifest announces', async () => {
    server.entities = async () => ({ active: ['lgx-endpoint'], inactive: ['lgx-dto'], unknown: [] });
    const { boot, host, imports } = await load();

    await boot.seedPluginActivation();
    await boot.bootFrontendPlugins(router);

    // The partly disabled plugin is announced and its bundle imported.
    expect(imports).toEqual([ENTRY]);
    expect(host.getAvailable('lgx-dto')).not.toBeNull();
    // Its disabled type is not mounted; its active one is.
    expect(mountedTypes()).toEqual(['lgx-endpoint']);
    expect(host.listEntities().map((m) => m.type)).toEqual(['lgx-endpoint']);
  });

  it('a failed activation request falls back to "all available active" and the boot still mounts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      server.entities = async () => {
        throw new Error('meta down');
      };
      const { boot } = await load();

      await boot.seedPluginActivation();
      await boot.bootFrontendPlugins(router);

      expect(mountedTypes()).toEqual(['lgx-dto', 'lgx-endpoint']);
    } finally {
      warn.mockRestore();
    }
  });
});
