import { describe, expect, it } from 'vitest';
import { getXmlTag, isRegisteredXmlTag, listXmlTags, registerXmlTag } from './registry.js';
import { parseXmlTags, serializeXmlTag } from '../xml-tags.js';

/**
 * M51 — the XML markup registry. One per process, keyed by name; the host
 * modules' seven tags are registered at startup (`host-tags.ts`, imported by the
 * test setup as by the server bootstrap and the browser entry).
 */
describe('XML markup registry (M51)', () => {
  it('holds the seven host tags, each declared by the module that contributes it', () => {
    expect(listXmlTags().map((t) => [t.name, t.form, t.attrOrder])).toEqual([
      ['inline_mention', 'inline', ['type', 'slug']],
      ['single_element', 'block', ['type', 'slug', 'caption']],
      ['element_list', 'block', ['type', 'slugs']],
      ['tagged_list', 'block', ['type', 'tags', 'filter']],
      ['tagged_list_mixed', 'block', ['tags', 'filter']],
      ['section_ref', 'inline', ['anchor']],
      ['todo', 'inline', ['comment']],
    ]);
    // No host tag carries a project-dependent `validate`.
    expect(listXmlTags().every((t) => t.validate === undefined)).toBe(true);
  });

  it('[ac:m51-duplicate-registration-throws] a second registration of the same name is a hard error, never last-wins', () => {
    expect(() => registerXmlTag({ name: 'todo', attrOrder: ['comment'], form: 'inline' })).toThrow(/already registered/);
    expect(() => registerXmlTag({ name: 'section_ref', attrOrder: ['anchor', 'label'] })).toThrow(/already registered/);
    expect(getXmlTag('section_ref')!.attrOrder).toEqual(['anchor']);
  });

  it('an absent form means block', () => {
    registerXmlTag({ name: 'scratch_tag', attrOrder: ['id'] });
    expect(getXmlTag('scratch_tag')!.form).toBe('block');
  });

  it('registration is additive: a new tag parses and serializes generically, nothing else changes', () => {
    const before = parseXmlTags('<todo comment="x"/> <scratch_ref id="1" note="n"/>');
    expect(before.map((t) => t.kind)).toEqual(['todo']);
    registerXmlTag({ name: 'scratch_ref', attrOrder: ['note', 'id'], form: 'inline' });
    const after = parseXmlTags('<todo comment="x"/> <scratch_ref id="1" note="n"/>');
    expect(after.map((t) => t.kind)).toEqual(['todo', 'scratch_ref']);
    // The serializer writes attributes in the REGISTERED order.
    expect(serializeXmlTag('scratch_ref', after[1]!.attrs)).toBe('<scratch_ref note="n" id="1"/>');
  });

  it('rejects names that are not snake_case', () => {
    for (const name of ['Callout', 'ui.Card', 'kebab-name', '_lead', 'trail_', 'double__under']) {
      expect(() => registerXmlTag({ name, attrOrder: ['a'] }), name).toThrow(/snake_case/);
    }
  });

  it('a validate is a pure function of the attributes, kept as declared', () => {
    const validate = (attrs: Record<string, string>) => ({ ok: attrs.id === '1', category: 'bad-id' });
    registerXmlTag({ name: 'scratch_checked', attrOrder: ['id'], validate });
    expect(getXmlTag('scratch_checked')!.validate!({ id: '2' })).toEqual({ ok: false, category: 'bad-id' });
  });

  it('a scratch tag does not leak into the next case (the test setup restores the host set)', () => {
    expect(isRegisteredXmlTag('scratch_tag')).toBe(false);
    expect(isRegisteredXmlTag('scratch_ref')).toBe(false);
  });
});
