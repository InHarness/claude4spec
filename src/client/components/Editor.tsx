import { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useQueryClient } from '@tanstack/react-query';
import { usePage, useWritePage } from '../hooks/usePage.js';
import { useScrollToAnchor } from '../hooks/useScrollToAnchor.js';
import { useScrollToTodo } from '../hooks/useScrollToTodo.js';
import '../tiptap/registrations.js';
import { EditorFactory } from '../tiptap/EditorFactory.js';
import { invokeSlash } from '../tiptap/slashInvoke.js';
import { assertSaveMode, getContextSpec, FULL_ROOT_EDITOR_PROPS, type RootEditorProps } from '../tiptap/registry.js';
import { useRoots } from '../hooks/useConfig.js';
import {
  useEditorCarry,
  useEditorCarryApply,
  useEditorSchemaVersion,
  useSeededEditor,
} from '../tiptap/useEditorSchema.js';
import { EditorBridgeProvider } from '../tiptap/EditorContext.js';
import { refreshAnnotations } from '../tiptap/extensions/AnnotationHighlight.js';
import { AnnotationBubble } from '../tiptap/AnnotationBubble.js';
import { OutlineFloater } from './OutlineFloater.js';
import { useOutlineStore } from '../state/outline.js';
import { useChatStore } from '../state/chat.js';
import { useFileEventsStore } from '../state/fileEvents.js';
import { confirmDestructive, toast } from '../ui/events.js';
import { bodyOf } from '../lib/artifact-frontmatter.js';
import { usePagesIndex } from '../hooks/usePagesIndex.js';
import type { EntityType } from '../../shared/entities.js';
import type { PageContent } from '../../shared/types.js';

interface Props {
  /** 0.1.96 multiroot: which page root the document belongs to. */
  rootId: string;
  path: string;
  onOpenEntity?: (type: EntityType, slug: string) => void;
  onOpenSection?: (pagePath: string, anchor: string) => void;
}

function rootPropsKey(p: RootEditorProps): string {
  return `${p.sectionIndexed}|${p.referenceValidated}|${p.linkTargets.join(',')}`;
}

export function Editor({ rootId, path, onOpenEntity, onOpenSection }: Props) {
  const { data, isLoading } = usePage(rootId, path);
  const write = useWritePage();
  const qc = useQueryClient();
  const saveTimer = useRef<number | null>(null);
  // The save the pending timer would perform. Flushed on unmount: the editor is
  // keyed per path (`router.tsx`), so navigating away within the debounce window
  // used to `clearTimeout` the timer and silently drop the last keystrokes.
  const pendingSaveRef = useRef<(() => void) | null>(null);
  // Writes sent and not yet acknowledged. While one is in flight the cached
  // `data.body` is older than what the editor holds; a schema re-init in that
  // window must not re-seed from it.
  const inflightRef = useRef(0);
  const lastSavedBodyRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const seeded = useSeededEditor();
  const currentPathRef = useRef<string>(path);
  const prevPagesIndexRef = useRef<ReturnType<typeof usePagesIndex>>(undefined);
  const annotations = useChatStore((s) => s.annotations);
  const externalChange = useFileEventsStore((s) => s.externalChange);
  const clearExternalChange = useFileEventsStore((s) => s.clearExternalChange);
  const pagesIndex = usePagesIndex();
  const schemaVersion = useEditorSchemaVersion();

  // L13: the `page` context is derived from the page root's properties, not a
  // fixed list — a user root without section indexing gets no anchors, one
  // without reference validation gets no entity chips (their tags pass through
  // verbatim). Keyed by VALUE, and the not-yet-loaded fallback keys as the
  // default it stands in for: on a cold deep link the config query settles
  // after the editor mounted, and a key that flipped from `null` to the same
  // props would rebuild the instance once for nothing (focus, selection and
  // an open `/` popup lost). A user root whose props differ from the default
  // still rebuilds once, carrying the document.
  const roots = useRoots();
  const root = roots.find((r) => r.id === rootId);
  const rootKey = rootPropsKey(
    root
      ? { sectionIndexed: root.sectionIndexed, referenceValidated: root.referenceValidated, linkTargets: root.linkTargets }
      : FULL_ROOT_EDITOR_PROPS,
  );
  const rootProps = useMemo<RootEditorProps>(
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
  // Rule 4: the save mechanics come from the context, not from this component.
  const save = assertSaveMode(getContextSpec('page', rootProps), 'debounce');

  const extensions = useMemo(
    () =>
      EditorFactory.buildExtensions(
        'page',
        {
          qc,
          currentPath: path,
          rootId,
          onSlashInvoke: (editor, command) =>
            void invokeSlash(editor, command, { qc, currentPath: path }),
          getAnnotations: () => useChatStore.getState().annotations,
        },
        {},
        rootProps,
      ),
    [qc, rootId, path, schemaVersion, rootProps],
  );
  const carry = useEditorCarry(extensions);

  const editor = useEditor(
    {
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
        const flush = () => {
          pendingSaveRef.current = null;
          saveTimer.current = null;
          const activePath = currentPathRef.current;
          if (!activePath) return;
          lastSavedBodyRef.current = md;
          isDirtyRef.current = false;
          inflightRef.current += 1;
          write.mutate(
            {
              rootId,
              path: activePath,
              body: md,
              frontmatter: data?.frontmatter,
              onConflict: (conflict) => onConflictRef.current(activePath, conflict),
            },
            { onSettled: () => void (inflightRef.current -= 1) },
          );
        };
        pendingSaveRef.current = flush;
        saveTimer.current = window.setTimeout(flush, save.debounceMs);
      },
    },
    [extensions],
  );
  useEditorCarryApply(carry, editor);

  useEffect(() => {
    currentPathRef.current = path;
    lastSavedBodyRef.current = null;
    isDirtyRef.current = false;
  }, [path]);

  useEffect(() => {
    if (!editor || !data) return;
    // A rebuilt instance (schema re-init) holds the carried document, which is
    // lossy for exactly the node type that just landed — re-seed it from the
    // server body unless there is something unsaved. A seeded instance skips
    // the echo of our own write (the user may have typed more since).
    const fresh = seeded.isFresh(editor);
    if (!fresh && data.body === lastSavedBodyRef.current) return;
    // Pending local edits — debounce will flush them; don't overwrite. A write
    // in flight means `data` is older than the editor; wait for its ack.
    if (isDirtyRef.current || inflightRef.current > 0) return;
    seeded.markSeeded(editor);
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
      // Never drop a pending save: flush it now (the mutation outlives the
      // component). Cleared when an external-change dialog took it over.
      pendingSaveRef.current?.();
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
    // Re-parse the body once so code_inline and link post-processors can promote
    // resolved paths into PageRefNode chips — but ONLY on the index's first
    // arrival (undefined → defined), i.e. a cold load where the doc rendered
    // before the link graph was ready. Later pagesIndex refetches must NOT
    // re-parse: a page save fires `pageLinks:changed`, minting a fresh index Map,
    // and rebuilding the doc then would drop the caret to the doc end. Chip
    // promotion round-trips to identical markdown, so no content-equality check
    // can tell that echo apart — the first-arrival gate is what protects the
    // caret. (Loads with a warm index, and navigations, are chipped by Effect A.)
    const hadIndex = !!prevPagesIndexRef.current;
    prevPagesIndexRef.current = pagesIndex;
    if (hadIndex || !pagesIndex || !data || isDirtyRef.current) return;
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

  useScrollToAnchor(editor, !!data, path);
  useScrollToTodo(editor, !!data, rootId, path);

  /**
   * 0.2.88 — a 409 `PAGE_CONFLICT` on autosave: somebody else wrote the page
   * since this client last read or saved it. Pages get the two-branch dialog
   * (artifacts get a Reload-only banner): "Reload" adopts the server's copy —
   * hash and content come with the 409, so no re-read — and "Keep my changes"
   * overwrites it, behind the destructive confirmation, with a FORCED write
   * guarded by the server's current hash. Not deferred to the next autosave
   * cycle: that cycle would carry the same stale hash and 409 again. No manual
   * merge. Read through a ref so the mutation callback created at debounce time
   * sees the current editor and path.
   *
   * Polarity: "Reload" is the confirm button (red — it discards the unsaved
   * edits, the one thing nobody can get back), "Keep my changes" the cancel
   * one. Escape, the scrim and ✕ all resolve as cancel, so a dismissed dialog
   * keeps the user's text — same as the external-change dialog below.
   */
  const onConflictRef = useRef<(forPath: string, c: { currentHash: string; currentContent: string }) => void>(
    () => {},
  );
  onConflictRef.current = (forPath, conflict) => {
    if (!editor || editor.isDestroyed || forPath !== currentPathRef.current) {
      // The write was the unmount / navigation flush: there is no editor left
      // to ask, and `useWritePage` left the toast to us. Silence here would
      // look exactly like a saved page.
      toast.error(`Save failed: ${forPath} changed on the server — your last edits to it were not saved`);
      return;
    }
    isDirtyRef.current = true;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pendingSaveRef.current = null;
    }
    void confirmDestructive({
      title: 'Page changed on the server',
      body: 'This page was saved by someone else since you opened it. Reload to take the server version and discard your edits, or keep your changes and overwrite it?',
      confirmLabel: 'Reload',
      cancelLabel: 'Keep my changes',
      danger: true,
    }).then((reload) => {
      if (editor.isDestroyed || forPath !== currentPathRef.current) return;
      if (!reload) {
        const md = editor.storage.markdown.getMarkdown() as string;
        lastSavedBodyRef.current = md;
        isDirtyRef.current = false;
        inflightRef.current += 1;
        write.mutate(
          {
            rootId,
            path: forPath,
            body: md,
            frontmatter: data?.frontmatter,
            expectedHash: conflict.currentHash,
            onConflict: (again) => onConflictRef.current(forPath, again),
          },
          { onSettled: () => void (inflightRef.current -= 1) },
        );
        return;
      }
      // Reload: the 409 already carries the server's copy — seed the cache from
      // it (hash included, so the next save is guarded by the right value) and
      // let the hydrate effect below re-seed the document. `currentContent` is
      // the whole file; `body` is the body alone, so strip the frontmatter.
      // The frontmatter object itself comes with the refetch.
      lastSavedBodyRef.current = null;
      isDirtyRef.current = false;
      qc.setQueryData(['page', rootId, forPath], (prev: PageContent | undefined) =>
        prev ? { ...prev, body: bodyOf(conflict.currentContent), hash: conflict.currentHash } : prev,
      );
      qc.invalidateQueries({ queryKey: ['page', rootId, forPath] });
    });
  };

  useEffect(() => {
    if (!editor || !externalChange) return;
    // 0.1.96: match on (rootId, path) — a same-named file in another root must not
    // trigger this editor's conflict dialog (would risk discarding unsaved edits).
    if (externalChange.rootId !== rootId || externalChange.path !== path) return;
    if (!isDirtyRef.current) {
      clearExternalChange();
      qc.invalidateQueries({ queryKey: ['page', rootId, path] });
      return;
    }
    let cancelled = false;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pendingSaveRef.current = null;
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
        qc.invalidateQueries({ queryKey: ['page', rootId, path] });
      } else {
        const md = editor.storage.markdown.getMarkdown() as string;
        lastSavedBodyRef.current = md;
        isDirtyRef.current = false;
        // The user already confirmed the overwrite. The cached hash is stale by
        // definition here, so the write 409s — take the server's hash from the
        // conflict and force it through, without a second dialog.
        write.mutate({
          rootId,
          path,
          body: md,
          frontmatter: data?.frontmatter,
          onConflict: (c) =>
            write.mutate({ rootId, path, body: md, frontmatter: data?.frontmatter, expectedHash: c.currentHash }),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editor, externalChange, rootId, path, qc, clearExternalChange, write, data]);

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
