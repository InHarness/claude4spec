import { describe, expect, it } from 'vitest';
import type { PageNode, SidebarAccordion } from '../../shared/types.js';
import { accordionCollapseToken, accordionViews, subtreeOf } from './sidebar-accordions.js';

/**
 * 2.1.9 (M02 UI, slot „Drzewa stron”) — the sidebar renders one accordion per
 * element of `GET /api/sidebar-accordions`, each showing the subtree `path` of
 * its root cut out of the root's tree. These pin the cut the Sidebar renders.
 */

const file = (path: string): PageNode => ({
  type: 'file',
  name: path.split('/').pop()!,
  path,
  fileType: 'markdown',
});
const folder = (path: string, children: PageNode[]): PageNode => ({
  type: 'folder',
  name: path.split('/').pop()!,
  path,
  children,
});

/** Every path a list of nodes renders, depth-first. */
function rendered(nodes: readonly PageNode[]): string[] {
  return nodes.flatMap((n) => [n.path, ...rendered(n.children ?? [])]);
}

const SKILLS_TREE: PageNode[] = [
  folder('reviewer', [file('reviewer/SKILL.md'), file('reviewer/checklist.md')]),
  folder('writer', [folder('writer/workflows', [file('writer/workflows/brief.md')]), file('writer/SKILL.md')]),
  file('loose.md'),
];

const SKILL_ACCORDIONS: SidebarAccordion[] = [
  { rootId: 'skills', key: 'reviewer', label: 'Reviewer', path: 'reviewer' },
  { rootId: 'skills', key: 'writer', label: 'Writer', path: 'writer' },
];

describe('sidebar accordions — subtree cut (M02 slot „Drzewa stron”)', () => {
  it('[ac:ac-plik-lezacy-poza-wszystkimi-poddrzewa] a file lying outside every accordion subtree of its root has no node in the sidebar', () => {
    const views = accordionViews(SKILL_ACCORDIONS, (rootId) => (rootId === 'skills' ? SKILLS_TREE : undefined));
    const all = views.flatMap((v) => rendered(v.nodes));
    // `loose.md` is in the root's tree but in no accordion's subtree → no node anywhere.
    expect(rendered(SKILLS_TREE)).toContain('loose.md');
    expect(all).not.toContain('loose.md');
    // The files inside the subtrees are all there.
    expect(all).toEqual(
      expect.arrayContaining(['reviewer/SKILL.md', 'reviewer/checklist.md', 'writer/SKILL.md', 'writer/workflows/brief.md']),
    );
    // Same rule on any root: a subtree accordion of a `pages` root hides the rest of that root.
    const pagesTree = [folder('guides', [file('guides/intro.md')]), file('outside.md')];
    const [guides] = accordionViews([{ rootId: 'pages', key: 'guides', label: 'Guides', path: 'guides' }], () => pagesTree);
    expect(rendered(guides!.nodes)).toEqual(['guides/intro.md']);
    // The `accordion` case (`path: ''`) shows the whole root, so nothing there is outside.
    expect(rendered(subtreeOf(pagesTree, ''))).toEqual(['guides', 'guides/intro.md', 'outside.md']);
  });

  it('[ac:m52-package-own-accordion] every skill package renders as its own accordion holding only that package\'s files, with its own open state', () => {
    const views = accordionViews(SKILL_ACCORDIONS, () => SKILLS_TREE);
    expect(views.map((v) => ({ key: v.key, label: v.label }))).toEqual([
      { key: 'reviewer', label: 'Reviewer' },
      { key: 'writer', label: 'Writer' },
    ]);
    expect(rendered(views[0]!.nodes)).toEqual(['reviewer/SKILL.md', 'reviewer/checklist.md']);
    expect(rendered(views[1]!.nodes)).toEqual(['writer/workflows', 'writer/workflows/brief.md', 'writer/SKILL.md']);
    // Paths stay root-relative, so a click opens `/space/skills/<package>/…`.
    expect(views.every((v) => v.rootId === 'skills')).toBe(true);
    // The open state is keyed (rootId, key): two packages never share a toggle, and
    // no token can collide with a folder path of the root.
    const tokens = views.map((v) => accordionCollapseToken(v.key));
    expect(new Set(tokens).size).toBe(2);
    for (const t of tokens) expect(rendered(SKILLS_TREE)).not.toContain(t);
  });

  it('a subtree the tree does not have (yet) is an empty accordion, not an error', () => {
    expect(subtreeOf(SKILLS_TREE, 'missing')).toEqual([]);
    expect(accordionViews(SKILL_ACCORDIONS, () => undefined).map((v) => v.nodes)).toEqual([[], []]);
  });
});
