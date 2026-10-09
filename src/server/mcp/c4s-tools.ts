import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { z } from 'zod';
import { toolError } from '../operations/envelope.js';
import { runAgent, AgentError } from '../../core/agent/run-agent.js';
import { DEFAULT_MODEL } from '../../core/agent/models.js';

/**
 * `c4s-tools` — cross-cutting in-process MCP server expozujacy peer-consult
 * jako narzedzie MCP. Jeden tool `ask`, mountowany per request (jak `plan-tools`).
 *
 * Motywacja: `plan_mode=true` desugaruje sie do `disallowedToolGroups:
 * ['file-write','shell']`, czyli Bash jest zdjety i agent nie moglby zawolac
 * binarki `c4s ask`. Grupy dotycza WYLACZNIE built-inow — MCP nie podlega temu
 * filtrowi w ogole — wiec `mcp__c4s-tools__ask` dziala w plan_mode i poza nim,
 * bez zdejmowania bana na Bash. (Jedyna twarda bramka na powierzchni MCP to
 * profil `context_type`; patrz `operations/profile-gate.ts`.)
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
/**
 * 2.1.9 — the `description` of the `c4s-tools-ask` entity, verbatim: the
 * entity carries exactly the text that goes into the tool definition. The
 * change of this release: the peer never edits its pages or entities, and a
 * request for a change ends as a plan on the peer's side whose path the answer
 * names — so the tool no longer tells the caller not to ask for one.
 */
export const ASK_TOOL_DESCRIPTION =
  "Consult another claude4spec specification synchronously. Sends `message` to the peer project's agent, blocks until the peer's turn completes, and returns the peer's final answer. Use it when the current task needs context that lives in a different spec — clarifying a cross-spec contract, checking how the other side models something, asking for the peer's domain knowledge. The peer answers read-only: it never edits the peer's pages or entities. To get a change into the peer's specification — including a project you use as a skill — ask for it: the peer leaves a plan on its side and the answer names that plan's path; nothing changes until the peer's author applies it. Do not use it to orchestrate work inside the current specification. Peers available in this workspace are listed in `<workspace_projects/>`. Address the peer with `project` — its `id` exactly as `<workspace_projects/>` lists it — plus `workspace` when that id belongs to more than one workspace. `server` is an explicit peer server URL and is only valid together with `project`: it replaces the address, never the project. Pass `threadId` to continue an earlier conversation with that peer — the id always refers to a thread on the peer side, never to the current thread; omit it to start a fresh peer thread. The answer comes back collapsed: only the last assistant message of the peer's turn is returned, without the intermediate text between the peer's tool calls and without its tool-call history, all of which stays on the peer. Nothing streams — the call returns once, at the end, so a long peer turn is a long block. `model` and `effort` apply to the peer's turn only.";

export function buildC4sToolsServer(callerWorkspace?: string): CapturedMcpServer {
  const ask = mcpTool(
    'ask',
    ASK_TOOL_DESCRIPTION,
    {
      message: z.string().describe('Question/prompt for the peer spec.'),
      project: z
        .string()
        .describe("The peer project's `id`, exactly as <workspace_projects/> lists it. Not a path, not a name."),
      workspace: z
        .string()
        .optional()
        .describe("Workspace override; defaults to the caller's workspace when omitted."),
      server: z
        .string()
        .optional()
        .describe('Peer server address override (e.g. its publicUrl). Valid only together with `project`.'),
      threadId: z.string().optional().describe('Continue an existing peer thread.'),
      /**
       * Pass-through STRING, deliberately not `z.enum(ALLOWED_MODELS)`.
       *
       * The enum was rejecting an unknown alias at the MCP schema boundary, as
       * an input-validation error. The declared contract is that an unknown
       * model reaches the peer and comes back as `AGENT_ERROR` — the runtime
       * refuses it with its own vocabulary, which is the only side that knows
       * what it can actually run. Deriving the enum from `ALLOWED_MODELS` did
       * not fix that: it is the right catalog, refusing at the wrong layer, with
       * the wrong code.
       */
      model: z
        .string()
        .optional()
        .describe(
          `Peer turn model alias. Default: ${DEFAULT_MODEL}. The selectable list is the peer's own, ` +
            'published by its GET /api/chat/config. Resume-immutable. Passed through unvalidated here; ' +
            'a value the peer does not offer fails on the peer side.',
        ),
      effort: z
        .enum(['low', 'medium', 'high'])
        .optional()
        .describe(
          'Reasoning level for the peer turn, mapped to architectureConfig.claude_effort. Default: medium. Resume-immutable.',
        ),
    },
    async (input) => {
      // 2.1.0 — refused LOCALLY, before anything reaches a peer. There is no
      // walk-up here: the server process's cwd is not a project, so `project`
      // is mandatory in the `mcp` channel (optional only on the CLI).
      const message = typeof input.message === 'string' ? input.message : '';
      const project = typeof input.project === 'string' ? input.project.trim() : '';
      if (message.trim() === '') return toolError('INVALID_ARGS', '`message` must not be empty');
      if (project === '') {
        return toolError('INVALID_ARGS', '`project` is required', "pass the peer's `id` from <workspace_projects/>");
      }
      try {
        const result = await runAgent({
          message,
          project,
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
        // The shared envelope — flat `{ error, code, hint }`, per item 3. The
        // default code stays `AGENT_ERROR` rather than `INTERNAL`: a peer turn
        // that failed is not this server faulting.
        const code = err instanceof AgentError ? err.code : 'AGENT_ERROR';
        const message = err instanceof Error ? err.message : String(err);
        const hint = err instanceof AgentError ? err.hint : undefined;
        return toolError(code, message, hint);
      }
    },
  );

  return createMcpServer({
    name: 'c4s-tools',
    tools: [ask],
  });
}
