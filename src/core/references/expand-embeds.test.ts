import { describe, expect, it, vi } from 'vitest';
import { expandEmbeds } from './expand-embeds.js';
import type { ExpansionContext, ExpansionEntity, ExpansionListedEntity } from './types.js';

/**
 * M19 embed expansion (2.1.9). The context here is a hand-built set of
 * read-only collaborators — exactly what the function is allowed to see.
 */

const ENTITIES: Record<string, Record<string, ExpansionEntity>> = {
  endpoint: {
    'get-users': { slug: 'get-users', title: 'List users', href: '/endpoints/get-users', method: 'GET', path: '/api/users' },
    'post-users': { slug: 'post-users', title: 'Create user', href: '/endpoints/post-users', method: 'POST', path: '/api/users' },
  },
  dto: {
    'user-dto': { slug: 'user-dto', title: 'User payload', href: '/dtos/user-dto' },
  },
};

const SECTIONS: Record<string, string> = { abc12345: 'Authentication flow' };

function context(
  overrides: Partial<ExpansionContext> = {},
  listed: ExpansionListedEntity[] = [],
): ExpansionContext & { readEntities: ReturnType<typeof vi.fn>; listByTags: ReturnType<typeof vi.fn> } {
  const readEntities = vi.fn((type: string, slugs: string[], projection: 'empty' | 'full') =>
    slugs.map((slug) => {
      const e = ENTITIES[type]?.[slug];
      if (!e) return { slug, entity: null };
      // The empty projection is the identity skeleton; the full one the record.
      return { slug, entity: projection === 'empty' ? { slug: e.slug, title: e.title, href: e.href } : { ...e } };
    }),
  );
  const listByTags = vi.fn(() => listed);
  return {
    readEntities,
    listByTags,
    sectionHeading: (anchor: string) => SECTIONS[anchor] ?? null,
    findPageLinks: () => [],
    pageTitle: () => null,
    ...overrides,
  } as never;
}

describe('expandEmbeds — M19 embed expansion', () => {
  it('[ac:ac-rozwiniecie-w-formacie-inline-zastepu] inline format replaces an entity tag with the label taken from its `title` field', async () => {
    const text = 'Call <inline_mention type="endpoint" slug="get-users"/> first.\n';
    const { text: out, format } = await expandEmbeds(text, context(), { format: 'inline' });
    expect(format).toBe('inline');
    // The label is the entity's `title` ("List users"), not the slug and not a
    // per-type spelling such as "GET /api/users".
    expect(out).toBe('Call [List users](/endpoints/get-users) first.\n');
    expect(out).not.toContain('<inline_mention');

    // The same source of the label for a type whose title is unrelated to its slug.
    const dto = await expandEmbeds('<inline_mention type="dto" slug="user-dto"/>', context(), { format: 'inline' });
    expect(dto.text).toBe('[User payload](/dtos/user-dto)');

    // A card is a block with the full record, headed by the same label.
    const card = await expandEmbeds('<single_element type="endpoint" slug="get-users"/>', context(), { format: 'inline' });
    expect(card.text.split('\n')[0]).toBe('**List users** (endpoint `get-users`)');
    expect(card.text).toContain('- **method**: GET');
    expect(card.text).toContain('- **path**: /api/users');
  });

  it('[ac:ac-rozwiniecie-zostawia-znacznik-z-zerwa] a tag with a broken slug stays in the text unchanged, its error in resolved[].error', async () => {
    const broken = '<inline_mention type="endpoint" slug="no-such-endpoint"/>';
    const card = '<single_element type="endpoint" slug="gone"/>';
    const list = '<element_list type="endpoint" slugs="get-users,missing-one"/>';
    const text = `See ${broken} and <inline_mention type="endpoint" slug="get-users"/>.\n\n${card}\n\n${list}\n`;

    const inline = await expandEmbeds(text, context(), { format: 'inline' });
    // Every broken tag survives byte for byte; the resolvable one is expanded.
    expect(inline.text).toContain(broken);
    expect(inline.text).toContain(card);
    expect(inline.text).toContain(list);
    expect(inline.text).toContain('[List users](/endpoints/get-users)');

    const json = await expandEmbeds(text, context(), { format: 'json' });
    expect(json.text).toBe(text);
    const errors = json.resolved.filter((r) => r.error !== undefined);
    expect(errors.map((r) => r.raw)).toEqual([broken, card, list]);
    expect(errors[0]!.error).toContain('no-such-endpoint');
    expect(errors[2]!.error).toContain('missing-one');
  });

  it('[ac:ac-rozwiniecie-zastepuje-section-ref-tek] a section_ref is replaced with the heading text of the target section', async () => {
    const text = 'Read <section_ref anchor="abc12345"/> before.\n';
    const { text: out } = await expandEmbeds(text, context(), { format: 'inline' });
    expect(out).toBe('Read Authentication flow before.\n');

    // An unknown anchor is a broken target: unchanged, with an error.
    const unknown = 'Read <section_ref anchor="zzzzzz99"/>.';
    const json = await expandEmbeds(unknown, context(), { format: 'json' });
    expect((await expandEmbeds(unknown, context(), { format: 'inline' })).text).toBe(unknown);
    expect(json.resolved[0]).toMatchObject({ kind: 'section_ref', error: expect.stringContaining('zzzzzz99') });
  });

  it('[ac:ac-lista-po-etykietach-w-rozwinieciu-daj] a list by tags yields the entities the listing by those tags returns', async () => {
    const listed: ExpansionListedEntity[] = [
      { type: 'endpoint', slug: 'post-users', title: 'Create user' },
      { type: 'endpoint', slug: 'get-users', title: 'List users' },
    ];
    const ctx = context({}, listed);
    const text = '<tagged_list type="endpoint" tags="auth,users" filter="or"/>';

    const json = await expandEmbeds(text, ctx, { format: 'json' });
    // The listing by tags was asked — with the tag's own type, tags and filter…
    expect(ctx.listByTags).toHaveBeenCalledWith({ type: 'endpoint', tags: ['auth', 'users'], filter: 'or' });
    // …and NOT the reader by slugs: a list by tags is not a read of known slugs.
    expect(ctx.readEntities).not.toHaveBeenCalled();
    // The expanded data is exactly what the listing returned, in its order.
    expect((json.resolved[0]!.data as { entities: ExpansionListedEntity[] }).entities).toEqual(listed);

    const inline = await expandEmbeds(text, ctx, { format: 'inline' });
    const rows = inline.text.split('\n').slice(2);
    expect(rows).toEqual(['| Create user | `post-users` |', '| List users | `get-users` |']);

    // A mixed list asks the listing across types (no `type`) and shows the type column.
    const mixed = await expandEmbeds('<tagged_list_mixed tags="auth"/>', ctx, { format: 'inline' });
    expect(ctx.listByTags).toHaveBeenLastCalledWith({ type: undefined, tags: ['auth'], filter: 'and' });
    expect(mixed.text.split('\n')[0]).toBe('| Type | Title | Slug |');
    expect(mixed.text).toContain('| endpoint | Create user | `post-users` |');
  });

  it('[ac:ac-rozwiniecie-nie-zmienia-linii-kotwic] expansion leaves anchor lines and the frontmatter of the input untouched', async () => {
    const frontmatter = ['---', 'title: Users <inline_mention type="endpoint" slug="get-users"/>', 'tags: [api]', '---'].join('\n');
    const body = [
      '<!-- anchor: aaaa1111 -->',
      '# Users',
      '',
      'See <inline_mention type="endpoint" slug="get-users"/>.',
      '',
      '<!-- anchor: bbbb2222 -->',
      '## Create',
      '',
      '<single_element type="endpoint" slug="post-users"/>',
      '',
    ].join('\n');
    const text = `${frontmatter}\n${body}`;

    const inline = await expandEmbeds(text, context(), { format: 'inline' });
    // The frontmatter block comes back byte-identical — even a tag-shaped value in it.
    expect(inline.text.startsWith(`${frontmatter}\n`)).toBe(true);
    // Every anchor line is still there, on its own line, followed by its heading.
    const lines = inline.text.split('\n');
    expect(lines[lines.indexOf('<!-- anchor: aaaa1111 -->') + 1]).toBe('# Users');
    expect(lines[lines.indexOf('<!-- anchor: bbbb2222 -->') + 1]).toBe('## Create');
    // …while the body's tags were expanded.
    expect(inline.text).toContain('See [List users](/endpoints/get-users).');

    // The json format returns the input itself.
    const json = await expandEmbeds(text, context(), { format: 'json' });
    expect(json.text).toBe(text);
    expect(json.resolved.every((r) => r.start >= frontmatter.length)).toBe(true);
  });

  it('groups reader calls per (type, projection) — many tags are not a cascade of single-slug reads', async () => {
    const ctx = context();
    const text = [
      '<inline_mention type="endpoint" slug="get-users"/>',
      '<inline_mention type="endpoint" slug="post-users"/>',
      '<element_list type="endpoint" slugs="get-users,post-users"/>',
      '<single_element type="endpoint" slug="get-users"/>',
      '<inline_mention type="dto" slug="user-dto"/>',
    ].join('\n');
    await expandEmbeds(text, ctx, { format: 'json' });
    const calls = ctx.readEntities.mock.calls.map(([type, slugs, projection]) => [type, [...(slugs as string[])].sort(), projection]);
    expect(calls).toEqual([
      ['endpoint', ['get-users', 'post-users'], 'empty'],
      ['endpoint', ['get-users'], 'full'],
      ['dto', ['user-dto'], 'empty'],
    ]);
  });

  it('json format carries every tag with its position and expanded data', async () => {
    const text = 'x <inline_mention type="endpoint" slug="get-users"/>\n<section_ref anchor="abc12345"/>';
    const json = await expandEmbeds(text, context(), { format: 'json' });
    expect(json.format).toBe('json');
    expect(json.resolved).toHaveLength(2);
    const [mention, ref] = json.resolved;
    expect(text.slice(mention!.start, mention!.end)).toBe(mention!.raw);
    expect(mention).toMatchObject({ kind: 'inline_mention', line: 1, data: { type: 'endpoint', slug: 'get-users' } });
    expect(ref).toMatchObject({ kind: 'section_ref', line: 2, data: { anchor: 'abc12345', heading: 'Authentication flow' } });
  });
});
