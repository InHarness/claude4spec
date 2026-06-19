/**
 * 0.1.69 Transagents — `transagent-tools` MCP server.
 *
 * Single tool `runTransagent`: delegate a unit of work to a hidden CHILD thread
 * ("banka") of the SAME spec, running in a chosen `contextType`. The child runs
 * a full turn (side-effecting artifacts, live stream into the parent panel) and
 * returns ONLY a `summary` to the parent LLM's context — keeping the parent's
 * context budget free of the child's full transcript.
 *
 * Per-request instance (like `plan-tools` / `brief-tools`): `parentThreadId` and
 * the `dispatcher` are captured from the parent turn. Mounted ONLY for
 * `context_type ∈ {chat, patch}` and never inside a child banka (recursion depth
 * 1) — both guards live in agent-turn.ts.
 *
 * Read-only cross-spec counterpart: `c4s-tools` (consults a DIFFERENT spec).
 */

import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { TransagentDispatcher } from '../services/transagent-dispatcher.js';
import { DomainError } from '../services/tags.js';

/** Tool name as the SDK reports it (`mcp__<server>__<tool>`) — used by the
 *  agent-turn loop to correlate the tool_use event with the dispatcher. */
export const TRANSAGENT_TOOL_FULL_NAME = 'mcp__transagent-tools__runTransagent';

export interface TransagentToolsContext {
  parentThreadId: string;
  dispatcher: TransagentDispatcher;
}

export function buildTransagentToolsServer(ctx: TransagentToolsContext): McpServerInstance {
  const runTransagent = mcpTool(
    'runTransagent',
    [
      'Delegate a unit of work to a hidden CHILD thread ("banka") of THIS specification.',
      'The child runs a full turn in the chosen `contextType` (brief | chat | patch), may produce',
      'side-effecting artifacts, streams live into your panel, and returns ONLY a concise `summary`',
      'to your context — its full transcript stays hidden, keeping your context budget small.',
      'Use it to hand off self-contained work: "turn this analysis into a brief", "split this plan",',
      '"draft the patch for X". Returns { threadId, summary }.',
      "  - contextType='brief': creates an ANALYSIS brief file (source: analysis, to_release: null)",
      '    grounded in the `message` you pass (your analysis), then runs a brief-editorial child.',
      '    Optional payload: { fromReleaseName?, suffix?, content? }.',
      "  - contextType='patch': resolves a patch — payload MUST include { patchPath }.",
      "  - contextType='chat': a plain child chat turn.",
      'Continue an existing child by passing its `threadId` (omit `contextType` semantics then).',
      'At most one child runs per turn (this tool_use blocks until the child finishes).',
    ].join('\n'),
    {
      contextType: z.enum(['brief', 'chat', 'patch']),
      message: z.string(),
      payload: z.record(z.string(), z.unknown()).optional(),
      threadId: z.string().optional(),
    },
    async (input) => {
      try {
        const result = await ctx.dispatcher.run({
          parentThreadId: ctx.parentThreadId,
          contextType: input.contextType as 'brief' | 'chat' | 'patch',
          message: String(input.message ?? ''),
          payload:
            input.payload && typeof input.payload === 'object'
              ? (input.payload as Record<string, unknown>)
              : undefined,
          threadId: typeof input.threadId === 'string' ? input.threadId : undefined,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        // Non-abort child failure collapses upward as the parent's tool_result
        // isError { code, message }. The last good summary remains readable via
        // runTransagent({ threadId }).
        const code = err instanceof DomainError ? err.code : 'AGENT_ERROR';
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: { code, message } }) }],
          isError: true,
        };
      }
    },
  );

  return createMcpServer({
    name: 'transagent-tools',
    tools: [runTransagent],
  });
}
