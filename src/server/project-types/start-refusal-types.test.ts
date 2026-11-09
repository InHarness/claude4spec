/**
 * 2.1.77 — M57 `91ci7cqx`: a faulty project-type entry stops the SERVER START
 * with `PROJECT_TYPE_REGISTRY_INVALID`. The host's entries (and, for the
 * capability-fit case, the settings layer) are swapped through their module
 * seams; the real `buildProjectTypeRegistry` validates them inside `startServer`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectTypeEntry } from './registry.js';
import type { FieldDeclaration } from '../settings/field-registry.js';

type Start = typeof import('../index.js')['startServer'];

const START_OPTS = {
  cwd: '/nonexistent-c4s-start-refusal-types',
  port: 0,
  registry: { getWorkspace: () => undefined },
  workspace: { name: 'w' },
} as unknown as Parameters<Start>[0];

const base: ProjectTypeEntry = {
  slug: 'skill',
  name: 'Skill',
  description: 'd',
  promptDescription: 'p',
  capabilities: ['skill-exposure'],
  onboarding: null,
  starterContent: null,
};

/** Swaps the host's type entries, then starts the server. */
async function startWith(entries: ProjectTypeEntry[], extraFields: FieldDeclaration[] = []) {
  vi.resetModules();
  vi.doMock('./entries.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./entries.js')>()),
    HOST_PROJECT_TYPE_ENTRIES: entries,
  }));
  vi.doMock('../settings/registry.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../settings/registry.js')>();
    return {
      ...actual,
      buildFieldRegistry: (...args: Parameters<typeof actual.buildFieldRegistry>) =>
        actual.buildFieldRegistry(...args).register(...extraFields),
    };
  });
  const { startServer } = await import('../index.js');
  return startServer(START_OPTS);
}

const refusal = { code: 'PROJECT_TYPE_REGISTRY_INVALID', name: 'ProjectTypeRegistryError' };

afterEach(() => {
  vi.doUnmock('./entries.js');
  vi.doUnmock('../settings/registry.js');
  vi.resetModules();
});

describe('M57 L20 — a faulty type entry stops the server start (2.1.77)', () => {
  it('[ac:ac-dwa-wpisy-typu-projektu-o-tym-samym-s] two entries with the same slug make startServer reject with PROJECT_TYPE_REGISTRY_INVALID naming the slug', async () => {
    await expect(startWith([base, { ...base, name: 'Skill 2' }])).rejects.toMatchObject({
      ...refusal,
      declaration: 'skill',
    });
  });

  it('[ac:ac-wpis-typu-projektu-nazywajacy-niezade] an entry naming an undeclared capability makes startServer reject with PROJECT_TYPE_REGISTRY_INVALID naming the entry', async () => {
    await expect(
      startWith([{ ...base, capabilities: ['skill-exposure', 'no-such-capability'] }]),
    ).rejects.toMatchObject({ ...refusal, declaration: 'skill' });
  });

  it('[ac:ac-wpis-typu-projektu-z-kluczem-onboardi] an entry with an onboarding key not declared in the project settings layer makes startServer reject with PROJECT_TYPE_REGISTRY_INVALID', async () => {
    await expect(
      startWith([{ ...base, onboarding: { typeKeys: ['no.such.configKey'], steps: [] } }]),
    ).rejects.toMatchObject({ ...refusal, declaration: 'skill' });
  });

  it('[ac:ac-wpis-typu-projektu-z-kluczem-onboardi-2] an entry with an onboarding key whose required capability is outside the type set makes startServer reject with PROJECT_TYPE_REGISTRY_INVALID', async () => {
    const entityKey: FieldDeclaration = {
      key: 'testOnly.entityBoundKey',
      owner: 'test',
      type: 'string',
      default: '',
      effect: 'none',
      resumeLock: false,
      apiWritable: true,
      requires: ['entities'],
    };
    const err = await startWith(
      [{ ...base, onboarding: { typeKeys: ['testOnly.entityBoundKey'], steps: [] } }],
      [entityKey],
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ ...refusal, declaration: 'skill' });
    // The key IS declared — the refusal is the capability fit, not an unknown key.
    expect((err as Error).message).toContain('requires capability "entities"');
  });
});
