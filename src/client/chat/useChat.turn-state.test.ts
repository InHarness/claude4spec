// @vitest-environment happy-dom
/**
 * M53 (Agent Chat Shell) — "Stan tury w UI": what the overlay restores and
 * shows of a turn the server runs. Through the real `useChat` hook over the
 * real chat library (stream hook + reducer); only the network is faked —
 * `fetch` answers the thread read, the turn's SSE stream, the live-join stream
 * and the abort the way the M05 routes do. Blocks are drawn by the real
 * `<BlockRenderer />`, the way the message list draws them.
 *
 * The server halves of these contracts (the `isLive` read, the replay buffer,
 * the live-join 404, the hold counters) are M05's and pinned in
 * `src/server/routes/*.test.ts`; these are the client halves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { batchToolBlocks, type ChatMessageType, type UIContentBlock } from '@inharness-ai/agent-chat';
import type { TodoItem, UserInputRequest } from '@inharness-ai/agent-adapters';

vi.mock('../entities/registry.js', () => ({ getEntityDef: () => null }));
vi.mock('../entities/ChipResolver.js', () => ({
  ChipResolver: ({ slug }: { slug: string }) => createElement('span', { 'data-chip': slug }, slug),
}));

import {
  useChat,
  CHAT_ENDPOINTS,
  BACKGROUND_TASK_TOOL_NAME,
  USER_INPUT_TOOL_NAME,
  holdEndingLabel,
  type UseChatOptions,
} from './useChat.js';
import { BlockRenderer } from './BlockRenderer.js';
import { CurrentTodoList } from './CurrentTodoList.js';
import { UserInputRequestCard } from './UserInputRequestCard.js';
import { streamingBubbleVisible } from './StreamingBubble.js';
import type { ChatBackgroundTask, ChatMessage, ChatSubagentTask, ChatThreadDetail } from '../../shared/entities.js';
import type { ToastRequest } from '../ui/events.js';

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
let toasts: ToastRequest[];
const onToast = (e: Event) => toasts.push((e as CustomEvent<ToastRequest>).detail);

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

let rowId = 0;
function row(role: ChatMessage['role'], content: unknown, over: Partial<ChatMessage> = {}): ChatMessage {
  rowId += 1;
  return {
    id: rowId,
    threadId: 't1',
    role,
    content: typeof content === 'string' ? content : JSON.stringify(content),
    toolName: null,
    toolId: null,
    subagentTaskId: null,
    planMode: false,
    status: 'complete',
    usage: null,
    contextSize: null,
    createdAt: `2026-10-27 10:00:${String(rowId).padStart(2, '0')}`,
    ...over,
  } as ChatMessage;
}

function bgRow(over: Partial<ChatBackgroundTask> = {}): ChatBackgroundTask {
  return {
    threadId: 't1',
    taskId: 'bg1',
    taskType: 'shell',
    description: 'npm run build',
    status: 'running',
    outputFile: null,
    summary: null,
    createdAt: '2026-10-27 10:00:02',
    updatedAt: '2026-10-27 10:00:02',
    ...over,
  };
}

// --- harness ----------------------------------------------------------------

let host: HTMLDivElement;
let root: Root;
let view: HTMLDivElement;
let viewRoot: Root;
let hook: ReturnType<typeof useChat>;

function Harness(props: UseChatOptions) {
  hook = useChat(props);
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
async function send(prompt = 'hello') {
  await act(async () => {
    void hook.sendMessage(prompt);
    await flush();
  });
}

/** The hook's messages drawn the way the message list draws them. */
function renderTranscript() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  act(() =>
    viewRoot.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        hook.messages.map((msg) => {
          const shown = batchToolBlocks(msg.blocks);
          return createElement(
            'div',
            { key: msg.id, 'data-msg': msg.role },
            shown.map((block, i) =>
              createElement(BlockRenderer, {
                key: i,
                block,
                siblings: shown,
                side: msg.role,
                backgroundTasks: hook.backgroundTasks,
                subagentStartedAt: hook.subagentStartedAt,
                turnOpen: hook.openTurnMessageIds.has(msg.id),
                transagents: hook.transagents,
                model: 'opus-5.5',
              }),
            ),
          );
        }),
      ),
    ),
  );
  return view;
}

beforeEach(() => {
  calls = [];
  toasts = [];
  rowId = 0;
  routes = {};
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const handler = routes[url];
    if (!handler) return json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
    return handler(init);
  });
  window.addEventListener('c4s:toast', onToast);
  host = document.createElement('div');
  root = createRoot(host);
  view = document.createElement('div');
  viewRoot = createRoot(view);
});

afterEach(() => {
  act(() => viewRoot.unmount());
  act(() => root.unmount());
  window.removeEventListener('c4s:toast', onToast);
  vi.unstubAllGlobals();
});

const textOf = (m: ChatMessageType) => m.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
const transcript = () => hook.messages.map((m) => `${m.role}:${textOf(m)}`);
const blocksOf = (m: ChatMessageType | undefined) => m?.blocks ?? [];
const carriers = () =>
  hook.messages.flatMap((m) =>
    m.blocks.filter((b): b is Extract<UIContentBlock, { type: 'toolUse' }> => b.type === 'toolUse' && b.toolName === BACKGROUND_TASK_TOOL_NAME),
  );
const joinCalls = (tid: string) => calls.filter((c) => c.url === CHAT_ENDPOINTS.streamByThread(tid));
const turnStart = (prompt: string, ids = { userMessageId: 'u2', assistantMessageId: 'a2' }) => ({
  ...ids,
  prompt,
  timestamp: '2026-10-27T10:00:10.000Z',
  turnStartedAt: '2026-10-27T10:00:10.000Z',
});

/** Two finished turns, the second one's answer included. */
const finishedHistory = () => [
  row('user', { text: 'first question' }),
  row('assistant', { text: 'first answer' }),
  row('user', { text: 'second question' }),
  row('assistant', { text: 'second answer' }),
];

// --- resume and join --------------------------------------------------------

describe('resume after reload, thread switch and cold start', () => {
  it('[ac:ac-po-odswiezeniu-przegladarki-overlay-o] after a browser refresh the overlay restores the full message history of the active thread', async () => {
    routes['/api/threads/t1'] = () => json({ data: detail({ messages: finishedHistory() }) });
    await mount(baseOpts({ threadId: 't1' }));

    expect(transcript()).toEqual([
      'user:first question',
      'assistant:first answer',
      'user:second question',
      'assistant:second answer',
    ]);
    // No live turn → no join.
    expect(joinCalls('t1')).toHaveLength(0);
    expect(hook.isStreaming).toBe(false);
  });

  it('[ac:ac-po-odpowiedzi-404-not-found-na-dolacz] when joining a turn that already finished answers 404 NOT_FOUND, the overlay shows the full thread history from the database', async () => {
    // `isLive` was true at read time; the turn ended before the join landed.
    routes['/api/threads/t1'] = () => json({ data: detail({ isLive: true, messages: finishedHistory() }) });
    // No stream route → the fake network answers 404 NOT_FOUND.
    await mount(baseOpts({ threadId: 't1' }));

    expect(joinCalls('t1')).toHaveLength(1);
    // Not the history cut above the last user message — all of it.
    expect(transcript()).toEqual([
      'user:first question',
      'assistant:first answer',
      'user:second question',
      'assistant:second answer',
    ]);
    expect(hook.isResuming).toBe(false);
    expect(hook.isStreaming).toBe(false);
  });

  it('[ac:ac-po-f5-ui-pokazuje-pelna-tresc-trwajac] after F5 mid-turn the UI shows the whole turn from its last merged dispatch — deltas, tool cards, delegation panel, background-task block — not a turn cut at the last user message', async () => {
    const join = sse();
    routes['/api/threads/t1'] = () =>
      json({
        data: detail({
          isLive: true,
          messages: [
            row('user', { text: 'first question' }),
            row('assistant', { text: 'first answer' }),
            // The running turn: its rows are already persisted, and the replay
            // brings them again — the RESTORE cut must leave them out.
            row('user', { text: 'second question' }),
            row('assistant', { text: 'working on it' }),
          ],
        }),
      });
    routes[CHAT_ENDPOINTS.streamByThread('t1')] = () => stream(join);
    await mount(baseOpts({ threadId: 't1' }));

    // Before the replay: history up to (not including) the running turn's user row.
    expect(transcript()).toEqual(['user:first question', 'assistant:first answer']);
    expect(hook.isResuming).toBe(true);

    await emit(join, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(join, 'turn_start', turnStart('second question'));
    await emit(join, 'text_delta', { text: 'working on it', isSubagent: false });
    await emit(join, 'tool_use', { toolUseId: 'tu1', toolName: 'Read', input: { file_path: 'a.md' }, isSubagent: false });
    await emit(join, 'tool_result', { toolUseId: 'tu1', summary: 'contents', isSubagent: false });
    await emit(join, 'subagent_started', { taskId: 'sub1', description: 'Explore the spec', toolUseId: 'tu2' });
    await emit(join, 'background_task_started', { taskId: 'bg1', taskType: 'shell', description: 'npm run build' });

    // The running turn's user message once (from `turn_start`), then its full content.
    expect(hook.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(textOf(hook.messages[2]!)).toBe('second question');
    const turn = blocksOf(hook.messages[3]);
    expect(turn.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')).toBe('working on it');
    expect(turn.some((b) => b.type === 'toolUse' && b.toolName === 'Read')).toBe(true);
    expect(turn.some((b) => b.type === 'subagent' && b.taskId === 'sub1')).toBe(true);
    expect(carriers().map((c) => c.toolUseId)).toEqual(['bgtask-bg1']);
    expect(hook.isStreaming).toBe(true);

    const shown = renderTranscript();
    expect(shown.textContent).toContain('working on it');
    expect(shown.textContent).toContain('Explore the spec');
    expect(shown.textContent).toContain('background · shell');
  });

  it('[ac:ac-po-f5-ui-pokazuje-pelna-tresc-trwajac] a live-join whose replay was trimmed (`connected.replayTruncated`) tells the user the replay is incomplete; an untrimmed join says nothing', async () => {
    const join = sse();
    routes['/api/threads/t1'] = () =>
      json({ data: detail({ isLive: true, messages: [row('user', { text: 'long task' })] }) });
    routes[CHAT_ENDPOINTS.streamByThread('t1')] = () => stream(join);
    await mount(baseOpts({ threadId: 't1' }));

    expect(joinCalls('t1')).toHaveLength(1);
    await emit(join, 'connected', { requestId: 'r1', threadId: 't1', replayTruncated: true });
    await emit(join, 'turn_start', turnStart('long task'));
    await emit(join, 'text_delta', { text: 'partial replay', isSubagent: false });

    const notices = toasts.filter((t) => t.message === 'Replay incomplete — full content will load once the turn finishes.');
    expect(notices).toEqual([expect.objectContaining({ variant: 'warning' })]);
    // The trimmed replay still drives the transcript; the notice does not replace it.
    expect(transcript()).toEqual(['user:long task', 'assistant:partial replay']);
  });

  it('[ac:ac-po-f5-ui-pokazuje-pelna-tresc-trwajac] a live-join without `replayTruncated` raises no incomplete-replay notice', async () => {
    const join = sse();
    routes['/api/threads/t1'] = () =>
      json({ data: detail({ isLive: true, messages: [row('user', { text: 'long task' })] }) });
    routes[CHAT_ENDPOINTS.streamByThread('t1')] = () => stream(join);
    await mount(baseOpts({ threadId: 't1' }));

    await emit(join, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(join, 'turn_start', turnStart('long task'));

    expect(toasts.some((t) => t.message.startsWith('Replay incomplete'))).toBe(false);
  });

  it('[ac:ac-tura-czysto-tekstowa-wznawia-sie-po-f] F5 in a turn that has not called any tool yet (pure text) resumes like a turn with tool calls — the join does not depend on a row with status streaming', async () => {
    const join = sse();
    routes['/api/threads/t1'] = () =>
      json({ data: detail({ isLive: true, messages: [row('user', { text: 'just talk' }, { status: 'complete' })] }) });
    routes[CHAT_ENDPOINTS.streamByThread('t1')] = () => stream(join);
    await mount(baseOpts({ threadId: 't1' }));

    // No row is `streaming`, and still the client joins — on `isLive` alone.
    expect(joinCalls('t1')).toHaveLength(1);
    await emit(join, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(join, 'turn_start', turnStart('just talk'));
    await emit(join, 'text_delta', { text: 'Thinking out loud', isSubagent: false });

    expect(transcript()).toEqual(['user:just talk', 'assistant:Thinking out loud']);
    expect(hook.isStreaming).toBe(true);
  });

  it('[ac:ac-przelaczenie-watku-a-b-podczas-stream] switching thread A→B during A\'s stream closes only the client\'s own connection to A, without calling abort', async () => {
    const joinA = sse();
    routes['/api/threads/tA'] = () => json({ data: detail({ id: 'tA', isLive: true, messages: [row('user', { text: 'in A' })] }) });
    routes['/api/threads/tB'] = () => json({ data: detail({ id: 'tB', messages: [row('user', { text: 'in B' })] }) });
    routes[CHAT_ENDPOINTS.streamByThread('tA')] = () => stream(joinA);
    routes[CHAT_ENDPOINTS.abort] = () => json({});
    await mount(baseOpts({ threadId: 'tA' }));
    await emit(joinA, 'connected', { requestId: 'rA', threadId: 'tA' });
    await emit(joinA, 'turn_start', turnStart('in A'));
    const connA = joinCalls('tA')[0]!;
    expect(connA.init?.signal?.aborted).toBe(false);

    await mount(baseOpts({ threadId: 'tB' }));

    expect(connA.init?.signal?.aborted).toBe(true);
    expect(calls.some((c) => c.url === CHAT_ENDPOINTS.abort)).toBe(false);
    expect(transcript()).toEqual(['user:in B']);
  });

  it('[ac:ac-przelaczenie-watku-a-b-a-przywraca-zy] switching A→B→A brings A\'s live stream back while its turn still runs — the trigger is the thread having a live turn (`isLive`), and the replay covers the turn', async () => {
    const joins = [sse(), sse()];
    let joinIdx = 0;
    routes['/api/threads/tA'] = () => json({ data: detail({ id: 'tA', isLive: true, messages: [row('user', { text: 'in A' })] }) });
    routes['/api/threads/tB'] = () => json({ data: detail({ id: 'tB', messages: [] }) });
    routes[CHAT_ENDPOINTS.streamByThread('tA')] = () => stream(joins[joinIdx++]!);
    await mount(baseOpts({ threadId: 'tA' }));
    await mount(baseOpts({ threadId: 'tB' }));
    expect(hook.isStreaming).toBe(false);

    await mount(baseOpts({ threadId: 'tA' }));

    expect(joinCalls('tA')).toHaveLength(2);
    const rejoin = joins[1]!;
    await emit(rejoin, 'connected', { requestId: 'rA', threadId: 'tA' });
    await emit(rejoin, 'turn_start', turnStart('in A'));
    await emit(rejoin, 'text_delta', { text: 'still going', isSubagent: false });
    expect(transcript()).toEqual(['user:in A', 'assistant:still going']);
    expect(hook.isStreaming).toBe(true);
  });

  it('[section:oo8qeekf] a mid-turn push cuts the running turn in the middle: the question already restored from the cut prefix is claimed, so the replay does not synthesize a second card', async () => {
    const join = sse();
    const request: UserInputRequest = {
      requestId: 'q1',
      source: 'model-tool',
      origin: 'claude-code',
      questions: [{ question: 'Which module?', options: [{ label: 'M05' }, { label: 'M53' }] }],
    };
    routes['/api/threads/t1'] = () =>
      json({
        data: detail({
          isLive: true,
          messages: [
            row('user', { text: 'go' }),
            row('user_input_request', request, { toolId: 'q1' }),
            row('user_input_response', { action: 'accept', answers: [['M53']] }, { toolId: 'q1' }),
            // Pushed mid-turn: the last `user` row now sits INSIDE the running turn.
            row('user', { text: 'pushed while it worked' }),
          ],
        }),
      });
    routes[CHAT_ENDPOINTS.streamByThread('t1')] = () => stream(join);
    await mount(baseOpts({ threadId: 't1' }));
    await emit(join, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(join, 'turn_start', turnStart('go'));
    // The replay buffer still carries the (answered) question.
    await emit(join, 'user_input_request', { request, resolved: true, response: { action: 'accept', answers: [['M53']] } });

    const cards = hook.messages.flatMap((m) => m.blocks).filter((b) => b.type === 'toolUse' && b.toolName === USER_INPUT_TOOL_NAME);
    expect(cards).toHaveLength(1);
    expect(hook.pendingUserInputs).toEqual([]);
  });
});

// --- indicators and hold ends -----------------------------------------------

describe('turn indicators and hold endings', () => {
  it('[ac:ac-spinner-holdu-wraca-po-f5-nad-zywa-tu] the hold spinner comes back after F5 over a live turn — N is rebuilt from the persisted `running` rows, not from the server process memory', async () => {
    const join = sse();
    routes['/api/threads/t1'] = () =>
      json({
        data: detail({
          isLive: true,
          messages: [row('user', { text: 'build it' })],
          backgroundTasks: [bgRow({ taskId: 'bg1' }), bgRow({ taskId: 'bg0', status: 'completed', createdAt: '2026-10-27 10:00:01' })],
        }),
      });
    routes[CHAT_ENDPOINTS.streamByThread('t1')] = () => stream(join);
    await mount(baseOpts({ threadId: 't1' }));

    // From the rows alone — nothing has come off the stream yet.
    expect(hook.heldBackgroundTaskCount).toBe(1);

    await emit(join, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(join, 'turn_start', turnStart('build it'));
    await emit(join, 'result', { output: '', usage: { inputTokens: 1, outputTokens: 1 }, contextSize: 2 });
    // The replayed `_started` of the same task does not count it twice.
    await emit(join, 'background_task_started', { taskId: 'bg1', taskType: 'shell', description: 'npm run build' });

    expect(hook.isParked).toBe(true);
    expect(hook.heldBackgroundTaskCount).toBe(1);
    expect(hook.busyIndicator).toBe('background');
  });

  it('[ac:ac-wskaznik-holdu-pokazuje-wygasniecie-s] the hold indicator shows the hold cap expiring as its own state — apart from a user abort, the idle watchdog stop and the timeoutMs backstop — worded from the abandoned-work counters', async () => {
    const turn = sse();
    routes[CHAT_ENDPOINTS.chat] = () => stream(turn);
    await mount(baseOpts());
    await send();
    await emit(turn, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(turn, 'turn_start', turnStart('hello', { userMessageId: 'u1', assistantMessageId: 'a1' }));
    await emit(turn, 'background_task_started', { taskId: 'bg1', taskType: 'shell', description: 'sleep 900' });
    await emit(turn, 'result', { output: '', usage: { inputTokens: 1, outputTokens: 1 }, contextSize: 2 });
    expect(hook.busyIndicator).toBe('background');

    const fromCounters = 'background hold expired after 300000ms with 1 background task(s) and 1 subagent delegation(s) still running';
    await emit(turn, 'error', { error: fromCounters, code: 'BACKGROUND_HOLD_EXPIRED' });
    await emit(turn, 'done', {});

    expect(hook.holdEnding?.kind).toBe('hold-expired');
    // The server's counters — a delegation included, which the client's own
    // registry does not count — make the line.
    expect(holdEndingLabel(hook.holdEnding!)).toBe(fromCounters);
    expect(hook.heldBackgroundTaskCount).toBe(0);
    expect(hook.backgroundTasks[0]?.status).toBe('abandoned');

    // Each of the other three ends reads differently from the hold cap.
    const others = (['user-abort', 'went-silent', 'backstop-expired'] as const).map((kind) =>
      holdEndingLabel({ kind, abandoned: 1 }),
    );
    expect(new Set([...others, holdEndingLabel(hook.holdEnding!)]).size).toBe(4);
  });

  it('[ac:ac-wskaznik-holdu-pokazuje-wygasniecie-s] a hold kept only by a delegation still ends on the hold-cap line, with the delegation counted', async () => {
    const turn = sse();
    routes[CHAT_ENDPOINTS.chat] = () => stream(turn);
    await mount(baseOpts());
    await send();
    await emit(turn, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(turn, 'turn_start', turnStart('hello', { userMessageId: 'u1', assistantMessageId: 'a1' }));
    await emit(turn, 'subagent_started', { taskId: 'sub1', description: 'Explore', toolUseId: 'tu1' });
    await emit(turn, 'result', { output: '', usage: { inputTokens: 1, outputTokens: 1 }, contextSize: 2 });
    await emit(turn, 'error', {
      error: 'background hold expired after 300000ms with 1 subagent delegation(s) still running',
      code: 'BACKGROUND_HOLD_EXPIRED',
    });
    await emit(turn, 'done', {});

    expect(hook.holdEnding?.kind).toBe('hold-expired');
    expect(holdEndingLabel(hook.holdEnding!)).toContain('1 subagent delegation(s) still running');
  });

  it('[ac:ac-strumien-odmowy-polityki-overlay-poka] a policy-refusal stream (one TOOL_POLICY_REFUSED error, then done) shows as a refusal error, not as a turn waiting for content', async () => {
    const turn = sse();
    routes[CHAT_ENDPOINTS.chat] = () => stream(turn);
    await mount(baseOpts());
    await send();
    expect(streamingBubbleVisible(hook)).toBe(true);

    await emit(turn, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(turn, 'error', {
      error: 'tool policy not enforceable on this architecture: delegation',
      code: 'TOOL_POLICY_REFUSED',
    });
    await emit(turn, 'done', {});

    expect(toasts).toContainEqual(
      expect.objectContaining({ variant: 'error', message: 'Turn refused — tool policy not enforceable on this architecture: delegation' }),
    );
    // Nothing is left waiting: no streaming bubble, no clock, no busy indicator.
    expect(hook.isStreaming).toBe(false);
    expect(streamingBubbleVisible(hook)).toBe(false);
    expect(hook.turnStartedAt).toBeNull();
    expect(hook.busyIndicator).toBe('none');
  });

  it('[ac:ac-przy-503-agent-unavailable-z-powodu-b] on AGENT_UNAVAILABLE for a missing CLI the overlay shows "Claude CLI not found or not logged in. Run `claude login` first."', async () => {
    const turn = sse();
    routes[CHAT_ENDPOINTS.chat] = () => stream(turn);
    await mount(baseOpts());
    await send();
    await emit(turn, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(turn, 'error', { error: 'Claude CLI not found or not logged in. Run `claude login` first.', code: 'AGENT_UNAVAILABLE' });
    await emit(turn, 'done', {});

    expect(toasts).toContainEqual({
      variant: 'error',
      message: 'Claude CLI not found or not logged in. Run `claude login` first.',
    });
    expect(hook.isStreaming).toBe(false);
  });
});

// --- blocks of the turn -----------------------------------------------------

describe('blocks of the turn', () => {
  it('[ac:ac-blok-listy-zadan-modelu-aktualizuje-s] the model task-list block follows each list the turn delivers: a `Task*` per-item update changes that item and keeps the rest, a legacy `TodoWrite` replaces the whole list', async () => {
    const turn = sse();
    routes[CHAT_ENDPOINTS.chat] = () => stream(turn);
    await mount(baseOpts());
    await send();
    await emit(turn, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(turn, 'turn_start', turnStart('hello', { userMessageId: 'u1', assistantMessageId: 'a1' }));

    const item = (id: string, content: string, status: TodoItem['status']): TodoItem => ({ id, content, status });
    /** The block's rows, opened. */
    const shown = () => {
      act(() => viewRoot.render(createElement(CurrentTodoList, { items: hook.currentTodoItems })));
      const toggle = view.querySelector('button[aria-expanded]') as HTMLButtonElement;
      if (toggle.getAttribute('aria-expanded') !== 'true') act(() => toggle.click());
      return [...view.querySelectorAll('li')].map((li) => li.textContent);
    };

    await emit(turn, 'todo_list_updated', {
      items: [item('1', 'Read the spec', 'in_progress'), item('2', 'Write the tests', 'pending')],
      source: 'model-tool',
      isSubagent: false,
    });
    expect(shown()).toEqual(['▶Read the spec', '○Write the tests']);

    // `TaskUpdate` of item 1: the list arrives with that item changed and item 2 kept.
    await emit(turn, 'todo_list_updated', {
      items: [item('1', 'Read the spec', 'completed'), item('2', 'Write the tests', 'pending')],
      source: 'model-tool',
      isSubagent: false,
    });
    expect(shown()).toEqual(['✓Read the spec', '○Write the tests']);

    // `TodoWrite`: the whole list is replaced.
    await emit(turn, 'todo_list_updated', { items: [item('9', 'Ship it', 'pending')], source: 'model-tool', isSubagent: false });
    expect(shown()).toEqual(['○Ship it']);
  });

  it('[ac:ac-zadania-w-tle-renderuja-sie-w-turze-j] background tasks render in the turn as their own "Background tasks" block, never as a child of the `tool_use` card', async () => {
    const turn = sse();
    routes[CHAT_ENDPOINTS.chat] = () => stream(turn);
    await mount(baseOpts());
    await send();
    await emit(turn, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(turn, 'turn_start', turnStart('hello', { userMessageId: 'u1', assistantMessageId: 'a1' }));
    await emit(turn, 'tool_use', { toolUseId: 'tu1', toolName: 'Bash', input: { command: 'npm run build', run_in_background: true }, isSubagent: false });
    await emit(turn, 'tool_result', { toolUseId: 'tu1', summary: 'started', isSubagent: false });
    await emit(turn, 'background_task_started', { taskId: 'bg1', taskType: 'shell', description: 'npm run build' });

    const blocks = blocksOf(hook.messages[1]);
    const bash = blocks.find((b) => b.type === 'toolUse' && b.toolName === 'Bash');
    const block = blocks.find((b) => b.type === 'toolUse' && b.toolName === BACKGROUND_TASK_TOOL_NAME);
    // A block of the turn of its own, next to the call — not inside it.
    expect(bash).toBeDefined();
    expect(block).toBeDefined();
    expect(JSON.stringify(bash)).not.toContain('bg1');

    const shown = renderTranscript();
    expect(shown.textContent).toContain('background · shell');
    expect(shown.textContent).toContain('npm run build');
  });

  it('[ac:ac-zdarzenie-user-input-request-renderuj] a `user_input_request` event renders in the chat as an interactive question form', async () => {
    const turn = sse();
    routes[CHAT_ENDPOINTS.chat] = () => stream(turn);
    await mount(baseOpts());
    await send();
    await emit(turn, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(turn, 'turn_start', turnStart('hello', { userMessageId: 'u1', assistantMessageId: 'a1' }));
    const request: UserInputRequest = {
      requestId: 'q1',
      source: 'model-tool',
      origin: 'claude-code',
      questions: [{ question: 'Which module?', options: [{ label: 'M05' }, { label: 'M53' }] }],
    };
    await emit(turn, 'user_input_request', { request });

    expect(hook.pendingUserInputs.map((r) => r.requestId)).toEqual(['q1']);
    const submit = vi.fn();
    act(() => viewRoot.render(createElement(UserInputRequestCard, { request: hook.pendingUserInputs[0]!, onSubmit: submit })));
    expect(view.textContent).toContain('Which module?');
    const option = [...view.querySelectorAll('button')].find((b) => b.textContent === 'M53')!;
    const sendAnswer = [...view.querySelectorAll('button')].find((b) => b.textContent?.includes('Send answer'))!;
    expect(view.querySelector('textarea')).not.toBeNull();
    expect(sendAnswer.disabled).toBe(true);
    act(() => option.click());
    expect(sendAnswer.disabled).toBe(false);
    act(() => sendAnswer.click());
    expect(submit).toHaveBeenCalledWith('q1', { action: 'accept', answers: [['M53']] });
  });
});

// --- after a reload ---------------------------------------------------------

describe('reconstruction after a reload', () => {
  it('[ac:ac-blok-zadania-w-tle-przezywa-przeladow] the "Background tasks" block survives a page reload — after F5 on a finished turn the task is still visible in the thread history', async () => {
    routes['/api/threads/t1'] = () =>
      json({
        data: detail({
          messages: [row('user', { text: 'build it' }), row('assistant', { text: 'started the build' }), row('assistant', { text: 'done' })],
          backgroundTasks: [bgRow({ status: 'completed', summary: 'built in 12s', createdAt: '2026-10-27 10:00:02' })],
        }),
      });
    await mount(baseOpts({ threadId: 't1' }));

    expect(carriers().map((c) => c.toolUseId)).toEqual(['bgtask-bg1']);
    const shown = renderTranscript();
    expect(shown.textContent).toContain('background · shell');
    expect(shown.textContent).toContain('npm run build');
    expect(shown.textContent).toContain('built in 12s');
  });

  it('[ac:ac-zadanie-w-tle-o-statusie-abandoned-re] a background task with status `abandoned` renders after a reload as abandoned, not as running', async () => {
    routes['/api/threads/t1'] = () =>
      json({
        data: detail({
          messages: [row('user', { text: 'build it' }), row('assistant', { text: 'started the build' })],
          backgroundTasks: [bgRow({ status: 'abandoned' })],
        }),
      });
    await mount(baseOpts({ threadId: 't1' }));

    expect(hook.heldBackgroundTaskCount).toBe(0);
    const shown = renderTranscript();
    expect(shown.textContent).toContain('abandoned');
    expect(shown.textContent).not.toContain('running');
    expect(shown.querySelector('[data-elapsed-clock]')).toBeNull();
  });

  it('[ac:ac-po-przeladowaniu-watku-karta-delegacj] after a thread reload a delegation cut before `subagent_completed` does not show `running`', async () => {
    const sub = (status: ChatSubagentTask['status']): ChatSubagentTask => ({
      threadId: 't1',
      taskId: 'sub1',
      toolUseId: 'tu1',
      description: 'Explore the spec',
      status,
      summary: null,
      createdAt: '2026-10-27 10:00:02',
      updatedAt: '2026-10-27 10:05:02',
    });
    const messages = () => [
      row('user', { text: 'delegate' }),
      row('tool_use', { input: { subagent_type: 'Explore', description: 'Explore the spec', prompt: 'look' } }, { toolName: 'Agent', toolId: 'tu1' }),
      row('assistant', { text: 'reading…' }, { subagentTaskId: 'sub1' }),
    ];

    // The finalizer's `abandoned` row.
    routes['/api/threads/t1'] = () => json({ data: detail({ messages: messages(), subagentTasks: [sub('abandoned')] }) });
    await mount(baseOpts({ threadId: 't1' }));
    let shown = renderTranscript();
    expect(shown.textContent).toContain('interrupted');
    expect(shown.querySelector('[title="running"]')).toBeNull();

    // A row still `running` (finalizer not yet through) on a turn that is over.
    routes['/api/threads/t2'] = () => json({ data: detail({ id: 't2', messages: messages(), subagentTasks: [sub('running')] }) });
    await mount(baseOpts({ threadId: 't2' }));
    shown = renderTranscript();
    expect(shown.textContent).toContain('interrupted');
    expect(shown.querySelector('[title="running"]')).toBeNull();
  });

  it('[ac:ac-po-przeladowaniu-pytanie-agenta-i-odp] after a reload the agent\'s question and the user\'s answer show in the thread history as a read-only card', async () => {
    const request: UserInputRequest = {
      requestId: 'q1',
      source: 'model-tool',
      origin: 'claude-code',
      questions: [{ question: 'Which module?', options: [{ label: 'M05' }, { label: 'M53' }] }],
    };
    routes['/api/threads/t1'] = () =>
      json({
        data: detail({
          messages: [
            row('user', { text: 'ask me' }),
            row('user_input_request', request, { toolId: 'q1' }),
            row('user_input_response', { action: 'accept', answers: [['M53']] }, { toolId: 'q1' }),
          ],
        }),
      });
    await mount(baseOpts({ threadId: 't1' }));

    expect(hook.pendingUserInputs).toEqual([]);
    const shown = renderTranscript();
    expect(shown.textContent).toContain('Which module?');
    expect(shown.textContent).toContain('accept');
    // Open it: the answer is listed, and nothing on the card answers anything.
    act(() => ([...shown.querySelectorAll('button')].find((b) => b.textContent?.includes('user question')) as HTMLButtonElement).click());
    expect(shown.textContent).toContain('M53');
    expect(shown.querySelector('textarea')).toBeNull();
    expect([...shown.querySelectorAll('button')].some((b) => /Send answer|Decline|Cancel/.test(b.textContent ?? ''))).toBe(false);
  });

  it('[ac:ac-na-user-input-request-odtworzone-z-hi] a `user_input_request` restored from history after a reload cannot be answered — the client has no key to the pending resolver — and the only way to close it is aborting the stream from the UI', async () => {
    const join = sse();
    const request: UserInputRequest = {
      requestId: 'q1',
      source: 'model-tool',
      origin: 'claude-code',
      questions: [{ question: 'Proceed?' }],
    };
    routes['/api/threads/t1'] = () =>
      json({
        data: detail({
          isLive: true,
          messages: [
            row('user', { text: 'first' }),
            // Asked, never answered, in the part of history restored from rows.
            row('user_input_request', request, { toolId: 'q1' }),
            row('user', { text: 'pushed mid-turn' }),
          ],
        }),
      });
    routes[CHAT_ENDPOINTS.streamByThread('t1')] = () => stream(join);
    routes[CHAT_ENDPOINTS.abort] = () => json({});
    await mount(baseOpts({ threadId: 't1' }));
    await emit(join, 'connected', { requestId: 'r1', threadId: 't1' });
    await emit(join, 'turn_start', turnStart('first'));
    // The replayed copy, annotated as no longer answerable.
    await emit(join, 'user_input_request', { request, resolved: true, response: null });

    // No live form: the history card shows it pending, read-only.
    expect(hook.pendingUserInputs).toEqual([]);
    const shown = renderTranscript();
    expect(shown.textContent).toContain('pending');
    expect(shown.querySelector('textarea')).toBeNull();
    expect([...shown.querySelectorAll('button')].some((b) => /Send answer/.test(b.textContent ?? ''))).toBe(false);

    // Stop is what closes it.
    await act(async () => {
      hook.abort();
      await flush();
    });
    const abortCall = calls.find((c) => c.url === CHAT_ENDPOINTS.abort);
    expect(JSON.parse(String(abortCall?.init?.body))).toEqual({ requestId: 'r1' });
    expect(hook.isStreaming).toBe(false);
  });
});
