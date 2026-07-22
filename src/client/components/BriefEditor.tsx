import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useQueryClient } from '@tanstack/react-query';
import { useBrief, useUpdateBriefContent } from '../hooks/useBriefs.js';
import '../tiptap/registrations.js';
import { EditorFactory } from '../tiptap/EditorFactory.js';
import { invokeSlash } from '../tiptap/slashInvoke.js';
import { ApiError } from '../lib/api-core.js';
import { withFrontmatterOf } from '../lib/artifact-frontmatter.js';
import { useFileEventsStore } from '../state/fileEvents.js';
import { confirmDestructive } from '../ui/events.js';

interface Props {
  briefPath: string;
}

/**
 * M21 brief artifact panel. Reuse Tiptap factory + extensions z M02 (page
 * context — brief renderuje wszystkie te same XML refs / mentions / diagrams),
 * ale storage przez briefs-api (osobny endpoint, optimistic concurrency
 * przez expectedHash sha256). Save: debounced 800ms (slowsze niz Editor.tsx
 * dla pages, bo PUT brief content uruchamia indexer + version capture +
 * ws broadcast — drozszy round-trip).
 *
 * Uwaga: Editor wsadza tylko BODY (bez frontmatter) do Tiptap. Przy save
 * skladamy z powrotem przez gray-matter na backendzie (brief.updateContent
 * akceptuje pelne content z frontmatter i waliduje immutable keys).
 * Klient sklada raw frontmatter + nowy body, brief service waliduje.
 */
export function BriefEditor({ briefPath }: Props) {
  const { data: brief, isLoading, error } = useBrief(briefPath);
  const update = useUpdateBriefContent(briefPath);
  const qc = useQueryClient();
  const saveTimer = useRef<number | null>(null);
  const lastSavedBodyRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const [conflict, setConflict] = useState<{ currentHash: string } | null>(null);
  const briefExternalChange = useFileEventsStore((s) => s.briefExternalChange);
  const clearBriefExternalChange = useFileEventsStore((s) => s.clearBriefExternalChange);

  const extensions = useMemo(
    () =>
      EditorFactory.buildExtensions('page', {
        qc,
        currentPath: briefPath,
        onSlashInvoke: (editor, command) => void invokeSlash(editor, command, { qc, currentPath: briefPath }),
        getAnnotations: () => [],
      }),
    [qc, briefPath],
  );

  const editor = useEditor({
    extensions,
    content: '',
    editorProps: {
      attributes: { class: 'prose-spec focus:outline-none' },
    },
    onUpdate: ({ editor }) => {
      if (!brief) return;
      const md = editor.storage.markdown.getMarkdown() as string;
      if (md === lastSavedBodyRef.current) return;
      isDirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void doSave(md);
      }, 800);
    },
  });

  async function doSave(newBody: string) {
    if (!brief) return;
    // Compose pelny content: frontmatter (immutable) + body.
    // 0.1.139: bylo `gray-matter.stringify` — ktore w przegladarce rzuca
    // "Buffer is not defined" (gray-matter to lib node'owy), przez co KAZDY
    // autosave briefu cicho padal wewnatrz tego handlera.
    const fullContent = withFrontmatterOf(brief.content, newBody);
    try {
      await update.mutateAsync({
        content: fullContent,
        expectedHash: brief.hash,
      });
      lastSavedBodyRef.current = newBody;
      // Only clear the dirty flag if the editor still holds exactly what we
      // just saved. Keystrokes landing WHILE the request was in flight leave
      // newer text behind; clearing unconditionally would let the hydrate
      // effect below overwrite them with the older server copy when
      // `onSuccess` invalidates the detail query. (Unreachable before 0.1.139
      // only because every save threw at `gray-matter.stringify`.)
      const live = (editor?.storage.markdown.getMarkdown() as string | undefined) ?? newBody;
      if (live === newBody) isDirtyRef.current = false;
      setConflict(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'BRIEF_CONFLICT') {
        // Server returns currentHash in the body — re-fetch will pick up new state.
        setConflict({ currentHash: 'unknown' });
      } else {
        console.error('[brief-editor] save failed:', err);
      }
    }
  }

  // Hydrate initial body when brief loads / changes (also fires after a remote
  // refetch — see external-change effect below).
  useEffect(() => {
    if (!editor || !brief) return;
    const current = editor.storage.markdown.getMarkdown() as string;
    if (current === brief.body) {
      lastSavedBodyRef.current = brief.body;
      return;
    }
    if (isDirtyRef.current) return;
    // Set the ref before setContent and pass emitUpdate=false so the swap never
    // re-enters onUpdate as a phantom edit (mirrors Editor.tsx for pages).
    lastSavedBodyRef.current = brief.body;
    editor.commands.setContent(brief.body, false);
  }, [editor, brief]);

  // Live refresh when the brief changes outside this editor (agent via MCP, or a
  // direct disk edit). Mirrors Editor.tsx:179-215 for pages. Clean editor → reload
  // silently; dirty editor → ask whether to discard or keep local changes.
  useEffect(() => {
    if (!editor || !briefExternalChange) return;
    if (briefExternalChange.path !== briefPath) return;
    if (!isDirtyRef.current) {
      clearBriefExternalChange();
      qc.invalidateQueries({ queryKey: ['briefs', 'detail', briefPath] });
      return;
    }
    let cancelled = false;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void confirmDestructive({
      title: 'Brief changed externally',
      body: 'This brief was modified outside the editor (by an agent or on disk). Reload and discard your unsaved changes, or keep them?',
      confirmLabel: 'Reload',
      cancelLabel: 'Keep my changes',
      danger: false,
    }).then((confirmed) => {
      if (cancelled) return;
      clearBriefExternalChange();
      if (confirmed) {
        // Discard local edits and pull the latest from disk.
        lastSavedBodyRef.current = null;
        isDirtyRef.current = false;
        qc.invalidateQueries({ queryKey: ['briefs', 'detail', briefPath] });
      }
      // Keep my changes → leave the editor dirty. Brief writes carry a mandatory
      // expectedHash, so the eventual save surfaces BRIEF_CONFLICT and the
      // existing conflict banner (no forced overwrite, unlike pages).
    });
    return () => {
      cancelled = true;
    };
  }, [editor, briefExternalChange, briefPath, qc, clearBriefExternalChange]);

  if (isLoading) {
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        Loading brief…
      </div>
    );
  }
  if (error || !brief) {
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        {error instanceof ApiError && error.status === 404
          ? 'Brief file not found on disk. It may have been deleted.'
          : 'Failed to load brief.'}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {conflict && (
        <div
          className="px-5 py-2 text-[12px] flex items-center justify-between"
          style={{ background: 'rgba(179, 58, 58, 0.08)', color: '#b33a3a', borderBottom: '1px solid var(--c-hair)' }}
        >
          <span>Brief was modified elsewhere. Reload to see latest content.</span>
          <button
            onClick={() => window.location.reload()}
            className="px-2 py-0.5 rounded text-[11.5px]"
            style={{ background: '#b33a3a', color: '#fff' }}
          >
            Reload
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto nice-scroll">
        <div className="mx-auto" style={{ maxWidth: 860, padding: '24px 48px 100px' }}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
