import type { PageNode, SidebarAccordion } from '../../shared/types.js';

/**
 * 2.1.9 (M02 UI, slot „Drzewa stron”) — the page-tree slot is fed by
 * `GET /api/sidebar-accordions`: one accordion per element of the array, in the
 * route's order, labelled `label`, showing the subtree `path` of root `rootId`
 * cut out of that root's tree (`['pages', rootId]`). A file lying outside every
 * accordion subtree of its root therefore has no node in the sidebar — nothing
 * renders the rest of the tree.
 *
 * Pure — the Sidebar component feeds it the array and the trees it fetched.
 */

export interface AccordionView {
  rootId: string;
  key: string;
  label: string;
  /** The accordion's subtree within its root (`''` = the whole root). */
  path: string;
  /** The nodes the accordion shows — paths stay relative to the ROOT, so links and the rename field work unchanged. */
  nodes: PageNode[];
}

/**
 * The children of the folder at `path` in a root's tree (`''` = the whole
 * tree), or `[]` when the tree has no such folder (yet).
 */
export function subtreeOf(tree: readonly PageNode[], path: string): PageNode[] {
  if (path === '') return [...tree];
  let level: readonly PageNode[] = tree;
  let prefix = '';
  for (const segment of path.split('/').filter(Boolean)) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    const folder = level.find((n) => n.type === 'folder' && n.path === prefix);
    if (!folder) return [];
    level = folder.children ?? [];
  }
  return [...level];
}

/**
 * One view per accordion element, in the array's order. `treeOf(rootId)` is the
 * root's tree as fetched (`undefined` while it loads → an empty accordion).
 */
export function accordionViews(
  accordions: readonly SidebarAccordion[],
  treeOf: (rootId: string) => readonly PageNode[] | undefined,
): AccordionView[] {
  return accordions.map((a) => ({
    rootId: a.rootId,
    key: a.key,
    label: a.label,
    path: a.path,
    nodes: subtreeOf(treeOf(a.rootId) ?? [], a.path),
  }));
}

/**
 * The expanded state of an accordion is keyed `(rootId, key)`. It is stored in
 * `c4s:sidebar:pages-open` under the root (the root id is a dimension of the
 * value) as this token, next to the folder paths of that root. A NUL never
 * occurs in a file path, so the token cannot collide with a folder.
 */
export function accordionCollapseToken(key: string): string {
  return `\u0000${key}`;
}

/** Ids of the roots that carry at least one accordion — the only roots whose stored state is read. */
export function accordionRootIds(accordions: readonly SidebarAccordion[]): string[] {
  return [...new Set(accordions.map((a) => a.rootId))];
}
