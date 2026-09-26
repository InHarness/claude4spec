import { describe, expect, it } from 'vitest';
import { pageTarget } from './pageTarget.js';

describe('pageTarget', () => {
  it('uses the root named by a composite key', () => {
    expect(pageTarget('docs:guide/a.md', ['pages', 'docs'], 'pages')).toEqual({ rootId: 'docs', path: 'guide/a.md' });
  });

  it('puts a bare path in the fallback root (the chip document root)', () => {
    expect(pageTarget('guide/a.md', ['pages', 'docs'], 'docs')).toEqual({ rootId: 'docs', path: 'guide/a.md' });
  });

  it('keeps an unknown prefix as part of the path', () => {
    expect(pageTarget('notes:x.md', ['pages'], 'pages')).toEqual({ rootId: 'pages', path: 'notes:x.md' });
  });
});
