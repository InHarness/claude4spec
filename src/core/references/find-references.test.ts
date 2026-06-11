import { describe, expect, it } from 'vitest';
import { findReferences } from './find-references.js';
import type { FindReferencesDeps } from './types.js';

function depsWith(pages: Array<{ path: string; body: string }>, tagSlugs: string[] = []): FindReferencesDeps {
  return {
    pages: { listPages: async () => pages },
    host: { entityExists: () => true },
    getEntityTagSlugs: () => tagSlugs,
  };
}

const PAGES = [
  {
    path: 'overview.md',
    body: [
      'Intro',
      '<inline_mention type="endpoint" slug="get-users"/>',
      '<tagged_list type="endpoint" tags="api,auth" filter="or"/>',
      '<tagged_list_mixed tags="api" filter="or"/>',
    ].join('\n'),
  },
];

describe('findReferences', () => {
  it('[ac:ac-encja-bez-tagow-wywolana-z-includetagmat] untagged entity with includeTagMatches: true returns the same output as false (no tagged_list rows)', async () => {
    const deps = depsWith(PAGES, []);
    const without = await findReferences(deps, 'endpoint', 'get-users');
    const withMatches = await findReferences(deps, 'endpoint', 'get-users', {
      includeTagMatches: true,
    });
    expect(withMatches).toEqual(without);
    expect(withMatches).toHaveLength(1);
    expect(withMatches[0]?.tagType).toBe('inline_mention');
    expect(withMatches.some((h) => h.via)).toBe(false);
  });

  it('[ac:m11-find-references-unknown-slug-empty] unknown slug returns an empty array instead of an error', async () => {
    const deps = depsWith(PAGES, []);
    const hits = await findReferences(deps, 'endpoint', 'no-such-slug', {
      includeTagMatches: true,
    });
    expect(hits).toEqual([]);
  });
});
