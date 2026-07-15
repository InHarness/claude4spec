import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearExtensionReferenceTypes,
  getExtensionReferenceType,
  listExtensionReferenceTypes,
  registerExtensionReferenceType,
  wouldConflictExtensionReferenceType,
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

  it('re-registering the same tag with an equivalent `validate` closure (different function identity) is a no-op, not a conflict', () => {
    // Regression: a hot-reloaded plugin module re-evaluates fresh on every
    // rebuild, always producing a NEW closure for `validate` even when the
    // plugin's source is logically unchanged — comparing by reference
    // identity made every such reload look like a genuine conflict.
    const validateA = (attrs: Record<string, string>) => ({ ok: Boolean(attrs.id), category: 'missing-id' });
    const validateB = (attrs: Record<string, string>) => ({ ok: Boolean(attrs.id), category: 'missing-id' });
    expect(validateA).not.toBe(validateB);

    registerExtensionReferenceType({ tag: 'figure_ref', attrOrder: ['id'], validate: validateA });
    expect(() =>
      registerExtensionReferenceType({ tag: 'figure_ref', attrOrder: ['id'], validate: validateB }),
    ).not.toThrow();
  });

  it('a tag that goes from having no validate to having one (or vice versa) IS a genuine conflict', () => {
    registerExtensionReferenceType({ tag: 'figure_ref', attrOrder: ['id'] });
    expect(() =>
      registerExtensionReferenceType({ tag: 'figure_ref', attrOrder: ['id'], validate: () => ({ ok: true, category: '' }) }),
    ).toThrow(/already registered/);
  });

  describe('wouldConflictExtensionReferenceType — non-mutating pre-check', () => {
    it('returns null (safe) for a free tag, without registering it', () => {
      expect(wouldConflictExtensionReferenceType({ tag: 'figure_ref', attrOrder: ['id'] })).toBeNull();
      expect(getExtensionReferenceType('figure_ref')).toBeUndefined();
    });

    it('returns null for an identical re-registration and for a core-shadowing tag (both no-ops, not conflicts)', () => {
      registerExtensionReferenceType({ tag: 'figure_ref', attrOrder: ['id'] });
      expect(wouldConflictExtensionReferenceType({ tag: 'figure_ref', attrOrder: ['id'] })).toBeNull();
      expect(wouldConflictExtensionReferenceType({ tag: 'inline_mention', attrOrder: [] })).toBeNull();
    });

    it('returns an error message for a genuine conflict or an invalid tag, without mutating the registry', () => {
      registerExtensionReferenceType({ tag: 'figure_ref', attrOrder: ['id'] });
      expect(wouldConflictExtensionReferenceType({ tag: 'figure_ref', attrOrder: ['id', 'page'] })).toMatch(
        /already registered/,
      );
      expect(wouldConflictExtensionReferenceType({ tag: 'Bad-Tag', attrOrder: [] })).toMatch(
        /Invalid extension reference tag/,
      );
      // Neither call mutated anything.
      expect(getExtensionReferenceType('figure_ref')?.attrOrder).toEqual(['id']);
    });
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
