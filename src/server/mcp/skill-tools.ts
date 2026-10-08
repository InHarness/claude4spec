/**
 * `skill-tools` — the MCP rendering of the M37 skills registry: `load_skill_file`
 * and, on the external surface only, `list_skills`. Both read-only and idempotent.
 *
 * ## Why this server exists
 *
 * Until 0.2.36 a skill was DELIVERED: the resolver loaded the whole package, the
 * turn handed it to `adapter.execute({ skills })`, the library materialized it in
 * a tmpdir, and the model opened it with the native `Skill(<slug>)` tool —
 * reaching subfiles with `Read`, because they were files on a disk.
 *
 * That made the channel a function of the sandbox. A `brief` thread runs with the
 * FS built-ins off, so a writing style pointing at `workflows/brief.md` — the sole
 * home of genre methodology since 0.2.19 — could not open the one file it was
 * telling the model to read. The package existed, on a path the model was not
 * allowed to touch.
 *
 * An MCP payload has no path. This server serves the SAME bytes in every context
 * type, with FS built-ins on or off, and nothing from the M37 registry is written
 * to disk at any point in a turn.
 *
 * ## A subfile has an address, not a path
 *
 * Every package file except `SKILL.md` is addressed by the pair `(slug, file)`,
 * relative to the package dir. The DISK PATH IS NOT PART OF THE CONTRACT and
 * never enters a payload — a style referring to `~/.claude/skills/foo/x.md` is
 * broken, and gets `INVALID_ARGUMENT` rather than a silent success that would
 * only work on the authoring machine.
 *
 * ## In the L3 catalog since 0.2.99 — the "instruction exception"
 *
 * Both operations have catalog rows (`core-operations.ts`), admitted under the
 * instruction exception: their subject is the convention that specification
 * content must obey, and without them the catalog's write operations cannot be
 * used CORRECTLY from outside. The semantics live in `services/skill-operations.ts`
 * — this adapter only builds the envelope, as do REST (`routes/skills.ts`) and
 * `c4s` (`list-skills`, `load-skill-file`).
 *
 * ## `list_skills` is mounted only where it is asked for
 *
 * Mounting is per-server, not per-tool, so the server built for an agent turn
 * (`routes/agent-turn.ts`, no `resolver`) carries `load_skill_file` alone: in a
 * turn the listing arrives as the `<available_skills>` prompt block before the
 * first tool call, and a `list_skills` tool there would appear in all four
 * context types at once. The external surface (`mcp/surface.ts`) passes the
 * resolver and gets both.
 *
 * ## Deliberately not built (all addable later, additively)
 *
 * `search_skill_files`, a batch `paths[]`, and ranged reads.
 */

import { createMcpServer, mcpTool, z, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { toolFailure, toolSuccess } from '../operations/envelope.js';
import { DEFAULT_SKILL_FILE, listSkills, loadSkillFile } from '../services/skill-operations.js';
import { KNOWN_CONTEXT_TYPES } from '../services/chat-context.js';
import type { SkillRegistry, SkillResolver } from '../services/skill-registry.js';

export { DEFAULT_SKILL_FILE };

/** Both operations only read the registry; a repeated call answers the same. */
const READ_ONLY = { readOnlyHint: true, idempotentHint: true } as const;

/**
 * 2.1.9 — the wire text of each rendering, as the specification states it: the
 * turn's server (`skill-tools`, entity `skill-tools-load-skill-file`) and the
 * external surface (`c4s-reader`, entities `c4s-reader-load-skill-file` and
 * `c4s-reader-list-skills`) describe the same operation to two different callers —
 * one that has `<available_skills>` in its prompt, one that has `list_skills`.
 */
export const SKILL_TOOL_TEXT = {
  turn: {
    loadSkillFile:
      'Load an internal skill from the registry. This is the ONLY channel for reading a skill: skills are not on disk for you — never use Read on a skill path, and never open one with the native Skill() tool. Call it with `slug` alone to OPEN the skill: you get the SKILL.md content plus a manifest of every other file in the package (path, bytes, lines, isText), so you can decide what is worth reading before you pay for it. Call it again with `file` to read one of the manifest paths (e.g. workflows/brief.md) — that is how a skill routes you to its own subfiles. For an editable skill the content is the raw file, and `hash` is the value a write expects. A project skill whose SKILL.md header is not valid yet still opens: the response carries `invalid: true` and `invalidReason`. Available skills, with their descriptions, are listed in <available_skills/>; the active writing style is named in <project_writing_skill>. `file` is POSIX-relative to the package root: no absolute path, no `..`.',
    slug: 'Skill slug from the registry — the value shown in <available_skills/> or <project_writing_skill>.',
  },
  external: {
    loadSkillFile:
      "Load a writing-style or contextual skill from this project's internal registry — which also holds read-only skills of workspace projects exposed to this one — the conventions and methodology that govern how content in this specification may be written. Call it with `slug` alone to OPEN the skill: you get the SKILL.md content plus a manifest of every other file in the package (path, bytes, lines, isText), so you can decide what is worth reading before you pay for it. Call it again with `file` to read one of the manifest paths (e.g. workflows/brief.md) — that is how a skill routes you to its own subfiles. You do not read these skills from disk: the registry serves them through this tool and no response carries a disk path, so there is no path to read and no directory to list. A project skill whose SKILL.md header is not valid yet still opens: the response carries `invalid: true` and `invalidReason`. Discover the available slugs with `list_skills`, which also names the project's active writing style. `file` is POSIX-relative to the package root: no absolute path, no `..`.",
    slug: 'Skill slug from the registry — the value returned by `list_skills`.',
    listSkills:
      'List the skills available for a context type in this project, together with the active writing style. Call this before `load_skill_file` — it is how you learn which slugs exist. The active writing style is BINDING on any content you write into this specification: open it with `load_skill_file` and follow it rather than your own conventions. Pass `contextType` to ask what a given kind of turn would see — a briefing or planning methodology typically lives in a subfile of the active style, so ask for the context you are about to work in. Omit it to get the whole registry. Reading a skill is not gated by context type: anything listed for any context can be opened.',
    contextType: "Context type whose skill set to list. Omit to list the whole registry instead of one context's set.",
  },
  file: 'Package-relative POSIX path of a subfile to read, taken from the manifest (e.g. workflows/brief.md). Omit to open the skill itself.',
} as const;

export interface SkillToolsOptions {
  /**
   * Pass to also register `list_skills`. Only the EXTERNAL surface does: in an
   * agent turn the listing is the `<available_skills>` prompt block. Its presence
   * also selects the external wording of `load_skill_file`.
   */
  resolver?: SkillResolver;
}

export function buildSkillToolsServer(
  registry: SkillRegistry,
  projectId: string | null = null,
  opts: SkillToolsOptions = {},
): CapturedMcpServer {
  const text = opts.resolver ? SKILL_TOOL_TEXT.external : SKILL_TOOL_TEXT.turn;
  const loadSkillFileTool = mcpTool(
    'load_skill_file',
    text.loadSkillFile,
    {
      slug: z.string().describe(text.slug),
      file: z.string().optional().describe(`${SKILL_TOOL_TEXT.file} Defaults to "${DEFAULT_SKILL_FILE}".`),
    },
    async (args) => {
      try {
        const data = loadSkillFile(
          registry,
          String(args.slug ?? ''),
          args.file === undefined ? undefined : String(args.file),
        );
        return toolSuccess(data, { operation: 'load_skill_file', channel: 'mcp', project: projectId });
      } catch (err) {
        return toolFailure(err);
      }
    },
    READ_ONLY,
  );

  const tools = [loadSkillFileTool];

  const resolver = opts.resolver;
  if (resolver) {
    tools.push(
      mcpTool(
        'list_skills',
        SKILL_TOOL_TEXT.external.listSkills,
        {
          /**
           * A string, not `z.enum`: the enum is spelled in the description, but a
           * value outside it must reach `listSkills` and come back as
           * `INVALID_ARGUMENT` with the legal values — the same code the other three
           * channels answer. A zod enum would refuse it in the SDK's own error shape.
           */
          contextType: z
            .string()
            .optional()
            .describe(`${SKILL_TOOL_TEXT.external.contextType} One of: ${KNOWN_CONTEXT_TYPES.join(', ')}.`),
        },
        async (args) => {
          try {
            const data = listSkills(
              resolver,
              args.contextType === undefined ? undefined : String(args.contextType),
            );
            return toolSuccess(data, { operation: 'list_skills', channel: 'mcp', project: projectId });
          } catch (err) {
            return toolFailure(err);
          }
        },
        READ_ONLY,
      ),
    );
  }

  return createMcpServer({ name: 'skill-tools', tools });
}
