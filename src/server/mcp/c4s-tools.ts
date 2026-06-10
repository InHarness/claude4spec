import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import { runAsk, AskError, type AskContextType } from '../../core/ask/run-ask.js';

/**
 * `c4s-tools` — cross-cutting in-process MCP server expozujacy `c4s ask`
 * jako narzedzie MCP. Jeden tool `ask`, mountowany per request (jak `plan-tools`).
 *
 * Motywacja: w `plan_mode=true` agent ma `disallowedTools = MUTATING_BUILTINS`
 * (Bash zakazany), wiec nie moglby zawolac binarki `c4s ask`. MCP nie podlega
 * temu filtrowi, wiec `mcp__c4s-tools__ask` dziala w plan_mode i poza nim,
 * bez zdejmowania bana na Bash.
 *
 * Stateless — w odroznieniu od `plan-tools` (gdzie `threadId` jest ambient
 * z closure), `c4s-tools.ask` celuje w **innego** peera, wszystkie parametry
 * przychodza jako input. Brak `ctx` w fabryce.
 */
export function buildC4sToolsServer(): McpServerInstance {
  const ask = mcpTool(
    'ask',
    [
      'Consult another claude4spec specification synchronously. Returns { threadId, answer }.',
      'Use `project` (local path to peer .claude4spec/) OR `server` (URL override); if both, `server` wins.',
      'Continue an existing peer thread by passing its `threadId` (omit `contextType` then).',
      'Works in plan_mode — MCP is not filtered by READONLY_BUILTINS, so this works where Bash-shelled `c4s ask` does not.',
      'Same contract as the `c4s` CLI: same discovery, same errors.',
    ].join('\n'),
    {
      message: z.string(),
      project: z.string().optional(),
      workspace: z.string().optional(),
      server: z.string().optional(),
      contextType: z.enum(['chat', 'brief', 'patch']).optional(),
      threadId: z.string().optional(),
      brief: z.string().optional(),
    },
    async (input) => {
      try {
        const result = await runAsk({
          message: String(input.message ?? ''),
          project: typeof input.project === 'string' ? input.project : undefined,
          workspace: typeof input.workspace === 'string' ? input.workspace : undefined,
          server: typeof input.server === 'string' ? input.server : undefined,
          contextType:
            typeof input.contextType === 'string'
              ? (input.contextType as AskContextType)
              : undefined,
          threadId: typeof input.threadId === 'string' ? input.threadId : undefined,
          briefPath: typeof input.brief === 'string' ? input.brief : undefined,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        const code = err instanceof AskError ? err.code : 'AGENT_ERROR';
        const message = err instanceof Error ? err.message : String(err);
        const hint = err instanceof AskError ? err.hint : undefined;
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: { code, message, ...(hint ? { hint } : {}) } }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  return createMcpServer({
    name: 'c4s-tools',
    tools: [ask],
  });
}
