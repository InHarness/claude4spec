/**
 * 2.1.77 (M44 `1j39ajh8`) — the artifact links of the bar above the composer.
 * With `briefs`: `Plan`, `Brief` or `Patch` by context type and binding; without
 * it only the `Plan` link of a thread with a pinned plan.
 */
import { describe, expect, it } from 'vitest';
import { contextLinkKinds } from './contextLinkBar.js';

const WITH = ['entities', 'briefs', 'multi-root'];
const WITHOUT = ['skill-exposure'];

describe('composer artifact link bar by capability (2.1.77)', () => {
  it('with `briefs` the link follows the context type and the thread binding', () => {
    expect(contextLinkKinds({ contextType: 'chat', planPath: 'p.md' }, WITH)).toEqual(['plan']);
    expect(contextLinkKinds({ contextType: 'brief', briefPath: 'b.md' }, WITH)).toEqual(['brief']);
    expect(contextLinkKinds({ contextType: 'patch', patchPath: 'x.md' }, WITH)).toEqual(['patch']);
    expect(contextLinkKinds({ contextType: 'brief', briefPath: 'b.md', planPath: 'p.md' }, WITH)).toEqual(['plan', 'brief']);
    // No capability list read yet = present.
    expect(contextLinkKinds({ contextType: 'brief', briefPath: 'b.md' }, undefined)).toEqual(['brief']);
  });

  it('without `briefs` only the `Plan` link of a thread with a pinned plan', () => {
    expect(contextLinkKinds({ contextType: 'chat', planPath: 'p.md' }, WITHOUT)).toEqual(['plan']);
    expect(contextLinkKinds({ contextType: 'brief', briefPath: 'b.md' }, WITHOUT)).toEqual([]);
    expect(contextLinkKinds({ contextType: 'patch', patchPath: 'x.md', planPath: 'p.md' }, WITHOUT)).toEqual(['plan']);
    expect(contextLinkKinds({ contextType: 'chat', planPath: null }, WITHOUT)).toEqual([]);
  });

  it('never in an `ask` thread', () => {
    expect(contextLinkKinds({ contextType: 'ask', planPath: 'p.md' }, WITH)).toEqual([]);
  });
});
