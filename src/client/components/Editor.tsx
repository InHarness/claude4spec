import { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { usePage, useWritePage } from '../hooks/usePage.js';
import '../tiptap/registrations.js';
import { EditorFactory } from '../tiptap/EditorFactory.js';
import { invokeSlash } from '../tiptap/slashInvoke.js';
import { EditorBridgeProvider } from '../tiptap/EditorContext.js';
import { refreshAnnotations } from '../tiptap/extensions/AnnotationHighlight.js';
import { AnnotationBubble } from '../tiptap/AnnotationBubble.js';
import { OutlineFloater } from './OutlineFloater.js';
import { useOutlineStore } from '../state/outline.js';
import { useChatStore } from '../state/chat.js';
import { useFileEventsStore } from '../state/fileEvents.js';
import { confirmDestructive } from '../ui/events.js';
import { usePagesIndex } from '../hooks/usePagesIndex.js';
import type { EntityType } from '../../shared/entities.js';

interface Props {
  path: string;
  onOpenEntity?: (type: EntityType, slug: string) => void;
  onOpenSection?: (pagePath: string, anchor: string) => void;
}

export function Editor({ path, onOpenEntity, onOpenSection }: Props) {
  const { data, isLoading } = usePage(path);
  const write = useWritePage();
  const qc = useQueryClient();
  const saveTimer = useRef<number | null>(null);
  const lastSavedBodyRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const currentPathRef = useRef<string>(path);
  const annotations = useChatStore((s) => s.annotations);
  const externalChange = useFileEventsStore((s) => s.externalChange);
  const clearExternalChange = useFileEventsStore((s) => s.clearExternalChange);
  const routerHash = useRouterState({ select: (s) => s.location.hash });
  const pagesIndex = usePagesIndex();

  const extensions = useMemo(
    () =>
      EditorFactory.buildExtensions('page', {
        qc,
        currentPath: path,
        onSlashInvoke: (editor, command) => void invokeSlash(editor, command, { qc, currentPath: path }),
        getAnnotations: () => useChatStore.getState().annotations,
      }),
    [qc, path],
  );

  const editor = useEditor({
    extensions,
    content: '',
    editorProps: {
      attributes: {
        class: 'prose-spec focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown() as string;
      if (md === lastSavedBodyRef.current) return;
      isDirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        const activePath = currentPathRef.current;
        if (!activePath) return;
        lastSavedBodyRef.current = md;
        isDirtyRef.current = false;
        write.mutate({ path: activePath, body: md, frontmatter: data?.frontmatter });
      }, 500);
    },
  });

  useEffect(() => {
    currentPathRef.current = path;
    lastSavedBodyRef.current = null;
    isDirtyRef.current = false;
  }, [path]);

  useEffect(() => {
    if (!editor || !data) return;
    // Echo of our own write.mutate — user may have typed more since; don't overwrite.
    if (data.body === lastSavedBodyRef.current) return;
    // Pending local edits — debounce will flush them; don't overwrite.
    if (isDirtyRef.current) return;
    const current = editor.storage.markdown.getMarkdown() as string;
    if (current === data.body) {
      lastSavedBodyRef.current = data.body;
      return;
    }
    // Defer into a microtask so React NodeView mounts (which call flushSync)
    // don't run inside our render commit phase.
    lastSavedBodyRef.current = data.body;
    queueMicrotask(() => {
      if (editor.isDestroyed) return;
      editor.commands.setContent(data.body, false);
    });
  }, [editor, data]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (editor) refreshAnnotations(editor.view);
  }, [editor, annotations]);

  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage as Record<string, unknown>;
    storage.pagesIndex = pagesIndex;
    storage.pageRefSourcePath = path;
    // First-time arrival or update — re-parse current body so code_inline and link
    // post-processors can promote resolved paths into PageRefNode chips.
    if (!pagesIndex || !data || isDirtyRef.current) return;
    queueMicrotask(() => {
      if (editor.isDestroyed) return;
      editor.commands.setContent(data.body, false);
    });
  }, [editor, pagesIndex, data, path]);

  useEffect(() => {
    useOutlineStore.getState().setEditor(editor ?? null);
    return () => {
      if (useOutlineStore.getState().editor === editor) {
        useOutlineStore.getState().setEditor(null);
      }
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || !data) return;
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
  }, [editor, data, path, routerHash]);

  useEffect(() => {
    if (!editor || !externalChange) return;
    if (externalChange.path !== path) return;
    if (!isDirtyRef.current) {
      clearExternalChange();
      qc.invalidateQueries({ queryKey: ['page', path] });
      return;
    }
    let cancelled = false;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void confirmDestructive({
      title: 'File changed externally',
      body: 'This file was modified outside the editor. Reload and discard your unsaved changes, or keep them?',
      confirmLabel: 'Reload',
      cancelLabel: 'Keep my changes',
      danger: false,
    }).then((confirmed) => {
      if (cancelled) return;
      clearExternalChange();
      if (confirmed) {
        lastSavedBodyRef.current = null;
        isDirtyRef.current = false;
        qc.invalidateQueries({ queryKey: ['page', path] });
      } else {
        const md = editor.storage.markdown.getMarkdown() as string;
        lastSavedBodyRef.current = md;
        isDirtyRef.current = false;
        write.mutate({ path, body: md, frontmatter: data?.frontmatter });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editor, externalChange, path, qc, clearExternalChange, write, data]);

  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, slug: string) => onOpenEntity?.(type, slug),
      openSection: (pagePath: string, anchor: string) => onOpenSection?.(pagePath, anchor),
    }),
    [onOpenEntity, onOpenSection]
  );

  const outlineOpen = useOutlineStore((s) => s.outlineOpen);

  return (
    <EditorBridgeProvider bridge={bridge}>
      <div className="flex-1 overflow-auto nice-scroll">
        <div
          className="mx-auto flex items-start"
          style={{ maxWidth: 1140, width: '100%' }}
        >
          {outlineOpen && (
            <aside
              className="hidden xl:block scroll-thin"
              style={{
                flex: '0 0 200px',
                position: 'sticky',
                top: 0,
                maxHeight: '100vh',
                overflowY: 'auto',
                padding: '56px 16px 24px 24px',
              }}
            >
              <OutlineFloater editor={editor} />
            </aside>
          )}
          <div
            aria-hidden
            className={outlineOpen ? 'xl:hidden' : ''}
            style={{ flex: '1 1 0' }}
          />
          <div
            className="min-w-0"
            style={{
              flex: '0 1 740px',
              maxWidth: 740,
              padding: '56px 56px 140px',
            }}
          >
            {isLoading && !data ? (
              <div className="text-[13px]" style={{ color: 'var(--c-subtle)' }}>
                Loading…
              </div>
            ) : null}
            <EditorContent editor={editor} />
          </div>
          <div aria-hidden style={{ flex: '1 1 0' }} />
        </div>
      </div>
      <AnnotationBubble editor={editor} currentPage={path} />
    </EditorBridgeProvider>
  );
}
