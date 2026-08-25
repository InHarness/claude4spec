import { describe, expect, it } from 'vitest';
import { computeStateWarnings } from '../src/entity/ui-view/lint.js';

/**
 * The `states[]` rules — client-side, non-blocking advice, exactly like the
 * `url` ↔ `params[]` rules they sit beside.
 *
 * Both are about ADDRESSABILITY, which is the only thing about a state name
 * that can be wrong. Nothing here validates a state against the mockup that is
 * supposed to illustrate it: that divergence is legal and deliberately
 * unvalidated, the same way `url`/`params[]` may diverge from the mockup.
 */
describe('ui-view states — the linter', () => {
  it('says nothing about a well-formed declaration', () => {
    expect(
      computeStateWarnings([
        { name: 'empty', label: 'Empty' },
        { name: 'loading' },
        { name: 'read-only' },
      ]),
    ).toEqual([]);
  });

  it('says nothing about an empty declaration — `[]` is the typical value', () => {
    expect(computeStateWarnings([])).toEqual([]);
  });

  it('warns that a duplicate name is UNREACHABLE, not merely redundant', () => {
    // Both entries produce the same `?state=` URL, so whatever the second one
    // meant can never be shown.
    const warnings = computeStateWarnings([{ name: 'empty' }, { name: 'empty', label: 'Other' }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unreachable/i);
    expect(warnings[0]).toContain('empty');
  });

  it('warns that a name outside [a-z0-9-]+ cannot be addressed at all', () => {
    for (const name of ['Empty', 'no_underscores', 'has space', 'ma-ę']) {
      const warnings = computeStateWarnings([{ name }]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/\[a-z0-9-\]\+/);
      expect(warnings[0]).toMatch(/cannot be\s+addressed/i);
    }
  });

  it('warns about a missing name, and does not then also lint its shape', () => {
    expect(computeStateWarnings([{ name: '' }])).toEqual(["states[0]: missing 'name'"]);
  });

  it('never blocks — it only ever returns strings', () => {
    // The contract of the whole module: advice about what is in front of you,
    // computed where it is displayed, with no write path and no throw.
    expect(() => computeStateWarnings([{ name: '<script>' }])).not.toThrow();
  });
});
