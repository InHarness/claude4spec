/**
 * `/diagram` creates the entity first and inserts its embed second. A refused
 * insert (`run()` → `false`) or a throwing one used to pass silently, leaving an
 * orphan diagram. It must now tell the user — name and slug — and stay distinct
 * from a create failure, where no entity exists.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { QueryClient } from '@tanstack/react-query';

const create = vi.fn();
const openPopover = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

vi.mock('../entities/diagram/api.js', () => ({ diagramsApi: { create: (...a: unknown[]) => create(...a) } }));
vi.mock('../ui/events.js', () => ({ openPopover: (...a: unknown[]) => openPopover(...a), toast }));

const { invokeSlash } = await import('./slashInvoke.js');

function fakeEditor(run: () => boolean) {
  const insertContent = vi.fn(() => ({ insertContent, run }));
  const editor = {
    isDestroyed: false,
    commands: { focus: vi.fn() },
    view: {
      state: { selection: { from: 1 } },
      coordsAtPos: () => ({ left: 0, bottom: 0 }),
    },
    chain: () => ({ focus: () => ({ insertContent }) }),
  };
  return { editor: editor as unknown as Editor, insertContent };
}

const deps = { qc: { invalidateQueries: vi.fn() } as unknown as QueryClient };
const diagramCommand = { id: 'diagram' } as Parameters<typeof invokeSlash>[1];
const todoCommand = { id: 'todo' } as Parameters<typeof invokeSlash>[1];

beforeEach(() => {
  vi.clearAllMocks();
  openPopover.mockResolvedValue({ title: 'Login flow', source: 'A->B', format: 'mermaid', caption: '' });
  create.mockResolvedValue({ slug: 'login-flow', title: 'Login flow', format: 'mermaid' });
});

describe('/diagram — failed embed after create', () => {
  it('a refused insert reports the created entity with its name and slug', async () => {
    const { editor } = fakeEditor(() => false);
    await invokeSlash(editor, diagramCommand, deps);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const msg = toast.warning.mock.calls[0]![0] as string;
    expect(msg).toContain('Login flow');
    expect(msg).toContain('login-flow');
    expect(msg).toMatch(/was created but could not be embedded/);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a throwing insert is reported the same way, not as a create error', async () => {
    const { editor } = fakeEditor(() => {
      throw new Error('schema refused');
    });
    await invokeSlash(editor, diagramCommand, deps);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning.mock.calls[0]![0]).toContain('login-flow');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a create failure keeps the plain error, with no mention of a created entity', async () => {
    create.mockRejectedValue(new Error('Slug taken'));
    const { editor, insertContent } = fakeEditor(() => true);
    await invokeSlash(editor, diagramCommand, deps);
    expect(toast.error).toHaveBeenCalledWith('Slug taken');
    expect(toast.warning).not.toHaveBeenCalled();
    expect(insertContent).not.toHaveBeenCalled();
  });

  it('a successful insert shows no new message', async () => {
    const { editor, insertContent } = fakeEditor(() => true);
    await invokeSlash(editor, diagramCommand, deps);
    expect(insertContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'single_element', attrs: expect.objectContaining({ slug: 'login-flow' }) }),
    );
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('/todo creates nothing and reports nothing', async () => {
    openPopover.mockResolvedValue({ comment: 'later' });
    const { editor } = fakeEditor(() => false);
    await invokeSlash(editor, todoCommand, deps);
    expect(create).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
