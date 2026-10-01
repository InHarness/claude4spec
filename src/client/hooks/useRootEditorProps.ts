import { useMemo } from 'react';
import { useRoots } from './useConfig.js';
import { FULL_ROOT_EDITOR_PROPS, getContextSpec, type RootEditorProps } from '../tiptap/registry.js';

function rootPropsKey(p: RootEditorProps): string {
  return `${p.sectionIndexed}|${p.referenceValidated}|${p.linkTargets.join(',')}`;
}

/**
 * L13: the `page` context is derived from the page root's properties, not a
 * fixed list — a user root without section indexing gets no anchors, one
 * without reference validation gets no entity chips (their tags pass through
 * verbatim). Keyed by VALUE, and the not-yet-loaded fallback keys as the
 * default it stands in for: on a cold deep link the config query settles
 * after the editor mounted, and a key that flipped from `null` to the same
 * props would rebuild the instance once for nothing (focus, selection and
 * an open `/` popup lost). A user root whose props differ from the default
 * still rebuilds once, carrying the document.
 */
export function useRootEditorProps(rootId: string): RootEditorProps {
  const root = useRoots().find((r) => r.id === rootId);
  const rootKey = rootPropsKey(
    root
      ? { sectionIndexed: root.sectionIndexed, referenceValidated: root.referenceValidated, linkTargets: root.linkTargets }
      : FULL_ROOT_EDITOR_PROPS,
  );
  return useMemo<RootEditorProps>(
    () =>
      root
        ? {
            sectionIndexed: root.sectionIndexed,
            referenceValidated: root.referenceValidated,
            linkTargets: [...root.linkTargets],
          }
        : FULL_ROOT_EDITOR_PROPS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rootKey],
  );
}

/**
 * 2.1.1 — whether a page in `rootId` has an outline. Read off the resolved
 * `page` context (the outline is the `heading_actions` extension, gated on
 * `sectionIndexed`), so the gutter and its toggle button answer from the one
 * rule that decides what the editor mounts.
 */
export function usePageHasOutline(rootId: string): boolean {
  const rootProps = useRootEditorProps(rootId);
  return useMemo(() => getContextSpec('page', rootProps).extensions.includes('heading_actions'), [rootProps]);
}
