import type { ParsedArgs } from '../args.js';
import { requireString, paginationFrom } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * Graph reader (M11 owns the command, M19 owns the logic). Readonly: opens
 * SQLite `readonly: true, fileMustExist: true` — no running
 * `npx @inharness-ai/claude4spec` server required.
 *
 *   c4s find-references --type <t> --slug <s> [--include-tag-matches] [--pages <dir>]
 *
 * 0.2.6 — this command has NO page walk of its own. It used to enumerate the
 * root directories itself, which meant the reference sweep existed twice: once
 * here and once behind the server, agreeing only for as long as somebody kept
 * them agreeing. It now calls the same discovery-core operation MCP and REST
 * call — which delegates to the same `src/core/references/` matcher it always
 * did — so the CLI answer equals the UI answer by construction rather than by
 * maintenance. `--pages <dir>` is applied where the roots are assembled
 * (`createContext`), not here, so no command carries a root branch of its own.
 */
export async function runFindReferences(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slug = requireString(args, 'slug');
  const itm = args.flags.get('include-tag-matches');
  const includeTagMatches = itm === true || itm === 'true';

  const ctx = await createContext(args);
  try {
    const result = await ctx.discovery.findReferences({
      target: 'entity',
      type,
      slug,
      includeTagMatches,
      ...paginationFrom(args),
    });
    writeOutput(result, args);
  } finally {
    ctx.close();
  }
}

export const findReferencesCommand: CliCommandContribution = {
  name: 'find-references',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runFindReferences,
};
