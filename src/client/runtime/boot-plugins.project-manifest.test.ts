// @vitest-environment happy-dom
/**
 * 2.1.22 (M33 `m33l5man`, `87z9w99s`, `m33l7pln` step 5; M13 `mbladez6` client
 * step 1b; M20 `m20l11sc`) — the client boots the plugin frontends of ITS
 * project, and a change to a frontend already imported in the tab reloads the
 * document instead of importing it a second time.
 *
 * The real `lib/api.ts` and `lib/api-core.ts` run here: the project global is set
 * (or not) on `window` before the modules are imported, exactly as the server
 * injects it into the document, and `fetch` is the only thing stubbed. Entry
 * imports go through the loader's importer seam, so a second import of an entry
 * is observable; the document reload goes through `document-reload.ts`'s seam,
 * so it is watched, never performed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { FrontendManifestResponse } from '../../shared/plugin-host/frontend-manifest.js';

const mountFrontend = vi.hoisted(() => vi.fn());

vi.mock('../tiptap/mountFrontend.js', () => ({ mountFrontend: (...a: unknown[]) => mountFrontend(...a) }));
vi.mock('../tiptap/pluginCommands.js', () => ({ registerPluginCommands: () => {} }));
vi.mock('./shared-runtime.js', () => ({ sharedRuntimeReady: Promise.resolve() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Win = Window & { __C4S_PROJECT__?: { id: string } };

const router = {} as never;

const manifestOf = (plugins: FrontendManifestResponse['plugins']): FrontendManifestResponse => ({
  hostApiVersion: '2.1.0',
  importMap: {},
  plugins,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
/** What the server answers for the manifest, per call. */
let manifestAnswer: () => Response | Promise<Response>;

const manifestCalls = () =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('frontend-manifest'));

async function loadModules() {
  vi.resetModules();
  const boot = await import('./boot-plugins.js');
  const reload = await import('./document-reload.js');
  const unsaved = await import('../tiptap/unsavedEdits.js');
  const api = await import('../lib/api.js');
  const imports: string[] = [];
  boot.__setPluginEntryImporter(async (entry) => {
    imports.push(entry);
  });
  const reloadSpy = vi.fn();
  reload.__setDocumentReloadDeps({ reload: reloadSpy, recheckMs: 100 });
  return { boot, reload, unsaved, api, imports, reloadSpy };
}

beforeEach(() => {
  mountFrontend.mockReset();
  manifestAnswer = () => json(200, manifestOf([]));
  fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('frontend-manifest')) return manifestAnswer();
    if (url.includes('/_meta/plugin-commands')) return json(200, { commands: [] });
    return json(404, { error: { code: 'NOT_FOUND', message: url } });
  });
  vi.stubGlobal('fetch', fetchMock);
  document.head.querySelectorAll('link[rel="stylesheet"]').forEach((l) => l.remove());
});

afterEach(() => {
  delete (window as Win).__C4S_PROJECT__;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('M33 m33l5man — the manifest of the own project', () => {
  it('fetches the manifest of the project named by window.__C4S_PROJECT__.id, on the project router', async () => {
    (window as Win).__C4S_PROJECT__ = { id: 'app-spec' };
    const { boot } = await loadModules();

    await boot.bootFrontendPlugins(router);

    expect(manifestCalls()).toEqual(['/api/projects/app-spec/plugins/frontend-manifest']);
    // The process-global address is gone from the client.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('/api/plugins/frontend-manifest');
  });

  it('[ac:ac-brak-globalu-projektu-bez-manifestu] in a document without window.__C4S_PROJECT__ the client does not fetch the frontend manifest', async () => {
    delete (window as Win).__C4S_PROJECT__;
    const { boot, api, imports } = await loadModules();

    await boot.bootFrontendPlugins(router);
    await boot.frontendPluginsBooted;

    // No manifest request at all — neither the project route with a fallback id
    // (`default`, empty) nor the old process-global address.
    expect(manifestCalls()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    // No plugin frontend runs: nothing imported, the boot settled.
    expect(imports).toEqual([]);
    expect(boot.pluginBootPending()).toBe(false);
    // The API call itself refuses to build an address without the global.
    await expect(api.pluginsApi.frontendManifest()).rejects.toHaveProperty('code', 'NO_PROJECT');
    expect(fetchMock).not.toHaveBeenCalled();

    // A plugin event or an activation refresh does not fetch it either.
    await boot.reloadFrontendPlugins({ name: 'c4s-plugin-ac', tier: 'base' });
    expect(manifestCalls()).toEqual([]);
  });

  it('[ac:ac-blad-manifestu-host-bez-pluginow] when the frontend manifest request fails, the client renders the host without plugin frontends', async () => {
    (window as Win).__C4S_PROJECT__ = { id: 'app-spec' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const failure of [
        () => json(500, { error: { code: 'PROJECT_BUILD_FAILED', message: 'boom' } }),
        () => Promise.reject(new TypeError('network down')),
      ]) {
        manifestAnswer = failure;
        const { boot, imports } = await loadModules();

        // The boot neither throws nor hangs — the start is not interrupted.
        await expect(boot.bootFrontendPlugins(router)).resolves.toBeUndefined();
        await boot.frontendPluginsBooted;
        expect(boot.pluginBootPending()).toBe(false);
        expect(manifestCalls().at(-1)).toBe('/api/projects/app-spec/plugins/frontend-manifest');

        // Host without plugin frontends: nothing imported, no plugin CSS, no plugin mount.
        expect(imports).toEqual([]);
        expect(boot.importedPluginEntries().size).toBe(0);
        expect(document.head.querySelectorAll('link[rel="stylesheet"]').length).toBe(0);
        expect(mountFrontend).not.toHaveBeenCalled();

        // …and the host itself renders.
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
          root.render(createElement('main', { 'data-testid': 'host' }, 'claude4spec'));
        });
        expect(host.querySelector('[data-testid="host"]')?.textContent).toBe('claude4spec');
        act(() => root.unmount());
        host.remove();
      }
    } finally {
      warn.mockRestore();
    }
  });
});

describe('M33 m33l5man — a changed frontend already imported reloads the document', () => {
  const base = {
    name: '@acme/c4s-plugin-glossary',
    version: '2.1.0',
    entry: '/api/plugins/@acme%2Fc4s-plugin-glossary/frontend.js',
  };
  const overlay = {
    name: '@acme/c4s-plugin-glossary',
    version: '2.2.0',
    entry: '/api/projects/app-spec/plugins/@acme%2Fc4s-plugin-glossary/frontend.js',
  };
  const other = {
    name: 'c4s-plugin-app-spec',
    version: '0.3.0',
    entry: '/api/projects/app-spec/plugins/c4s-plugin-app-spec/frontend.js',
  };

  beforeEach(() => {
    (window as Win).__C4S_PROJECT__ = { id: 'app-spec' };
  });

  it('[ac:ac-zmiana-entry-zaimportowanego-przeladowuje] when a refetched frontend manifest changes the entry of a plugin already imported in the tab, the client reloads the document', async () => {
    manifestAnswer = () => json(200, manifestOf([base]));
    const { boot, imports, reloadSpy } = await loadModules();
    await boot.bootFrontendPlugins(router);
    expect(imports).toEqual([base.entry]);

    // Trust flipped: the overlay now shadows the npm package — same name, new entry.
    manifestAnswer = () => json(200, manifestOf([overlay]));
    await boot.reloadFrontendPlugins();
    expect(manifestCalls()).toEqual([
      '/api/projects/app-spec/plugins/frontend-manifest',
      '/api/projects/app-spec/plugins/frontend-manifest',
    ]);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // The changed entry is NOT imported into the tab next to the old module.
    expect(imports).toEqual([base.entry]);
    expect(boot.importedPluginEntries().get(base.name)).toBe(base.entry);
  });

  it('an unchanged entry is not imported again on refetch (no in-tab re-import), and a newly announced plugin is imported without a reload', async () => {
    manifestAnswer = () => json(200, manifestOf([base]));
    const { boot, imports, reloadSpy } = await loadModules();
    await boot.bootFrontendPlugins(router);

    manifestAnswer = () => json(200, manifestOf([base, other]));
    await boot.reloadFrontendPlugins({ name: other.name, tier: 'overlay' });

    expect(imports).toEqual([base.entry, other.entry]);
    // No `?v=` cache-bust re-import of the imported entry.
    expect(imports.filter((e) => e.includes('?v='))).toEqual([]);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(mountFrontend).toHaveBeenCalledTimes(2);
  });

  it('a hot-reload rebuild of a frontend imported in the tab (plugin:reloaded) reloads the document instead of re-importing it', async () => {
    manifestAnswer = () => json(200, manifestOf([base]));
    const { boot, imports, reloadSpy } = await loadModules();
    await boot.bootFrontendPlugins(router);

    await boot.reloadFrontendPlugins({ name: base.name, tier: 'base' });

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(imports).toEqual([base.entry]);
  });

  it('a base-tier rebuild of a name whose imported frontend is this project overlay does not reload', async () => {
    manifestAnswer = () => json(200, manifestOf([overlay]));
    const { boot, reloadSpy } = await loadModules();
    await boot.bootFrontendPlugins(router);

    await boot.reloadFrontendPlugins({ name: overlay.name, tier: 'base' });

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('[ac:ac-przeladowanie-czeka-na-zapis-zmian] with unsaved editor changes the client defers the document reload required by a frontend change until there are no unsaved changes', async () => {
    manifestAnswer = () => json(200, manifestOf([base]));
    const { boot, reload, unsaved, imports, reloadSpy } = await loadModules();
    // React from the same module registry as the hook under test.
    const React = await import('react');
    const ReactDomClient = await import('react-dom/client');
    await boot.bootFrontendPlugins(router);

    // An editor with unsaved changes, reporting through M20's hook.
    let dirty = true;
    function DirtyEditor() {
      unsaved.useUnsavedEditsSource(() => dirty);
      return null;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = ReactDomClient.createRoot(host);
    await React.act(async () => {
      root.render(React.createElement(DirtyEditor));
    });
    expect(unsaved.hasUnsavedEdits()).toBe(true);

    // Only the re-check interval is faked; fetch/Response keep real timers.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    // Both triggers: a changed entry in the refetched manifest, and a rebuild event.
    manifestAnswer = () => json(200, manifestOf([overlay]));
    await boot.reloadFrontendPlugins({ name: base.name, tier: 'base' });

    // Deferred: not reloaded while the changes are unsaved — however long that is.
    expect(reload.documentReloadRequested()).toBe(true);
    expect(reload.documentReloadDeferred()).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reloadSpy).not.toHaveBeenCalled();
    // Meanwhile the frontend loaded earlier keeps working: nothing re-imported.
    expect(imports).toEqual([base.entry]);

    // The edits are saved — the reload happens, once.
    dirty = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reload.documentReloadDeferred()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    React.act(() => root.unmount());
    host.remove();
    // An unmounted editor holds nothing unsaved.
    expect(unsaved.hasUnsavedEdits()).toBe(false);
  });

  it('without unsaved editor changes the reload is immediate', async () => {
    const { reload, reloadSpy } = await loadModules();
    reload.requestDocumentReload('test');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
