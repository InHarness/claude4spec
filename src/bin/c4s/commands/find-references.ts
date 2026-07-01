import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { ParsedArgs } from '../args.js';
import { requireString, optionalString } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { findReferences } from '../../../core/references/index.js';
import type { ReferencePage } from '../../../core/references/index.js';
import { isMarkdownPath } from '../../../shared/page-files.js';
import { TagsService } from '../../../server/services/tags.js';
import { readConfig } from '../../../server/config.js';
import type { RawEntityType } from '../../../server/domain/raw-entity-reader.js';
import type { EntityType } from '../../../shared/entities.js';

/**
 * Graph reader (M11 owns the command, M19 owns the logic). Readonly: opens
 * SQLite `readonly: true, fileMustExist: true` and walks `pages/` directly — no
 * running `npx @inharness-ai/claude4spec` server required. Delegates to the references core;
 * no L9 serializers.
 *
 *   c4s find-references --type <t> --slug <s> [--include-tag-matches] [--format json|text]
 *
 * Output: array of refs. Direct rows carry no extra field; with
 * `--include-tag-matches`, dynamic rows add `via: [tag, ...]` — parity with MCP.
 */
export async function runFindReferences(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slug = requireString(args, 'slug');
  const itm = args.flags.get('include-tag-matches');
  const includeTagMatches = itm === true || itm === 'true';

  const ctx = await createContext(args);
  try {
    const tags = new TagsService(ctx.db);
    // Honor the project's configured page roots (CLI flag > config.roots). The
    // reference walk spans every REFERENCE-VALIDATED root; a `--pages <dir>` flag
    // overrides to a single dir. For a root at '.' the walk roots at the project
    // dir and the dotfile skip below excludes .claude4spec/.git (parity with
    // PagesService).
    const override = optionalString(args, 'pages');
    const dirs = override
      ? [override]
      : readConfig(ctx.projectDir)
          .roots.filter((r) => r.referenceValidated)
          .map((r) => r.dir);
    const pageRoots = dirs.map((d) => path.join(ctx.projectDir, d));
    const hits = await findReferences(
      {
        pages: { listPages: () => collectPages(pageRoots) },
        host: { entityExists: (t, s) => ctx.reader.getEntity(t as RawEntityType, s) != null },
        getEntityTagSlugs: (t, s) => tags.getEntityTagSlugs(t as EntityType, s),
      },
      type,
      slug,
      { includeTagMatches },
    );
    const refs = hits.map((h) =>
      h.via
        ? { pagePath: h.pagePath, tagType: h.tagType, line: h.line, via: h.via }
        : { pagePath: h.pagePath, tagType: h.tagType, line: h.line },
    );
    writeOutput(refs, args);
  } finally {
    ctx.close();
  }
}

/**
 * Recursively collect `.md` pages under each root dir, returning frontmatter-
 * stripped bodies with root-relative posix paths (parity with PagesService). A
 * missing dir yields no refs.
 */
async function collectPages(pageRoots: string[]): Promise<ReferencePage[]> {
  const out: ReferencePage[] = [];
  async function walk(absDir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue; // skip .claude4spec/.git/... — parity with PagesService
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const childAbs = path.join(absDir, e.name);
      if (e.isDirectory()) {
        await walk(childAbs, childRel);
      } else if (e.isFile() && isMarkdownPath(e.name)) {
        const raw = await fs.readFile(childAbs, 'utf-8');
        out.push({ path: childRel, body: matter(raw).content });
      }
    }
  }
  for (const root of pageRoots) {
    await walk(root, '');
  }
  return out;
}
