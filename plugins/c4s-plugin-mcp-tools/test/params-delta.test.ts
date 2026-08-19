/**
 * The delta over `params[]`, which is the one physical decision in this type's
 * schema — `collection: { kind: 'value', identity: ['name'] }`.
 *
 * The alternative (the default) is matching by INDEX, and it is wrong here for a
 * reason that comes from the protocol rather than from taste: in an MCP
 * `inputSchema`, parameters are a MAP KEYED BY NAME, not a list. Position carries
 * no meaning, so swapping two parameters changes no contract — and under index
 * matching would nonetheless produce a cascade of `item_modified`, filling a
 * release diff with noise that says a tool changed when it did not.
 *
 * These assertions are the difference between the two spellings, so they fail
 * loudly if `identity` is ever dropped from the declaration.
 */

import { describe, expect, it } from 'vitest';
import { diffFromSchema } from '../../../src/server/serialization/schema-diff.js';
import { mcpToolData } from '../src/entity/mcp-tool/schema.js';

const P = {
  path: { name: 'path', type: 'string', required: true, description: 'Page path.' },
  section: { name: 'section', type: 'string', description: 'Anchor of one section.' },
  depth: { name: 'depth', type: 'number', description: 'How far to recurse.' },
};

const tool = (params: unknown[]) => ({
  title: 'claude4spec · read_page',
  name: 'read_page',
  server: 'claude4spec',
  description: 'Read one specification page.',
  params,
  logic: null,
});

const ops = (a: unknown[], b: unknown[]) =>
  diffFromSchema(mcpToolData.schema, tool(a) as never, tool(b) as never).map((c) => c.op);

describe('mcp-tool — params delta matches by name, not by position', () => {
  /** THE CLAIM. Reordering is not a change, because order carries no meaning. */
  it('reports nothing when two parameters are swapped', () => {
    expect(ops([P.path, P.section], [P.section, P.path])).toEqual([]);
  });

  it('reports a single item_modified when one parameter actually changes', () => {
    const changed = { ...P.section, description: 'Anchor of a single section.' };
    expect(ops([P.path, P.section], [P.path, changed])).toEqual(['item_modified']);
  });

  it('pairs a modification with its element even after a reorder', () => {
    const changed = { ...P.path, required: false };
    expect(ops([P.path, P.section], [P.section, changed])).toEqual(['item_modified']);
  });

  it('reports an addition as an addition, not as a shift of everything behind it', () => {
    // Inserted FIRST, which is precisely where index matching would report every
    // following element as modified plus one added at the end.
    expect(ops([P.path, P.section], [P.depth, P.path, P.section])).toEqual(['item_added']);
  });

  it('reports a removal as a removal', () => {
    expect(ops([P.path, P.section], [P.path])).toEqual(['item_removed']);
  });

  /**
   * A RENAME is an add plus a remove, and deliberately not a modification: the
   * name IS the identity, so renaming a parameter retires one and introduces
   * another. On the wire that is exactly what happens to a caller.
   */
  it('reads a renamed parameter as one removed and one added', () => {
    const renamed = { ...P.path, name: 'pagePath' };
    expect(ops([P.path], [renamed]).sort()).toEqual(['item_added', 'item_removed']);
  });
});

describe('mcp-tool — scalar fields and the absence of opaque diffs', () => {
  it('reports a plain field_changed on the contract fields', () => {
    const a = tool([]);
    const b = { ...tool([]), description: 'Read one page, by path.' };
    expect(diffFromSchema(mcpToolData.schema, a as never, b as never)).toEqual([
      expect.objectContaining({ op: 'field_changed' }),
    ]);
  });

  /**
   * `logic` is NOT `contentBearing`, which the brief argues for explicitly, and
   * this is the observable consequence: every change to it compares CONTENT.
   * `field_changed_opaque` — the byte-count-only report — is unreachable for this
   * type, so no field of it can ever go silent in a diff.
   */
  it('compares logic by content, never as an opaque byte count', () => {
    const a = { ...tool([]), logic: 'Resolve the path, then read.' };
    const b = { ...tool([]), logic: 'Resolve the path, refuse escapes, then read.' };
    const changes = diffFromSchema(mcpToolData.schema, a as never, b as never);
    expect(changes.map((c) => c.op)).toEqual(['field_changed']);
    expect(changes.map((c) => c.op)).not.toContain('field_changed_opaque');
  });
});
