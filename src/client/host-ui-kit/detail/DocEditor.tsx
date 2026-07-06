import { useEffect, useMemo } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useQueryClient } from '@tanstack/react-query';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import '../../tiptap/registrations.js';
import { getEditorExtensions } from '../../tiptap/registry.js';
import { EditorBridgeProvider, useEditorBridge } from '../../tiptap/EditorContext.js';
import { withStability } from '../stability.js';

/**
 * `DocEditor` (Panel detalu, `experimental`, HOST-WIRED) — the catalog's
 * documented exception to the pure-presentational doctrine: cross-entity
 * mention/slash-command clicks resolve via the live EditorBridge (L11)
 * instead of a caller-supplied callback, the way `useVersions`/`useReferences`
 * /`useTags` reach the host's live data services. A plugin author picks this
 * over `RichTextField` when they want full parity with the host's own
 * description editor — no navigation props to wire.
 *
 * Concretely: it reads whichever real bridge is already ambient via
 * `useEditorBridge()` (every host built-in entity route already wraps itself
 * in a real, router-backed `EditorBridgeProvider` — see `router.tsx` — so
 * descendants like this get real navigation for free), and republishes that
 * onto the M33 process-wide singleton so chips rendered outside this
 * component's own React subtree can reach it too. Falls back to a safe no-op
 * (not a proxy back to the singleton — that would recurse) when used with no
 * ambient bridge at all, e.g. standalone on a plugin's own unwired page.
 *
 * Distinct from `src/client/components/DocEditor.tsx` (the host's own,
 * page-scoped internal editor which takes `onOpenEntity`/`onOpenSection`
 * props directly) — this one has no navigation props at all.
 */
export interface DocEditorProps {
  value: string;
  onChange(md: string): void;
  readOnly?: boolean;
  placeholder?: string;
}

function DocEditorImpl({ value, onChange, readOnly, placeholder }: DocEditorProps) {
  const qc = useQueryClient();
  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [2, 3, 4, 5, 6] } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: true, transformPastedText: true, breaks: false }),
      Placeholder.configure({ placeholder: placeholder ?? 'Description…' }),
      ...getEditorExtensions(
        { qc, currentPath: null, onSlashInvoke: () => {}, getAnnotations: () => [] },
        'shared',
      ),
    ],
    [placeholder, qc],
  );

  const editor = useEditor({
    extensions,
    content: '',
    editable: !readOnly,
    editorProps: {
      attributes: { class: 'prose-spec focus:outline-none' },
    },
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown() as string;
      onChange(md);
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.storage.markdown.getMarkdown() as string;
    if (current === value) return;
    editor.commands.setContent(value, false);
  }, [editor, value]);

  const ambientBridge = useEditorBridge();
  const fallbackBridge = useMemo(() => ({ openEntity: () => {}, openSection: () => {} }), []);

  return (
    <EditorBridgeProvider bridge={ambientBridge ?? fallbackBridge}>
      <EditorContent editor={editor} />
    </EditorBridgeProvider>
  );
}

export const DocEditor = withStability(DocEditorImpl, 'experimental');
