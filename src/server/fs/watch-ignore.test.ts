import { describe, expect, it } from 'vitest';
import { isExcludedSubtree } from './watch-ignore.js';

describe('isExcludedSubtree — the exclusion owners declare at mount (relative to the mount dir)', () => {
  it('excludes heavy directories at any depth', () => {
    expect(isExcludedSubtree('node_modules')).toBe(true);
    expect(isExcludedSubtree('node_modules/pkg/index.js')).toBe(true);
    expect(isExcludedSubtree('sub/dist')).toBe(true);
    expect(isExcludedSubtree('coverage/lcov.info')).toBe(true);
  });

  it('excludes every dot-segment subtree (the registry root namespace), including temp files', () => {
    expect(isExcludedSubtree('.DS_Store')).toBe(true);
    expect(isExcludedSubtree('foo/.bar.json.swp')).toBe(true);
    expect(isExcludedSubtree('.git/HEAD')).toBe(true);
    expect(isExcludedSubtree('a/.page.md.tmp')).toBe(true);
  });

  it('does not exclude normal files and dirs', () => {
    expect(isExcludedSubtree('index.md')).toBe(false);
    expect(isExcludedSubtree('entities/endpoint/foo.json')).toBe(false);
    expect(isExcludedSubtree('distribution/notes.md')).toBe(false);
  });
});
