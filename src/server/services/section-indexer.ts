import crypto from 'node:crypto';
import { customAlphabet } from 'nanoid';
import type Database from 'better-sqlite3';
import {
  extractSlugs,
  extractTags,
  parseXmlTags,
  type XmlTag,
} from '../../shared/xml-tags.js';
import {
  insertAnchorLines,
  ownBodyOf,
  parseSections,
  type ParsedSection,
} from '../../shared/section-parser.js';
import type { PagesService } from './pages.js';
import type { WatchSubscriber, WatchScope } from '../fs/watcher.js';
import { requireRootId, pageSource } from '../fs/sources.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

// Generator stays strict 8 (per M06 spec `15u7sazr` — auto-inject contract).
const nanoid8 = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

interface SectionInfo {
  anchor: string;
  heading: ParsedSection;
  /**
   * 0.2.59 — the anchor of the enclosing section, or `null` for a page's first one.
   *
   * Replaces `headingPath`, the slash-joined ancestor chain. That string had the
   * separator as a content character (a heading with a `/` split into two), and it
   * encoded an array in a TEXT column so every reader paid to parse it. The tree
   * `get_page_outline` returns carries the hierarchy now, and this is what it is
   * built from.
   */
  parentAnchor: string | null;
  /** First line of the anchor block (1-based). */
  lineStart: number;
  /** End of the OWN body (1-based, inclusive). */
  lineEnd: number;
  /** End of the subtree (1-based, inclusive). */
  subtreeLineEnd: number;
  /** The OWN body as authored. */
  content: string;
  contentHash: string;
  paragraphCount: number;
}

/** 0.1.96: one section-indexed root. 0.2.10: the watcher handle is gone — the
 * anchor write-back suppresses through M40, by source name. */
export interface SectionIndexRoot {
  pages: PagesService;
}

/**
 * M06 — section index + anchor injection on the roots of kinds that select
 * the section indexer.
 *
 * 2.1.8: two reactions, and the indexer no longer injects anything.
 *
 *  - `m06-anchor-injection` (`write-back`, before `projection` and `capture`) —
 *    mints the missing anchors and writes them to disk, `suppress()`-ing
 *    immediately before the write ({@link mintAnchors}).
 *  - `m06-section-indexer` (`projection`) — the 8-step pass of M06 `s2r014vw`
 *    over a file the injection has already anchored: parse, headings, anchors,
 *    boundaries, `content_hash`, upsert `section_index`, auto-link
 *    `section_entity_link`. A heading still without an anchor is not indexed;
 *    the next injection pass gives it one.
 *
 * Persisting in `write-back` is what makes `capture` (which runs after it) see
 * the injected file — AC `m40-capture-after-writeback`.
 */
export class SectionIndexerService implements WatchSubscriber {
  /**
   * anchor → pages that wanted it but lost the duplicate tie-break. A loser
   * writes no row, so when the WINNER later drops the anchor (the author fixing
   * the duplicate, or the tail of a cut-and-paste move) the row would be deleted
   * and the surviving claimant left unindexed until a full rebuild. This lets
   * the delete hand the anchor over instead of dropping it.
   *
   * In-memory on purpose: `indexAll()` resolves the same thing from scratch, so
   * a restart is already a repair, and this only has to cover the live session.
   */
  private blockedClaims = new Map<string, Set<string>>();

  constructor(
    private db: Database.Database,
    /** rootId → {pages} for every root whose kind selects
     * `m06-section-indexer` (2.1.8: every `kind: pages` root, built-in included). */
    private roots: Map<string, SectionIndexRoot>,
    private ws: WsEmitter,
    private host: ProjectPluginHost,
  ) {}

  private key(rootId: string, relPath: string): string {
    return `${rootId}:${relPath}`;
  }

  // ─── `m06-section-indexer` (projection) ───────────────────────────────────

  async onChange(_scope: WatchScope, source: string, relPath: string): Promise<void> {
    await this.indexPage(requireRootId(source), relPath);
  }

  onUnlink(_scope: WatchScope, source: string, relPath: string): Promise<void> {
    return this.handleUnlink(requireRootId(source), relPath);
  }

  /**
   * `m06-anchor-injection` (write-back) — mints and writes the missing anchors
   * of this file ({@link mintAnchors}). `suppress()` runs immediately before the write so the
   * resulting event is swallowed entirely and no phase (in particular `capture`)
   * runs a second time for it.
   */
  anchorInjectionSubscriber(suppress: (source: string, relPath: string) => void): WatchSubscriber {
    return {
      onChange: async (_scope, source, relPath) => {
        await this.mintAnchors(requireRootId(source), source, relPath, suppress);
      },
      onUnlink: () => {},
    };
  }

  /**
   * `m06-anchor-injection` for one file: mint every missing anchor and write
   * them, all in this call (M06 `v9zrytp8`).
   *
   * The write-back reads the FILE and does the minting itself, which is what
   * the phase is for — and `indexPage` then indexes an already-anchored file, so
   * its line ranges describe the bytes that will still be there at the end of
   * the chain rather than ones shifted by a later injection.
   *
   * The write suppresses its own event and stays a step INSIDE the running
   * chain (arm 2): it writes the very file the chain is handling, so it must not
   * start a second one.
   */
  async mintAnchors(
    rootId: string,
    source: string,
    relPath: string,
    suppress: (source: string, relPath: string) => void,
  ): Promise<boolean> {
    const root = this.roots.get(rootId);
    if (!root) return false;
    let page;
    try {
      page = await root.pages.read(relPath);
    } catch {
      return false; // gone — nothing to inject into
    }
    const minted = this.mintInto(page.body);
    if (!minted) return false;
    suppress(source, relPath);
    await root.pages.write(relPath, { frontmatter: page.frontmatter, body: minted });
    return true;
  }

  /**
   * The minting itself: every heading without an anchor gets a fresh one.
   *
   * Returns the new body, or `null` when nothing was missing.
   *
   * Uniqueness is checked PROJECT-WIDE through `freshAnchor`, grown as we mint so
   * two headings in one pass cannot collide with each other, and seeded with what
   * this file already carries — the file may not be in the index yet.
   */
  private mintInto(body: string): string | null {
    // 2.0.0 — headings come from the shared section parser, so a heading-shaped
    // line inside a code block, a multi-line HTML comment or (in any file) an
    // unknown JSX region gets no anchor. An anchor-shaped line inside a code
    // block is not an anchor either — and is never "cleaned up": opening a
    // project modifies no file on its account.
    const sections = parseSections(body, { frontmatter: false }).sections;
    const taken = new Set(sections.map((sec) => sec.anchor).filter((a): a is string => a !== null));
    const missing = sections.filter((sec) => sec.anchor === null);
    if (missing.length === 0) return null;
    const minted = missing.map(() => {
      const a = this.freshAnchor(taken);
      taken.add(a);
      return a;
    });
    return insertAnchorLines(body, missing, minted);
  }

  async handleUnlink(rootId: string, relPath: string): Promise<void> {
    const existing = this.db
      .prepare('SELECT anchor FROM section_index WHERE rootId = ? AND page_path = ?')
      .all(rootId, relPath) as Array<{ anchor: string }>;
    if (existing.length === 0) return;
    const anchors = existing.map((r) => r.anchor);
    const tx = this.db.transaction(() => {
      for (const anchor of anchors) this.removeSectionIndex(anchor);
    });
    tx();
  }

  /**
   * An anchor is the identity of a section — `get_sections({ anchors })`,
   * `list_sections({ by: "anchor" })` and `<section_ref anchor="…"/>` all assume
   * it names exactly one. The generator used to mint one blind and hand it
   * straight to an upsert keyed on `anchor`, so a collision did not raise: it
   * OVERWROTE the other section's row and made it unaddressable.
   *
   * Occupancy is checked PROJECT-WIDE, not per file, because `<section_ref/>`
   * carries no page path — there is no scope in which a per-file anchor would
   * resolve. 36^8 makes a collision vanishingly unlikely; the point of the probe
   * is that "unlikely" is not the same guarantee as "checked".
   */
  private freshAnchor(taken: ReadonlySet<string>): string {
    const occupied = this.db.prepare('SELECT 1 FROM section_index WHERE anchor = ?');
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = nanoid8();
      if (taken.has(candidate)) continue;
      if (occupied.get(candidate)) continue;
      return candidate;
    }
    // Eight straight collisions in a 2.8e12 space is not bad luck, it is a
    // broken generator. Failing loudly beats minting a duplicate.
    throw new Error('[section-indexer] could not mint a free anchor in 8 attempts');
  }

  /**
   * Deterministic rule, half two — across pages.
   *
   * `section_index.anchor` is UNIQUE, so a cross-page duplicate never raised: the
   * upsert quietly took the row from whichever page was scanned last, making the
   * winner a function of directory order.
   *
   * The fix cannot be a plain SQL guard ("only overwrite from a lower-sorting
   * path"), because at the moment of the conflict a MOVE and a DUPLICATE look
   * identical — both are "another page's row holds this anchor". Refusing the
   * write unconditionally breaks the common case badly: cut a section out of
   * `aaa.md`, paste it into `zzz.md`, and `zzz.md`'s write is blocked while
   * `aaa.md`'s re-index then deletes the row for an anchor it no longer has —
   * the section disappears from the index entirely and stays gone.
   *
   * So ask the question that actually separates the two: does the incumbent page
   * STILL claim this anchor? If not, this is a move and the row is ours. If it
   * does, it is a genuine duplicate, and the winner is the lowest
   * `(rootId, page_path)` — the same answer on every machine, regardless of scan
   * order. `check_consistency` rule 13 reports the collision so it gets fixed
   * rather than silently tolerated.
   *
   * Costs one page read per conflicting anchor, on a path that is empty in
   * normal operation.
   */
  private async anchorsOwnedElsewhere(
    rootId: string,
    relPath: string,
    sections: readonly SectionInfo[],
  ): Promise<Set<string>> {
    const blocked = new Set<string>();
    const incumbentStmt = this.db.prepare(
      'SELECT rootId, page_path FROM section_index WHERE anchor = ?',
    );
    for (const s of sections) {
      const row = incumbentStmt.get(s.anchor) as
        | { rootId: string; page_path: string }
        | undefined;
      if (!row) continue;
      // Our own row — an ordinary re-index (body edited, heading moved).
      if (row.rootId === rootId && row.page_path === relPath) continue;
      // Stale row: the incumbent no longer carries it, so this is a move.
      if (!(await this.pageClaimsAnchor(row.rootId, row.page_path, s.anchor))) continue;
      const incumbentSortsLower =
        row.rootId < rootId || (row.rootId === rootId && row.page_path < relPath);
      if (incumbentSortsLower) {
        blocked.add(s.anchor);
        const claimants = this.blockedClaims.get(s.anchor) ?? new Set<string>();
        claimants.add(this.key(rootId, relPath));
        this.blockedClaims.set(s.anchor, claimants);
      }
    }
    return blocked;
  }

  /**
   * A row for `anchor` has just been deleted. If a page lost the tie-break for
   * it earlier, that page is now the rightful owner — re-index it rather than
   * leaving a section that exists on disk unreachable by its own anchor.
   */
  private async reindexBlockedClaimants(anchor: string): Promise<void> {
    const claimants = this.blockedClaims.get(anchor);
    if (!claimants) return;
    // Cleared FIRST so the re-index below cannot recurse back into this anchor.
    this.blockedClaims.delete(anchor);
    for (const key of claimants) {
      const sep = key.indexOf(':');
      const rootId = key.slice(0, sep);
      const relPath = key.slice(sep + 1);
      try {
        await this.indexPage(rootId, relPath);
      } catch (err) {
        console.error(`[section-indexer] failed to re-index claimant ${key}:`, err);
      }
    }
  }

  /** Does this page, as it is on disk right now, attach `anchor` to a heading? */
  private async pageClaimsAnchor(rootId: string, relPath: string, anchor: string): Promise<boolean> {
    const root = this.roots.get(rootId);
    if (!root) return false;
    try {
      const page = await root.pages.read(relPath);
      return parseSections(page.body, { frontmatter: false }).sections.some(
        (sec) => sec.anchor === anchor,
      );
    } catch {
      // Page gone (deleted or renamed) — it claims nothing.
      return false;
    }
  }

  private removeSectionIndex(anchor: string): void {
    // anchor is globally unique — deleting by anchor is root-agnostic.
    this.db.prepare('DELETE FROM section_entity_link WHERE anchor = ?').run(anchor);
    this.db.prepare('DELETE FROM section_index WHERE anchor = ?').run(anchor);
  }

  /**
   * The full rebuild (boot, branch checkout, root rename, the manual rebuild).
   *
   * No reaction chain runs for these files, so with `suppress` given each file
   * first goes through `m06-anchor-injection` ({@link mintAnchors}) and only then
   * through the indexer — the same order as a chain, file by file, so every
   * minted anchor is checked against the rows the files before it produced.
   * Without `suppress` it indexes what is on disk and writes nothing.
   */
  async indexAll(suppress?: (source: string, relPath: string) => void): Promise<void> {
    for (const [rootId, { pages }] of this.roots) {
      const files = await pages.listMarkdownFiles();
      for (const rel of files) {
        if (suppress) {
          try {
            await this.mintAnchors(rootId, pageSource(rootId), rel, suppress);
          } catch (err) {
            console.error(`[section-indexer] anchor injection for ${rootId}:${rel}:`, err);
          }
        }
        await this.indexPage(rootId, rel);
      }
    }
    this.pruneDanglingEntityLinks();
  }

  /**
   * 0.2.89 — the entity side of `section_entity_link` has no FK: the domain of
   * `entity_type` follows the project's active type registry, and a slug lives in
   * whichever store that type owns. So the database cannot notice an entity going
   * away, and an edge inserted while it existed would outlive it until its page is
   * next re-indexed. This pass is the integrity the schema does not give — one
   * existence check per distinct `(entity_type, entity_slug)`, not per edge.
   * The anchor side needs none of it: `ON DELETE CASCADE` covers it.
   */
  pruneDanglingEntityLinks(): number {
    const pairs = this.db
      .prepare('SELECT DISTINCT entity_type, entity_slug FROM section_entity_link')
      .all() as Array<{ entity_type: string; entity_slug: string }>;
    const del = this.db.prepare(
      'DELETE FROM section_entity_link WHERE entity_type = ? AND entity_slug = ?',
    );
    let removed = 0;
    const tx = this.db.transaction(() => {
      for (const { entity_type, entity_slug } of pairs) {
        if (this.host.entityExists(entity_type, entity_slug)) continue;
        removed += del.run(entity_type, entity_slug).changes;
      }
    });
    tx();
    return removed;
  }

  async indexPage(rootId: string, relPath: string): Promise<void> {
    const root = this.roots.get(rootId);
    if (!root) return;
    const { pages } = root;
    let page;
    try {
      page = await pages.read(relPath);
    } catch {
      return;
    }
    // 2.1.8 — no injection step: `m06-anchor-injection` ran in the earlier
    // `write-back` phase (or, on a full rebuild, just before this call), so the
    // file is indexed as it is on disk.
    const body = page.body;

    const sections = buildSections(body);

    const priorRows = this.db
      .prepare(
        'SELECT anchor, content_hash FROM section_index WHERE rootId = ? AND page_path = ?'
      )
      .all(rootId, relPath) as Array<{ anchor: string; content_hash: string }>;
    const prior = new Map(priorRows.map((r) => [r.anchor, r.content_hash] as const));
    const currentAnchors = new Set(sections.map((s) => s.anchor));

    const deletedAnchors: string[] = [];
    for (const anchor of prior.keys()) {
      if (!currentAnchors.has(anchor)) deletedAnchors.push(anchor);
    }

    const blocked = await this.anchorsOwnedElsewhere(rootId, relPath, sections);

    const tx = this.db.transaction(() => {
      /**
       * 0.2.46 — the upsert also writes `section_index.body`: the section AS
       * AUTHORED, i.e. `s.content`, the RAW slice between the boundaries with the
       * heading line and the anchor comment already excluded by `buildSections`.
       * 2.0.0 — the OWN body: up to the next section of ANY level, so the
       * first child's anchor line and everything below it are not in it.
       *
       * Deliberately NOT `normalizeContent(s.content)` — normalization is the
       * hash's input and nothing but the hash consumes it. Writing it here would
       * store a lossy rendering under a name that promises the original.
       *
       * Materialization, not emission: no generic operation hands this column
       * out. `list_sections` stays a skeleton; `GET /api/sections` emits only a
       * prefix of it as `contentSnippet`. A column with no write-side would be a
       * bug rather than an intermediate state, so it is bound on BOTH the insert
       * and the conflict path.
       */
      const upsertStmt = this.db.prepare(
        `INSERT INTO section_index
            (rootId, anchor, page_path, parent_anchor, heading_level,
             heading_text, content_hash, body, line_start, line_end, subtree_line_end,
             paragraph_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(anchor) DO UPDATE SET
            rootId = excluded.rootId,
            page_path = excluded.page_path,
            parent_anchor = excluded.parent_anchor,
            heading_level = excluded.heading_level,
            heading_text = excluded.heading_text,
            content_hash = excluded.content_hash,
            body = excluded.body,
            line_start = excluded.line_start,
            line_end = excluded.line_end,
            subtree_line_end = excluded.subtree_line_end,
            paragraph_count = excluded.paragraph_count,
            updated_at = datetime('now')`
      );
      for (const s of sections) {
        if (blocked.has(s.anchor)) continue;
        upsertStmt.run(
          rootId,
          s.anchor,
          relPath,
          s.parentAnchor,
          s.heading.level,
          s.heading.heading,
          s.contentHash,
          s.content,
          s.lineStart,
          s.lineEnd,
          s.subtreeLineEnd,
          s.paragraphCount
        );
      }

      if (deletedAnchors.length) {
        for (const anchor of deletedAnchors) this.removeSectionIndex(anchor);
      }

      /**
       * The anchors this page actually OWNS after the upsert, read back rather
       * than assumed. On a collision the row stays with the lowest-sorting
       * location, and the loser must not go on to rewrite the winner's links —
       * that would put the deterministic rule back at the mercy of scan order
       * one layer down, where it is harder to see.
       */
      const owned = new Set(
        (
          this.db
            .prepare('SELECT anchor FROM section_index WHERE rootId = ? AND page_path = ?')
            .all(rootId, relPath) as Array<{ anchor: string }>
        ).map((r) => r.anchor),
      );
      const ownedSections = sections.filter((s) => owned.has(s.anchor));

      const anchorsInFile = ownedSections.map((s) => s.anchor);
      if (anchorsInFile.length) {
        // Delete this page's links by anchor ALONE. The anchor is globally
        // unique and `owned` above proves this page holds it, so no rootId
        // scope is needed — and one would be wrong: after a root rename
        // (0.2.101) the section row moves to the new id, but its links were
        // stored under the old one, and a rootId-scoped delete would leave
        // them behind forever (the hydrator reads links by anchor).
        const placeholders = anchorsInFile.map(() => '?').join(',');
        this.db
          .prepare(`DELETE FROM section_entity_link WHERE anchor IN (${placeholders})`)
          .run(...anchorsInFile);

        const linkStmt = this.db.prepare(
          `INSERT OR IGNORE INTO section_entity_link (rootId, anchor, entity_type, entity_slug, relation)
               VALUES (?, ?, ?, ?, 'uses')`
        );
        // M51 — one parse of the WHOLE page, so every section sees the same
        // non-content ranges the rest of the server sees for this file (a
        // fence or comment is never re-judged from inside a slice of it);
        // each tag then belongs to the section whose own-body lines hold it.
        const pageTags = parseXmlTags(body);
        for (const s of ownedSections) {
          const xmlTags = pageTags.filter((t) => t.line > s.heading.headingLine && t.line <= s.lineEnd);
          const seen = new Set<string>();
          const link = (type: string, slug: string) => {
            const key = `${type}|${slug}`;
            if (seen.has(key)) return;
            seen.add(key);
            // M29: link by slug (sole identity); only persist for entities
            // that actually exist, mirroring the prior id-resolver guard.
            // `entityExists` answers for hidden types too, which is why this
            // needs no allowlist of "core" types.
            if (this.host.entityExists(type, slug)) linkStmt.run(rootId, s.anchor, type, slug);
          };
          for (const tag of xmlTags) {
            // 0.2.15 — all FIVE generic M19 tags close the link, for EVERY
            // entity type including the hidden ones (`diagram`, `spreadsheet`).
            // Until now the loop bailed on any tag without a `type` attribute,
            // which silently dropped both the tag-driven kinds and the entities
            // that carried their type in the tag name — so `detail._references`
            // closed for some types and not others.
            if (tag.kind === 'tagged_list' || tag.kind === 'tagged_list_mixed') {
              for (const { type, slug } of this.entitiesMatchingTaggedList(tag)) link(type, slug);
              continue;
            }
            const type = tag.attrs.type;
            if (!type) continue;
            for (const slug of extractSlugs(tag)) link(type, slug);
          }
        }
      }
    });
    tx();

    // After the transaction: an anchor this page gave up may be claimed by a
    // page that lost the tie-break for it earlier.
    for (const anchor of deletedAnchors) await this.reindexBlockedClaimants(anchor);

    this.ws.broadcast({
      kind: 'section:indexed',
      rootId,
      pagePath: relPath,
      anchors: sections.map((s) => s.anchor),
    });
  }

  /**
   * The entities a `<tagged_list/>` / `<tagged_list_mixed/>` resolves to right
   * now, so a dynamic embed closes `section_entity_link` the same way a static
   * one does (0.2.15). `tagged_list` restricts to one `type`; `tagged_list_mixed`
   * spans every type. `filter="or"` matches any of the named tags; anything else
   * requires all of them — the default is AND, which is what every renderer of
   * these tags already does (`TaggedListView`, `TaggedListMixedView`,
   * `XmlChipDispatcher`, `xml-chip-preprocess`). Reading the default the other
   * way round made the index link entities the page does not display: the
   * embed would show endpoints tagged `auth` AND `v2`, while `find_references`
   * reported the page as referencing everything tagged `auth` OR `v2`.
   *
   * Resolved eagerly, at index time, against the tag assignments of the moment —
   * which is what the rest of the section index already is. Re-tagging an entity
   * does not by itself reindex the sections that list it; that is the same
   * staleness the link table has always had, not something introduced here.
   */
  private entitiesMatchingTaggedList(tag: XmlTag): Array<{ type: string; slug: string }> {
    const tagSlugs = extractTags(tag);
    if (!tagSlugs.length) return [];
    const requireAll = tag.attrs.filter !== 'or';
    const placeholders = tagSlugs.map(() => '?').join(',');
    const typeClause = tag.kind === 'tagged_list' ? 'AND entity_type = ?' : '';
    const params: unknown[] = [...tagSlugs];
    if (tag.kind === 'tagged_list') {
      if (!tag.attrs.type) return [];
      params.push(tag.attrs.type);
    }
    const having = requireAll ? 'HAVING COUNT(DISTINCT tag_slug) = ?' : '';
    if (requireAll) params.push(tagSlugs.length);
    const rows = this.db
      .prepare(
        `SELECT entity_type, entity_slug FROM entity_tag
          WHERE tag_slug IN (${placeholders}) ${typeClause}
          GROUP BY entity_type, entity_slug ${having}`,
      )
      .all(...params) as Array<{ entity_type: string; entity_slug: string }>;
    return rows.map((r) => ({ type: r.entity_type, slug: r.entity_slug }));
  }
}

function buildSections(body: string): SectionInfo[] {
  const parsed = parseSections(body, { frontmatter: false });
  const lines = body.split('\n');
  const sections: SectionInfo[] = [];
  // Hand-authored anchors are unpoliced, so the same value CAN appear twice in
  // one file. Deterministic rule, half one: within a page the FIRST occurrence
  // (lowest line) owns the anchor and the rest are not indexed. Never "whichever
  // the upsert wrote last".
  const claimed = new Set<string>();
  // Positions (in `parsed.sections`) that actually GOT a row. A collision loser
  // shares its anchor string with the winner, so asking `claimed` about the
  // loser would re-parent its children onto the winner — a heading elsewhere in
  // the page. Identity (position) is the only thing that tells the two apart.
  const owners = new Set<number>();
  for (const sec of parsed.sections) {
    if (!sec.anchor) continue;
    /**
     * The nearest ancestor THAT OWNS A ROW, not simply the nearest ancestor. A
     * heading without an anchor, or one that lost a within-page collision, still
     * shapes the nesting but owns no row; pointing at it would leave
     * `parent_anchor` dangling. Walking past it gives a shallower, truthful tree.
     */
    let parentAnchor: string | null = null;
    for (let p = sec.parent; p !== null; p = parsed.sections[p]!.parent) {
      if (owners.has(p)) {
        parentAnchor = parsed.sections[p]!.anchor;
        break;
      }
    }
    if (claimed.has(sec.anchor)) continue;
    claimed.add(sec.anchor);
    owners.add(sec.position);

    const rawBody = ownBodyOf(lines, sec);
    sections.push({
      anchor: sec.anchor,
      heading: sec,
      parentAnchor,
      lineStart: sec.startLine,
      lineEnd: sec.ownEndLine,
      subtreeLineEnd: sec.subtreeEndLine,
      content: rawBody,
      contentHash: crypto.createHash('sha256').update(normalizeContent(rawBody)).digest('hex'),
      paragraphCount: countParagraphs(rawBody),
    });
  }
  return sections;
}

export function normalizeContent(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\w[^>]*\/?>(?:[\s\S]*?<\/\w+>)?/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function countParagraphs(content: string): number {
  const blocks = content.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
  return blocks.length;
}


