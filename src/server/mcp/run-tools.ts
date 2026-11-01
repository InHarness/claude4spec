/**
 * `run-tools` — M55's in-process MCP server: the agent's surface for Runs.
 *
 * 2.1.64 builds `run_remote`, `get_run` and `cancel_run`. The server is mounted
 * (L15, M55 `7bo43wak`, M44 `3f5ej79s`) by the turn handler only in a `chat`
 * thread with `parent_thread_id IS NULL`, whatever its plan mode — never in
 * `patch`, `ask`, `brief`, a child thread or a new context type (the registry's
 * declared `runTools` column, `operations/profiles.ts`). The context builds one
 * fresh server per query through {@link RunToolsFactory}.
 *
 * The rendering is a pure adapter: it maps the wire arguments onto
 * `runRemote` (the one function of the operation) and its result or refusal
 * back. A refusal carries its remedy — the host list of `RUN_HOST_REQUIRED`,
 * the refused `field` of `RUN_REJECTED`.
 */

import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { toolError, toolFailure, toolSuccess } from '../operations/envelope.js';
import { RunRemoteError, runRemote, type RunRemoteDeps } from '../runs/run-remote.js';
import { RUN_REMOTE_DESCRIPTION, RUN_REMOTE_INPUT_SCHEMA } from '../runs/run-remote-schema.js';
import { cancelRun, getRun, RunReadError, type RunReadDeps } from '../runs/run-read.js';
import { CANCEL_RUN_DESCRIPTION, GET_RUN_DESCRIPTION, RUN_ID_INPUT_SCHEMA } from '../runs/run-read-schema.js';

export interface RunToolsOptions {
  /** The operation's dependencies, bound to the calling thread's project. */
  deps: RunRemoteDeps;
  /** The dependencies of `get_run` and `cancel_run` (the workspace's projects, hosts, registry, git). */
  readDeps: RunReadDeps;
  /** The calling thread — the address of the plan pinned to it. */
  threadId: string | null;
}

/** The server's name — the key it is mounted under. */
export const RUN_TOOLS_SERVER = 'run-tools';

/** What a project context hands the turn: a fresh `run-tools` server for one thread. */
export interface RunToolsFactory {
  build(threadId: string): CapturedMcpServer;
}

export function buildRunToolsServer(opts: RunToolsOptions): CapturedMcpServer {
  const runRemoteTool = mcpTool(
    'run_remote',
    RUN_REMOTE_DESCRIPTION,
    RUN_REMOTE_INPUT_SCHEMA,
    async (args: {
      planPath?: string;
      prompt?: string;
      projectId?: string;
      agent?: string;
      host?: string;
      notes?: string;
      timeoutMinutes?: number;
      model?: string;
    }) => {
      try {
        const result = await runRemote(opts.deps, { ...args, threadId: opts.threadId });
        return toolSuccess(result, { operation: 'run_remote', channel: 'internal', project: opts.deps.projectId });
      } catch (err) {
        if (err instanceof RunRemoteError) return toolError(err.code, err.message, err.hint, err.extra);
        return toolFailure(err);
      }
    },
    // The record's hints: only `openWorldHint` (the Run executes on another machine).
    { openWorldHint: true },
  );

  const readTool = (name: 'get_run' | 'cancel_run', run: typeof getRun | typeof cancelRun) =>
    async (args: Record<string, unknown>) => {
      try {
        const result = await run(opts.readDeps, { runId: String(args.runId) });
        return toolSuccess(result, { operation: name, channel: 'internal', project: opts.deps.projectId });
      } catch (err) {
        if (err instanceof RunReadError) return toolError(err.code, err.message, err.hint);
        return toolFailure(err);
      }
    };

  // The record's hints: readOnlyHint false, idempotentHint and openWorldHint true.
  const getRunTool = mcpTool('get_run', GET_RUN_DESCRIPTION, RUN_ID_INPUT_SCHEMA, readTool('get_run', getRun), {
    readOnlyHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });

  // The record's hints: destructiveHint, idempotentHint and openWorldHint true.
  const cancelRunTool = mcpTool('cancel_run', CANCEL_RUN_DESCRIPTION, RUN_ID_INPUT_SCHEMA, readTool('cancel_run', cancelRun), {
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  });

  return createMcpServer({ name: RUN_TOOLS_SERVER, tools: [runRemoteTool, getRunTool, cancelRunTool] });
}
