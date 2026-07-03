import { describe, expect, it } from 'vitest';
import { resolveAgainstIndex, buildPageRefIndex } from './pathResolve.js';
import type { PathIndex } from './pathResolve.js';
import type { PageLinksListResponse } from '../../../shared/page-links.js';

function indexOf(...paths: string[]): PathIndex {
  const set = new Set(paths);
  return { has: (p) => set.has(p) };
}

describe('resolveAgainstIndex — dir-strip fallback (M14 0.1.100 step 3b)', () => {
  const idx = indexOf('reference/x.md');

  it("dir='pages' — CWD-relative @pages/reference/x.md strips to the root-relative key", () => {
    expect(resolveAgainstIndex('pages/reference/x.md', idx, undefined, 'pages')).toBe('reference/x.md');
  });

  it("dir='pages' — root-relative @reference/x.md still resolves directly", () => {
    expect(resolveAgainstIndex('reference/x.md', idx, undefined, 'pages')).toBe('reference/x.md');
  });

  it("dir='.' — no-op: a bogus 'pages/...' path does not resolve", () => {
    expect(resolveAgainstIndex('pages/reference/x.md', idx, undefined, '.')).toBeNull();
  });

  it('no dir given — legacy behaviour, dir-prefixed form does not resolve', () => {
    expect(resolveAgainstIndex('pages/reference/x.md', idx)).toBeNull();
  });

  it("collision — exact/root-relative match wins before the dir-strip fallback runs", () => {
    // Both 'pages/x.md' (real file) and 'x.md' exist; @pages/x.md must pick the exact one.
    const collision = indexOf('pages/x.md', 'x.md');
    expect(resolveAgainstIndex('pages/x.md', collision, undefined, 'pages')).toBe('pages/x.md');
  });

  it('extensionless dir-prefixed form falls back to .md then .mdx', () => {
    expect(resolveAgainstIndex('pages/reference/x', idx, undefined, 'pages')).toBe('reference/x.md');
    const mdx = indexOf('reference/y.mdx');
    expect(resolveAgainstIndex('pages/reference/y', mdx, undefined, 'pages')).toBe('reference/y.mdx');
  });
});

describe('buildPageRefIndex — root narrowing + prefix strip', () => {
  const list: PageLinksListResponse = {
    links: {
      'pages:index.md': [{ syntax: 'at', rawToken: '@reference/x.md', targetPath: 'reference/x.md', line: 1, col: 1 }],
      'guide:g.md': [{ syntax: 'at', rawToken: '@other.md', targetPath: 'other.md', line: 1, col: 1 }],
    },
    reverseLinks: {
      'pages:reference/x.md': ['pages:index.md'],
      'guide:other.md': ['guide:g.md'],
    },
    unresolved: {},
    counts: { brokenLinkCount: 0, unresolvedMentionCount: 0, totalLinks: 2 },
  };

  it("narrows to rootId and strips the '${rootId}:' prefix, yielding bare relPaths", () => {
    const idx = buildPageRefIndex(list, 'pages');
    expect(idx.has('index.md')).toBe(true);
    expect(idx.has('reference/x.md')).toBe(true);
    // Another root's files are excluded.
    expect(idx.has('other.md')).toBe(false);
    expect(idx.has('g.md')).toBe(false);
    // No composite keys leak through.
    expect(idx.has('pages:index.md')).toBe(false);
  });

  it('without rootId keeps keys verbatim (legacy cross-root behaviour)', () => {
    const idx = buildPageRefIndex(list);
    expect(idx.has('pages:index.md')).toBe(true);
    // bare targetPaths still present
    expect(idx.has('reference/x.md')).toBe(true);
  });
});
