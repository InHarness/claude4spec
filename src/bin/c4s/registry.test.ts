import { describe, expect, it } from 'vitest';
import { validateCommandContributions, type CliCommandContribution } from './registry.js';

/**
 * Item 26 — the contribution invariant.
 *
 * A contribution is invalid when it renders a catalog operation in any mode
 * other than `server-delegating`, or declares `server-delegating` while
 * rendering none. Both halves guard the release's hard rule from opposite
 * sides: executing a catalog operation belongs to the SERVER PROCESS, so a
 * command that renders one locally is a second execution locus, and a command
 * that claims the mode without an operation has nothing to delegate — usually
 * because someone changed what it does and left the label.
 *
 * The check is exercised against SYNTHETIC contributions rather than the real
 * ones. Against the real array it could only ever pass, and would then keep
 * passing for the wrong reason if the logic were gutted; a fabricated violation
 * is the only way to know it still refuses one.
 */

const CATALOG = new Set(['overview', 'list_entities', 'get_entities']);
const isCatalogOperation = (n: string): boolean => CATALOG.has(n);

const contribution = (over: Partial<CliCommandContribution>): CliCommandContribution => ({
  name: 'demo',
  executionMode: 'server-delegating',
  errorCodes: [],
  handler: async () => {},
  ...over,
});

describe('validateCommandContributions', () => {
  it('accepts a catalog operation rendered by a server-delegating command', () => {
    expect(
      validateCommandContributions(
        [contribution({ name: 'catalog', operation: 'overview' })],
        isCatalogOperation,
      ),
    ).toEqual([]);
  });

  it('refuses a catalog operation rendered in any other mode', () => {
    for (const executionMode of ['fs-scoped', 'registry-write', 'registry-read', 'scaffold'] as const) {
      const problems = validateCommandContributions(
        [contribution({ name: 'catalog', operation: 'overview', executionMode })],
        isCatalogOperation,
      );
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(executionMode);
      expect(problems[0]).toContain('overview');
    }
  });

  it('refuses an operation name the catalog does not know', () => {
    // Guards the declaration itself: a typo, or an operation renamed on the
    // server and not here, would otherwise make the OTHER half of the check
    // vacuous — it would keep asserting the mode of a name nothing implements.
    const problems = validateCommandContributions(
      [contribution({ name: 'catalog', operation: 'overvieww' })],
      isCatalogOperation,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not in the catalog');
  });

  it('refuses server-delegating with no operation, unless the command is a declared exception', () => {
    const problems = validateCommandContributions([contribution({ name: 'mystery' })], isCatalogOperation);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('names no catalog operation');

    // `agent`/`ask` run an agent turn and `resolve` is a composition — each is
    // an exception someone wrote down rather than one the check invented.
    for (const name of ['agent', 'ask', 'resolve']) {
      expect(validateCommandContributions([contribution({ name })], isCatalogOperation)).toEqual([]);
    }
  });

  it('says nothing about the three server-free modes', () => {
    for (const executionMode of ['fs-scoped', 'registry-write', 'registry-read', 'scaffold'] as const) {
      expect(
        validateCommandContributions([contribution({ name: 'local', executionMode })], isCatalogOperation),
      ).toEqual([]);
    }
  });

  it('reports every problem at once rather than the first', () => {
    const problems = validateCommandContributions(
      [
        contribution({ name: 'a', operation: 'overview', executionMode: 'fs-scoped' }),
        contribution({ name: 'b' }),
        contribution({ name: 'c', operation: 'nope' }),
      ],
      isCatalogOperation,
    );
    expect(problems).toHaveLength(3);
  });
});
