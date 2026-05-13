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
import '../tiptap/registrations.js';
import { getEditorExtensions } from '../tiptap/registry.js';
import { EditorBridgeProvider } from '../tiptap/EditorContext.js';
import type { EntityType } from '../../shared/entities.js';

interface Props {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  onOpenEntity?: (type: EntityType, slug: string) => void;
}

export function DocEditor({ value, onChange, placeholder, onOpenEntity }: Props) {
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
      ...getEditorExtensions({
        qc,
        currentPath: null,
        onSlashInvoke: () => {},
        getAnnotations: () => [],
      }, 'shared'),
    ],
    [placeholder, qc]
  );

  const editor = useEditor({
    extensions,
    content: '',
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
    const current = editor.storage.markdown.getMarkdown() as string;
    if (current === value) return;
    editor.commands.setContent(value, false);
  }, [editor, value]);

  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, slug: string) => onOpenEntity?.(type, slug),
      openSection: () => {},
    }),
    [onOpenEntity]
  );

  return (
    <EditorBridgeProvider bridge={bridge}>
      <EditorContent editor={editor} />
    </EditorBridgeProvider>
  );
}
