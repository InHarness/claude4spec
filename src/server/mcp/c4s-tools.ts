import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import { runAgent, AgentError } from '../../core/agent/run-agent.js';

/**
 * `c4s-tools` — cross-cutting in-process MCP server expozujacy peer-consult
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
 *
 * 0.1.79: tool zablokowany do READ-ONLY. `contextType='ask'` jest zahardkodowany
 * wewnatrz (caller nie moze wybrac mutujacego kontekstu), a `output: 'final'`
 * zwraca terse `{ threadId, answer }`. Parametry `contextType` i `brief` usuniete
 * z wejscia.
 */
export function buildC4sToolsServer(): McpServerInstance {
  const ask = mcpTool(
    'ask',
    [
      'Consult another claude4spec specification synchronously. Returns { threadId, answer }.',
      'The peer is READ-ONLY: it does not mutate its spec (Write/Edit/Bash banned; entity/page edits soft-blocked at prompt level).',
      'Use `project` (local path to peer .claude4spec/) OR `server` (URL override); if both, `server` wins.',
      'Continue an existing peer thread by passing its `threadId`.',
      'Works in plan_mode — MCP is not filtered by READONLY_BUILTINS, so this works where Bash-shelled `c4s ask` does not.',
      'Same contract as the `c4s ask` CLI shorthand: same discovery, same errors.',
    ].join('\n'),
    {
      message: z.string(),
      project: z.string().optional(),
      workspace: z.string().optional(),
      server: z.string().optional(),
      threadId: z.string().optional(),
      model: z.string().optional(),
    },
    async (input) => {
      try {
        const result = await runAgent({
          message: String(input.message ?? ''),
          project: typeof input.project === 'string' ? input.project : undefined,
          workspace: typeof input.workspace === 'string' ? input.workspace : undefined,
          server: typeof input.server === 'string' ? input.server : undefined,
          threadId: typeof input.threadId === 'string' ? input.threadId : undefined,
          model: typeof input.model === 'string' ? input.model : undefined,
          // Locked: a consulted peer always runs read-only, terse output.
          contextType: 'ask',
          output: 'final',
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        const code = err instanceof AgentError ? err.code : 'AGENT_ERROR';
        const message = err instanceof Error ? err.message : String(err);
        const hint = err instanceof AgentError ? err.hint : undefined;
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
