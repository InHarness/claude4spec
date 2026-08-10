import { z } from 'zod';
import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { toolFailure, toolSuccess } from '../operations/envelope.js';
import { filePatch, type PatchWriteDeps } from '../services/patch-write.js';

/**
 * `patch-tools` — the `mcp` rendering of `file_patch`, which the catalog had
 * declared and nobody had built.
 *
 * `core-operations.ts` has always listed `file_patch` with `channels.mcp:
 * direct()`, and `direct` is a claim that THIS channel renders the operation
 * itself. It rendered nothing: REST answered `POST /api/patches` and the CLI
 * delegated to that route, while `grep mcpTool('file_patch'` came back empty. A
 * declared-but-unbuilt cell is worse than an honest `na(reason)`, because the
 * catalog is what every profile gate and channel listing reads — the operation
 * was advertised to agents that had no way to call it.
 *
 * The gap mattered most for the one caller it excluded. An agent reading a brief
 * is exactly who discovers that the brief and the code disagree, and filing that
 * discovery was the one thing it could not do from inside the conversation where
 * it made the discovery.
 *
 * The answer is `{ path }`, matching REST byte for byte. Nothing here needs its
 * own shape: the patch body travels TO the server, and echoing it back would be
 * the caller paying twice for text it just wrote.
 */
export function createPatchToolsServer(deps: PatchWriteDeps): CapturedMcpServer {
  const ok = (data: unknown, operation: string) => toolSuccess(data, { operation, channel: 'mcp' });
  const fail = toolFailure;

  const filePatchTool = mcpTool(
    'file_patch',
    [
      'File a patch against a brief: which brief, what class of deviation, what drifted.',
      'Takes the INTENT, not a finished file — the server composes the frontmatter',
      '(type, brief, patch_kind, created_at, created_by, applied) and the heading,',
      'because that frontmatter is what makes the patch findable by the spec author.',
      'Returns { path } relative to the patches dir.',
      'Not idempotent: two filings of the same drift are two files, because a second',
      'report of the same drift is a real event, not a duplicate to swallow.',
    ].join(' '),
    {
      brief: z
        .string()
        .describe('Brief path relative to briefsDir, e.g. "0-2-14-to-next.md". Must name a real brief → else BRIEF_NOT_FOUND.'),
      desc: z
        .string()
        .describe('Concise description of the drift. Drives the filename slug and the body heading.'),
      patchKind: z
        .enum(['drift', 'missing', 'incorrect', 'clarification'])
        .optional()
        .describe(
          'drift = the code does something materially different from the brief; ' +
            'missing = the brief is silent on a detail you had to decide; ' +
            'incorrect = the brief is factually wrong about existing code; ' +
            'clarification = the brief is ambiguous. Defaults to drift.',
        ),
      body: z
        .string()
        .describe('The patch body in markdown — what drifted, and what the spec author should consider changing.'),
      createdBy: z.string().optional().describe('Reporter identity. Defaults to "agent".'),
    },
    async (args) => {
      try {
        return ok(filePatch(deps, args, 'agent'), 'file_patch');
      } catch (err) {
        return fail(err);
      }
    },
  );

  return createMcpServer({ name: 'patch-tools', tools: [filePatchTool] });
}
