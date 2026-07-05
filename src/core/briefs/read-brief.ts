import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { collectBriefFiles } from './list-briefs.js';
import { BriefFsError } from './types.js';
import type { BriefReadResult } from './types.js';

/** Rejects an absolute path or one that escapes briefsDir via `..`. */
export function assertSafeRelPath(rel: string): void {
  if (path.isAbsolute(rel)) {
    throw new BriefFsError('INVALID_ARGS', `path must be relative to briefsDir, got absolute path '${rel}'`);
  }
  const normalized = path.normalize(rel);
  if (
    normalized === '..' ||
    normalized.startsWith(`..${path.sep}`) ||
    normalized.includes(`${path.sep}..${path.sep}`)
  ) {
    throw new BriefFsError('INVALID_ARGS', `path '${rel}' escapes briefsDir`);
  }
}

/** Throws BRIEF_NOT_FOUND (with a hint listing available briefs) if `relPath` doesn't exist. */
export function assertBriefExists(briefsDirAbs: string, relPath: string): void {
  assertSafeRelPath(relPath);
  if (!fs.existsSync(path.join(briefsDirAbs, relPath))) {
    // Cheap directory-listing only — no need to read+parse every file's
    // frontmatter just to build a "here's what exists" hint.
    const available = collectBriefFiles(briefsDirAbs).slice(0, 10);
    throw new BriefFsError(
      'BRIEF_NOT_FOUND',
      `brief '${relPath}' not found`,
      available.length > 0 ? `available briefs: ${available.join(', ')}` : 'no briefs found in briefsDir',
    );
  }
}

export function readBriefFs(briefsDirAbs: string, relPath: string): BriefReadResult {
  assertBriefExists(briefsDirAbs, relPath);
  const content = fs.readFileSync(path.join(briefsDirAbs, relPath), 'utf8');
  const parsed = matter(content);
  return {
    frontmatter: (parsed.data ?? {}) as BriefReadResult['frontmatter'],
    body: parsed.content,
    content,
  };
}
