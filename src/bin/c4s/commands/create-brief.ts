import fs from 'node:fs';
import path from 'node:path';
import type { ParsedArgs } from '../args.js';
import { optionalString, refuseFlags } from '../args.js';
import { delegatePost } from '../delegate.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 * `c4s create-brief` — mint a brief whose body the CALLER already wrote.
 *
 *   c4s create-brief --body-file <path> [--from <release>] [--suffix <slug>] \
 *     --project <slug> --workspace <name>
 *
 * 0.2.94. The command exists for one caller: an external coding agent that has
 * read the repository and the specification, knows what drifted, and needs a
 * durable artifact for the implementer. Before this release its only door was
 * `c4s agent --ct brief`, which mints the file and then asks a turn to fill it
 * — and a turn in a `brief` thread sees `release_diff` and nothing else, so it
 * can legitimately decline to write anything. The caller got exit 0 and a brief
 * with only a heading. Here the body is an argument, and no turn runs at all.
 *
 * ## The window is open, by definition
 *
 * `--from` moves the window's start; its end is always the current state. There
 * is no `--to` and no `--roots`, and both are REFUSED rather than ignored — a
 * silently dropped flag leaves the caller believing in a scope that was never
 * applied.
 *
 * ## The body comes from a file, never from an argument
 *
 * Multi-line markdown full of backticks does not survive a shell, so
 * `--body-file` is the only source. Its readability is checked HERE, before the
 * address is even resolved: a typo in a path should not cost a health-check and
 * should not be reported as though the server had an opinion about it.
 */
export async function runCreateBrief(args: ParsedArgs): Promise<void> {
  refuseFlags(
    args,
    ['to', 'roots'],
    "create-brief's window is open by definition: it always ends at the current state. Legal flags: --body-file <path>, --from <release>, --suffix <slug>, plus --project / --workspace / --server",
  );

  const bodyFile = optionalString(args, 'body-file');
  if (!bodyFile) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '--body-file <path> is required: the brief body is read from a file, never from an argument',
      'usage: c4s create-brief --body-file <path> [--from <release>] [--suffix <slug>] --project <slug> --workspace <name>',
    );
  }
  // Resolved before it is reported, so the message names the path that was
  // actually looked for rather than the one that was typed.
  const resolved = path.resolve(process.cwd(), bodyFile);
  let content: string;
  try {
    content = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `--body-file is not readable: ${resolved} (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`,
      'pass a path to a readable file holding the brief body',
    );
  }

  // An OMITTED `fromReleaseName` means "the latest release" on the wire; an
  // explicit `null` would mean "open at the start", a different window. So the
  // key is left out entirely rather than sent as null.
  const from = optionalString(args, 'from');
  const suffix = optionalString(args, 'suffix');

  const created = (await delegatePost(args, '/briefs', {
    content,
    ...(from === undefined ? {} : { fromReleaseName: from }),
    ...(suffix === undefined ? {} : { suffix }),
  })) as { path: string; hash: string };

  // `hash` comes back with the path because it arms the caller's first
  // `update_brief` — having just written the brief, it should not have to read
  // it again to be allowed to edit it.
  writeOutput({ briefPath: created.path, hash: created.hash }, args);
}

export const createBriefCommand: CliCommandContribution = {
  name: 'create-brief',
  operation: 'create_brief',
  executionMode: 'server-delegating',
  errorCodes: [
    ...SERVER_DELEGATING_CODES,
    'INVALID_ARGUMENT',
    'VALIDATION',
    'BRIEF_NOT_FOUND',
    'IMMUTABLE_FIELD',
    'BRIEF_SAME_RELEASE',
  ],
  handler: runCreateBrief,
};
