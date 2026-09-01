import crypto from 'node:crypto';
import { customAlphabet } from 'nanoid';
import type Database from 'better-sqlite3';
import {
  extractSlugs,
  extractTags,
  parseXmlTagsExcludingCode,
  type XmlTag,
} from '../../shared/xml-tags.js';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import type { PagesService } from './pages.js';
import type { WatchSubscriber, WatchScope } from '../fs/watcher.js';
import { requireRootId, pageSource } from '../fs/sources.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

// Generator stays strict 8 (per M06 spec `15u7sazr` — auto-inject contract).
const nanoid8 = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const ANCHOR_RE = new RegExp(ANCHOR_PATTERN_SOURCE);
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

export interface ParsedHeading {
  level: number;
  text: string;
  lineIndex: number;
  anchor: string | null;
  anchorLineIndex: number | null;
}

interface SectionInfo {
  anchor: string;
  heading: ParsedHeading;
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
  headingSlug: string;
  lineStart: number;
  lineEnd: number;
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
 * A minted-but-not-yet-written anchor injection, handed from projection to write-back.
 *
 * `sourceBody` is the body the injection was computed FROM. The write-back
 * re-reads the file and applies the injection only if the page still looks like
 * that — otherwise the stash is stale (the page was edited or replaced between
 * the two phases) and writing it would revert the newer content.
 */
interface PendingInjection {
  frontmatter: Record<string, unknown>;
  body: string;
  sourceBody: string;
}

/**
 * M06 — section index + anchor injection.
 *
 * 0.2.10 (M40): this is TWO registrations, not one.
 *
 *  - `m06-section-indexer` (`projection`) — parses the page, mints any missing
 *    anchors and writes `section_index` / `section-entity-link`.
 *  - `m06-anchor-injection` (`write-back`) — persists those minted anchors to
 *    disk, `suppress()`-ing immediately before the write.
 *
 * The split is deliberately compute-here / persist-there rather than
 * parse-twice: the projection needs the minted anchors to build its sections, so
 * moving the whole injection into the later phase would index headings whose
 * anchors do not exist yet, and the suppressed write-back would never re-trigger
 * a reindex to fix it. Persisting in `write-back` is what makes `capture` (which
 * runs after it) see the injected file — AC `m40-capture-after-writeback`.
 */
export class SectionIndexerService implements WatchSubscriber {
  /** Injections minted by the projection, awaiting the write-back phase. Keyed `${rootId}:${relPath}`. */
  private pendingInjections = new Map<string, PendingInjection>();
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
    /** rootId → {pages, watcher} for every SECTION-INDEXED root (filter
     * config.roots by `sectionIndexed`, always includes the built-in 'pages'). */
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
   * `m06-anchor-injection` (write-back) — persists anchors the projection minted
   * for this file, if any. `suppress()` runs immediately before the write so the
   * resulting event is swallowed entirely and no phase (in particular `capture`)
   * runs a second time for it.
   */
  anchorInjectionSubscriber(suppress: (source: string, relPath: string) => void): WatchSubscriber {
    return {
      onChange: async (_scope, source, relPath) => {
        const rootId = requireRootId(source);
        const k = this.key(rootId, relPath);
        const injection = this.pendingInjections.get(k);
        if (!injection) return;
        this.pendingInjections.delete(k);
        const root = this.roots.get(rootId);
        if (!root) return;
        await this.persistInjection(root, source, relPath, injection, suppress);
      },
      onUnlink: (_scope, source, relPath) => {
        this.pendingInjections.delete(this.key(requireRootId(source), relPath));
      },
    };
  }

  /**
   * Write a stashed injection, unless the page moved on underneath it.
   *
   * Re-reading is the whole point: between the projection that minted these
   * anchors and this write, the file may have been edited, replaced by a
   * `git checkout`, or deleted. Writing a stale stash would silently revert the
   * newer content — and because the write is suppressed, neither the UI nor the
   * version log would show it happening.
   */
  private async persistInjection(
    root: SectionIndexRoot,
    source: string,
    relPath: string,
    injection: PendingInjection,
    suppress: (source: string, relPath: string) => void,
  ): Promise<void> {
    let current;
    try {
      current = await root.pages.read(relPath);
    } catch {
      return; // gone — nothing to inject into
    }
    if (current.body !== injection.sourceBody) return; // moved on; a later pass will re-mint
    suppress(source, relPath);
    await root.pages.write(relPath, { frontmatter: injection.frontmatter, body: injection.body });
  }

  /**
   * Persist every anchor `indexAll()` minted.
   *
   * `indexAll()` calls `indexPage` directly, so nothing dispatches for those files
   * and the `write-back` phase never runs for them. Without this the anchors would
   * exist in `section_index` — and be handed to the UI, to `@page#anchor`
   * autocomplete and to `<section_ref/>` insertion — while the files on disk still
   * had none, so every reference made against one would point at text that does
   * not exist and would break the moment the page was next edited.
   */
  async flushPendingInjections(suppress: (source: string, relPath: string) => void): Promise<void> {
    const entries = [...this.pendingInjections.entries()];
    this.pendingInjections.clear();
    for (const [k, injection] of entries) {
      const sep = k.indexOf(':');
      const rootId = k.slice(0, sep);
      const relPath = k.slice(sep + 1);
      const root = this.roots.get(rootId);
      if (!root) continue;
      try {
        await this.persistInjection(root, pageSource(rootId), relPath, injection, suppress);
      } catch (err) {
        console.error(`[section-indexer] anchor injection for ${rootId}:${relPath}:`, err);
      }
    }
  }

  async handleUnlink(rootId: string, relPath: string): Promise<void> {
    this.pendingInjections.delete(this.key(rootId, relPath));
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
      return parseHeadings(page.body.split('\n')).some((h) => h.anchor === anchor);
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

  async indexAll(): Promise<void> {
    for (const [rootId, { pages }] of this.roots) {
      const files = await pages.listMarkdownFiles();
      for (const rel of files) {
        await this.indexPage(rootId, rel);
      }
    }
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
    let body = page.body;

    const lines = body.split('\n');
    const headings = parseHeadings(lines);
    let bodyChanged = false;

    // Every anchor already spoken for, so a freshly minted one cannot land on
    // top of an existing section. Seeded with what THIS file already carries
    // (the file may not be in the index yet, or may be mid-rewrite) and grown
    // as we mint — two headings in one pass must not collide with each other.
    const taken = new Set(headings.map((h) => h.anchor).filter((a): a is string => a !== null));

    for (const h of headings) {
      if (h.anchor === null) {
        const newAnchor = this.freshAnchor(taken);
        taken.add(newAnchor);
        lines.splice(h.lineIndex, 0, `<!-- anchor: ${newAnchor} -->`);
        shiftHeadingLines(headings, h.lineIndex, 1);
        h.anchor = newAnchor;
        h.anchorLineIndex = h.lineIndex - 1;
        bodyChanged = true;
      }
    }

    if (bodyChanged) {
      // Hand the minted anchors to the `write-back` phase rather than writing
      // here: `capture` runs after `write-back`, so the version it records
      // contains the anchors. The sections below are built from `lines`, which
      // already carries them, so the index never waits for the disk write.
      const injected = lines.join('\n');
      this.pendingInjections.set(this.key(rootId, relPath), {
        frontmatter: page.frontmatter,
        body: injected,
        sourceBody: page.body,
      });
      body = injected;
    } else {
      // Nothing to inject THIS pass — drop any older stash for this page, or the
      // write-back would later apply it on top of newer content.
      this.pendingInjections.delete(this.key(rootId, relPath));
    }

    const sections = buildSections(lines, headings);

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
            (rootId, anchor, page_path, parent_anchor, heading_slug, heading_level,
             heading_text, content_hash, body, line_start, line_end, paragraph_count,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(anchor) DO UPDATE SET
            rootId = excluded.rootId,
            page_path = excluded.page_path,
            parent_anchor = excluded.parent_anchor,
            heading_slug = excluded.heading_slug,
            heading_level = excluded.heading_level,
            heading_text = excluded.heading_text,
            content_hash = excluded.content_hash,
            body = excluded.body,
            line_start = excluded.line_start,
            line_end = excluded.line_end,
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
          s.headingSlug,
          s.heading.level,
          s.heading.text,
          s.contentHash,
          s.content,
          s.lineStart,
          s.lineEnd,
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
        // Delete this page's links by (rootId, anchor-set). anchor alone is
        // globally unique, so rootId is a belt-and-suspenders scope match.
        const placeholders = anchorsInFile.map(() => '?').join(',');
        this.db
          .prepare(
            `DELETE FROM section_entity_link WHERE rootId = ? AND anchor IN (${placeholders})`
          )
          .run(rootId, ...anchorsInFile);

        const linkStmt = this.db.prepare(
          `INSERT OR IGNORE INTO section_entity_link (rootId, anchor, entity_type, entity_slug, relation)
               VALUES (?, ?, ?, ?, 'uses')`
        );
        for (const s of ownedSections) {
          const xmlTags = parseXmlTagsExcludingCode(s.content);
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

/**
 * The single definition of "which anchor belongs to which heading".
 *
 * Exported because `check_consistency`'s duplicate-anchor rule has to answer
 * exactly this question, and a second implementation of it is a second answer:
 * a rule that recognizes fewer anchors than the indexer misses real collisions,
 * and one that recognizes more reports prose as a defect.
 */
export function parseHeadings(lines: string[]): ParsedHeading[] {
  const out: ParsedHeading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = HEADING_RE.exec(line);
    if (!m) continue;
    const level = (m[1] ?? '').length;
    const text = (m[2] ?? '').trim();
    let anchor: string | null = null;
    let anchorLineIndex: number | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const above = (lines[j] ?? '').trim();
      if (above === '') continue;
      const am = ANCHOR_RE.exec(above);
      if (am) {
        anchor = am[1] ?? null;
        anchorLineIndex = j;
      }
      break;
    }
    out.push({ level, text, lineIndex: i, anchor, anchorLineIndex });
  }
  return out;
}

function shiftHeadingLines(headings: ParsedHeading[], fromIndex: number, delta: number): void {
  for (const h of headings) {
    if (h.lineIndex >= fromIndex) h.lineIndex += delta;
    if (h.anchorLineIndex !== null && h.anchorLineIndex >= fromIndex) {
      h.anchorLineIndex += delta;
    }
  }
}

function buildSections(lines: string[], headings: ParsedHeading[]): SectionInfo[] {
  const sections: SectionInfo[] = [];
  const stack: ParsedHeading[] = [];
  // Hand-authored anchors are unpoliced, so the same value CAN appear twice in
  // one file. Deterministic rule, half one: within a page the FIRST occurrence
  // (lowest line) owns the anchor and the rest are not indexed. Never "whichever
  // the upsert wrote last".
  const claimed = new Set<string>();
  // The headings that actually GOT a row, by identity. `claimed` answers "is this
  // anchor string spoken for", which is a different question: a collision loser
  // shares its anchor string with the winner, so asking `claimed` about the loser
  // says yes and re-parents its children onto the winner — a heading elsewhere in
  // the page. Identity is the only thing that tells the two frames apart.
  const owners = new Set<ParsedHeading>();
  for (let idx = 0; idx < headings.length; idx++) {
    const h = headings[idx]!;
    if (!h.anchor) continue;
    /**
     * Pops MANY frames at once, and that is load-bearing: Markdown allows level
     * jumps (`##` -> `####` -> `##`), so closing one frame per heading would leave
     * a `####` sitting under a sibling it does not belong to. Depth is not level.
     */
    while (stack.length && stack[stack.length - 1]!.level >= h.level) stack.pop();
    /**
     * The nearest ancestor THAT OWNS A ROW, not simply the nearest ancestor.
     *
     * A heading that lost a within-page anchor collision stays on the stack — it
     * still shapes what nests under it — but it is never written, so pointing at it
     * would leave `parent_anchor` referencing a row that does not exist. Walking
     * past it re-parents the child onto the nearest real ancestor: a shallower tree,
     * which is a truthful one, rather than a dangling edge.
     */
    let parentAnchor: string | null = null;
    for (let s = stack.length - 1; s >= 0; s--) {
      const candidate = stack[s]!;
      if (owners.has(candidate)) {
        parentAnchor = candidate.anchor;
        break;
      }
    }
    const headingSlug = slugifyHeading(h.text);
    stack.push(h);
    // Skipped AFTER the stack is maintained: the losing heading still shapes the
    // nesting of everything below it, it just does not get a row.
    if (claimed.has(h.anchor)) continue;
    claimed.add(h.anchor);
    owners.add(h);

    let endLine = lines.length;
    for (let j = idx + 1; j < headings.length; j++) {
      if (headings[j]!.level <= h.level) {
        endLine = headings[j]!.anchorLineIndex ?? headings[j]!.lineIndex;
        break;
      }
    }
    const startLine = h.lineIndex;
    const sectionLines = lines.slice(startLine, endLine);
    const rawBody = sectionLines.slice(1).join('\n');
    const normalized = normalizeContent(rawBody);
    const contentHash = crypto.createHash('sha256').update(normalized).digest('hex');
    const paragraphCount = countParagraphs(rawBody);
    sections.push({
      anchor: h.anchor,
      heading: h,
      parentAnchor,
      headingSlug,
      lineStart: startLine + 1,
      lineEnd: endLine,
      content: rawBody,
      contentHash,
      paragraphCount,
    });
  }
  return sections;
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
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


