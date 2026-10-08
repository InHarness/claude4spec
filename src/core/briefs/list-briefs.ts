import fs from 'node:fs';
import path from 'node:path';
import { isMarkdownPath } from '../../shared/page-files.js';
import { fileMapEntryOf } from '../../shared/root-kinds.js';

/** Is `relPath` a markdown entry of the `briefs` kind's file map (`*.md`)? Out-of-map files are not briefs. */
export function isBriefEntry(relPath: string): boolean {
  return fileMapEntryOf('briefs', relPath)?.format === 'markdown';
}

/**
 * A missing/unreadable dir yields no briefs — mirrors PagesService/find-references.
 * Exported for callers that only need filenames (e.g. a "brief not found" hint)
 * without a full read+frontmatter-parse of every file. Listing briefs is the
 * server's `BriefService.listBriefs` (release-axis order); this is not a lister.
 * Only the `briefs` file map's entries count — the same set the server lists.
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
      } else if (e.isFile() && isMarkdownPath(e.name) && isBriefEntry(childRel)) {
        out.push(childRel);
      }
    }
  }
  walk(briefsDirAbs, '');
  return out;
}
