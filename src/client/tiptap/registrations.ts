import { registerEditorExtension, registerMentionSource } from './registry.js';
import {
  InlineMentionNode,
  SingleElementNode,
  ElementListNode,
  TaggedListNode,
  TaggedListMixedNode,
  TodoNode,
} from './extensions/xmlNodes.js';
import { DiagramNode } from './extensions/DiagramNode.js';
import { AnchorMarker } from './extensions/AnchorMarker.js';
import { AnnotationHighlight } from './extensions/AnnotationHighlight.js';
import { SlashCommands } from './extensions/SlashCommands.js';
import { PageRefNode } from './extensions/PageRefNode.js';
import { MentionExtension } from './extensions/MentionExtension.js';
import { SectionRefNode } from './extensions/SectionRefNode/index.js';
import { HeadingActions } from './extensions/HeadingActions/index.js';
import { registerExtensionReferenceType } from '../../shared/reference-extensions.js';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { pageLinksApi } from '../lib/api.js';
import { FileText } from 'lucide-react';
import { createElement } from 'react';

registerEditorExtension({
  name: 'anchor_marker',
  extension: AnchorMarker,
  priority: 400,
  availableIn: ['page', 'plan'],
  markdownIt: { kind: 'block', pattern: new RegExp(`^${ANCHOR_PATTERN_SOURCE}\\s*$`) },
});

registerEditorExtension({
  name: 'task_list',
  extension: TaskList,
  priority: 450,
  availableIn: ['page', 'plan'],
});

registerEditorExtension({
  name: 'task_item',
  extension: TaskItem.configure({ nested: true }),
  priority: 451,
  availableIn: ['page', 'plan'],
});

registerEditorExtension({
  name: 'inline_mention',
  extension: InlineMentionNode,
  priority: 600,
  availableIn: ['page', 'description', 'plan'],
  slashCommand: {
    id: 'mention',
    label: '/mention',
    description: 'Inline mention of an entity',
    hint: 'type + slug',
  },
  markdownIt: { kind: 'inline', pattern: /^<inline_mention(\s[^>]*?)?\/?\s*>/ },
});

registerEditorExtension({
  name: 'single_element',
  extension: SingleElementNode,
  priority: 610,
  availableIn: ['page', 'plan'],
  slashCommand: {
    id: 'element',
    label: '/element',
    description: 'Block card with full entity details',
    hint: 'type + slug',
  },
  markdownIt: { kind: 'block', pattern: /^<single_element(\s[^>]*?)?\/?\s*>\s*$/ },
});

registerEditorExtension({
  name: 'element_list',
  extension: ElementListNode,
  priority: 620,
  availableIn: ['page', 'plan'],
  slashCommand: {
    id: 'list',
    label: '/list',
    description: 'Static list of entities by slug',
    hint: 'type + slugs (csv)',
  },
  markdownIt: { kind: 'block', pattern: /^<element_list(\s[^>]*?)?\/?\s*>\s*$/ },
});

registerEditorExtension({
  name: 'tagged_list',
  extension: TaggedListNode,
  priority: 630,
  availableIn: ['page', 'plan'],
  slashCommand: {
    id: 'tagged',
    label: '/tagged',
    description: 'Dynamic list of entities by tag',
    hint: 'type + tags + filter',
  },
  markdownIt: { kind: 'block', pattern: /^<tagged_list(\s[^>]*?)?\/?\s*>\s*$/ },
});

registerEditorExtension({
  name: 'tagged_list_mixed',
  extension: TaggedListMixedNode,
  priority: 640,
  availableIn: ['page', 'plan'],
  slashCommand: {
    id: 'tagged-mixed',
    label: '/tagged-mixed',
    description: 'Mixed dynamic list across entity types',
    hint: 'tags + filter',
  },
  markdownIt: { kind: 'block', pattern: /^<tagged_list_mixed(\s[^>]*?)?\/?\s*>\s*$/ },
});

// M06 — `<section_ref/>` 6th XML reference type via M19 extension slot.
// Client-side registration covers parser/serializer fallback in xml-tags.ts;
// `validate` is server-only (consistency check needs section_index).
registerExtensionReferenceType({
  tag: 'section_ref',
  attrOrder: ['anchor'],
});

registerEditorExtension({
  name: 'section_ref',
  extension: SectionRefNode,
  priority: 690,
  availableIn: ['page', 'plan', 'chat-input'],
  slashCommand: {
    id: 'section',
    label: '/section',
    description: 'Reference a section by its anchor',
    hint: 'anchor',
  },
  markdownIt: { kind: 'inline', pattern: /^<section_ref(\s[^>]*?)?\/?\s*>/ },
});

registerEditorExtension({
  name: 'todo',
  extension: TodoNode,
  priority: 660,
  availableIn: ['page', 'plan'],
  slashCommand: {
    id: 'todo',
    label: '/todo',
    description: 'Insert a TODO marker',
    hint: 'comment',
  },
  markdownIt: { kind: 'inline', pattern: /^<todo(\s[^>]*?)?\/?\s*>/ },
});

// v0.1.64 — `<diagram/>` 7th XML reference type via the M19 extension slot.
// `slug` identifies the diagram entity (source of truth); `caption` is per-
// reference prose. Mirrors the server registration in project-context.ts.
registerExtensionReferenceType({
  tag: 'diagram',
  attrOrder: ['slug', 'caption'],
});

registerEditorExtension({
  name: 'diagram',
  extension: DiagramNode,
  priority: 670,
  availableIn: ['page', 'plan'],
  slashCommand: {
    id: 'diagram',
    label: '/diagram',
    description: 'Insert a Mermaid diagram',
    hint: 'mermaid DSL',
  },
  markdownIt: { kind: 'block', pattern: /^<diagram(\s[^>]*?)?\/?\s*>\s*$/ },
});

registerEditorExtension({
  name: 'page_ref',
  extension: PageRefNode,
  priority: 700,
  availableIn: ['page', 'plan', 'chat-input'],
  markdownIt: { kind: 'inline', pattern: /(?<![\w])@[\w][\w/.-]*?(?:#[a-f0-9]{8})?/ },
});

registerEditorExtension({
  name: 'heading_actions',
  priority: 800,
  availableIn: ['page', 'plan'],
  extension: (ctx) => HeadingActions.configure({ pagePath: ctx.currentPath }),
});

registerEditorExtension({
  name: 'annotationHighlight',
  priority: 1000,
  availableIn: ['page', 'plan'],
  extension: (ctx) =>
    AnnotationHighlight.configure({
      getAnnotations: ctx.getAnnotations,
      currentPage: ctx.currentPath,
    }),
});

registerEditorExtension({
  name: 'mention_extension',
  priority: 1100,
  availableIn: ['page', 'plan', 'chat-input'],
  extension: (ctx) => MentionExtension.configure({ contextId: ctx.contextId ?? 'page' }),
});

registerEditorExtension({
  name: 'slash_commands',
  priority: 1100,
  availableIn: ['page', 'plan'],
  extension: (ctx) => SlashCommands.configure({ onInvoke: ctx.onSlashInvoke }),
});

// ────────────────────────────────────────────────────────────────────────────
// Mention sources (M14 `files` — trigger `@`)
// ────────────────────────────────────────────────────────────────────────────

registerMentionSource<{ path: string; title: string; matchScore: number }>({
  id: 'files',
  trigger: '@',
  availableIn: ['page', 'plan', 'chat-input'],
  minQueryLength: 0,
  search: async (query, limit = 10) => {
    const res = await pageLinksApi.autocomplete(query, limit);
    return res.suggestions;
  },
  getItemKey: (item) => item.path,
  renderItem: (item, active) =>
    createElement(
      'div',
      {
        className: 'flex items-center gap-2 px-3 py-1.5 text-[12.5px]',
        style: { background: active ? 'var(--c-accent-soft)' : 'transparent' },
      },
      createElement(FileText, {
        size: 12,
        style: { color: 'var(--c-subtle)', flexShrink: 0 },
      }),
      createElement(
        'span',
        { style: { fontFamily: 'ui-monospace, monospace', color: 'var(--c-ink)' } },
        item.path,
      ),
      item.title && item.title !== item.path
        ? createElement(
            'span',
            { style: { color: 'var(--c-subtle)', marginLeft: 'auto' } },
            item.title,
          )
        : null,
    ),
  onSelect: (item, editor) => {
    editor
      .chain()
      .focus()
      .insertContent({ type: 'page_ref', attrs: { syntax: 'at', path: item.path } })
      .insertContent(' ')
      .run();
  },
});
