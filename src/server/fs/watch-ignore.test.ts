import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { makeWatchIgnore } from './watch-ignore.js';

describe('makeWatchIgnore', () => {
  const root = '/repo/pages';
  const ignore = makeWatchIgnore(root);

  it('ignores heavy directories under the root', () => {
    expect(ignore(path.join(root, 'node_modules'))).toBe(true);
    expect(ignore(path.join(root, '.git'))).toBe(true);
    expect(ignore(path.join(root, 'sub', 'dist'))).toBe(true);
    expect(ignore(path.join(root, 'coverage'))).toBe(true);
  });

  it('ignores dotfile/dot-dir basenames', () => {
    expect(ignore(path.join(root, '.DS_Store'))).toBe(true);
    expect(ignore(path.join(root, 'foo', '.bar.json.swp'))).toBe(true);
  });

  it('does not ignore normal files under the root', () => {
    expect(ignore(path.join(root, 'index.md'))).toBe(false);
    expect(ignore(path.join(root, 'entities', 'endpoint', 'foo.json'))).toBe(false);
  });

  it('never ignores a watch root, even one named like a heavy dir', () => {
    // PluginWatcher resolves a package to `<pkg>/dist` — that root must be watched.
    const distRoot = '/repo/node_modules/@scope/pkg/dist';
    const ig = makeWatchIgnore(distRoot);
    expect(ig(distRoot)).toBe(false);
    // …but a nested node_modules under it is still ignored.
    expect(ig(path.join(distRoot, 'node_modules'))).toBe(true);
  });

  it('accepts multiple roots', () => {
    const a = '/repo/a/dist';
    const b = '/repo/b/build';
    const ig = makeWatchIgnore([a, b]);
    expect(ig(a)).toBe(false);
    expect(ig(b)).toBe(false);
    expect(ig(path.join(a, 'node_modules'))).toBe(true);
  });
});
