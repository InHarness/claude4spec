import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { delegateGet } from '../delegate.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 *   c4s load-skill-file <slug> [--file <relPath>] [--format json|text]
 *
 * 0.2.99 M37 — `server-delegating`, over `GET /api/skills/:slug?file=`.
 *
 * Without `--file` it OPENS the skill: the SKILL.md body (no frontmatter) plus
 * the manifest of the package's other files. With `--file` it reads one of them.
 * `--format text` prints just `content`, so a skill can be piped into a prompt.
 *
 * `--file` travels as a query parameter and is validated by the core (`..`,
 * absolute paths → `INVALID_ARGUMENT`). The SLUG is a path segment, though, and
 * `encodeURIComponent` leaves `.`/`..` alone — `fetch` would then collapse them
 * and address a different route of the project (see `get-brief`). Those two are
 * refused here, before a URL exists.
 */
export async function runLoadSkillFile(args: ParsedArgs): Promise<void> {
  const slug = args.positional[0];
  if (!slug) {
    throw new CliError(
      'INVALID_ARGS',
      'load-skill-file requires a skill slug',
      'usage: c4s load-skill-file <slug> [--file <relPath>] — slugs come from `c4s list-skills`',
    );
  }
  if (slug === '.' || slug === '..') {
    throw new CliError('INVALID_ARGS', `"${slug}" is not a skill slug`, 'slugs come from `c4s list-skills`');
  }
  const file = optionalString(args, 'file');

  const data = (await delegateGet(
    args,
    `/skills/${encodeURIComponent(slug)}`,
    file === undefined ? {} : { file },
  )) as { content?: string };

  if (args.format === 'text') {
    process.stdout.write((data.content ?? '') + '\n');
    return;
  }
  writeOutput(data, args);
}

export const loadSkillFileCommand: CliCommandContribution = {
  name: 'load-skill-file',
  operation: 'load_skill_file',
  executionMode: 'server-delegating',
  errorCodes: [
    ...SERVER_DELEGATING_CODES,
    'INVALID_ARGS',
    'INVALID_ARGUMENT',
    'SKILL_NOT_FOUND',
    'SKILL_FILE_NOT_FOUND',
    'NOT_TEXT',
  ],
  handler: runLoadSkillFile,
};
