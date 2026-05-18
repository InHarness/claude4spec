import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useQueryClient } from '@tanstack/react-query';
import { usePatch, useUpdatePatchContent } from '../hooks/usePatches.js';
import '../tiptap/registrations.js';
import { EditorFactory } from '../tiptap/EditorFactory.js';
import { invokeSlash } from '../tiptap/slashInvoke.js';
import { ApiError } from '../lib/api-core.js';

interface Props {
  patchPath: string;
}

/**
 * M23 patch artifact panel. Mirror of `BriefEditor` — Tiptap `'page'` factory
 * (patches render the same XML refs / mentions), storage through patches-api
 * with `expectedHash` sha256 optimistic concurrency. Only the BODY is fed to
 * Tiptap; on save the (immutable) frontmatter is recomposed via gray-matter.
 */
export function PatchEditor({ patchPath }: Props) {
  const { data: patch, isLoading, error } = usePatch(patchPath);
  const update = useUpdatePatchContent(patchPath);
  const qc = useQueryClient();
  const saveTimer = useRef<number | null>(null);
  const lastSavedBodyRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const [conflict, setConflict] = useState<boolean>(false);

  const extensions = useMemo(
    () =>
      EditorFactory.buildExtensions('page', {
        qc,
        currentPath: patchPath,
        onSlashInvoke: (editor, command) =>
          void invokeSlash(editor, command, { qc, currentPath: patchPath }),
        getAnnotations: () => [],
      }),
    [qc, patchPath],
  );

  const editor = useEditor({
    extensions,
    content: '',
    editorProps: {
      attributes: { class: 'prose-spec focus:outline-none' },
    },
    onUpdate: ({ editor }) => {
      if (!patch) return;
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
    if (!patch) return;
    const matterMod = await import('gray-matter');
    const fullContent = matterMod.default.stringify(
      newBody,
      patch.frontmatter as Record<string, unknown>,
    );
    try {
      await update.mutateAsync({ content: fullContent, expectedHash: patch.hash });
      lastSavedBodyRef.current = newBody;
      isDirtyRef.current = false;
      setConflict(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PATCH_CONFLICT') {
        setConflict(true);
      } else {
        console.error('[patch-editor] save failed:', err);
      }
    }
  }

  useEffect(() => {
    if (!editor || !patch) return;
    const current = editor.storage.markdown.getMarkdown() as string;
    if (current === patch.body) {
      lastSavedBodyRef.current = patch.body;
      return;
    }
    if (isDirtyRef.current) return;
    editor.commands.setContent(patch.body);
    lastSavedBodyRef.current = patch.body;
  }, [editor, patch]);

  if (isLoading) {
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        Loading patch…
      </div>
    );
  }
  if (error || !patch) {
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        {error instanceof ApiError && error.status === 404
          ? 'Patch file not found on disk. It may have been deleted.'
          : 'Failed to load patch.'}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {conflict && (
        <div
          className="px-5 py-2 text-[12px] flex items-center justify-between"
          style={{
            background: 'rgba(179, 58, 58, 0.08)',
            color: '#b33a3a',
            borderBottom: '1px solid var(--c-hair)',
          }}
        >
          <span>Patch was modified elsewhere. Reload to see latest content.</span>
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
