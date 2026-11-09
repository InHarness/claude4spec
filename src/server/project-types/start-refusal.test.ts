/**
 * 2.1.77 — M57 `rgkqgr2b`: a faulty capability declaration stops the SERVER START.
 * The host's declarations are swapped (module seam) for a cyclic set; `startServer`
 * must reject with `PROJECT_TYPE_REGISTRY_INVALID` before it builds anything else.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./capabilities.js')>();
  return {
    ...actual,
    hostCapabilityRegistry: () =>
      actual.buildCapabilityRegistry([
        { name: 'entities', owner: 'M13', dependsOn: ['briefs'] },
        { name: 'briefs', owner: 'M21', dependsOn: ['entities'] },
      ]),
  };
});

describe('M57 L19 — start-time validation stops the server (2.1.77)', () => {
  it('[ac:ac-deklaracje-mozliwosci-tworzace-cykl-z] startServer rejects with PROJECT_TYPE_REGISTRY_INVALID when the capability declarations form a cycle', async () => {
    const { startServer } = await import('../index.js');
    const opts = {
      cwd: '/nonexistent-c4s-start-refusal',
      port: 0,
      registry: { getWorkspace: () => undefined },
      workspace: { name: 'w' },
    } as unknown as Parameters<typeof startServer>[0];
    await expect(startServer(opts)).rejects.toMatchObject({
      code: 'PROJECT_TYPE_REGISTRY_INVALID',
      name: 'ProjectTypeRegistryError',
    });
  });
});
