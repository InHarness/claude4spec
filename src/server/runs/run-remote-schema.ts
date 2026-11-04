import { z } from 'zod';
import { DEFAULT_RUN_AGENT_NAME } from './plan-execution-agent.js';

/**
 * mcp-tool `run-tools-run-remote` — the wire contract of `run_remote`: its
 * parameters, verbatim from the record. The master computes `repo`, `home`,
 * `baseSha` (also with `fromRunId`) and `projectId` when it is not given, so
 * none of them is a parameter. 2.1.68: `fromRunId` and `instruction` — a
 * continuation of an earlier Run (M55 `fdu51xri`). Shared by the catalog row (`core-operations.ts`) and the
 * `run-tools` server.
 */
export const RUN_REMOTE_INPUT_SCHEMA = {
  planPath: z
    .string()
    .optional()
    .describe(
      'Path of the plan file, relative to the plans directory of the project. Omit to execute the plan attached to the current thread. Not together with `prompt`.',
    ),
  prompt: z.string().optional().describe('Free-form instruction to execute instead of a plan. Not together with `planPath`.'),
  projectId: z
    .string()
    .optional()
    .describe(
      'Project the plan or the prompt belongs to. Defaults to the current project. With the plan attached to the thread it must be the current project.',
    ),
  fromRunId: z
    .string()
    .optional()
    .describe(
      'Id of a finished Run to continue; the new Run starts from its result and gets its handoff. Not together with `planPath`, `prompt` or `projectId`.',
    ),
  instruction: z
    .string()
    .optional()
    .describe("What the continuation should do beyond the parent's plan. Only with `fromRunId`."),
  agent: z.string().default(DEFAULT_RUN_AGENT_NAME).describe('Name of the agent definition the Run executes.'),
  host: z
    .string()
    .optional()
    .describe(
      "Local id of the runner host. Omit when exactly one connected host offers Runs; with several, the call is refused with the list of hosts to choose from. With `fromRunId`, omit to use the parent's host.",
    ),
  notes: z
    .string()
    .optional()
    .describe('Notes for the Run\'s agent, passed through unchanged. Field rules: c4s-runner dto run-request.'),
  timeoutMinutes: z
    .number()
    .optional()
    .describe(
      'Run time limit in minutes. Omit to use the host default; pass it only when the user names a limit. The host enforces its own upper bound.',
    ),
  model: z
    .string()
    .optional()
    .describe('Model the Run\'s agent uses. Omit for the host default. Field rules: c4s-runner dto run-request.'),
};

export const RUN_REMOTE_DESCRIPTION =
  'Starts a Run on a runner host: an agent turn over the specification of the whole workspace, executed on a remote machine. Use it when the user asks to execute a plan (or a prompt) remotely (Remote execution), or when the user asks to continue a Run that did not finish its work. The call returns as soon as the host accepts the Run; it does not wait for the Run to finish. The result reaches the master only as a shadow that a human accepts in Releases → Shadows. Use get_run later to report its state.';

export const RUN_REMOTE_SUMMARY =
  "Zleca Run na hoście runnera — turę agenta nad specyfikacją całego workspace'u na zdalnej maszynie — i wraca, zanim Run się skończy.";
