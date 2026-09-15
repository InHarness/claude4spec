import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import {
  getEditorExtensionsForContext,
  FULL_ROOT_EDITOR_PROPS,
  type EditorContextId,
  type RegistryContext,
  type RootEditorProps,
} from './registry.js';

export interface EditorFactoryOptions {
  /**
   * A function is read at render time by `@tiptap/extension-placeholder`, so a
   * caller whose placeholder changes often (the chat composer swaps it on every
   * agent turn) can keep it OUT of the extension list — the list is the
   * `useEditor` deps array since 0.2.85, and rebuilding it recreates the editor.
   */
  placeholder?: string | (() => string);
}

/**
 * Build the full extension list for a given editor context.
 *
 * The factory's contract is WHAT IS MOUNTED, not who creates the instance
 * (L8 `editor-context-spec`): it returns the extension list, every mounting
 * component calls `useEditor` itself. Core extensions (tiptap StarterKit,
 * tables, Markdown, Placeholder) are included per the context spec (`ctxregst`),
 * followed by registry ∩ `EditorContextSpec.extensions` (`contextSpec.ts`) —
 * an extension outside the whitelist is not in the returned array at all: no
 * keymap, no input rules, no parser tokens. `availableIn` on a registration is
 * a hint, not a gate.
 *
 * `rootProps` (0.1.96) gate the page-root extension set:
 *   - built-in `pages` root ⇒ FULL_ROOT_EDITOR_PROPS (today's full editor),
 *   - a default user root ⇒ minimal (no section / reference extensions),
 *   - briefs / patches ⇒ minimal + `linkTargets: ['pages']` for @path.md links.
 * It defaults to full behaviour so unmigrated callers are unaffected. It is ignored
 * for non-page contexts (plan / description / chat-input), which are not root-backed.
 */
export const EditorFactory = {
  buildExtensions(
    contextId: EditorContextId,
    ctx: RegistryContext,
    options: EditorFactoryOptions = {},
    rootProps: RootEditorProps = FULL_ROOT_EDITOR_PROPS,
  ): AnyExtension[] {
    return [
      ...coreExtensions(contextId, options),
      ...getEditorExtensionsForContext(ctx, contextId, rootProps),
    ];
  },
};

function coreExtensions(contextId: EditorContextId, options: EditorFactoryOptions): AnyExtension[] {
  switch (contextId) {
    case 'page':
    case 'plan':
      return [
        StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        Markdown.configure({ html: true, transformPastedText: true, breaks: false }),
        Placeholder.configure({
          placeholder: options.placeholder ?? 'Start writing your spec in markdown…',
        }),
      ];
    case 'description':
      // 0.2.85: what `DocEditor` (host and host-ui-kit) has always mounted as
      // its core — headings from h2 down (h1 is the entity title), lists and
      // tables included. Until now this arm was dead code: both DocEditors
      // built their core inline and pulled the registry with the context-blind
      // `'shared'` scope, which mounted EVERY registered extension (todo,
      // section refs, heading actions, the `@` framework, the full slash
      // palette) into a one-field description. Routing them through the
      // factory is what makes the context whitelist bind for descriptions.
      return [
        StarterKit.configure({ heading: { levels: [2, 3, 4, 5, 6] } }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        Markdown.configure({ html: true, transformPastedText: true, breaks: false }),
        Placeholder.configure({ placeholder: options.placeholder ?? 'Description…' }),
      ];
    case 'chat-input':
      return [
        StarterKit.configure({
          heading: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        Markdown.configure({ html: true, transformPastedText: true, breaks: true }),
        Placeholder.configure({ placeholder: options.placeholder ?? 'Message…' }),
      ];
  }
}
