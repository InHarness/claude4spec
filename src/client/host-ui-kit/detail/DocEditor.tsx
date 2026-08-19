import { useEffect, useMemo, useRef } from 'react';
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
 * `DocEditor` (Panel detalu, `experimental`, `binding: 'connected'`) — since
 * 0.1.143 no longer "the documented exception to the pure-presentational
 * doctrine" but the first member of the named `connected` class: cross-entity
 * mention/slash-command clicks resolve via the live EditorBridge singleton (the
 * L11 surface it declares) instead of a caller-supplied callback, the way
 * `useVersions`/`useReferences`/`useTags` reach the host's live data services.
 * A plugin author picks this
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
  // Last markdown this editor emitted OR applied via setContent; a `value` equal
  // to it is already reflected in the doc — skip the rebuild so normalization
  // drift can't drop the caret. Recording on apply too keeps a `value` that
  // returns to an earlier string from being stranded.
  const lastSyncedRef = useRef<string | null>(null);
  /**
   * Has the incoming `value` reached the document yet?
   *
   * The editor is created with `content: ''` and only receives `value` in the
   * effect below, one commit later. Between those two moments tiptap emits an
   * update for the empty document — and `onChange('')` reaching a panel that
   * autosaves is not a redundant write, it is DATA LOSS: opening an entity
   * PATCHes its description away, no console error, no failing request, nothing
   * on screen to notice. Confirmed on the shipped `dto` panel, which wiped a
   * description to `null` on a plain page view.
   *
   * So nothing is emitted upward until the document actually holds `value`.
   * After that every update is the user's and is passed on unchanged — including
   * clearing the field, which stays a legitimate edit.
   */
  const seededRef = useRef(false);
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
      // Pre-seed updates describe the empty placeholder document, not the
      // user's content — see `seededRef`.
      if (!seededRef.current) return;
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
    // don't rebuild under the caret. Each of these arms still marks the document
    // as seeded: "the doc already holds `value`" is exactly what they assert.
    if (value === lastSyncedRef.current) {
      seededRef.current = true;
      return;
    }
    const current = editor.storage.markdown.getMarkdown() as string;
    if (current === value) {
      seededRef.current = true;
      return;
    }
    lastSyncedRef.current = value;
    editor.commands.setContent(value, false);
    seededRef.current = true;
  }, [editor, value]);

  const ambientBridge = useEditorBridge();
  const fallbackBridge = useMemo(() => ({ openEntity: () => {}, openSection: () => {} }), []);

  return (
    <EditorBridgeProvider bridge={ambientBridge ?? fallbackBridge}>
      <EditorContent editor={editor} />
    </EditorBridgeProvider>
  );
}

export const DocEditor = withStability(DocEditorImpl, 'experimental', 'connected', ['EditorBridge']);
