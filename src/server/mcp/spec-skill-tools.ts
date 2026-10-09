/**
 * `spec-skill-tools` — the write channel of the project's own skill packages
 * (M52, 2.1.9): `update_skill_file`, the `internal` rendering of the catalog row
 * of the same name (sheet `katalog-operacji-m52`).
 *
 * ## Why a server of its own
 *
 * It is NOT a tool on `skill-tools`, because it is mounted in other contexts than
 * the read server (M52 `hdkx97wq`): reading skills is needed wherever the agent
 * sees them — all four context types, unconditionally — writing only where the
 * turn may change the project. Mounting is per server, so a write tool on the
 * read server would reach `brief` and `ask` with it.
 *
 * ## Where it is mounted
 *
 * `chat` and `patch`, never `brief` (the brief bubble writes a release note, not
 * agent instructions) nor `ask` (a consultation answers, it does not write the
 * project — M11 `6exnmup9`). The gate is the context-type registry's DECLARED
 * column `specSkillTools` (M44 `3f5ej79s`): a new context type does not inherit
 * it. The operation's `opClass: 'write'` additionally keeps it out of every
 * profile that admits no writes. Not on the external surface: the row's `mcp`
 * cell is `n/a` (writing skills from outside is out of v1).
 *
 * Plan mode does not gate it: an MCP tool is outside the built-in posture, and
 * the prohibition is the prompt's, of the same strength as for every other
 * mutating MCP tool (M52 `rkbsi6ky` #1).
 *
 * ## Lifecycle (M52 L10 `1v62dbhb`)
 *
 * The {@link SpecSkillTools} element lives as long as one project-context
 * instance (key `projectId`): built with the context, released EXPLICITLY by the
 * context's dispose. Each turn — each SDK query — still gets a FRESH `McpServer`
 * from {@link SpecSkillTools.build}, because an MCP server binds to exactly one
 * transport (see `buildMcpServersForExecute` in `routes/agent-turn.ts`).
 */

import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { toolFailure, toolSuccess } from '../operations/envelope.js';
import { UPDATE_SKILL_FILE_INPUT } from '../operations/core-operations.js';
import { updateSkillFile, type SkillWriteDeps } from '../services/skill-write.js';
import type { TextEdit } from '../services/text-edits.js';

export const SPEC_SKILL_TOOLS_SERVER = 'spec-skill-tools';

/** The entity's `description`, verbatim — it goes to the tool definition as is. */
export const UPDATE_SKILL_FILE_DESCRIPTION =
  'Write one file of a skill package that belongs to the current project. Use it to create and edit the project\'s own skills: write SKILL.md to create a package, or any package-relative file to add a subfile. It does not write skills that come from an exposed project — those are read-only here; propose a change to their owner instead. Pass exactly one of `content` (the whole new file) and `textEdits` (literal substitutions). `expectedHash` is the `hash` that load_skill_file returned for this file; pass "" to create a file that must not exist yet. SKILL.md must keep a non-empty `description` in its frontmatter.';

/** Writes a file (not read-only); the world it touches is this project's root (closed). */
const WRITE_ANNOTATIONS = { readOnlyHint: false, openWorldHint: false } as const;

export function buildSpecSkillToolsServer(
  deps: SkillWriteDeps,
  projectId: string | null = null,
): CapturedMcpServer {
  const updateSkillFileTool = mcpTool(
    'update_skill_file',
    UPDATE_SKILL_FILE_DESCRIPTION,
    UPDATE_SKILL_FILE_INPUT,
    async (args) => {
      try {
        const data = await updateSkillFile(
          deps,
          {
            slug: String(args.slug ?? ''),
            ...(args.file !== undefined ? { file: String(args.file) } : {}),
            ...(args.content !== undefined ? { content: String(args.content) } : {}),
            ...(args.textEdits !== undefined ? { textEdits: args.textEdits as TextEdit[] } : {}),
            ...(args.expectedHash !== undefined ? { expectedHash: String(args.expectedHash) } : {}),
          },
          'agent',
        );
        return toolSuccess(data, { operation: 'update_skill_file', channel: 'internal', project: projectId });
      } catch (err) {
        return toolFailure(err);
      }
    },
    WRITE_ANNOTATIONS,
  );
  return createMcpServer({ name: SPEC_SKILL_TOOLS_SERVER, tools: [updateSkillFileTool] });
}

/**
 * The context-scoped element of `spec-skill-tools` (L10): holds the write deps
 * of ONE project-context instance and hands out a fresh server per query until
 * the context disposes it. After {@link dispose} it builds nothing — a turn still
 * unwinding in a disposed context mounts no write channel into a project it no
 * longer owns.
 */
export class SpecSkillTools {
  private deps: SkillWriteDeps | null;

  constructor(
    deps: SkillWriteDeps,
    readonly projectId: string | null = null,
  ) {
    this.deps = deps;
  }

  /** A fresh server, or `null` once the context released this element. */
  build(): CapturedMcpServer | null {
    return this.deps ? buildSpecSkillToolsServer(this.deps, this.projectId) : null;
  }

  get disposed(): boolean {
    return this.deps === null;
  }

  /** Explicit release, called by the project context's dispose. Idempotent. */
  dispose(): void {
    this.deps = null;
  }
}
