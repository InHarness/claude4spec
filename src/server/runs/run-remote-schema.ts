import { z } from 'zod';

/**
 * mcp-tool `run-tools-run-remote` — the wire contract of `run_remote`: its
 * parameters, verbatim from the record. The master computes `repo`, `home`,
 * `baseSha` and the plan's path relative to the home, so none of them is a
 * parameter. Shared by the catalog row (`core-operations.ts`) and the
 * `run-tools` server.
 */
export const RUN_REMOTE_INPUT_SCHEMA = {
  planPath: z
    .string()
    .optional()
    .describe(
      'Path of the plan file to execute, relative to the plans root. Omit to execute the plan attached to the current thread. Not together with `prompt`.',
    ),
  prompt: z.string().optional().describe('Free-form instruction to execute instead of a plan. Not together with `planPath`.'),
  projectId: z
    .string()
    .optional()
    .describe('Project the prompt is addressed to. Only with `prompt`; defaults to the current project.'),
  agent: z.string().default('shadow').describe('Name of the agent definition the Run executes.'),
  host: z
    .string()
    .optional()
    .describe(
      'Local id of the runner host. Omit when exactly one connected host offers Runs; with several, the call is refused with the list of hosts to choose from.',
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
  'Starts a Run on a runner host: an agent turn over the specification of the whole workspace, executed on a remote machine. Use it when the user asks to execute a plan (or a prompt) in shadow mode. The call returns as soon as the host accepts the Run; it does not wait for the Run to finish. The result reaches the master only as a shadow that a human accepts in Releases → Shadows. Use get_run later to report its state.';

export const RUN_REMOTE_SUMMARY =
  "Zleca Run na hoście runnera — turę agenta nad specyfikacją całego workspace'u na zdalnej maszynie — i wraca, zanim Run się skończy.";
