import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearExtensionReferenceTypes,
  getExtensionReferenceType,
  listExtensionReferenceTypes,
  registerExtensionReferenceType,
} from './reference-extensions.js';

describe('extension reference registry', () => {
  afterEach(() => {
    clearExtensionReferenceTypes();
  });

  it('register/get/list reflect registered entries', () => {
    expect(listExtensionReferenceTypes()).toEqual([]);
    registerExtensionReferenceType({ tag: 'section_ref', attrOrder: ['anchor'] });
    registerExtensionReferenceType({ tag: 'figure_ref', attrOrder: ['id', 'caption'] });

    expect(getExtensionReferenceType('section_ref')).toEqual({
      tag: 'section_ref',
      attrOrder: ['anchor'],
    });
    expect(getExtensionReferenceType('missing')).toBeUndefined();
    expect(listExtensionReferenceTypes().map((e) => e.tag)).toEqual([
      'section_ref',
      'figure_ref',
    ]);
  });

  it('carries an optional entityType for broken-reference detection', () => {
    registerExtensionReferenceType({ tag: 'diagram', attrOrder: ['slug', 'caption'], entityType: 'diagram' });
    expect(getExtensionReferenceType('diagram')?.entityType).toBe('diagram');

    registerExtensionReferenceType({ tag: 'section_ref', attrOrder: ['anchor'] });
    expect(getExtensionReferenceType('section_ref')?.entityType).toBeUndefined();
  });

  it('re-registering the exact same spec is a silent no-op (e.g. re-running onRegister against a fresh registry)', () => {
    registerExtensionReferenceType({ tag: 'diagram', attrOrder: ['slug', 'caption'], entityType: 'diagram' });
    expect(() =>
      registerExtensionReferenceType({ tag: 'diagram', attrOrder: ['slug', 'caption'], entityType: 'diagram' }),
    ).not.toThrow();
    expect(listExtensionReferenceTypes()).toHaveLength(1);
  });

  it('re-registering the same tag with a DIFFERENT definition throws (fail-fast, no silent overwrite)', () => {
    registerExtensionReferenceType({ tag: 'section_ref', attrOrder: ['anchor'] });
    expect(() =>
      registerExtensionReferenceType({ tag: 'section_ref', attrOrder: ['anchor', 'page'] }),
    ).toThrow(/already registered/);

    // The original registration is untouched by the failed second attempt.
    expect(getExtensionReferenceType('section_ref')?.attrOrder).toEqual(['anchor']);
  });

  it('a tag colliding with a core XML tag kind is shadowed (core wins), not thrown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerExtensionReferenceType({ tag: 'inline_mention', attrOrder: ['whatever'] });
    expect(getExtensionReferenceType('inline_mention')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/shadows a core XML tag kind/));
    warn.mockRestore();
  });

  it('rejects invalid tag names', () => {
    for (const tag of ['Section_Ref', '1bad', 'has-hyphen', '_leading', '']) {
      expect(() => registerExtensionReferenceType({ tag, attrOrder: [] })).toThrow(
        /Invalid extension reference tag/,
      );
    }
  });

  it('clearExtensionReferenceTypes empties the registry', () => {
    registerExtensionReferenceType({ tag: 'section_ref', attrOrder: ['anchor'] });
    expect(listExtensionReferenceTypes()).toHaveLength(1);
    clearExtensionReferenceTypes();
    expect(listExtensionReferenceTypes()).toEqual([]);
  });
});
