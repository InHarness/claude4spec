import fs from 'node:fs';
import path from 'node:path';
import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { resolvePageContent } from '../../../server/serialization/resolve-page.js';

export function runResolve(args: ParsedArgs): void {
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
  const ctx = createContext(args);
  try {
    const { resolved, inlineContent } = resolvePageContent(md, {
      reader: ctx.reader,
      registry: ctx.registry,
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
