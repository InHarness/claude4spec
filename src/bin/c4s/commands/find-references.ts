import type { ParsedArgs } from '../args.js';
import { refuseFlags, requireString } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { findReferencesAll } from '../../../server/discovery/index.js';
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
 *
 * Output stays a BARE ARRAY of hits, unbounded. This command is a sweep — it
 * answers "is anything still pointing at this before I rename or delete it" —
 * and a capped answer to that is a wrong answer that reads like a right one. So
 * it exhausts the core's pages rather than taking the first, takes no
 * `--limit`/`--offset`, and needs no `total`/`hasMore` envelope, since an
 * exhaustive answer's total is its own length. Each hit GAINS `rootId` (and
 * `anchor` where the position falls inside an indexed section): the old
 * projection dropped the root, so hits from two roots were indistinguishable.
 */
export async function runFindReferences(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slug = requireString(args, 'slug');
  const itm = args.flags.get('include-tag-matches');
  const includeTagMatches = itm === true || itm === 'true';
  refuseFlags(args, ['limit', 'offset'], 'find-references is an exhaustive sweep and returns every hit');

  const ctx = await createContext(args);
  try {
    const hits = await findReferencesAll(ctx.discovery, {
      target: 'entity',
      type,
      slug,
      includeTagMatches,
    });
    writeOutput(hits, args);
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
