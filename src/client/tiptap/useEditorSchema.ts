/**
 * L8 ordering invariant, editor side (spec `m20l11sc`, mirror of `m33l8wir`).
 *
 * Tiptap freezes the ProseMirror schema at `create`. The plugin boot does not
 * block first paint, so an editor can exist before a plugin's node types are
 * registered — and a node registered later is dropped by ProseMirror silently
 * (empty render, no error). The registry bumps a schema version whenever a
 * schema-bearing registration changes (`registry.ts`); these hooks make a live
 * editor follow it:
 *
 *   const schemaVersion = useEditorSchemaVersion();
 *   const extensions = useMemo(() => …, […, schemaVersion]);
 *   const carry = useEditorCarry(extensions);          // BEFORE useEditor
 *   const editor = useEditor({ … }, [extensions]);     // deps ⇒ recreate
 *   useEditorCarryApply(carry, editor);                // right AFTER useEditor
 *
 * `useEditor(options, deps)` destroys and recreates the instance when `deps`
 * change — for a schema bump, but also for any other reason the extension list
 * is rebuilt. The document must survive every such recreation: an open, unsaved
 * page must not lose a paragraph because a plugin finished loading. React runs
 * effects in declaration order, so the capture effect in `useEditorCarry`
 * (declared before `useEditor`) reads the OLD instance's markdown while it is
 * still alive, and `useEditorCarryApply` (declared after) re-applies it to the
 * NEW instance before any later effect compares the document against server
 * data. The re-apply uses `emitUpdate: false`, so it never counts as an edit.
 *
 * The carry is a bridge, not the source of truth. The old instance's markdown
 * is exactly what was lossy in the case this mechanism exists for: a plugin
 * node type that landed after `create` was dropped by the OLD schema, so its
 * `getMarkdown()` no longer contains the tag. A rebuilt editor with nothing
 * unsaved must therefore be re-seeded from the server body, not left with the
 * carried string — `useSeededEditor` tells a seed effect whether the instance
 * it sees is one it has already seeded (the carry alone is fine) or a fresh
 * one (re-apply the source of truth unless there are unsaved edits).
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { getEditorSchemaVersion, subscribeEditorSchema } from './registry.js';

/** Re-renders the caller when a schema-bearing registration lands or leaves. */
export function useEditorSchemaVersion(): number {
  return useSyncExternalStore(subscribeEditorSchema, getEditorSchemaVersion, getEditorSchemaVersion);
}

export interface EditorCarryHandle {
  /** @internal set by `useEditorCarryApply` */
  editorRef: { current: Editor | null };
  /** @internal markdown captured from the instance about to be destroyed */
  carryRef: { current: string | null };
}

/** Call BEFORE `useEditor`, with the same array you pass as its deps. */
export function useEditorCarry(extensions: unknown): EditorCarryHandle {
  const editorRef = useRef<Editor | null>(null);
  const carryRef = useRef<string | null>(null);

  // Runs before Tiptap's own effect (declared later in the component), i.e.
  // while the previous instance is still alive. On first mount there is no
  // instance yet and nothing is captured.
  useEffect(() => {
    const live = editorRef.current;
    if (!live || live.isDestroyed) return;
    const md = (live.storage as { markdown?: { getMarkdown(): string } }).markdown?.getMarkdown();
    carryRef.current = typeof md === 'string' ? md : null;
  }, [extensions]);

  return { editorRef, carryRef };
}

/** Call right AFTER `useEditor`, before any effect that seeds the document. */
export function useEditorCarryApply(handle: EditorCarryHandle, editor: Editor | null): void {
  handle.editorRef.current = editor;
  useEffect(() => {
    if (!editor) return;
    const md = handle.carryRef.current;
    handle.carryRef.current = null;
    if (md === null) return;
    // The instance was just recreated: restore what the user had, exactly as
    // it was, without emitting an update.
    editor.commands.setContent(md, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
}

export interface SeededEditor {
  /** True until `markSeeded(editor)` has been called for THIS instance. */
  isFresh(editor: Editor): boolean;
  markSeeded(editor: Editor): void;
}

/**
 * Which editor instance has the caller's seed effect already applied its
 * source of truth to? A schema re-init creates a new instance; the seed
 * effect re-runs (`editor` is in its deps) and must not treat the carried
 * document as authoritative — see the file header.
 */
export function useSeededEditor(): SeededEditor {
  const ref = useRef<Editor | null>(null);
  return useRef<SeededEditor>({
    isFresh: (editor) => ref.current !== editor,
    markSeeded: (editor) => {
      ref.current = editor;
    },
  }).current;
}
