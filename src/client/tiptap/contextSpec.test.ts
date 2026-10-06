/**
 * L8 `EditorContextSpec` — the context is the authority on what mounts
 * (M20 `ctx4prof`, rule 3), `availableIn` on a registration is a hint.
 * Pins `ac-trzy-konteksty-page-description`, `ac-editorfactory-create-contextid-initial`
 * and `m20-editor-factory-create`: `buildExtensions` returns extensions from
 * the context whitelist only, and returns a list, not an editor instance.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import './registrations.js';
import {
  ALL_EDITOR_CONTEXTS,
  FULL_ROOT_EDITOR_PROPS,
  assertSaveMode,
  resolveContextSpec,
  rootEditorPropsForKind,
} from './contextSpec.js';
import {
  getContextSpec,
  getEditorExtensionsForContext,
  getRegisteredMentionSources,
  registerEditorExtension,
  unregisterEditorExtensionsByPrefix,
  type RegistryContext,
} from './registry.js';
import { EditorFactory } from './EditorFactory.js';

const ctx: RegistryContext = {
  qc: {} as RegistryContext['qc'],
  currentPath: null,
  onSlashInvoke: () => {},
  getAnnotations: () => [],
};

const names = (list: { name: string }[]) => list.map((e) => e.name);

afterEach(() => {
  unregisterEditorExtensionsByPrefix('test-ctx:');
});

describe('resolveContextSpec — the four contexts (M20 ctxregst)', () => {
  const view = { extensionNames: () => ['a'], slashCommandIds: () => ['x'] };

  it('description: inline mention + anchor + raw node + /mention only, blur save, no @', () => {
    const spec = resolveContextSpec('description', FULL_ROOT_EDITOR_PROPS, view);
    expect(spec.extensions).toEqual(
      expect.arrayContaining(['inline_mention', 'anchor_marker', 'raw_jsx_inline', 'raw_jsx_block']),
    );
    // Rule 7: GFM task lists were parsed here before the whitelist existed.
    expect(spec.extensions).toEqual(expect.arrayContaining(['task_list', 'task_item']));
    for (const gone of ['single_element', 'todo', 'section_ref', 'mention_extension', 'page_ref']) {
      expect(spec.extensions).not.toContain(gone);
    }
    expect(spec.slashCommands).toEqual(['mention']);
    expect(spec.mentions).toEqual([]);
    expect(spec.save).toEqual({ mode: 'blur' });
  });

  it('plan: /section alone, explicit save, no todo marker', () => {
    const spec = resolveContextSpec('plan', FULL_ROOT_EDITOR_PROPS, view);
    expect(spec.slashCommands).toEqual(['section']);
    expect(spec.extensions).not.toContain('todo');
    expect(spec.extensions).toEqual(expect.arrayContaining(['section_ref', 'single_element', 'mention_extension']));
    expect(spec.save).toEqual({ mode: 'explicit' });
    expect(spec.mentions).toEqual(['files']);
  });

  it('chat-input: mention + page/section refs + /section, explicit (submit)', () => {
    const spec = resolveContextSpec('chat-input', FULL_ROOT_EDITOR_PROPS, view);
    expect(spec.extensions).toEqual(
      expect.arrayContaining(['mention_extension', 'page_ref', 'section_ref', 'slash_commands']),
    );
    expect(spec.extensions).not.toContain('inline_mention');
    expect(spec.slashCommands).toEqual(['section']);
    expect(spec.save).toEqual({ mode: 'explicit' });
  });

  it('page is derived from the root kind, not a fixed list (L13)', () => {
    const reg = {
      extensionNames: () => ['anchor_marker', 'section_ref', 'single_element', 'todo', 'plugin:thing'],
      slashCommandIds: () => ['mention', 'todo', 'plugin-thing'],
    };
    const full = resolveContextSpec('page', FULL_ROOT_EDITOR_PROPS, reg);
    expect(full.extensions).toEqual(['anchor_marker', 'section_ref', 'single_element', 'todo', 'plugin:thing']);
    expect(full.slashCommands).toEqual(['mention', 'todo', 'plugin-thing']);
    expect(full.save).toEqual({ mode: 'debounce', debounceMs: 1000 });

    // 2.1.8: FULL_ROOT_EDITOR_PROPS is the `pages` kind's layers, with no `@`
    // scope until the config loads; the scope is handed in, never invented.
    expect(FULL_ROOT_EDITOR_PROPS).toEqual(rootEditorPropsForKind('pages', []));
    expect(rootEditorPropsForKind('pages', ['docs', 'pages'])).toEqual({
      sectionIndexed: true,
      referenceValidated: true,
      linkTargets: ['docs', 'pages'],
    });
  });

  /**
   * 2.1.8 — briefs and patches mount the NAMED `artifact` context: the page
   * derivation with the section and reference layers off. The palette follows
   * the schema: a command whose node is gated out is not offered (the pick
   * would delete the `/query` and insert nothing). `/todo` stays; a plugin
   * command inserts an entity embed, so it goes with the reference gate.
   */
  it('artifact: the page derivation without anchors, section refs or entity nodes, debounced', () => {
    expect(ALL_EDITOR_CONTEXTS).toContain('artifact');
    const reg = {
      extensionNames: () => ['anchor_marker', 'section_ref', 'single_element', 'todo', 'plugin:thing'],
      slashCommandIds: () => ['mention', 'section', 'todo', 'plugin-thing'],
    };
    const artifact = resolveContextSpec('artifact', rootEditorPropsForKind('pages', ['pages']), reg);
    expect(artifact.id).toBe('artifact');
    expect(artifact.extensions).toEqual(['todo', 'plugin:thing']);
    expect(artifact.slashCommands).toEqual(['todo']);
    expect(artifact.mentions).toEqual(['files']);
    expect(artifact.save).toEqual({ mode: 'debounce', debounceMs: 1000 });
  });
});

describe('registry ∩ spec — the whitelist is authoritative', () => {
  it('a registration hinting `description` but outside its whitelist is NOT mounted', () => {
    registerEditorExtension({
      name: 'test-ctx:sneaky',
      extension: { name: 'test-ctx:sneaky' } as never,
      availableIn: ['description'],
    });
    expect(names(getEditorExtensionsForContext(ctx, 'description'))).not.toContain('test-ctx:sneaky');
    // …while the derived `page` context, which admits everything registered, mounts it.
    expect(names(getEditorExtensionsForContext(ctx, 'page'))).toContain('test-ctx:sneaky');
  });

  it('description mounts the raw node so unmounted reference tags survive a save', () => {
    const mounted = names(getEditorExtensionsForContext(ctx, 'description'));
    expect(mounted).toEqual(expect.arrayContaining(['raw_jsx_inline', 'raw_jsx_block', 'anchor_marker']));
    for (const gone of ['single_element', 'todo', 'section_ref', 'heading_actions', 'mention_extension']) {
      expect(mounted).not.toContain(gone);
    }
  });

  it('plan drops the todo marker and the task list stays (core GFM)', () => {
    const mounted = names(getEditorExtensionsForContext(ctx, 'plan'));
    expect(mounted).not.toContain('todo');
    expect(mounted).toEqual(expect.arrayContaining(['section_ref', 'single_element', 'taskList', 'taskItem']));
  });

  it("a brief/patch (`artifact` context) mounts no anchor_marker / section_ref / heading_actions / entity nodes, and its id is 'artifact'", () => {
    expect(getContextSpec('artifact').id).toBe('artifact');
    const mounted = names(getEditorExtensionsForContext(ctx, 'artifact'));
    for (const gone of [
      'anchor_marker',
      'section_ref',
      'heading_actions',
      'inline_mention',
      'single_element',
      'element_list',
      'tagged_list',
      'tagged_list_mixed',
    ]) {
      expect(mounted, gone).not.toContain(gone);
    }
    expect(mounted).toEqual(expect.arrayContaining(['raw_jsx_inline', 'todo', 'mention_extension']));
    // The same nodes ARE mounted on a page of the same root — the context, not the root, gates them.
    const page = names(getEditorExtensionsForContext(ctx, 'page'));
    expect(page).toEqual(expect.arrayContaining(['anchor_marker', 'section_ref', 'inline_mention', 'single_element']));
  });

  it('mention sources follow spec.mentions, not the source hint', () => {
    expect(getRegisteredMentionSources('description')).toEqual([]);
    expect(getRegisteredMentionSources('plan').map((s) => s.id)).toEqual(['files']);
    expect(getRegisteredMentionSources('artifact').map((s) => s.id)).toEqual(['files']);
  });

  it('[ac:m51-editor-extension-tag-name-rejected] a registration named after a registered XML tag is rejected', () => {
    expect(() =>
      registerEditorExtension({ name: 'todo', extension: { name: 'todo' } as never, availableIn: ['page'] }),
    ).toThrow(/registered XML tag/);
  });

  it('the XML tag nodes of a context come from the registry, gated by its whitelist', () => {
    const page = names(getEditorExtensionsForContext(ctx, 'page'));
    for (const tag of ['inline_mention', 'single_element', 'element_list', 'tagged_list', 'tagged_list_mixed', 'section_ref', 'todo']) {
      expect(page, tag).toContain(tag);
    }
    expect(names(getEditorExtensionsForContext(ctx, 'chat-input'))).toContain('section_ref');
    expect(names(getEditorExtensionsForContext(ctx, 'chat-input'))).not.toContain('todo');
  });

  // LAST in this block: it replaces the real `task_list` registration with a stub.
  it('a whitelisted name missing from the hint still mounts, with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerEditorExtension({
      name: 'task_list',
      extension: { name: 'task_list' } as never,
      availableIn: ['page'],
    });
    try {
      expect(names(getEditorExtensionsForContext(ctx, 'description'))).toContain('task_list');
      getEditorExtensionsForContext(ctx, 'description');
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('"task_list"'))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('EditorFactory.buildExtensions', () => {
  it('returns a list of extensions for the context, not an editor instance', () => {
    const list = EditorFactory.buildExtensions('description', ctx);
    expect(Array.isArray(list)).toBe(true);
    const n = names(list);
    expect(n).toContain('starterKit');
    expect(n).toContain('inline_mention');
    expect(n).not.toContain('todo');
  });
});

describe('assertSaveMode (rule 4)', () => {
  it('returns the policy on a match and reports a mismatch without throwing', () => {
    expect(assertSaveMode(getContextSpec('description'), 'blur')).toEqual({ mode: 'blur' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => assertSaveMode(getContextSpec('plan'), 'debounce')).not.toThrow();
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
