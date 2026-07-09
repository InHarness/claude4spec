import { describe, expect, it } from 'vitest';
import { slugify } from './slug.js';

describe('slugify', () => {
  it('transliterates Latin diacritics as before', () => {
    expect(slugify('Wydajność')).toBe('wydajnosc');
    expect(slugify('Łukasz')).toBe('lukasz');
  });

  it('never returns an empty string for non-Latin-script input', () => {
    expect(slugify('日本語リリース')).not.toBe('');
    expect(slugify('Релиз')).not.toBe('');
    expect(slugify('!!!')).not.toBe('');
    expect(slugify('   ')).not.toBe('');
  });

  it('the fallback is deterministic for the same input', () => {
    expect(slugify('日本語リリース')).toBe(slugify('日本語リリース'));
  });

  it('the fallback never starts with a dot (would be an invisible dotfile)', () => {
    expect(slugify('日本語リリース').startsWith('.')).toBe(false);
    expect(slugify('!!!').startsWith('.')).toBe(false);
  });

  it('the fallback is kebab-case-safe (matches entity-store.ts KEBAB_RE)', () => {
    const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    expect(KEBAB_RE.test(slugify('日本語リリース'))).toBe(true);
    expect(KEBAB_RE.test(slugify('!!!'))).toBe(true);
  });

  it('different non-Latin inputs produce different fallbacks', () => {
    expect(slugify('日本語リリース')).not.toBe(slugify('Релиз'));
  });
});
