import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UIContentBlock } from '@inharness-ai/agent-chat';
import { BlockRenderer } from './BlockRenderer.js';
import { TRANSAGENT_TOOL_NAME, type TransagentEntry } from './useChat.js';

/**
 * M46: a `runTransagent` call renders as its bubble panel IN PLACE of the tool
 * card — the parent's `tool_use` row is the anchor. Before this, the panel sat at
 * the bottom of the conversation and the call ALSO rendered as a card, so every
 * transagent showed up twice. A call with no entry (rejected before a child was
 * spawned) keeps its plain card so the rejection stays visible.
 */

// The panel's live-join machinery is not under test (and its effects never run
// in a static render) — stub the two hooks so no reducer/stream is created.
vi.mock('@inharness-ai/agent-chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@inharness-ai/agent-chat')>()),
  useMessageReducer: () => ({
    state: { messages: [] },
    handleWireEvent: () => {},
    restoreMessages: () => {},
    clear: () => {},
  }),
  useEventStream: () => ({ joinStream: async () => false, disconnect: () => {} }),
}));

const entry = (toolUseId: string): TransagentEntry => ({
  toolUseId,
  childThreadId: `child-${toolUseId}`,
  contextType: 'brief',
  status: 'completed',
  summary: 'child summary',
});

const toolUse = (toolUseId: string, toolName = TRANSAGENT_TOOL_NAME): UIContentBlock =>
  ({
    type: 'toolUse',
    toolUseId,
    toolName,
    input: { contextType: 'brief', message: 'do the thing' },
  }) as UIContentBlock;

const batchItem = (toolUseId: string, toolName = TRANSAGENT_TOOL_NAME) => ({
  toolUseId,
  toolName,
  input: { contextType: 'brief', message: 'do the thing' },
  result: null,
});

const render = (block: UIContentBlock, transagents?: TransagentEntry[]) =>
  renderToStaticMarkup(
    createElement(BlockRenderer, {
      block,
      siblings: [block],
      side: 'assistant',
      transagents,
      model: 'opus',
    }),
  );

const panels = (html: string) => (html.match(/data-transagent-panel="/g) ?? []).length;

describe('BlockRenderer — transagent panel anchored at its runTransagent call', () => {
  it('renders the panel instead of a tool card when an entry exists', () => {
    const html = render(toolUse('tu-1'), [entry('tu-1')]);
    expect(panels(html)).toBe(1);
    expect(html).toContain('data-transagent-panel="tu-1"');
    // The tool card for the same call is absorbed, not rendered alongside.
    expect(html).not.toContain(render(toolUse('tu-1'), []));
  });

  it('keeps the plain tool card when no entry exists (rejected call)', () => {
    const html = render(toolUse('tu-1'), []);
    expect(panels(html)).toBe(0);
    // Same markup as any other tool's card: a ToolCard, not an empty slot.
    expect(html).toContain('mb-3 rounded-lg overflow-hidden');
  });

  it('renders one panel per runTransagent inside a toolBatch', () => {
    const block = {
      type: 'toolBatch',
      items: [batchItem('tu-1'), batchItem('tu-2')],
    } as unknown as UIContentBlock;
    const html = render(block, [entry('tu-1'), entry('tu-2')]);
    expect(panels(html)).toBe(2);
  });

  it('pulls only entry-backed calls out of a batch; the rest stays a tool card', () => {
    const withOther = {
      type: 'toolBatch',
      items: [batchItem('tu-1'), batchItem('tu-2', 'mcp__reference-tools__find_references')],
    } as unknown as UIContentBlock;
    const onlyOther = {
      type: 'toolBatch',
      items: [batchItem('tu-2', 'mcp__reference-tools__find_references')],
    } as unknown as UIContentBlock;
    const html = render(withOther, [entry('tu-1')]);
    expect(panels(html)).toBe(1);
    // The remainder renders exactly as the same batch would without the transagent.
    expect(html).toContain(render(onlyOther, [entry('tu-1')]));
  });
});

describe('TransagentPanel — result pairing and summary', () => {
  const resultBlock = (toolUseId: string, summary: string) =>
    ({
      type: 'toolResult',
      toolUseId,
      content: JSON.stringify([{ type: 'text', text: JSON.stringify({ threadId: `child-${toolUseId}`, summary }) }]),
      isError: false,
    }) as unknown as UIContentBlock;

  it('shows the summary out of the { threadId, summary } envelope, not the raw JSON', () => {
    const use = toolUse('tu-1');
    const res = resultBlock('tu-1', 'Brief drafted.');
    const html = renderToStaticMarkup(
      createElement(BlockRenderer, {
        block: use,
        siblings: [use, res],
        side: 'assistant',
        transagents: [{ ...entry('tu-1'), summary: undefined }],
        model: 'opus',
      }),
    );
    expect(html).toContain('Brief drafted.');
    expect(html).not.toContain('threadId');
  });

  it('finds a parallel call’s result among the siblings when the batcher left it unpaired', () => {
    // use, use, result, result — the batcher only pairs a DIRECTLY following result.
    const batch = { type: 'toolBatch', items: [batchItem('tu-1'), batchItem('tu-2')] } as unknown as UIContentBlock;
    const siblings = [batch, resultBlock('tu-1', 'First done.'), resultBlock('tu-2', 'Second done.')];
    const html = renderToStaticMarkup(
      createElement(BlockRenderer, {
        block: batch,
        siblings,
        side: 'assistant',
        transagents: [{ ...entry('tu-1'), summary: undefined }, { ...entry('tu-2'), summary: undefined }],
        model: 'opus',
      }),
    );
    expect(html).toContain('First done.');
    expect(html).toContain('Second done.');
  });

  it('pairs a rejected parallel call’s sibling result into its tool card too', () => {
    // tu-2 was rejected (no entry, INVALID_ARGS) — its card must show the error,
    // not read as still running because the batcher left the result unpaired.
    const batch = { type: 'toolBatch', items: [batchItem('tu-1'), batchItem('tu-2')] } as unknown as UIContentBlock;
    const rejected = {
      type: 'toolResult',
      toolUseId: 'tu-2',
      content: 'INVALID_ARGS: contextType',
      isError: true,
    } as unknown as UIContentBlock;
    const unpaired = renderToStaticMarkup(
      createElement(BlockRenderer, {
        block: batch,
        siblings: [batch, resultBlock('tu-1', 'First done.')],
        side: 'assistant',
        transagents: [entry('tu-1')],
        model: 'opus',
      }),
    );
    const paired = renderToStaticMarkup(
      createElement(BlockRenderer, {
        block: batch,
        siblings: [batch, resultBlock('tu-1', 'First done.'), rejected],
        side: 'assistant',
        transagents: [entry('tu-1')],
        model: 'opus',
      }),
    );
    expect(panels(paired)).toBe(1);
    expect(paired).not.toBe(unpaired);
  });
});
