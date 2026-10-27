// @vitest-environment happy-dom
/**
 * M53 (Agent Chat Shell) — the overlay as the user sees it: header (thread list,
 * system-prompt preview), composer (send, queue, annotations, context chip,
 * cleared-queue restore), and the model-settings popover.
 *
 * The turn itself is M05's: `useChat` is replaced by a stub whose return value
 * each test sets, and whose options (`onQueueCleared`, `onThreadMissing`) the
 * test calls the way the hook would. The composer editor is a stub with the
 * same imperative handle — the `chat-input` editor has tests of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, forwardRef, useImperativeHandle } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatThreadMeta } from '../../shared/entities.js';
import type { ChatConfigResponse } from '../lib/api.js';

const composer = vi.hoisted(() => ({
  text: '',
  props: null as null | { onSubmit: () => void; onChange?: (has: boolean) => void; disabled?: boolean; placeholder?: string },
}));
vi.mock('./ChatInputEditor.js', () => ({
  ChatInputEditor: forwardRef(function FakeComposer(
    props: { onSubmit: () => void; onChange?: (has: boolean) => void; disabled?: boolean; placeholder?: string },
    ref,
  ) {
    // React dev may call a component once more without props (component stack).
    if (props) composer.props = props;
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {},
        getMarkdown: () => composer.text,
        setMarkdown: (md: string) => {
          composer.text = md;
        },
        clear: () => {
          composer.text = '';
        },
        isEmpty: () => composer.text.trim() === '',
      }),
      [],
    );
    return createElement('div', { 'data-composer': '', 'data-disabled': String(Boolean(props?.disabled)) });
  }),
}));

const chat = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  opts: null as null | {
    threadId: string | null;
    model: string | null;
    thinking: string;
    planMode: boolean;
    onQueueCleared?: (texts: string[]) => void;
    onThreadMissing?: () => void;
  },
}));
vi.mock('./useChat.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useChat.js')>()),
  useChat: (opts: typeof chat.opts) => {
    if (opts) chat.opts = opts;
    return chat.value;
  },
}));

// Pass-through spies: which message blocks the list batches and renders.
const batched = vi.hoisted(() => ({ count: 0 }));
vi.mock('@inharness-ai/agent-chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inharness-ai/agent-chat')>();
  return {
    ...actual,
    batchToolBlocks: (blocks: Parameters<typeof actual.batchToolBlocks>[0]) => {
      batched.count++;
      return actual.batchToolBlocks(blocks);
    },
  };
});
const rendered = vi.hoisted(() => ({ blocks: [] as Array<{ text?: string; planMode?: boolean }> }));
vi.mock('./BlockRenderer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./BlockRenderer.js')>();
  return {
    ...actual,
    BlockRenderer: (props: Parameters<typeof actual.BlockRenderer>[0]) => {
      // React dev may call a component once more without props (component stack).
      if (props) rendered.blocks.push({ text: (props.block as { text?: string }).text, planMode: props.planMode });
      return createElement(actual.BlockRenderer, props);
    },
  };
});

const threads = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('./ThreadListContext.js', () => ({ useThreadListContext: () => threads.value }));

const cfg = vi.hoisted(() => ({ chatConfig: undefined as unknown }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[0] === 'chat-config' ? { data: cfg.chatConfig } : { data: undefined },
}));

const route = vi.hoisted(() => ({ matches: [] as unknown[] }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useMatches: () => route.matches,
  useNavigate: () => () => Promise.resolve(),
}));

const api = vi.hoisted(() => ({ calls: [] as Array<{ url: string; init?: RequestInit }>, systemPrompt: 'SYSTEM <prompt/>' }));
vi.mock('../lib/api-core.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-core.js')>()),
  // A plain object, not a `Response`: its body resolves in microtasks only.
  apiFetch: async (url: string, init?: RequestInit) => {
    api.calls.push({ url, init });
    const data = url.endsWith('/system-prompt') ? { initialSystemPrompt: api.systemPrompt } : {};
    return { ok: true, status: 200, json: async () => ({ data }) };
  },
}));

vi.mock('./ChatEditorBridge.js', () => ({
  ChatEditorBridgeProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('../hooks/usePlan.js', () => ({ usePlan: () => ({ data: undefined, error: null }) }));
vi.mock('../hooks/useBriefs.js', () => ({ useBrief: () => ({ data: undefined }) }));
vi.mock('../hooks/usePatches.js', () => ({ usePatch: () => ({ data: undefined }) }));
vi.mock('../ui/events.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui/events.js')>()),
  confirmDestructive: () => Promise.resolve(true),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatOverlay, HISTORY_WINDOW } from './ChatOverlay.js';
import { CHAT_ENDPOINTS } from './useChat.js';
import { useChatStore } from '../state/chat.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG: ChatConfigResponse = {
  architectures: {
    'claude-code': {
      // Deliberately neither alphabetical nor by context size: the picker keeps it.
      models: [
        { alias: 'sonnet-4.6', resolvedId: 'claude-sonnet-4-6', adaptive: false, contextWindow: 200_000 },
        { alias: 'opus-5.5', resolvedId: 'claude-opus-5-5', adaptive: true, contextWindow: 1_000_000 },
        { alias: 'haiku-4.5', resolvedId: 'claude-haiku-4-5', adaptive: false, contextWindow: 200_000 },
      ],
      default: 'opus-5.5',
    },
  },
  defaultArchitecture: 'claude-code',
  sessionResumeConstraints: [
    { path: 'model', reason: 'Model is fixed for this session' },
    { path: 'architectureConfig.claude_thinking', reason: 'Reasoning is fixed for this session' },
    { path: 'architectureConfig.claude_thinking_budget', reason: 'Reasoning is fixed for this session' },
    { path: 'architectureConfig.claude_effort', reason: 'Reasoning is fixed for this session' },
  ],
  planModeEnforceable: true,
};

function thread(over: Partial<ChatThreadMeta> = {}): ChatThreadMeta {
  return {
    id: 't1',
    title: 'First thread',
    lastSessionId: null,
    isLive: false,
    initialArchitectureConfig: null,
    currentTodoItems: null,
    planMode: false,
    usage: null,
    contextSize: null,
    planPath: null,
    hasSystemPrompt: true,
    contextType: 'chat',
    briefPath: null,
    patchPath: null,
    parentThreadId: null,
    spawnedByToolUseId: null,
    createdAt: '2026-10-27T10:00:00.000Z',
    updatedAt: '2026-10-27T10:00:00.000Z',
    messageCount: 2,
    ...over,
  };
}

function chatValue(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messages: [],
    isStreaming: false,
    isResuming: false,
    sendMessage: vi.fn(async () => {}),
    abort: vi.fn(),
    usage: null,
    contextSize: null,
    pendingUserInputs: [],
    submitUserInput: vi.fn(),
    currentTodoItems: null,
    userPlanModes: [],
    userAnnotations: [],
    queuedMessages: [],
    queueMessage: vi.fn(async () => true),
    cancelQueued: vi.fn(),
    clearQueue: vi.fn(),
    transagents: [],
    backgroundTasks: [],
    heldBackgroundTaskCount: 0,
    holdEnding: null,
    isParked: false,
    turnStartedAt: null,
    subagentStartedAt: new Map(),
    busyIndicator: 'none',
    openTurnMessageIds: new Set(),
    activeThreadMeta: null,
    ...over,
  };
}

function threadList(list: ChatThreadMeta[]) {
  const value = {
    threads: list,
    hasMore: false,
    loadingMore: false,
    refresh: vi.fn(async () => {}),
    loadMore: vi.fn(async () => {}),
    createThread: vi.fn(async () => {
      const t = thread({ id: 't-new', title: null, hasSystemPrompt: false, messageCount: 0 });
      value.threads = [t, ...value.threads];
      return t;
    }),
    deleteThread: vi.fn(async () => {}),
    renameThread: vi.fn(async () => {}),
  };
  return value;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  composer.text = '';
  composer.props = null;
  chat.opts = null;
  chat.value = chatValue();
  batched.count = 0;
  rendered.blocks = [];
  threads.value = threadList([thread()]);
  cfg.chatConfig = CONFIG;
  route.matches = [];
  api.calls = [];
  useChatStore.setState({
    chatOpen: true,
    chatThreadId: 't1',
    annotations: [],
    model: null,
    thinking: 'medium',
    seedPrompt: null,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

/** Render, then let the 50 ms draft-restore timer of a thread switch run. */
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
const overlay = () => createElement(QueryClientProvider, { client: qc }, createElement(ChatOverlay));

function render() {
  act(() => root.render(overlay()));
  act(() => {
    vi.advanceTimersByTime(60);
  });
}
const rerender = () => act(() => root.render(overlay()));

const buttons = () => [...host.querySelectorAll('button')];
const byTitle = (title: string) => buttons().find((b) => b.getAttribute('title') === title) ?? null;
const byText = (text: string) => buttons().find((b) => b.textContent?.includes(text)) ?? null;
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
    // Let the handler's promise chain (fetch → json → setState) settle.
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};
/** Type into the composer stub the way the editor reports it. */
function type(text: string) {
  composer.text = text;
  act(() => composer.props!.onChange?.(text.trim() !== ''));
}
const openSettings = () => click(byTitle('Model, thinking level, plan mode, context settings'));
/** The model rows of the open popover, in render order (their sub-line names the context window). */
const modelRows = () => buttons().filter((b) => /ctx|No longer offered/.test(b.textContent ?? ''));
const settingsLabel = () => byTitle('Model, thinking level, plan mode, context settings')!.textContent ?? '';

describe('header — thread list and system prompt preview', () => {
  it('[ac:ac-akcja-new-conversation-tworzy-nowy-wa] "New conversation" founds a new thread through createThread and the previous one stays on the list', async () => {
    const list = threads.value as ReturnType<typeof threadList>;
    render();
    await click(byTitle('New conversation'));
    expect(list.createThread).toHaveBeenCalledTimes(1);
    expect(list.deleteThread).not.toHaveBeenCalled();
    expect(useChatStore.getState().chatThreadId).toBe('t-new');
    // The old thread is still listed in the dropdown.
    rerender();
    await click(byTitle('Switch thread'));
    expect(host.textContent).toContain('First thread');
  });

  it('[ac:ac-custom-threadlistdropdown-w-overlayu] the thread dropdown in the header switches the active thread to the one picked from the list', async () => {
    threads.value = threadList([thread(), thread({ id: 't2', title: 'Second thread' })]);
    render();
    await click(byTitle('Switch thread'));
    await click(byText('Second thread'));
    expect(useChatStore.getState().chatThreadId).toBe('t2');
    expect(chat.opts?.threadId).toBe('t2');
  });

  it('[section:wraq0g4h] an empty thread list says "No previous conversations" and offers "Start new"', async () => {
    const list = threadList([]);
    threads.value = list;
    useChatStore.setState({ chatThreadId: null });
    render();
    await click(byTitle('Switch thread'));
    expect(host.textContent).toContain('No previous conversations');
    await click(byText('Start new'));
    expect(list.createThread).toHaveBeenCalledTimes(1);
  });

  it('[ac:ac-ikona-filetext-w-headerze-chatoverlay] the FileText icon swaps the message list for the system prompt, fetched lazily once per thread', async () => {
    chat.value = chatValue({ messages: [{ id: 'm1', role: 'user', blocks: [{ type: 'text', text: 'hello there', isStreaming: false }], timestamp: '', isStreaming: false }] });
    render();
    expect(api.calls.filter((c) => c.url.endsWith('/system-prompt'))).toHaveLength(0);
    expect(host.textContent).toContain('hello there');

    const toggle = host.querySelector('button[aria-label="Show system prompt"]');
    await click(toggle);
    expect(api.calls.filter((c) => c.url === '/api/threads/t1/system-prompt')).toHaveLength(1);
    expect(toggle!.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[aria-label="System prompt"]')).not.toBeNull();
    expect(host.textContent).not.toContain('hello there');

    // Back to the list, then open again: served from the per-thread cache.
    await click(toggle);
    expect(host.textContent).toContain('hello there');
    await click(toggle);
    expect(api.calls.filter((c) => c.url.endsWith('/system-prompt'))).toHaveLength(1);
  });

  it('[ac:ac-toggle-podgladu-system-promptu-jest-d] the preview toggle is disabled with a tooltip before the first turn, and sending from the composer in preview mode returns to the stream', async () => {
    threads.value = threadList([thread({ hasSystemPrompt: false })]);
    render();
    let toggle = host.querySelector('button[aria-label="Show system prompt"]') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.parentElement!.getAttribute('title')).toBe('System prompt will be rendered after the first message');

    threads.value = threadList([thread({ hasSystemPrompt: true })]);
    rerender();
    toggle = host.querySelector('button[aria-label="Show system prompt"]') as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    await click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    // The composer stays under the preview; sending closes the preview.
    type('next question');
    await click(byTitle('Send (↵)'));
    expect(chat.value.sendMessage).toHaveBeenCalledWith('next question', [], null, null);
    expect(host.querySelector('button[aria-label="Show system prompt"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('[aria-label="System prompt"]')).toBeNull();
  });
});

describe('composer', () => {
  it('[ac:ac-context-indicator-w-overlayu-czatu-po] the context chip shows the page currently open', () => {
    route.matches = [{ routeId: '/space/$rootId/$', params: { rootId: 'pages', _splat: 'modules/m53.md' } }];
    render();
    const chip = host.querySelector('[title="modules/m53.md"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('modules/m53.md');
  });

  it('[section:impolq96] X on the context chip detaches that path only — another page brings the chip back, returning to the detached one does not', async () => {
    route.matches = [{ routeId: '/space/$rootId/$', params: { rootId: 'pages', _splat: 'a.md' } }];
    render();
    await click(host.querySelector('button[aria-label="Detach current page"]'));
    expect(host.querySelector('[title="a.md"]')).toBeNull();
    route.matches = [{ routeId: '/space/$rootId/$', params: { rootId: 'pages', _splat: 'b.md' } }];
    rerender();
    expect(host.querySelector('[title="b.md"]')).not.toBeNull();
    route.matches = [{ routeId: '/space/$rootId/$', params: { rootId: 'pages', _splat: 'a.md' } }];
    rerender();
    expect(host.querySelector('[title="a.md"]')).toBeNull();
  });

  it('[ac:ac-przycisk-abort-w-inputarea-przerywa-t] the Stop button of the input area aborts the running turn (the hook posts to /api/chat/abort)', async () => {
    chat.value = chatValue({ isStreaming: true });
    render();
    await click(byTitle('Stop'));
    expect(chat.value.abort).toHaveBeenCalledTimes(1);
    expect(CHAT_ENDPOINTS.abort.endsWith('/chat/abort')).toBe(true);
  });

  it('[ac:ac-composer-pozostaje-odblokowany-podczas-s] the composer stays unlocked during a stream, and Send queues the message (POST /api/chat/queue/:threadId) instead of starting a stream', async () => {
    chat.value = chatValue({ isStreaming: true });
    render();
    expect(host.querySelector('[data-composer]')!.getAttribute('data-disabled')).toBe('false');
    expect(composer.props!.placeholder).toBe('Queue a message…');
    type('one more thing');
    await click(byTitle('Queue (↵)'));
    expect(chat.value.queueMessage).toHaveBeenCalledWith('one more thing');
    expect(chat.value.sendMessage).not.toHaveBeenCalled();
    expect(composer.text).toBe('');
    expect(CHAT_ENDPOINTS.queue('t1').endsWith('/chat/queue/t1')).toBe(true);
  });

  it('[ac:ac-composer-pozwala-wyslac-wiadomosc-z-p] an empty composer can send when at least one annotation is attached', async () => {
    const ann = { id: 'a1', text: 'the quoted part', comment: '', page: 'a.md', range: { from: 1, to: 5 } };
    render();
    const send = () => byTitle('Send (↵)') as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    act(() => useChatStore.setState({ annotations: [ann] }));
    expect(send().disabled).toBe(false);
    await click(send());
    expect(chat.value.sendMessage).toHaveBeenCalledWith('', [ann], null, null);
  });

  it('[ac:ac-adnotacje-sa-czyszczone-po-pomyslnym] sending a message takes the annotations along and clears them from the panel', async () => {
    const ann = { id: 'a1', text: 'quoted', comment: 'why?', page: 'a.md', range: { from: 1, to: 5 } };
    useChatStore.setState({ annotations: [ann] });
    render();
    expect(host.textContent).toContain('Annotations (1)');
    type('see the annotation');
    await click(byTitle('Send (↵)'));
    expect(chat.value.sendMessage).toHaveBeenCalledWith('see the annotation', [ann], null, null);
    expect(useChatStore.getState().annotations).toEqual([]);
    expect(host.textContent).not.toContain('Annotations (');
  });

  it('[ac:ac-nawigacja-miedzy-stronami-zachowuje-a] navigating to another page keeps the annotations collected on other pages', () => {
    const ann = { id: 'a1', text: 'quoted', comment: '', page: 'a.md', range: { from: 1, to: 5 } };
    useChatStore.setState({ annotations: [ann] });
    route.matches = [{ routeId: '/space/$rootId/$', params: { rootId: 'pages', _splat: 'a.md' } }];
    render();
    route.matches = [{ routeId: '/space/$rootId/$', params: { rootId: 'pages', _splat: 'b.md' } }];
    rerender();
    expect(useChatStore.getState().annotations).toEqual([ann]);
    expect(host.textContent).toContain('Annotations (1)');
  });

  it('[ac:ac-po-przerwaniu-tury-teksty-skasowanej] after the turn is aborted the cleared queue texts return to the composer, merged', () => {
    chat.value = chatValue({ isStreaming: true });
    render();
    type('draft in progress');
    // What the hook calls with the abort response body's `clearedTexts`.
    act(() => chat.opts!.onQueueCleared!(['first queued', 'second queued']));
    expect(composer.text).toBe('first queued\n\nsecond queued\n\ndraft in progress');
  });

  it('[section:impolq96] another client of the thread gets the cleared texts back from the `queue_cleared` event the same way', () => {
    render();
    act(() => chat.opts!.onQueueCleared!(['queued elsewhere']));
    expect(composer.text).toBe('queued elsewhere');
    expect((byTitle('Send (↵)') as HTMLButtonElement).disabled).toBe(false);
  });

  it('[ac:ac-ten-sam-cwd-przy-zresetowanej-bazie-ten] a stale chatThreadId (the thread read answers 404) is self-healed: the store drops it and the overlay starts a new conversation', () => {
    useChatStore.setState({ chatThreadId: 'gone' });
    threads.value = threadList([]);
    render();
    act(() => chat.opts!.onThreadMissing!());
    expect(useChatStore.getState().chatThreadId).toBeNull();
    expect(chat.opts!.threadId).toBeNull();
    expect(host.textContent).toContain('New conversation');
  });
});

describe('thread seeded with a prompt', () => {
  it('[ac:ac-klik-fix-it-with-agent-w-giterrorrecov] [section:m05seedthr] the seeded-thread action opens a closed chat on no current thread and sends the prompt as a visible user message', () => {
    useChatStore.setState({ chatOpen: false, chatThreadId: 't1' });
    render();
    expect(host.querySelector('aside')).toBeNull();
    act(() => useChatStore.getState().startSeededThread('Please fix the push safely.', { autoSubmit: true }));
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(useChatStore.getState().chatOpen).toBe(true);
    // No thread founded on the client: the server creates a plain `chat` thread on the first message.
    expect(useChatStore.getState().chatThreadId).toBeNull();
    expect(chat.opts!.threadId).toBeNull();
    expect(chat.value.sendMessage).toHaveBeenCalledWith('Please fix the push safely.', [], null, null);
    expect(composer.text).toBe('');
  });
});

describe('model settings popover', () => {
  it('[ac:ac-picker-modelu-w-composerze-pokazuje-m] the picker lists the models in the order GET /api/chat/config served them', async () => {
    render();
    await openSettings();
    expect(modelRows().map((b) => b.querySelector('div')!.textContent)).toEqual(['Sonnet 4.6', 'Opus 5.5', 'Haiku 4.5']);
  });

  it('[ac:ac-popover-ustawien-modelu-pokazuje-togg] the Plan Mode toggle is unavailable until the probe confirms both preset groups are enforceable', async () => {
    const toggle = () => byText('Plan mode OFF') as HTMLButtonElement;
    cfg.chatConfig = { ...CONFIG, planModeEnforceable: undefined };
    render();
    await openSettings();
    expect(toggle().disabled).toBe(true);
    expect(toggle().getAttribute('title')).toBe('Checking whether plan mode can be enforced…');

    cfg.chatConfig = { ...CONFIG, planModeEnforceable: false };
    rerender();
    expect(toggle().disabled).toBe(true);

    cfg.chatConfig = CONFIG;
    rerender();
    expect(toggle().disabled).toBe(false);
    // A strong signal, not a promise of a read-only turn.
    expect(toggle().textContent).toContain('not a read-only guarantee');
    await click(toggle());
    expect(byText('Plan mode ON')).not.toBeNull();
  });

  it('[ac:ac-ui-czatu-nie-ma-zadnej-kontrolki-agen] neither the composer nor the popover offers a control for agent.disableDirectFilesystemAccess', async () => {
    render();
    await openSettings();
    expect(host.textContent).not.toMatch(/direct file access|disableDirectFilesystemAccess|file access|filesystem/i);
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    // The popover's sections are the turn's controls only.
    expect(host.textContent).toContain('Model');
    expect(host.textContent).toContain('Thinking level');
    expect(host.textContent).toContain('Plan mode');
  });

  it('[ac:ac-gdy-activethread-lastsessionid-null-k] on a thread with a session model and thinking are disabled with the library reason as tooltip, thinking covers effort, Plan Mode stays active', async () => {
    threads.value = threadList([
      thread({
        lastSessionId: 'sess-1',
        initialArchitectureConfig: { model: 'opus-5.5', architectureConfig: { claude_thinking: 'adaptive', claude_effort: 'high' } },
      }),
    ]);
    render();
    await openSettings();
    for (const row of modelRows()) {
      expect(row.disabled).toBe(true);
      expect(row.getAttribute('title')).toBe('Model is fixed for this session');
    }
    const levels = ['Off', 'Low', 'Medium', 'High', 'Max'].map((l) => buttons().find((b) => b.textContent === l)!);
    for (const b of levels) {
      expect(b.disabled).toBe(true);
      expect(b.getAttribute('title')).toBe('Reasoning is fixed for this session');
    }
    // One reasoning control: the popover's sections are model, thinking and plan mode — no effort control.
    const sections = [...host.querySelectorAll('div.uppercase')]
      .map((d) => d.childNodes[0]?.textContent?.trim() ?? '')
      .filter(Boolean);
    expect(sections).toEqual(['Model', 'Thinking level', 'Plan mode']);
    expect((byText('Plan mode OFF') as HTMLButtonElement).disabled).toBe(false);
  });

  it('[ac:ac-po-createthread-lastsessionid-null-ko] after createThread (lastSessionId === null) model and thinking are editable again', async () => {
    threads.value = threadList([
      thread({
        lastSessionId: 'sess-1',
        initialArchitectureConfig: { model: 'opus-5.5', architectureConfig: { claude_thinking: 'adaptive', claude_effort: 'high' } },
      }),
    ]);
    render();
    await click(byTitle('New conversation'));
    rerender();
    await openSettings();
    for (const row of modelRows()) expect(row.disabled).toBe(false);
    expect((buttons().find((b) => b.textContent === 'Low') as HTMLButtonElement).disabled).toBe(false);
  });

  it('[ac:ac-swiezy-watek-initialarchitectureconfi] a fresh thread (no turn-1 snapshot) inherits the current global model and thinking', async () => {
    useChatStore.setState({ model: 'sonnet-4.6', thinking: 'high' });
    threads.value = threadList([thread({ initialArchitectureConfig: null })]);
    render();
    expect(useChatStore.getState().model).toBe('sonnet-4.6');
    expect(settingsLabel()).toContain('Sonnet 4.6');
    expect(settingsLabel()).toContain('thinking: high');
  });

  it('[ac:ac-po-przelaczeniu-na-zablokowany-watek] switching to a locked thread shows its turn-1 snapshot from the thread LIST projection, not the global value nor the detail', () => {
    useChatStore.setState({ chatThreadId: 't2', model: 'opus-5.5', thinking: 'high' });
    threads.value = threadList([
      thread({
        id: 't2',
        lastSessionId: 'sess-2',
        initialArchitectureConfig: {
          model: 'haiku-4.5',
          architectureConfig: { claude_thinking: 'enabled', claude_thinking_budget: 2048 },
        },
      }),
    ]);
    // The detail fetched for the same thread carries something else — the list wins.
    chat.value = chatValue({
      activeThreadMeta: thread({
        id: 't2',
        lastSessionId: 'sess-2',
        initialArchitectureConfig: { model: 'sonnet-4.6', architectureConfig: {} },
      }),
    });
    render();
    expect(useChatStore.getState().model).toBe('haiku-4.5');
    expect(useChatStore.getState().thinking).toBe('low');
    expect(settingsLabel()).toContain('Haiku 4.5');
    expect(settingsLabel()).toContain('thinking: low');
  });

  it('[ac:ac-watek-wznawiajacy-ktorego-tura-1-usta] a resumed thread whose turn 1 used an alias no longer listed shows that snapshot value in the hard-disabled control, not a substitute', async () => {
    useChatStore.setState({ model: 'opus-5.5' });
    threads.value = threadList([
      thread({
        lastSessionId: 'sess-1',
        initialArchitectureConfig: { model: 'opus-4.1', architectureConfig: {} },
      }),
    ]);
    render();
    expect(useChatStore.getState().model).toBe('opus-4.1');
    expect(settingsLabel()).toContain('Opus 4.1');
    await openSettings();
    const retired = modelRows().find((b) => b.textContent?.includes('Opus 4.1'))!;
    expect(retired.textContent).toContain('No longer offered');
    expect(retired.disabled).toBe(true);
    expect(chat.opts!.model).toBe('opus-4.1');
  });
});

describe('message list — turn state (M53 Stan tury w UI)', () => {
  const history = (prefix: string, length: number) =>
    Array.from({ length }, (_, i) => ({
      id: `${prefix}${i}`,
      role: i % 2 ? 'assistant' : 'user',
      blocks: [{ type: 'text', text: `${prefix}-${String(i).padStart(4, '0')}`, isStreaming: false }],
      timestamp: '',
      isStreaming: false,
    }));
  const shownOf = (prefix: string) => () => host.textContent?.match(new RegExp(`${prefix}-\\d{4}`, 'g')) ?? [];
  const scrollListToTop = () => {
    const list = host.querySelector('[data-chat-message-list]') as HTMLDivElement;
    list.scrollTop = 0;
    act(() => {
      list.dispatchEvent(new Event('scroll'));
    });
  };

  it('[ac:ac-starsze-wiadomosci-watku-z-bardzo-dlu] older messages of a thread with a very long history load into the overlay as the list is scrolled up', () => {
    const messages = history('msg', 130);
    const userPlanModes: boolean[] = [];
    userPlanModes[40] = true; // user message #40 of the thread = msg-0080
    chat.value = chatValue({ messages, userPlanModes });
    render();
    const shown = shownOf('msg');

    // The newest window only — and only it is batched and rendered.
    expect(shown()).toHaveLength(HISTORY_WINDOW);
    expect(shown()[0]).toBe('msg-0070');
    expect(shown()[shown().length - 1]).toBe('msg-0129');
    expect(host.querySelector('[data-older-messages]')?.getAttribute('data-older-messages')).toBe('70');
    expect(rendered.blocks.some((b) => b.text === 'msg-0069')).toBe(false);
    // Per-user metadata stays indexed over the whole thread, hidden prefix included.
    expect(rendered.blocks.find((b) => b.text === 'msg-0080')?.planMode).toBe(true);
    expect(rendered.blocks.find((b) => b.text === 'msg-0082')?.planMode).toBe(false);

    // A streamed delta batches the visible slice, not the hidden history.
    batched.count = 0;
    chat.value = chatValue({ messages: [...messages], userPlanModes });
    rerender();
    expect(batched.count).toBe(HISTORY_WINDOW);

    // Scrolled to the top: the next older window is added above.
    scrollListToTop();
    expect(shown()).toHaveLength(2 * HISTORY_WINDOW);
    expect(shown()[0]).toBe('msg-0010');

    // A message arriving in a live turn does not re-hide what was revealed.
    const withNew = [...messages, ...history('msg', 131).slice(130)];
    chat.value = chatValue({ messages: withNew, userPlanModes });
    rerender();
    expect(shown()).toHaveLength(2 * HISTORY_WINDOW + 1);
    expect(shown()[0]).toBe('msg-0010');
    expect(shown()[shown().length - 1]).toBe('msg-0130');
    expect(host.querySelector('[data-older-messages]')?.getAttribute('data-older-messages')).toBe('10');

    scrollListToTop();
    expect(shown()).toHaveLength(131);
    expect(shown()[0]).toBe('msg-0000');
    expect(host.querySelector('[data-older-messages]')).toBeNull();
  });

  it('[ac:ac-starsze-wiadomosci-watku-z-bardzo-dlu] a thread switch starts from the newest window, even on its first render', () => {
    chat.value = chatValue({ messages: history('msg', 130) });
    render();
    scrollListToTop();
    scrollListToTop();
    expect(shownOf('msg')()).toHaveLength(130);

    // Switch to another long thread: its older history never mounts, not even for one frame.
    rendered.blocks = [];
    act(() => {
      chat.value = chatValue({ messages: history('oth', 130) });
      useChatStore.setState({ chatThreadId: 't2' });
    });
    expect(shownOf('oth')()).toHaveLength(HISTORY_WINDOW);
    expect(shownOf('oth')()[0]).toBe('oth-0070');
    expect(rendered.blocks.some((b) => b.text === 'oth-0069')).toBe(false);

    // Back to the first thread: newest window again, not the window revealed before.
    act(() => {
      chat.value = chatValue({ messages: history('msg', 130) });
      useChatStore.setState({ chatThreadId: 't1' });
    });
    expect(shownOf('msg')()).toHaveLength(HISTORY_WINDOW);
    expect(shownOf('msg')()[0]).toBe('msg-0070');
  });

  it('[ac:ac-wskaznik-holdu-pokazuje-wygasniecie-s] the hold-cap ending is drawn as its own line, worded by the server counters, apart from a user abort', () => {
    const detail = 'background hold expired after 300000ms with 1 subagent delegation(s) still running';
    chat.value = chatValue({ holdEnding: { kind: 'hold-expired', abandoned: 0, detail } });
    render();
    let line = host.querySelector('[data-hold-ending]');
    expect(line?.getAttribute('data-hold-ending')).toBe('hold-expired');
    expect(line?.textContent).toBe(detail);

    chat.value = chatValue({ holdEnding: { kind: 'user-abort', abandoned: 1 } });
    rerender();
    line = host.querySelector('[data-hold-ending]');
    expect(line?.getAttribute('data-hold-ending')).toBe('user-abort');
    expect(line?.textContent).toBe('stopped by you — 1 background task abandoned');
  });
});
