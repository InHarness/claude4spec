import { describe, expect, it } from 'vitest';
import { clientPluginHost } from './host.js';
import type { FrontendModule } from './types.js';

const Noop = (() => null) as unknown as FrontendModule['renderCard'];

function baseModule(type: string): FrontendModule {
  return {
    type,
    table: type,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 500,
    pathPrefix: `/${type}s`,
    slugFrom: () => 'x',
    renderChip: Noop,
    renderCard: Noop,
    renderRow: Noop,
    detailPanel: Noop,
    useGetBySlug: () => ({ data: null, isLoading: false }),
    listByTags: async () => [],
  } as unknown as FrontendModule;
}

// M34/L11: registerFrontendModule now validates slot shapes and smoke-tests
// renderChip at LOAD time, so a broken plugin fails registration instead of
// crashing the first page that happens to render its chip.
describe('registerFrontendModule — load-time slot validation', () => {
  it('accepts a well-formed module', () => {
    expect(() => clientPluginHost.registerFrontendModule(baseModule('m34-valid'))).not.toThrow();
  });

  it('rejects a module missing a required component slot', () => {
    const mod = baseModule('m34-missing-detail');
    delete (mod as Partial<FrontendModule>).detailPanel;
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow(/detailPanel.*must be a React component/);
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
    delete (mod as Partial<FrontendModule>).renderRow;
    expect(() => clientPluginHost.registerFrontendModule(mod)).toThrow();
    expect(clientPluginHost.getAvailable('m34-rejected')).toBeNull();
  });
});
