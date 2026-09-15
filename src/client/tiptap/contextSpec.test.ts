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
  ARTEFACT_ROOT_EDITOR_PROPS,
  FULL_ROOT_EDITOR_PROPS,
  MINIMAL_ROOT_EDITOR_PROPS,
  assertSaveMode,
  resolveContextSpec,
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

  it('page is derived from root props, not a fixed list (L13)', () => {
    const reg = {
      extensionNames: () => ['anchor_marker', 'section_ref', 'single_element', 'todo', 'plugin:thing'],
      slashCommandIds: () => ['mention', 'todo', 'plugin-thing'],
    };
    const full = resolveContextSpec('page', FULL_ROOT_EDITOR_PROPS, reg);
    expect(full.extensions).toEqual(['anchor_marker', 'section_ref', 'single_element', 'todo', 'plugin:thing']);
    expect(full.slashCommands).toEqual(['mention', 'todo', 'plugin-thing']);
    expect(full.save).toEqual({ mode: 'debounce', debounceMs: 1000 });

    const minimal = resolveContextSpec('page', MINIMAL_ROOT_EDITOR_PROPS, reg);
    expect(minimal.extensions).toEqual(['todo', 'plugin:thing']);

    const artefact = resolveContextSpec('page', ARTEFACT_ROOT_EDITOR_PROPS, reg);
    expect(artefact.extensions).toEqual(minimal.extensions);
    expect(ARTEFACT_ROOT_EDITOR_PROPS.linkTargets).toEqual(['pages']);
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

  it('a brief/patch (`page` + artefact props) mounts no section or reference nodes', () => {
    const mounted = names(getEditorExtensionsForContext(ctx, 'page', ARTEFACT_ROOT_EDITOR_PROPS));
    for (const gone of ['anchor_marker', 'section_ref', 'heading_actions', 'inline_mention', 'single_element']) {
      expect(mounted).not.toContain(gone);
    }
    expect(mounted).toEqual(expect.arrayContaining(['raw_jsx_inline', 'todo', 'mention_extension']));
  });

  it('mention sources follow spec.mentions, not the source hint', () => {
    expect(getRegisteredMentionSources('description')).toEqual([]);
    expect(getRegisteredMentionSources('plan').map((s) => s.id)).toEqual(['files']);
    expect(getRegisteredMentionSources('page', ARTEFACT_ROOT_EDITOR_PROPS).map((s) => s.id)).toEqual(['files']);
  });

  // LAST in this block: it replaces the real `inline_mention` registration with a stub.
  it('a whitelisted name missing from the hint still mounts, with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerEditorExtension({
      name: 'inline_mention',
      extension: { name: 'inline_mention' } as never,
      availableIn: ['page'],
    });
    try {
      expect(names(getEditorExtensionsForContext(ctx, 'description'))).toContain('inline_mention');
      getEditorExtensionsForContext(ctx, 'description');
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('"inline_mention"'))).toHaveLength(1);
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
