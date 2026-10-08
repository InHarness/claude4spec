import { useMemo } from 'react';
import { getContextSpec, type RootEditorProps } from '../tiptap/registry.js';
import { rootEditorPropsForRoot } from '../tiptap/contextSpec.js';

/**
 * L13 / 2.1.8: the `page` context is derived from the page root's KIND, not
 * from per-root flags (there are none) and never from its id. A user root is of
 * kind `pages` — anchors and `section_ref`, entity nodes, and `@` over every
 * `pages` root (resolved server-side by the link indexer: source root → builtin
 * → `roots[]` order). 2.1.9: the `skills` root (M52) has a page editor too, and
 * gets its kind's layers — entity nodes, no anchors, no `@`, no page-ref node.
 *
 * One object per kind on purpose: the editor instance is keyed by
 * `(rootId, path)`, and props that changed identity when a query settled would
 * rebuild a just-mounted editor for an identical answer (focus, selection and
 * an open `/` popup lost).
 */
export function useRootEditorProps(rootId: string): RootEditorProps {
  return rootEditorPropsForRoot(rootId);
}

/**
 * 2.1.1 — whether a page in `rootId` has an outline. Read off the resolved
 * `page` context (the outline is the `heading_actions` extension, gated on the
 * anchor layer), so the gutter and its toggle button answer from the one rule
 * that decides what the editor mounts.
 */
export function usePageHasOutline(rootId: string): boolean {
  const rootProps = useRootEditorProps(rootId);
  return useMemo(() => getContextSpec('page', rootProps).extensions.includes('heading_actions'), [rootProps]);
}
