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
  flags: [],
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

    // `agent` runs an agent turn and `resolve` is a composition — each is an
    // exception someone wrote down rather than one the check invented.
    for (const name of ['agent', 'resolve']) {
      expect(validateCommandContributions([contribution({ name })], isCatalogOperation)).toEqual([]);
    }
    // 2.1.26 — `ask` is no exception any more: it renders the catalog operation
    // `ask`, so a contribution named `ask` without the operation is refused.
    expect(validateCommandContributions([contribution({ name: 'ask' })], isCatalogOperation)).toHaveLength(1);
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

/**
 * 2.1.26 (M11 L14 `m11dcmds`) — the command surface against its operations.
 * `PAGE_NOT_FOUND` belongs to the page reads — `get-page`, `get-page-outline`,
 * and `get-sections` as an item error — and no longer to `list-pages`, which
 * addresses a root. `get-field-content` renders the generic core operation
 * `get_field_content` rather than being generated per field.
 */
describe('the 2.1.26 command surface', () => {
  it('[section:m11dcmds] PAGE_NOT_FOUND is declared by get-page, get-page-outline and get-sections, not by list-pages', async () => {
    const { getPageCommand } = await import('./commands/get-page.js');
    const { getPageOutlineCommand } = await import('./commands/get-page-outline.js');
    const { getSectionsCommand } = await import('./commands/get-sections.js');
    const { listPagesCommand } = await import('./commands/list-pages.js');
    for (const c of [getPageCommand, getPageOutlineCommand, getSectionsCommand]) {
      expect(c.errorCodes, c.name).toContain('PAGE_NOT_FOUND');
    }
    expect(listPagesCommand.errorCodes).not.toContain('PAGE_NOT_FOUND');
    // 2.1.53 — an unknown root is the core's INVALID_ARGUMENT; ROOT_NOT_FOUND is
    // no longer a CLI code.
    for (const c of [listPagesCommand, getPageCommand, getPageOutlineCommand]) {
      expect(c.errorCodes as readonly string[], c.name).not.toContain('ROOT_NOT_FOUND');
      expect(c.errorCodes, c.name).toContain('INVALID_ARGUMENT');
    }
  });

  it('[section:m11dcmds] get-field-content renders the generic core operation get_field_content', async () => {
    const { getFieldContentCommand } = await import('./commands/get-field-content.js');
    const { CATALOG } = await import('../../server/operations/catalog.js');
    const { registerCoreOperations } = await import('../../server/operations/core-operations.js');
    registerCoreOperations();
    expect(getFieldContentCommand.operation).toBe('get_field_content');
    expect(getFieldContentCommand.executionMode).toBe('server-delegating');
    expect(CATALOG.require('get_field_content').channels.cli.kind).toBe('direct');
    expect(validateCommandContributions([getFieldContentCommand], (n) => CATALOG.has(n))).toEqual([]);
  });
});
