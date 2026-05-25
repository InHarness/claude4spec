import { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import { AnchorMarker } from '../tiptap/extensions/AnchorMarker.js';
import {
  BlameDecoration,
  refreshBlame,
} from '../tiptap/extensions/BlameDecoration.js';
import {
  AnnotationHighlight,
  refreshAnnotations,
} from '../tiptap/extensions/AnnotationHighlight.js';
import { AnnotationBubble } from '../tiptap/AnnotationBubble.js';
import { OutlineFloater } from './OutlineFloater.js';
import { useChatStore } from '../state/chat.js';
import { useOutlineStore } from '../state/outline.js';
import type { BlameBlock } from '../../shared/entities.js';

interface Props {
  content: string;
  onChange(markdown: string, dirty: boolean): void;
  blame: BlameBlock[];
  blameOn: boolean;
  currentPage: string;
}

export function PlanEditor({ content, onChange, blame, blameOn, currentPage }: Props) {
  const lastServerBodyRef = useRef<string>(content);
  const blameRef = useRef<BlameBlock[]>(blame);
  const blameOnRef = useRef<boolean>(blameOn);
  const annotations = useChatStore((s) => s.annotations);

  useEffect(() => {
    blameRef.current = blame;
  }, [blame]);
  useEffect(() => {
    blameOnRef.current = blameOn;
  }, [blameOn]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: true, transformPastedText: true, breaks: false }),
      Placeholder.configure({
        placeholder:
          'The plan is empty. The agent will fill it via update_plan during the conversation in PLAN MODE.',
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      AnchorMarker,
      BlameDecoration.configure({
        getBlame: () => blameRef.current,
        getBlameOn: () => blameOnRef.current,
      }),
      AnnotationHighlight.configure({
        getAnnotations: () => useChatStore.getState().annotations,
        currentPage,
      }),
    ],
    [currentPage],
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
      onChange(md, md !== lastServerBodyRef.current);
    },
  });

  // Load server content into editor when it changes externally.
  useEffect(() => {
    if (!editor) return;
    const current = editor.storage.markdown.getMarkdown() as string;
    if (current === content) return;
    lastServerBodyRef.current = content;
    queueMicrotask(() => {
      if (editor.isDestroyed) return;
      editor.commands.setContent(content, false);
    });
  }, [editor, content]);

  // Refresh blame decorations whenever data or toggle change.
  useEffect(() => {
    if (editor) refreshBlame(editor.view);
  }, [editor, blame, blameOn]);

  // Refresh annotation highlights when global annotations change.
  useEffect(() => {
    if (editor) refreshAnnotations(editor.view);
  }, [editor, annotations]);

  useEffect(() => {
    useOutlineStore.getState().setEditor(editor ?? null);
    return () => {
      if (useOutlineStore.getState().editor === editor) {
        useOutlineStore.getState().setEditor(null);
      }
    };
  }, [editor]);

  const outlineOpen = useOutlineStore((s) => s.outlineOpen);

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div
        className="mx-auto flex items-start"
        style={{ maxWidth: 1180, width: '100%' }}
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
              padding: '48px 16px 24px 24px',
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
            flex: '0 1 780px',
            maxWidth: 780,
            padding: '48px 56px 140px',
          }}
        >
          <EditorContent editor={editor} />
        </div>
        <div aria-hidden style={{ flex: '1 1 0' }} />
      </div>
      <AnnotationBubble editor={editor} currentPage={currentPage} />
    </div>
  );
}
