import { describe, expect, it } from 'vitest';
import {
  parseXmlTags,
  parseXmlTagsExcludingCode,
  serializeXmlTag,
  taggedListVia,
  tagMatchesEntity,
  extractSlugs,
} from './xml-tags.js';
import { registerExtensionReferenceType } from './reference-extensions.js';

describe('parseXmlTags', () => {
  it('parses a core tag with correct positions, line number, attrs and source', () => {
    const md = 'first line\nsee <inline_mention type="dto" slug="user-dto"/> here';
    const tags = parseXmlTags(md);
    expect(tags).toHaveLength(1);
    const tag = tags[0]!;
    expect(tag.kind).toBe('inline_mention');
    expect(tag.source).toBe('core');
    expect(tag.attrs).toEqual({ type: 'dto', slug: 'user-dto' });
    expect(tag.start).toBe(md.indexOf('<inline_mention'));
    expect(tag.end).toBe(tag.start + tag.raw.length);
    expect(md.slice(tag.start, tag.end)).toBe(tag.raw);
    expect(tag.line).toBe(2);
  });

  it('parses multiple tags sorted by start offset', () => {
    const md =
      '<single_element type="endpoint" slug="get-users"/>\n' +
      '<element_list type="ac" slugs="a, b"/>';
    const tags = parseXmlTags(md);
    expect(tags.map((t) => t.kind)).toEqual(['single_element', 'element_list']);
    expect(tags[0]!.line).toBe(1);
    expect(tags[1]!.line).toBe(2);
    expect(tags[0]!.start).toBeLessThan(tags[1]!.start);
  });
});

describe('parseXmlTagsExcludingCode', () => {
  it('drops tags inside fenced blocks and inline code spans, keeps tags outside', () => {
    const md =
      '<inline_mention type="dto" slug="kept"/>\n' +
      '```\n<inline_mention type="dto" slug="in-fence"/>\n```\n' +
      'inline `<single_element type="ac" slug="in-span"/>` example\n' +
      '<single_element type="ac" slug="also-kept"/>';
    const tags = parseXmlTagsExcludingCode(md);
    expect(tags.map((t) => t.attrs.slug)).toEqual(['kept', 'also-kept']);
  });

  it('drops refs nested inside an unknown JSX component block (rename-corruption guard)', () => {
    const md =
      '<inline_mention type="dto" slug="outside"/>\n' +
      '<Callout type="info">\n' +
      '  see <inline_mention type="dto" slug="inside-jsx"/>\n' +
      '</Callout>\n' +
      '<single_element type="ac" slug="also-outside"/>';
    const tags = parseXmlTagsExcludingCode(md);
    expect(tags.map((t) => t.attrs.slug)).toEqual(['outside', 'also-outside']);
  });
});

describe('serializeXmlTag', () => {
  it('emits attributes in canonical order regardless of input order', () => {
    const out = serializeXmlTag('tagged_list', {
      filter: 'open',
      tags: 'auth,core',
      type: 'ac',
    });
    expect(out).toBe('<tagged_list type="ac" tags="auth,core" filter="open"/>');
  });

  it('escapes double quotes and omits empty / null / undefined attrs', () => {
    const out = serializeXmlTag('todo', { comment: 'say "hi"' });
    expect(out).toBe('<todo comment="say &quot;hi&quot;"/>');

    const sparse = serializeXmlTag('tagged_list', {
      type: 'dto',
      tags: '',
      filter: null,
    });
    expect(sparse).toBe('<tagged_list type="dto"/>');
  });

  it('throws for an unknown tag kind', () => {
    expect(() => serializeXmlTag('not_a_kind', {})).toThrow(/Unknown XML tag kind/);
  });
});

describe('extension reference types', () => {
  it('parses registered extension tags with source "extension" and serializes them', () => {
    registerExtensionReferenceType({ tag: 'section_ref', attrOrder: ['anchor'] });

    const md = 'see <section_ref anchor="abc123de"/> for details';
    const tags = parseXmlTags(md);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.kind).toBe('section_ref');
    expect(tags[0]!.source).toBe('extension');
    expect(tags[0]!.attrs).toEqual({ anchor: 'abc123de' });

    expect(serializeXmlTag('section_ref', { anchor: 'abc123de' })).toBe(
      '<section_ref anchor="abc123de"/>',
    );
  });
});

describe('diagram reference (v0.1.64 — 7th extension type)', () => {
  it('parses and roundtrip-serializes a self-closing <diagram/> reference', () => {
    registerExtensionReferenceType({ tag: 'diagram', attrOrder: ['slug', 'caption'] });

    const md = 'see <diagram slug="auth-flow" caption="Auth flow"/> below';
    const tags = parseXmlTags(md);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.kind).toBe('diagram');
    expect(tags[0]!.source).toBe('extension');
    expect(tags[0]!.attrs).toEqual({ slug: 'auth-flow', caption: 'Auth flow' });

    expect(serializeXmlTag('diagram', { slug: 'auth-flow', caption: 'Auth flow' })).toBe(
      '<diagram slug="auth-flow" caption="Auth flow"/>',
    );
  });

  it('matches the diagram entity by slug (type encoded in the tag name, no type attr)', () => {
    registerExtensionReferenceType({ tag: 'diagram', attrOrder: ['slug', 'caption'] });
    const [tag] = parseXmlTags('<diagram slug="auth-flow" caption="x"/>');
    expect(tagMatchesEntity(tag!, 'diagram', 'auth-flow')).toBe(true);
    expect(tagMatchesEntity(tag!, 'diagram', 'other')).toBe(false);
    expect(tagMatchesEntity(tag!, 'dto', 'auth-flow')).toBe(false);
    expect(extractSlugs(tag!)).toEqual(['auth-flow']);
  });
});

describe('taggedListVia', () => {
  it('returns [] for tagged_list when the type attribute does not match', () => {
    const [tag] = parseXmlTags('<tagged_list type="dto" tags="auth,core"/>');
    expect(taggedListVia(tag!, 'endpoint', new Set(['auth', 'core']))).toEqual([]);
  });

  it('returns the intersection of tag attrs and entity tags; tagged_list_mixed ignores type', () => {
    const [list] = parseXmlTags('<tagged_list type="dto" tags="auth, core, extra"/>');
    expect(taggedListVia(list!, 'dto', new Set(['core', 'auth', 'other']))).toEqual([
      'auth',
      'core',
    ]);

    const [mixed] = parseXmlTags('<tagged_list_mixed tags="auth,billing"/>');
    expect(taggedListVia(mixed!, 'anything-at-all', new Set(['billing']))).toEqual(['billing']);
  });

  it('returns [] for non-tagged-list kinds', () => {
    const [tag] = parseXmlTags('<inline_mention type="dto" slug="x"/>');
    expect(taggedListVia(tag!, 'dto', new Set(['x']))).toEqual([]);
  });
});
