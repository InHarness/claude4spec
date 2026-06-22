import { describe, expect, it, vi } from 'vitest';
import { lowerEntityContribution, PluginManifestError } from './manifest-adapter.js';
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

  it('synthesizes a mount that mounts a bare routes Router at pathPrefix', () => {
    const routes = { __isRouter: true };
    const mod = lowerEntityContribution(base({ backend: { routes } }));
    expect(typeof mod.backend?.mount).toBe('function');

    const use = vi.fn();
    mod.backend!.mount!({ app: { use } } as unknown as MountContext);
    expect(use).toHaveBeenCalledWith('/glossary', routes);
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
