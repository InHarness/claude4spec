import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { assertBriefExists } from './read-brief.js';
import { BriefFsError } from './types.js';
import type { PatchKind } from './types.js';

export interface WritePatchOpts {
  briefsDirAbs: string;
  patchesDirAbs: string;
  /** Relative to briefsDir — validated to exist before any write. */
  briefRelPath: string;
  desc: string;
  kind: PatchKind;
  body: string;
  createdBy: string;
}

export interface WritePatchResult {
  /** Relative to patchesDir — portable across machines, mirrors brief addressing. */
  path: string;
}

/** Duplicated from server/services/brief.ts's `slugify` (server-only, pulls in unrelated types). */
function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'patch'
  );
}

/**
 * The first free `<stem>.md`, `<stem>-2.md`, `<stem>-3.md`, …
 *
 * Filing a patch is NOT idempotent — two reports of the same drift are two
 * events the spec author has to see, and `desc` alone decides the slug. Writing
 * straight to `<stem>.md` therefore destroyed the earlier report whenever two
 * people (or the same agent twice) described a drift the same way, and answered
 * `201` as though nothing had happened. The collision is not exotic: `slugify`
 * truncates at 80 characters, so two briefs whose paths agree in their first 80
 * collide even with different `desc`s.
 *
 * Suffixing rather than erroring keeps the operation's declared semantics: the
 * caller asked to file a patch, and it got filed.
 */
function uniqueFilename(dirAbs: string, stem: string): string {
  if (!fs.existsSync(path.join(dirAbs, `${stem}.md`))) return `${stem}.md`;
  // Bounded: a directory holding thousands of same-slug patches is a bug of its
  // own, and an unbounded probe would turn it into a hang.
  for (let n = 2; n <= 1000; n++) {
    const candidate = `${stem}-${n}.md`;
    if (!fs.existsSync(path.join(dirAbs, candidate))) return candidate;
  }
  throw new BriefFsError(
    'PATCH_WRITE_FAILED',
    `refusing to file: ${stem}.md and 999 numbered variants already exist in the patches directory`,
  );
}

export function writePatchFs(opts: WritePatchOpts): WritePatchResult {
  assertBriefExists(opts.briefsDirAbs, opts.briefRelPath);

  // Slugify the whole relative path (not just its basename) so briefs that
  // share a filename in different subdirectories (e.g. `scoped-a/foo.md` vs
  // `scoped-b/foo.md`) don't collide on the same patch filename and silently
  // overwrite each other — slugify collapses the path separator into `-`.
  const briefExt = path.extname(opts.briefRelPath);
  const briefStem = opts.briefRelPath.slice(0, opts.briefRelPath.length - briefExt.length);
  const briefSlug = slugify(briefStem);
  const filename = uniqueFilename(opts.patchesDirAbs, `${briefSlug}-${slugify(opts.desc)}`);

  const frontmatter = {
    type: 'patch' as const,
    brief: opts.briefRelPath,
    patch_kind: opts.kind,
    created_at: new Date().toISOString(),
    created_by: opts.createdBy,
    // 0.2.14: was `status: 'awaiting'`. Same question, same answer shape as the
    // plan's flag — "is this already applied to the specification".
    applied: false,
  };
  const content = matter.stringify(`# Patch — ${opts.desc}\n\n${opts.body}\n`, frontmatter);

  try {
    fs.mkdirSync(opts.patchesDirAbs, { recursive: true });
    fs.writeFileSync(path.join(opts.patchesDirAbs, filename), content, 'utf8');
  } catch (err) {
    throw new BriefFsError('PATCH_WRITE_FAILED', `failed to write patch file: ${(err as Error).message}`);
  }

  return { path: filename };
}
