/**
 * M39 — `list_sections` and `get_section`.
 *
 * `list_sections` takes a DISCRIMINATED UNION, `{ by: "page" }` or
 * `{ by: "anchor" }`, replacing three optional flags that were silently ANDed
 * and quietly ignored each other. The fuzzy `query` mode is gone on purpose: it
 * mixed identity regimes — a heading substring is not an identity — and leaked
 * search into what is a traversal. The replacement path is explicit:
 * `search_pages` to find a hit, then `list_sections({ by: "anchor" })`.
 *
 * Sections exist only on roots with `sectionIndexed`, so both operations
 * iterate that subset. There is no `rootId === 'pages'` branch anywhere here.
 */

import type { Database } from 'better-sqlite3';
import { invalidArgument, sectionNotFound } from '../errors.js';
import type { PageSource } from '../page-source.js';
import { DEFAULT_LIMITS, paginate } from '../pagination.js';
import type { RawEntityReader, RawSection } from '../raw-entity-reader.js';
import type { RootSet } from '../roots.js';
import type { SerializationEngine } from '../../core/plugin-host/serialization-engine.js';
import { bodySize, hydrateSection } from '../section-hydrator.js';
import { truncateText } from '../budget.js';
import type {
  GetSectionInput,
  GetSectionResult,
  ListSectionsInput,
  ListSectionsResult,
  SectionListItem,
} from '../types.js';

/** The indexer's own anchor alphabet — an anchor is `[a-z0-9]{6,12}`, nothing else. */
const ANCHOR_RE = /^[a-z0-9]{6,12}$/;

export async function listSections(
  db: Database,
  pages: PageSource,
  roots: RootSet,
  input: ListSectionsInput,
): Promise<ListSectionsResult> {
  if (input.by !== 'page' && input.by !== 'anchor') {
    throw invalidArgument(
      'list_sections requires a `by` discriminator',
      'list_sections({ by: "page", rootId, path }) or list_sections({ by: "anchor", anchor })',
    );
  }

  let rows: RawSection[];
  if (input.by === 'anchor') {
    if (!ANCHOR_RE.test(input.anchor)) {
      throw invalidArgument(
        `'${input.anchor}' is not an anchor`,
        'an anchor is 6-12 lowercase alphanumerics; use search_pages to find one by text',
      );
    }
    rows = selectSections(db, 'WHERE anchor = ?', [input.anchor]);
  } else {
    const root = roots.requireSectionIndexed(input.rootId, 'list_sections');
    rows = selectSections(db, 'WHERE rootId = ? AND page_path = ?', [root.id, input.path]);
  }

  const indexed = new Set(roots.sectionIndexed().map((r) => r.id));
  const visible = rows.filter((r) => indexed.has(r.rootId));
  // Measurement before fetching is a contract, not a nicety: three of five
  // failures in the motivating session were pulling something unbounded. Each
  // page is read ONCE for the whole group, not once per section.
  const sizes = await measure(pages, visible);

  const items: SectionListItem[] = visible.map((section) => ({
    rootId: section.rootId,
    anchor: section.anchor,
    heading: section.headingText,
    level: section.headingLevel,
    headingPath: section.headingPath ? section.headingPath.split('/') : [],
    size: sizes.get(section.anchor) ?? 0,
  }));

  items.sort((a, b) => a.rootId.localeCompare(b.rootId) || a.anchor.localeCompare(b.anchor));
  return paginate(items, input, DEFAULT_LIMITS.listSections);
}

async function measure(pages: PageSource, sections: readonly RawSection[]): Promise<Map<string, number>> {
  const byPage = new Map<string, RawSection[]>();
  for (const s of sections) {
    const key = `${s.rootId}:${s.pagePath}`;
    const group = byPage.get(key);
    if (group) group.push(s);
    else byPage.set(key, [s]);
  }
  const sizes = new Map<string, number>();
  for (const group of byPage.values()) {
    const first = group[0]!;
    let content: string;
    try {
      content = await pages.readBody(first.rootId, first.pagePath);
    } catch {
      // An index row whose page is gone still lists — with size 0 rather than
      // taking the whole listing down over one stale row.
      continue;
    }
    for (const s of group) sizes.set(s.anchor, bodySize(content, s));
  }
  return sizes;
}

export function selectSections(db: Database, where: string, params: unknown[]): RawSection[] {
  const rows = db
    .prepare(`SELECT * FROM section_index ${where} ORDER BY page_path, line_start`)
    .all(...(params as never[])) as Array<Record<string, unknown>>;
  return rows.map(toRawSection);
}

export function toRawSection(row: Record<string, unknown>): RawSection {
  return {
    rootId: row.rootId as string,
    anchor: row.anchor as string,
    pagePath: row.page_path as string,
    headingPath: row.heading_path as string,
    headingSlug: row.heading_slug as string,
    headingText: row.heading_text as string,
    headingLevel: row.heading_level as number,
    contentHash: row.content_hash as string,
    lineStart: row.line_start as number,
    lineEnd: row.line_end as number,
  };
}

export async function getSection(
  db: Database,
  pages: PageSource,
  roots: RootSet,
  reader: RawEntityReader,
  serialization: SerializationEngine,
  input: GetSectionInput,
): Promise<GetSectionResult> {
  const section = reader.getSection(input.anchor);
  if (!section) {
    const near = db
      .prepare('SELECT anchor FROM section_index ORDER BY anchor LIMIT 12')
      .all() as Array<{ anchor: string }>;
    throw sectionNotFound(input.anchor, near.map((r) => r.anchor));
  }
  // Anchors are globally unique, so the root comes from the row rather than the
  // caller — but the gate still applies: a section on a root that lost its
  // index is not addressable.
  roots.requireSectionIndexed(section.rootId, 'get_section');

  const hydrated = await hydrateSection(db, pages, section, input.includeSubtree ?? false);
  // The `detail` view IS the source for this operation — the core does not
  // hand-roll a second section shape beside the serializer's. What it does own
  // is the WIRE naming: the operation's contract is snake_case, while the
  // serializer's camelCase is what the editor and every existing consumer of
  // `single_element` already compile against. Projecting here keeps one source
  // of truth without renaming a shipped shape out from under its consumers.
  const detail = serialization.serializeSection('detail', hydrated, reader).data as Record<string, unknown>;
  const edges = (detail.edges as GetSectionResult['edges']) ?? hydrated.edges;

  const budgeted = truncateText(
    String(detail.body ?? hydrated.body),
    `section body truncated by response budget — read the page window with get_page, or narrow to a child section via list_sections({ by: "page", rootId: "${section.rootId}", path: "${section.pagePath}" })`,
  );

  return {
    anchor: section.anchor,
    rootId: section.rootId,
    page_path: section.pagePath,
    heading_text: section.headingText,
    heading_level: section.headingLevel,
    content_hash: section.contentHash,
    line_start: section.lineStart,
    line_end: section.lineEnd,
    body: budgeted.text,
    ...(budgeted.truncated ? { truncated: true, truncationHint: budgeted.truncationHint } : {}),
    edges,
  };
}
