// @vitest-environment happy-dom
/**
 * M53 (Agent Chat Shell) — the turn's blocks as the message list renders them
 * (`yekka16t`, `m05batch`, `5615w04d`, `rehyxchp`): thinking, tool cards and
 * their batches, the adapter's runtime warning, and an entity tag in a user
 * message. Blocks go through `batchToolBlocks` exactly as `<ChatOverlay />`
 * hands them to `<BlockRenderer />`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { batchToolBlocks, type UIContentBlock } from '@inharness-ai/agent-chat';

vi.mock('../entities/registry.js', () => ({
  getEntityDef: (t: string) => (t === 'endpoint' ? { type: 'endpoint' } : null),
}));
// The type's chip, reduced to what it shows: the slug it resolves.
vi.mock('../entities/ChipResolver.js', () => ({
  ChipResolver: ({ slug }: { slug: string }) => createElement('span', { 'data-chip': slug }, slug),
}));

import { BlockRenderer } from './BlockRenderer.js';
import { getRenderer } from './toolRenderers.js';
import { WARNING_TOOL_NAME, rowsToChatMessages } from './useChat.js';
import type { ChatMessage } from '../../shared/entities.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  act(() => root.render(createElement(QueryClientProvider, { client: qc }, node)));
}

/** One message's blocks, batched and rendered the way the overlay does it. */
function renderMessage(blocks: UIContentBlock[], side: 'user' | 'assistant' = 'assistant') {
  const shown = batchToolBlocks(blocks);
  render(
    createElement(
      'div',
      null,
      shown.map((block, i) => createElement(BlockRenderer, { key: i, block, siblings: shown, side, model: 'opus-5.5' })),
    ),
  );
  return shown;
}

const use = (id: string, toolName: string, input: unknown = {}): UIContentBlock => ({
  type: 'toolUse',
  toolUseId: id,
  toolName,
  input,
  collapsed: true,
});
const result = (id: string, content = '"ok"', isError = false): UIContentBlock => ({
  type: 'toolResult',
  toolUseId: id,
  content,
  isError,
  collapsed: true,
});

const buttons = () => [...host.querySelectorAll('button')];
const expanders = () => buttons().filter((b) => b.hasAttribute('aria-expanded'));
const click = (el: Element | undefined | null) => {
  expect(el).toBeTruthy();
  act(() => (el as HTMLElement).click());
};

describe('turn blocks', () => {
  it('[ac:ac-bloki-extended-thinking-sa-renderowan] an extended-thinking block renders as a ThinkingBlock the user collapses and expands, as plain text', () => {
    renderMessage([{ type: 'thinking', text: 'weighing **options**', isStreaming: false, collapsed: true }]);
    const toggle = buttons().find((b) => b.textContent?.includes('Thinking'))!;
    expect(host.textContent).not.toContain('weighing');
    click(toggle);
    // No markdown: the asterisks stay as written.
    expect(host.textContent).toContain('weighing **options**');
    click(toggle);
    expect(host.textContent).not.toContain('weighing');
  });
});

describe('tool calls', () => {
  it('[ac:ac-tool-calls-sa-renderowane-w-ui-jako-k] a tool call renders as a card — the per-tool renderer for an MCP tool in the registry, the generic app card for one without', () => {
    const known = 'mcp__reference-tools__find_references';
    expect(getRenderer(known)).not.toBeNull();
    expect(getRenderer('mcp__other-tools__do_thing')).toBeNull();
    renderMessage([
      use('a', known, { target: 'section', anchor: 'zpn3gaip' }),
      result('a'),
      { type: 'text', text: 'and then', isStreaming: false },
      use('b', 'mcp__other-tools__do_thing', { x: 1 }),
      result('b'),
    ]);
    // Collapsed: the bar names the tool without its MCP server prefix.
    const [first, second] = expanders();
    expect(first!.textContent).toBe('find_references');
    expect(second!.textContent).toBe('do_thing');
    click(first);
    click(second);
    // The registry's own view for the known tool; the bare name for the other.
    expect(host.textContent).toContain('Find refs to section zpn3gaip');
    expect(host.textContent).toContain('·do_thing');
    // Every card offers the raw JSON window.
    expect(host.querySelectorAll('button[aria-label="Show raw JSON"]')).toHaveLength(2);
  });

  it('[ac:ac-narzedzie-monitor-renderuje-sie-w-cza] the Monitor tool renders as a plain tool_use card closed by its paired tool_result', () => {
    renderMessage([use('m1', 'Monitor', { command: 'tail -f build.log' }), result('m1', '"build finished"')]);
    const [card] = expanders();
    expect(card!.textContent).toBe('Monitor');
    // Paired with its result: no running indicator, no error dot.
    expect(host.querySelector('[aria-label="running"]')).toBeNull();
    expect(host.querySelector('[aria-label="error"]')).toBeNull();
    expect(host.querySelectorAll('button[aria-label="Show raw JSON"]')).toHaveLength(1);

    // Before the result arrives the same card shows as running.
    renderMessage([use('m2', 'Monitor', { command: 'tail -f build.log' })]);
    expect(host.querySelector('[aria-label="running"]')).not.toBeNull();
  });

  it('[ac:ac-kolejne-tool-use-tej-samej-kategorii] consecutive tool_use of one category are grouped into one batch card with the summary label', () => {
    const shown = renderMessage([
      use('r1', 'Read', { file_path: 'a.md' }),
      result('r1'),
      use('r2', 'Read', { file_path: 'b.md' }),
      result('r2'),
      use('e1', 'Edit', { file_path: 'a.md' }),
      result('e1'),
      use('e2', 'Write', { file_path: 'c.md' }),
      result('e2'),
      use('e3', 'NotebookEdit', { notebook_path: 'n.ipynb' }),
      result('e3'),
    ]);
    expect(shown.map((b) => b.type)).toEqual(['toolBatch', 'toolBatch']);
    expect(expanders().map((b) => b.textContent)).toEqual(['Read 2 files', 'Edited 3 files']);
  });

  it('[ac:ac-klikniecie-toolbatchcard-rozwija-list] clicking a batch card expands the list of single calls, each in its own renderer', () => {
    renderMessage([
      use('r1', 'Read', { file_path: 'docs/a.md' }),
      result('r1'),
      use('r2', 'Read', { file_path: 'docs/b.md' }),
      result('r2'),
    ]);
    expect(host.textContent).not.toContain('docs/a.md');
    click(expanders()[0]);
    expect(expanders()[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('docs/a.md');
    expect(host.textContent).toContain('docs/b.md');
  });

  it('[ac:ac-run-dlugosci-1-nie-jest-opakowywany-w] a run of length 1 is not wrapped in a batch — it renders as a single tool card', () => {
    const shown = renderMessage([
      use('r1', 'Read', { file_path: 'a.md' }),
      result('r1'),
      { type: 'text', text: 'between', isStreaming: false },
      use('g1', 'Grep', { pattern: 'x' }),
      result('g1'),
    ]);
    expect(shown.some((b) => b.type === 'toolBatch')).toBe(false);
    expect(expanders().map((b) => b.textContent)).toEqual(['Read', 'Grep']);
  });

  // ASSUMPTION:dev-0004 — a subagent's tool calls never land in a batch card of the
  // parent turn; grouping inside the subagent panel (5615w04d) stays.
  it('[ac:ac-tool-calls-wykonane-przez-subagenta-n] tool calls made by a subagent are not batched into a ToolBatchCard of the parent turn', () => {
    const sub = (taskId: string, toolUseId: string, description: string, childIds: [string, string]): UIContentBlock =>
      ({
        type: 'subagent',
        taskId,
        toolUseId,
        description,
        status: 'completed',
        messages: [
          {
            id: `${taskId}-msg`,
            role: 'assistant',
            blocks: [
              use(childIds[0], 'Read', { file_path: `${childIds[0]}.md` }),
              result(childIds[0]),
              use(childIds[1], 'Read', { file_path: `${childIds[1]}.md` }),
              result(childIds[1]),
            ],
            timestamp: '',
            isStreaming: false,
          },
        ],
      }) as UIContentBlock;
    // Two parallel delegations: their Task calls are adjacent and of one category,
    // so without the delegation rule they would fold into a "Ran 2 subtasks" batch.
    const shown = renderMessage([
      use('task1', 'Task', { subagent_type: 'spec-explore', prompt: 'look left', description: 'Explore A' }),
      use('task2', 'Task', { subagent_type: 'spec-explore', prompt: 'look right', description: 'Explore B' }),
      sub('sub-1', 'task1', 'Explore A', ['a1', 'a2']),
      sub('sub-2', 'task2', 'Explore B', ['b1', 'b2']),
      result('task1', '"done A"'),
      result('task2', '"done B"'),
    ]);
    // The parent turn has no batch at all: neither the delegation calls nor the
    // subagents' own calls sit in a parent ToolBatchCard.
    expect(shown.some((b) => b.type === 'toolBatch')).toBe(false);
    const parentToolUseIds = shown.flatMap((b) => (b.type === 'toolUse' ? [b.toolUseId] : []));
    expect(parentToolUseIds).toEqual(['task1', 'task2']);
    // Each subagent's calls stay inside its own delegation block (ASSUMPTION:dev-0004:
    // grouped there, in the panel — 5615w04d), never in the parent's list.
    const panels = shown.filter((b): b is Extract<UIContentBlock, { type: 'subagent' }> => b.type === 'subagent');
    expect(panels.map((p) => p.taskId)).toEqual(['sub-1', 'sub-2']);
    const inPanel = panels.map((p) =>
      p.messages.flatMap((m) => m.blocks.flatMap((b) => (b.type === 'toolBatch' ? b.items.map((i) => i.toolUseId) : []))),
    );
    expect(inPanel).toEqual([
      ['a1', 'a2'],
      ['b1', 'b2'],
    ]);
    // Rendered: two delegation panels, and no tool card or batch card of the parent turn.
    expect(host.textContent).toContain('Explore A');
    expect(host.textContent).toContain('Explore B');
    expect(host.textContent).not.toContain('subtasks');
    expect(expanders()).toHaveLength(0);
  });
});

describe('adapter warning', () => {
  it('[ac:ac-ostrzezenie-adaptera-renderuje-sie-w] an adapter warning renders in the chat stream, and after F5 the persisted row renders the same block', () => {
    // Live: the carrier block useChat places for a `warning` event.
    renderMessage([
      { type: 'text', text: 'working', isStreaming: false },
      use('warning-1', WARNING_TOOL_NAME, { message: 'Filesystem scope degraded to a soft sandbox' }),
    ]);
    expect(host.textContent).toContain('runtime warning');
    expect(host.textContent).toContain('Filesystem scope degraded to a soft sandbox');
    const live = host.textContent;

    // F5: rebuilt from the `warning` row of the thread detail.
    const rows = [
      { id: 1, role: 'user', content: JSON.stringify({ text: 'go' }) },
      { id: 2, role: 'assistant', content: JSON.stringify({ text: 'working' }) },
      { id: 3, role: 'warning', content: JSON.stringify({ message: 'Filesystem scope degraded to a soft sandbox' }) },
    ].map((r) => ({ threadId: 't1', toolName: null, toolId: null, subagentTaskId: null, planMode: false, status: 'complete', usage: null, contextSize: null, createdAt: '2026-10-27T10:00:00.000Z', ...r })) as unknown as ChatMessage[];
    const [, assistant] = rowsToChatMessages(rows, []);
    renderMessage(assistant!.blocks);
    expect(host.textContent).toBe(live);
  });
});

describe('XML tags in a user message', () => {
  it('[ac:ac-znacznik-encji-wyslany-w-wiadomosci-u] an entity tag sent in a user message shows in chat history as that entity\'s chip', () => {
    renderMessage([{ type: 'text', text: 'check <inline_mention type="endpoint" slug="get-api-users"/> please', isStreaming: false }], 'user');
    const chip = host.querySelector('[data-chip="get-api-users"]');
    expect(chip).not.toBeNull();
    expect(host.textContent).not.toContain('<inline_mention');
    expect(host.textContent).toContain('check');
  });
});
