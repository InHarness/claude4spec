/**
 * The list screen's grouping — the part the kit deliberately does not compute.
 *
 * Grouping is done on the `srv-*` MIRROR TAG rather than on the `server` field,
 * even though the field is always populated and always correct. The tag is what
 * a page's embedded tool list filters on, so grouping by it makes this screen
 * show what a server's page will show — discrepancies included. Grouping by the
 * field instead would render a tidy list that hides the one failure mode this
 * type actually has.
 */

import { describe, expect, it } from 'vitest';
import { UNGROUPED_LABEL, groupByServerTag } from '../src/entity/mcp-tool/frontend/grouping.js';
import type { McpTool } from '../src/entity/mcp-tool/types.js';

const tool = (name: string, server: string, tags: string[]): McpTool =>
  ({
    slug: `${server}-${name}`,
    title: `${server} · ${name}`,
    name,
    server,
    description: 'x',
    params: [],
    tags,
  }) as McpTool;

const shape = (tools: McpTool[]) =>
  groupByServerTag(tools).map((g) => [g.label, g.items.map((i) => i.name)] as const);

describe('groupByServerTag', () => {
  it('buckets tools under their server and sorts the servers alphabetically', () => {
    expect(
      shape([
        tool('write', 'zeta', ['srv-zeta']),
        tool('read', 'alpha', ['srv-alpha']),
        tool('list', 'alpha', ['srv-alpha']),
      ]),
    ).toEqual([
      ['alpha', ['read', 'list']],
      ['zeta', ['write']],
    ]);
  });

  it('preserves the incoming order of tools inside a group', () => {
    expect(shape([tool('b', 's', ['srv-s']), tool('a', 's', ['srv-s'])])).toEqual([
      ['s', ['b', 'a']],
    ]);
  });

  it('ignores tags that are not mirror tags', () => {
    expect(shape([tool('read', 'alpha', ['entity-mcp-tool', 'srv-alpha', 'm39'])])).toEqual([
      ['alpha', ['read']],
    ]);
  });

  /**
   * THE FAILURE THIS SCREEN EXISTS TO SURFACE. A tool whose mirror tag is missing
   * has already dropped out of its server's embedded list — that is the silent
   * consequence the brief names. Dropping it here too would make the silence
   * total, so it gets a bucket of its own instead.
   */
  it('keeps a tool with no mirror tag visible under its own heading', () => {
    expect(shape([tool('read', 'alpha', []), tool('write', 'beta', ['srv-beta'])])).toEqual([
      ['beta', ['write']],
      [UNGROUPED_LABEL, ['read']],
    ]);
  });

  /**
   * Grouping follows the TAG, not the field — so a tool tagged for a server it
   * does not claim appears under the tag's server. That is not a bug being
   * reproduced: it is what the server's page will actually render, which is the
   * whole reason to group by the tag.
   */
  it('follows the tag when the tag and the server field disagree', () => {
    expect(shape([tool('read', 'alpha', ['srv-beta'])])).toEqual([['beta', ['read']]]);
  });

  /** Two mirror tags means two appearances — a real mistake with a real effect. */
  it('shows a doubly-tagged tool under both servers rather than picking one', () => {
    expect(shape([tool('read', 'alpha', ['srv-alpha', 'srv-beta'])])).toEqual([
      ['alpha', ['read']],
      ['beta', ['read']],
    ]);
  });

  /** The exception bucket sorts LAST, never alphabetically into the middle. */
  it('puts the ungrouped bucket last even when its label would sort first', () => {
    const labels = groupByServerTag([
      tool('x', 'zeta', ['srv-zeta']),
      tool('y', 'anything', []),
    ]).map((g) => g.label);
    expect(labels).toEqual(['zeta', UNGROUPED_LABEL]);
  });

  it('returns nothing for an empty list rather than an empty bucket', () => {
    expect(groupByServerTag([])).toEqual([]);
  });
});
