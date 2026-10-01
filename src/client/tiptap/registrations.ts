import '../xml-markup/host-renders.js';
import { registerEditorExtension, registerMentionSource, type RegistryContext } from './registry.js';
import { RawJsxInlineNode, RawJsxBlockNode } from './extensions/RawJsxNode.js';
import { AnchorMarker } from './extensions/AnchorMarker.js';
import { AnnotationHighlight } from './extensions/AnnotationHighlight.js';
import { SlashCommands } from './extensions/SlashCommands.js';
import { PageRefNode } from './extensions/PageRefNode.js';
import { MentionExtension } from './extensions/MentionExtension.js';
import { HeadingActions } from './extensions/HeadingActions/index.js';
import { ANCHOR_ID_SOURCE, ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { pageLinksApi } from '../lib/api.js';
import { FileText } from 'lucide-react';
import { createElement } from 'react';

// L8 `ctxregst`: the `description` context is core + the `inline_mention` tag node +
// `AnchorMarker`, with `/mention` as its only slash command and no `@` mention
// framework. The anchor marker mounts there so an indexer-written
// `<!-- anchor: … -->` in an entity description round-trips instead of
// rendering as text; nothing inserts anchors by hand in any context.
registerEditorExtension({
  name: 'anchor_marker',
  extension: AnchorMarker,
  priority: 400,
  availableIn: ['page', 'description', 'plan'],
  markdownIt: { kind: 'block', pattern: new RegExp(`^${ANCHOR_PATTERN_SOURCE}\\s*$`) },
});

registerEditorExtension({
  name: 'task_list',
  extension: TaskList,
  priority: 450,
  availableIn: ['page', 'plan', 'description'],
});

registerEditorExtension({
  name: 'task_item',
  extension: TaskItem.configure({ nested: true }),
  priority: 451,
  availableIn: ['page', 'plan', 'description'],
});

// 2.1.2 (M51) — the XML tags' NODES are not registered here: the editor builds
// one per registered tag name (`extensions/xmlNodes.ts`) and a registration
// under a tag name is rejected. What the owning modules still contribute to the
// editor are their SLASH COMMANDS — slash-only entries, named for the command —
// plus the popover fields (`client/xml-markup/`).

// M19 — References.
registerEditorExtension({
  name: 'mention_command',
  availableIn: ['page', 'description', 'plan'],
  slashCommand: {
    id: 'mention',
    label: '/mention',
    description: 'Inline mention of an entity',
    hint: 'type + slug',
  },
});

registerEditorExtension({
  name: 'element_command',
  availableIn: ['page', 'plan'],
  slashCommand: {
    id: 'element',
    label: '/element',
    description: 'Block card with full entity details',
    hint: 'type + slug',
  },
});

registerEditorExtension({
  name: 'list_command',
  availableIn: ['page', 'plan'],
  slashCommand: {
    id: 'list',
    label: '/list',
    description: 'Static list of entities by slug',
    hint: 'type + slugs (csv)',
  },
});

registerEditorExtension({
  name: 'tagged_command',
  availableIn: ['page', 'plan'],
  slashCommand: {
    id: 'tagged',
    label: '/tagged',
    description: 'Dynamic list of entities by tag',
    hint: 'type + tags + filter',
  },
});

registerEditorExtension({
  name: 'tagged_mixed_command',
  availableIn: ['page', 'plan'],
  slashCommand: {
    id: 'tagged-mixed',
    label: '/tagged-mixed',
    description: 'Mixed dynamic list across entity types',
    hint: 'tags + filter',
  },
});

// M06 — Sections: `/section` inserts a `section_ref` tag.
registerEditorExtension({
  name: 'section_command',
  availableIn: ['page', 'plan', 'chat-input'],
  slashCommand: {
    id: 'section',
    label: '/section',
    description: 'Reference a section by its anchor',
    hint: 'anchor',
  },
});

// M08 — TODOs: `/todo` inserts a `todo` tag.
registerEditorExtension({
  name: 'todo_command',
  availableIn: ['page', 'plan'],
  slashCommand: {
    id: 'todo',
    label: '/todo',
    description: 'Insert a TODO marker',
    hint: 'comment',
  },
});

// A diagram is embedded as `<single_element type="diagram" …/>`; the diagram
// entity module registers only its AUTHORING half — the `/diagram` slash
// command and its popover (`client/entities/diagram/plugin.tsx`).

// M20 — the raw code node. Gate 1: unknown `.mdx` JSX component tags (name
// outside the tag registry) preserved byte-perfect and serialized verbatim (no
// fence). Gate 2 (`ctx4prof` rule 6): a registered tag whose node is NOT in
// this context's whitelist passes through the same node instead of being
// dropped by ProseMirror. Mounted in EVERY context for that reason, and at a
// priority below every XML node so its markdown-it rules sit ahead of theirs.
// The `markdownIt` field is declarative — the real rules are wired via
// buildMarkdownIt → setupRawJsxRules.
registerEditorExtension({
  name: 'raw_jsx_block',
  extension: (ctx) =>
    RawJsxBlockNode.configure({ mountedTags: ctx.contextSpec?.extensions ?? null }),
  priority: 300,
  availableIn: ['page', 'description', 'plan', 'chat-input'],
  markdownIt: { kind: 'block_content', pattern: /^<[A-Z][\w.-]*(\s[^>]*?)?>\s*$/ },
});

registerEditorExtension({
  name: 'raw_jsx_inline',
  extension: (ctx) =>
    RawJsxInlineNode.configure({ mountedTags: ctx.contextSpec?.extensions ?? null }),
  priority: 301,
  availableIn: ['page', 'description', 'plan', 'chat-input'],
  markdownIt: { kind: 'inline', pattern: /^<[A-Z][\w.-]*(\s[^>]*?)?\/?\s*>/ },
});

registerEditorExtension({
  name: 'page_ref',
  extension: PageRefNode,
  priority: 700,
  availableIn: ['page', 'plan', 'chat-input'],
  markdownIt: { kind: 'inline', pattern: new RegExp(`(?<![\\w])@[\\w][\\w/.-]*?(?:#${ANCHOR_ID_SOURCE})?`) },
});

registerEditorExtension({
  name: 'heading_actions',
  priority: 800,
  availableIn: ['page', 'plan'],
  extension: (ctx) => HeadingActions.configure({ linkPath: headingLinkPath(ctx) }),
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
  extension: (ctx) =>
    MentionExtension.configure({ contextId: ctx.contextId ?? 'page', rootProps: ctx.rootProps }),
});

registerEditorExtension({
  name: 'slash_commands',
  priority: 1100,
  availableIn: ['page', 'description', 'plan', 'chat-input'],
  extension: (ctx) =>
    SlashCommands.configure({
      onInvoke: ctx.onSlashInvoke,
      contextId: ctx.contextId ?? 'page',
      rootProps: ctx.rootProps,
    }),
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

/**
 * 0.2.89 — the in-app route of the document a heading lives in, which the
 * "copy link" action turns into a deep link. A plan's `currentPath` is already
 * its route (`/plans/<path>`); a page is addressed by `(rootId, path)`, so its
 * route is `/space/<rootId>/<path>`. The legacy `/pages/<path>` form only ever
 * resolves the built-in root.
 */
function headingLinkPath(ctx: RegistryContext): string | null {
  if (!ctx.currentPath) return null;
  if (ctx.contextId === 'plan') return ctx.currentPath;
  return ctx.rootId ? `/space/${ctx.rootId}/${ctx.currentPath}` : `/pages/${ctx.currentPath}`;
}
