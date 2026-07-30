/**
 * M39 — `find_references`, now over a discriminated `target`.
 *
 * The entity variant is BIT-IDENTICAL to what shipped before: it delegates to
 * the same shared core (`src/core/references/`), so the migration is purely
 * syntactic — positional `(type, slug, opts)` became `{ target: "entity", … }`.
 * A call without `target` is refused with the variants listed rather than
 * defaulting to `entity`, because a silent default is exactly how the old page
 * API ended up answering from the wrong root.
 *
 * Two variants are new. `target: "section"` closes the missing inverse — "who
 * cites this section?" was unanswerable, which made anchors a one-way street.
 * `target: "page"` answers "who links here", and requires the full page key.
 *
 * KNOWN LIMIT, stated rather than implied: only generic/document edges are
 * covered — entity embeds, section refs, page links. Type-specific entity↔entity
 * edges (`ac.verifies`, foreign keys, `designSystemSlug`) are NOT here; they
 * remain data on the entity view, and `check_consistency` rule 9 reports their
 * integrity. They stay derivable from entity data, so a future `{ from, to,
 * kind }` projection will not need a re-model.
 */

import type { Database } from 'better-sqlite3';
import { findReferences as findEntityReferences } from '../../../core/references/index.js';
import type { PagesSource } from '../../../core/references/types.js';
import { parseXmlTagsExcludingCode } from '../../../shared/xml-tags.js';
import { parseLinks } from '../../services/pages-link-indexer.js';
import { invalidArgument } from '../errors.js';
import type { PageSource } from '../page-source.js';
import { DEFAULT_LIMITS, paginate } from '../pagination.js';
import type { RootSet } from '../roots.js';
import type { DiscoveryDeps, FindReferencesInput, FindReferencesResult, ReferenceHit } from '../types.js';

export async function findReferences(
  deps: DiscoveryDeps,
  pages: PageSource,
  roots: RootSet,
  input: FindReferencesInput,
): Promise<FindReferencesResult> {
  // Reference sweeps run only over roots that declare `referenceValidated` —
  // a root nobody validates has no reference semantics to report on.
  const scanned = roots.referenceValidated();
  const anchors = anchorIndex(deps.db);

  let hits: ReferenceHit[];
  switch (input.target) {
    case 'entity':
      hits = await entityReferences(deps, pages, scanned, input);
      break;
    case 'section':
      hits = await sectionReferences(pages, scanned, input.anchor);
      break;
    case 'page':
      hits = await pageReferences(pages, scanned, roots, input.rootId, input.path);
      break;
    default:
      throw invalidArgument(
        'find_references requires a `target` discriminator',
        'find_references({ target: "entity", type, slug }) | ({ target: "section", anchor }) | ({ target: "page", rootId, path })',
      );
  }

  for (const hit of hits) {
    const anchor = anchorFor(anchors, hit.rootId, hit.pagePath, hit.line);
    if (anchor) hit.anchor = anchor;
  }
  hits.sort(
    (a, b) => a.rootId.localeCompare(b.rootId) || a.pagePath.localeCompare(b.pagePath) || a.line - b.line,
  );

  // A target with no references is a SUCCESS with an empty list and `total: 0`
  // — not a not-found. "Nothing cites this" is an answer.
  const page = paginate(hits, input, DEFAULT_LIMITS.findReferences);
  return { references: page.items, total: page.total, hasMore: page.hasMore };
}

async function entityReferences(
  deps: DiscoveryDeps,
  pages: PageSource,
  scanned: RootSet['all'],
  input: Extract<FindReferencesInput, { target: 'entity' }>,
): Promise<ReferenceHit[]> {
  const source: PagesSource = {
    listPages: async () => await pages.readAll(scanned),
  };
  const hits = await findEntityReferences(
    {
      pages: source,
      host: { entityExists: (type, slug) => deps.reader.getEntity(type, slug) !== null },
      getEntityTagSlugs: (type, slug) => deps.reader.getEntity(type, slug)?.tags ?? [],
    },
    input.type,
    input.slug,
    { includeTagMatches: input.includeTagMatches === true },
  );
  return hits.map((h) => ({
    rootId: h.rootId,
    pagePath: h.pagePath,
    tagType: h.tagType,
    line: h.line,
    ...(h.via ? { via: h.via } : {}),
  }));
}

async function sectionReferences(
  pages: PageSource,
  scanned: RootSet['all'],
  anchor: string,
): Promise<ReferenceHit[]> {
  const out: ReferenceHit[] = [];
  for (const page of await pages.readAll(scanned)) {
    for (const tag of parseXmlTagsExcludingCode(page.body)) {
      if (tag.kind === 'section_ref' && tag.attrs.anchor === anchor) {
        out.push({ rootId: page.rootId, pagePath: page.path, tagType: 'section_ref', line: tag.line });
      }
    }
    // A `@page.md#anchor` link is a reference to the section, not just to the
    // page — the two syntaxes mean the same thing to a reader.
    for (const link of parseLinks(page.body).candidates) {
      if (link.anchor === anchor) {
        out.push({ rootId: page.rootId, pagePath: page.path, tagType: 'page_link', line: link.line });
      }
    }
  }
  return out;
}

async function pageReferences(
  pages: PageSource,
  scanned: RootSet['all'],
  roots: RootSet,
  rootId: string,
  targetPath: string,
): Promise<ReferenceHit[]> {
  roots.require(rootId, 'find_references');
  if (!targetPath) {
    throw invalidArgument(
      'find_references({ target: "page" }) requires the full page key',
      `find_references({ target: "page", rootId: "${rootId}", path: "<relative path>" })`,
    );
  }
  const normalized = targetPath.replace(/^\/+/, '');
  const out: ReferenceHit[] = [];
  for (const page of await pages.readAll(scanned)) {
    for (const link of parseLinks(page.body).candidates) {
      if (link.targetPath.replace(/^\/+/, '') !== normalized) continue;
      out.push({ rootId: page.rootId, pagePath: page.path, tagType: 'page_link', line: link.line });
    }
  }
  return out;
}

interface AnchorRow {
  rootId: string;
  path: string;
  anchor: string;
  start: number;
  end: number;
}

function anchorIndex(db: Database): AnchorRow[] {
  return db
    .prepare(
      `SELECT rootId, page_path AS path, anchor, line_start AS start, line_end AS end
         FROM section_index ORDER BY rootId, page_path, line_start`,
    )
    .all() as AnchorRow[];
}

function anchorFor(rows: readonly AnchorRow[], rootId: string, path: string, line: number): string | undefined {
  let best: AnchorRow | undefined;
  for (const row of rows) {
    if (row.rootId !== rootId || row.path !== path || line < row.start || line > row.end) continue;
    if (!best || row.end - row.start < best.end - best.start) best = row;
  }
  return best?.anchor;
}
