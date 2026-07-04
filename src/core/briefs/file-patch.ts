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

export function writePatchFs(opts: WritePatchOpts): WritePatchResult {
  assertBriefExists(opts.briefsDirAbs, opts.briefRelPath);

  const briefSlug = path.basename(opts.briefRelPath, path.extname(opts.briefRelPath));
  const filename = `${briefSlug}-${slugify(opts.desc)}.md`;

  const frontmatter = {
    type: 'patch' as const,
    brief: opts.briefRelPath,
    patch_kind: opts.kind,
    created_at: new Date().toISOString(),
    created_by: opts.createdBy,
    status: 'awaiting' as const,
  };
  const content = matter.stringify(`# Patch — ${opts.desc}\n\n${opts.body}\n`, frontmatter);

  try {
    fs.mkdirSync(opts.patchesDirAbs, { recursive: true });
    fs.writeFileSync(path.join(opts.patchesDirAbs, filename), content, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EROFS' || code === 'EPERM') {
      throw new BriefFsError('PATCH_WRITE_FAILED', `failed to write patch file: ${(err as Error).message}`);
    }
    throw err;
  }

  return { path: filename };
}
