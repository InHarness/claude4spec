import fs from 'node:fs';
import path from 'node:path';
import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { delegatePost } from '../delegate.js';
import { CliError } from '../errors.js';
import type { ExpandEmbedsResult } from '../../../core/references/types.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * `c4s resolve <file.md>` — a thin shell: read a local file, hand its text to
 * the M19 embed-expansion core, print what the core returns.
 *
 * 2.1.9 (M11 `m11dreso`): the expansion runs on the server, in the context of
 * the project this invocation resolved — `POST /api/_meta/resolve-page` calls
 * `expandEmbeds` with that project's context (entity reader = `get_entities`).
 * The command has no algorithm of its own: it recognises no tags, maps no tag
 * to a projection and replaces nothing. The result format (`inline` | `json`)
 * and the fate of a tag with a broken slug are the core's; `--format` only
 * selects which of the core's formats to ask for.
 *
 * The file still comes off the CALLER'S disk — that is why the content travels
 * in the body rather than a path in a query string, which would resolve against
 * the server's filesystem whenever the two differ.
 */
export async function runResolve(args: ParsedArgs): Promise<void> {
  const filePath = args.positional[0];
  if (!filePath) {
    throw new CliError('INVALID_ARGS', 'resolve requires a file path', 'usage: c4s resolve <file.md>');
  }
  const abs = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    throw new CliError('FILE_NOT_FOUND', `file not found: ${abs}`);
  }

  const format = optionalString(args, 'format') ?? 'inline';
  if (format !== 'inline' && format !== 'json') {
    throw new CliError('INVALID_ARGS', `--format must be 'inline' or 'json', got '${format}'`);
  }

  const content = fs.readFileSync(abs, 'utf8');
  const result = (await delegatePost(args, '/_meta/resolve-page', { content, format })) as ExpandEmbedsResult;

  if (format === 'json') {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  process.stdout.write(result.text);
  if (!result.text.endsWith('\n')) process.stdout.write('\n');
}

export const resolveCommand: CliCommandContribution = {
  name: 'resolve',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_ARGS', 'FILE_NOT_FOUND'],
  handler: runResolve,
};
