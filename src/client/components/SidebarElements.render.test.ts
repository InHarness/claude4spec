// @vitest-environment happy-dom
/**
 * 2.1.16 (M50 `8h2a734u`, `6z6uzzhv`; M13 `m13actv0`) — the ELEMENTS section of
 * the sidebar follows the project's activation:
 *
 *  - `config.entities = []` → the host's "No entity types configured." message,
 *    never a type's `sidebarTab.emptyState`;
 *  - a save on Settings → Entities (the `entity-types` element's `afterSave`)
 *    re-applies activation in THIS tab — the tabs change with no page reload
 *    and no server restart (a Trust plugins answer keeps the M31 reload — see
 *    `activation-change-no-reload.test.ts`);
 *  - a change saved elsewhere (another browser tab, a hand edit of
 *    `config.json`) is not picked up: the tabs stay until the page reloads.
 *
 * The server half of the first criterion (`PATCH { entities: [] }` written and
 * the context invalidated, not the process restarted) is pinned in
 * `src/server/routes/config.route.test.ts`. The server-side consequence of the
 * same save — the rebuilt context's `project:disposed` carries
 * `reason: 'activation-changed'` and the SPA does not reload on it — is pinned in
 * `src/server/workspace/activation-change-no-reload.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FileText, Tag } from 'lucide-react';
import type { PluginActivationState } from '../../shared/plugin-host/types.js';
import type { FrontendManifestResponse } from '../../shared/plugin-host/frontend-manifest.js';

const server = vi.hoisted(() => ({
  activation: { active: [], inactive: [], unknown: [] } as PluginActivationState,
  manifest: { hostApiVersion: '1', importMap: { imports: {} }, plugins: [] } as unknown as FrontendManifestResponse,
  entitiesCalls: 0,
  mounts: 0,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    // The tabs are plain links; a router instance is beside the point here.
    Link: ({ to, children, title }: { to: string; children?: ReactNode; title?: string }) =>
      createElement('a', { href: to, title, 'data-tab': title }, children),
  };
});

vi.mock('../lib/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.js')>();
  return {
    ...actual,
    metaApi: {
      ...actual.metaApi,
      entities: async () => {
        server.entitiesCalls += 1;
        return server.activation;
      },
    },
    pluginsApi: { ...actual.pluginsApi, frontendManifest: async () => server.manifest },
  };
});

vi.mock('../tiptap/mountFrontend.js', () => ({
  mountFrontend: () => {
    server.mounts += 1;
  },
}));

vi.mock('../runtime/shared-runtime.js', () => ({ sharedRuntimeReady: Promise.resolve() }));

import { SidebarElements, isElementsEntryActive } from './Sidebar.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { PLUGIN_HOST_SETTINGS } from '../core/plugin-host/pluginSettings.js';
import { bootFrontendPlugins, reloadFrontendPlugins, refreshPluginActivation } from '../runtime/boot-plugins.js';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import type { FrontendModule } from '../core/plugin-host/types.js';
import type { AfterSaveEnv } from './settings/registry.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Noop = (() => null) as unknown as FrontendModule['renderChip'];
const TypeEmptyState = () => createElement('p', { 'data-testid': 'type-empty-state' }, 'No widgets yet');

/** A hidden module (no routes) is the smallest shape the host accepts; the tab is what matters. */
const moduleOf = (type: string, label: string, order: number): FrontendModule =>
  ({
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label,
    labelPlural: label,
    pathPrefix: `/${type}s`,
    renderChip: Noop,
    renderCard: Noop,
    renderOverlay: Noop,
    useGetBySlug: () => ({ data: null, isLoading: false }),
    listByTags: async () => [],
    // 2.1.20 — `sidebarTab` carries `icon`, `label`, `order` only: `emptyState`
    // left the contract. The stray component below rides along untyped to prove
    // nothing in the sidebar would render one even if a plugin still shipped it.
    sidebarTab: { icon: order === 10 ? FileText : Tag, label, order, ...{ emptyState: TypeEmptyState } },
  }) as unknown as FrontendModule;

clientPluginHost.registerFrontendModule(moduleOf('sbx-widget', 'Widgets', 10));
clientPluginHost.registerFrontendModule(moduleOf('sbx-gadget', 'Gadgets', 20));

const entityTypes = PLUGIN_HOST_SETTINGS.elements!.find((e) => e.id === 'entity-types')!;
const invalidated: unknown[] = [];
const env = {
  router: {},
  queryClient: {
    invalidateQueries: async (q?: unknown) => {
      invalidated.push(q ?? 'all');
    },
  },
} as unknown as AfterSaveEnv;

const activation = (active: string[]): PluginActivationState =>
  ({ active, inactive: ['sbx-widget', 'sbx-gadget'].filter((t) => !active.includes(t)), unknown: [] }) as PluginActivationState;

let host: HTMLDivElement;
let root: Root;
let reload: MockInstance;

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const tabs = () => Array.from(host.querySelectorAll('a[data-tab]')).map((a) => a.getAttribute('data-tab'));

beforeEach(async () => {
  server.entitiesCalls = 0;
  server.mounts = 0;
  invalidated.length = 0;
  // `afterSave` falls back to a full reload when the refresh fails — that is
  // exactly what these criteria rule out, so it is watched, never performed.
  reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  // The page as loaded: both test types active (whatever else is registered stays out).
  clientPluginHost.applyActivation(activation(['sbx-widget', 'sbx-gadget']));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(SidebarElements, { entityCounts: { 'sbx-widget': 3 }, pathname: '/' }));
  });
});

afterEach(() => {
  reload.mockRestore();
  act(() => root.unmount());
  host.remove();
});

describe('Sidebar ELEMENTS follows activation (M50 8h2a734u)', () => {
  it('[section:z7l89jhf] with no elementsMenu, renders one tab per active type with a sidebarTab, in sidebarTab.order — the default order — with its count', () => {
    // 2.1.26 — the identity carries no `displayOrder`: the pool lists by type
    // (gadget before widget), and the ELEMENTS order still follows `sidebarTab.order`.
    const pool = clientPluginHost.listAvailable().map((m) => m.type).filter((t) => t.startsWith('sbx-'));
    expect(pool).toEqual(['sbx-gadget', 'sbx-widget']);
    expect(clientPluginHost.listAvailable().some((m) => 'displayOrder' in m)).toBe(false);
    expect(tabs()).toEqual(['Widgets', 'Gadgets']);
    expect(host.textContent).toContain('3');
    expect(host.textContent).not.toContain('No entity types configured.');
  });

  it('[ac:ac-multi-select-entities-w-m26-sekcja-ent] saving entities: [] on Settings → Entities leaves the "No entity types configured." message — not the type emptyState — with no reload', async () => {
    server.activation = activation([]);
    await act(async () => {
      await entityTypes.afterSave!(env);
    });
    await flush();

    // Activation re-read from the rebuilt context (GET /_meta/entities), in this tab.
    expect(server.entitiesCalls).toBe(1);
    expect(tabs()).toEqual([]);
    expect(host.textContent).toContain('No entity types configured.');
    // A type's empty component is never rendered (2.1.20: no longer even in the contract).
    expect(host.querySelector('[data-testid="type-empty-state"]')).toBeNull();
    expect(host.textContent).not.toContain('No widgets yet');
    expect(reload).not.toHaveBeenCalled();
  });

  it('[ac:ac-po-zapisie-aktywnych-typow-w-ustawien] after a save on Settings → Entities the ELEMENTS tabs show the new set without a page reload', async () => {
    server.activation = activation(['sbx-gadget']);
    await act(async () => {
      await entityTypes.afterSave!(env);
    });
    await flush();
    expect(tabs()).toEqual(['Gadgets']);

    // And back: a re-activated type gets its tab (and its route re-pinned).
    server.activation = activation(['sbx-widget', 'sbx-gadget']);
    await act(async () => {
      await entityTypes.afterSave!(env);
    });
    await flush();
    expect(tabs()).toEqual(['Widgets', 'Gadgets']);
    expect(server.mounts).toBeGreaterThanOrEqual(2);
    expect(invalidated.length).toBe(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('[section:8h2a734u] an ELEMENTS entry is active when the route path starts with the route prefix of ANY type it covers', () => {
    const covered = ['/sbx-widgets', '/sbx-gadgets'];
    expect(isElementsEntryActive('/sbx-gadgets/g-1', covered)).toBe(true);
    expect(isElementsEntryActive('/sbx-widgets', covered)).toBe(true);
    expect(isElementsEntryActive('/plans', covered)).toBe(false);
    // A single-type entry covers only its own prefix.
    expect(isElementsEntryActive('/sbx-gadgets/g-1', ['/sbx-widgets'])).toBe(false);
  });

  it('refreshPluginActivation re-reads activation in this tab on its own', async () => {
    server.activation = activation(['sbx-widget']);
    await act(async () => {
      await refreshPluginActivation();
    });
    await flush();
    expect(server.entitiesCalls).toBe(1);
    expect(tabs()).toEqual(['Widgets']);
  });

  it('[ac:ac-zmiana-aktywnych-typow-zapisana-w-inn] a change saved in another tab does not change the ELEMENTS tabs here until the page reloads', async () => {
    // This tab booted (the WS plugin-reload path needs the captured router).
    await act(async () => {
      await bootFrontendPlugins({} as never);
    });
    // Another tab saved `entities: ['sbx-gadget']`: the server answers the new
    // activation from now on, and this tab gets the generic signals — a
    // `plugin:reloaded` manifest refetch and a query invalidation.
    server.activation = activation(['sbx-gadget']);
    await act(async () => {
      await reloadFrontendPlugins();
    });
    await flush();

    expect(tabs()).toEqual(['Widgets', 'Gadgets']);
    // Nothing in this tab asked for the activation again.
    expect(server.entitiesCalls).toBe(0);
    expect(reload).not.toHaveBeenCalled();

    // A page reload re-seeds activation at boot (main.tsx) — only then do the tabs change.
    await act(async () => {
      clientPluginHost.applyActivation(server.activation);
    });
    expect(tabs()).toEqual(['Gadgets']);
  });
});
