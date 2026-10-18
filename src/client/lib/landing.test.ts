import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PagesService } from '../../server/services/pages.js';
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
  } as unknown as Root;
}

const ROUTER_SRC = readFileSync(fileURLToPath(new URL('../router.tsx', import.meta.url)), 'utf-8');
/** The body of the `/` route component (`IndexRoute`) in the router. */
function indexRouteBody(): string {
  const from = ROUTER_SRC.slice(ROUTER_SRC.indexOf('function IndexRoute()'));
  return from.slice(0, from.indexOf('\n}\n'));
}

describe('resolveLandingTarget', () => {
  it('[ac:ac-wejscie-na-przy-istniejacym-c4s-m02] a remembered c4s:m02:last-page pointing at a live page (root still in config.roots[], path in that root tree) lands exactly on that page, and / redirects the editor to it', () => {
    // The base root has an index.md — the remembered page still wins over it.
    const pagesTree = [file('index.md', 'index.md'), file('a.md', 'a.md')];
    const adrTree = [folder('dir', 'dir', [file('x.md', 'dir/x.md')])];
    expect(
      resolveLandingTarget({
        lastPage: { rootId: 'pages', path: 'a.md' },
        roots: [root('pages')],
        pagesTree,
        lastPageTree: pagesTree,
      }),
    ).toEqual({ rootId: 'pages', path: 'a.md' });
    // A remembered page in a non-base user root lands there too (nested path, exact).
    expect(
      resolveLandingTarget({
        lastPage: { rootId: 'adr', path: 'dir/x.md' },
        roots: [root('pages'), root('adr', false)],
        pagesTree,
        lastPageTree: adrTree,
      }),
    ).toEqual({ rootId: 'adr', path: 'dir/x.md' });

    // The `/` route reads the remembered key, validates it against that root's tree
    // and navigates the editor route to exactly that `{ rootId, path }`.
    const body = indexRouteBody();
    expect(body).toMatch(/useLastPage\(\)/);
    expect(body).toMatch(/usePages\(lastPage\?\.rootId \?\? baseRootId\)/);
    expect(body).toMatch(/resolveLandingTarget\(\{ lastPage, roots, pagesTree, lastPageTree \}\)/);
    expect(body).toMatch(
      /<Navigate to="\/space\/\$rootId\/\$" params=\{\{ rootId: target\.rootId, _splat: target\.path \}\} replace \/>/,
    );
  });

  it('[ac:ac-gdy-zapamietana-strona-z-c4s-m02-last-p] a remembered page that no longer exists in its tree, or whose rootId left config.roots[], silently falls through to index → SKILL → tree, with no error and no dialog', () => {
    const goneRoot = { rootId: 'gone-root', path: 'a.md' };
    const gonePath = { rootId: 'pages', path: 'deleted.md' };
    const chains: Array<[PageNode[], string]> = [
      [[file('index.md', 'index.md'), file('a.md', 'a.md')], 'index.md'],
      [[file('SKILL.md', 'SKILL.md'), file('a.md', 'a.md')], 'SKILL.md'],
      [[folder('dir', 'dir', [file('b.md', 'dir/b.md')]), file('a.md', 'a.md')], 'dir/b.md'],
    ];
    for (const [pagesTree, expected] of chains) {
      // rootId gone from config.roots[]
      expect(() =>
        resolveLandingTarget({ lastPage: goneRoot, roots: [root('pages')], pagesTree, lastPageTree: [] }),
      ).not.toThrow();
      expect(
        resolveLandingTarget({ lastPage: goneRoot, roots: [root('pages')], pagesTree, lastPageTree: [] }),
      ).toEqual({ rootId: 'pages', path: expected });
      // path gone from its root tree
      expect(
        resolveLandingTarget({ lastPage: gonePath, roots: [root('pages')], pagesTree, lastPageTree: pagesTree }),
      ).toEqual({ rootId: 'pages', path: expected });
    }
    // No error surface and no dialog on the `/` route: it only redirects or renders the empty state.
    const body = indexRouteBody();
    expect(body).not.toMatch(/toast|confirm\(|alert\(|Dialog|Modal|throw /);
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

  it('2.1.9 — falls through silently when the remembered root is a registry root WITHOUT a facade (a hidden system root such as plans)', () => {
    const pagesTree = [file('index.md', 'index.md')];
    const plansTree = [file('p.md', 'p.md')];
    const target = resolveLandingTarget({
      lastPage: { rootId: 'plans', path: 'p.md' },
      roots: [root('pages')],
      pagesTree,
      lastPageTree: plansTree,
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

  it('[ac:ac-wejscie-na-przy-braku-klucza-c4s-m0] with no c4s:m02:last-page key, an index.md / index.mdx at the top of the builtin root is the landing; index.md beats index.mdx when both exist', () => {
    // index.md alone
    expect(
      resolveLandingTarget({
        lastPage: null,
        roots: [root('pages')],
        pagesTree: [file('a.md', 'a.md'), file('index.md', 'index.md')],
        lastPageTree: [],
      }),
    ).toEqual({ rootId: 'pages', path: 'index.md' });
    // index.mdx alone
    expect(
      resolveLandingTarget({
        lastPage: null,
        roots: [root('pages')],
        pagesTree: [file('a.md', 'a.md'), file('index.mdx', 'index.mdx')],
        lastPageTree: [],
      }),
    ).toEqual({ rootId: 'pages', path: 'index.mdx' });
    // the root carrying the `builtin` flag, whatever its id
    expect(
      resolveLandingTarget({
        lastPage: null,
        roots: [root('adr', false), root('main-content', true)],
        pagesTree: [file('index.mdx', 'index.mdx')],
        lastPageTree: [],
      }),
    ).toEqual({ rootId: 'main-content', path: 'index.mdx' });
    // both: index.md wins

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

  it('[ac:ac-wejscie-na-przy-braku-klucza-i-braku] with no key and no index.*, a SKILL.md (any letter case) at the top of the pages root is the landing', () => {
    for (const name of ['SKILL.md', 'skill.md', 'Skill.MD']) {
      const pagesTree = [file('a.md', 'a.md'), file(name, name), folder('dir', 'dir', [file('b.md', 'dir/b.md')])];
      expect(
        resolveLandingTarget({ lastPage: null, roots: [root('pages')], pagesTree, lastPageTree: [] }),
      ).toEqual({ rootId: 'pages', path: name });
    }
    // only at the top level: a nested SKILL.md does not count
    const nested = [folder('dir', 'dir', [file('SKILL.md', 'dir/SKILL.md')]), file('a.md', 'a.md')];
    expect(
      resolveLandingTarget({ lastPage: null, roots: [root('pages')], pagesTree: nested, lastPageTree: [] }),
    ).toEqual({ rootId: 'pages', path: 'dir/SKILL.md' }); // first tree file, not a SKILL match
    expect(findRootSkillFile(nested)).toBeNull();
  });

  it('[ac:ac-wejscie-na-przy-braku-klucza-index] with no key, no index.* and no SKILL.md, the landing is the first file in page-tree order (frontmatter order ascending, then alphabetical)', async () => {
    // The real page tree (M02 facade) of a root on disk: order ascending, then by name.
    const cwd = mkdtempSync(join(tmpdir(), 'c4s-landing-'));
    try {
      mkdirSync(join(cwd, 'pages'), { recursive: true });
      writeFileSync(join(cwd, 'pages', 'a.md'), '# A\n');
      writeFileSync(join(cwd, 'pages', 'b.md'), '---\norder: 2\n---\n# B\n');
      writeFileSync(join(cwd, 'pages', 'd.md'), '---\norder: 1\n---\n# D\n');
      writeFileSync(join(cwd, 'pages', 'c.md'), '---\norder: 1\n---\n# C\n');
      const tree = await new PagesService(cwd, 'pages', 'pages').listTree();
      expect(tree.map((n) => n.path)).toEqual(['c.md', 'd.md', 'b.md', 'a.md']);
      expect(
        resolveLandingTarget({ lastPage: null, roots: [root('pages')], pagesTree: tree, lastPageTree: [] }),
      ).toEqual({ rootId: 'pages', path: 'c.md' });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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
