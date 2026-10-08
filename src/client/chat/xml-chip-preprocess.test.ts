import { describe, expect, it } from 'vitest';
import '../xml-markup/host-renders.js';
import { chipTargetOf, decodePayload, isChipTag, preprocessXmlChips, CHIP_HREF_PREFIX } from './xml-chip-preprocess.js';
import { registerXmlTag } from '../../shared/xml-markup/registry.js';
import { assignTagRender } from '../xml-markup/renders.js';

function chips(text: string): Array<{ kind: string; attrs: Record<string, string> }> {
  const out = preprocessXmlChips(text);
  const re = new RegExp(`\\(${CHIP_HREF_PREFIX}([A-Za-z0-9_-]+)\\)`, 'g');
  return [...out.matchAll(re)].map((m) => decodePayload(m[1]!)!);
}

describe('chat: chip picked from the registry by target (M51)', () => {
  it('every entity / tagged / section tag is a chip; todo stays text', () => {
    expect(['inline_mention', 'single_element', 'element_list', 'tagged_list', 'tagged_list_mixed', 'section_ref'].every(isChipTag)).toBe(true);
    expect(isChipTag('todo')).toBe(false);
    const text = 'a <todo comment="x"/> b <section_ref anchor="abcd1234"/>';
    expect(chips(text).map((c) => c.kind)).toEqual(['section_ref']);
    expect(preprocessXmlChips(text)).toContain('<todo comment="x"/>');
  });

  it('a newly registered tag with an entity target shows up in chat with no change here', () => {
    registerXmlTag({ name: 'scratch_pick', attrOrder: ['type', 'slug'], form: 'inline' });
    expect(chipTargetOf({ attrOrder: ['type', 'slug'] })).toBe('entity');
    expect(chips('<scratch_pick type="dto" slug="user"/>')).toEqual([
      { kind: 'scratch_pick', attrs: { type: 'dto', slug: 'user' } },
    ]);
  });

  it('[ac:m05-znacznik-slug-bez-type-bez-renderu] a tag with `slug` but no `type` and no assigned render stays text, as written — no chip, no broken chip', () => {
    registerXmlTag({ name: 'scratch_slug_only', attrOrder: ['slug'], form: 'inline' });
    expect(chipTargetOf({ attrOrder: ['slug'] })).toBeNull();
    expect(chipTargetOf({ attrOrder: ['slugs'] })).toBeNull();
    expect(isChipTag('scratch_slug_only')).toBe(false);
    const text = 'see <scratch_slug_only slug="my-skill"/> here';
    expect(chips(text)).toEqual([]);
    expect(preprocessXmlChips(text)).toBe(text);
  });

  it('step 0: a tag its owner assigned a render to is shown by that render whatever its attributes; one whose content the chip cannot carry stays text', () => {
    registerXmlTag({ name: 'scratch_rendered', attrOrder: ['slug'], form: 'inline' });
    assignTagRender('scratch_rendered', () => null);
    expect(isChipTag('scratch_rendered')).toBe(true);
    expect(chips('<scratch_rendered slug="my-skill"/>')).toEqual([{ kind: 'scratch_rendered', attrs: { slug: 'my-skill' } }]);
    // `todo` has a render too, but its content is its `comment`, which no chip carries.
    expect(isChipTag('todo')).toBe(false);
  });

  it('sanitizes by attribute name: slug / tags / anchor by pattern; an unknown type survives (host broken chip)', () => {
    expect(chips('<inline_mention type="nope" slug="x"/>')).toEqual([
      { kind: 'inline_mention', attrs: { type: 'nope', slug: 'x' } },
    ]);
    expect(chips('<inline_mention type="Bad Type" slug="x"/>')).toEqual([]);
    expect(chips('<inline_mention type="dto" slug="Bad Slug"/>')).toEqual([]);
    expect(chips('<section_ref anchor="ab"/>')).toEqual([]);
    expect(chips('<tagged_list type="ac" tags="a, b" filter="weird"/>')).toEqual([
      { kind: 'tagged_list', attrs: { type: 'ac', tags: 'a,b', filter: 'and' } },
    ]);
    expect(chips('<single_element type="dto" slug="user" caption="free text"/>')).toEqual([
      { kind: 'single_element', attrs: { type: 'dto', slug: 'user' } },
    ]);
  });

  it('a tag in code stays raw; a chip-only inline code span is unwrapped', () => {
    expect(chips('```\n<inline_mention type="dto" slug="x"/>\n```')).toEqual([]);
    expect(chips('see `<inline_mention type="dto" slug="x"/>`').map((c) => c.attrs.slug)).toEqual(['x']);
    expect(chips('see `<inline_mention type="dto" slug="x"/> and more`')).toEqual([]);
  });
});
