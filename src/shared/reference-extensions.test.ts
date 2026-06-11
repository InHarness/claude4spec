import { describe, expect, it } from 'vitest';
import {
  clearExtensionReferenceTypes,
  getExtensionReferenceType,
  listExtensionReferenceTypes,
  registerExtensionReferenceType,
} from './reference-extensions.js';

describe('extension reference registry', () => {
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

  it('re-registering the same tag overwrites the previous entry', () => {
    registerExtensionReferenceType({ tag: 'section_ref', attrOrder: ['anchor'] });
    registerExtensionReferenceType({ tag: 'section_ref', attrOrder: ['anchor', 'page'] });

    expect(listExtensionReferenceTypes()).toHaveLength(1);
    expect(getExtensionReferenceType('section_ref')?.attrOrder).toEqual(['anchor', 'page']);
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
