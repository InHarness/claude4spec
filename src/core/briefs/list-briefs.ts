import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { isMarkdownPath } from '../../shared/page-files.js';
import type { BriefFrontmatterRaw, BriefListItem, BriefListOpts, BriefListResult } from './types.js';

/**
 * A missing/unreadable dir yields no briefs — mirrors PagesService/find-references.
 * Exported for callers that only need filenames (e.g. a "brief not found" hint)
 * without paying for a full read+frontmatter-parse of every file via `listAllBriefs`.
 */
export function collectBriefFiles(briefsDirAbs: string): string[] {
  const out: string[] = [];
  function walk(absDir: string, rel: string): void {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const childAbs = path.join(absDir, e.name);
      if (e.isDirectory()) {
        walk(childAbs, childRel);
      } else if (e.isFile() && isMarkdownPath(e.name)) {
        out.push(childRel);
      }
    }
  }
  walk(briefsDirAbs, '');
  return out;
}

/** Every `type: brief` file under briefsDir, unsorted/unfiltered. */
export function listAllBriefs(briefsDirAbs: string): BriefListItem[] {
  const items: BriefListItem[] = [];
  for (const rel of collectBriefFiles(briefsDirAbs)) {
    let parsed;
    try {
      parsed = matter(fs.readFileSync(path.join(briefsDirAbs, rel), 'utf8'));
    } catch {
      continue;
    }
    const frontmatter = (parsed.data ?? {}) as BriefFrontmatterRaw;
    if (frontmatter.type !== 'brief') continue;
    items.push({ path: rel, frontmatter, implemented: frontmatter.implemented === true });
  }
  return items;
}

/**
 * `to_release desc`, analysis briefs (`to_release: null`) first — an
 * approximation of the UI's canonical `spec_release`-order sort
 * (BriefsList.tsx `rankOf`), which this FS-only path cannot consult without
 * SQLite. Falls back to the same numeric-locale-compare + path tiebreak the
 * UI uses for releases outside its known list.
 */
function compareBriefs(a: BriefListItem, b: BriefListItem): number {
  const at = typeof a.frontmatter.to_release === 'string' ? a.frontmatter.to_release : null;
  const bt = typeof b.frontmatter.to_release === 'string' ? b.frontmatter.to_release : null;
  if (at === null && bt === null) return a.path.localeCompare(b.path);
  if (at === null) return -1;
  if (bt === null) return 1;
  const cmp = bt.localeCompare(at, undefined, { numeric: true });
  return cmp !== 0 ? cmp : a.path.localeCompare(b.path);
}

export function listBriefsFs(briefsDirAbs: string, opts: BriefListOpts = {}): BriefListResult {
  const all = listAllBriefs(briefsDirAbs).sort(compareBriefs);
  const filtered =
    opts.status === undefined
      ? all
      : all.filter((b) => (opts.status === 'implemented' ? b.implemented : !b.implemented));
  const total = filtered.length;
  const offset = opts.offset ?? 0;
  const sliced = opts.limit === undefined ? filtered.slice(offset) : filtered.slice(offset, offset + opts.limit);
  return { items: sliced, total };
}
