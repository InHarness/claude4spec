import { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useQueryClient } from '@tanstack/react-query';
import '../tiptap/registrations.js';
import { EditorFactory } from '../tiptap/EditorFactory.js';
import { invokeSlash } from '../tiptap/slashInvoke.js';
import {
  useEditorCarry,
  useEditorCarryApply,
  useEditorSchemaVersion,
} from '../tiptap/useEditorSchema.js';
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
  // Last markdown this editor emitted OR applied via setContent. An incoming
  // `value` equal to it is already reflected in the doc — skip the rebuild so
  // markdown-normalization drift (getMarkdown() differing byte-for-byte from the
  // stored value) can't drop the caret. Recording on apply too (not just on
  // emit) means a `value` that returns to an earlier string after an external
  // change is still re-applied rather than stranded.
  const lastSyncedRef = useRef<string | null>(null);
  const schemaVersion = useEditorSchemaVersion();
  // L8 `description` context: core + inline mention + anchor marker, `/mention`
  // the only slash command. Before 0.2.85 this pulled the registry with the
  // context-blind `'shared'` scope and mounted every extension the page editor
  // has — and its slash handler was a no-op, so `/mention` did nothing here.
  const extensions = useMemo(
    () =>
      EditorFactory.buildExtensions(
        'description',
        {
          qc,
          currentPath: null,
          onSlashInvoke: (editor, command) =>
            void invokeSlash(editor, command, { qc, currentPath: null }),
          getAnnotations: () => [],
        },
        { placeholder: placeholder ?? 'Description…' },
      ),
    [placeholder, qc, schemaVersion],
  );
  const carry = useEditorCarry(extensions);

  const editor = useEditor(
    {
      extensions,
      content: '',
      editorProps: {
        attributes: { class: 'prose-spec focus:outline-none' },
      },
      onUpdate: ({ editor }) => {
        const md = editor.storage.markdown.getMarkdown() as string;
        lastSyncedRef.current = md;
        onChange(md);
      },
    },
    [extensions],
  );
  useEditorCarryApply(carry, editor);

  useEffect(() => {
    if (!editor) return;
    // Already reflected in the doc (our own echo, or a value we just applied) —
    // don't rebuild under the caret.
    if (value === lastSyncedRef.current) return;
    const current = editor.storage.markdown.getMarkdown() as string;
    if (current === value) return;
    lastSyncedRef.current = value;
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
