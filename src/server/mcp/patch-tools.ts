import { z } from 'zod';
import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { toolFailure, toolSuccess } from '../operations/envelope.js';
import type { PatchService } from '../services/patch.js';

/**
 * M23 `patch-tools` — the patch thread's own artifact server (2.1.4).
 *
 * Mounted ONLY for threads with `context_type='patch'`, in process and outside
 * the sandbox like `plan-tools` / `brief-tools`. The patches directory stays in
 * the agent's implicit filesystem deny-set, so `get_patch` is the one read path
 * to the patch's content — the system prompt carries its address and
 * frontmatter, never its body or hash.
 *
 * The patch is addressed by `chat_thread.patch_path`, closed over here; `path`
 * is optional on both tools and defaults to it.
 *
 * Invariant (catalog): every patch operation with `internal = direct` has a tool
 * here, and nothing else does — today `get_patch` and `mark_patch_applied`.
 * `create_patch` is NOT one of them: a patch is filed by the implementing agent
 * in its terminal (`cli`) or over REST, and the patch thread applies a patch, it
 * does not file one.
 */
export interface PatchThreadToolsContext {
  threadId: string;
  patchPath: string;
  patchService: PatchService;
}

/** Tool names this server mounts — read by the catalog invariant test. */
export const PATCH_THREAD_TOOL_NAMES = ['get_patch', 'mark_patch_applied'] as const;

const PATH_ARG = z
  .string()
  .optional()
  .describe('Patch path relative to the patches directory. Omit to address the patch of the current thread.');

export function buildPatchToolsServer(
  ctx: PatchThreadToolsContext,
  projectId: string | null = null,
): CapturedMcpServer {
  const { patchService } = ctx;
  const ok = (data: unknown, operation: string) =>
    toolSuccess(data, { operation, channel: 'mcp', project: projectId });
  const fail = toolFailure;

  /** No `path` is not an error: the thread's own patch is the normal target. */
  const resolvePath = (args: Record<string, unknown>): string => {
    const raw = typeof args.path === 'string' ? args.path.trim() : '';
    return raw === '' ? ctx.patchPath : raw;
  };

  const getPatch = mcpTool(
    'get_patch',
    "Read the patch this thread is anchored in — content, frontmatter and hash. This is the ONLY way to the patch's content: the system prompt carries the patch's path and frontmatter, never its body. `path` is optional here: omit it and the patch of the current thread is resolved for you; that is the normal call. For a long patch, or when a response comes back truncated, read it in windows with `range`.",
    {
      path: PATH_ARG,
      range: z
        .object({ start: z.number().int().positive(), end: z.number().int().positive() })
        .optional()
        .describe(
          'Line window, 1-based and inclusive. Use it to read a long patch in parts or to fetch the rest after a truncated response. A `start` past the end of the file is refused with the file size.',
        ),
    },
    async (args) => {
      try {
        const range = args.range as { start: number; end: number } | undefined;
        const patch = await patchService.getPatch(resolvePath(args), { range });
        return ok(
          {
            path: patch.path,
            frontmatter: {
              patch_kind: patch.frontmatter.patch_kind,
              applied: patch.frontmatter.applied === true,
              ...(typeof patch.frontmatter.brief === 'string' ? { brief: patch.frontmatter.brief } : {}),
            },
            content: patch.content,
            hash: patch.hash,
            ...(patch.truncated ? { truncated: patch.truncated, truncationHint: patch.truncationHint } : {}),
          },
          'get_patch',
        );
      } catch (err) {
        return fail(err);
      }
    },
    { readOnlyHint: true },
  );

  const markPatchApplied = mcpTool(
    'mark_patch_applied',
    'Mark this thread\'s patch as applied to the specification. Call it as the LAST step, after the patch\'s findings are in the spec — it declares "what this patch reported is now folded into the spec". It is a declaration, not a computed fact: nothing verifies it against the pages or the version history. Reverting the flag is a user action in the UI; from here the value is always true.',
    {
      applied: z
        .boolean()
        .describe('Only `true` is accepted from the agent channel. Passing `false` is refused — unset the flag in the UI instead.'),
      path: PATH_ARG,
    },
    async (args) => {
      try {
        return ok(await patchService.markApplied({ path: resolvePath(args), applied: args.applied }), 'mark_patch_applied');
      } catch (err) {
        return fail(err);
      }
    },
  );

  return createMcpServer({ name: 'patch-tools', tools: [getPatch, markPatchApplied] });
}
