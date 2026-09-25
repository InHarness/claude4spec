import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useRouterState } from '@tanstack/react-router';
import { useTodos } from './useTodos.js';

// 0.2.110: the TODO list links `#anchor-<TodoHit.anchor>` (M08/M50), i.e.
// `#anchor-todo-<line>[-<col>]`. The bare pre-0.2.110 `#todo-…` still resolves,
// so old links keep working. The section scroller's `#anchor-<id>` pattern has
// no `-` in the id, so the two never both match.
const TODO_HASH_RE = /^#(?:anchor-)?(todo-\d+(?:-\d+)?)$/;
const MAX_FRAMES = 30;

/**
 * Scroll a page editor to the TODO marker referenced by a `#anchor-todo-<line>[-<col>]` hash
 * (the `anchor` of a `TodoHit`) and pulse it.
 *
 * The anchor is derived from the server's line/col, which the editor DOM does not
 * carry — so the hit's ordinal among this page's hits (both sides skip code blocks and
 * keep document order) picks the n-th `[data-todo-chip]` NodeView. Best-effort, as the
 * spec declares: a stale index or unsaved edits can miss the target.
 */
export function useScrollToTodo(editor: Editor | null, ready: boolean, rootId: string, path: string) {
  const routerHash = useRouterState({ select: (s) => s.location.hash });
  const { data } = useTodos();
  // `data` is a dependency only so a jump waits for the index to load. A refetch
  // after an edit (`todos:changed`) must not scroll again while the hash stays —
  // so each (root, page, hash) is handled once.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!editor || !ready || !data) return;
    const dom = editor.view.dom as HTMLElement;
    let raf = 0;

    function scrollToHash() {
      const m = TODO_HASH_RE.exec(window.location.hash);
      if (!m || !data) return;
      const anchor = m[1];
      const key = `${rootId}:${path}#${anchor}`;
      if (handled.current === key) return;
      const hits = data.todos.filter((t) => t.rootId === rootId && t.pagePath === path);
      const ordinal = hits.findIndex((t) => t.anchor === anchor);
      if (ordinal < 0) {
        console.warn(`[todoscr] todo anchor not in index: ${anchor}`);
        return;
      }
      handled.current = key;
      let frames = 0;
      const attempt = () => {
        const chip = dom.querySelectorAll<HTMLElement>('[data-todo-chip]')[ordinal];
        if (!chip) {
          if (++frames < MAX_FRAMES) raf = requestAnimationFrame(attempt);
          else console.warn(`[todoscr] todo chip not found in DOM: ${anchor}`);
          return;
        }
        chip.scrollIntoView({ behavior: 'smooth', block: 'center' });
        chip.classList.add('anchor-highlight');
        window.setTimeout(() => chip.classList.remove('anchor-highlight'), 1000);
      };
      raf = requestAnimationFrame(attempt);
    }

    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('hashchange', scrollToHash);
    };
  }, [editor, ready, data, rootId, path, routerHash]);
}
