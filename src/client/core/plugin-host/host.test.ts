import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
import { describe, expect, it } from 'vitest';
import { clientPluginHost } from './host.js';
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
    displayOrder: 500,
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

// M34/L11: registerFrontendModule validates slot shapes and smoke-tests
// renderChip at LOAD time, so a broken plugin fails registration instead of
// crashing the first page that happens to render its chip.
//
// 0.2.16 turned that check from COMPLETENESS into CONSISTENCY: the mandatory
// minimum is `renderChip` + `renderCard`, and what the host refuses is half a
// pair — a detail panel with no route, a route with no panel, a hidden type
// with no overlay, or an overlay on a type that has somewhere to navigate.
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

  it('rejects a module missing one of the two mandatory render slots', () => {
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

  it('rejects a hidden module with no renderOverlay — its chip would click into nothing', () => {
    const mod = hiddenModule('m34-hidden-no-overlay') as Partial<FrontendModule>;
    delete mod.renderOverlay;
    expect(() =>
      clientPluginHost.registerFrontendModule(mod as unknown as FrontendModule),
    ).toThrow(/hidden entity.*must supply 'renderOverlay'/);
  });

  it('rejects renderOverlay on a type that HAS a detail route — the click exception is not its to claim', () => {
    const mod = {
      ...baseModule('m34-overlay-and-route'),
      renderOverlay: Noop,
    } as unknown as FrontendModule;
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow(
      /declares 'renderOverlay' while having a detail route/,
    );
  });

  it('rejects a module whose useGetBySlug is not a function', () => {
    const mod = baseModule('m34-bad-hook');
    (mod as unknown as { useGetBySlug: unknown }).useGetBySlug = 'not-a-function';
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow(/useGetBySlug.*must be a function/);
  });

  it('rejects a module whose renderChip throws synchronously', () => {
    const mod = baseModule('m34-broken-chip');
    (mod as unknown as { renderChip: FrontendModule['renderChip'] }).renderChip = (() => {
      throw new Error('boom');
    }) as unknown as FrontendModule['renderChip'];
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow(
      /renderChip threw during load-time smoke test: boom/,
    );
  });

  it('does not register a module that fails validation', () => {
    const mod = baseModule('m34-rejected');
    delete (mod as Partial<FrontendModule>).renderChip;
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow();
    expect(clientPluginHost.getAvailable('m34-rejected')).toBeNull();
  });
});
