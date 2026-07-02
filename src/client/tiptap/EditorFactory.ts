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
  placeholder?: string;
}

/**
 * Build the full extension list for a given editor context.
 * Core extensions (tiptap StarterKit, tables, Markdown, Placeholder) are included per
 * the context spec (L8 `ctxregst`), followed by registry-provided extensions filtered
 * by `availableIn` and — in the `page` context — by the page root's PROPERTIES.
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
        Markdown.configure({ html: true, transformPastedText: true, breaks: false }),
        Placeholder.configure({ placeholder: options.placeholder ?? '' }),
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
