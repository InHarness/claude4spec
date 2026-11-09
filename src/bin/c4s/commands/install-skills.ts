import path from 'node:path';
import type { ParsedArgs } from '../args.js';
import { optionalString, optionalStringList } from '../args.js';
import { resolveWorkspaceProjectOrThrow } from '../project-selector.js';
import { CliError, type CliErrorCode } from '../errors.js';
import { AgentError, confirmRemoteProject } from '../../../core/agent/http.js';
import { writeOutput } from '../output.js';
import {
  buildExternalSkillContext,
  buildExternalSkillsBundle,
  capabilitiesOfProjectType,
  skillSlugsFor,
  writeFileSet,
  type SkillSlug,
} from '../../../server/external-skills/external-skills-service.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.1.104 M22 — writes the on-demand external skills into a CODE repo's
 * `.claude/skills/` (the Claude Code harness dir the CLI is invoked FROM, via
 * `process.cwd()`); `--dir` overrides the target.
 *
 * 2.1.0 — two ways to resolve the baked-in `{ id, workspace, publicUrl }`:
 *   c4s install-skills [--project <id>]              local registry (--project or
 *                                                    walk-up); offline — no server,
 *                                                    no DB slot
 *   c4s install-skills --server <url> --project <id> the arguments, confirmed by ONE
 *                                                    read on that server before the
 *                                                    write (id present + workspace name)
 *
 *   c4s install-skills --project app-spec --skills spec-reader,refactor
 *   c4s install-skills --server https://c4s.example.com --project app-spec
 */
export async function runInstallSkills(args: ParsedArgs): Promise<void> {
  const server = optionalString(args, 'server');
  let ctx;
  if (server !== undefined) {
    if (!args.project) {
      throw new CliError('INVALID_ARGS', '--server requires --project <id>', 'pass --project <id>');
    }
    let remote;
    try {
      remote = await confirmRemoteProject(server, args.project);
    } catch (err) {
      if (err instanceof AgentError) throw new CliError(err.code as CliErrorCode, err.message, err.hint);
      throw err;
    }
    // `defaultPort` is irrelevant: the `--server` address overrides publicUrl.
    ctx = buildExternalSkillContext(
      { id: args.project },
      { name: remote.workspace, defaultPort: 0 },
      server,
      typeCapabilities(remote.projectType),
    );
  } else {
    const { project, workspace } = resolveWorkspaceProjectOrThrow({
      project: args.project,
      workspace: args.workspace,
    });
    ctx = buildExternalSkillContext(project, workspace, undefined, typeCapabilities(project.projectType));
  }
  // 2.1.77 (M22 `8tvwx2ry`): the selectable slugs are the project's skills — without
  // `briefs`, `brief-implementer` is an unknown slug.
  const available = skillSlugsFor(ctx.capabilities);

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
      if (!(available as string[]).includes(s)) {
        throw new CliError(
          'INVALID_ARGS',
          `--skills: unknown slug '${s}' — expected one of ${available.join(', ')}`,
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

/**
 * 2.1.77 (M22 `8tvwx2ry`): the capabilities of the project's type — the copy in
 * the workspace record (absent = `spec`), or the `projectType` the server lists.
 * A type this version does not know cannot be rendered for.
 */
function typeCapabilities(projectType: string | undefined): ReadonlySet<string> {
  const caps = capabilitiesOfProjectType(projectType);
  if (!caps) {
    throw new CliError('INVALID_ARGS', `unknown project type '${String(projectType)}' — not in this version's project-type registry`);
  }
  return caps;
}

export const installSkillsCommand: CliCommandContribution = {
  name: 'install-skills',
  executionMode: 'fs-scoped',
  flags: ['skills', 'dir'],
  errorCodes: [
    'INVALID_ARGS',
    'SKILLS_WRITE_FAILED',
    'PROJECT_ID_NOT_FOUND',
    'SERVER_NOT_RUNNING',
    'SERVER_NOT_RECOGNIZED',
    'PROJECT_NOT_IN_WORKSPACE',
  ],
  handler: runInstallSkills,
};
