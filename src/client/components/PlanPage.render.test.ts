// @vitest-environment happy-dom
/**
 * 2.1.28 (M10 Host UI Kit slice `0dy3js11`, ui-view `plan-page`) — the plan
 * page's footer is the catalog `ActionBar` (the slice's one consumed
 * component): M10 hands it the Save / Discard / Analyse plan / Run plan action
 * descriptions, it draws no sticky bar of its own. The threads panel and the
 * plan file's version history are the slice's two recorded DŁUG entries — the
 * host `ArtifactThreadsPanel` and `FileVersionHistory`, not rebuilt this window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ActionBarProps } from '../host-ui-kit/actions/ActionBar.js';

const h = vi.hoisted(() => ({
  body: 'Step 1: do the thing.\n',
  actionBars: [] as ActionBarProps[],
  editorOnChange: null as null | ((md: string, dirty: boolean) => void),
}));

vi.mock('../host-ui-kit/actions/ActionBar.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../host-ui-kit/actions/ActionBar.js')>();
  return {
    ActionBar: (props: ActionBarProps) => {
      // React dev may call a component without props (component stack) — record only real renders.
      if (props && Array.isArray(props.actions)) h.actionBars.push(props);
      return createElement(real.ActionBar, props);
    },
  };
});
vi.mock('../hooks/usePlan.js', () => {
  const mutation = { isPending: false, mutateAsync: async () => ({ hash: 'h2', threadId: 't1' }) };
  return {
    usePlan: () => ({
      isLoading: false,
      data: {
        path: 'my-plan.md',
        body: h.body,
        content: `---\ntitle: My plan\n---\n${h.body}`,
        hash: 'h1',
        frontmatter: { title: 'My plan' },
      },
    }),
    usePlanLastThread: () => ({ data: null }),
    usePlanVersions: () => ({ data: { versions: [{ version: 3 }], total: 1 } }),
    useSavePlan: () => mutation,
    useCreateThreadFromPlan: () => mutation,
    useUpdatePlanTitle: () => mutation,
    useSetPlanApplied: () => mutation,
  };
});
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
  useChatStore: (sel: (s: unknown) => unknown) => sel({ setChatThreadId: () => {}, setChatOpen: () => {} }),
}));
vi.mock('../state/outline.js', () => ({
  useOutlineStore: (sel: (s: unknown) => unknown) => sel({ editor: null }),
}));
vi.mock('../chat/chatPrefill.js', () => ({ requestChatPrefill: () => {} }));
vi.mock('../tiptap/unsavedEdits.js', () => ({ useUnsavedEditsSource: () => {} }));
vi.mock('./OutlineButton.js', () => ({ OutlineButton: () => null }));
vi.mock('./PlanEditor.js', () => ({
  PlanEditor: (props: { onChange: (md: string, dirty: boolean) => void }) => {
    h.editorOnChange = props?.onChange ?? h.editorOnChange;
    return createElement('div', { 'data-testid': 'plan-editor' });
  },
}));
vi.mock('./ArtifactThreadsPanel.js', () => ({
  ArtifactThreadsPanel: () => createElement('div', { 'data-testid': 'artifact-threads-panel' }),
}));
vi.mock('./FileVersionHistory.js', () => ({
  FileVersionHistory: (props: { kind?: string }) =>
    createElement('div', { 'data-testid': 'file-version-history', 'data-kind': props?.kind }),
}));

import { PlanPage } from './PlanPage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  h.body = 'Step 1: do the thing.\n';
  h.actionBars = [];
  h.editorOnChange = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render() {
  await act(async () => {
    root.render(createElement(PlanPage, { planPath: 'my-plan.md' }));
  });
}

const lastBar = () => h.actionBars[h.actionBars.length - 1];
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) ?? null;
/** The sticky footer the catalog ActionBar draws. */
const stickyBar = () =>
  Array.from(host.querySelectorAll<HTMLElement>('div')).find((d) => d.style.position === 'sticky') ?? null;

describe('[section:0dy3js11] M10 Host UI Kit slice — plan-page footer is the catalog ActionBar', () => {
  it('[section:0dy3js11] a saved, non-empty plan renders its footer through the catalog ActionBar with Analyse plan and Run plan (Run primary)', async () => {
    await render();
    expect(h.actionBars.length).toBeGreaterThan(0);
    const bar = lastBar()!;
    expect(bar.actions.map((a) => a.label)).toEqual(['Analyse plan', 'Run plan']);
    expect(bar.actions.find((a) => a.label === 'Run plan')?.variant).toBe('primary');
    expect(bar.status).toBeUndefined();
    // The buttons are drawn inside the catalog's sticky bar, not by page markup.
    const sticky = stickyBar();
    expect(sticky).not.toBeNull();
    expect(sticky!.contains(button('Run plan'))).toBe(true);
    expect(sticky!.contains(button('Analyse plan'))).toBe(true);
    // Exactly one sticky bar on the page — the ActionBar's.
    expect(Array.from(host.querySelectorAll<HTMLElement>('div')).filter((d) => d.style.position === 'sticky')).toHaveLength(1);
  });

  it('[section:0dy3js11] unsaved edits add Discard and Save to the same ActionBar, with the status slot', async () => {
    await render();
    await act(async () => {
      h.editorOnChange!('Step 1: do another thing.\n', true);
    });
    const bar = lastBar()!;
    expect(bar.actions.map((a) => a.label)).toEqual(['Discard', 'Save', 'Analyse plan', 'Run plan']);
    expect(bar.status).toBe('Unsaved changes');
    const sticky = stickyBar()!;
    expect(sticky.contains(button('Save'))).toBe(true);
    expect(sticky.contains(button('Discard'))).toBe(true);
    expect(sticky.textContent).toContain('Unsaved changes');
  });

  it('[section:0dy3js11] an empty plan has nothing to act on, so no footer is rendered', async () => {
    h.body = '   \n';
    await render();
    expect(h.actionBars).toHaveLength(0);
    expect(stickyBar()).toBeNull();
    expect(button('Run plan')).toBeNull();
  });

  it('[section:0dy3js11] the threads panel and the plan file version history stay the host DŁUG components (ArtifactThreadsPanel, FileVersionHistory)', async () => {
    await render();
    await act(async () => {
      button('Threads')!.click();
    });
    expect(host.querySelector('[data-testid="artifact-threads-panel"]')).not.toBeNull();
    await act(async () => {
      button('History')!.click();
    });
    const history = host.querySelector('[data-testid="file-version-history"]');
    expect(history).not.toBeNull();
    expect(history!.getAttribute('data-kind')).toBe('plan');
  });
});
