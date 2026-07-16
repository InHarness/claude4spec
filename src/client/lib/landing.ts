import type { PageNode } from '../../shared/types.js';
import type { Root } from '../../shared/types.js';
import { firstLeaf, pathExistsInTree } from '../../shared/page-files.js';

export { firstLeaf, pathExistsInTree };

/** M02: a remembered `{ rootId, path }` pointer, persisted at `c4s:m02:last-page`. */
export interface LastPage {
  rootId: string;
  path: string;
}

/** Root-level (non-recursive) `index.md`/`index.mdx` lookup, case-insensitive; `.md` beats `.mdx`. */
export function findRootIndexFile(nodes: PageNode[]): PageNode | null {
  let mdx: PageNode | null = null;
  for (const n of nodes) {
    if (n.type !== 'file') continue;
    const lower = n.name.toLowerCase();
    if (lower === 'index.md') return n;
    if (lower === 'index.mdx' && !mdx) mdx = n;
  }
  return mdx;
}

/** Root-level (non-recursive) `SKILL.md` lookup, case-insensitive. */
export function findRootSkillFile(nodes: PageNode[]): PageNode | null {
  for (const n of nodes) {
    if (n.type === 'file' && n.name.toLowerCase() === 'skill.md') return n;
  }
  return null;
}

/**
 * First-match-wins landing chain: remembered page → index.md/mdx → SKILL.md → first tree file.
 * `null` means an empty tree — caller renders `EmptyState`. A stale remembered page (root gone
 * from `roots`, or path gone from its tree) falls through silently, no error.
 */
export function resolveLandingTarget(input: {
  lastPage: LastPage | null;
  roots: Root[];
  pagesTree: PageNode[];
  lastPageTree: PageNode[];
}): LastPage | null {
  const { lastPage, roots, pagesTree, lastPageTree } = input;

  if (lastPage) {
    const rootExists = roots.some((r) => r.id === lastPage.rootId);
    if (rootExists && pathExistsInTree(lastPageTree, lastPage.path)) {
      return lastPage;
    }
  }

  // Per-directory behavior is gated on Root flags, never a hardcoded id (src/shared/types.ts).
  const builtinRootId = roots.find((r) => r.builtin)?.id ?? 'pages';

  const indexFile = findRootIndexFile(pagesTree);
  if (indexFile) return { rootId: builtinRootId, path: indexFile.path };

  const skillFile = findRootSkillFile(pagesTree);
  if (skillFile) return { rootId: builtinRootId, path: skillFile.path };

  const first = firstLeaf(pagesTree);
  if (first) return { rootId: builtinRootId, path: first.path };

  return null;
}
