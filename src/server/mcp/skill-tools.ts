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

export interface SkillToolsOptions {
  /**
   * Pass to also register `list_skills`. Only the EXTERNAL surface does: in an
   * agent turn the listing is the `<available_skills>` prompt block.
   */
  resolver?: SkillResolver;
}

export function buildSkillToolsServer(
  registry: SkillRegistry,
  projectId: string | null = null,
  opts: SkillToolsOptions = {},
): CapturedMcpServer {
  const loadSkillFileTool = mcpTool(
    'load_skill_file',
    [
      'Load a skill from this project\'s skill registry — the ONLY way to read one.',
      'Two modes, one operation:',
      '- `slug` alone OPENS the skill: returns its title, description, scope, the body of SKILL.md, and `files` — a manifest of every other file in its package as { path, bytes, lines, isText }. Read the manifest before fetching a subfile; it tells you what the subfile costs.',
      '- `slug` + `file` READS one package subfile, e.g. load_skill_file("my-style", "workflows/brief.md"). `file` is a POSIX path relative to the package (never absolute, never with ".."); the disk location of a skill is not part of this contract and you never need it.',
      'Read-only and idempotent — this operation never writes.',
      'Content over the response budget comes back with `truncated: true` and a `truncationHint`; the address (slug, file) is unchanged.',
      'Works against the LIVE registry, so a skill added or edited after this thread started is readable immediately, even though the <available_skills> listing in your prompt was frozen on the first turn.',
    ].join('\n'),
    {
      slug: z.string().describe('Skill slug, from the <available_skills> listing in your system prompt or from list_skills.'),
      file: z
        .string()
        .optional()
        .describe(
          `Package-relative POSIX path of a subfile, from the \`files\` manifest. Defaults to "${DEFAULT_SKILL_FILE}" (the skill body).`,
        ),
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
        [
          'List the skills of this project\'s registry: `listing` of { slug, description } plus `writingStyle` — the active writing style ({ slug, title }) or null.',
          'The writing style is NOT a listing row: it is the convention every piece of specification content here must obey. Open it with load_skill_file(writingStyle.slug) and follow it before writing.',
          '`contextType` narrows the listing to what that kind of conversation is offered; omit it for the whole registry. Visibility here is not a permission — load_skill_file opens any slug.',
          'Read-only and idempotent.',
        ].join('\n'),
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
            .describe(
              `Conversation type whose skill set to list — one of ${KNOWN_CONTEXT_TYPES.join(', ')}. Omit to list the whole registry.`,
            ),
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
