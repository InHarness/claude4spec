import fs from 'node:fs';
import path from 'node:path';
import { isMarkdownPath } from '../../shared/page-files.js';

/**
 * A missing/unreadable dir yields no briefs — mirrors PagesService/find-references.
 * Exported for callers that only need filenames (e.g. a "brief not found" hint)
 * without a full read+frontmatter-parse of every file. Listing briefs is the
 * server's `BriefService.listBriefs` (release-axis order); this is not a lister.
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
