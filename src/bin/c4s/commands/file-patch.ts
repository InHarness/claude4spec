import fs from 'node:fs';
import path from 'node:path';
import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { delegatePost } from '../delegate.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import type { PatchKind } from '../../../core/briefs/index.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

const PATCH_KINDS: PatchKind[] = ['drift', 'missing', 'incorrect', 'clarification'];

/**
 * The only mutating command in the brief/patch family.
 *
 *   printf '%s\n' "$BODY" | c4s file-patch --brief <brief-path> --desc <s> [--kind drift|missing|incorrect|clarification] [--created-by <name>]
 *   c4s file-patch --brief <brief-path> --desc <s> --body-file <f>
 *
 * 0.2.13 — `server-delegating`, over `POST /api/patches`. The file is written by
 * the SERVER: `mkdir -p` on `patchesDir` is lazy there, the slug is minted
 * there, and `PATCH_WRITE_FAILED` comes from there. This process no longer knows
 * where `patchesDir` is, which is the point — it had a dedicated write path into
 * the specification that nothing else used.
 *
 * The body still comes off the CALLER'S stdin or `--body-file`: that is the
 * caller's own input, not specification content, and reading it here is what the
 * shell pipeline in every skill depends on.
 */
export async function runFilePatch(args: ParsedArgs): Promise<void> {
  const briefPath = optionalString(args, 'brief');
  if (!briefPath) {
    throw new CliError('INVALID_ARGS', '--brief <brief-path> is required');
  }
  const desc = optionalString(args, 'desc');
  if (!desc) {
    throw new CliError('INVALID_ARGS', '--desc <short-desc> is required');
  }
  const kindRaw = optionalString(args, 'kind') ?? 'drift';
  if (!PATCH_KINDS.includes(kindRaw as PatchKind)) {
    throw new CliError('INVALID_ARGS', `--kind must be one of ${PATCH_KINDS.join(', ')}, got '${kindRaw}'`);
  }
  // Not itemized in the brief's own flag list — additive, defaults to 'unknown'
  // (mirrors the SKILL.md's own "created_by: ... # or cursor, aider" guidance).
  const createdBy = optionalString(args, 'created-by') ?? 'unknown';

  const bodyFile = optionalString(args, 'body-file');
  let body: string;
  if (bodyFile) {
    body = fs.readFileSync(path.resolve(process.cwd(), bodyFile), 'utf8');
  } else if (process.stdin.isTTY) {
    throw new CliError(
      'INVALID_ARGS',
      'file-patch requires a body: pass --body-file <f> or pipe the body via stdin',
    );
  } else {
    body = fs.readFileSync(0, 'utf8');
  }

  writeOutput(
    await delegatePost(args, '/patches', {
      brief: briefPath,
      desc,
      patchKind: kindRaw,
      body,
      createdBy,
    }),
    args,
  );
}

export const filePatchCommand: CliCommandContribution = {
  name: 'file-patch',
  operation: 'file_patch',
  executionMode: 'server-delegating',
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGS', 'BRIEF_NOT_FOUND', 'PATCH_WRITE_FAILED'],
  handler: runFilePatch,
};
