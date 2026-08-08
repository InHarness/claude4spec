import fs from 'node:fs';
import path from 'node:path';
import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { delegatePost } from '../delegate.js';
import { CliError } from '../errors.js';
import type { ResolvedEntry } from '../../../server/serialization/resolve-page.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * `c4s resolve <file.md>` — expand the XML tags in a local markdown file.
 *
 * A TRANSPORT-SIDE COMPOSITION, not a core operation, and deliberately so: a tag
 * is an EDGE to another entity, and an agent reading the specification wants the
 * edge, not a payload written over it. There is no MCP tool for this and there
 * must not be one.
 *
 * 0.2.13 — `server-delegating`, over `POST /api/_meta/resolve-page`. The file
 * still comes off the CALLER'S disk — that is why the content travels in the
 * body rather than a path in a query string, which would resolve against the
 * server's filesystem whenever the two differ. What moved is the expansion: the
 * CLI used to build a discovery core to look the entities up, and that was the
 * last operation it executed locally.
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

  const md = fs.readFileSync(abs, 'utf8');
  const result = (await delegatePost(args, '/_meta/resolve-page', { content: md })) as {
    content: string;
    inlineContent: string;
    resolved: ResolvedEntry[];
  };

  if (format === 'json') {
    const sidecar = result.resolved.map(({ inline: _inline, ...rest }) => rest);
    process.stdout.write(JSON.stringify({ content: result.content, resolved: sidecar }, null, 2) + '\n');
    return;
  }

  process.stdout.write(result.inlineContent);
  if (!result.inlineContent.endsWith('\n')) process.stdout.write('\n');
}

export const resolveCommand: CliCommandContribution = {
  name: 'resolve',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_ARGS', 'FILE_NOT_FOUND'],
  handler: runResolve,
};
