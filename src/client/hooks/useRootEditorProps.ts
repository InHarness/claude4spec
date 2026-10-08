import { useMemo } from 'react';
import { getContextSpec, type RootEditorProps } from '../tiptap/registry.js';
import { FULL_ROOT_EDITOR_PROPS } from '../tiptap/contextSpec.js';

/**
 * L13 / 2.1.8: the `page` context is derived from the page root's KIND, not
 * from per-root flags (there are none) and never from its id. Every user root
 * is of kind `pages`, so every page editor gets the same layers — anchors and
 * `section_ref`, entity nodes, and `@` over every `pages` root (resolved
 * server-side by the link indexer: source root → builtin → `roots[]` order).
 *
 * The same object for every page root on purpose: the editor instance is keyed
 * by `(rootId, path)`, and props that changed identity when the config query
 * settled would rebuild a just-mounted editor for an identical answer (focus,
 * selection and an open `/` popup lost).
 */
export function useRootEditorProps(_rootId: string): RootEditorProps {
  // Every page editor opens a page of a `config.roots[]` entry, and every such
  // entry is of kind `pages` (system roots have no page editor): the `pages`
  // kind's layers, the one constant `EditorFactory` also defaults to.
  return FULL_ROOT_EDITOR_PROPS;
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
