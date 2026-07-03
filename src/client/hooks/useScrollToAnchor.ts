import { useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { useRouterState } from '@tanstack/react-router';

/**
 * Scroll a tiptap document to the heading referenced by a `#anchor-<id>` URL hash and
 * pulse it. Shared by the page editor and the plan editor — both render `anchor_marker`
 * nodes (the `AnchorMarker` extension is `availableIn: ['page', 'plan']`) with a
 * `data-anchor` attribute, and both apply the `prose-spec` class the `anchor-highlight`
 * CSS is scoped to.
 *
 * @param editor   the tiptap editor whose DOM holds the anchor markers
 * @param ready    document-loaded gate (page `data` / plan `content`); scrolling before
 *                 the content is mounted would miss the target
 * @param resetKey identity of the open document (page path / plan id) — re-runs the scan
 *                 when navigating between documents that share a hash
 */
export function useScrollToAnchor(editor: Editor | null, ready: boolean, resetKey?: string) {
  // Subscribed only to re-trigger the effect on hash navigation; the body reads
  // window.location.hash directly (kept identical to the original page implementation).
  const routerHash = useRouterState({ select: (s) => s.location.hash });

  useEffect(() => {
    if (!editor || !ready) return;
    const dom = editor.view.dom as HTMLElement;

    function scrollToHash() {
      const m = /^#anchor-([a-z0-9]{6,12})$/.exec(window.location.hash);
      if (!m) return;
      const anchorId = m[1];
      requestAnimationFrame(() => {
        const marker = dom.querySelector(`anchor_marker[data-anchor="${anchorId}"]`);
        if (!marker) {
          console.warn(`[anchorscr] anchor not found in DOM: ${anchorId}`);
          return;
        }
        let target: Element | null = marker.nextElementSibling;
        while (target && !/^H[1-6]$/i.test(target.tagName)) {
          target = target.nextElementSibling;
        }
        const scrollTarget = (target ?? marker) as HTMLElement;
        scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (target) {
          target.classList.add('anchor-highlight');
          window.setTimeout(() => target.classList.remove('anchor-highlight'), 1000);
        }
      });
    }

    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);
    return () => window.removeEventListener('hashchange', scrollToHash);
  }, [editor, ready, resetKey, routerHash]);
}
