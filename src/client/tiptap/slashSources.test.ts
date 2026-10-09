/**
 * 2.1.9 — M20 `lxdrxdm2`: command sources in the slash framework, the chat
 * composer's `chat-input` instance (M05 / M14), and the `pages`-kind gate on
 * `@` and the page-ref node (M20 `m20l13rt`, M14 `m14l13rt`).
 *
 * The popover's content is pinned on `createSlashSession` — the listing the
 * `SlashCommands` extension (the `SlashDispatcher`) hands its popup, one
 * session per opening of the popover.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import './registrations.js';
import {
  getContextSpec,
  getEditorExtensionRegistration,
  getEditorExtensionsForContext,
  getMentionSourceByTrigger,
  getRegisteredMentionSources,
  getSlashCommandSourcesForContext,
  registerSlashCommandSource,
  rootEditorPropsForKind,
  unregisterSlashCommandSource,
  type RegistryContext,
  type SlashCommandSourceItem,
} from './registry.js';
import { createSlashSession } from './slashPalette.js';
import { EditorFactory } from './EditorFactory.js';
import { xmlTagNode } from './extensions/xmlNodes.js';
import { buildMarkdownIt } from './markdown/buildMarkdownIt.js';
import { listXmlTags } from '../../shared/xml-markup/registry.js';

const ctx: RegistryContext = {
  qc: {} as RegistryContext['qc'],
  currentPath: null,
  onSlashInvoke: () => {},
  getAnnotations: () => [],
};

const names = (list: { name: string }[]) => list.map((e) => e.name);

function item(id: string, hint: string, extra: Partial<SlashCommandSourceItem> = {}): SlashCommandSourceItem {
  return { id, label: id, description: `item ${id}`, hint, ...extra };
}

const registered: string[] = [];
function source(
  id: string,
  list: () => Promise<SlashCommandSourceItem[]> | SlashCommandSourceItem[],
  context: 'page' | 'plan' | 'chat-input' = 'page',
) {
  registered.push(id);
  const spy = vi.fn(list);
  registerSlashCommandSource({ id, context, list: spy, onSelect: () => {} });
  return spy;
}

afterEach(() => {
  for (const id of registered.splice(0)) unregisterSlashCommandSource(id);
});

/** Serialize one `page_ref` node through the extension's own markdown storage. */
function serializePageRef(
  ext: { name: string; options?: unknown; config: { addStorage?: (this: unknown) => unknown } },
  attrs: Record<string, string>,
): string {
  let out = '';
  const storage = ext.config.addStorage!.call({ name: ext.name, options: ext.options, parent: undefined }) as {
    markdown: { serialize: (state: unknown, node: unknown) => void };
  };
  storage.markdown.serialize({ write: (s: string) => void (out += s) }, { attrs });
  return out;
}

describe('command sources in the slash popover (M20 lxdrxdm2)', () => {
  it('[ac:m20-zrodlo-komend-pull-przy-otwarciu] an item added to a source after the previous opening shows at the next opening, without rebuilding the editor', async () => {
    const items = [item('alpha', '/alpha')];
    const list = source('test-src:pull', () => [...items]);

    const first = createSlashSession('page');
    expect((await first.items('')).map((r) => r.key)).toContain('source:test-src:pull:alpha');
    items.push(item('beta', '/beta'));
    // Same opening: the answer pulled at the opening is filtered, not re-read.
    expect((await first.items('')).map((r) => r.key)).not.toContain('source:test-src:pull:beta');
    expect(list).toHaveBeenCalledTimes(1);

    // Next opening — a new session of the same extension instance — asks again.
    const second = createSlashSession('page');
    const keys = (await second.items('')).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['source:test-src:pull:alpha', 'source:test-src:pull:beta']));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('[ac:m20-zrodlo-komend-poza-whitelista] a source whose id is not in the context whitelist adds no item to that context’s popover', async () => {
    // `plan` whitelists `/section` alone; a source declaring `plan` is still out.
    const list = source('test-src:outside', () => [item('x', '/xray')], 'plan');
    expect(getContextSpec('plan').slashCommands).not.toContain('test-src:outside');
    expect(getSlashCommandSourcesForContext('plan').map((s) => s.id)).not.toContain('test-src:outside');

    const rows = await createSlashSession('plan').items('');
    expect(rows.some((r) => r.source)).toBe(false);
    expect(rows.map((r) => r.key)).toEqual(['command:section']);
    expect(list).not.toHaveBeenCalled();
  });

  it('[ac:m20-zrodlo-komend-kolizja-hint] an item whose hint equals a built-in command’s hint is not in the popover, the built-in command is', async () => {
    source('test-src:clash', () => [item('sec', '/section'), item('other', '/other')]);

    const rows = await createSlashSession('page').items('');
    const keys = rows.map((r) => r.key);
    expect(keys).toContain('command:section');
    expect(keys).not.toContain('source:test-src:clash:sec');
    expect(keys).toContain('source:test-src:clash:other');

    // Narrowed to the source there are no fixed commands, so nothing collides.
    const narrowed = createSlashSession('page');
    narrowed.narrowTo('test-src:clash');
    const narrowedKeys = (await narrowed.items('')).map((r) => r.key);
    expect(narrowedKeys).toEqual(['source:test-src:clash:sec', 'source:test-src:clash:other']);
  });

  it('[ac:m20-zrodlo-komend-blad-odczytu] a source whose listing failed does not block the popover: it shows the context’s fixed commands', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      source('test-src:throws', () => {
        throw new Error('boom');
      });
      source('test-src:rejects', () => Promise.reject(new Error('offline')));
      source('test-src:fine', () => [item('ok', '/ok')]);

      const rows = await createSlashSession('page').items('');
      const keys = rows.map((r) => r.key);
      for (const id of ['mention', 'section', 'todo']) expect(keys).toContain(`command:${id}`);
      // The other sources' items still come through.
      expect(keys).toContain('source:test-src:fine:ok');
      expect(keys.some((k) => k.startsWith('source:test-src:throws') || k.startsWith('source:test-src:rejects'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('the typed prefix is matched against an item’s hint; the origin marker rides along in both views', async () => {
    source('test-src:filter', () => [
      item('a', '/alpha', { origin: 'proj-a' }),
      item('b', '/beta'),
      item('n', '/narrow', { narrowTo: 'test-src:filter' }),
    ]);
    const session = createSlashSession('page');
    const rows = await session.items('alp');
    expect(rows.filter((r) => r.source).map((r) => [r.key, r.origin])).toEqual([['source:test-src:filter:a', 'proj-a']]);

    session.narrowTo('test-src:filter');
    expect(session.narrowedTo).toBe('test-src:filter');
    const narrowed = await session.items('');
    expect(narrowed.every((r) => r.source && !r.command)).toBe(true);
    expect(narrowed.find((r) => r.key === 'source:test-src:filter:a')?.origin).toBe('proj-a');
  });

  it('[entity:editor-context-spec] slashCommands whitelists command ids AND command-source ids', () => {
    source('test-src:spec', () => []);
    const page = getContextSpec('page');
    expect(page.slashCommands).toEqual(expect.arrayContaining(['section', 'mention', 'test-src:spec']));
    expect(getSlashCommandSourcesForContext('page').map((s) => s.id)).toContain('test-src:spec');
    // The other fields of the contract stay as they were.
    expect(Object.keys(page).sort()).toEqual(['decorations', 'extensions', 'id', 'mentions', 'save', 'slashCommands']);
  });
});

describe('the chat composer — `chat-input` (M05 / M14 / M20 ctxregst)', () => {
  it('[ac:ac-chat-input-minimalna-instancja-tiptap] the chat-input instance mounts the slash framework beside MentionExtension, PageRefNode and the section_ref tag node', () => {
    const mounted = names(EditorFactory.buildExtensions('chat-input', ctx));
    expect(mounted).toEqual(
      expect.arrayContaining(['slash_commands', 'mention_extension', 'page_ref', 'section_ref']),
    );
    // Still minimal: no entity tag nodes, no headings / lists.
    for (const gone of ['inline_mention', 'single_element', 'todo', 'heading_actions']) {
      expect(mounted, gone).not.toContain(gone);
    }
  });

  it('[ac:m20-composer-slash-popover] typing `/` in the composer opens the slash popover with `/section`', async () => {
    const slash = getEditorExtensionsForContext(ctx, 'chat-input').find((e) => e.name === 'slash_commands');
    expect(slash).toBeDefined();
    // The framework is configured for the composer's context, so its popover lists that context's commands.
    expect((slash!.options as { contextId: string }).contextId).toBe('chat-input');
    const rows = await createSlashSession('chat-input').items('');
    expect(rows.map((r) => r.label)).toContain('/section');
    expect((await createSlashSession('chat-input').items('sec')).map((r) => r.label)).toEqual(['/section']);
  });

  it('[ac:m14-composer-pageref-serializacja-at] the composer submit serializes PageRefNode as `@path.md` whatever syntax variant inserted it', () => {
    const composerRef = getEditorExtensionsForContext(ctx, 'chat-input').find((e) => e.name === 'page_ref')!;
    expect(composerRef).toBeDefined();
    for (const syntax of ['at', 'backticks', 'link']) {
      expect(serializePageRef(composerRef as never, { syntax, path: 'modules/m01.md', anchor: '', label: 'Auth' })).toBe(
        '@modules/m01.md',
      );
    }
    expect(serializePageRef(composerRef as never, { syntax: 'link', path: 'm.md', anchor: 'abcd1234', label: '' })).toBe(
      '@m.md#abcd1234',
    );
    // The page editor keeps the variant (round-trip of all three forms).
    const pageRef = getEditorExtensionsForContext(ctx, 'page').find((e) => e.name === 'page_ref')!;
    expect(serializePageRef(pageRef as never, { syntax: 'link', path: 'm.md', anchor: '', label: 'M' })).toBe('[M](m.md)');
  });
});

describe('`@` and PageRefNode only on roots of kind `pages` (M20 m20l13rt, M14 m14l13rt)', () => {
  it('a pages root mounts `@` and the page-ref node; a root of another kind without anchors gets neither', () => {
    const pages = rootEditorPropsForKind('pages');
    expect(pages.pageLinks).toBe(true);
    expect(names(EditorFactory.buildExtensions('page', ctx, {}, pages))).toEqual(
      expect.arrayContaining(['mention_extension', 'page_ref']),
    );

    const briefs = rootEditorPropsForKind('briefs');
    expect(briefs).toEqual({ sectionIndexed: false, referenceValidated: false, pageLinks: false });
    const mounted = names(EditorFactory.buildExtensions('page', ctx, {}, briefs));
    expect(mounted).not.toContain('mention_extension');
    expect(mounted).not.toContain('page_ref');
    expect(getRegisteredMentionSources('page', briefs)).toEqual([]);
    expect(getContextSpec('page', briefs).mentions).toEqual([]);
  });

  it('the fixed `artifact` context (briefs, patches) keeps `@` links', () => {
    expect(names(EditorFactory.buildExtensions('artifact', ctx))).toEqual(
      expect.arrayContaining(['mention_extension', 'page_ref']),
    );
  });
});

describe('M20 contribution sheet — wklad-do-edytora-m20', () => {
  it('[entity:wklad-do-edytora-m20#węzeł znacznika inline] the editor builds an inline node for every inline-form tag, parsed by `xml_inline`', () => {
    const inline = listXmlTags().filter((t) => t.form === 'inline');
    expect(inline.length).toBeGreaterThan(0);
    for (const t of inline) {
      const node = xmlTagNode(t.name) as unknown as { name: string; config: { inline?: boolean; group?: string } };
      expect(node.name).toBe(t.name);
      expect(node.config.inline).toBe(true);
    }
    const md = buildMarkdownIt();
    expect((md.inline.ruler as unknown as { __rules__: { name: string }[] }).__rules__.map((r) => r.name)).toContain('xml_inline');
  });

  it('[entity:wklad-do-edytora-m20#węzeł znacznika blokowy] the editor builds a block node for every block-form tag, parsed by `xml_block`', () => {
    const block = listXmlTags().filter((t) => t.form !== 'inline');
    expect(block.length).toBeGreaterThan(0);
    for (const t of block) {
      const node = xmlTagNode(t.name) as unknown as { config: { inline?: boolean; group?: string } };
      expect(node.config.inline).toBe(false);
      expect(node.config.group).toBe('block');
    }
    const md = buildMarkdownIt();
    expect((md.block.ruler as unknown as { __rules__: { name: string }[] }).__rules__.map((r) => r.name)).toContain('xml_block');
  });

  it('[entity:wklad-do-edytora-m20#surowy węzeł kodu JSX] the raw JSX code nodes are registered directly, block_content parser, mounted in every context', () => {
    expect(getEditorExtensionRegistration('raw_jsx_block')?.markdownIt?.kind).toBe('block_content');
    expect(getEditorExtensionRegistration('raw_jsx_inline')?.markdownIt?.kind).toBe('inline');
    for (const context of ['page', 'artifact', 'description', 'plan', 'chat-input'] as const) {
      expect(names(getEditorExtensionsForContext(ctx, context)), context).toEqual(
        expect.arrayContaining(['raw_jsx_block', 'raw_jsx_inline']),
      );
    }
    const md = buildMarkdownIt();
    expect((md.block.ruler as unknown as { __rules__: { name: string }[] }).__rules__.map((r) => r.name)).toContain('raw_jsx_block');
  });

  it('[entity:wklad-do-edytora-m20#listy zadań GFM] GFM task lists are registered directly and mounted where the content uses them', () => {
    const list = getEditorExtensionRegistration('task_list');
    const itemReg = getEditorExtensionRegistration('task_item');
    expect(list?.extension).toBeDefined();
    expect(itemReg?.extension).toBeDefined();
    for (const context of ['page', 'plan', 'description'] as const) {
      expect(names(getEditorExtensionsForContext(ctx, context)), context).toEqual(
        expect.arrayContaining(['taskList', 'taskItem']),
      );
    }
    // Outside those contexts (the composer) the GFM list is not mounted.
    expect(names(getEditorExtensionsForContext(ctx, 'chat-input'))).not.toContain('taskList');
  });

  it('[entity:wklad-do-edytora-m20#`MentionExtension`] MentionExtension is registered directly with priority 1100 and loads the `@` sources', () => {
    const reg = getEditorExtensionRegistration('mention_extension');
    expect(reg?.priority).toBe(1100);
    expect(reg?.markdownIt).toBeUndefined();
    expect(getMentionSourceByTrigger('@', 'page')?.id).toBe('files');
    expect(names(getEditorExtensionsForContext(ctx, 'page'))).toContain('mention_extension');
  });

  it('[entity:wklad-do-edytora-m20#`OutlineExtension`] the outline (heading navigation) is registered directly, no parser rule', () => {
    const reg = getEditorExtensionRegistration('heading_actions');
    expect(reg?.extension).toBeDefined();
    expect(reg?.markdownIt).toBeUndefined();
    expect(names(getEditorExtensionsForContext(ctx, 'page'))).toContain('heading_actions');
    expect(names(getEditorExtensionsForContext(ctx, 'plan'))).toContain('heading_actions');
  });

  it('[entity:wklad-do-edytora-m20#`SlashDispatcher`] the slash framework (trigger `/`) is registered directly and aggregates commands and command sources', async () => {
    const reg = getEditorExtensionRegistration('slash_commands');
    expect(reg?.extension).toBeDefined();
    expect(reg?.markdownIt).toBeUndefined();
    source('test-src:dispatch', () => [item('d', '/dispatch')]);
    const rows = await createSlashSession('page').items('');
    expect(rows.some((r) => r.command?.id === 'section')).toBe(true);
    expect(rows.some((r) => r.source?.source.id === 'test-src:dispatch')).toBe(true);
  });
});

describe('M05 contribution sheet — wklad-do-edytora-m05', () => {
  it('[entity:wklad-do-edytora-m05#adnotacje page-bound] the annotation decoration is registered directly and mounted where the context declares it', () => {
    const reg = getEditorExtensionRegistration('annotationHighlight');
    expect(reg?.extension).toBeDefined();
    expect(reg?.markdownIt).toBeUndefined();
    expect(getContextSpec('page').decorations).toContain('annotations');
    expect(getContextSpec('plan').decorations).toContain('annotations');
    expect(names(getEditorExtensionsForContext(ctx, 'page'))).toContain('annotationHighlight');
    // Not in the composer, and never part of the document's schema.
    expect(getContextSpec('chat-input').decorations).toEqual([]);
    expect(names(getEditorExtensionsForContext(ctx, 'chat-input'))).not.toContain('annotationHighlight');
  });

  it('[entity:wklad-do-edytora-m05#`chat-input`] the composer embeds the `chat-input` context — its composition (slash framework included) comes from the context, saved on submit only', () => {
    const spec = getContextSpec('chat-input');
    expect(spec.save).toEqual({ mode: 'explicit' });
    expect(spec.extensions).toEqual(expect.arrayContaining(['slash_commands', 'mention_extension', 'page_ref', 'section_ref']));
    expect(spec.slashCommands).toContain('section');
    expect(spec.mentions).toEqual(['files']);
  });
});
