/**
 * The list screen's grouping — the part the kit deliberately does not compute.
 *
 * Grouping is done on the `server` FIELD. An earlier revision grouped on a
 * `srv-{server}` tag mirroring that field, so that a page could embed one
 * server's tools with `<tagged_list tags="srv-…"/>`; that mirror is gone. The
 * server name is a loose label, embedding is done on tags an author picks
 * deliberately, and the two are unrelated.
 *
 * What that buys is visible in what this file no longer has to test. Four cases
 * retired with the mirror — a tool tagged for a server it does not claim, a tool
 * carrying two server tags, a tool carrying none, and a tag that merely looks
 * like a server tag. None of them is a state that can be constructed any more:
 * with one value there is nothing to disagree with.
 */

import { describe, expect, it } from 'vitest';
import { UNGROUPED_LABEL, groupByServer } from '../src/entity/mcp-tool/frontend/grouping.js';
import type { McpTool } from '../src/entity/mcp-tool/types.js';

const tool = (name: string, server: string): McpTool =>
  ({
    slug: `${server}-${name}`,
    title: `${server} · ${name}`,
    name,
    server,
    description: 'x',
    params: [],
  }) as McpTool;

const shape = (tools: McpTool[]) =>
  groupByServer(tools).map((g) => [g.label, g.items.map((i) => i.name)] as const);

describe('groupByServer', () => {
  it('buckets tools under their server and sorts the servers alphabetically', () => {
    expect(
      shape([tool('write', 'zeta'), tool('read', 'alpha'), tool('list', 'alpha')]),
    ).toEqual([
      ['alpha', ['read', 'list']],
      ['zeta', ['write']],
    ]);
  });

  it('preserves the incoming order of tools inside a group', () => {
    expect(shape([tool('b', 's'), tool('a', 's')])).toEqual([['s', ['b', 'a']]]);
  });

  /** Tags exist and are ordinary; the grouping must not look at them at all. */
  it('ignores tags entirely, however server-ish they look', () => {
    const tagged = { ...tool('read', 'alpha'), tags: ['srv-beta', 'entity-mcp-tool'] } as McpTool;
    expect(shape([tagged])).toEqual([['alpha', ['read']]]);
  });

  /**
   * `server` is `required`, but the generated input schema accepts an empty
   * string, so a blank one is reachable. It gets a bucket because a heading with
   * no text is unreadable — not as a consistency check in disguise.
   */
  it('collects blank-server tools under their own heading, sorted last', () => {
    expect(shape([tool('x', 'zeta'), tool('y', '   '), tool('z', '')])).toEqual([
      ['zeta', ['x']],
      [UNGROUPED_LABEL, ['y', 'z']],
    ]);
  });

  it('returns nothing for an empty list rather than an empty bucket', () => {
    expect(groupByServer([])).toEqual([]);
  });
});
