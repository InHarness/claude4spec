import { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { Bold, Italic, Heading2, List, Table2, Code as CodeIcon, type LucideIcon } from 'lucide-react';
import { withStability } from '../stability.js';

/**
 * `RichTextField` (Panel detalu, `experimental`) — a real rich-markdown
 * editor (bold/italic/headings/lists/tables/code), replacing the previous
 * `<textarea>` stub. A local, self-contained Tiptap instance — no
 * `getEditorExtensions()`, no mentions/slash-commands, no live host services
 * (`useQueryClient`/EditorBridge). That cross-entity-linking capability is
 * `DocEditor`'s job; this stays a plain props-in editor: `value`/`onChange`
 * are the only state, so it's still pure-presentational in the sense the
 * catalog cares about (no data fetching, no live singleton).
 */
export type RichTextFieldToolbarItem = 'bold' | 'italic' | 'heading' | 'list' | 'table' | 'code';

export interface RichTextFieldProps {
  value: string;
  onChange(value: string): void;
  readOnly?: boolean;
  placeholder?: string;
  toolbar?: RichTextFieldToolbarItem[];
}

const DEFAULT_TOOLBAR: RichTextFieldToolbarItem[] = ['bold', 'italic', 'heading', 'list', 'table', 'code'];

const TOOLBAR_ICON: Record<RichTextFieldToolbarItem, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  heading: Heading2,
  list: List,
  table: Table2,
  code: CodeIcon,
};

function RichTextFieldImpl({
  value,
  onChange,
  readOnly,
  placeholder,
  toolbar = DEFAULT_TOOLBAR,
}: RichTextFieldProps) {
  // Last markdown this editor emitted OR applied via setContent; a `value` equal
  // to it is already reflected in the doc — skip the rebuild so normalization
  // drift can't drop the caret. Recording on apply too keeps a `value` that
  // returns to an earlier string from being stranded.
  const lastSyncedRef = useRef<string | null>(null);
  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, transformPastedText: true, breaks: false }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write…' }),
    ],
    [placeholder],
  );

  const editor = useEditor({
    extensions,
    content: '',
    editable: !readOnly,
    editorProps: { attributes: { class: 'prose-spec focus:outline-none' } },
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown() as string;
      lastSyncedRef.current = md;
      onChange(md);
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

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

  if (!editor) return null;

  function isActive(item: RichTextFieldToolbarItem): boolean {
    if (!editor) return false;
    switch (item) {
      case 'bold':
        return editor.isActive('bold');
      case 'italic':
        return editor.isActive('italic');
      case 'heading':
        return editor.isActive('heading', { level: 2 });
      case 'list':
        return editor.isActive('bulletList');
      case 'table':
        return editor.isActive('table');
      case 'code':
        return editor.isActive('codeBlock');
    }
  }

  function toggle(item: RichTextFieldToolbarItem): void {
    if (!editor) return;
    const chain = editor.chain().focus();
    switch (item) {
      case 'bold':
        chain.toggleBold().run();
        break;
      case 'italic':
        chain.toggleItalic().run();
        break;
      case 'heading':
        chain.toggleHeading({ level: 2 }).run();
        break;
      case 'list':
        chain.toggleBulletList().run();
        break;
      case 'table':
        chain.insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
        break;
      case 'code':
        chain.toggleCodeBlock().run();
        break;
    }
  }

  return (
    <div className="rounded-md" style={{ border: '1px solid var(--c-hair)', background: 'var(--c-card)' }}>
      {!readOnly && toolbar.length > 0 && (
        <div
          className="flex items-center gap-1 px-2 py-1"
          style={{ borderBottom: '1px solid var(--c-hair)' }}
        >
          {toolbar.map((item) => {
            const Icon = TOOLBAR_ICON[item];
            const active = isActive(item);
            return (
              <button
                key={item}
                type="button"
                onClick={() => toggle(item)}
                className="rounded p-1"
                style={{
                  background: active ? 'var(--c-accent-soft)' : 'transparent',
                  color: active ? 'var(--c-accent-ink)' : 'var(--c-muted)',
                }}
                aria-label={item}
              >
                <Icon size={13} />
              </button>
            );
          })}
        </div>
      )}
      <div className="px-3 py-2 text-[13px] nice-scroll" style={{ color: 'var(--c-ink)' }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export const RichTextField = withStability(RichTextFieldImpl, 'experimental');
