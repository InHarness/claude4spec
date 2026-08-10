/**
 * M23 — `file_patch`, as ONE function, the way the catalog requires.
 *
 * The operation had two renderings and one of them did not exist: the catalog
 * declared `channels.mcp: direct()`, REST answered `POST /api/patches`, the CLI
 * delegated to that route, and no MCP tool was ever built. So an agent — the
 * caller most likely to notice drift while reading a brief — was the one caller
 * that could not report it.
 *
 * Adding the tool meant deciding where validation lives. It used to live in the
 * Express handler, which would have made the MCP rendering either a second copy
 * of the same six checks or a laxer door onto the same writer. Both are the
 * drift this release exists to remove, so the checks moved here and both
 * channels became adapters: they translate their own wire shape and their own
 * refusal envelope, and nothing else.
 */

import { writePatchFs } from '../../core/briefs/file-patch.js';
import type { PatchKind } from '../../core/briefs/types.js';
import { DomainError } from './tags.js';

const PATCH_KINDS: readonly PatchKind[] = ['drift', 'missing', 'incorrect', 'clarification'];

export interface PatchWriteDeps {
  briefsDirAbs: string;
  patchesDirAbs: string;
}

/** The operation's input, channel-independent. `brief` is relative to `briefsDir`. */
export interface FilePatchInput {
  brief?: unknown;
  desc?: unknown;
  patchKind?: unknown;
  body?: unknown;
  createdBy?: unknown;
}

/**
 * The answer is `{ path }` and nothing else — the patch's own text is not echoed
 * back at the caller that just sent it.
 */
export interface FilePatchResult {
  path: string;
}

/**
 * @param fallbackActor identity of last resort when the caller does not name
 * itself: `'rest'`, `'agent'`, and so on. A caller that stays anonymous still
 * leaves a truthful record of HOW it arrived.
 */
export function filePatch(
  deps: PatchWriteDeps,
  input: FilePatchInput,
  fallbackActor: string,
): FilePatchResult {
  if (typeof input.brief !== 'string' || input.brief.trim() === '') {
    throw new DomainError('VALIDATION', 'brief is required (path relative to briefsDir)');
  }
  if (typeof input.desc !== 'string' || input.desc.trim() === '') {
    throw new DomainError('VALIDATION', 'desc is required and must not be empty');
  }
  if (typeof input.body !== 'string' || input.body === '') {
    throw new DomainError('VALIDATION', 'body is required');
  }
  // Checked rather than trusted because it is optional: `createdBy?.trim()` on a
  // non-string threw a TypeError the handler could not attribute, so a client bug
  // surfaced as 500 INTERNAL with no indication of which field was wrong.
  if (input.createdBy !== undefined && typeof input.createdBy !== 'string') {
    throw new DomainError('VALIDATION', 'createdBy must be a string when present');
  }
  const kind = (input.patchKind ?? 'drift') as PatchKind;
  if (!PATCH_KINDS.includes(kind)) {
    throw new DomainError(
      'VALIDATION',
      `patchKind must be one of ${PATCH_KINDS.join(' | ')} — got '${String(input.patchKind)}'`,
    );
  }

  /**
   * The same core writer the CLI has always used, unchanged: it asserts the brief
   * exists (→ BRIEF_NOT_FOUND), slugifies the WHOLE relative brief path so two
   * briefs sharing a filename in different subdirectories cannot collide, creates
   * `patchesDir` lazily, and writes the frontmatter (`type: patch`, `brief`,
   * `patch_kind`, `created_at`, `created_by`, `applied: false`) under a
   * `# Patch — <desc>` heading.
   *
   * No explicit indexing call: `patchesDir` is mounted as an `artifacts:patch`
   * filesystem source, so the watcher indexes the new file and captures it in
   * `file_version` by the same reaction that handles a hand-written one.
   */
  return writePatchFs({
    briefsDirAbs: deps.briefsDirAbs,
    patchesDirAbs: deps.patchesDirAbs,
    briefRelPath: input.brief,
    desc: input.desc,
    kind,
    body: input.body,
    createdBy: (input.createdBy as string | undefined)?.trim() || fallbackActor,
  });
}
