import { describe, it, expect } from 'vitest';
import { buildClonePatch, assertCloneWritingStyleAvailable } from './release-import.js';
import type { BundleConfig } from './release-bundle.js';
import { DomainError } from './tags.js';
import { builtinPagesRoot } from '../config.js';

/**
 * 0.2.8 (C6/C7): the clone must reproduce the WHOLE sanitized config the bundle
 * carries. Before this release it applied five fields and hardcoded a sixth, so
 * a clone silently lost the writing style its specification was authored in.
 *
 * The two units under test are pure by design — the surrounding `clone()` flow
 * needs a remote, a tarball and a DB; these decisions do not.
 */
const bundle = (over: Partial<BundleConfig> = {}): BundleConfig => ({
  $schemaVersion: 4,
  name: 'Source project',
  roots: [builtinPagesRoot()],
  writingStyle: null,
  onboardingCompleted: true,
  entities: undefined,
  agent: { claudeUsePreset: undefined },
  ...over,
});

const opts = { projectId: 'proj-1', fallbackName: 'Remote name' };

describe('buildClonePatch — the clone is faithful to its bundle (C6/C7, 0.2.8)', () => {
  it('applies the writing style the bundle carries', () => {
    const patch = buildClonePatch(bundle({ writingStyle: 'inharness' }), opts);
    expect(patch.writingStyle).toBe('inharness');
  });

  it('applies an explicit "no style" as null rather than dropping the key', () => {
    const patch = buildClonePatch(bundle({ writingStyle: null }), opts);
    expect('writingStyle' in patch).toBe(true);
    expect(patch.writingStyle).toBeNull();
  });

  it('applies agent.claudeUsePreset from the bundle', () => {
    const patch = buildClonePatch(bundle({ agent: { claudeUsePreset: false } }), opts);
    expect(patch.agent).toEqual({ claudeUsePreset: false });
  });

  it('omits the agent branch when the bundle does not carry the flag', () => {
    const patch = buildClonePatch(bundle(), opts);
    expect(patch.agent).toBeUndefined();
  });

  // C7: the pre-0.2.8 hardcoded `true` made "clone a project that has not been
  // onboarded" unreachable — the wizard never ran in the clone.
  it('carries onboardingCompleted: false through, so the clone starts the wizard', () => {
    const patch = buildClonePatch(bundle({ onboardingCompleted: false }), opts);
    expect(patch.onboardingCompleted).toBe(false);
  });

  it('carries onboardingCompleted: true through', () => {
    expect(buildClonePatch(bundle({ onboardingCompleted: true }), opts).onboardingCompleted).toBe(true);
  });

  it('falls back to onboarded when the bundle has no config at all', () => {
    const patch = buildClonePatch(null, opts);
    expect(patch.onboardingCompleted).toBe(true);
    expect(patch.name).toBe('Remote name');
    expect(patch.remoteProjectId).toBe('proj-1');
  });

  it('keeps the existing name precedence: CLI override > bundle > remote', () => {
    expect(buildClonePatch(bundle(), { ...opts, nameOverride: 'CLI' }).name).toBe('CLI');
    expect(buildClonePatch(bundle(), opts).name).toBe('Source project');
    expect(buildClonePatch(bundle({ name: undefined as unknown as string }), opts).name).toBe('Remote name');
  });

  it('still carries roots and entities', () => {
    const patch = buildClonePatch(bundle({ entities: ['ac'], roots: [builtinPagesRoot('docs')] }), opts);
    expect(patch.entities).toEqual(['ac']);
    expect(patch.roots?.[0]?.dir).toBe('docs');
  });

  it('leaves entities undefined when the bundle omits it (undefined = all types)', () => {
    expect('entities' in buildClonePatch(bundle(), opts)).toBe(false);
  });
});

describe('assertCloneWritingStyleAvailable — a style we cannot honour aborts the clone (C6)', () => {
  const registry = (selectable: string[]) => ({
    isSelectable: (slug: string) => selectable.includes(slug),
    unselectableReason: (slug: string) => `is not a selectable writing-style skill (${slug})`,
  });

  it('throws naming the missing style when the bundle points at one we do not have', () => {
    let thrown: unknown;
    try {
      assertCloneWritingStyleAvailable(bundle({ writingStyle: 'acme-house-style' }), registry([]));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    // The code is API-visible (it reaches the CLI's rollback path and the spec's
    // error list), so it is pinned here — a message-only assertion let the
    // identifier drift from the spec unnoticed.
    expect((thrown as DomainError).code).toBe('CLONE_WRITING_STYLE_UNAVAILABLE');
    expect((thrown as DomainError).message).toContain('acme-house-style');
    expect((thrown as DomainError).message).toContain('clone aborted');
  });

  it('passes when the style is installed locally', () => {
    expect(() =>
      assertCloneWritingStyleAvailable(bundle({ writingStyle: 'inharness' }), registry(['inharness'])),
    ).not.toThrow();
  });

  // `null` is a legal value — the source project deliberately had no style.
  it('passes for an explicit null style', () => {
    expect(() => assertCloneWritingStyleAvailable(bundle({ writingStyle: null }), registry([]))).not.toThrow();
  });

  it('passes for a bundle with no config at all', () => {
    expect(() => assertCloneWritingStyleAvailable(null, registry([]))).not.toThrow();
  });
});
