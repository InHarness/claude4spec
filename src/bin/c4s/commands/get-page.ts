import type { ParsedArgs } from '../args.js';
import { optionalString, requireString } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { CliError } from '../errors.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — `get_page` on the CLI: the whole file, when you really want the file.
 *
 *   c4s get-page --root-id <id> --path <p> [--range <from:to>]
 *
 * The page comes back AS AUTHORED, with XML tags untouched — a tag is the edge
 * to another entity, so expanding it would replace a link with a payload.
 *
 * `--range` is accepted only on a root WITHOUT a section index. The refusal
 * lives in the core (which owns root properties) and this command inherits it
 * rather than re-deciding it: on an indexed root a section is a better window in
 * every way, and two guards could disagree.
 */
export async function runGetPage(args: ParsedArgs): Promise<void> {
  const rootId = requireString(args, 'root-id');
  const pagePath = requireString(args, 'path');
  const range = parseRange(optionalString(args, 'range'));

  const ctx = await createContext(args);
  try {
    writeOutput(
      await ctx.discovery.getPage({ rootId, path: pagePath, ...(range ? { range } : {}) }),
      args,
    );
  } finally {
    ctx.close();
  }
}

/** `--range 1:200` → `{ start: 1, end: 200 }`. 1-based and inclusive, like the core's. */
function parseRange(raw: string | undefined): { start: number; end: number } | undefined {
  if (raw === undefined) return undefined;
  const m = /^(\d+):(\d+)$/.exec(raw);
  if (!m) {
    throw new CliError(
      'INVALID_ARGS',
      `--range must be '<from>:<to>', got '${raw}'`,
      '--range 1:200 — 1-based and inclusive',
    );
  }
  return { start: Number(m[1]), end: Number(m[2]) };
}

export const getPageCommand: CliCommandContribution = {
  name: 'get-page',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_ARGS', 'INVALID_ARGUMENT', 'PAGE_NOT_FOUND'],
  handler: runGetPage,
};
