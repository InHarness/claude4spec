import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useQueryClient } from '@tanstack/react-query';
import { EditorFactory } from '../tiptap/EditorFactory.js';
import { usePageLinks } from '../hooks/usePageLinks.js';
import type { FileMeta } from '../../shared/page-links.js';

export interface ChatInputEditorHandle {
  focus: () => void;
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
  clear: () => void;
  isEmpty: () => boolean;
}

interface Props {
  onSubmit: () => void;
  onChange?: (hasContent: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Max height in pixels before the composer starts scrolling. Default 240 (12 × 20px). */
  maxHeight?: number;
}

/**
 * L8 `chat-input` context editor. Replaces the plain textarea in ChatOverlay so the
 * `@` mention framework + PageRefNode chips work symmetrically between page editor
 * and chat composer (M14 `m14comp01`). Enter = submit, Shift+Enter = newline.
 */
export const ChatInputEditor = forwardRef<ChatInputEditorHandle, Props>(function ChatInputEditor(
  { onSubmit, onChange, disabled, placeholder, maxHeight = 240 },
  ref,
) {
  const qc = useQueryClient();
  const pageLinks = usePageLinks();

  const pagesIndex = useMemo<Map<string, FileMeta> | undefined>(() => {
    const list = pageLinks.data;
    if (!list) return undefined;
    const map = new Map<string, FileMeta>();
    const paths = new Set<string>();
    for (const p of Object.keys(list.links)) paths.add(p);
    for (const p of Object.keys(list.reverseLinks)) paths.add(p);
    for (const sources of Object.values(list.reverseLinks)) sources.forEach((p) => paths.add(p));
    for (const links of Object.values(list.links)) for (const l of links) paths.add(l.targetPath);
    for (const p of paths) map.set(p, { path: p, title: basenameTitle(p), anchors: [] });
    return map;
  }, [pageLinks.data]);

  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  const extensions = useMemo(
    () =>
      EditorFactory.buildExtensions(
        'chat-input',
        {
          qc,
          currentPath: null,
          onSlashInvoke: () => {},
          getAnnotations: () => [],
        },
        { placeholder: placeholder ?? 'Message…' },
      ),
    [qc, placeholder],
  );

  const editor = useEditor({
    extensions,
    content: '',
    editorProps: {
      attributes: {
        class: 'chat-input-pm focus:outline-none',
      },
      handleKeyDown: (_view, event) => {
        if (
          event.key === 'Enter' &&
          !event.shiftKey &&
          !event.isComposing &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      onChange?.(!editor.isEmpty);
    },
    editable: !disabled,
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    (editor.storage as Record<string, unknown>).pagesIndex = pagesIndex;
  }, [editor, pagesIndex]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editor?.commands.focus('end');
      },
      getMarkdown: () => {
        if (!editor) return '';
        return (editor.storage.markdown?.getMarkdown() as string) ?? '';
      },
      setMarkdown: (md) => {
        if (!editor) return;
        editor.commands.setContent(md, false);
        editor.commands.focus('end');
      },
      clear: () => {
        editor?.commands.clearContent();
      },
      isEmpty: () => editor?.isEmpty ?? true,
    }),
    [editor],
  );

  return (
    <div
      className="chat-input-scroll nice-scroll"
      style={{ maxHeight, overflowY: 'auto' }}
    >
      <EditorContent editor={editor} />
    </div>
  );
});

function basenameTitle(p: string): string {
  const base = p.split('/').pop() ?? p;
  return base.replace(/\.md$/, '');
}
