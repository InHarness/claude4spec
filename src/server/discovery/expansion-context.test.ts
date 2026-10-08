import { describe, expect, it, vi } from 'vitest';
import { expandEmbeds } from '../../core/references/index.js';
import { createExpansionContext, type ExpansionContextDeps } from './expansion-context.js';
import type { DiscoveryCore } from './types.js';

/**
 * 2.1.9 — the expansion run over the collaborators of a project context, as a
 * caller builds them (`createExpansionContext`). The discovery cores here are
 * stand-ins answering only the reads the expansion makes; each records what it
 * was asked, which is how "read from P and nothing else" is observed.
 */

interface FakeEntity {
  slug: string;
  title: string;
  tags: string[];
  [field: string]: unknown;
}

function fakeCore(entities: Record<string, FakeEntity[]>) {
  const asked: string[] = [];
  const core = {
    describeTypes: () => ({ types: Object.keys(entities).map((type) => ({ type })) }),
    getEntities: ({ type, slugs, select }: { type: string; slugs: string[]; select?: string[] }) => {
      asked.push(`get:${type}:${slugs.join(',')}`);
      return {
        type,
        selectedFields: select ?? [],
        results: slugs.map((slug) => {
          const e = (entities[type] ?? []).find((x) => x.slug === slug);
          if (!e) return { slug, entity: null };
          return { slug, entity: select && select.length === 0 ? { slug: e.slug, title: e.title, tags: e.tags, href: `/${type}/${slug}` } : e };
        }),
      };
    },
    listEntities: ({ type, tags, tagFilter }: { type: string; tags?: string[]; tagFilter?: 'and' | 'or' }) => {
      asked.push(`list:${type}:${(tags ?? []).join(',')}`);
      const items = (entities[type] ?? [])
        .filter((e) =>
          tagFilter === 'or' ? (tags ?? []).some((t) => e.tags.includes(t)) : (tags ?? []).every((t) => e.tags.includes(t)),
        )
        .map((e) => ({ slug: e.slug, title: e.title }));
      return { mode: 'items' as const, type, items, total: items.length, hasMore: false };
    },
  };
  return { core: core as unknown as DiscoveryCore, asked };
}

function deps(core: DiscoveryCore, pages: Record<string, string> = {}, headings: Record<string, string> = {}): ExpansionContextDeps {
  return {
    discovery: core,
    sections: { getByAnchor: (anchor) => (headings[anchor] ? { headingText: headings[anchor]! } : null) },
    links: {
      resolve: (candidate) => {
        const p = candidate.replace(/^\/+/, '');
        const hit = pages[p] !== undefined ? p : pages[`${p}.md`] !== undefined ? `${p}.md` : null;
        return hit ? { rootId: 'pages', path: hit } : null;
      },
      getFileMeta: (_rootId, relPath) => (pages[relPath] !== undefined ? { title: pages[relPath]! } : undefined),
    },
  };
}

describe('createExpansionContext — expansion in the context of one project', () => {
  it('[ac:ac-rozwiniecie-tekstu-w-kontekscie-proje] expanding a text in the context of project P reads entities only from project P', async () => {
    // Two projects with the SAME slugs and tags, told apart by their titles.
    const p = fakeCore({ endpoint: [{ slug: 'get-users', title: 'P: list users', tags: ['auth'] }] });
    const q = fakeCore({ endpoint: [{ slug: 'get-users', title: 'Q: list users', tags: ['auth'] }] });
    const qSpies = {
      getEntities: vi.spyOn(q.core, 'getEntities'),
      listEntities: vi.spyOn(q.core, 'listEntities'),
      describeTypes: vi.spyOn(q.core, 'describeTypes'),
    };

    const text = [
      '<inline_mention type="endpoint" slug="get-users"/>',
      '<single_element type="endpoint" slug="get-users"/>',
      '<tagged_list type="endpoint" tags="auth"/>',
      '<tagged_list_mixed tags="auth"/>',
    ].join('\n\n');
    const { text: out } = await expandEmbeds(text, createExpansionContext(deps(p.core)), { format: 'inline' });

    // Every label came from P…
    expect(out).toContain('[P: list users](/endpoint/get-users)');
    expect(out).toContain('**P: list users** (endpoint `get-users`)');
    expect(out).toContain('| P: list users | `get-users` |');
    expect(out).not.toContain('Q:');
    // …every read went to P…
    expect(p.asked).toEqual(
      expect.arrayContaining(['get:endpoint:get-users', 'list:endpoint:auth']),
    );
    // …and Q was never asked anything.
    expect(q.asked).toEqual([]);
    for (const spy of Object.values(qSpies)) expect(spy).not.toHaveBeenCalled();
  });

  it('[ac:ac-rozwiniecie-zastepuje-link-do-strony] a link to a page is replaced with that page\'s title', async () => {
    const { core } = fakeCore({});
    const ctx = createExpansionContext(
      deps(core, { 'modules/m19-references.md': 'M19 — References & Consistency', 'guide.md': 'Writing guide' }),
    );

    const text = 'See @modules/m19-references.md and [the guide](guide.md).\n';
    const inline = await expandEmbeds(text, ctx, { format: 'inline' });
    expect(inline.text).toBe('See M19 — References & Consistency and Writing guide.\n');

    const json = await expandEmbeds(text, ctx, { format: 'json' });
    expect(json.text).toBe(text);
    expect(json.resolved.map((r) => [r.kind, r.raw, r.data])).toEqual([
      ['page_link', '@modules/m19-references.md', { targetPath: 'modules/m19-references.md', title: 'M19 — References & Consistency' }],
      ['page_link', '[the guide](guide.md)', { targetPath: 'guide.md', title: 'Writing guide' }],
    ]);

    // A link to no page stays as written, with its error.
    const broken = await expandEmbeds('See @nowhere.md.', ctx, { format: 'json' });
    expect(broken.resolved[0]).toMatchObject({ kind: 'page_link', error: expect.stringContaining('nowhere.md') });
    expect((await expandEmbeds('See @nowhere.md.', ctx, { format: 'inline' })).text).toBe('See @nowhere.md.');
  });

  it('a list by tags in a project context is the listing by those tags, not a read of slugs', async () => {
    const p = fakeCore({
      endpoint: [
        { slug: 'a', title: 'A', tags: ['auth'] },
        { slug: 'b', title: 'B', tags: ['other'] },
        { slug: 'c', title: 'C', tags: ['auth', 'other'] },
      ],
    });
    const json = await expandEmbeds('<tagged_list type="endpoint" tags="auth"/>', createExpansionContext(deps(p.core)), {
      format: 'json',
    });
    expect((json.resolved[0]!.data as { entities: Array<{ slug: string }> }).entities.map((e) => e.slug)).toEqual(['a', 'c']);
    expect(p.asked).toEqual(['list:endpoint:auth']);
  });
});
