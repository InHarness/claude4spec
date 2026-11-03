// @vitest-environment happy-dom
/**
 * 2.1.65 (M13 `m13l11sc`, Runtime binding) — the client registry's version grows
 * when a frontend module registers AND at every application of activation: the
 * initial seed, the Settings → Entities refresh, a plugin reload and the trust
 * decision (the last one is pinned in `components/TrustPluginsModal.render.test.ts`).
 * `onRegistryChanged` subscribers hear each of them.
 *
 * The real `boot-plugins.ts`, `lib/api.ts` and the real `clientPluginHost` run
 * here; `fetch` is the only network seam, and the editor mount is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrontendManifestResponse } from '../../shared/plugin-host/frontend-manifest.js';
import type { PluginActivationState } from '../../shared/plugin-host/types.js';

vi.mock('../tiptap/mountFrontend.js', () => ({ mountFrontend: () => {} }));
vi.mock('../tiptap/pluginCommands.js', () => ({ registerPluginCommands: () => {} }));
vi.mock('./shared-runtime.js', () => ({ sharedRuntimeReady: Promise.resolve() }));

type Win = Window & { __C4S_PROJECT__?: { id: string } };

const router = {} as never;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const manifest: FrontendManifestResponse = { hostApiVersion: '2.1.0', importMap: {}, plugins: [] };

let activation: PluginActivationState;
let fetchMock: ReturnType<typeof vi.fn>;

const metaCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith('/_meta/entities'));

async function loadModules() {
  vi.resetModules();
  const boot = await import('./boot-plugins.js');
  const { clientPluginHost } = await import('../core/plugin-host/host.js');
  const reload = await import('./document-reload.js');
  boot.__setPluginEntryImporter(async () => {});
  reload.__setDocumentReloadDeps({ reload: vi.fn(), recheckMs: 100 });
  return { boot, clientPluginHost };
}

beforeEach(() => {
  (window as Win).__C4S_PROJECT__ = { id: 'app-spec' };
  activation = { active: ['endpoint'], inactive: [], unknown: [] };
  fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/_meta/entities')) return json(200, activation);
    if (url.includes('frontend-manifest')) return json(200, manifest);
    if (url.includes('/_meta/plugin-commands')) return json(200, { commands: [] });
    return json(404, { error: { code: 'NOT_FOUND', message: url } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  delete (window as Win).__C4S_PROJECT__;
  vi.unstubAllGlobals();
});

describe('[section:m13l11sc] every application of activation grows the client registry version', () => {
  it('[section:m13l11sc] the initial seed applies activation: the version grows and subscribers are told', async () => {
    const { boot, clientPluginHost } = await loadModules();
    const heard = vi.fn();
    const off = clientPluginHost.onRegistryChanged(heard);
    const before = clientPluginHost.registryVersion();

    await boot.seedPluginActivation();

    expect(metaCalls()).toEqual(['/api/projects/app-spec/_meta/entities']);
    expect(clientPluginHost.registryVersion()).toBe(before + 1);
    expect(heard).toHaveBeenCalledTimes(1);
    off();
  });

  it('[section:m13l11sc] the activation refresh applies activation again — even an unchanged active set grows the version', async () => {
    const { boot, clientPluginHost } = await loadModules();
    await boot.seedPluginActivation();
    const before = clientPluginHost.registryVersion();

    await boot.refreshPluginActivation(router);
    expect(clientPluginHost.registryVersion()).toBe(before + 1);

    activation = { active: [], inactive: ['endpoint'], unknown: [] };
    await boot.refreshPluginActivation(router);
    expect(clientPluginHost.registryVersion()).toBe(before + 2);
  });

  it('[section:m13l11sc] a plugin reload re-reads the activation and applies it, before refetching the manifest — the version grows', async () => {
    const { boot, clientPluginHost } = await loadModules();
    await boot.seedPluginActivation();
    await boot.bootFrontendPlugins(router);
    const heard = vi.fn();
    const off = clientPluginHost.onRegistryChanged(heard);
    const before = clientPluginHost.registryVersion();
    fetchMock.mockClear();

    await boot.reloadFrontendPlugins({ name: '@acme/c4s-plugin-glossary', tier: 'base' });

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(metaCalls()).toEqual(['/api/projects/app-spec/_meta/entities']);
    expect(urls.indexOf('/api/projects/app-spec/_meta/entities')).toBeLessThan(
      urls.indexOf('/api/projects/app-spec/plugins/frontend-manifest'),
    );
    expect(clientPluginHost.registryVersion()).toBe(before + 1);
    expect(heard).toHaveBeenCalledTimes(1);
    off();
  });

  it('[section:m13l11sc] a plugin reload whose activation read fails applies nothing — the version stays, the reload still proceeds', async () => {
    const { boot, clientPluginHost } = await loadModules();
    await boot.seedPluginActivation();
    await boot.bootFrontendPlugins(router);
    const before = clientPluginHost.registryVersion();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementationOnce(async () => json(500, { error: { code: 'INTERNAL', message: 'boom' } }));
    fetchMock.mockClear();

    await boot.reloadFrontendPlugins();

    expect(clientPluginHost.registryVersion()).toBe(before);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/projects/app-spec/plugins/frontend-manifest');
    warn.mockRestore();
  });
});
