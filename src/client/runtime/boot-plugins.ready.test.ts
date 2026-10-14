// @vitest-environment happy-dom
/**
 * M33 — the plugins-ready signal after the initial boot.
 *
 * The boot is fired non-awaited from `main.tsx`, so nothing may depend on it
 * having finished by the time it renders. The loader publishes when it is done
 * (`frontendPluginsBooted` / `pluginBootPending()`), and an editor follows the
 * registry's schema version instead of trusting that the boot came first.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const frontendManifest = vi.fn();
const mountFrontend = vi.fn();

vi.mock('../lib/api.js', () => ({
  pluginsApi: { frontendManifest: () => frontendManifest() },
  metaApi: { pluginCommands: async () => ({ commands: [] }), entities: async () => ({}) },
}));
vi.mock('../lib/api-core.js', () => ({ PROJECT_ID: '' }));
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: { listEntities: () => [], applyActivation: () => {} },
}));
vi.mock('../tiptap/mountFrontend.js', () => ({ mountFrontend: (...a: unknown[]) => mountFrontend(...a) }));
vi.mock('../tiptap/pluginCommands.js', () => ({ registerPluginCommands: () => {} }));
vi.mock('./shared-runtime.js', () => ({ sharedRuntimeReady: Promise.resolve() }));

const fakeExtension = { name: 'fake' } as never;
const router = {} as never;

beforeEach(() => {
  vi.resetModules();
  frontendManifest.mockReset();
  mountFrontend.mockReset();
});

describe('plugins-ready signal', () => {
  it('[ac:ac-loader-emituje-sygnal-gotowosci-pluginow] the loader signals readiness after the initial boot, and an editor follows late node types instead of relying on the non-awaited boot', async () => {
    const boot = await import('./boot-plugins.js');
    const registry = await import('../tiptap/registry.js');

    // The boot's mount step registers a schema-bearing extension, as a plugin
    // contributing a node type does.
    mountFrontend.mockImplementation(() => {
      registry.registerEditorExtension({ name: 'test-ready:node', extension: fakeExtension });
    });
    let release!: (v: unknown) => void;
    frontendManifest.mockReturnValue(new Promise((r) => (release = r)));

    // An editor mounted before the boot finishes: it subscribes to the schema version.
    const versionAtMount = registry.getEditorSchemaVersion();
    const onSchemaChange = vi.fn();
    const unsubscribe = registry.subscribeEditorSchema(onSchemaChange);

    let signalled = false;
    void boot.frontendPluginsBooted.then(() => {
      signalled = true;
    });
    const running = boot.bootFrontendPlugins(router);

    // Before the boot settles: pending, no signal yet.
    await Promise.resolve();
    expect(boot.pluginBootPending()).toBe(true);
    expect(signalled).toBe(false);

    release({ plugins: [] });
    await running;
    await boot.frontendPluginsBooted;

    // After the initial boot: the signal fired and the pending flag is down.
    expect(boot.pluginBootPending()).toBe(false);
    expect(signalled).toBe(true);
    expect(mountFrontend).toHaveBeenCalledTimes(1);

    // The early editor learns of the late node type — it is told to rebuild,
    // so the node is not silently dropped by a schema frozen before the boot.
    await Promise.resolve();
    expect(registry.getEditorSchemaVersion()).toBeGreaterThan(versionAtMount);
    expect(onSchemaChange).toHaveBeenCalled();

    unsubscribe();
    registry.unregisterEditorExtensionsByPrefix('test-ready:');
  });

  it('a failed boot still emits the signal — waiting on it never hangs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const boot = await import('./boot-plugins.js');
      frontendManifest.mockRejectedValue(new Error('manifest down'));

      await boot.bootFrontendPlugins(router);
      await boot.frontendPluginsBooted;

      expect(boot.pluginBootPending()).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
