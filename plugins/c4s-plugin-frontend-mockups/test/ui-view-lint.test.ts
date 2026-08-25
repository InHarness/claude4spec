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

  /**
   * The convention and the route's whitelist are DIFFERENT lines, and a name can
   * fall between them: `Empty` breaks `[a-z0-9-]+` while the route accepts it
   * verbatim, so that state addresses and renders exactly as asked. Telling its
   * author the state is unreachable would send them after a problem they do not
   * have — the warning has to name the failure it actually is.
   */
  it('warns about a convention-only break WITHOUT claiming the state is unreachable', () => {
    for (const name of ['Empty', 'no_underscores', 'MiXeD-42']) {
      const warnings = computeStateWarnings([{ name }]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/\[a-z0-9-\]\+/);
      expect(warnings[0]).toMatch(/still addresses/i);
      expect(warnings[0]).not.toMatch(/drops it/i);
    }
  });

  it('warns that a name the ROUTE also rejects is dropped, and says so', () => {
    for (const name of ['has space', 'ma-ę', 'a'.repeat(65)]) {
      const warnings = computeStateWarnings([{ name }]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/\[a-z0-9-\]\+/);
      expect(warnings[0]).toMatch(/drops it/i);
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
