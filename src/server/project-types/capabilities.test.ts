import { describe, expect, it } from 'vitest';
import {
  HOST_CAPABILITY_DECLARATIONS,
  PROJECT_TYPE_REGISTRY_INVALID,
  ProjectTypeRegistryError,
  buildCapabilityRegistry,
  hostCapabilityRegistry,
  projectCapabilitySet,
  satisfies,
  type CapabilityDeclaration,
} from './capabilities.js';

/** Runs `fn`, expecting a start-time registry refusal; returns it. */
function refusal(fn: () => unknown): ProjectTypeRegistryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ProjectTypeRegistryError);
    return err as ProjectTypeRegistryError;
  }
  throw new Error('expected a PROJECT_TYPE_REGISTRY_INVALID refusal, got none');
}

describe('M57 L19 — capability registry (2.1.77)', () => {
  it('the host registry is the sum of the owners’ declarations: entities (M13), briefs (M21), multi-root (M01), skill-exposure (M52)', () => {
    const reg = hostCapabilityRegistry();
    expect(reg.list().map((d) => [d.name, d.owner, d.dependsOn])).toEqual([
      ['entities', 'M13', []],
      ['briefs', 'M21', []],
      ['multi-root', 'M01', []],
      ['skill-exposure', 'M52', []],
    ]);
    expect(HOST_CAPABILITY_DECLARATIONS).toHaveLength(4);
  });

  it('[ac:ac-deklaracje-mozliwosci-tworzace-cykl-z] capability declarations forming a dependency cycle are refused with PROJECT_TYPE_REGISTRY_INVALID naming the declaration', () => {
    const cyclic: CapabilityDeclaration[] = [
      { name: 'alpha', owner: 'MX', dependsOn: ['beta'] },
      { name: 'beta', owner: 'MY', dependsOn: ['gamma'] },
      { name: 'gamma', owner: 'MZ', dependsOn: ['alpha'] },
    ];
    const err = refusal(() => buildCapabilityRegistry(cyclic));
    expect(err.code).toBe(PROJECT_TYPE_REGISTRY_INVALID);
    expect(['alpha', 'beta', 'gamma']).toContain(err.declaration);
    expect(err.message).toContain(PROJECT_TYPE_REGISTRY_INVALID);
    expect(err.message).toMatch(/cycle/);

    // A self-dependency is the shortest cycle.
    const self = refusal(() => buildCapabilityRegistry([{ name: 'solo', owner: 'MX', dependsOn: ['solo'] }]));
    expect(self.code).toBe(PROJECT_TYPE_REGISTRY_INVALID);
    expect(self.declaration).toBe('solo');

    // The same graph without the closing edge is valid.
    expect(() =>
      buildCapabilityRegistry([
        { name: 'alpha', owner: 'MX', dependsOn: ['beta'] },
        { name: 'beta', owner: 'MY', dependsOn: ['gamma'] },
        { name: 'gamma', owner: 'MZ', dependsOn: [] },
      ]),
    ).not.toThrow();
  });

  it('a name declared twice is a registration error, not a precedence rule', () => {
    const err = refusal(() =>
      buildCapabilityRegistry([
        { name: 'briefs', owner: 'M21', dependsOn: [] },
        { name: 'briefs', owner: 'M99', dependsOn: [] },
      ]),
    );
    expect(err.code).toBe(PROJECT_TYPE_REGISTRY_INVALID);
    expect(err.declaration).toBe('briefs');
  });

  it('a dependency on an undeclared capability is refused, naming the declaring row', () => {
    const err = refusal(() => buildCapabilityRegistry([{ name: 'briefs', owner: 'M21', dependsOn: ['ghost'] }]));
    expect(err.code).toBe(PROJECT_TYPE_REGISTRY_INVALID);
    expect(err.declaration).toBe('briefs');
    expect(err.message).toContain('ghost');
  });

  it('a type entry naming an undeclared capability, or a set not closed under dependencies, is refused naming the type', () => {
    const reg = buildCapabilityRegistry([
      { name: 'base', owner: 'MA', dependsOn: [] },
      { name: 'extra', owner: 'MB', dependsOn: ['base'] },
    ]);
    const undeclared = refusal(() => reg.assertTypeCapabilities('demo', ['base', 'nope']));
    expect(undeclared.code).toBe(PROJECT_TYPE_REGISTRY_INVALID);
    expect(undeclared.declaration).toBe('demo');
    const open = refusal(() => reg.assertTypeCapabilities('demo', ['extra']));
    expect(open.declaration).toBe('demo');
    expect(() => reg.assertTypeCapabilities('demo', ['base', 'extra'])).not.toThrow();
    expect(() => reg.assertTypeCapabilities('empty', [])).not.toThrow();
  });

  it('a project capability set answers whether requirements are met', () => {
    const caps = projectCapabilitySet(['entities', 'briefs']);
    expect(satisfies(caps, ['entities'])).toBe(true);
    expect(satisfies(caps, ['entities', 'briefs'])).toBe(true);
    expect(satisfies(caps, ['skill-exposure'])).toBe(false);
    expect(satisfies(caps, undefined)).toBe(true);
  });
});
