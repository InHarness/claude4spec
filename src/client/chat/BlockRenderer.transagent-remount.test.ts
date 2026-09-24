// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import type { UIContentBlock } from '@inharness-ai/agent-chat';
import { BlockRenderer } from './BlockRenderer.js';
import { TRANSAGENT_TOOL_NAME, type TransagentEntry } from './useChat.js';

/**
 * Sequential runTransagent A then B with no text between them: once B lands the
 * batcher folds A's `toolUse`+`toolResult` into a `toolBatch`. A's panel must be
 * the SAME component instance across that change — a remount re-joins the child
 * stream, re-fetches its history and resets the user's toggles.
 */

// Every panel mount calls `clear()` once from its join effect — count those.
const clear = vi.fn();
vi.mock('@inharness-ai/agent-chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@inharness-ai/agent-chat')>()),
  useMessageReducer: () => ({
    state: { messages: [] },
    handleWireEvent: () => {},
    restoreMessages: () => {},
    clear,
  }),
  useEventStream: () => ({ joinStream: async () => true, disconnect: () => {} }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (toolUseId: string): TransagentEntry => ({
  toolUseId,
  childThreadId: `child-${toolUseId}`,
  contextType: 'brief',
  status: 'running',
});
const input = { contextType: 'brief', message: 'do the thing' };

describe('TransagentPanel — stable across re-batching', () => {
  it('keeps panel A mounted when a second call turns its toolUse into a toolBatch', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const render = (block: UIContentBlock, transagents: TransagentEntry[]) =>
      act(async () => {
        root.render(
          createElement(BlockRenderer, { block, siblings: [block], side: 'assistant', transagents, model: 'opus' }),
        );
      });

    await render(
      { type: 'toolUse', toolUseId: 'tu-A', toolName: TRANSAGENT_TOOL_NAME, input } as UIContentBlock,
      [entry('tu-A')],
    );
    expect(clear).toHaveBeenCalledTimes(1);
    const panelA = host.querySelector('[data-transagent-panel="tu-A"]');

    await render(
      {
        type: 'toolBatch',
        items: [
          { toolUseId: 'tu-A', toolName: TRANSAGENT_TOOL_NAME, input },
          { toolUseId: 'tu-B', toolName: TRANSAGENT_TOOL_NAME, input },
        ],
      } as unknown as UIContentBlock,
      [entry('tu-A'), entry('tu-B')],
    );
    // Only B mounted; A's DOM node is the very same one.
    expect(clear).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-transagent-panel="tu-A"]')).toBe(panelA);
    expect(host.querySelectorAll('[data-transagent-panel]')).toHaveLength(2);

    await act(async () => root.unmount());
  });
});
