// @vitest-environment happy-dom
/**
 * 2.1.18 (M23, ui-view `patch-page`) — the patch page at `/patches/$`: header
 * (title, `patch_kind` badge, applied/pending badge, link to the brief), the
 * Settings popover with the `applied` toggle — which states that the user sets
 * both values while the patch thread's agent can only set it to `true`
 * (`mark_patch_applied`) — and the "Change spec according to patch" action that
 * opens the chat overlay on a fresh patch thread. The entity lists no extra
 * `states`, so the default state (pending and applied variants) is the whole set.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const h = vi.hoisted(() => ({
  frontmatter: {} as Record<string, unknown>,
  setApplied: [] as boolean[],
  created: 0,
  chat: { threadId: null as string | null, open: false },
}));

vi.mock('../hooks/usePatches.js', () => ({
  usePatch: () => ({
    isLoading: false,
    data: { path: 'p.md', title: 'Drift in M23', frontmatter: h.frontmatter },
  }),
  useCreatePatchThread: () => ({
    isPending: false,
    mutateAsync: async () => {
      h.created += 1;
      return { threadId: 'thread-new' };
    },
  }),
  useSetPatchApplied: () => ({
    mutateAsync: async (v: boolean) => {
      h.setApplied.push(v);
    },
  }),
}));
vi.mock('../hooks/useArtifactThreads.js', () => ({
  useArtifactThreads: () => ({
    threads: [],
    isPending: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: async () => {},
  }),
}));
vi.mock('../state/chat.js', () => ({
  useChatStore: (sel: (s: unknown) => unknown) =>
    sel({
      setChatThreadId: (id: string) => {
        h.chat.threadId = id;
      },
      setChatOpen: (open: boolean) => {
        h.chat.open = open;
      },
    }),
}));
vi.mock('./PatchEditor.js', () => ({ PatchEditor: () => createElement('div', { 'data-testid': 'patch-editor' }) }));
vi.mock('./ArtifactThreadsPanel.js', () => ({ ArtifactThreadsPanel: () => createElement('div') }));
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children?: unknown; title?: string }) =>
    createElement('a', { 'data-testid': 'brief-link', title: props.title }, props.children as never),
}));

import { PatchDetail } from './PatchDetail.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(createElement(PatchDetail, { patchPath: 'p.md' }));
  });
}
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) ?? null;
async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  h.frontmatter = {
    type: 'patch',
    brief: 'v1-to-v2.md',
    patch_kind: 'drift',
    created_at: '2026-10-01T10:00:00.000Z',
    created_by: 'agent',
  };
  h.setApplied = [];
  h.created = 0;
  h.chat = { threadId: null, open: false };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('PatchDetail (/patches/$)', () => {
  it('[entity:patch-page] default state: header with kind and pending badge, brief link, settings popover whose applied toggle states that the agent can only set the flag and the user unsets it, and the "Change spec according to patch" action', async () => {
    await render();
    const header = host.querySelector('header')!;
    expect(header.textContent).toContain('Drift in M23');
    expect(header.textContent).toContain('drift');
    // No `applied` key (a legacy file included) reads as pending.
    expect(header.textContent).toContain('pending ⏳');
    expect(host.querySelector('[data-testid="brief-link"]')?.textContent).toContain('v1-to-v2.md');
    expect(host.querySelector('[data-testid="patch-editor"]')).not.toBeNull();

    // Settings popover → the boolean toggle, and who else writes the flag.
    expect(host.textContent).not.toContain('Patch settings');
    await click(host.querySelector('button[title="Patch settings"]'));
    expect(host.textContent).toContain('Patch settings');
    const note = host.querySelector('[data-testid="patch-applied-agent-note"]')?.textContent ?? '';
    expect(note).toContain('You set both values here');
    expect(note).toMatch(/agent can only mark it applied/);
    expect(note).toContain('mark_patch_applied');
    expect(note).toMatch(/unsetting it stays with you/);
    // The old "no agent channel" claim is gone.
    expect(host.textContent).not.toMatch(/no agent channel/i);
    await click(button('Mark as applied'));
    expect(h.setApplied).toEqual([true]);

    // The action at the bottom opens the chat overlay on a new patch thread.
    await click(button('Change spec according to patch'));
    expect(h.created).toBe(1);
    expect(h.chat).toEqual({ threadId: 'thread-new', open: true });
  });

  it('[entity:patch-page] applied patch: applied badge, and the toggle offers to unset it (user-driven)', async () => {
    h.frontmatter = { ...h.frontmatter, applied: true };
    await render();
    expect(host.querySelector('header')!.textContent).toContain('applied ✅');
    await click(host.querySelector('button[title="Patch settings"]'));
    await click(button('Mark as pending'));
    expect(h.setApplied).toEqual([false]);
  });
});
