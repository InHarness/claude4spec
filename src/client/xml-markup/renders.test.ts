import { describe, expect, it } from 'vitest';
import '../xml-markup/host-renders.js';
import { assignTagRender, getTagRender } from './renders.js';
import { getTagPopoverFields, registerTagPopoverFields } from './popover-fields.js';
import { listXmlTags } from '../../shared/xml-markup/registry.js';

describe('render assignment (M51, browser side)', () => {
  it('every host tag has a render assigned by its owning module', () => {
    for (const { name } of listXmlTags()) expect(getTagRender(name), name).toBeDefined();
  });

  it('[ac:m51-render-unregistered-rejected] assigning a render to a name outside the registry is rejected', () => {
    expect(() => assignTagRender('figure_ref', () => null)).toThrow(/not a registered XML tag/);
    expect(getTagRender('figure_ref')).toBeUndefined();
  });

  it('popover fields follow the same rule, and todo opens on double-click', () => {
    expect(() =>
      registerTagPopoverFields('figure_ref', { title: { create: 'x', edit: 'x' }, Fields: () => null }),
    ).toThrow(/not a registered XML tag/);
    expect(getTagPopoverFields('todo')?.openOnDoubleClick).toBe(true);
    expect(getTagPopoverFields('section_ref')?.openOnDoubleClick).toBeFalsy();
  });

  it('todo: a comment is required to create, not to edit; blank lines collapse', () => {
    const todo = getTagPopoverFields('todo')!;
    expect(todo.validate!({ comment: '  ' }, 'create')).toMatch(/required/);
    expect(todo.validate!({ comment: '' }, 'edit')).toBeNull();
    expect(todo.normalize!({ comment: ' a\n\n\n b ' })).toEqual({ comment: 'a\nb' });
  });
});
