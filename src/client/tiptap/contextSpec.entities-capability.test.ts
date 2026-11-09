/**
 * 2.1.77 (M20 L19 `gv6us4lf`) — the `page` and `plan` editor contexts of a
 * project without the capability `entities` mount only the non-entity tags and
 * extensions, and of the commands only the non-entity ones: `/section`, in
 * `page` also `/todo` and plugin slashes. No broken-reference decoration.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FULL_ROOT_EDITOR_PROPS, resolveContextSpec, setEditorEntitiesCapability } from './contextSpec.js';

const ENTITY_TAGS = ['inline_mention', 'single_element', 'element_list', 'tagged_list', 'tagged_list_mixed'];

const reg = {
  extensionNames: () => ['anchor_marker', 'section_ref', ...ENTITY_TAGS, 'todo', 'plugin:thing'],
  slashCommandIds: () => ['mention', 'element', 'list', 'tagged', 'tagged-mixed', 'section', 'todo', 'plugin-thing'],
};

afterEach(() => setEditorEntitiesCapability(true));

describe('editor contexts without the capability `entities` (2.1.77)', () => {
  it('`page` mounts no entity tag, offers no entity command and has no broken-reference decoration', () => {
    setEditorEntitiesCapability(false);
    const page = resolveContextSpec('page', FULL_ROOT_EDITOR_PROPS, reg);
    expect(page.extensions).toEqual(['anchor_marker', 'section_ref', 'todo', 'plugin:thing']);
    expect(page.slashCommands).toEqual(['section', 'todo', 'plugin-thing']);
    expect(page.decorations).toEqual(['annotations']);

    // Control: with the capability the same registry mounts all of it.
    setEditorEntitiesCapability(true);
    const full = resolveContextSpec('page', FULL_ROOT_EDITOR_PROPS, reg);
    expect(full.extensions).toEqual(expect.arrayContaining(ENTITY_TAGS));
    expect(full.slashCommands).toEqual(reg.slashCommandIds());
    expect(full.decorations).toEqual(['annotations', 'broken_refs']);
  });

  it('`plan` keeps `/section` and the non-entity extensions, without the five entity tags and broken refs', () => {
    setEditorEntitiesCapability(false);
    const plan = resolveContextSpec('plan', FULL_ROOT_EDITOR_PROPS, reg);
    for (const tag of ENTITY_TAGS) expect(plan.extensions).not.toContain(tag);
    expect(plan.extensions).toEqual(expect.arrayContaining(['section_ref', 'anchor_marker', 'raw_jsx_block', 'raw_jsx_inline']));
    expect(plan.slashCommands).toEqual(['section']);
    expect(plan.decorations).toEqual(['annotations']);

    setEditorEntitiesCapability(true);
    expect(resolveContextSpec('plan', FULL_ROOT_EDITOR_PROPS, reg).extensions).toEqual(expect.arrayContaining(ENTITY_TAGS));
  });
});
