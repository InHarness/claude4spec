import fs from 'node:fs';
import path from 'node:path';
import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { resolvePageContent } from '../../../server/serialization/resolve-page.js';
import type { CliCommandContribution } from '../registry.js';

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
  const ctx = await createContext(args);
  try {
    // `c4s resolve` stays a TRANSPORT-SIDE COMPOSITION, not a core operation:
    // it reads a file, asks the core for the entities behind the tags, and does
    // its own CLI formatting. There is no equivalent in the external MCP, where
    // an agent gets structured tool calls and wants the edge, not the payload.
    const { resolved, inlineContent } = resolvePageContent(md, {
      discovery: ctx.discovery,
      activeTypes: ctx.reader.listTypes(),
      availableTypes: ctx.reader.host.listAvailable().map((m) => m.type),
    });

    if (format === 'json') {
      const sidecar = resolved.map(({ inline: _inline, ...rest }) => rest);
      process.stdout.write(JSON.stringify({ content: md, resolved: sidecar }, null, 2) + '\n');
      return;
    }

    process.stdout.write(inlineContent);
    if (!inlineContent.endsWith('\n')) process.stdout.write('\n');
  } finally {
    ctx.close();
  }
}

export const resolveCommand: CliCommandContribution = {
  name: 'resolve',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_ARGS', 'FILE_NOT_FOUND'],
  handler: runResolve,
};
