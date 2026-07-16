import { describe, expect, it } from 'vitest';
import {
  findRootIndexFile,
  findRootSkillFile,
  firstLeaf,
  pathExistsInTree,
  resolveLandingTarget,
} from './landing.js';
import type { PageNode } from '../../shared/types.js';
import type { Root } from '../../shared/types.js';

function file(name: string, path: string): PageNode {
  return { type: 'file', name, path };
}

function folder(name: string, path: string, children: PageNode[]): PageNode {
  return { type: 'folder', name, path, children };
}

function root(id: string, builtin = id === 'pages'): Root {
  return {
    id,
    name: id,
    dir: id,
    builtin,
    releasable: true,
    sectionIndexed: true,
    referenceValidated: true,
    linkTargets: [],
    sidebar: { collapsedByDefault: false },
    briefTarget: true,
  } as unknown as Root;
}

describe('resolveLandingTarget', () => {
  it('returns the remembered page when its root and path still exist', () => {
    const pagesTree = [file('a.md', 'a.md')];
    const target = resolveLandingTarget({
      lastPage: { rootId: 'pages', path: 'a.md' },
      roots: [root('pages')],
      pagesTree,
      lastPageTree: pagesTree,
    });
    expect(target).toEqual({ rootId: 'pages', path: 'a.md' });
  });

  it('falls through silently when the remembered root no longer exists', () => {
    const pagesTree = [file('index.md', 'index.md')];
    const target = resolveLandingTarget({
      lastPage: { rootId: 'gone-root', path: 'a.md' },
      roots: [root('pages')],
      pagesTree,
      lastPageTree: [],
    });
    expect(target).toEqual({ rootId: 'pages', path: 'index.md' });
  });

  it('falls through silently when the remembered path no longer exists in its root tree', () => {
    const pagesTree = [file('index.md', 'index.md')];
    const target = resolveLandingTarget({
      lastPage: { rootId: 'pages', path: 'deleted.md' },
      roots: [root('pages')],
      pagesTree,
      lastPageTree: pagesTree,
    });
    expect(target).toEqual({ rootId: 'pages', path: 'index.md' });
  });

  it('index.md beats index.mdx', () => {
    const pagesTree = [file('index.mdx', 'index.mdx'), file('index.md', 'index.md')];
    const target = resolveLandingTarget({
      lastPage: null,
      roots: [root('pages')],
      pagesTree,
      lastPageTree: [],
    });
    expect(target).toEqual({ rootId: 'pages', path: 'index.md' });
  });

  it('matches index/SKILL case-insensitively', () => {
    const pagesTree = [file('INDEX.MD', 'INDEX.MD')];
    const target = resolveLandingTarget({
      lastPage: null,
      roots: [root('pages')],
      pagesTree,
      lastPageTree: [],
    });
    expect(target).toEqual({ rootId: 'pages', path: 'INDEX.MD' });
  });

  it('falls back to SKILL.md when no index file exists', () => {
    const pagesTree = [file('skill.md', 'skill.md'), file('other.md', 'other.md')];
    const target = resolveLandingTarget({
      lastPage: null,
      roots: [root('pages')],
      pagesTree,
      lastPageTree: [],
    });
    expect(target).toEqual({ rootId: 'pages', path: 'skill.md' });
  });

  it('falls back to the first tree file when no index/SKILL exists', () => {
    const pagesTree = [folder('dir', 'dir', [file('b.md', 'dir/b.md')]), file('a.md', 'a.md')];
    const target = resolveLandingTarget({
      lastPage: null,
      roots: [root('pages')],
      pagesTree,
      lastPageTree: [],
    });
    expect(target).toEqual({ rootId: 'pages', path: 'dir/b.md' });
  });

  it('returns null for an empty tree (render EmptyState)', () => {
    const target = resolveLandingTarget({
      lastPage: null,
      roots: [root('pages')],
      pagesTree: [],
      lastPageTree: [],
    });
    expect(target).toBeNull();
  });

  it('derives the fallback rootId from the builtin root flag, not a hardcoded id', () => {
    const pagesTree = [file('index.md', 'index.md')];
    const target = resolveLandingTarget({
      lastPage: null,
      roots: [root('main-content', true)],
      pagesTree,
      lastPageTree: [],
    });
    expect(target).toEqual({ rootId: 'main-content', path: 'index.md' });
  });
});

describe('findRootIndexFile / findRootSkillFile', () => {
  it('only match at the root level, not nested folders', () => {
    const tree = [folder('dir', 'dir', [file('index.md', 'dir/index.md')])];
    expect(findRootIndexFile(tree)).toBeNull();
    expect(findRootSkillFile(tree)).toBeNull();
  });
});

describe('pathExistsInTree', () => {
  it('finds a nested file by exact path', () => {
    const tree = [folder('dir', 'dir', [file('b.md', 'dir/b.md')])];
    expect(pathExistsInTree(tree, 'dir/b.md')).toBe(true);
    expect(pathExistsInTree(tree, 'dir/missing.md')).toBe(false);
  });
});

describe('firstLeaf', () => {
  it('returns the first file depth-first', () => {
    const tree = [folder('dir', 'dir', [file('b.md', 'dir/b.md')]), file('a.md', 'a.md')];
    expect(firstLeaf(tree)).toEqual(file('b.md', 'dir/b.md'));
  });

  it('returns null when there are no files', () => {
    expect(firstLeaf([])).toBeNull();
  });
});
