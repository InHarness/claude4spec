import type { ParsedArgs } from '../args.js';
import { refuseFlags, requireString } from '../args.js';
import { optionalString } from '../args.js';
import { delegateGetAll } from '../delegate.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import type { ReferenceHit } from '../../../server/discovery/index.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * Graph reader (M11 owns the command, M19 owns the logic).
 *
 * 0.2.13 — `server-delegating`, over `GET /api/references`. It used to open
 * SQLite `readonly: true` and needed no server; it now needs one, like every
 * other read. `--pages <dir>` travels as `?pages=` and is applied where the
 * roots are assembled, which is the server process — an ad-hoc directory comes
 * back `referenceValidated=false`.
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
 * 0.2.7 — output is the CORE'S ENVELOPE, `{ references, total, hasMore }`, not
 * a bare array. The transports used to each project the core hit onto their own
 * narrower shape (REST kept `raw` without `via`, MCP and CLI kept `via` without
 * `raw`); the projection is gone here, so the CLI hands back exactly what
 * `find_references` returned. The flags are unchanged (`--type`, `--slug`,
 * `--include-tag-matches`, `--pages`) — only the shape moved.
 *
 * The sweep itself is still EXHAUSTIVE and unbounded. This command answers "is
 * anything still pointing at this before I rename or delete it", and a capped
 * answer to that is a wrong answer that reads like a right one — so it exhausts
 * the core's pages rather than taking the first, and still refuses
 * `--limit`/`--offset`. So `total` equals the list's own length and `hasMore` is
 * normally false: the envelope reports a sweep that already ran to the end, it
 * does not turn the command into a paginating one. It is reported rather than
 * hardcoded because the underlying helper has a runaway guard that can stop the
 * sweep short — see below. Each hit carries `rootId`
 * (and `anchor` where the position falls inside an indexed section) — a page is
 * keyed by `(rootId, pagePath)`, so a projection dropping the root makes two
 * hits from different roots indistinguishable.
 */
export async function runFindReferences(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slug = requireString(args, 'slug');
  const itm = args.flags.get('include-tag-matches');
  const includeTagMatches = itm === true || itm === 'true';
  refuseFlags(args, ['limit', 'offset'], 'find-references is an exhaustive sweep and returns every hit');

  const { items: references, exhausted } = await delegateGetAll<ReferenceHit>(
    args,
    '/references',
    {
      type,
      slug,
      ...(includeTagMatches ? { includeTagMatches: true } : {}),
      ...(optionalString(args, 'pages') ? { pages: optionalString(args, 'pages') } : {}),
    },
    (payload) => {
      const p = (payload ?? {}) as { references?: ReferenceHit[]; hasMore?: boolean };
      return { items: Array.isArray(p.references) ? p.references : [], hasMore: p.hasMore === true };
    },
  );
  // `hasMore` is REPORTED, not asserted. The sweep normally runs to the end and
  // answers false — but the guard can stop it short, and a command that claims
  // "that was all of them" on a truncated sweep is exactly the wrong answer that
  // reads like a right one.
  writeOutput({ references, total: references.length, hasMore: !exhausted }, args);
}

export const findReferencesCommand: CliCommandContribution = {
  name: 'find-references',
  operation: 'find_references',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runFindReferences,
};
