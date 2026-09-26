// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { UIContentBlock } from '@inharness-ai/agent-chat';
import { StreamingBubble } from './StreamingBubble.js';
import { BackgroundTaskPanel } from './BackgroundTaskPanel.js';
import { SubagentPanel } from './SubagentPanel.js';
import { TransagentPanel } from './TransagentPanel.js';
import { applyBackgroundTaskStarted, backgroundTaskEntryFromRow, type BackgroundTaskEntry } from './useChat.js';

/**
 * 0.2.114: the work clock on screen — next to the streaming bubble, in the
 * background-task row, in the subagent card header and in the transagent
 * panel header. Ticks once a second, never inside a live region.
 */

// TransagentPanel's nested live-join: capture its onEvent so the test can play
// the child's replayed `turn_start` and `done`.
const child = vi.hoisted(() => ({ onEvent: null as ((e: Record<string, unknown>) => void) | null }));
vi.mock('@inharness-ai/agent-chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@inharness-ai/agent-chat')>()),
  useMessageReducer: () => ({
    state: { messages: [] },
    handleWireEvent: () => {},
    restoreMessages: () => {},
    clear: () => {},
  }),
  useEventStream: (opts: { onEvent: (e: Record<string, unknown>) => void }) => {
    child.onEvent = opts.onEvent;
    return { joinStream: () => new Promise<boolean>(() => {}), disconnect: () => {} };
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse('2026-09-25T10:13:26.000Z');
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const render = (el: ReturnType<typeof createElement>) => act(() => root.render(el));
const clock = () => host.querySelector('[data-elapsed-clock]')?.textContent ?? null;
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

const task = (over: Partial<BackgroundTaskEntry> = {}): BackgroundTaskEntry => ({
  taskId: 'bg1',
  taskType: 'shell',
  description: 'npm run build',
  status: 'running',
  outputFile: null,
  summary: null,
  startedAt: NOW - 83_000,
  ...over,
});

describe('streaming bubble clock', () => {
  it('[ac:ac-obok-banki-streaming-widac-zegar-tury] shows the turn clock next to the bubble, growing every second', () => {
    render(createElement(StreamingBubble, { turnStartedAt: NOW - 83_000 }));
    expect(host.textContent).toContain('streaming');
    expect(clock()).toBe('1:23');
    tick(1000);
    expect(clock()).toBe('1:24');
    tick(2000);
    expect(clock()).toBe('1:26');
  });

  it('[ac:ac-tykniecia-zegara-tury-nie-sa-oglaszan] the clock sits outside the aria-live region, whose label is unchanged', () => {
    render(createElement(StreamingBubble, { turnStartedAt: NOW - 5_000 }));
    const live = host.querySelector('[aria-live]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('aria-label')).toBe('Agent is streaming');
    expect(live.querySelector('[data-elapsed-clock]')).toBeNull();
    expect(host.querySelector('[data-elapsed-clock]')!.closest('[aria-live]')).toBeNull();
  });

  it('a joiner before the replayed turn_start shows the bubble without a clock', () => {
    render(createElement(StreamingBubble, { turnStartedAt: null }));
    expect(host.textContent).toContain('streaming');
    expect(clock()).toBeNull();
  });
});

describe('background task row clock', () => {
  it('[ac:ac-wiersz-zadania-w-tle-o-statusie-runni] a running row shows the clock from the task start', () => {
    render(createElement(BackgroundTaskPanel, { entry: task() }));
    expect(clock()).toBe('1:23');
    tick(1000);
    expect(clock()).toBe('1:24');
  });

  it('[ac:ac-wiersz-zadania-w-tle-o-statusie-innym] a row with any other status shows no clock', () => {
    for (const status of ['success', 'failed', 'abandoned']) {
      render(createElement(BackgroundTaskPanel, { entry: task({ status }) }));
      expect(host.textContent).toContain(status);
      expect(clock()).toBeNull();
    }
  });

  it('[ac:ac-po-f5-zegar-zywego-zadania-w-tle-licz] after F5 the clock counts from the row created_at, not from the replayed _started', () => {
    // Cold load first (raw SQLite UTC), then the replay's `_started` at reload time.
    const cold = [
      backgroundTaskEntryFromRow({
        threadId: 't1',
        taskId: 'bg1',
        taskType: 'shell',
        description: 'npm run build',
        status: 'running',
        outputFile: null,
        summary: null,
        createdAt: '2026-09-25 10:12:03',
        updatedAt: '2026-09-25 10:12:03',
      }),
    ];
    const [entry] = applyBackgroundTaskStarted(cold, { taskId: 'bg1', taskType: 'shell', description: 'npm run build' }, NOW);
    expect(entry!.startedAt).toBe(Date.parse('2026-09-25T10:12:03.000Z'));
    render(createElement(BackgroundTaskPanel, { entry: entry! }));
    expect(clock()).toBe('1:23');
  });

  it('a live _started with no prior entry starts the clock at receipt', () => {
    const [entry] = applyBackgroundTaskStarted([], { taskId: 'bg2', taskType: 'shell', description: 'x' }, NOW);
    expect(entry!.startedAt).toBe(NOW);
  });
});

describe('subagent card clock', () => {
  const block = (status: string) =>
    ({ type: 'subagent', taskId: 'sub_1', toolUseId: 'tq', description: 'Explore M05', status, messages: [] }) as Extract<
      UIContentBlock,
      { type: 'subagent' }
    >;

  it('[ac:ac-karta-podagenta-w-stanie-running-poka] a running card shows the clock in its header, collapsed', () => {
    render(createElement(SubagentPanel, { block: block('running'), startedAt: NOW - 7_000 }));
    // Starts collapsed — the header is all there is.
    expect(host.querySelector('button')!.querySelector('[data-elapsed-clock]')?.textContent).toBe('0:07');
    tick(1000);
    expect(clock()).toBe('0:08');
  });

  it('any other status hides it', () => {
    render(createElement(SubagentPanel, { block: block('completed'), startedAt: NOW - 7_000 }));
    expect(clock()).toBeNull();
    render(createElement(SubagentPanel, { block: block('running'), startedAt: NOW - 7_000, turnOpen: false }));
    expect(clock()).toBeNull();
  });
});

describe('transagent panel clock (M46)', () => {
  it("[ac:ac-naglowek-panelu-banki-pokazuje-zegar] the header shows the child turn's clock while it runs", () => {
    render(
      createElement(TransagentPanel, {
        entry: { toolUseId: 'tu1', childThreadId: 'child-1', contextType: 'brief', status: 'running' },
        model: 'opus',
      }),
    );
    expect(clock()).toBeNull();
    act(() =>
      child.onEvent!({
        type: 'turn_start',
        userMessageId: 'cu',
        assistantMessageId: 'ca',
        prompt: 'child',
        timestamp: '2026-09-25T10:13:00.000Z',
        turnStartedAt: '2026-09-25T10:13:00.000Z',
      }),
    );
    expect(host.querySelector('button')!.querySelector('[data-elapsed-clock]')?.textContent).toBe('0:26');
    tick(1000);
    expect(clock()).toBe('0:27');
    act(() => child.onEvent!({ type: 'done' }));
    expect(clock()).toBeNull();
  });
});
