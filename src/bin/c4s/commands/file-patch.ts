import fs from 'node:fs';
import path from 'node:path';
import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { resolveBriefsPatchesDirs } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { writePatchFs, BriefFsError } from '../../../core/briefs/index.js';
import type { PatchKind } from '../../../core/briefs/index.js';

const PATCH_KINDS: PatchKind[] = ['drift', 'missing', 'incorrect', 'clarification'];

/**
 * 0.1.103 M11 — filesystem-only, no server/sqlite. The only mutating command
 * in this family (writes to `patchesDir`); everything else here is read-only.
 *
 *   printf '%s\n' "$BODY" | c4s file-patch --brief <brief-path> --desc <s> [--kind drift|missing|incorrect|clarification] [--created-by <name>]
 *   c4s file-patch --brief <brief-path> --desc <s> --body-file <f>
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
  const kind = kindRaw as PatchKind;
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

  const { briefsDirAbs, patchesDirAbs } = resolveBriefsPatchesDirs(args);

  try {
    writeOutput(
      writePatchFs({ briefsDirAbs, patchesDirAbs, briefRelPath: briefPath, desc, kind, body, createdBy }),
      args,
    );
  } catch (err) {
    if (err instanceof BriefFsError) {
      throw new CliError(err.code, err.message, err.hint);
    }
    throw err;
  }
}
