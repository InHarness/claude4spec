import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import { runAgent, AgentError } from '../../core/agent/run-agent.js';
import { ALLOWED_MODELS } from '../routes/models.js';

/**
 * `c4s-tools` — cross-cutting in-process MCP server expozujacy peer-consult
 * jako narzedzie MCP. Jeden tool `ask`, mountowany per request (jak `plan-tools`).
 *
 * Motywacja: w `plan_mode=true` agent ma `disallowedTools = MUTATING_BUILTINS`
 * (Bash zakazany), wiec nie moglby zawolac binarki `c4s ask`. MCP nie podlega
 * temu filtrowi, wiec `mcp__c4s-tools__ask` dziala w plan_mode i poza nim,
 * bez zdejmowania bana na Bash.
 *
 * Prawie stateless — wzorem `plan-tools` (gdzie `threadId` jest ambient z
 * closure) fabryka domyka jedynie `callerWorkspace`: domyslny workspace, w
 * ktorym dziala wolajacy agent. Pozostale parametry (peer, threadId, model)
 * celuja w **innego** peera i przychodza jako input.
 *
 * `callerWorkspace` rozwiazuje AMBIGUOUS_WORKSPACE: gdy ten sam katalog projektu
 * jest zarejestrowany w N>1 workspace'ach, `ask` bez jawnego `workspace`
 * dziedziczy workspace wolajacego zamiast wpadac w niejednoznacznosc, ktora z
 * jego perspektywy nie istnieje. Jawny `input.workspace` nadal wygrywa (override).
 *
 * Pozostale parametry (peer, threadId, model, effort) celuja w innego peera i
 * przychodza jako input; default `effort` ('medium') rozwiazywany w `runAgent`.
 *
 * 0.1.79: tool zablokowany do READ-ONLY. `contextType='ask'` jest zahardkodowany
 * wewnatrz (caller nie moze wybrac mutujacego kontekstu), a `output: 'final'`
 * zwraca terse `{ threadId, answer }`. Parametry `contextType` i `brief` usuniete
 * z wejscia.
 */
export function buildC4sToolsServer(callerWorkspace?: string): McpServerInstance {
  const ask = mcpTool(
    'ask',
    [
      'Consult another claude4spec specification synchronously. Returns { threadId, answer }.',
      'The peer is READ-ONLY: it does not mutate its spec (Write/Edit/Bash banned; entity/page edits soft-blocked at prompt level).',
      'Use `project` (local path to peer .claude4spec/) OR `server` (URL override); if both, `server` wins.',
      'Continue an existing peer thread by passing its `threadId`.',
      'Works in plan_mode — MCP is not filtered by READONLY_BUILTINS, so this works where Bash-shelled `c4s ask` does not.',
      'Same contract as the `c4s ask` CLI shorthand: same discovery, same errors.',
      '`model` and `effort` are resume-immutable: continuing a peer thread (via `threadId`) with values different from its first turn → RESUME_CONFIG_LOCKED.',
    ].join('\n'),
    {
      message: z.string().describe('Question/prompt for the peer spec.'),
      project: z.string().optional().describe('Local path to the peer .claude4spec/ directory.'),
      workspace: z
        .string()
        .optional()
        .describe("Workspace override; defaults to the caller's workspace when omitted."),
      server: z.string().optional().describe('Peer server URL override; wins over `project` if both set.'),
      threadId: z.string().optional().describe('Continue an existing peer thread.'),
      model: z
        .enum(ALLOWED_MODELS)
        .optional()
        .describe('Peer turn model. Default: opus-4.8. Resume-immutable.'),
      effort: z
        .enum(['low', 'medium', 'high'])
        .optional()
        .describe(
          'Reasoning level for the peer turn, mapped to architectureConfig.claude_effort. Default: medium. Resume-immutable.',
        ),
    },
    async (input) => {
      try {
        const result = await runAgent({
          message: String(input.message ?? ''),
          project: typeof input.project === 'string' ? input.project : undefined,
          // Jawny input wygrywa; w przeciwnym razie dziedzicz workspace wolajacego.
          workspace: (typeof input.workspace === 'string' ? input.workspace : undefined) ?? callerWorkspace,
          server: typeof input.server === 'string' ? input.server : undefined,
          threadId: typeof input.threadId === 'string' ? input.threadId : undefined,
          // Schema (z.enum) waliduje wartosci w runtime; `input` jest luzno typowany,
          // wiec zawezamy dla TS (effort wymaga cast do unii).
          model: typeof input.model === 'string' ? input.model : undefined,
          effort: typeof input.effort === 'string' ? (input.effort as 'low' | 'medium' | 'high') : undefined,
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
