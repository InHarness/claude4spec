// @vitest-environment happy-dom
/**
 * M53 (Agent Chat Shell) — the shell's consumer side of M05's turn, through the
 * real `useChat` hook over the real chat library (stream hook + reducer). Only
 * the network is faked: `fetch` answers the thread read, the turn's SSE stream,
 * the live-join stream and the abort, the way the M05 routes do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatMessageType, UIContentBlock } from '@inharness-ai/agent-chat';
import { useChat, CHAT_ENDPOINTS, WARNING_TOOL_NAME, type UseChatOptions } from './useChat.js';
import { useThreadList } from './useThreadList.js';
import { UsageBadge } from './UsageBadge.js';
import type { Annotation, ChatThreadDetail, ChatThreadMeta } from '../../shared/entities.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- fake network -----------------------------------------------------------

interface Sse {
  body: ReadableStream<Uint8Array>;
  send(event: string, data: unknown): void;
}
function sse(): Sse {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  const enc = new TextEncoder();
  return { body, send: (event, data) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) };
}

type Call = { url: string; init?: RequestInit };
let calls: Call[];
let routes: Record<string, (init?: RequestInit) => unknown>;

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const stream = (s: Sse) => ({ ok: true, status: 200, body: s.body });

function detail(over: Partial<ChatThreadDetail> = {}): ChatThreadDetail {
  return {
    id: 't1',
    title: 'Thread',
    lastSessionId: 'sess-1',
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
    messages: [],
    subagentTasks: [],
    backgroundTasks: [],
    queuedMessages: [],
    childThreads: [],
    ...over,
  };
}

// --- harness ----------------------------------------------------------------

let host: HTMLDivElement;
let root: Root;
let hook: ReturnType<typeof useChat>;
let list: ReturnType<typeof useThreadList>;

function Harness(props: UseChatOptions) {
  hook = useChat(props);
  list = useThreadList();
  return null;
}

const baseOpts = (over: Partial<UseChatOptions> = {}): UseChatOptions => ({
  threadId: null,
  model: 'opus-5.5',
  adaptive: true,
  thinking: 'medium',
  planMode: false,
  ...over,
});

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
async function mount(opts: UseChatOptions) {
  await act(async () => {
    root.render(createElement(Harness, opts));
    await flush();
  });
}
async function emit(s: Sse, event: string, data: unknown) {
  await act(async () => {
    s.send(event, data);
    await flush();
  });
}

beforeEach(() => {
  calls = [];
  routes = {
    '/api/threads?limit=20&offset=0': () => json({ data: [] }),
  };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const handler = routes[url];
    if (!handler) return json({ error: 'not found' }, 404);
    return handler(init);
  });
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

const textOf = (m: ChatMessageType) =>
  m.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
const turnStart = { userMessageId: 'u1', assistantMessageId: 'a1', prompt: 'hello', timestamp: '2026-10-27T10:00:00.000Z' };

// --- tests ------------------------------------------------------------------

describe('the shell over the turn hook', () => {
  // ASSUMPTION:dev-0003 — `useAgentChat` in the criterion is read as the shell's turn
  // hook (`useChat` over the library's useEventStream + useMessageReducer) plus useThreadList.
  it('[ac:ac-hook-useagentchat-serverurl-dostarcza] the hook given a serverUrl hands the overlay shell messages, threads, sendMessage and abort', async () => {
    const thread = { ...detail(), messageCount: 2 } as ChatThreadMeta;
    routes['/api/threads?limit=20&offset=0'] = () => json({ data: [thread] });
    await mount(baseOpts({ serverUrl: '' }));
    expect(Array.isArray(hook.messages)).toBe(true);
    expect(typeof hook.sendMessage).toBe('function');
    expect(typeof hook.abort).toBe('function');
    expect(list.threads.map((t) => t.id)).toEqual(['t1']);

    const turn = sse();
    routes[CHAT_ENDPOINTS.chat] = () => stream(turn);
    await act(async () => {
      void hook.sendMessage('hello');
      await flush();
    });
    expect(calls.some((c) => c.url === CHAT_ENDPOINTS.chat && c.init?.method === 'POST')).toBe(true);
    expect(hook.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('[ac:ac-wyslanie-wiadomosci-z-adnotacjami-dok] sending a message with annotations puts them in the POST /api/chat request body', async () => {
    const turn = sse();
    routes[CHAT_ENDPOINTS.chat] = () => stream(turn);
    await mount(baseOpts());
    const ann: Annotation = { id: 'a1', text: 'the quoted part', comment: 'why?', page: 'modules/m53.md', range: { from: 3, to: 18 } };
    await act(async () => {
      void hook.sendMessage('look at this', [ann], 'modules/m53.md', 'pages');
      await flush();
    });
    const post = calls.find((c) => c.url === CHAT_ENDPOINTS.chat)!;
    const body = JSON.parse(String(post.init!.body)) as { prompt: string; annotations: Annotation[]; currentPage: string };
    expect(body.prompt).toBe('look at this');
    expect(body.annotations).toEqual([ann]);
    expect(body.currentPage).toBe('modules/m53.md');
  });

  it('[ac:ac-mid-turn-user-message-push-w-tej-samej] a mid-turn user_message closes the active assistant block, adds the user message and opens a new assistant block for the next text_delta', async () => {
    const turn = sse();
    routes[CHAT_ENDPOINTS.chat] = () => stream(turn);
    await mount(baseOpts());
    await act(async () => {
      void hook.sendMessage('hello');
      await flush();
    });
    await emit(turn, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(turn, 'turn_start', turnStart);
    await emit(turn, 'text_delta', { text: 'first part', isSubagent: false });
    await emit(turn, 'user_message', { text: 'pushed mid-turn', timestamp: '2026-10-27T10:00:05.000Z' });
    await emit(turn, 'text_delta', { text: 'second part', isSubagent: false });

    const msgs = hook.messages;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(textOf(msgs[1]!)).toBe('first part');
    expect(msgs[1]!.isStreaming).toBe(false);
    expect(textOf(msgs[2]!)).toBe('pushed mid-turn');
    expect(textOf(msgs[3]!)).toBe('second part');
    expect(msgs[3]!.isStreaming).toBe(true);
  });

  it('[ac:ac-zdarzenie-warning-ktore-przyszlo-po-o-2] a `warning` that arrives after the last `result` renders in the chat stream', async () => {
    const turn = sse();
    routes[CHAT_ENDPOINTS.chat] = () => stream(turn);
    await mount(baseOpts());
    await act(async () => {
      void hook.sendMessage('hello');
      await flush();
    });
    await emit(turn, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(turn, 'turn_start', turnStart);
    await emit(turn, 'text_delta', { text: 'answer', isSubagent: false });
    await emit(turn, 'result', { output: 'answer', usage: { inputTokens: 10, outputTokens: 5 }, contextSize: 15 });
    await emit(turn, 'warning', { message: 'Execute param ignored by this architecture' });

    const last = hook.messages[hook.messages.length - 1]!;
    const warning = last.blocks.find(
      (b): b is Extract<UIContentBlock, { type: 'toolUse' }> => b.type === 'toolUse' && b.toolName === WARNING_TOOL_NAME,
    );
    expect(warning).toBeDefined();
    expect(warning!.input).toEqual({ message: 'Execute param ignored by this architecture' });
    // After the answer's text, in stream order.
    expect(last.blocks.findIndex((b) => b === warning)).toBeGreaterThan(last.blocks.findIndex((b) => b.type === 'text'));
  });

  it('[ac:ac-po-przerwaniu-tury-teksty-skasowanej] aborting the turn hands the texts of the cleared queue (abort response body) back for the composer', async () => {
    const turn = sse();
    routes[CHAT_ENDPOINTS.chat] = () => stream(turn);
    routes[CHAT_ENDPOINTS.abort] = () => json({ clearedTexts: ['queued one', 'queued two'] });
    const onQueueCleared = vi.fn();
    await mount(baseOpts({ onQueueCleared }));
    await act(async () => {
      void hook.sendMessage('hello');
      await flush();
    });
    await emit(turn, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(turn, 'turn_start', turnStart);
    await emit(turn, 'queue_updated', { queued: [{ id: '1', text: 'queued one', createdAt: '' }, { id: '2', text: 'queued two', createdAt: '' }] });
    expect(hook.queuedMessages).toHaveLength(2);

    await act(async () => {
      hook.abort();
      await flush();
    });
    const abortCall = calls.find((c) => c.url === CHAT_ENDPOINTS.abort)!;
    expect(JSON.parse(String(abortCall.init!.body))).toEqual({ requestId: 'r1' });
    expect(onQueueCleared).toHaveBeenCalledWith(['queued one', 'queued two']);
    expect(hook.queuedMessages).toEqual([]);
  });
});

describe('thread load (F5 / switch)', () => {
  it('[section:impolq96] a client joined to the thread gets the cleared texts from the `queue_cleared` event, and its chips go', async () => {
    const join = sse();
    routes['/api/threads/t1'] = () =>
      json({ data: detail({ isLive: true, messages: [{ id: 1, threadId: 't1', role: 'user', content: JSON.stringify({ text: 'hello' }), toolName: null, toolId: null, subagentTaskId: null, planMode: false, status: 'complete', usage: null, contextSize: null, createdAt: '2026-10-27T10:00:00.000Z' } as never] }) });
    routes[CHAT_ENDPOINTS.streamByThread('t1')] = () => stream(join);
    const onQueueCleared = vi.fn();
    await mount(baseOpts({ threadId: 't1', onQueueCleared }));
    await emit(join, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(join, 'turn_start', turnStart);
    await emit(join, 'queue_updated', { queued: [{ id: '1', text: 'from the other tab', createdAt: '' }] });
    expect(hook.queuedMessages.map((q) => q.text)).toEqual(['from the other tab']);
    await emit(join, 'queue_cleared', { texts: ['from the other tab'] });
    expect(onQueueCleared).toHaveBeenCalledWith(['from the other tab']);
    expect(hook.queuedMessages).toEqual([]);
  });

  it('[ac:ac-po-f5-chipy-kolejki-watku-sa-odtworzo] after F5 the thread\'s queue chips are restored from `queuedMessages` of the thread detail', async () => {
    const queued = [{ id: '7', text: 'waiting message', createdAt: '2026-10-27T10:00:09.000Z' }];
    routes['/api/threads/t1'] = () => json({ data: detail({ queuedMessages: queued }) });
    await mount(baseOpts({ threadId: 't1' }));
    expect(hook.queuedMessages).toEqual(queued);
  });

  it('[ac:ac-joiner-widzi-snapshot-kolejki-natychm] a message queued before joining shows as a chip right after joining, before any further queue change', async () => {
    const queued = [{ id: '3', text: 'queued before I joined', createdAt: '' }];
    const join = sse();
    routes['/api/threads/t1'] = () =>
      json({ data: detail({ isLive: true, queuedMessages: queued, messages: [{ id: 1, threadId: 't1', role: 'user', content: JSON.stringify({ text: 'hello' }), toolName: null, toolId: null, subagentTaskId: null, planMode: false, status: 'complete', usage: null, contextSize: null, createdAt: '2026-10-27T10:00:00.000Z' } as never] }) });
    routes[CHAT_ENDPOINTS.streamByThread('t1')] = () => stream(join);
    await mount(baseOpts({ threadId: 't1' }));
    // Joined (the live-join is open) and nothing has changed the queue since.
    expect(calls.some((c) => c.url === CHAT_ENDPOINTS.streamByThread('t1'))).toBe(true);
    expect(hook.queuedMessages.map((q) => q.text)).toEqual(['queued before I joined']);
    // The replay's own snapshot keeps it.
    await emit(join, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(join, 'turn_start', turnStart);
    await emit(join, 'queue_updated', { queued });
    expect(hook.queuedMessages.map((q) => q.text)).toEqual(['queued before I joined']);
  });

  it('[ac:ac-po-f5-lub-przelaczeniu-watku-usagebad] after F5 or a thread switch the usage badge hydrates from the thread and shows the real percentage at once, before any `result`', async () => {
    const usage = { inputTokens: 50_000, outputTokens: 10_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
    routes['/api/threads/t1'] = () => json({ data: detail({ usage: usage as never, contextSize: 60_000 }) });
    routes['/api/threads/t2'] = () => json({ data: detail({ id: 't2', usage: { ...usage, inputTokens: 150_000 } as never, contextSize: 160_000 }) });
    await mount(baseOpts({ threadId: 't1' }));
    expect(hook.usage).toEqual(usage);
    const badge = document.createElement('div');
    const badgeRoot = createRoot(badge);
    act(() => badgeRoot.render(createElement(UsageBadge, { usage: hook.usage, contextSize: hook.contextSize, contextWindow: 200_000 })));
    expect(badge.textContent).toContain('30%');

    // Switch: the other thread's value, again without waiting for a `result`.
    await mount(baseOpts({ threadId: 't2' }));
    act(() => badgeRoot.render(createElement(UsageBadge, { usage: hook.usage, contextSize: hook.contextSize, contextWindow: 200_000 })));
    expect(badge.textContent).toContain('80%');
    act(() => badgeRoot.unmount());
  });

  it('[ac:ac-ten-sam-cwd-przy-zresetowanej-bazie-ten] a stale chatThreadId whose read answers 404 (reset database) calls onThreadMissing — the store\'s self-heal', async () => {
    const onThreadMissing = vi.fn();
    await mount(baseOpts({ threadId: 'stale-id', onThreadMissing }));
    expect(calls.some((c) => c.url === '/api/threads/stale-id')).toBe(true);
    expect(onThreadMissing).toHaveBeenCalledTimes(1);
    expect(hook.messages).toEqual([]);
  });
});
