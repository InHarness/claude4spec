import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { getEditorExtensionsForContext, type EditorContextId, type RegistryContext } from './registry.js';

export interface EditorFactoryOptions {
  placeholder?: string;
}

/**
 * Build the full extension list for a given editor context.
 * Core extensions (tiptap StarterKit, tables, Markdown, Placeholder) are included per
 * the context spec (L8 `ctxregst`), followed by registry-provided extensions filtered
 * by `availableIn`.
 */
export const EditorFactory = {
  buildExtensions(
    contextId: EditorContextId,
    ctx: RegistryContext,
    options: EditorFactoryOptions = {},
  ): AnyExtension[] {
    return [...coreExtensions(contextId, options), ...getEditorExtensionsForContext(ctx, contextId)];
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
