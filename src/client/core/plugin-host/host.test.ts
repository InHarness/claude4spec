import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
import { describe, expect, it } from 'vitest';
import { clientPluginHost, registerFrontendModule } from './host.js';
import * as pluginRuntime from '../../runtime/plugin-runtime.js';
import type { FrontendModule } from './types.js';

const Noop = (() => null) as unknown as FrontendModule['renderCard'];
const routesFragment = (() => []) as unknown as FrontendModule['routes'];

/** A BROWSABLE type: a place of its own — a detail route and the panel on it. */
function baseModule(type: string): FrontendModule {
  return {
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    pathPrefix: `/${type}s`,
    renderChip: Noop,
    renderCard: Noop,
    renderRow: Noop,
    detailPanel: Noop,
    routes: routesFragment,
    useGetBySlug: () => ({ data: null, isLoading: false }),
    listByTags: async () => [],
  } as unknown as FrontendModule;
}

/** A HIDDEN type: no route, no panel, no row — a chip, a card and an overlay. */
function hiddenModule(type: string): FrontendModule {
  const mod = baseModule(type) as Partial<FrontendModule>;
  delete mod.renderRow;
  delete mod.detailPanel;
  delete mod.routes;
  return { ...mod, renderOverlay: Noop } as unknown as FrontendModule;
}

// M34/L11: registerFrontendModule validates slot shapes at REGISTRATION, so a
// malformed module fails registration instead of crashing the first page that
// happens to render it. (2.1.20: the render smoke test moved to mountFrontend.)
//
// 2.1.20 (M13 z7l89jhf): four slots are mandatory — `renderChip`, `renderCard`,
// `useGetBySlug`, `listByTags` — and beyond them the host enforces CONSISTENCY:
// it refuses half a pair — a detail panel with no route, a route with no panel,
// a hidden type with no overlay, or an overlay on a type that has somewhere to
// navigate.
describe('registerFrontendModule — load-time slot validation', () => {
  it('accepts a well-formed browsable module', () => {
    expect(() => clientPluginHost.registerFrontendModule(baseModule('m34-valid'))).not.toThrow();
  });

  it('accepts a hidden module — no row, no detail panel, no routes', () => {
    expect(() => clientPluginHost.registerFrontendModule(hiddenModule('m34-hidden'))).not.toThrow();
    expect(clientPluginHost.getAvailable('m34-hidden')).not.toBeNull();
  });

  it('accepts a browsable module with no renderRow — it simply is not listable', () => {
    const mod = baseModule('m34-no-row') as Partial<FrontendModule>;
    delete mod.renderRow;
    expect(() =>
      clientPluginHost.registerFrontendModule(mod as unknown as FrontendModule),
    ).not.toThrow();
  });

  it('rejects a module missing a required render slot', () => {
    const mod = baseModule('m34-missing-card');
    delete (mod as Partial<FrontendModule>).renderCard;
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow(
      /renderCard.*must be a React component/,
    );
  });

  it("rejects 'detailPanel' without 'routes' — a panel with no route to live on", () => {
    const mod = baseModule('m34-panel-no-routes');
    delete (mod as Partial<FrontendModule>).routes;
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow(
      /'detailPanel' without 'routes'/,
    );
  });

  it("rejects 'routes' without 'detailPanel' — a route with no panel to render", () => {
    const mod = baseModule('m34-routes-no-panel');
    delete (mod as Partial<FrontendModule>).detailPanel;
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow(
      /'routes' without 'detailPanel'/,
    );
  });

  it('[ac:ac-modul-frontendu-typu-ukrytego-bez-rou] a hidden-type module (no routes, no detailPanel) that does not declare renderOverlay is rejected at registration', () => {
    const mod = hiddenModule('m34-hidden-no-overlay') as Partial<FrontendModule>;
    delete mod.renderOverlay;
    expect(mod.routes).toBeUndefined();
    expect(mod.detailPanel).toBeUndefined();
    expect(() =>
      clientPluginHost.registerFrontendModule(mod as unknown as FrontendModule),
    ).toThrow(/hidden entity.*must supply 'renderOverlay'/);
    // Rejected means not in the registry.
    expect(clientPluginHost.getAvailable('m34-hidden-no-overlay')).toBeNull();
    // The same hidden module WITH the overlay registers: the missing overlay alone is the fault.
    expect(() => clientPluginHost.registerFrontendModule(hiddenModule('m34-hidden-no-overlay'))).not.toThrow();
    expect(clientPluginHost.getAvailable('m34-hidden-no-overlay')).not.toBeNull();
  });

  it('[ac:ac-modul-frontendu-bez-slotu-listbytags] a frontend module without listByTags is rejected at registration', () => {
    const mod = baseModule('m34-no-list-by-tags') as Partial<FrontendModule>;
    delete mod.listByTags;
    expect(() =>
      clientPluginHost.registerFrontendModule(mod as unknown as FrontendModule),
    ).toThrow(/'listByTags' must be a function/);
    expect(clientPluginHost.getAvailable('m34-no-list-by-tags')).toBeNull();
    // A hidden module is held to the same requirement.
    const hidden = hiddenModule('m34-hidden-no-list-by-tags') as Partial<FrontendModule>;
    delete hidden.listByTags;
    expect(() =>
      clientPluginHost.registerFrontendModule(hidden as unknown as FrontendModule),
    ).toThrow(/'listByTags' must be a function/);
    expect(clientPluginHost.getAvailable('m34-hidden-no-list-by-tags')).toBeNull();
  });

  it('[ac:ac-modul-frontendu-bez-slotu-usegetbyslu] a frontend module without useGetBySlug is rejected at registration', () => {
    const mod = baseModule('m34-no-use-get-by-slug') as Partial<FrontendModule>;
    delete mod.useGetBySlug;
    expect(() =>
      clientPluginHost.registerFrontendModule(mod as unknown as FrontendModule),
    ).toThrow(/'useGetBySlug' must be a function/);
    expect(clientPluginHost.getAvailable('m34-no-use-get-by-slug')).toBeNull();
    const hidden = hiddenModule('m34-hidden-no-use-get-by-slug') as Partial<FrontendModule>;
    delete hidden.useGetBySlug;
    expect(() =>
      clientPluginHost.registerFrontendModule(hidden as unknown as FrontendModule),
    ).toThrow(/'useGetBySlug' must be a function/);
    expect(clientPluginHost.getAvailable('m34-hidden-no-use-get-by-slug')).toBeNull();
  });

  it('[ac:ac-encja-ukryta-typ-bez-frontend-sidebar] a hidden entity is a full authoring shape for an external plugin; registration requires the four slots and checks routes <-> detailPanel', () => {
    // The plugin-facing door: the very function `@c4s/plugin-runtime` hands a plugin.
    expect(pluginRuntime.registerFrontendModule).toBe(registerFrontendModule);

    // A hidden type — no sidebarTab, no routes, no detailPanel, no renderRow — registers.
    const hidden = hiddenModule('ext-hidden') as Partial<FrontendModule>;
    delete hidden.sidebarTab;
    expect(hidden.sidebarTab).toBeUndefined();
    expect(() => pluginRuntime.registerFrontendModule(hidden as unknown as FrontendModule)).not.toThrow();
    expect(clientPluginHost.getAvailable('ext-hidden')).toBe(hidden);

    // Each of the four required slots is required of it.
    for (const slot of ['renderChip', 'renderCard', 'useGetBySlug', 'listByTags'] as const) {
      const type = `ext-hidden-no-${slot.toLowerCase()}`;
      const mod = hiddenModule(type) as Partial<FrontendModule>;
      delete mod[slot];
      expect(() => pluginRuntime.registerFrontendModule(mod as unknown as FrontendModule), slot).toThrow(
        new RegExp(`'${slot}' must be`),
      );
      expect(clientPluginHost.getAvailable(type), slot).toBeNull();
    }

    // routes <-> detailPanel consistency is checked at registration: half a pair is refused.
    const routesOnly = { ...hiddenModule('ext-routes-only'), routes: routesFragment, renderOverlay: undefined };
    expect(() => pluginRuntime.registerFrontendModule(routesOnly as unknown as FrontendModule)).toThrow(
      /'routes' without 'detailPanel'/,
    );
    const panelOnly = { ...hiddenModule('ext-panel-only'), detailPanel: Noop, renderOverlay: undefined };
    expect(() => pluginRuntime.registerFrontendModule(panelOnly as unknown as FrontendModule)).toThrow(
      /'detailPanel' without 'routes'/,
    );
    expect(clientPluginHost.getAvailable('ext-routes-only')).toBeNull();
    expect(clientPluginHost.getAvailable('ext-panel-only')).toBeNull();
  });

  it('[ac:ac-modul-frontendu-typu-z-trasa-detalu-r] a module of a type with a detail route (routes + detailPanel) that declares renderOverlay is rejected at registration', () => {
    const mod = {
      ...baseModule('m34-overlay-and-route'),
      renderOverlay: Noop,
    } as unknown as FrontendModule;
    expect(mod.routes).toBeTypeOf('function');
    expect(mod.detailPanel).toBeTypeOf('function');
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow(
      /declares 'renderOverlay' while having a detail route/,
    );
    // Rejected means not in the registry — neither available nor active.
    expect(clientPluginHost.getAvailable('m34-overlay-and-route')).toBeNull();
    expect(clientPluginHost.getEntity('m34-overlay-and-route')).toBeNull();
    // The same module without the overlay registers: the overlay alone is the fault.
    const withoutOverlay = { ...mod, renderOverlay: undefined } as FrontendModule;
    expect(() => clientPluginHost.registerFrontendModule(withoutOverlay)).not.toThrow();
    expect(clientPluginHost.getAvailable('m34-overlay-and-route')).not.toBeNull();
  });

  // Optional is not unchecked. A namespace import or a typo'd re-export lands a
  // truthy non-component in the slot; before 0.2.16 these were mandatory and so
  // type-checked, and making them optional must not turn a load-time error into
  // a crash inside whichever page first renders the slot.
  it("rejects a 'detailPanel' that is present but is not a component", () => {
    const mod = baseModule('m34-object-panel');
    (mod as unknown as { detailPanel: unknown }).detailPanel = {};
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow(
      /'detailPanel' is declared but is not a React component/,
    );
  });

  it("rejects a 'renderRow' that is present but is not a component", () => {
    const mod = baseModule('m34-object-row');
    (mod as unknown as { renderRow: unknown }).renderRow = {};
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow(
      /'renderRow' is declared but is not a React component/,
    );
  });

  it("rejects a 'routes' that is present but is not a fragment function", () => {
    const mod = baseModule('m34-object-routes');
    (mod as unknown as { routes: unknown }).routes = {};
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow(
      /'routes' is declared but is not a route-fragment function/,
    );
  });

  it('rejects a module whose useGetBySlug is not a function', () => {
    const mod = baseModule('m34-bad-hook');
    (mod as unknown as { useGetBySlug: unknown }).useGetBySlug = 'not-a-function';
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow(/useGetBySlug.*must be a function/);
  });

  // 2.1.20 — registration runs no smoke test: it registers and mounts nothing.
  // A chip that throws is the `mountFrontend` step's business, where it degrades
  // to the host's `rejected-slot` broken chip and the module stays mounted
  // (`tiptap/mountFrontend.smoke.test.ts`).
  it('registers a module whose renderChip throws — the smoke test belongs to mountFrontend, not registration', () => {
    const mod = baseModule('m34-broken-chip');
    (mod as unknown as { renderChip: FrontendModule['renderChip'] }).renderChip = (() => {
      throw new Error('boom');
    }) as unknown as FrontendModule['renderChip'];
    expect(() => clientPluginHost.registerFrontendModule(mod)).not.toThrow();
    expect(clientPluginHost.getAvailable('m34-broken-chip')).toBe(mod);
  });

  it('does not register a module that fails validation', () => {
    const mod = baseModule('m34-rejected');
    delete (mod as Partial<FrontendModule>).renderChip;
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow();
    expect(clientPluginHost.getAvailable('m34-rejected')).toBeNull();
  });
});

// 0.2.90: deactivation removes the renderer — a chip for a type switched off in
// this project renders broken as `inactive-plugin`, distinct from an unknown type.
describe('categoriseBrokenChip — inactive plugin vs unknown type', () => {
  it('reports inactive-plugin for a registered but deactivated type, and null once active again', async () => {
    const { categoriseBrokenChip } = await import('./host.js');
    clientPluginHost.registerFrontendModule(baseModule('m090-switched-off'));
    clientPluginHost.applyActivation({ active: [], inactive: ['m090-switched-off'], unknown: [] });
    try {
      expect(clientPluginHost.getEntity('m090-switched-off')).toBeNull();
      expect(categoriseBrokenChip('m090-switched-off')).toBe('inactive-plugin');
      expect(categoriseBrokenChip('m090-never-registered')).toBe('unknown-type');
    } finally {
      clientPluginHost.applyActivation(null);
    }
    expect(categoriseBrokenChip('m090-switched-off')).toBeNull();
  });
});
