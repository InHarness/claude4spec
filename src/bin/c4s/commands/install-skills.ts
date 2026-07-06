import path from 'node:path';
import type { ParsedArgs } from '../args.js';
import { optionalString, optionalStringList } from '../args.js';
import { resolveWorkspaceProjectOrThrow } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import {
  ALL_SKILL_SLUGS,
  buildExternalSkillContext,
  buildExternalSkillsBundle,
  isSkillSlug,
  writeFileSet,
  type SkillSlug,
} from '../../../server/external-skills/external-skills-service.js';

/**
 * 0.1.104 M22 — filesystem-only, no server/sqlite: writes the on-demand
 * external skills into a CODE repo's `.claude/skills/` (the Claude Code
 * harness dir the CLI is invoked FROM, via `process.cwd()`) — NOT the
 * `--project`-resolved spec repo's `.claude4spec/skills/`, which nothing
 * writes to anymore. `--project <slug>` only selects which registered
 * claude4spec project's identity/paths get baked into the generated
 * SKILL.md content.
 *
 *   c4s install-skills --project my-spec-project
 *   c4s install-skills --project my-spec-project --skills spec-reader,refactor
 *   c4s install-skills --project my-spec-project --dir ./tools/skills
 */
export async function runInstallSkills(args: ParsedArgs): Promise<void> {
  const { project, workspaceName } = resolveWorkspaceProjectOrThrow({
    project: args.project,
    workspace: args.workspace,
  });
  const ctx = buildExternalSkillContext(project, workspaceName);

  const skillsRaw = optionalStringList(args, 'skills');
  let selection: SkillSlug[] | undefined;
  // `skillsRaw` is `undefined` only when `--skills` was omitted entirely —
  // optionalStringList still returns `[]` for a comma/whitespace-only value
  // like `--skills=,,`, which is truthy in JS. Checking `!== undefined` (not
  // truthiness) and rejecting an empty-after-filter list keeps that an error
  // instead of silently falling through to "select all".
  if (skillsRaw !== undefined) {
    if (skillsRaw.length === 0) {
      throw new CliError('INVALID_ARGS', '--skills was given but contained no valid slug');
    }
    for (const s of skillsRaw) {
      if (!isSkillSlug(s)) {
        throw new CliError(
          'INVALID_ARGS',
          `--skills: unknown slug '${s}' — expected one of ${ALL_SKILL_SLUGS.join(', ')}`,
        );
      }
    }
    selection = skillsRaw as SkillSlug[];
  }

  const bundle = buildExternalSkillsBundle(ctx, selection);
  const targetDir = path.resolve(process.cwd(), optionalString(args, 'dir') ?? '.claude/skills');

  try {
    const written = writeFileSet(targetDir, bundle);
    writeOutput({ written }, args);
  } catch (err) {
    throw new CliError('SKILLS_WRITE_FAILED', `failed to write skills to ${targetDir}: ${(err as Error).message}`);
  }
}
